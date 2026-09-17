// The data contract. scripts/build-data.ts writes files that satisfy these
// types; the engine reads them. Every value is real public data per
// SYSTEMS.md Part 2. Nothing in here is authored by hand except the
// state adjacency table in scripts/build-data.ts (geography, not economy).

export const SECTORS = [
  'energy',
  'agriculture',
  'manufacturing',
  'tech',
  'finance',
  'healthcare',
  'government',
  'tourism',
  'construction',
  'logistics',
  'other',
] as const;
export type Sector = (typeof SECTORS)[number];

export interface CountyRecord {
  fips: string; // 5 digits, e.g. "48329"
  name: string; // "Midland County"
  state: string; // "TX"
  stateFips: string; // "48"
  cbsa: string | null; // CBSA code when the county is in a metro or micro area
  population: number; // Census PEP, frozen vintage
  populationGrowth5y: number; // fraction, e.g. 0.041
  medianHouseholdIncome: number; // ACS B19013
  perCapitaIncome: number | null; // ACS B19301
  incomeBuckets: number[]; // ACS B19001, 16 household shares summing to 1
  medianHomeValue: number | null; // ACS B25077
  medianRent: number | null; // ACS B25064
  housingUnits: number | null; // ACS B25002_001
  vacancyRate: number | null; // ACS B25002_003 / B25002_001
  employment: number; // QCEW annual average employment, all ownerships
  avgWeeklyWage: number; // QCEW annual average weekly wage, all ownerships
  laborForce: number | null; // LAUS
  unemploymentRate: number | null; // LAUS, percent
  gdp: number | null; // BEA CAGDP2 all industries, thousands of dollars
  hpi: number | null; // FHFA county index level, frozen vintage
  hpiChange5y: number | null; // fraction
  sectors: Record<Sector, number>; // employment shares, sum to 1 (D41)
  bankDeposits: number | null; // FDIC SOD total deposits in county, dollars
  bankOffices: number | null; // FDIC SOD offices in county
  centroid: [number, number]; // [lon, lat]
  imputed: boolean;
  imputedFields: string[];
}

export interface MetroRecord {
  cbsa: string;
  name: string; // "Midland, TX"
  principalCity: string;
  state: string; // state of the principal city
  counties: string[]; // county fips
  population: number;
  rank: number; // 1 = largest
  startable: boolean; // population > 250,000 (D39)
  hpi: number | null; // FHFA metro index
  hpiChange5y: number | null;
}

export interface StateRecord {
  fips: string;
  abbr: string;
  name: string;
  population: number;
  bankCount: number; // FDIC active institutions headquartered in the state
  totalAssets: number; // dollars
  totalDeposits: number; // dollars
  neighbors: string[]; // adjacent state abbreviations
}

// One real institution, anonymized: no name, per CLAUDE.md rule 13.
export interface BankSeed {
  state: string;
  county: string | null; // fips of the main office county
  assets: number; // dollars
  deposits: number; // dollars
  offices: number;
}

export interface NationalRecord {
  asOf: string; // ISO date of the frozen vintage
  fedFunds: number; // percent
  dgs3mo: number;
  dgs2: number;
  dgs10: number;
  dgs30: number;
  cpiYoY: number; // percent
  unemploymentRate: number; // percent
  wti: number; // dollars per barrel
  caseShillerYoY: number; // percent
  sp500: number;
}

export interface WorldData {
  counties: CountyRecord[];
  metros: MetroRecord[];
  states: StateRecord[];
  banksByState: Record<string, BankSeed[]>;
  national: NationalRecord;
}
