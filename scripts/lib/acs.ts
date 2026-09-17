// Pure helpers for the ACS tract tables that stand in for the county API
// pull: bucket medians, the industry table's mapping to the game's sectors
// (D41), and geoid handling. No county data lives here; tests feed it
// abstract rows.

import { SECTORS, type Sector } from '../../data/types';
import { type Shares, renormalize, zeroShares } from './naics';

// ACS B19001: household income, 16 buckets after the total. Upper bounds in
// dollars; the last bucket is open ($200,000 and over).
export const INCOME_BUCKET_BOUNDS: number[] = [10_000, 15_000, 20_000, 25_000, 30_000, 35_000, 40_000, 45_000, 50_000, 60_000, 75_000, 100_000, 125_000, 150_000, 200_000, Infinity];

// ACS B25075: owner occupied home value, 26 buckets after the total; the
// last is open ($2,000,000 and over).
export const VALUE_BUCKET_BOUNDS: number[] = [
  10_000, 15_000, 20_000, 25_000, 30_000, 35_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000, 100_000, 125_000, 150_000, 175_000, 200_000, 250_000, 300_000, 400_000, 500_000, 750_000, 1_000_000, 1_500_000,
  2_000_000, Infinity,
];

// ACS B25063: gross rent for renters paying cash rent, 24 buckets from cell
// 3 to cell 26 (cell 2 is the paying-cash-rent total, cell 27 no cash rent).
export const RENT_BUCKET_BOUNDS: number[] = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 900, 1_000, 1_250, 1_500, 2_000, 2_500, 3_000, 3_500, Infinity];

// Median of a bucketed distribution by linear interpolation inside the
// bucket that holds the middle household. An open top bucket takes its
// lower bound times 1.25, the convention for a Pareto tail of that width.
// Null when the counts are empty.
export function bucketMedian(counts: number[], upperBounds: number[]): number | null {
  if (counts.length !== upperBounds.length) throw new Error(`bucketMedian: ${counts.length} counts for ${upperBounds.length} bounds`);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const half = total / 2;
  let below = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i] ?? 0;
    if (below + c >= half) {
      const lo = i === 0 ? 0 : (upperBounds[i - 1] as number);
      const hi = upperBounds[i] as number;
      if (!Number.isFinite(hi)) return Math.round(lo * 1.25);
      if (c <= 0) return Math.round(lo);
      return Math.round(lo + ((half - below) / c) * (hi - lo));
    }
    below += c;
  }
  return null;
}

// ACS C24030, sex by industry for the employed civilian population 16 and
// over. Cells 3 to 28 are the male industries, 30 to 55 the female ones in
// the same order; both are summed. The mapping to the ten game sectors is
// the D41 mapping applied to the categories the ACS publishes:
//   energy        mining, quarrying, and oil and gas extraction (NAICS 21)
//   agriculture   agriculture, forestry, fishing and hunting (11)
//   construction  construction (23) plus real estate and rental (53)
//   manufacturing manufacturing (31 to 33)
//   logistics     wholesale (42), retail (44 to 45), transportation and warehousing (48 to 49)
//   tech          information (51) plus professional, scientific and technical services (54)
//   finance       finance and insurance (52)
//   healthcare    health care and social assistance (62)
//   tourism       arts, entertainment and recreation (71) plus accommodation and food (72)
//   government    public administration (92)
//   other         utilities, management of companies, administrative and waste, educational services, other services
// The ACS does not split 54 into computer systems design and R&D the way
// QCEW does, so tech is the whole professional and technical sector here.
export const C24030_CELLS: Record<Sector, number[]> = {
  energy: [5],
  agriculture: [4],
  construction: [6, 16],
  manufacturing: [7],
  logistics: [8, 9, 11],
  tech: [13, 18],
  finance: [15],
  healthcare: [23],
  tourism: [25, 26],
  government: [28],
  other: [12, 19, 20, 22, 27],
};

export function c24030Column(cell: number): string {
  return `C24030_${String(cell).padStart(3, '0')}E`;
}

// Every column the mapping reads, male and female.
export const C24030_COLUMNS: string[] = ['C24030_001E', ...SECTORS.flatMap((s) => C24030_CELLS[s].flatMap((c) => [c24030Column(c), c24030Column(c + 27)]))];

// Sector employment from a county's summed C24030 cells. Returns the
// counts and whether they cover the table total (they should, to the person).
export function sectorsFromC24030(sums: Record<string, number>): { counts: Shares; shares: Shares; total: number; covered: number } {
  const counts = zeroShares();
  for (const s of SECTORS) {
    let x = 0;
    for (const c of C24030_CELLS[s]) x += (sums[c24030Column(c)] ?? 0) + (sums[c24030Column(c + 27)] ?? 0);
    counts[s] = x;
  }
  const total = sums['C24030_001E'] ?? 0;
  const covered = SECTORS.reduce((a, s) => a + counts[s], 0);
  return { counts, shares: renormalize(counts), total, covered };
}

// Tract geoids come as "48201100000" or "14000US48201100000"; the county is
// the first five digits either way.
export function countyOfGeoid(geoid: string): string | null {
  const m = /(\d{11})$/.exec(geoid.trim());
  if (!m) return null;
  return (m[1] as string).slice(0, 5);
}

// Sum selected numeric columns of tract rows into counties. Nulls (ACS
// suppressions come through as null in the parquet) count as zero, and a
// county whose every tract is null for a column is reported in `missing`.
export function sumTractsToCounties(rows: Iterable<Record<string, unknown>>, columns: string[]): { counties: Map<string, Record<string, number>>; missing: Map<string, Set<string>>; tracts: number } {
  const counties = new Map<string, Record<string, number>>();
  const seen = new Map<string, Set<string>>();
  let tracts = 0;
  for (const row of rows) {
    const fips = countyOfGeoid(String(row.GEOID ?? ''));
    if (!fips) continue;
    tracts++;
    let acc = counties.get(fips);
    if (!acc) {
      acc = {};
      for (const c of columns) acc[c] = 0;
      counties.set(fips, acc);
      seen.set(fips, new Set());
    }
    const has = seen.get(fips) as Set<string>;
    for (const c of columns) {
      const v = row[c];
      if (v === null || v === undefined) continue;
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) continue;
      acc[c] = (acc[c] ?? 0) + n;
      has.add(c);
    }
  }
  const missing = new Map<string, Set<string>>();
  for (const [fips, has] of seen) {
    const gone = new Set(columns.filter((c) => !has.has(c)));
    if (gone.size > 0) missing.set(fips, gone);
  }
  return { counties, missing, tracts };
}

export function shareVector(counts: number[]): number[] | null {
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  return counts.map((c) => c / sum);
}
