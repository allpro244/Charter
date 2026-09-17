// The one place that says which year the world is frozen at and where every
// raw file comes from. scripts/fetch-data.ts downloads this table into raw/
// and scripts/build-data.ts reads the same table to find the files, so the two
// scripts cannot drift apart. URLs come from SYSTEMS.md Part 2.

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// The frozen vintage. The world starts in 2024 on this year's data. 2024 is the
// first year every source uses the same Connecticut planning regions.
export const VINTAGE = 2024;

// PEP publishes one file per decade window. The 2020-2024 file carries
// POPESTIMATE2023; the 2010-2019 file carries POPESTIMATE2018, which the
// build uses for the 5 year growth rate.
export const PEP_LATEST_YEAR = 2024;
export const PEP_PRIOR_YEAR = 2019;
export const GROWTH_YEARS = 5;

// OMB delineation files exist for 2020 and 2023 only.
export const OMB_LIST_YEAR = 2023;

// Public mirrors of the same agencies' data, for networks that refuse the
// agency hosts (SYSTEMS.md Part 2, "Alternate public mirrors"). The ACS
// mirror is frozen at the 2017 to 2021 five year release: the last one whose
// Connecticut county equivalents match the 2020 delineation file, the CBP
// vintage and the us-atlas boundaries. The prior release is for the five
// year population growth.
export const ACS_MIRROR_YEAR = 2021;
export const ACS_MIRROR_PRIOR_YEAR = 2016;
export const UCR_BUCKET = 'https://s3.amazonaws.com/spatial-ucr';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const RAW_DIR = join(ROOT, 'raw');
export const DATA_DIR = join(ROOT, 'data');
export const FIXTURES_DIR = join(DATA_DIR, 'fixtures');

// ACS variables, in the order they are requested. The API echoes them back
// as the header row of the JSON array it returns.
export const ACS_MAIN_VARS = [
  'NAME',
  'B19013_001E', // median household income, dollars
  'B19301_001E', // per capita income, dollars
  'B25077_001E', // median home value, dollars
  'B25064_001E', // median gross rent, dollars
  'B25002_001E', // housing units, total
  'B25002_003E', // housing units, vacant
  'B01003_001E', // total population (cross check only)
] as const;

// B19001_001E is the household count; _002E through _017E are the 16 income
// buckets, lowest first.
export const ACS_B19001_VARS = [
  'B19001_001E',
  ...Array.from({ length: 16 }, (_, i) => `B19001_${String(i + 2).padStart(3, '0')}E`),
] as const;

export const FRED_SERIES = [
  'FEDFUNDS',
  'DGS3MO',
  'DGS2',
  'DGS10',
  'DGS30',
  'CPIAUCSL',
  'UNRATE',
  'DCOILWTICO',
  'CSUSHPISA',
  'SP500',
] as const;

export type SourceKind =
  | 'file' // one GET streamed to disk as-is
  | 'json' // one GET whose JSON body is saved as-is
  | 'fdic'; // FDIC BankFind API, paged by offset and merged into one JSON file

export interface SourceUrl {
  url: string;
  file: string; // file name under raw/; alternates may use a different name
}

export interface Source {
  name: string; // key used in both manifests and by build-data
  kind: SourceKind;
  urls: SourceUrl[]; // tried in order
  required: boolean;
  note?: string;
  mirrorOf?: string[]; // primary source names this mirror stands in for
}

const yy = String(VINTAGE).slice(2);

function acsUrl(vars: readonly string[], level: 'county' | 'state'): string {
  return `https://api.census.gov/data/${VINTAGE}/acs/acs5?get=${vars.join(',')}&for=${level}:*`;
}

function fdicInstitutionsUrl(): string {
  const fields = 'CERT,NAME,STALP,STCNTY,COUNTY,CITY,ASSET,DEP,OFFICES,OFFDOM';
  return `https://banks.data.fdic.gov/api/institutions?filters=ACTIVE:1&fields=${fields}&limit=10000&format=json`;
}

function fdicSodUrl(): string {
  return `https://banks.data.fdic.gov/api/sod?filters=YEAR:${VINTAGE}&fields=STCNTYBR,DEPSUMBR,BRNUM,CERT&limit=10000&format=json`;
}

export const SOURCES: Source[] = [
  {
    name: 'pep',
    kind: 'file',
    required: false,
    urls: [
      {
        url: `https://www2.census.gov/programs-surveys/popest/datasets/2020-${PEP_LATEST_YEAR}/counties/totals/co-est${PEP_LATEST_YEAR}-alldata.csv`,
        file: `co-est${PEP_LATEST_YEAR}-alldata.csv`,
      },
      {
        url: `https://www2.census.gov/programs-surveys/popest/datasets/2020-${VINTAGE}/counties/totals/co-est${VINTAGE}-alldata.csv`,
        file: `co-est${VINTAGE}-alldata.csv`,
      },
    ],
    note: `Census PEP county totals. Latin-1 encoded. POPESTIMATE${VINTAGE} is the frozen population.`,
  },
  {
    name: 'pep-prior',
    kind: 'file',
    required: false,
    urls: [
      {
        url: `https://www2.census.gov/programs-surveys/popest/datasets/2010-${PEP_PRIOR_YEAR}/counties/totals/co-est${PEP_PRIOR_YEAR}-alldata.csv`,
        file: `co-est${PEP_PRIOR_YEAR}-alldata.csv`,
      },
    ],
    note: `Census PEP 2010-${PEP_PRIOR_YEAR} county totals, for POPESTIMATE${VINTAGE - GROWTH_YEARS} (5 year growth).`,
  },
  {
    name: 'acs-county',
    kind: 'json',
    required: false,
    urls: [{ url: acsUrl(ACS_MAIN_VARS, 'county'), file: `acs5_${VINTAGE}_county_main.json` }],
    note: 'ACS 5 year, county level: income, home value, rent, housing units, vacancy.',
  },
  {
    name: 'acs-county-b19001',
    kind: 'json',
    required: false,
    urls: [{ url: acsUrl(ACS_B19001_VARS, 'county'), file: `acs5_${VINTAGE}_county_b19001.json` }],
    note: 'ACS 5 year, county level: household income distribution, 16 buckets.',
  },
  {
    name: 'acs-state',
    kind: 'json',
    required: false,
    urls: [{ url: acsUrl(ACS_MAIN_VARS, 'state'), file: `acs5_${VINTAGE}_state_main.json` }],
    note: 'ACS 5 year, state level. Used only to fill suppressed county cells (CLAUDE.md rule 18).',
  },
  {
    name: 'acs-state-b19001',
    kind: 'json',
    required: false,
    urls: [{ url: acsUrl(ACS_B19001_VARS, 'state'), file: `acs5_${VINTAGE}_state_b19001.json` }],
    note: 'ACS 5 year, state level income buckets. Used only to fill suppressed county cells.',
  },
  {
    name: 'qcew',
    kind: 'file',
    required: false,
    urls: [
      {
        url: `https://data.bls.gov/cew/data/files/${VINTAGE}/csv/${VINTAGE}_annual_singlefile.zip`,
        file: `${VINTAGE}_annual_singlefile.zip`,
      },
    ],
    note: 'BLS QCEW annual averages, all areas, all industries, all ownerships. A few hundred MB; streamed.',
  },
  {
    name: 'laus',
    kind: 'file',
    required: false,
    urls: [
      { url: `https://www.bls.gov/lau/laucnty${yy}.xlsx`, file: `laucnty${yy}.xlsx` },
      { url: `https://www.bls.gov/lau/laucnty${yy}.txt`, file: `laucnty${yy}.txt` },
    ],
    note: 'BLS LAUS county annual averages: labor force and unemployment rate.',
  },
  {
    name: 'bea-gdp',
    kind: 'file',
    required: false,
    urls: [{ url: 'https://apps.bea.gov/regional/zip/CAGDP2.zip', file: 'CAGDP2.zip' }],
    note: 'BEA CAGDP2, GDP by county, all industries, thousands of current dollars. Latin-1 encoded CSV inside the zip.',
  },
  {
    name: 'fhfa-county',
    kind: 'file',
    required: false,
    urls: [
      { url: 'https://www.fhfa.gov/hpi/download/annual/hpi_at_bdl_county.csv', file: 'hpi_at_bdl_county.csv' },
      {
        url: 'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_BDL_county.csv',
        file: 'hpi_at_bdl_county.csv',
      },
    ],
    note: 'FHFA HPI, counties, developmental index, annual, not seasonally adjusted.',
  },
  {
    name: 'fhfa-cbsa',
    kind: 'file',
    required: false,
    urls: [
      { url: 'https://www.fhfa.gov/hpi/download/annual/hpi_at_bdl_cbsa.csv', file: 'hpi_at_bdl_cbsa.csv' },
      {
        url: 'https://www.fhfa.gov/DataTools/Downloads/Documents/HPI/HPI_AT_BDL_cbsa.csv',
        file: 'hpi_at_bdl_cbsa.csv',
      },
    ],
    note: 'FHFA HPI, metropolitan areas (CBSA), developmental index, annual.',
  },
  {
    name: 'omb-cbsa',
    kind: 'file',
    required: false,
    urls: [
      {
        url: `https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/${OMB_LIST_YEAR}/delineation-files/list1_${OMB_LIST_YEAR}.xls`,
        file: `list1_${OMB_LIST_YEAR}.xls`,
      },
      {
        url: 'https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2020/delineation-files/list1_2020.xls',
        file: 'list1_2020.xls',
      },
    ],
    note: 'OMB CBSA delineation file: which counties form each metro or micro area.',
  },
  {
    name: 'fdic-institutions',
    kind: 'fdic',
    required: false,
    urls: [{ url: fdicInstitutionsUrl(), file: 'fdic_institutions.json' }],
    note: 'FDIC BankFind institutions, active as of the download date. ASSET and DEP are in thousands of dollars.',
  },
  {
    name: 'fdic-sod',
    kind: 'fdic',
    required: false,
    urls: [{ url: fdicSodUrl(), file: `fdic_sod_${VINTAGE}.json` }],
    note: `FDIC Summary of Deposits, branch level, ${VINTAGE}. DEPSUMBR is in thousands of dollars. Optional: when missing, bankDeposits and bankOffices are null.`,
  },
  ...FRED_SERIES.map(
    (id): Source => ({
      name: `fred-${id}`,
      kind: 'file',
      required: false,
      urls: [{ url: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, file: `fred/${id}.csv` }],
      note: `FRED series ${id}, full history, CSV. When missing, the build uses the datahub mirror of the same series, or for the four short rates a hand band in data/calibration.ts (verified: false).`,
    }),
  ),
  {
    name: 'census-county-shapes',
    kind: 'file',
    required: false,
    urls: [
      {
        url: `https://www2.census.gov/geo/tiger/GENZ${VINTAGE}/shp/cb_${VINTAGE}_us_county_5m.zip`,
        file: `cb_${VINTAGE}_us_county_5m.zip`,
      },
    ],
    note: 'Census cartographic county boundaries, 1:5m. When missing, the build falls back to the us-atlas npm package, which is built from the same Census files.',
  },
];

// ---------------------------------------------------------------------------
// Mirrors. Each is the same public dataset republished by a third party
// with its provenance stated; the build prefers the agency file when it is
// on disk and records which one it used.

const acsMirror = (year: number, table: string, label: string, mirrorOf: string[]): Source => ({
  name: `mirror-acs-${table.toLowerCase()}-${year}`,
  kind: 'file',
  required: true,
  mirrorOf,
  urls: [
    {
      url: `${UCR_BUCKET}/census/demographic_profile/${year}/acs_${year}_${table}_tract.parquet`,
      file: `mirror/acs/acs_${year}_${table}_tract.parquet`,
    },
  ],
  note: `ACS 5 year ${year - 4} to ${year}, tract level table ${table} (${label}), Census summary file geodatabase columns, republished as parquet by the UC Riverside Center for Geospatial Sciences (open bucket spatial-ucr). Summed to counties in the build.`,
});

export const MIRROR_SOURCES: Source[] = [
  {
    name: 'mirror-counties-joc',
    kind: 'file',
    required: true,
    mirrorOf: ['qcew'],
    urls: [{ url: 'https://raw.githubusercontent.com/evangambit/JsonOfCounties/master/counties.json', file: 'mirror/counties-joc.json' }],
    note: 'County Business Patterns 2019 (Census CB1900CBP: employees and annual payroll by NAICS sector), county names and centroids from TIGER 2017, compiled per county in the public JsonOfCounties repository. Used for the average wage and as the fallback employment total.',
  },
  {
    name: 'mirror-cbsa',
    kind: 'file',
    required: true,
    mirrorOf: ['omb-cbsa'],
    urls: [{ url: `${UCR_BUCKET}/census/administrative/msa_definitions.parquet`, file: 'mirror/msa_definitions.parquet' }],
    note: 'OMB CBSA delineation list (2020 vintage columns: CBSA Code, CBSA Title, Metropolitan/Micropolitan Statistical Area, FIPS State Code, FIPS County Code), republished as parquet in the spatial-ucr bucket.',
  },
  acsMirror(ACS_MIRROR_YEAR, 'X01_AGE_AND_SEX', 'B01003 total population', ['pep']),
  acsMirror(ACS_MIRROR_PRIOR_YEAR, 'X01_AGE_AND_SEX', 'B01003 total population, five years earlier', ['pep-prior']),
  acsMirror(ACS_MIRROR_YEAR, 'X19_INCOME', 'B19001 income buckets, B19313 aggregate income', ['acs-county', 'acs-county-b19001', 'acs-state', 'acs-state-b19001']),
  acsMirror(ACS_MIRROR_YEAR, 'X23_EMPLOYMENT_STATUS', 'B23025 labor force, employed, unemployed', ['laus']),
  acsMirror(ACS_MIRROR_YEAR, 'X24_INDUSTRY_OCCUPATION', 'C24030 employed residents by industry', ['qcew']),
  acsMirror(ACS_MIRROR_YEAR, 'X25_HOUSING_CHARACTERISTICS', 'B25002 units and vacancy, B25075 value buckets, B25063 rent buckets', ['acs-county', 'acs-state']),
  ...(
    [
      ['DGS10', 'bond-yields-us-10y/main/data/monthly.csv', 'FRED DGS10 (10 year Treasury constant maturity), monthly, datahub.io core dataset bond-yields-us-10y'],
      ['CPIAUCSL', 'cpi-us/main/data/cpiai.csv', 'BLS CPI-U all items (FRED CPIAUCSL), monthly index, datahub.io core dataset cpi-us'],
      ['DCOILWTICO', 'oil-prices/main/data/wti-monthly.csv', 'EIA WTI spot (FRED DCOILWTICO), monthly, datahub.io core dataset oil-prices'],
      ['SP500', 's-and-p-500/main/data/data.csv', 'S&P 500 monthly level (Shiller data), datahub.io core dataset s-and-p-500'],
      ['CSUSHPISA', 'house-prices-us/main/data/national-month.csv', 'S&P Case-Shiller US national home price index (FRED CSUSHPISA and NSA), monthly, datahub.io core dataset house-prices-us'],
      ['UNRATE', 'employment-us/main/data/aat1.csv', 'BLS civilian unemployment rate, annual average (FRED UNRATE averaged), datahub.io core dataset employment-us'],
    ] as const
  ).map(
    ([id, path, note]): Source => ({
      name: `mirror-fred-${id}`,
      kind: 'file',
      required: true,
      mirrorOf: [`fred-${id}`],
      urls: [{ url: `https://raw.githubusercontent.com/datasets/${path}`, file: `mirror/fred/${id}.csv` }],
      note,
    }),
  ),
];

SOURCES.push(...MIRROR_SOURCES);

// A required primary whose mirror landed is satisfied.
export function mirrorsFor(name: string): Source[] {
  return SOURCES.filter((s) => s.mirrorOf?.includes(name));
}

export function sourceByName(name: string): Source {
  const s = SOURCES.find((x) => x.name === name);
  if (!s) throw new Error(`Unknown source "${name}". Known: ${SOURCES.map((x) => x.name).join(', ')}`);
  return s;
}

export function rawPath(file: string): string {
  return join(RAW_DIR, file);
}
