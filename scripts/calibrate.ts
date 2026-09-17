// scripts/calibrate.ts
//
// Computes the verified bands in data/calibration.ts from FDIC data
// (SYSTEMS.md Part 2, "Calibration from FDIC data"). Pulls year-end call
// report records for every institution from the FDIC BankFind financials
// API, buckets by asset size, and computes yearly aggregates; a band is the
// 5th percentile (low), median (typical), and 95th percentile (high) of
// those yearly values. Failure counts come from the failures API. The
// aggregate interest-bearing deposit beta is measured over hiking cycles
// against FRED FEDFUNDS.
//
// It rewrites data/calibration.ts, preserving every band it cannot compute.
// Energy charge-offs and per-type deposit betas have no FDIC breakout and
// stay hand-entered.
//
// Run:   npm run calibrate
//        npm run calibrate -- --from 2000 --to 2024 --dry-run
// Proxy: NODE_USE_ENV_PROXY=1 (set by the npm script).
//
// Field names are not guessed blindly: the script fetches one full record
// and the FDIC field list, then maps each metric from a short table of
// candidate names, and prints a clear error naming the metric, the
// candidates, and the closest available fields when none match.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DATA_DIR, RAW_DIR, ROOT, VINTAGE } from './lib/sources';
import { downloadToFile, fetchText, sleep } from './lib/download';
import { parseCsv, findColumn, parseNumber } from './lib/csv';
import { bandFromYearly, isBand, median, renderCalibrationFile, round, type CalibrationTree } from './lib/calibration-file';
import type { Band } from '../data/calibration';

const HELP = `scripts/calibrate.ts: compute verified calibration bands from FDIC data.

Pulls year-end financials for every FDIC insured institution (default 2000
through ${VINTAGE + 1}), buckets by asset size, and rewrites data/calibration.ts
with computed bands for charge-off rates by loan type, ROA, NIM, noninterest
expense to assets, an aggregate deposit beta, and failures per year. Bands it
cannot compute stay hand-entered with verified: false.

Options:
  --from YEAR   first year (default 2000)
  --to YEAR     last year (default ${VINTAGE + 1})
  --dry-run     print the computed bands, do not rewrite data/calibration.ts
  --help        this text

Pages are cached in raw/fdic-financials/ so a re-run does not refetch.
Exit code 1 if any computable band could not be computed.
`;

const API = 'https://banks.data.fdic.gov/api';
const CACHE_DIR = join(RAW_DIR, 'fdic-financials');
const PAGE_LIMIT = 10000;
const CRISIS_FAILURES = 25; // a year with at least this many failures is a crisis year

// Asset buckets in thousands of dollars, as the FDIC reports ASSET.
const BUCKETS = [
  { key: 'under1b', filter: 'ASSET:[0 TO 999999]', label: 'under $1B' },
  { key: 'from1bTo10b', filter: 'ASSET:[1000000 TO 9999999]', label: '$1B to $10B' },
  { key: 'from10bTo250b', filter: 'ASSET:[10000000 TO 249999999]', label: '$10B to $250B' },
  { key: 'over250b', filter: 'ASSET:[250000000 TO *]', label: 'over $250B' },
] as const;
type BucketKey = (typeof BUCKETS)[number]['key'];

// Every metric the script may use, with candidate FDIC field names in order
// of preference and a hint used to list similar fields when none match.
const METRICS = {
  asset: { candidates: ['ASSET'], hint: /ASSET/ },
  netIncome: { candidates: ['NETINC'], hint: /NETINC|INC/ },
  nim: { candidates: ['NIMY', 'NIM'], hint: /NIM/ },
  nonintExpense: { candidates: ['NONIX'], hint: /NONI/ },
  depositInterestExpense: { candidates: ['EDEP', 'EDEPDOM', 'EINTDEP'], hint: /^E.*DEP|DEP.*EXP/ },
  interestBearingDeposits: { candidates: ['DEPI', 'DEPIDOM', 'IDEP'], hint: /^DEPI|DEPINT|INTBEAR/ },
  ncoCi: { candidates: ['NTCI'], hint: /^NTCI/ },
  loansCi: { candidates: ['LNCI'], hint: /^LNCI/ },
  ncoCreOwnerOccupied: { candidates: ['NTRENROW'], hint: /^NTRENR/ },
  loansCreOwnerOccupied: { candidates: ['LNRENROW'], hint: /^LNRENR/ },
  ncoCreOther: { candidates: ['NTRENROT'], hint: /^NTRENR/ },
  loansCreOther: { candidates: ['LNRENROT'], hint: /^LNRENR/ },
  ncoCreNonfarm: { candidates: ['NTRENRES'], hint: /^NTRENR/ },
  loansCreNonfarm: { candidates: ['LNRENRES'], hint: /^LNRENR/ },
  ncoMultifamily: { candidates: ['NTREMULT'], hint: /^NTREM/ },
  loansMultifamily: { candidates: ['LNREMULT'], hint: /^LNREM/ },
  ncoConstruction: { candidates: ['NTRECONS'], hint: /^NTRECON/ },
  loansConstruction: { candidates: ['LNRECONS'], hint: /^LNRECON/ },
  ncoResi: { candidates: ['NTRERES'], hint: /^NTRERES/ },
  loansResi: { candidates: ['LNRERES'], hint: /^LNRERES/ },
  ncoConsumer: { candidates: ['NTCON'], hint: /^NTCON/ },
  loansConsumer: { candidates: ['LNCON'], hint: /^LNCON/ },
  ncoAg: { candidates: ['NTAG'], hint: /^NTAG/ },
  loansAg: { candidates: ['LNAG'], hint: /^LNAG/ },
} as const;
type MetricKey = keyof typeof METRICS;

interface Args {
  from: number;
  to: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { from: 2000, to: VINTAGE + 1, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log(HELP);
      process.exit(0);
    } else if (a === '--from') args.from = Number(argv[++i]);
    else if (a === '--to') args.to = Number(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
    else throw new Error(`Unknown argument ${a}. Try --help.`);
  }
  if (!Number.isInteger(args.from) || !Number.isInteger(args.to) || args.from > args.to) throw new Error('--from and --to must be years with from <= to');
  return args;
}

function log(msg: string): void {
  console.log(msg);
}

// ---------------------------------------------------------------------------
// HTTP with the same retry rule as fetch-data: once, after two seconds.

async function getJson(url: string): Promise<unknown> {
  let r = await fetchText(url);
  if (!r.ok) {
    log(`  ${url}: ${r.error ?? `HTTP ${r.status}`}; retrying in 2s`);
    await sleep(2000);
    r = await fetchText(url);
  }
  if (!r.ok) throw new Error(`${url}: ${r.error ?? `HTTP ${r.status}`}`);
  return JSON.parse(r.text);
}

interface FdicResponse {
  meta?: { total?: number };
  data?: Array<{ data?: Record<string, unknown> }>;
}

function fdicRows(json: unknown): Record<string, unknown>[] {
  const res = json as FdicResponse;
  if (!Array.isArray(res.data)) throw new Error(`FDIC response has no data array: ${JSON.stringify(json).slice(0, 300)}`);
  return res.data.map((d) => d.data ?? (d as Record<string, unknown>));
}

// ---------------------------------------------------------------------------
// Field discovery.

interface FieldInfo {
  available: Set<string>;
  titles: Map<string, string>;
}

async function discoverFields(year: number): Promise<FieldInfo> {
  log('Discovering FDIC financial fields');
  const sample = fdicRows(await getJson(`${API}/financials?filters=REPDTE:${year}1231&limit=1&format=json`));
  const first = sample[0];
  if (!first) throw new Error(`no financial record found for REPDTE ${year}1231`);
  const available = new Set(Object.keys(first));
  log(`  ${available.size} fields on a sample record`);
  const titles = new Map<string, string>();
  const yaml = await fetchText('https://banks.data.fdic.gov/docs/financial_properties.yaml');
  if (yaml.ok) {
    // Best effort scan: "  FIELD:" lines followed by a "title:" line.
    let current: string | null = null;
    for (const line of yaml.text.split('\n')) {
      const m = /^\s{2,}([A-Z][A-Z0-9_]*):\s*$/.exec(line);
      if (m) current = m[1] ?? null;
      const t = /^\s+title:\s*["']?(.+?)["']?\s*$/.exec(line);
      if (t && current) titles.set(current, t[1] ?? '');
    }
    log(`  ${titles.size} field titles read from financial_properties.yaml`);
  } else {
    log(`  financial_properties.yaml not available (${yaml.error ?? yaml.status}); continuing with the sample record only`);
  }
  return { available, titles };
}

type Resolved = Partial<Record<MetricKey, string>>;

function resolveFields(info: FieldInfo): { resolved: Resolved; unresolved: MetricKey[] } {
  const resolved: Resolved = {};
  const unresolved: MetricKey[] = [];
  for (const key of Object.keys(METRICS) as MetricKey[]) {
    const m = METRICS[key];
    const hit = m.candidates.find((c) => info.available.has(c));
    if (hit) {
      resolved[key] = hit;
      log(`  ${key.padEnd(26)} -> ${hit}${info.titles.get(hit) ? `  (${info.titles.get(hit)})` : ''}`);
    } else {
      unresolved.push(key);
      const similar = [...info.available].filter((f) => m.hint.test(f)).slice(0, 12);
      log(
        `  ${key.padEnd(26)} -> NOT FOUND. Tried ${m.candidates.join(', ')}. Similar available fields: ${
          similar.length ? similar.map((f) => `${f}${info.titles.get(f) ? ` (${info.titles.get(f)})` : ''}`).join(', ') : 'none'
        }`,
      );
    }
  }
  return { resolved, unresolved };
}

// ---------------------------------------------------------------------------
// Year-end records, cached per year and bucket in raw/fdic-financials/.

async function fetchYearBucket(year: number, bucket: (typeof BUCKETS)[number], fields: string[]): Promise<Record<string, unknown>[]> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cache = join(CACHE_DIR, `${year}-${bucket.key}.json`);
  if (existsSync(cache)) {
    const cached = JSON.parse(readFileSync(cache, 'utf8')) as { fields: string[]; rows: Record<string, unknown>[] };
    if (fields.every((f) => cached.fields.includes(f))) return cached.rows;
  }
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  for (;;) {
    const filters = encodeURIComponent(`REPDTE:${year}1231 AND ${bucket.filter}`);
    const url = `${API}/financials?filters=${filters}&fields=${fields.join(',')}&limit=${PAGE_LIMIT}&offset=${offset}&format=json`;
    const json = await getJson(url);
    const page = fdicRows(json);
    rows.push(...page);
    const total = (json as FdicResponse).meta?.total ?? null;
    if (page.length < PAGE_LIMIT || (total !== null && rows.length >= total)) break;
    offset += PAGE_LIMIT;
    if (offset >= 10000) log(`  warning: ${year} ${bucket.key} needs offset ${offset}; the API may cap results at 10000`);
  }
  writeFileSync(cache, JSON.stringify({ year, bucket: bucket.key, fields, fetchedOn: new Date().toISOString(), rows }));
  return rows;
}

function num(row: Record<string, unknown>, field: string | undefined): number | null {
  if (!field) return null;
  return parseNumber(row[field] as string | number | null | undefined);
}

// Sums of every resolved metric for one year and bucket, plus asset weighted
// sums of the ratio fields so weighted means can be formed later.
interface Agg {
  count: number;
  sum: Partial<Record<MetricKey, number>>;
  weighted: Partial<Record<MetricKey, number>>; // metric x asset
}

function aggregate(rows: Record<string, unknown>[], resolved: Resolved): Agg {
  const agg: Agg = { count: rows.length, sum: {}, weighted: {} };
  for (const row of rows) {
    const asset = num(row, resolved.asset) ?? 0;
    for (const key of Object.keys(resolved) as MetricKey[]) {
      const v = num(row, resolved[key]);
      if (v === null) continue;
      agg.sum[key] = (agg.sum[key] ?? 0) + v;
      agg.weighted[key] = (agg.weighted[key] ?? 0) + v * asset;
    }
  }
  return agg;
}

function addAgg(a: Agg, b: Agg): Agg {
  const out: Agg = { count: a.count + b.count, sum: { ...a.sum }, weighted: { ...a.weighted } };
  for (const key of Object.keys(b.sum) as MetricKey[]) out.sum[key] = (out.sum[key] ?? 0) + (b.sum[key] ?? 0);
  for (const key of Object.keys(b.weighted) as MetricKey[]) out.weighted[key] = (out.weighted[key] ?? 0) + (b.weighted[key] ?? 0);
  return out;
}

// ---------------------------------------------------------------------------
// FEDFUNDS annual averages, from raw/fred/FEDFUNDS.csv or a fresh download.

async function fedFundsByYear(): Promise<Map<number, number>> {
  const path = join(RAW_DIR, 'fred', 'FEDFUNDS.csv');
  if (!existsSync(path)) {
    const r = await downloadToFile('https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS', path);
    if (!r.ok) throw new Error(`FEDFUNDS download failed: ${r.error ?? r.status}`);
  }
  const rows = parseCsv(readFileSync(path, 'utf8'));
  const header = rows[0] ?? [];
  const cDate = findColumn(header, ['DATE', 'observation_date'], 'FEDFUNDS.csv', 'date');
  const cValue = findColumn(header, ['FEDFUNDS'], 'FEDFUNDS.csv', 'value');
  const sums = new Map<number, { total: number; n: number }>();
  for (const row of rows.slice(1)) {
    const year = Number((row[cDate] ?? '').slice(0, 4));
    const v = parseNumber(row[cValue]);
    if (!year || v === null) continue;
    const s = sums.get(year) ?? { total: 0, n: 0 };
    s.total += v;
    s.n++;
    sums.set(year, s);
  }
  return new Map([...sums].map(([y, s]) => [y, s.total / s.n]));
}

// ---------------------------------------------------------------------------

function setBand(tree: CalibrationTree, path: string, band: Band): void {
  const parts = path.split('.');
  let node: CalibrationTree = tree;
  for (const p of parts.slice(0, -1)) {
    const next = node[p];
    if (!next || isBand(next)) {
      const created: CalibrationTree = {};
      node[p] = created;
      node = created;
    } else node = next;
  }
  node[parts[parts.length - 1] ?? ''] = band;
}

// Section comments carried into the generated file, keyed by path.
const COMMENTS: Record<string, string[]> = {
  chargeOffRate: ['Annual net charge-off rate by loan type, percent of average loans,', 'across a full cycle. FDIC RI-B and RC-N.'],
  roa: ['Return on average assets by asset size bucket, percent per year.'],
  nim: ['Net interest margin by size bucket, percent per year.'],
  depositBeta: ['Deposit beta: change in cost of interest-bearing deposits per change in', 'Fed funds over a hiking cycle.'],
  nieToAssets: ['Noninterest expense to average assets, percent per year.'],
  failuresPerYear: ['Bank failures per year across the cycle, count, 2000 onward.'],
  recessionIntervalYears: ['Economy. These are not FDIC bands and stay hand-entered with sources.'],
  shockOutflow: ['Deposits. Fed +400bp shock outcomes, from 2022 to 2023 experience.'],
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const years = Array.from({ length: args.to - args.from + 1 }, (_, i) => args.from + i);
  const window = `${args.from}-12-31 to ${args.to}-12-31, year-end call reports`;
  const failures: string[] = [];
  const computed: string[] = [];

  const info = await discoverFields(VINTAGE);
  const { resolved, unresolved } = resolveFields(info);
  if (!resolved.asset) throw new Error('ASSET is not among the FDIC financial fields; cannot bucket by size');
  const fields = [...new Set(['CERT', 'REPDTE', ...Object.values(resolved)])];

  log(`\nFetching year-end records ${args.from} to ${args.to} in ${BUCKETS.length} asset buckets`);
  const byYear = new Map<number, Record<BucketKey, Agg>>();
  for (const year of years) {
    const perBucket = {} as Record<BucketKey, Agg>;
    for (const bucket of BUCKETS) {
      const rows = await fetchYearBucket(year, bucket, fields);
      perBucket[bucket.key] = aggregate(rows, resolved);
    }
    byYear.set(year, perBucket);
    const total = BUCKETS.reduce((a, b) => a + (perBucket[b.key]?.count ?? 0), 0);
    log(`  ${year}: ${total} institutions (${BUCKETS.map((b) => `${b.key} ${perBucket[b.key]?.count ?? 0}`).join(', ')})`);
  }
  const allBuckets = (year: number): Agg => {
    const per = byYear.get(year);
    if (!per) throw new Error(`no data for ${year}`);
    return BUCKETS.map((b) => per[b.key]).reduce(addAgg, { count: 0, sum: {}, weighted: {} });
  };

  const current = (await import('../data/calibration')) as { calibration: CalibrationTree };
  const tree = JSON.parse(JSON.stringify(current.calibration)) as CalibrationTree;
  const source = 'FDIC BankFind financials API, year-end call reports, all insured institutions';
  const queryFor = (fieldsUsed: string[]) => `${API}/financials?filters=REPDTE:YYYY1231 AND <asset bucket>&fields=${fieldsUsed.join(',')}`;

  // Yearly ratio of two summed metrics across every institution, in percent.
  const ratioSeries = (numKey: MetricKey, denKey: MetricKey, pick: (y: number) => Agg): number[] | null => {
    if (!resolved[numKey] || !resolved[denKey]) return null;
    const out: number[] = [];
    for (const y of years) {
      const a = pick(y);
      const den = a.sum[denKey] ?? 0;
      if (den > 0) out.push(((a.sum[numKey] ?? 0) / den) * 100);
    }
    return out.length >= 3 ? out : null;
  };

  const tryBand = (path: string, unit: string, note: string, fieldsUsed: (MetricKey | undefined)[], series: number[] | null) => {
    const names = fieldsUsed.map((k) => (k ? resolved[k] : undefined));
    if (!series || names.some((n) => !n)) {
      failures.push(`${path}: needs ${fieldsUsed.filter(Boolean).join(', ')}; missing ${fieldsUsed.filter((k) => k && !resolved[k]).join(', ') || 'enough yearly values'}`);
      return;
    }
    setBand(tree, path, bandFromYearly(series, unit, source, queryFor(names as string[]), window, note));
    computed.push(`${path}: low ${round(percentileLow(series))} typical ${round(median(series))} high ${round(percentileHigh(series))} (${series.length} years)`);
  };
  const percentileLow = (s: number[]) => bandFromYearly(s, '', '', '', '', '').low;
  const percentileHigh = (s: number[]) => bandFromYearly(s, '', '', '', '', '').high;

  // Charge-off rates by loan type: yearly net charge-offs over year-end
  // balances, all institutions. Energy has no FDIC breakout and stays hand-entered.
  const ncoNote = 'Computed by scripts/calibrate.ts: yearly net charge-offs divided by year-end loan balance, all insured institutions; 5th, 50th, 95th percentile of the yearly values.';
  tryBand('chargeOffRate.ci', 'percent per year', ncoNote, ['ncoCi', 'loansCi'], ratioSeries('ncoCi', 'loansCi', allBuckets));
  tryBand('chargeOffRate.construction', 'percent per year', ncoNote, ['ncoConstruction', 'loansConstruction'], ratioSeries('ncoConstruction', 'loansConstruction', allBuckets));
  tryBand('chargeOffRate.resi', 'percent per year', ncoNote, ['ncoResi', 'loansResi'], ratioSeries('ncoResi', 'loansResi', allBuckets));
  tryBand('chargeOffRate.consumer', 'percent per year', ncoNote, ['ncoConsumer', 'loansConsumer'], ratioSeries('ncoConsumer', 'loansConsumer', allBuckets));
  tryBand('chargeOffRate.ag', 'percent per year', ncoNote, ['ncoAg', 'loansAg'], ratioSeries('ncoAg', 'loansAg', allBuckets));
  if (resolved.ncoCreOwnerOccupied && resolved.loansCreOwnerOccupied) {
    tryBand('chargeOffRate.cre_oo', 'percent per year', ncoNote, ['ncoCreOwnerOccupied', 'loansCreOwnerOccupied'], ratioSeries('ncoCreOwnerOccupied', 'loansCreOwnerOccupied', allBuckets));
  } else {
    failures.push('chargeOffRate.cre_oo: no owner-occupied nonfarm nonresidential charge-off field found; left hand-entered');
  }
  if (resolved.ncoCreOther && resolved.loansCreOther) {
    tryBand('chargeOffRate.cre_inv', 'percent per year', ncoNote, ['ncoCreOther', 'loansCreOther'], ratioSeries('ncoCreOther', 'loansCreOther', allBuckets));
  } else {
    // Investor CRE approximated by all nonfarm nonresidential plus multifamily.
    const series = (() => {
      if (!resolved.ncoCreNonfarm || !resolved.loansCreNonfarm) return null;
      const out: number[] = [];
      for (const y of years) {
        const a = allBuckets(y);
        const den = (a.sum.loansCreNonfarm ?? 0) + (a.sum.loansMultifamily ?? 0);
        if (den > 0) out.push((((a.sum.ncoCreNonfarm ?? 0) + (a.sum.ncoMultifamily ?? 0)) / den) * 100);
      }
      return out.length >= 3 ? out : null;
    })();
    tryBand(
      'chargeOffRate.cre_inv',
      'percent per year',
      ncoNote + ' Investor CRE here is all nonfarm nonresidential plus multifamily (no owner-occupied split available).',
      ['ncoCreNonfarm', 'loansCreNonfarm', 'ncoMultifamily', 'loansMultifamily'],
      series,
    );
  }

  // ROA, NIM, NIE to assets by bucket.
  for (const bucket of BUCKETS) {
    const pick = (y: number): Agg => {
      const per = byYear.get(y);
      if (!per) throw new Error(`no data for ${y}`);
      return per[bucket.key];
    };
    tryBand(
      `roa.${bucket.key}`,
      'percent per year',
      `Computed by scripts/calibrate.ts: yearly net income over year-end assets, institutions ${bucket.label}.`,
      ['netIncome', 'asset'],
      ratioSeries('netIncome', 'asset', pick),
    );
    const nimSeries = (() => {
      if (!resolved.nim || !resolved.asset) return null;
      const out: number[] = [];
      for (const y of years) {
        const a = pick(y);
        const w = a.sum.asset ?? 0;
        if (w > 0 && a.weighted.nim !== undefined) out.push(a.weighted.nim / w);
      }
      return out.length >= 3 ? out : null;
    })();
    tryBand(
      `nim.${bucket.key}`,
      'percent per year',
      `Computed by scripts/calibrate.ts: asset weighted mean of reported net interest margin, institutions ${bucket.label}.`,
      ['nim', 'asset'],
      nimSeries,
    );
    tryBand(
      `nieToAssets.${bucket.key}`,
      'percent per year',
      `Computed by scripts/calibrate.ts: yearly noninterest expense over year-end assets, institutions ${bucket.label}.`,
      ['nonintExpense', 'asset'],
      ratioSeries('nonintExpense', 'asset', pick),
    );
  }

  // Aggregate deposit beta over hiking cycles: change in the cost of
  // interest-bearing deposits divided by the change in average Fed funds.
  if (resolved.depositInterestExpense && resolved.interestBearingDeposits) {
    const ff = await fedFundsByYear();
    const cost = new Map<number, number>();
    for (const y of years) {
      const a = allBuckets(y);
      const den = a.sum.interestBearingDeposits ?? 0;
      if (den > 0) cost.set(y, ((a.sum.depositInterestExpense ?? 0) / den) * 100);
    }
    const cycles: Array<[number, number]> = [
      [2004, 2006],
      [2015, 2019],
      [2021, 2023],
    ];
    const betas: number[] = [];
    const used: string[] = [];
    for (const [a, b] of cycles) {
      const dff = (ff.get(b) ?? NaN) - (ff.get(a) ?? NaN);
      const dcost = (cost.get(b) ?? NaN) - (cost.get(a) ?? NaN);
      if (Number.isFinite(dff) && Number.isFinite(dcost) && dff > 0.5) {
        betas.push(dcost / dff);
        used.push(`${a}-${b}`);
      }
    }
    if (betas.length >= 2) {
      const sorted = [...betas].sort((x, y) => x - y);
      setBand(tree, 'depositBeta.aggregate', {
        low: round(sorted[0] ?? 0),
        high: round(sorted[sorted.length - 1] ?? 0),
        typical: round(median(betas)),
        unit: 'ratio',
        source: `${source}; FRED FEDFUNDS annual average`,
        verified: true,
        note: `Computed by scripts/calibrate.ts: (change in interest expense on deposits / interest-bearing deposits) / (change in average Fed funds) over hiking cycles ${used.join(', ')}. Per-type betas stay hand-entered.`,
        query: queryFor([resolved.depositInterestExpense, resolved.interestBearingDeposits]),
        window: used.join(', '),
        computedOn: new Date().toISOString().slice(0, 10),
      });
      computed.push(`depositBeta.aggregate: ${betas.map((b) => round(b, 3)).join(', ')} over ${used.join(', ')}`);
    } else failures.push(`depositBeta.aggregate: only ${betas.length} usable hiking cycle(s) inside ${args.from} to ${args.to}`);
  } else {
    failures.push('depositBeta.aggregate: deposit interest expense or interest-bearing deposit field not found; per-type bands stay hand-entered');
  }

  // Failures per year.
  log('\nFetching failures');
  try {
    const url = `${API}/failures?filters=${encodeURIComponent(`FAILYR:[${args.from} TO ${args.to}]`)}&fields=FAILYR&limit=10000&format=json`;
    const rows = fdicRows(await getJson(url));
    const counts = new Map<number, number>();
    for (const y of years) counts.set(y, 0);
    for (const r of rows) {
      const y = parseNumber(r.FAILYR as string | number | null | undefined);
      if (y !== null && counts.has(y)) counts.set(y, (counts.get(y) ?? 0) + 1);
    }
    const crisis = [...counts].filter(([, n]) => n >= CRISIS_FAILURES);
    const normal = [...counts].filter(([, n]) => n < CRISIS_FAILURES);
    const countBand = (entries: Array<[number, number]>, label: string): Band => {
      const values = entries.map(([, n]) => n);
      const sorted = [...values].sort((a, b) => a - b);
      return {
        low: sorted[0] ?? 0,
        high: sorted[sorted.length - 1] ?? 0,
        typical: round(median(values)),
        unit: 'banks per year',
        source: 'FDIC failures API (failed bank list)',
        verified: true,
        note: `Computed by scripts/calibrate.ts: ${label} years are ${entries.map(([y]) => y).join(', ')}; low and high are the min and max count, typical the median. A crisis year has at least ${CRISIS_FAILURES} failures.`,
        query: url,
        window: `${args.from} to ${args.to}`,
        computedOn: new Date().toISOString().slice(0, 10),
      };
    };
    if (normal.length) {
      setBand(tree, 'failuresPerYear.normal', countBand(normal, 'normal'));
      computed.push(`failuresPerYear.normal: ${normal.length} years`);
    } else failures.push('failuresPerYear.normal: no normal years found');
    if (crisis.length) {
      setBand(tree, 'failuresPerYear.crisis', countBand(crisis, 'crisis'));
      computed.push(`failuresPerYear.crisis: ${crisis.map(([y, n]) => `${y}:${n}`).join(', ')}`);
    } else failures.push(`failuresPerYear.crisis: no year with ${CRISIS_FAILURES} or more failures in the window`);
  } catch (err) {
    failures.push(`failuresPerYear: ${err instanceof Error ? err.message : String(err)}`);
  }

  log('\nComputed bands:');
  for (const c of computed) log(`  ${c}`);
  if (unresolved.length) log(`\nUnresolved FDIC fields: ${unresolved.join(', ')}`);
  if (failures.length) {
    log('\nNot computed (left hand-entered, verified: false):');
    for (const f of failures) log(`  ${f}`);
  }

  const text = renderCalibrationFile(tree, COMMENTS);
  const target = join(DATA_DIR, 'calibration.ts');
  if (args.dryRun) {
    log(`\n--dry-run: not writing ${target}`);
  } else {
    writeFileSync(target, text);
    log(`\nWrote ${target}`);
    const tsc = spawnSync('npx', ['tsc', '--noEmit'], { cwd: ROOT, encoding: 'utf8' });
    if (tsc.status !== 0) {
      log(tsc.stdout + tsc.stderr);
      throw new Error('the generated data/calibration.ts does not typecheck; see above');
    }
    log('typecheck passed');
  }
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
