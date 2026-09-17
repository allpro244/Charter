// scripts/build-data.ts
//
// Turns the raw public files in raw/ into the world's day one:
//   data/counties.json        one CountyRecord per county (50 states + DC)
//   data/metros.json          one MetroRecord per CBSA, ranked by population
//   data/states.json          one StateRecord per state, with FDIC totals
//   data/banks-by-state.json  anonymized FDIC institutions by state
//   data/national.json        frozen FRED values at the vintage end
//   data/counties.geo.json    simplified GeoJSON for the browser map
//   data/manifest.json        sources, vintage, row counts, units, imputation
// Output satisfies data/types.ts. Nothing is invented: a suppressed cell is
// filled from the next level up and flagged imputed (CLAUDE.md rule 18); a
// missing record fails the build with a list of what is missing.
//
// Run:   npm run build-data                (full outputs)
//        npm run build-data -- --fixtures  (also writes data/fixtures/, the
//                                           real subset used by tests)

import * as fs from 'node:fs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import * as XLSX from 'xlsx';
import { SECTORS, type BankSeed, type CountyRecord, type MetroRecord, type NationalRecord, type Sector, type StateRecord } from '../data/types';
import {
  ACS_B19001_VARS,
  ACS_MAIN_VARS,
  DATA_DIR,
  FIXTURES_DIR,
  GROWTH_YEARS,
  PEP_LATEST_YEAR,
  PEP_PRIOR_YEAR,
  RAW_DIR,
  VINTAGE,
  rawPath,
  sourceByName,
} from './lib/sources';
import { findColumn, findColumnOrNull, normalizeHeader, padCode, parseCsv, parseCsvLine, parseNumber } from './lib/csv';
import { entryByName, readRawManifest, sha256File, type RawEntry } from './lib/manifest';
import { openZipEntry, readZipEntry } from './lib/zip';
import { STATES, STATE_BY_ABBR, STATE_BY_FIPS, STATE_NEIGHBORS, isStateFips } from './lib/states';
import { QCEW_INDUSTRY_CODES, sectorShares, type CellTable, type Shares } from './lib/naics';
import { centroid, loadCountyGeometry, serializeFeatureCollection, simplifyToBudget } from './lib/geo';

const HELP = `scripts/build-data.ts: build data/*.json from raw/ (vintage ${VINTAGE}).

Reads the files scripts/fetch-data.ts downloaded and writes counties.json,
metros.json, states.json, banks-by-state.json, national.json,
counties.geo.json and manifest.json into data/. Fails with a list when any
county lacks population, income, employment, or sector shares, when any
startable metro lacks a home price index, or when a required raw file is
missing.

Options:
  --fixtures   also write data/fixtures/: every county in five real metros
               (Midland TX, San Jose CA, Detroit MI, Washington DC, Las Vegas NV),
               their states, their bank seeds, and their geometry
  --help       this text
`;

// The ESM build of xlsx needs Node's fs handed to it; the CJS build has no
// set_fs and reads files on its own. Support both resolutions.
const xlsxSetFs = (XLSX as { set_fs?: (f: typeof fs) => void }).set_fs;
if (typeof xlsxSetFs === 'function') xlsxSetFs(fs);

const GEO_BUDGET_BYTES = 2.5 * 1024 * 1024;
const STARTABLE_POPULATION = 250_000; // D39
const AS_OF = `${VINTAGE}-12-31`;

// Fixture metros by CBSA code (OMB 2023 delineations). Selection is by code
// only; every county in each CBSA is taken.
const FIXTURE_CBSAS: Record<string, string> = {
  '33260': 'Midland, TX (energy)',
  '41940': 'San Jose-Sunnyvale-Santa Clara, CA (tech)',
  '19820': 'Detroit-Warren-Dearborn, MI (manufacturing)',
  '47900': 'Washington-Arlington-Alexandria, DC-VA-MD-WV (government)',
  '29820': 'Las Vegas-Henderson, NV (tourism)',
};

interface Args {
  fixtures: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { fixtures: false };
  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      console.log(HELP);
      process.exit(0);
    } else if (a === '--fixtures') {
      args.fixtures = true;
    } else {
      throw new Error(`Unknown argument ${a}. Try --help.`);
    }
  }
  return args;
}

function log(msg: string): void {
  console.log(msg);
}

// ---------------------------------------------------------------------------
// Raw file resolution: the manifest says which file each source landed in
// (alternates can have different names); otherwise try every listed name.

const rawManifest = readRawManifest(join(RAW_DIR, 'manifest.json'));

interface RawFile {
  path: string;
  file: string;
  entry: RawEntry | null;
}

function findRawFile(name: string): RawFile | null {
  const source = sourceByName(name);
  const entry = entryByName(rawManifest, name);
  if (entry?.ok && entry.file && existsSync(rawPath(entry.file))) {
    return { path: rawPath(entry.file), file: entry.file, entry };
  }
  for (const u of source.urls) {
    if (existsSync(rawPath(u.file))) return { path: rawPath(u.file), file: u.file, entry };
  }
  return null;
}

function requireRawFile(name: string): RawFile {
  const found = findRawFile(name);
  if (found) return found;
  const source = sourceByName(name);
  throw new Error(
    `raw file for source "${name}" is missing (looked for ${source.urls.map((u) => `raw/${u.file}`).join(', ')}). ` +
      `Run: npm run fetch-data -- --only ${name}`,
  );
}

// ---------------------------------------------------------------------------
// Census PEP. Columns used (co-estYYYY-alldata.csv, Latin-1):
//   SUMLEV        "040" state, "050" county
//   STATE         2 digit state fips
//   COUNTY        3 digit county fips
//   STNAME        state name
//   CTYNAME       county name with legal suffix, e.g. "Midland County"
//   POPESTIMATEYYYY  July 1 estimate for the year

interface PepData {
  counties: Map<string, { name: string; stateFips: string; population: number }>;
  states: Map<string, number>;
  rows: number;
}

function loadPep(path: string, year: number): PepData {
  const rows = parseCsv(readFileSync(path, 'latin1'));
  const header = rows[0] ?? [];
  const file = basename(path);
  const cSumlev = findColumn(header, ['SUMLEV'], file, 'summary level');
  const cState = findColumn(header, ['STATE'], file, 'state fips');
  const cCounty = findColumn(header, ['COUNTY'], file, 'county fips');
  const cName = findColumn(header, ['CTYNAME'], file, 'county name');
  const cPop = findColumn(header, [`POPESTIMATE${year}`], file, `population estimate for ${year}`);
  const counties = new Map<string, { name: string; stateFips: string; population: number }>();
  const states = new Map<string, number>();
  for (const row of rows.slice(1)) {
    const sumlev = padCode(row[cSumlev] ?? '', 3);
    const stateFips = padCode(row[cState] ?? '', 2);
    const pop = parseNumber(row[cPop]);
    if (pop === null) continue;
    if (sumlev === '040') states.set(stateFips, pop);
    else if (sumlev === '050') {
      const fips = stateFips + padCode(row[cCounty] ?? '', 3);
      counties.set(fips, { name: row[cName] ?? '', stateFips, population: pop });
    }
  }
  log(`  ${file}: ${counties.size} counties, ${states.size} states, POPESTIMATE${year}`);
  return { counties, states, rows: rows.length - 1 };
}

// ---------------------------------------------------------------------------
// ACS 5 year via the API. The body is a JSON array: header row, then one
// row per geography. Negative values are Census sentinels for missing
// (-666666666, -999999999, -888888888, -222222222) and become null.

type AcsRow = Record<string, number | null>;

function loadAcs(path: string, vars: readonly string[], level: 'county' | 'state'): { rows: Map<string, AcsRow>; count: number } {
  const file = basename(path);
  const json = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(json) || json.length < 2) throw new Error(`${file}: expected a JSON array with a header row and data rows`);
  const header = (json[0] as unknown[]).map(String);
  const cols = new Map<string, number>();
  for (const v of vars) {
    if (v === 'NAME') continue;
    cols.set(v, findColumn(header, [v], file, `ACS variable ${v}`));
  }
  const cState = findColumn(header, ['state'], file, 'state fips');
  const cCounty = level === 'county' ? findColumn(header, ['county'], file, 'county fips') : -1;
  const rows = new Map<string, AcsRow>();
  for (const raw of json.slice(1) as unknown[][]) {
    const stateFips = padCode(String(raw[cState] ?? ''), 2);
    const key = level === 'county' ? stateFips + padCode(String(raw[cCounty] ?? ''), 3) : stateFips;
    const out: AcsRow = {};
    for (const [v, i] of cols) {
      const n = parseNumber(raw[i] as string | number | null);
      out[v] = n === null || n < 0 ? null : n;
    }
    rows.set(key, out);
  }
  log(`  ${file}: ${rows.size} ${level} rows`);
  return { rows, count: rows.size };
}

// ---------------------------------------------------------------------------
// BLS QCEW annual singlefile, streamed line by line from inside the zip.
// Columns used:
//   area_fips            "48329" county, "48000" state, "US000" national
//   own_code             0 total, 1 federal, 2 state, 3 local, 5 private
//   industry_code        "10" all industries, else NAICS ("21", "31-33", "5415")
//   agglvl_code          10/11/14/15/16 national, 50/51/54/55/56 state,
//                        70/71/74/75/76 county: total, by ownership, NAICS
//                        sector, 3 digit, 4 digit
//   disclosure_code      "N" = suppressed (employment shows 0)
//   annual_avg_emplvl    annual average employment
//   annual_avg_wkly_wage annual average weekly wage, dollars

interface QcewArea {
  total: number | null;
  totalSuppressed: boolean;
  wage: number | null;
  cells: CellTable;
}

interface QcewData {
  counties: Map<string, QcewArea>;
  states: Map<string, QcewArea>;
  national: QcewArea;
  rows: number;
  kept: number;
}

const QCEW_LEVELS: Record<string, 'national' | 'state' | 'county'> = {
  '10': 'national', '11': 'national', '14': 'national', '15': 'national', '16': 'national',
  '50': 'state', '51': 'state', '54': 'state', '55': 'state', '56': 'state',
  '70': 'county', '71': 'county', '74': 'county', '75': 'county', '76': 'county',
};
const QCEW_CODE_SET = new Set(QCEW_INDUSTRY_CODES);

function emptyArea(): QcewArea {
  return { total: null, totalSuppressed: false, wage: null, cells: {} };
}

function stripQuotes(s: string | undefined): string {
  if (!s) return '';
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

async function loadQcew(zipPath: string): Promise<QcewData> {
  const entry = await openZipEntry(zipPath, (n) => n.toLowerCase().endsWith('.csv'));
  log(`  ${basename(zipPath)}: streaming ${entry.name}`);
  const data: QcewData = { counties: new Map(), states: new Map(), national: emptyArea(), rows: 0, kept: 0 };
  let cols: { area: number; own: number; ind: number; agg: number; disc: number; emp: number; wage: number; year: number } | null = null;
  const rl = createInterface({ input: entry.stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!cols) {
        const header = parseCsvLine(line);
        const file = entry.name;
        cols = {
          area: findColumn(header, ['area_fips'], file, 'area fips'),
          own: findColumn(header, ['own_code'], file, 'ownership code'),
          ind: findColumn(header, ['industry_code'], file, 'industry code'),
          agg: findColumn(header, ['agglvl_code'], file, 'aggregation level'),
          disc: findColumn(header, ['disclosure_code'], file, 'disclosure code'),
          emp: findColumn(header, ['annual_avg_emplvl'], file, 'annual average employment'),
          wage: findColumn(header, ['annual_avg_wkly_wage'], file, 'annual average weekly wage'),
          year: findColumn(header, ['year'], file, 'year'),
        };
        log(`  header: ${header.join(', ')}`);
        continue;
      }
      data.rows++;
      // Cheap prefilter on the aggregation level before the full parse.
      const quick = line.split(',', cols.agg + 1);
      if (!QCEW_LEVELS[stripQuotes(quick[cols.agg])]) continue;
      const row = parseCsvLine(line);
      const level = QCEW_LEVELS[row[cols.agg] ?? ''];
      if (!level) continue;
      const agg = row[cols.agg] ?? '';
      const own = row[cols.own] ?? '';
      const ind = row[cols.ind] ?? '';
      const area = row[cols.area] ?? '';
      if (data.kept === 0 && String(row[cols.year] ?? '') !== String(VINTAGE)) {
        throw new Error(`${entry.name}: first row is for year ${row[cols.year]}, expected ${VINTAGE}`);
      }
      let target: QcewArea;
      if (level === 'national') target = data.national;
      else if (level === 'state') {
        const key = area.slice(0, 2);
        target = data.states.get(key) ?? emptyArea();
        data.states.set(key, target);
      } else {
        if (area.endsWith('999') || !isStateFips(area.slice(0, 2))) continue;
        target = data.counties.get(area) ?? emptyArea();
        data.counties.set(area, target);
      }
      const suppressed = (row[cols.disc] ?? '') === 'N';
      const emp = parseNumber(row[cols.emp]) ?? 0;
      const last = agg.slice(-1);
      if (last === '0' && own === '0' && ind === '10') {
        target.total = emp;
        target.totalSuppressed = suppressed;
        target.wage = parseNumber(row[cols.wage]);
        data.kept++;
      } else if (last === '1' && (own === '1' || own === '2' || own === '3') && ind === '10') {
        target.cells[`gov:${own}`] = { emp, suppressed };
        data.kept++;
      } else if (own === '5' && QCEW_CODE_SET.has(ind)) {
        target.cells[ind] = { emp, suppressed };
        data.kept++;
      }
    }
  } finally {
    rl.close();
    entry.close();
  }
  log(`  QCEW: ${data.rows} rows read, ${data.kept} kept, ${data.counties.size} counties, ${data.states.size} states`);
  if (data.national.total === null) throw new Error('QCEW: no national total row (agglvl 10, own 0, industry 10) found');
  return data;
}

// ---------------------------------------------------------------------------
// BLS LAUS county annual averages. The xlsx has a title block, then rows:
//   A LAUS code (CN + 13 digits), B state fips, C county fips,
//   D "County Name, ST", E year, F blank, G labor force, H employed,
//   I unemployed, J unemployment rate (%). The txt alternate has the same
//   columns as whitespace separated fixed width text.

interface LausRow {
  laborForce: number | null;
  unemploymentRate: number | null;
}

function loadLaus(path: string): Map<string, LausRow> {
  const file = basename(path);
  const out = new Map<string, LausRow>();
  if (path.toLowerCase().endsWith('.xlsx') || path.toLowerCase().endsWith('.xls')) {
    const wb = XLSX.readFile(path);
    const sheetName = wb.SheetNames[0];
    const ws = sheetName ? wb.Sheets[sheetName] : undefined;
    if (!ws) throw new Error(`${file}: workbook has no sheets`);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
    // Locate the labor force and rate columns from the header block when
    // present; positions G and J otherwise.
    let lfCol = 6;
    let rateCol = 9;
    for (const row of rows.slice(0, 12)) {
      row.forEach((cell, i) => {
        const t = String(cell ?? '').trim();
        if (i < 4 || t.length > 20) return; // title rows sit in column A
        if (/labor/i.test(t)) lfCol = i;
        if (/rate/i.test(t)) rateCol = i;
      });
    }
    log(`  ${file}: labor force column ${lfCol}, rate column ${rateCol}`);
    for (const row of rows) {
      const code = String(row[0] ?? '');
      if (!/^CN\d{13}$/.test(code)) continue;
      const fips = padCode(String(row[1] ?? ''), 2) + padCode(String(row[2] ?? ''), 3);
      out.set(fips, { laborForce: parseNumber(row[lfCol] as string | number | null), unemploymentRate: parseNumber(row[rateCol] as string | number | null) });
    }
    if (out.size < 1000) {
      throw new Error(`${file}: only ${out.size} county rows recognized. First rows: ${JSON.stringify(rows.slice(0, 8))}`);
    }
  } else {
    const re = /^\s*(CN\d{13})\s+(\d{2})\s+(\d{3})\s+(.+?)\s+(\d{4})\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d.]+)\s*$/;
    for (const line of readFileSync(path, 'latin1').split('\n')) {
      const m = re.exec(line);
      if (!m) continue;
      out.set(padCode(m[2] ?? '', 2) + padCode(m[3] ?? '', 3), { laborForce: parseNumber(m[6]), unemploymentRate: parseNumber(m[9]) });
    }
    if (out.size < 1000) throw new Error(`${file}: only ${out.size} county rows matched the fixed width layout`);
  }
  log(`  ${file}: ${out.size} counties`);
  return out;
}

// ---------------------------------------------------------------------------
// BEA CAGDP2 (zip holding CAGDP2__ALL_AREAS_YYYY_YYYY.csv, Latin-1). Columns:
//   GeoFIPS      5 digit fips in quotes, sometimes padded with a space
//   LineCode     1 = All industry total
//   Unit         "Thousands of dollars"
//   <year>       one column per year

async function loadBea(zipPath: string): Promise<{ gdp: Map<string, number | null>; rows: number; unit: string; entry: string }> {
  const { name, buffer } = await readZipEntry(zipPath, (n) => /^CAGDP2__ALL_AREAS_\d{4}_\d{4}\.csv$/i.test(basename(n)));
  const rows = parseCsv(buffer.toString('latin1'));
  const header = rows[0] ?? [];
  const cFips = findColumn(header, ['GeoFIPS'], name, 'GeoFIPS');
  const cLine = findColumn(header, ['LineCode'], name, 'LineCode');
  const cUnit = findColumnOrNull(header, ['Unit']);
  const cYear = findColumn(header, [String(VINTAGE)], name, `GDP for ${VINTAGE}`);
  const gdp = new Map<string, number | null>();
  let unit = '';
  for (const row of rows.slice(1)) {
    if ((row[cLine] ?? '').trim() !== '1') continue;
    const fips = (row[cFips] ?? '').replace(/[^0-9]/g, '');
    if (fips.length !== 5 || fips.endsWith('000')) continue;
    if (!unit && cUnit >= 0) unit = (row[cUnit] ?? '').trim();
    gdp.set(fips, parseNumber(row[cYear]));
  }
  log(`  ${name}: ${gdp.size} counties, unit "${unit}"`);
  return { gdp, rows: rows.length - 1, unit, entry: name };
}

// ---------------------------------------------------------------------------
// FHFA HPI, annual developmental index. County file columns: State, County,
// FIPS code, Year, Annual Change (%), HPI, HPI with 1990 base, HPI with 2000
// base. Metro file: CBSA name, CBSA code, Year, then the same index columns.
// Missing values are ".". The code column is picked by name and then checked
// against the first data row, because FHFA renames columns between releases.

function loadFhfa(path: string, codeCandidates: string[], codeWidth: number): { series: Map<string, Map<number, number>>; rows: number } {
  const file = basename(path);
  const rows = parseCsv(readFileSync(path, 'utf8'));
  const header = rows[0] ?? [];
  const first = rows[1] ?? [];
  let cCode = -1;
  for (const cand of codeCandidates) {
    const i = findColumnOrNull(header, [cand]);
    if (i >= 0 && /^\d{3,5}$/.test((first[i] ?? '').trim())) {
      cCode = i;
      break;
    }
  }
  if (cCode < 0) {
    throw new Error(
      `${file}: no code column found. Tried ${codeCandidates.join(', ')}. Header: ${header.join(', ')}. First row: ${first.join(', ')}`,
    );
  }
  const cYear = findColumn(header, ['Year'], file, 'year');
  const cHpi = findColumn(header, ['HPI'], file, 'HPI');
  const series = new Map<string, Map<number, number>>();
  for (const row of rows.slice(1)) {
    const code = padCode((row[cCode] ?? '').trim(), codeWidth);
    const year = parseNumber(row[cYear]);
    const hpi = parseNumber(row[cHpi]);
    if (!code || year === null || hpi === null) continue;
    const s = series.get(code) ?? new Map<number, number>();
    s.set(year, hpi);
    series.set(code, s);
  }
  log(`  ${file}: ${series.size} areas, code column "${header[cCode]}"`);
  return { series, rows: rows.length - 1 };
}

function hpiAt(series: Map<string, Map<number, number>> , code: string): { hpi: number | null; change5y: number | null } {
  const s = series.get(code);
  const hpi = s?.get(VINTAGE) ?? null;
  const prior = s?.get(VINTAGE - GROWTH_YEARS) ?? null;
  return { hpi, change5y: hpi !== null && prior !== null && prior > 0 ? hpi / prior - 1 : null };
}

// ---------------------------------------------------------------------------
// OMB CBSA delineation (list1_2023.xls). Header row (after two title rows):
//   CBSA Code, Metropolitan Division Code, CSA Code, CBSA Title,
//   Metropolitan/Micropolitan Statistical Area, Metropolitan Division Title,
//   CSA Title, County/County Equivalent, State Name, FIPS State Code,
//   FIPS County Code, Central/Outlying County

interface Cbsa {
  code: string;
  title: string;
  metropolitan: boolean;
  counties: string[];
}

function loadOmb(path: string): { cbsas: Map<string, Cbsa>; rows: number } {
  const file = basename(path);
  const wb = XLSX.readFile(path);
  const sheetName = wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!ws) throw new Error(`${file}: workbook has no sheets`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
  const headerIndex = rows.findIndex((r) => r.some((c) => normalizeHeader(String(c ?? '')) === 'cbsacode'));
  if (headerIndex < 0) throw new Error(`${file}: no header row containing "CBSA Code". First rows: ${JSON.stringify(rows.slice(0, 5))}`);
  const header = (rows[headerIndex] ?? []).map((c) => String(c ?? ''));
  const cCode = findColumn(header, ['CBSA Code'], file, 'CBSA code');
  const cTitle = findColumn(header, ['CBSA Title'], file, 'CBSA title');
  const cKind = findColumn(header, ['Metropolitan/Micropolitan Statistical Area'], file, 'metro/micro flag');
  const cState = findColumn(header, ['FIPS State Code'], file, 'state fips');
  const cCounty = findColumn(header, ['FIPS County Code'], file, 'county fips');
  const cbsas = new Map<string, Cbsa>();
  let count = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const code = String(row[cCode] ?? '').trim();
    if (!/^\d{5}$/.test(code)) continue;
    const stateFips = padCode(String(row[cState] ?? ''), 2);
    const countyFips = padCode(String(row[cCounty] ?? ''), 3);
    if (!/^\d{2}$/.test(stateFips) || !/^\d{3}$/.test(countyFips)) continue;
    count++;
    const c = cbsas.get(code) ?? {
      code,
      title: String(row[cTitle] ?? '').trim(),
      metropolitan: /^metropolitan/i.test(String(row[cKind] ?? '').trim()),
      counties: [],
    };
    c.counties.push(stateFips + countyFips);
    cbsas.set(code, c);
  }
  log(`  ${file}: ${cbsas.size} CBSAs, ${count} county rows`);
  return { cbsas, rows: count };
}

// ---------------------------------------------------------------------------
// FDIC institutions (BankFind API, merged pages). Fields:
//   STALP    state postal code of the main office
//   STCNTY   state + county fips of the main office (5 digits)
//   ASSET    total assets, thousands of dollars
//   DEP      total deposits, thousands of dollars
//   OFFICES  total offices; OFFDOM domestic offices (used when present)

interface FdicFile {
  data: Record<string, unknown>[];
  total: number | null;
}

function loadFdicFile(path: string): FdicFile {
  const json = JSON.parse(readFileSync(path, 'utf8')) as { data?: unknown; total?: number | null };
  if (!Array.isArray(json.data)) throw new Error(`${basename(path)}: no data array`);
  return { data: json.data as Record<string, unknown>[], total: json.total ?? null };
}

function fdicNumber(row: Record<string, unknown>, key: string): number | null {
  return parseNumber(row[key] as string | number | null | undefined);
}

// ---------------------------------------------------------------------------
// FRED CSV: header "DATE,SERIES" (older) or "observation_date,SERIES" (newer),
// one row per observation, "." for missing.

interface Obs {
  date: string;
  value: number | null;
}

function loadFred(id: string): { series: Obs[]; file: RawFile } {
  const file = requireRawFile(`fred-${id}`);
  const rows = parseCsv(readFileSync(file.path, 'utf8'));
  const header = rows[0] ?? [];
  const cDate = findColumn(header, ['DATE', 'observation_date'], file.file, 'date');
  const cValue = findColumn(header, [id], file.file, `value (${id})`);
  const series: Obs[] = [];
  for (const row of rows.slice(1)) {
    const date = (row[cDate] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    series.push({ date, value: parseNumber(row[cValue]) });
  }
  return { series, file };
}

function latestOnOrBefore(series: Obs[], asOf: string): Obs {
  let best: Obs | null = null;
  for (const o of series) {
    if (o.date <= asOf && o.value !== null) best = o;
  }
  if (!best) throw new Error(`no observation on or before ${asOf}`);
  return best;
}

// Percent change between the latest observation on or before asOf and the
// observation twelve months earlier.
function yoyPercent(series: Obs[], asOf: string): { value: number; from: string; to: string } {
  const now = latestOnOrBefore(series, asOf);
  const yearAgo = `${Number(now.date.slice(0, 4)) - 1}${now.date.slice(4)}`;
  const then = latestOnOrBefore(series, yearAgo);
  if (then.value === null || then.value === 0 || now.value === null) throw new Error(`cannot compute 12 month change at ${asOf}`);
  return { value: (now.value / then.value - 1) * 100, from: then.date, to: now.date };
}

// ---------------------------------------------------------------------------

interface ManifestSource {
  name: string;
  file: string;
  url: string | null;
  sha256: string | null;
  fetchedOn: string | null;
  rows: number | null;
  note?: string;
}

function manifestSource(raw: RawFile, rows: number | null, note?: string): ManifestSource {
  return {
    name: raw.entry?.name ?? basename(raw.file),
    file: raw.file,
    url: raw.entry?.url ?? null,
    sha256: raw.entry?.sha256 ?? null,
    fetchedOn: raw.entry?.fetchedOn ?? null,
    rows,
    ...(note ? { note } : {}),
  };
}

function writeJson(dir: string, name: string, value: unknown, pretty: boolean): number {
  mkdirSync(dir, { recursive: true });
  const text = pretty ? JSON.stringify(value, null, 2) + '\n' : JSON.stringify(value);
  writeFileSync(join(dir, name), text);
  return Buffer.byteLength(text);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const problems: string[] = [];
  const sources: ManifestSource[] = [];
  const imputedByField = new Map<string, number>();
  const countImputed = (field: string) => imputedByField.set(field, (imputedByField.get(field) ?? 0) + 1);

  log(`build-data: vintage ${VINTAGE}, raw dir ${RAW_DIR}`);
  if (!rawManifest) log('  note: raw/manifest.json not found; locating files by name');

  // ---- load everything -----------------------------------------------------
  log('\nPopulation (Census PEP)');
  const pepFile = requireRawFile('pep');
  const pep = loadPep(pepFile.path, VINTAGE);
  sources.push(manifestSource(pepFile, pep.rows, `POPESTIMATE${VINTAGE}; file is the 2020-${PEP_LATEST_YEAR} vintage`));
  const pepPriorFile = requireRawFile('pep-prior');
  const pepPrior = loadPep(pepPriorFile.path, VINTAGE - GROWTH_YEARS);
  sources.push(manifestSource(pepPriorFile, pepPrior.rows, `POPESTIMATE${VINTAGE - GROWTH_YEARS} from the 2010-${PEP_PRIOR_YEAR} vintage, for 5 year growth`));

  log('\nIncome and housing (ACS 5 year)');
  const acsCountyFile = requireRawFile('acs-county');
  const acsCounty = loadAcs(acsCountyFile.path, ACS_MAIN_VARS, 'county');
  sources.push(manifestSource(acsCountyFile, acsCounty.count));
  const acsBucketsFile = requireRawFile('acs-county-b19001');
  const acsBuckets = loadAcs(acsBucketsFile.path, ACS_B19001_VARS, 'county');
  sources.push(manifestSource(acsBucketsFile, acsBuckets.count));
  const acsStateFile = requireRawFile('acs-state');
  const acsState = loadAcs(acsStateFile.path, ACS_MAIN_VARS, 'state');
  sources.push(manifestSource(acsStateFile, acsState.count, 'state level, used only to fill suppressed county cells'));
  const acsStateBucketsFile = requireRawFile('acs-state-b19001');
  const acsStateBuckets = loadAcs(acsStateBucketsFile.path, ACS_B19001_VARS, 'state');
  sources.push(manifestSource(acsStateBucketsFile, acsStateBuckets.count, 'state level, used only to fill suppressed county cells'));

  log('\nEmployment and wages (BLS QCEW)');
  const qcewFile = requireRawFile('qcew');
  const qcew = await loadQcew(qcewFile.path);
  sources.push(manifestSource(qcewFile, qcew.rows, `${qcew.kept} rows kept (county, state, national totals, ownership, and mapped NAICS codes)`));

  log('\nUnemployment (BLS LAUS)');
  const lausFile = requireRawFile('laus');
  const laus = loadLaus(lausFile.path);
  sources.push(manifestSource(lausFile, laus.size));

  log('\nGDP (BEA CAGDP2)');
  const beaFile = requireRawFile('bea-gdp');
  const bea = await loadBea(beaFile.path);
  sources.push(manifestSource(beaFile, bea.rows, `entry ${bea.entry}, LineCode 1 (all industry total), unit "${bea.unit}", column ${VINTAGE}`));

  log('\nHome prices (FHFA HPI)');
  const fhfaCountyFile = requireRawFile('fhfa-county');
  const fhfaCounty = loadFhfa(fhfaCountyFile.path, ['FIPS code', 'FIPS', 'County FIPS', 'GEOID', 'fips_code'], 5);
  sources.push(manifestSource(fhfaCountyFile, fhfaCounty.rows));
  const fhfaCbsaFile = findRawFile('fhfa-cbsa');
  let fhfaCbsa: Map<string, Map<number, number>> = new Map();
  if (fhfaCbsaFile) {
    const loaded = loadFhfa(fhfaCbsaFile.path, ['CBSA Code', 'CBSA', 'Code', 'MSA Code', 'Metro Code', 'cbsa_code', 'FIPS code'], 5);
    fhfaCbsa = loaded.series;
    sources.push(manifestSource(fhfaCbsaFile, loaded.rows));
  } else {
    problems.push('fhfa-cbsa raw file is missing; every startable metro will lack an HPI (run npm run fetch-data -- --only fhfa-cbsa)');
  }

  log('\nMetro definitions (OMB)');
  const ombFile = requireRawFile('omb-cbsa');
  const omb = loadOmb(ombFile.path);
  sources.push(manifestSource(ombFile, omb.rows));

  log('\nBanks (FDIC)');
  const fdicFile = requireRawFile('fdic-institutions');
  const fdic = loadFdicFile(fdicFile.path);
  log(`  ${fdicFile.file}: ${fdic.data.length} institutions`);
  sources.push(manifestSource(fdicFile, fdic.data.length, 'active institutions as of the fetch date; ASSET and DEP thousands of dollars'));
  const sodFile = findRawFile('fdic-sod');
  let sod: FdicFile | null = null;
  if (sodFile) {
    sod = loadFdicFile(sodFile.path);
    log(`  ${sodFile.file}: ${sod.data.length} branches`);
    sources.push(manifestSource(sodFile, sod.data.length, 'branch level Summary of Deposits; DEPSUMBR thousands of dollars'));
  } else {
    log('  fdic-sod not available: bankDeposits and bankOffices will be null');
  }

  log('\nNational series (FRED)');
  const fred = Object.fromEntries(
    ['FEDFUNDS', 'DGS3MO', 'DGS2', 'DGS10', 'DGS30', 'CPIAUCSL', 'UNRATE', 'DCOILWTICO', 'CSUSHPISA', 'SP500'].map((id) => [id, loadFred(id)]),
  );
  for (const [id, f] of Object.entries(fred)) sources.push(manifestSource(f.file, f.series.length, `FRED ${id}`));

  log('\nGeometry');
  const shapesFile = findRawFile('census-county-shapes');
  const geometry = await loadCountyGeometry(shapesFile?.path ?? null, join(RAW_DIR, `cb_${VINTAGE}_us_county_5m`));
  log(`  ${geometry.source}: ${geometry.features.length} county features, ${geometry.droppedTerritories} territory features dropped`);
  const featureByFips = new Map(geometry.features.map((f) => [f.properties.fips, f]));
  if (shapesFile) sources.push(manifestSource(shapesFile, geometry.features.length));
  else {
    const fallback = entryByName(rawManifest, 'us-atlas-fallback');
    sources.push({
      name: 'us-atlas-fallback',
      file: fallback?.file ?? 'node_modules/us-atlas/counties-10m.json',
      url: fallback?.url ?? 'npm:us-atlas',
      sha256: fallback?.sha256 ?? null,
      fetchedOn: fallback?.fetchedOn ?? null,
      rows: geometry.features.length,
      note: 'Census boundary zip was absent; geometry from the us-atlas npm package (built from Census cb_*_us_county_5m).',
    });
  }

  // ---- sector shares: national, then state, then county --------------------
  const nationalShares = sectorShares(qcew.national.cells, qcew.national.total ?? 0, null).shares;
  const stateShares = new Map<string, Shares>();
  for (const [stateFips, area] of qcew.states) {
    if (!isStateFips(stateFips) || area.total === null) continue;
    stateShares.set(stateFips, sectorShares(area.cells, area.total, nationalShares).shares);
  }

  // ---- SOD by county --------------------------------------------------------
  const sodByCounty = new Map<string, { deposits: number; offices: number }>();
  if (sod) {
    for (const row of sod.data) {
      const fips = padCode(String(row.STCNTYBR ?? ''), 5);
      if (!/^\d{5}$/.test(fips)) continue;
      const dep = fdicNumber(row, 'DEPSUMBR') ?? 0;
      const cur = sodByCounty.get(fips) ?? { deposits: 0, offices: 0 };
      cur.deposits += dep * 1000;
      cur.offices += 1;
      sodByCounty.set(fips, cur);
    }
  }

  // ---- county to CBSA ---------------------------------------------------------
  const cbsaByCounty = new Map<string, string>();
  for (const c of omb.cbsas.values()) for (const fips of c.counties) cbsaByCounty.set(fips, c.code);

  // ---- counties ---------------------------------------------------------------
  log('\nAssembling counties');
  const counties: CountyRecord[] = [];
  for (const [fips, p] of [...pep.counties].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!isStateFips(p.stateFips)) continue;
    const state = STATE_BY_FIPS[p.stateFips];
    if (!state) continue;
    const imputedFields: string[] = [];
    const missing: string[] = [];

    // population growth: 5 years back from the prior PEP vintage, else the state's growth
    let growth: number | null = null;
    const prior = pepPrior.counties.get(fips);
    if (prior && prior.population > 0) growth = p.population / prior.population - 1;
    else {
      const statePrior = pepPrior.states.get(p.stateFips);
      const stateNow = pep.states.get(p.stateFips);
      if (statePrior && stateNow && statePrior > 0) {
        growth = stateNow / statePrior - 1;
        imputedFields.push('populationGrowth5y');
      } else missing.push('populationGrowth5y');
    }

    // income and housing
    const acs = acsCounty.rows.get(fips);
    const acsSt = acsState.rows.get(p.stateFips);
    if (!acs) missing.push('ACS row');
    let medianHouseholdIncome = acs?.B19013_001E ?? null;
    if (medianHouseholdIncome === null && acs) {
      if (acsSt?.B19013_001E != null) {
        medianHouseholdIncome = acsSt.B19013_001E;
        imputedFields.push('medianHouseholdIncome');
      } else missing.push('medianHouseholdIncome');
    }
    const bucketsRow = acsBuckets.rows.get(fips);
    let incomeBuckets: number[] = [];
    const bucketVars = ACS_B19001_VARS.slice(1);
    const bucketsFrom = (row: AcsRow | undefined): number[] | null => {
      const total = row?.B19001_001E ?? null;
      if (!row || total === null || total <= 0) return null;
      const counts = bucketVars.map((v) => row[v] ?? 0);
      const sum = counts.reduce((a, b) => a + b, 0);
      if (sum <= 0) return null;
      return counts.map((c) => c / sum);
    };
    const own = bucketsFrom(bucketsRow);
    if (own) incomeBuckets = own;
    else {
      const st = bucketsFrom(acsStateBuckets.rows.get(p.stateFips));
      if (st) {
        incomeBuckets = st;
        imputedFields.push('incomeBuckets');
      } else missing.push('incomeBuckets');
    }
    const housingUnits = acs?.B25002_001E ?? null;
    const vacant = acs?.B25002_003E ?? null;

    // employment and sectors
    const q = qcew.counties.get(fips);
    let employment = 0;
    let avgWeeklyWage = 0;
    let sectors: Record<Sector, number> = Object.fromEntries(SECTORS.map((s) => [s, 0])) as Record<Sector, number>;
    if (!q || q.total === null || q.totalSuppressed) missing.push('employment (QCEW county total)');
    else {
      employment = q.total;
      avgWeeklyWage = q.wage ?? 0;
      if (q.wage === null) missing.push('avgWeeklyWage');
      const fallback = stateShares.get(p.stateFips) ?? nationalShares;
      const res = sectorShares(q.cells, q.total, fallback);
      sectors = res.shares;
      for (const s of res.imputed) imputedFields.push(`sectors.${s}`);
      const sum = SECTORS.reduce((a, s) => a + sectors[s], 0);
      if (Math.abs(sum - 1) > 1e-6) missing.push(`sector shares (sum ${sum})`);
    }

    // geometry
    const feature = featureByFips.get(fips);
    if (!feature) missing.push('geometry (centroid)');

    if (missing.length) {
      problems.push(`${fips} ${p.name}, ${state.abbr}: missing ${missing.join('; ')}`);
      continue;
    }
    const lausRow = laus.get(fips);
    const hp = hpiAt(fhfaCounty.series, fips);
    const sodRow = sodByCounty.get(fips);
    for (const f of imputedFields) countImputed(f);
    counties.push({
      fips,
      name: p.name,
      state: state.abbr,
      stateFips: p.stateFips,
      cbsa: cbsaByCounty.get(fips) ?? null,
      population: p.population,
      populationGrowth5y: growth ?? 0,
      medianHouseholdIncome: medianHouseholdIncome ?? 0,
      perCapitaIncome: acs?.B19301_001E ?? null,
      incomeBuckets,
      medianHomeValue: acs?.B25077_001E ?? null,
      medianRent: acs?.B25064_001E ?? null,
      housingUnits,
      vacancyRate: housingUnits !== null && housingUnits > 0 && vacant !== null ? vacant / housingUnits : null,
      employment,
      avgWeeklyWage,
      laborForce: lausRow?.laborForce ?? null,
      unemploymentRate: lausRow?.unemploymentRate ?? null,
      gdp: bea.gdp.get(fips) ?? null,
      hpi: hp.hpi,
      hpiChange5y: hp.change5y,
      sectors,
      bankDeposits: sod ? sodRow?.deposits ?? 0 : null,
      bankOffices: sod ? sodRow?.offices ?? 0 : null,
      centroid: centroid(feature!.geometry),
      imputed: imputedFields.length > 0,
      imputedFields,
    });
  }
  log(`  ${counties.length} counties assembled, ${problems.length} problem(s) so far`);
  const countyByFips = new Map(counties.map((c) => [c.fips, c]));

  // ---- metros -----------------------------------------------------------------
  log('\nAssembling metros');
  const metros: MetroRecord[] = [];
  for (const c of omb.cbsas.values()) {
    const members = c.counties.filter((f) => countyByFips.has(f));
    if (members.length === 0) continue; // Puerto Rico CBSAs
    const population = members.reduce((a, f) => a + (countyByFips.get(f)?.population ?? 0), 0);
    const [cityPart, statePart] = c.title.split(',');
    const hp = hpiAt(fhfaCbsa, c.code);
    metros.push({
      cbsa: c.code,
      name: c.title,
      principalCity: (cityPart ?? '').split('-')[0]?.trim() ?? '',
      state: (statePart ?? '').trim().split('-')[0]?.trim() ?? '',
      counties: members,
      population,
      rank: 0,
      startable: c.metropolitan && population > STARTABLE_POPULATION,
      hpi: hp.hpi,
      hpiChange5y: hp.change5y,
    });
  }
  metros.sort((a, b) => b.population - a.population || a.cbsa.localeCompare(b.cbsa));
  metros.forEach((m, i) => {
    m.rank = i + 1;
  });
  for (const m of metros) {
    if (m.startable && m.hpi === null) problems.push(`metro ${m.cbsa} ${m.name}: startable but no FHFA metro HPI for ${VINTAGE}`);
    if (!STATE_BY_ABBR[m.state]) problems.push(`metro ${m.cbsa} ${m.name}: could not read the state from the title`);
  }
  log(`  ${metros.length} metros, ${metros.filter((m) => m.startable).length} startable`);

  // ---- states and bank seeds -------------------------------------------------
  log('\nAssembling states and bank seeds');
  const banksByState: Record<string, BankSeed[]> = Object.fromEntries(STATES.map((s) => [s.abbr, [] as BankSeed[]]));
  let banksOutside = 0;
  let banksWithUnknownCounty = 0;
  for (const row of fdic.data) {
    const stalp = String(row.STALP ?? '').trim().toUpperCase();
    if (!STATE_BY_ABBR[stalp]) {
      banksOutside++;
      continue;
    }
    const rawCounty = row.STCNTY;
    let county: string | null = null;
    if (rawCounty !== null && rawCounty !== undefined && String(rawCounty).trim() !== '') {
      const code = padCode(String(rawCounty).trim(), 5);
      if (countyByFips.has(code)) county = code;
      else banksWithUnknownCounty++;
    }
    banksByState[stalp]?.push({
      state: stalp,
      county,
      assets: (fdicNumber(row, 'ASSET') ?? 0) * 1000,
      deposits: (fdicNumber(row, 'DEP') ?? 0) * 1000,
      offices: fdicNumber(row, 'OFFDOM') ?? fdicNumber(row, 'OFFICES') ?? 0,
    });
  }
  const states: StateRecord[] = STATES.map((s) => {
    const banks = banksByState[s.abbr] ?? [];
    return {
      fips: s.fips,
      abbr: s.abbr,
      name: s.name,
      population: counties.filter((c) => c.stateFips === s.fips).reduce((a, c) => a + c.population, 0),
      bankCount: banks.length,
      totalAssets: banks.reduce((a, b) => a + b.assets, 0),
      totalDeposits: banks.reduce((a, b) => a + b.deposits, 0),
      neighbors: STATE_NEIGHBORS[s.abbr] ?? [],
    };
  });
  const bankCount = Object.values(banksByState).reduce((a, b) => a + b.length, 0);
  log(`  ${bankCount} banks in the 50 states and DC, ${banksOutside} outside (territories), ${banksWithUnknownCounty} with a main office county not in counties.json`);

  // ---- national ---------------------------------------------------------------
  log('\nNational series');
  const cpi = yoyPercent(fred.CPIAUCSL!.series, AS_OF);
  const cs = yoyPercent(fred.CSUSHPISA!.series, AS_OF);
  const pick = (id: string) => latestOnOrBefore(fred[id]!.series, AS_OF);
  const national: NationalRecord = {
    asOf: AS_OF,
    fedFunds: pick('FEDFUNDS').value ?? 0,
    dgs3mo: pick('DGS3MO').value ?? 0,
    dgs2: pick('DGS2').value ?? 0,
    dgs10: pick('DGS10').value ?? 0,
    dgs30: pick('DGS30').value ?? 0,
    cpiYoY: cpi.value,
    unemploymentRate: pick('UNRATE').value ?? 0,
    wti: pick('DCOILWTICO').value ?? 0,
    caseShillerYoY: cs.value,
    sp500: pick('SP500').value ?? 0,
  };
  log(`  fed funds ${national.fedFunds} (${pick('FEDFUNDS').date}), CPI YoY ${cpi.value.toFixed(2)} (${cpi.from} to ${cpi.to}), Case-Shiller YoY ${cs.value.toFixed(2)}`);

  // ---- fail on problems -------------------------------------------------------
  if (problems.length) {
    console.error(`\nBUILD FAILED: ${problems.length} problem(s). Nothing was written.`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('\nA county is required to have population, median income, employment, and sector shares; a startable metro must have an HPI (SYSTEMS.md, Build rules).');
    process.exit(1);
  }

  // ---- geometry ---------------------------------------------------------------
  log('\nSimplifying geometry');
  const kept = geometry.features.filter((f) => countyByFips.has(f.properties.fips));
  const simplified = simplifyToBudget(kept, GEO_BUDGET_BYTES);
  log(`  ${simplified.features.length} features, ${simplified.bytes} bytes at keep ${simplified.keepFraction}`);
  const geoDropped = geometry.features.length - kept.length;

  // ---- write ------------------------------------------------------------------
  const units = {
    population: 'persons (Census PEP)',
    populationGrowth5y: `fraction, POPESTIMATE${VINTAGE} / POPESTIMATE${VINTAGE - GROWTH_YEARS} - 1`,
    medianHouseholdIncome: 'dollars (ACS B19013_001E)',
    perCapitaIncome: 'dollars (ACS B19301_001E)',
    incomeBuckets: 'shares of households in the 16 ACS B19001 buckets, sum to 1',
    medianHomeValue: 'dollars (ACS B25077_001E)',
    medianRent: 'dollars per month (ACS B25064_001E)',
    housingUnits: 'units (ACS B25002_001E)',
    vacancyRate: 'fraction, B25002_003E / B25002_001E',
    employment: 'annual average employment, all ownerships (QCEW annual_avg_emplvl)',
    avgWeeklyWage: 'dollars per week (QCEW annual_avg_wkly_wage)',
    laborForce: 'persons (LAUS)',
    unemploymentRate: 'percent (LAUS)',
    gdp: `thousands of dollars as published (BEA CAGDP2 LineCode 1, unit "${bea.unit}")`,
    hpi: 'FHFA developmental index level, not seasonally adjusted',
    hpiChange5y: `fraction, HPI ${VINTAGE} / HPI ${VINTAGE - GROWTH_YEARS} - 1`,
    sectors: 'employment shares by D41 sector, sum to 1; government from ownership codes 1, 2, 3; other is the residual',
    bankDeposits: 'dollars (FDIC SOD DEPSUMBR thousands x 1000, summed by branch county)',
    bankOffices: 'count of SOD branch records in the county',
    centroid: '[longitude, latitude] degrees, area weighted centroid of the exterior rings',
    stateTotalAssets: 'dollars (FDIC ASSET thousands x 1000)',
    stateTotalDeposits: 'dollars (FDIC DEP thousands x 1000)',
    bankSeedOffices: 'FDIC OFFDOM (domestic offices) when present, else OFFICES',
    national: 'percent for rates and 12 month changes, dollars per barrel for WTI, index level for S&P 500',
  };
  const imputedCounties = counties.filter((c) => c.imputed).length;
  const geometryInfo = {
    source: geometry.source,
    features: simplified.features.length,
    bytes: simplified.bytes,
    keepFraction: simplified.keepFraction,
    droppedTerritoryFeatures: geometry.droppedTerritories,
    droppedFeaturesWithoutCounty: geoDropped,
  };
  const manifest = {
    builtOn: new Date().toISOString(),
    vintage: VINTAGE,
    asOf: AS_OF,
    fixtures: false,
    sources,
    units,
    counts: {
      counties: counties.length,
      metros: metros.length,
      startableMetros: metros.filter((m) => m.startable).length,
      states: states.length,
      banks: bankCount,
      banksOutsideStates: banksOutside,
      banksWithUnknownCounty,
      sodBranches: sod ? sod.data.length : null,
    },
    imputed: { counties: imputedCounties, byField: Object.fromEntries([...imputedByField].sort()) },
    geometry: geometryInfo,
    national: { cpiWindow: `${cpi.from} to ${cpi.to}`, caseShillerWindow: `${cs.from} to ${cs.to}` },
  };

  log('\nWriting data/');
  const written: Array<[string, number]> = [
    ['counties.json', writeJson(DATA_DIR, 'counties.json', counties, false)],
    ['metros.json', writeJson(DATA_DIR, 'metros.json', metros, true)],
    ['states.json', writeJson(DATA_DIR, 'states.json', states, true)],
    ['banks-by-state.json', writeJson(DATA_DIR, 'banks-by-state.json', banksByState, false)],
    ['national.json', writeJson(DATA_DIR, 'national.json', national, true)],
    ['counties.geo.json', (writeFileSync(join(DATA_DIR, 'counties.geo.json'), serializeFeatureCollection(simplified.features)), simplified.bytes)],
    ['manifest.json', writeJson(DATA_DIR, 'manifest.json', manifest, true)],
  ];
  for (const [name, bytes] of written) log(`  ${name.padEnd(22)} ${bytes.toLocaleString('en-US').padStart(12)} bytes`);

  if (args.fixtures) {
    log('\nWriting data/fixtures/');
    const missingCbsas = Object.keys(FIXTURE_CBSAS).filter((code) => !metros.some((m) => m.cbsa === code));
    if (missingCbsas.length) {
      throw new Error(`fixture CBSA codes not found in the OMB file: ${missingCbsas.map((c) => `${c} (${FIXTURE_CBSAS[c]})`).join(', ')}`);
    }
    const fxMetros = metros.filter((m) => m.cbsa in FIXTURE_CBSAS);
    const fxCountyFips = new Set(fxMetros.flatMap((m) => m.counties));
    const fxCounties = counties.filter((c) => fxCountyFips.has(c.fips));
    const fxStateAbbrs = new Set(fxCounties.map((c) => c.state));
    const fxStates = states
      .filter((s) => fxStateAbbrs.has(s.abbr))
      .map((s) => ({ ...s, neighbors: s.neighbors.filter((n) => fxStateAbbrs.has(n)) }));
    const fxBanks: Record<string, BankSeed[]> = Object.fromEntries([...fxStateAbbrs].sort().map((a) => [a, banksByState[a] ?? []]));
    const fxFeatures = simplified.features.filter((f) => fxCountyFips.has(f.properties.fips));
    const fxGeo = serializeFeatureCollection(fxFeatures);
    const fxManifest = {
      ...manifest,
      fixtures: true,
      selection: {
        rule: 'every county in each of five real CBSAs, chosen by CBSA code; states are those the counties sit in; neighbors are restricted to states in the fixture',
        cbsas: FIXTURE_CBSAS,
      },
      counts: {
        counties: fxCounties.length,
        metros: fxMetros.length,
        startableMetros: fxMetros.filter((m) => m.startable).length,
        states: fxStates.length,
        banks: Object.values(fxBanks).reduce((a, b) => a + b.length, 0),
      },
      imputed: { counties: fxCounties.filter((c) => c.imputed).length, byField: countBy(fxCounties.flatMap((c) => c.imputedFields)) },
      geometry: { ...geometryInfo, features: fxFeatures.length, bytes: Buffer.byteLength(fxGeo) },
    };
    mkdirSync(FIXTURES_DIR, { recursive: true });
    const fxWritten: Array<[string, number]> = [
      ['counties.json', writeJson(FIXTURES_DIR, 'counties.json', fxCounties, true)],
      ['metros.json', writeJson(FIXTURES_DIR, 'metros.json', fxMetros, true)],
      ['states.json', writeJson(FIXTURES_DIR, 'states.json', fxStates, true)],
      ['banks-by-state.json', writeJson(FIXTURES_DIR, 'banks-by-state.json', fxBanks, false)],
      ['national.json', writeJson(FIXTURES_DIR, 'national.json', national, true)],
      ['counties.geo.json', (writeFileSync(join(FIXTURES_DIR, 'counties.geo.json'), fxGeo), Buffer.byteLength(fxGeo))],
      ['manifest.json', writeJson(FIXTURES_DIR, 'manifest.json', fxManifest, true)],
    ];
    for (const [name, bytes] of fxWritten) log(`  ${name.padEnd(22)} ${bytes.toLocaleString('en-US').padStart(12)} bytes`);
    log(`  ${fxCounties.length} counties, ${fxMetros.length} metros, ${fxStates.length} states`);
  }

  log(`\nDone. ${counties.length} counties, ${metros.length} metros, ${imputedCounties} counties with an imputed field.`);
  // Hash the outputs so the manifest can be checked against the files later.
  const hashes: Record<string, string> = {};
  for (const [name] of written) if (name !== 'manifest.json') hashes[name] = await sha256File(join(DATA_DIR, name));
  writeJson(DATA_DIR, 'manifest.json', { ...manifest, outputs: hashes }, true);
}

function countBy(items: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i] = (out[i] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
