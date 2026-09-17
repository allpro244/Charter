// scripts/fetch-data.ts
//
// Downloads every raw public dataset in SYSTEMS.md Part 2 into raw/ and
// records every URL, HTTP status, byte count, and SHA-256 in raw/manifest.json.
// The source table and the frozen vintage live in scripts/lib/sources.ts.
//
// Run:   npm run fetch-data            (idempotent: skips files already on disk)
//        npm run fetch-data -- --force (re-download everything)
//        npm run fetch-data -- --only qcew,laus
//
// Proxy: Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 is set.
// The npm script sets it. If the proxy re-signs TLS, also set
// NODE_EXTRA_CA_CERTS to the proxy's CA bundle. Never disable verification.
//
// Failure policy (SYSTEMS.md, Download rules): retry once after 2 seconds,
// then try the next URL listed for the source, then record the failure with
// the exact URL and error and move on. Exit 1 at the end if any required
// source failed. Nothing is ever generated to stand in for a failed download.

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { SOURCES, VINTAGE, RAW_DIR, mirrorsFor, rawPath, type Source } from './lib/sources';
import {
  downloadToFile,
  fetchText,
  fileSize,
  headContentLength,
  sleep,
  type DownloadResult,
} from './lib/download';
import {
  entryByName,
  readRawManifest,
  sha256File,
  shouldSkipDownload,
  upsertEntry,
  writeRawManifest,
  type RawAttempt,
  type RawEntry,
  type RawManifest,
} from './lib/manifest';

const HELP = `scripts/fetch-data.ts: download every raw dataset for CHARTER into raw/.

Sources (vintage ${VINTAGE}): Census PEP and ACS, BLS QCEW and LAUS, BEA GDP,
FHFA HPI, OMB CBSA delineations, FDIC institutions and Summary of Deposits,
FRED national series, Census county boundaries. Every URL, status, byte
count and SHA-256 goes to raw/manifest.json.

Options:
  --force        re-download files that already exist
  --only a,b     only fetch the named sources (see raw/manifest.json for names)
  --help         this text

Idempotent: a file that exists with the expected size is skipped.
Exit code 1 if any required source failed after retry and alternates.
`;

const RETRY_DELAY_MS = 2000;
const MANIFEST_PATH = join(RAW_DIR, 'manifest.json');

interface Args {
  force: boolean;
  only: Set<string> | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { force: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log(HELP);
      process.exit(0);
    } else if (a === '--force') {
      args.force = true;
    } else if (a === '--only') {
      const list = argv[++i];
      if (!list) throw new Error('--only needs a comma separated list of source names');
      args.only = new Set(list.split(',').map((s) => s.trim()).filter(Boolean));
    } else {
      throw new Error(`Unknown argument ${a}. Try --help.`);
    }
  }
  return args;
}

function now(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(msg);
}

// One attempt, then one retry after a pause. Returns the attempts made.
async function withRetry<T extends { ok: boolean; status: number | null; error?: string }>(
  label: string,
  url: string,
  fn: () => Promise<T>,
): Promise<{ result: T; attempts: RawAttempt[] }> {
  const attempts: RawAttempt[] = [];
  let result = await fn();
  attempts.push({ url, status: result.status, ...(result.error ? { error: result.error } : {}) });
  log(`  ${label}: ${result.ok ? 'ok' : 'failed'} (status ${result.status ?? 'none'}${result.error ? `, ${result.error}` : ''})`);
  if (!result.ok) {
    log(`  retrying in ${RETRY_DELAY_MS / 1000}s`);
    await sleep(RETRY_DELAY_MS);
    result = await fn();
    attempts.push({ url, status: result.status, ...(result.error ? { error: result.error } : {}) });
    log(`  retry: ${result.ok ? 'ok' : 'failed'} (status ${result.status ?? 'none'}${result.error ? `, ${result.error}` : ''})`);
  }
  return { result, attempts };
}

function baseEntry(source: Source): RawEntry {
  return {
    name: source.name,
    kind: source.kind,
    required: source.required,
    ok: false,
    file: null,
    url: null,
    status: null,
    bytes: null,
    sha256: null,
    fetchedOn: now(),
    skipped: false,
    attempts: [],
    ...(source.note ? { note: source.note } : {}),
  };
}

// Skip logic shared by every kind: the file is on disk and its size matches
// what the previous manifest entry (or a HEAD request) says it should be.
async function alreadyHave(file: string, url: string, prev: RawEntry | null, args: Args, useHead: boolean): Promise<boolean> {
  const dest = rawPath(file);
  const exists = existsSync(dest);
  if (!exists) return false;
  let expected: number | null = prev && prev.ok && prev.file === file ? prev.bytes : null;
  if (expected === null && useHead) expected = await headContentLength(url);
  return shouldSkipDownload({ force: args.force, exists, sizeOnDisk: fileSize(dest), expectedBytes: expected });
}

async function skippedEntry(source: Source, file: string, url: string, prev: RawEntry | null): Promise<RawEntry> {
  const dest = rawPath(file);
  const bytes = statSync(dest).size;
  const sha256 = prev && prev.file === file && prev.sha256 && prev.bytes === bytes ? prev.sha256 : await sha256File(dest);
  return {
    ...baseEntry(source),
    ok: true,
    file,
    url,
    status: prev?.status ?? 200,
    bytes,
    sha256,
    fetchedOn: prev?.fetchedOn ?? now(),
    skipped: true,
    attempts: [],
  };
}

async function fetchFileSource(source: Source, prev: RawEntry | null, args: Args): Promise<RawEntry> {
  const entry = baseEntry(source);
  for (const { url, file } of source.urls) {
    if (await alreadyHave(file, url, prev, args, true)) {
      log(`  ${file}: already on disk with the expected size, skipping`);
      return skippedEntry(source, file, url, prev);
    }
    const { result, attempts } = await withRetry(file, url, () => downloadToFile(url, rawPath(file)));
    entry.attempts.push(...attempts.map((a, i) => ({ ...a, ...(i === attempts.length - 1 && result.ok ? { bytes: result.bytes } : {}) })));
    entry.url = url;
    entry.status = result.status;
    if (result.ok) {
      entry.ok = true;
      entry.file = file;
      entry.bytes = result.bytes;
      entry.sha256 = result.sha256;
      entry.fetchedOn = now();
      return entry;
    }
  }
  return entry;
}

interface TextLike {
  ok: boolean;
  status: number | null;
  error?: string;
  text: string;
}

// A JSON body saved as-is (ACS). Validated as parseable, and for ACS as a
// non-empty array of rows, before it is written.
async function fetchJsonSource(source: Source, prev: RawEntry | null, args: Args): Promise<RawEntry> {
  const entry = baseEntry(source);
  for (const { url, file } of source.urls) {
    if (await alreadyHave(file, url, prev, args, false)) {
      log(`  ${file}: already on disk with the expected size, skipping`);
      return skippedEntry(source, file, url, prev);
    }
    const { result, attempts } = await withRetry(file, url, async (): Promise<TextLike> => {
      const r = await fetchText(url);
      if (!r.ok) return r;
      try {
        const parsed: unknown = JSON.parse(r.text);
        if (!Array.isArray(parsed) || parsed.length < 2) {
          return { ...r, ok: false, error: `expected a JSON array with a header row and data rows, got ${r.text.slice(0, 200)}` };
        }
      } catch (err) {
        return { ...r, ok: false, error: `body is not JSON: ${r.text.slice(0, 200)} (${String(err)})` };
      }
      return r;
    });
    entry.attempts.push(...attempts);
    entry.url = url;
    entry.status = result.status;
    if (result.ok) {
      const dest = rawPath(file);
      mkdirSync(RAW_DIR, { recursive: true });
      writeFileSync(dest, result.text);
      entry.ok = true;
      entry.file = file;
      entry.bytes = statSync(dest).size;
      entry.sha256 = await sha256File(dest);
      entry.fetchedOn = now();
      return entry;
    }
  }
  return entry;
}

interface FdicPage {
  meta?: { total?: number };
  data?: Array<{ data?: Record<string, unknown> } | Record<string, unknown>>;
}

// The FDIC BankFind API caps limit at 10000 and pages with offset. Every page
// is fetched (each with the retry rule) and the records are merged into one
// file: { source, url, fetchedOn, total, pages, data: [...] }.
async function fetchFdicSource(source: Source, prev: RawEntry | null, args: Args): Promise<RawEntry> {
  const entry = baseEntry(source);
  for (const { url, file } of source.urls) {
    if (await alreadyHave(file, url, prev, args, false)) {
      log(`  ${file}: already on disk with the expected size, skipping`);
      return skippedEntry(source, file, url, prev);
    }
    const limitMatch = /[?&]limit=(\d+)/.exec(url);
    const limit = limitMatch ? Number(limitMatch[1]) : 10000;
    const records: Record<string, unknown>[] = [];
    let total: number | null = null;
    let offset = 0;
    let pages = 0;
    let failed: DownloadResult | TextLike | null = null;
    for (;;) {
      const pageUrl = `${url}&offset=${offset}`;
      const { result, attempts } = await withRetry(`${file} page ${pages + 1}`, pageUrl, async (): Promise<TextLike & { page?: FdicPage }> => {
        const r = await fetchText(pageUrl);
        if (!r.ok) return r;
        try {
          const page = JSON.parse(r.text) as FdicPage;
          if (!Array.isArray(page.data)) return { ...r, ok: false, error: `no data array in response: ${r.text.slice(0, 200)}` };
          return { ...r, page };
        } catch (err) {
          return { ...r, ok: false, error: `body is not JSON: ${r.text.slice(0, 200)} (${String(err)})` };
        }
      });
      entry.attempts.push(...attempts);
      entry.url = pageUrl;
      entry.status = result.status;
      if (!result.ok || !result.page) {
        failed = result;
        break;
      }
      const page = result.page;
      pages++;
      total = page.meta?.total ?? total;
      const rows = page.data ?? [];
      for (const row of rows) {
        const inner = (row as { data?: Record<string, unknown> }).data;
        records.push(inner && typeof inner === 'object' ? inner : (row as Record<string, unknown>));
      }
      log(`  ${file}: page ${pages}, ${rows.length} records, ${records.length} so far${total !== null ? ` of ${total}` : ''}`);
      if (rows.length < limit) break;
      if (total !== null && records.length >= total) break;
      offset += limit;
    }
    if (failed) continue;
    const dest = rawPath(file);
    mkdirSync(RAW_DIR, { recursive: true });
    writeFileSync(
      dest,
      JSON.stringify({ source: source.name, url, fetchedOn: now(), total, pages, note: source.note ?? null, data: records }),
    );
    entry.ok = true;
    entry.file = file;
    entry.bytes = statSync(dest).size;
    entry.sha256 = await sha256File(dest);
    entry.fetchedOn = now();
    return entry;
  }
  return entry;
}

// The only fallback that is not a download: the us-atlas npm package, built
// from the same Census cartographic files. Recorded so the manifest says
// exactly which geometry the build used.
async function usAtlasEntry(): Promise<RawEntry> {
  const require = createRequire(import.meta.url);
  const path = require.resolve('us-atlas/counties-10m.json');
  const pkg = require('us-atlas/package.json') as { version: string };
  return {
    name: 'us-atlas-fallback',
    kind: 'npm',
    required: false,
    ok: true,
    file: path,
    url: `npm:us-atlas@${pkg.version}`,
    status: null,
    bytes: statSync(path).size,
    sha256: await sha256File(path),
    fetchedOn: now(),
    skipped: false,
    attempts: [],
    note: 'Fallback geometry: us-atlas (npm), derived from Census cb_*_us_county_5m. Used only when census-county-shapes failed.',
  };
}

function summaryTable(entries: RawEntry[]): string {
  const rows = entries.map((e) => [
    e.name,
    e.ok ? (e.skipped ? 'skipped' : 'ok') : e.required ? 'FAILED' : 'failed (optional)',
    e.status === null ? '' : String(e.status),
    e.bytes === null ? '' : e.bytes.toLocaleString('en-US'),
    e.file ?? '',
  ]);
  const header = ['source', 'status', 'http', 'bytes', 'file'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 3 ? c.padStart(widths[i] ?? 0) : c.padEnd(widths[i] ?? 0))).join('  ');
  return [line(header), ...rows.map(line)].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(RAW_DIR, { recursive: true });
  const previous = readRawManifest(MANIFEST_PATH);
  const manifest: RawManifest = { fetchedOn: now(), vintage: VINTAGE, entries: previous?.entries ?? [] };
  const selected = SOURCES.filter((s) => !args.only || args.only.has(s.name));
  if (args.only) {
    const unknown = [...args.only].filter((n) => !SOURCES.some((s) => s.name === n));
    if (unknown.length) throw new Error(`Unknown source names in --only: ${unknown.join(', ')}`);
  }
  log(`fetch-data: vintage ${VINTAGE}, ${selected.length} sources, raw dir ${RAW_DIR}${args.force ? ', --force' : ''}`);

  for (const source of selected) {
    log(`\n[${source.name}] ${source.note ?? ''}`);
    const prev = entryByName(previous, source.name);
    let entry: RawEntry;
    if (source.kind === 'file') entry = await fetchFileSource(source, prev, args);
    else if (source.kind === 'json') entry = await fetchJsonSource(source, prev, args);
    else entry = await fetchFdicSource(source, prev, args);
    upsertEntry(manifest, entry);
    if (source.name === 'census-county-shapes' && !entry.ok) {
      log('  census boundaries unavailable; recording the us-atlas npm fallback for the build');
      upsertEntry(manifest, await usAtlasEntry());
    }
    // Write after every source so a crash mid-run still leaves a record.
    writeRawManifest(MANIFEST_PATH, manifest);
  }

  const touched = manifest.entries.filter((e) => selected.some((s) => s.name === e.name) || e.name === 'us-atlas-fallback');
  log('\n' + summaryTable(touched));
  const okNames = new Set(manifest.entries.filter((e) => e.ok).map((e) => e.name));
  const failedRequired = touched.filter((e) => e.required && !e.ok && !mirrorsFor(e.name).some((m) => okNames.has(m.name)));
  if (failedRequired.length) {
    log(`\n${failedRequired.length} required source(s) failed (no mirror covers them):`);
    for (const e of failedRequired) {
      for (const a of e.attempts) log(`  ${e.name}: ${a.url} -> ${a.status ?? 'no response'}${a.error ? ` (${a.error})` : ''}`);
    }
    process.exitCode = 1;
  } else {
    log('\nAll required sources are on disk. Manifest: ' + MANIFEST_PATH);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
