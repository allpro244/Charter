// raw/manifest.json: one entry per source with every URL tried, the HTTP
// status, byte count, and SHA-256. Also the idempotence rule that decides
// whether a download can be skipped.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RawAttempt {
  url: string;
  status: number | null; // HTTP status, or null when the request never got a response
  bytes?: number;
  error?: string;
}

export interface RawEntry {
  name: string;
  kind: string;
  required: boolean;
  ok: boolean;
  file: string | null; // file name under raw/, null when nothing was written
  url: string | null; // the URL that succeeded, or the last one tried
  status: number | null;
  bytes: number | null;
  sha256: string | null;
  fetchedOn: string; // ISO timestamp of the successful fetch (or of the last attempt)
  skipped: boolean; // true when the file was already on disk with the expected size
  attempts: RawAttempt[];
  note?: string;
}

export interface RawManifest {
  fetchedOn: string;
  vintage: number;
  entries: RawEntry[];
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function readRawManifest(path: string): RawManifest | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<RawManifest>;
    if (!Array.isArray(parsed.entries)) return null;
    return {
      fetchedOn: parsed.fetchedOn ?? '',
      vintage: parsed.vintage ?? 0,
      entries: parsed.entries,
    };
  } catch {
    return null;
  }
}

export function writeRawManifest(path: string, manifest: RawManifest): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
}

// Replace the entry with the same name, or append. Keeps the file ordered
// the way the source table is.
export function upsertEntry(manifest: RawManifest, entry: RawEntry): void {
  const i = manifest.entries.findIndex((e) => e.name === entry.name);
  if (i >= 0) manifest.entries[i] = entry;
  else manifest.entries.push(entry);
}

export function entryByName(manifest: RawManifest | null, name: string): RawEntry | null {
  return manifest?.entries.find((e) => e.name === name) ?? null;
}

// The idempotence rule (SYSTEMS.md, Download rules): skip a file that already
// exists with the expected size. Expected size comes from the previous
// manifest entry or from a HEAD request; when neither is known a file that
// exists and is not empty is trusted. --force always re-downloads.
export function shouldSkipDownload(opts: {
  force: boolean;
  exists: boolean;
  sizeOnDisk: number | null;
  expectedBytes: number | null;
}): boolean {
  if (opts.force) return false;
  if (!opts.exists || opts.sizeOnDisk === null || opts.sizeOnDisk <= 0) return false;
  if (opts.expectedBytes === null) return true;
  return opts.sizeOnDisk === opts.expectedBytes;
}
