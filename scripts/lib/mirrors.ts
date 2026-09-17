// Loaders for the public mirrors in scripts/lib/sources.ts. Each returns the
// same shape the agency loader in scripts/build-data.ts produces, so the
// assembly does not care which one landed. Provenance for every file is in
// the source table and SYSTEMS.md Part 2.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { SECTORS, type Sector } from '../../data/types';
import { INCOME_BUCKET_BOUNDS, RENT_BUCKET_BOUNDS, VALUE_BUCKET_BOUNDS, C24030_COLUMNS, bucketMedian, sectorsFromC24030, shareVector, sumTractsToCounties } from './acs';
import { parseCsv, findColumn, padCode, parseNumber } from './csv';
import { type Shares } from './naics';
import { STATE_BY_ABBR, isStateFips } from './states';

export async function readParquet(path: string, columns?: string[]): Promise<Record<string, unknown>[]> {
  const file = await asyncBufferFromFile(path);
  return parquetReadObjects(columns ? { file, columns } : { file });
}

// ---------------------------------------------------------------------------
// JsonOfCounties: one object per county. Fields used: fips, name, state,
// longitude/latitude, population by year (Census PEP 2010 to 2019), the
// industry table (CBP 2019 employees and payroll by NAICS sector).

export interface JocCounty {
  fips: string;
  name: string; // "Harris County"
  state: string; // "TX"
  centroid: [number, number];
  population2019: number | null;
  cbpEmployees: number | null;
  cbpPayroll: number | null; // annual dollars
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, 'of').replace(/\bAnd\b/g, 'and').replace(/\bThe\b/g, 'the').replace(/\bDe\b/g, 'de').replace(/\bLa\b/g, 'La');
}

export function loadJoc(path: string): { counties: Map<string, JocCounty>; rows: number } {
  // The compilation writes Python's NaN for a missing number, which is not
  // JSON; those cells become null before parsing.
  const raw = JSON.parse(readFileSync(path, 'utf8').replace(/:\s*NaN\b/g, ': null')) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${basename(path)}: expected a JSON array of counties`);
  const counties = new Map<string, JocCounty>();
  for (const item of raw as Record<string, unknown>[]) {
    const fips = padCode(String(item.fips ?? ''), 5);
    if (!/^\d{5}$/.test(fips) || !isStateFips(fips.slice(0, 2))) continue;
    const state = String(item.state ?? '').toUpperCase();
    if (!STATE_BY_ABBR[state]) continue;
    const lon = parseNumber(item['longitude (deg)'] as number | string | null | undefined);
    const lat = parseNumber(item['latitude (deg)'] as number | string | null | undefined);
    const pop = item.population as Record<string, number> | undefined;
    const industry = item.industry as Record<string, { employees?: number | null; payroll?: number | null }> | undefined;
    let emp = 0;
    let pay = 0;
    let any = false;
    if (industry) {
      for (const v of Object.values(industry)) {
        if (typeof v?.employees === 'number' && typeof v?.payroll === 'number') {
          emp += v.employees;
          pay += v.payroll;
          any = true;
        }
      }
    }
    counties.set(fips, {
      fips,
      name: titleCase(String(item.name ?? '')),
      state,
      centroid: [lon ?? 0, lat ?? 0],
      population2019: pop && typeof pop['2019'] === 'number' ? pop['2019'] : null,
      cbpEmployees: any ? emp : null,
      cbpPayroll: any ? pay : null,
    });
  }
  return { counties, rows: raw.length };
}

// ---------------------------------------------------------------------------
// OMB delineations as parquet: the same columns as list1_2020.xls.

export interface CbsaRow {
  code: string;
  title: string;
  metropolitan: boolean;
  counties: string[];
}

export async function loadCbsaParquet(path: string): Promise<{ cbsas: Map<string, CbsaRow>; rows: number }> {
  const rows = await readParquet(path);
  const cbsas = new Map<string, CbsaRow>();
  let count = 0;
  for (const r of rows) {
    const code = String(r['CBSA Code'] ?? '').trim();
    if (!/^\d{5}$/.test(code)) continue;
    const stateFips = padCode(String(r['FIPS State Code'] ?? ''), 2);
    const countyFips = padCode(String(r['FIPS County Code'] ?? ''), 3);
    if (!/^\d{2}$/.test(stateFips) || !/^\d{3}$/.test(countyFips)) continue;
    count++;
    const c = cbsas.get(code) ?? {
      code,
      title: String(r['CBSA Title'] ?? '').trim(),
      metropolitan: /^metropolitan/i.test(String(r['Metropolitan/Micropolitan Statistical Area'] ?? '').trim()),
      counties: [],
    };
    c.counties.push(stateFips + countyFips);
    cbsas.set(code, c);
  }
  if (cbsas.size < 500) throw new Error(`${basename(path)}: only ${cbsas.size} CBSAs read; columns were ${Object.keys(rows[0] ?? {}).join(', ')}`);
  return { cbsas, rows: count };
}

// ---------------------------------------------------------------------------
// ACS tract tables summed to counties.

export interface AcsMirrorCounty {
  population: number | null;
  households: number | null;
  medianHouseholdIncome: number | null; // interpolated from B19001
  incomeBuckets: number[] | null;
  perCapitaIncome: number | null; // B19313 aggregate income over B01003 population
  medianHomeValue: number | null; // interpolated from B25075
  medianRent: number | null; // interpolated from B25063
  housingUnits: number | null;
  vacant: number | null;
  laborForce: number | null; // B23025_003, civilian
  employed: number | null; // B23025_004
  unemployed: number | null; // B23025_005
  sectorCounts: Shares | null; // C24030 employed residents by game sector
  industryTotal: number | null;
  missing: string[]; // columns with no value in any tract
}

const B19001 = Array.from({ length: 17 }, (_, i) => `B19001_${String(i + 1).padStart(3, '0')}E`);
const B25075 = Array.from({ length: 27 }, (_, i) => `B25075_${String(i + 1).padStart(3, '0')}E`);
const B25063 = Array.from({ length: 27 }, (_, i) => `B25063_${String(i + 1).padStart(3, '0')}E`);

export const ACS_MIRROR_COLUMNS = {
  x01: ['GEOID', 'B01003_001E'],
  x19: ['GEOID', ...B19001, 'B19313_001E'],
  x23: ['GEOID', 'B23025_003E', 'B23025_004E', 'B23025_005E'],
  x24: ['GEOID', ...C24030_COLUMNS],
  x25: ['GEOID', 'B25002_001E', 'B25002_003E', ...B25075, ...B25063],
};

export interface AcsMirrorPaths {
  x01: string;
  x19: string;
  x23: string;
  x24: string;
  x25: string;
}

export async function loadAcsMirror(paths: AcsMirrorPaths, log: (s: string) => void): Promise<{ counties: Map<string, AcsMirrorCounty>; incomeCounts: Map<string, number[]>; tracts: number }> {
  const load = async (path: string, columns: string[]) => {
    const rows = await readParquet(path, columns);
    const summed = sumTractsToCounties(rows, columns.filter((c) => c !== 'GEOID'));
    log(`  ${basename(path)}: ${rows.length} tracts, ${summed.counties.size} counties`);
    return summed;
  };
  const x01 = await load(paths.x01, ACS_MIRROR_COLUMNS.x01);
  const x19 = await load(paths.x19, ACS_MIRROR_COLUMNS.x19);
  const x23 = await load(paths.x23, ACS_MIRROR_COLUMNS.x23);
  const x24 = await load(paths.x24, ACS_MIRROR_COLUMNS.x24);
  const x25 = await load(paths.x25, ACS_MIRROR_COLUMNS.x25);
  const counties = new Map<string, AcsMirrorCounty>();
  const incomeCounts = new Map<string, number[]>();
  const fipsList = new Set<string>([...x01.counties.keys(), ...x19.counties.keys(), ...x23.counties.keys(), ...x24.counties.keys(), ...x25.counties.keys()]);
  for (const fips of fipsList) {
    if (!isStateFips(fips.slice(0, 2))) continue;
    const a = x01.counties.get(fips);
    const i = x19.counties.get(fips);
    const e = x23.counties.get(fips);
    const n = x24.counties.get(fips);
    const h = x25.counties.get(fips);
    const missing = new Set<string>();
    for (const m of [x01, x19, x23, x24, x25]) for (const c of m.missing.get(fips) ?? []) missing.add(c);
    const has = (m: { missing: Map<string, Set<string>> }, col: string, table: Record<string, number> | undefined) => table !== undefined && !(m.missing.get(fips)?.has(col) ?? false);
    const population = has(x01, 'B01003_001E', a) ? (a as Record<string, number>).B01003_001E ?? null : null;
    const counts = i && !B19001.slice(1).every((c) => x19.missing.get(fips)?.has(c)) ? B19001.slice(1).map((c) => i[c] ?? 0) : null;
    if (counts) incomeCounts.set(fips, counts);
    const households = i && has(x19, 'B19001_001E', i) ? i.B19001_001E ?? null : null;
    const aggregate = i && has(x19, 'B19313_001E', i) ? i.B19313_001E ?? null : null;
    const valueCounts = h && !B25075.slice(1).every((c) => x25.missing.get(fips)?.has(c)) ? B25075.slice(1).map((c) => h[c] ?? 0) : null;
    const rentCounts = h && !B25063.slice(2, 26).every((c) => x25.missing.get(fips)?.has(c)) ? B25063.slice(2, 26).map((c) => h[c] ?? 0) : null;
    let sectorCounts: Shares | null = null;
    let industryTotal: number | null = null;
    if (n && has(x24, 'C24030_001E', n)) {
      const res = sectorsFromC24030(n);
      sectorCounts = res.counts;
      industryTotal = res.total;
    }
    counties.set(fips, {
      population,
      households,
      medianHouseholdIncome: counts ? bucketMedian(counts, INCOME_BUCKET_BOUNDS) : null,
      incomeBuckets: counts ? shareVector(counts) : null,
      perCapitaIncome: aggregate !== null && population !== null && population > 0 ? Math.round(aggregate / population) : null,
      medianHomeValue: valueCounts ? bucketMedian(valueCounts, VALUE_BUCKET_BOUNDS) : null,
      medianRent: rentCounts ? bucketMedian(rentCounts, RENT_BUCKET_BOUNDS) : null,
      housingUnits: h && has(x25, 'B25002_001E', h) ? h.B25002_001E ?? null : null,
      vacant: h && has(x25, 'B25002_003E', h) ? h.B25002_003E ?? null : null,
      laborForce: e && has(x23, 'B23025_003E', e) ? e.B23025_003E ?? null : null,
      employed: e && has(x23, 'B23025_004E', e) ? e.B23025_004E ?? null : null,
      unemployed: e && has(x23, 'B23025_005E', e) ? e.B23025_005E ?? null : null,
      sectorCounts,
      industryTotal,
      missing: [...missing].sort(),
    });
  }
  return { counties, incomeCounts, tracts: x01.tracts };
}

// Prior-year population only (for the five year growth).
export async function loadAcsPopulation(path: string): Promise<Map<string, number>> {
  const rows = await readParquet(path, ACS_MIRROR_COLUMNS.x01);
  const summed = sumTractsToCounties(rows, ['B01003_001E']);
  const out = new Map<string, number>();
  for (const [fips, v] of summed.counties) if (!(summed.missing.get(fips)?.has('B01003_001E') ?? false)) out.set(fips, v.B01003_001E ?? 0);
  return out;
}

// State level values for filling a county's suppressed cell: the sum of its
// counties, medians re-derived from the summed buckets.
export function stateFromCounties(counties: Map<string, AcsMirrorCounty>, stateFips: string, raw: { incomeBuckets: Map<string, number[]> }): AcsMirrorCounty | null {
  const members = [...counties].filter(([f]) => f.slice(0, 2) === stateFips).map(([, c]) => c);
  if (members.length === 0) return null;
  const sum = (get: (c: AcsMirrorCounty) => number | null) => {
    let x = 0;
    let any = false;
    for (const c of members) {
      const v = get(c);
      if (v !== null) {
        x += v;
        any = true;
      }
    }
    return any ? x : null;
  };
  const buckets = INCOME_BUCKET_BOUNDS.map(() => 0);
  let anyBuckets = false;
  for (const [fips] of counties) {
    if (fips.slice(0, 2) !== stateFips) continue;
    const b = raw.incomeBuckets.get(fips);
    if (!b) continue;
    anyBuckets = true;
    b.forEach((v, i) => {
      buckets[i] = (buckets[i] ?? 0) + v;
    });
  }
  const population = sum((c) => c.population);
  const perCap = members.reduce((s, c) => s + (c.perCapitaIncome !== null && c.population !== null ? c.perCapitaIncome * c.population : 0), 0);
  const perCapPop = members.reduce((s, c) => s + (c.perCapitaIncome !== null && c.population !== null ? c.population : 0), 0);
  const weighted = (get: (c: AcsMirrorCounty) => number | null, w: (c: AcsMirrorCounty) => number | null) => {
    let num = 0;
    let den = 0;
    for (const c of members) {
      const v = get(c);
      const ww = w(c);
      if (v !== null && ww !== null && ww > 0) {
        num += v * ww;
        den += ww;
      }
    }
    return den > 0 ? Math.round(num / den) : null;
  };
  const sectorCounts = SECTORS.reduce(
    (acc, s) => {
      acc[s] = members.reduce((x, c) => x + (c.sectorCounts ? c.sectorCounts[s] : 0), 0);
      return acc;
    },
    {} as Record<Sector, number>,
  );
  return {
    population,
    households: sum((c) => c.households),
    medianHouseholdIncome: anyBuckets ? bucketMedian(buckets, INCOME_BUCKET_BOUNDS) : null,
    incomeBuckets: anyBuckets ? shareVector(buckets) : null,
    perCapitaIncome: perCapPop > 0 ? Math.round(perCap / perCapPop) : null,
    medianHomeValue: weighted((c) => c.medianHomeValue, (c) => c.housingUnits),
    medianRent: weighted((c) => c.medianRent, (c) => c.housingUnits),
    housingUnits: sum((c) => c.housingUnits),
    vacant: sum((c) => c.vacant),
    laborForce: sum((c) => c.laborForce),
    employed: sum((c) => c.employed),
    unemployed: sum((c) => c.unemployed),
    sectorCounts,
    industryTotal: sum((c) => c.industryTotal),
    missing: [],
  };
}

// ---------------------------------------------------------------------------
// datahub.io series as FRED-shaped observations: { date, value }.

export interface Obs {
  date: string;
  value: number | null;
}

export function loadDatahubSeries(path: string, id: string): Obs[] {
  const file = basename(path);
  const rows = parseCsv(readFileSync(path, 'utf8'));
  const header = rows[0] ?? [];
  const out: Obs[] = [];
  const push = (date: string, value: number | null) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) out.push({ date, value });
  };
  switch (id) {
    case 'DGS10': {
      const cDate = findColumn(header, ['Date'], file, 'date');
      const cRate = findColumn(header, ['Rate'], file, 'rate');
      for (const r of rows.slice(1)) push((r[cDate] ?? '').trim(), parseNumber(r[cRate]));
      break;
    }
    case 'CPIAUCSL': {
      const cDate = findColumn(header, ['Date'], file, 'date');
      const cIdx = findColumn(header, ['Index'], file, 'index');
      for (const r of rows.slice(1)) push((r[cDate] ?? '').trim(), parseNumber(r[cIdx]));
      break;
    }
    case 'DCOILWTICO': {
      const cDate = findColumn(header, ['Date'], file, 'date');
      const cPrice = findColumn(header, ['Price'], file, 'price');
      for (const r of rows.slice(1)) push((r[cDate] ?? '').trim(), parseNumber(r[cPrice]));
      break;
    }
    case 'SP500': {
      const cDate = findColumn(header, ['Date'], file, 'date');
      const cVal = findColumn(header, ['SP500'], file, 'S&P 500 level');
      for (const r of rows.slice(1)) push((r[cDate] ?? '').trim(), parseNumber(r[cVal]));
      break;
    }
    case 'CSUSHPISA': {
      const cDate = findColumn(header, ['Date'], file, 'date');
      const cVal = findColumn(header, ['National-US-SA', 'National-US'], file, 'national index');
      for (const r of rows.slice(1)) push((r[cDate] ?? '').trim(), parseNumber(r[cVal]));
      break;
    }
    case 'UNRATE': {
      // Annual averages: one observation per year, dated December 31 so the
      // as-of pick lands on the vintage year.
      const cYear = findColumn(header, ['year'], file, 'year');
      const cRate = findColumn(header, ['unemployed_percent'], file, 'unemployment rate');
      for (const r of rows.slice(1)) {
        const y = (r[cYear] ?? '').trim();
        if (/^\d{4}$/.test(y)) push(`${y}-12-31`, parseNumber(r[cRate]));
      }
      break;
    }
    default:
      throw new Error(`no datahub mirror parser for ${id}`);
  }
  if (out.length < 12) throw new Error(`${file}: only ${out.length} observations parsed for ${id}`);
  return out;
}
