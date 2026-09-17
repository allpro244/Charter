// World state. One plain JSON-serializable object (CLAUDE.md rule 9).
// No classes, no methods, no Dates. Save is JSON.stringify(world).

import { type Accounts, type DepositType, type IncomeStatement, emptyAccounts, emptyIS } from './ledger';
import { type Rng, derive, hashString, makeRng } from './rng';
import { mixFor, seedPools } from './credit';
import { seedLots } from './funding';
import { type BankSeed, SECTORS, type Sector, type WorldData } from '../data/types';

import { GRADES, LOAN_TYPES, type LoanType, emptyByType } from './loantypes';
export { GRADES, LOAN_TYPES, emptyByType };
export type { LoanType };

export type BankKind = 'player' | 'rival' | 'aggregate';
export type BankStatus = 'open' | 'closing' | 'failed' | 'acquired';

// Average daily balance accumulators, reset at each monthly close (rule 21).
export interface Adb {
  days: number;
  cash: number;
  securitiesAFS: number;
  securitiesHTM: number;
  loans: number;
  checking: number;
  savings: number;
  mmda: number;
  cd: number;
  brokered: number;
  fhlb: number;
  fedFundsPurchased: number;
  subDebt: number;
}

export function emptyAdb(): Adb {
  return {
    days: 0,
    cash: 0,
    securitiesAFS: 0,
    securitiesHTM: 0,
    loans: 0,
    checking: 0,
    savings: 0,
    mmda: 0,
    cd: 0,
    brokered: 0,
    fhlb: 0,
    fedFundsPurchased: 0,
    subDebt: 0,
  };
}

// Quarterly call report snapshot, kept for every bank (D15).
export interface CallReport {
  day: number;
  quarter: string; // "2024Q1"
  assets: number;
  loans: number;
  securities: number;
  deposits: number;
  equity: number;
  tier1: number;
  leverage: number; // ratio
  netIncome: number; // for the quarter
  roa: number; // annualized ratio
  nim: number; // annualized ratio
  provision: number;
  chargeOffs: number;
  ncoRate: number; // annualized ratio of average loans
  uninsuredShare: number; // ratio of deposits
  unrealizedLoss: number; // dollars on AFS plus HTM
}

export interface Bank {
  id: string;
  name: string;
  kind: BankKind;
  state: string; // "TX"
  homeCounty: string | null; // fips
  homeMetro: string | null; // cbsa
  charteredDay: number;
  status: BankStatus;
  failedDay: number | null;
  closureDay: number | null; // the Friday the FDIC arrives (D28)
  acct: Accounts;
  adb: Adb;
  is: {
    month: IncomeStatement;
    quarter: IncomeStatement;
    year: IncomeStatement;
    lastQuarter: IncomeStatement | null;
    lastYear: IncomeStatement | null;
  };
  rates: Record<DepositType, number>; // annual rate paid, e.g. 0.035
  loanYield: number; // weighted average annual rate on loans
  afsYield: number;
  htmYield: number;
  afsDuration: number; // years, for price sensitivity
  htmDuration: number;
  htmFairValue: number; // dollars, tracked off ledger (HTM is at cost)
  brokeredRate: number;
  fhlbRate: number;
  fedFundsRate: number;
  subDebtRate: number;
  overheadRate: number; // annual noninterest expense as a ratio of assets, before branches and officers
  taxLossCarryforward: number;
  shares: number; // shares outstanding
  isPublic: boolean;
  price: number | null; // per share, public banks only
  bookValueAtLastClose: number;
  reports: CallReport[];
  confidence: number; // 0 to 1, depositor confidence
  uninsuredShare: number; // ratio of deposits above the insurance limit
  dividendPayout: number; // ratio of quarterly earnings paid out (rivals set by AI, player by choice)
  dividendsPaid: number; // lifetime
  failedBankRecord: string[]; // names of banks this one absorbed
  branches: Branch[];
  // Deposit franchise in the home county: the share held when the
  // franchise was set, the share it converges to (a de novo ramps toward
  // the ceiling; a seasoned bank stays where it is), when it opened, and
  // the addressable pool when there is no geography (tests).
  franchise: { baseShare: number; targetShare: number; openedDay: number; pool: number };
  lots: Lot[]; // securities, one record per purchase
  brokeredRateOffered: number; // set when raising brokered deposits
  fhlbCapacityUsed: number; // informational, advances are acct.fhlb
  liquidityStress: number; // 0 to 1, rises when withdrawals exceed cash
  officerCandidates: Officer[]; // available hires this month
  takeover: { criticizedShare: number; seed: number } | null; // inherited book condition, used by credit
  pools: Pool[];
  loans: Loan[]; // relationship book, player's bank only (D29)
  loanMix: Record<LoanType, number>; // origination mix for pooled lending
  loansToDeposits: number; // target for pooled origination
  policy: LoanPolicy;
  dial: { maxAuto: number; minGrade: number }; // above maxAuto dollars or worse than minGrade comes to the player (D20)
  officers: Officer[];
  reviews: QuarterReview[]; // earnings reviews, player's bank only (D34)
  interestByType: Record<LoanType, number>; // quarter to date
  chargeOffsByType: Record<LoanType, number>; // quarter to date
  recoveriesByType: Record<LoanType, number>; // quarter to date
  originationsByType: Record<LoanType, number>; // year to date
  originationAppetite: number; // 1 is normal demand; CLO skill and the AI move it
  applications: { received: number; toDesk: number; autoApproved: number; autoApprovedAmount: number; autoDeclined: number; playerApproved: number; playerDeclined: number };
  losses: LossRecordState[]; // relationship book losses, quarter to date
  lifetimeChargeOffsByType: Record<LoanType, number>;
  ai: AiPolicy | null; // rivals only
  riskTilt: number; // underwriting quality: multiplies downgrade stress, 1 is average
  forSale: boolean;
  national: boolean; // present in every major metro
  represents: number; // banks represented: 1, or the count inside an aggregate
  weakQuarters: number; // consecutive quarters of losses or thin capital
  underMonths: number; // consecutive months below adequately capitalized
  holdingCompany: boolean;
  priceHistory: { day: number; price: number }[]; // public banks
  marketCapAtIpo: number | null;
  integration: { remaining: number; perQuarter: number; deposits: number; until: number }[]; // deals being absorbed
  lossShare: { balance: number; share: number; until: number } | null; // FDIC loss share on acquired assets
  lines: Lines;
  linesAssets: { msr: number; trading: number } | null; // what the lines hold in other assets
  acquiredNames: string[];
}

export type LineKey = 'mortgage' | 'cards' | 'wealth' | 'ib';

export interface Line {
  on: boolean;
  startedDay: number | null;
  // Balance sheet footprint and trailing results, dollars.
  balance: number; // MSR for mortgage, receivables for cards, AUM for wealth, trading book for ib
  ytdRevenue: number;
  ytdCost: number;
  lastYearRevenue: number;
  lastYearCost: number;
}

export type Lines = Record<LineKey, Line>;

export function emptyLines(): Lines {
  const mk = (): Line => ({ on: false, startedDay: null, balance: 0, ytdRevenue: 0, ytdCost: 0, lastYearRevenue: 0, lastYearCost: 0 });
  return { mortgage: mk(), cards: mk(), wealth: mk(), ib: mk() };
}

// Rival AI (D35): how hard a bank pushes, in four numbers.
export interface AiPolicy {
  riskAppetite: number; // 0 to 1: loans to deposits, criticized share, growth
  growthTarget: number; // annual loan growth sought
  rateAggression: number; // -1 to 1: rate sheet against the market
  acquisitive: number; // 0 to 1: bids on failed banks and whole banks
  branchPush: number; // 0 to 1: opens branches against the player
}

export interface LossRecordState {
  day: number;
  loanId: string;
  borrower: string;
  type: LoanType;
  amount: number;
  decidedBy: string;
  decidedOn: number;
  signal: string;
}

// A pool: many loans of one type and vintage as one record (D29).
export interface Pool {
  type: LoanType;
  vintage: number; // year
  count: number;
  balance: number;
  grades: number[]; // GRADES balances by grade, sum = balance
  rate: number; // weighted annual coupon
  origBalance: number;
  cumLoss: number;
  termMonths: number;
  ageMonths: number;
}

export type LoanStatus = 'current' | 'late30' | 'late60' | 'late90' | 'nonaccrual' | 'workout' | 'reo' | 'paid' | 'chargedOff';

export interface Memo {
  purpose: string;
  amount: number;
  termMonths: number;
  rate: number; // requested
  dscr: number; // debt service coverage (businesses) or inverse of DTI for households
  ltv: number;
  leverage: number; // debt to EBITDA for businesses, debt to income for households
  guarantor: boolean;
  collateralType: string;
  collateralValue: number;
  paymentHistory: 'clean' | 'minor' | 'poor' | 'none';
  tenureYears: number;
  sector: Sector;
  income: number; // revenue or household income
  netWorth: number;
  employees: number;
  summary: string; // CCO summary, quality by skill
  redFlags: string[]; // what the CCO caught
  suggestedGrade: number;
}

export interface Loan {
  id: string;
  type: LoanType;
  county: string;
  borrower: string;
  memo: Memo;
  originated: number; // day
  principal: number;
  balance: number;
  rate: number;
  termMonths: number;
  paymentDay: number; // 1 to 28
  payment: number; // monthly P and I
  grade: number;
  status: LoanStatus;
  monthsLate: number;
  accrued: number; // interest accrued and unpaid, part of interestReceivable
  truePd: number; // annual, hidden from the desk
  trueLgd: number;
  hidden: number; // the small hidden term (D32)
  decision: { by: 'player' | 'auto' | 'inherited'; day: number; countered: boolean; note: string };
  attribution: string | null; // set on default
  lossToDate: number;
  reoValue: number;
  signals: { field: string; contribution: number; text: string }[]; // visible score at approval
}

export interface LoanPolicy {
  maxLtv: Record<LoanType, number>;
  minDscr: number;
  maxLeverage: number;
  requireGuarantor: boolean;
  maxSize: number; // dollars, single loan
  allowed: Record<LoanType, boolean>;
  sectorCap: number; // share of loans in one sector
  version: number;
}

export type OfficerRole = 'cco' | 'cfo' | 'clo' | 'coo';

export interface Officer {
  id: string;
  role: OfficerRole;
  name: string;
  skill: number; // 0 to 100
  salary: number; // annual
  hiredDay: number;
  loyalty: number; // 0 to 1
}

export interface QuarterReview {
  quarter: string;
  day: number;
  netIncome: number;
  interestByBook: { book: string; amount: number }[];
  depositCostByType: { type: string; amount: number }[];
  otherInterestExpense: number;
  otherInterestIncome: number;
  lossesByLoan: { loan: string; type: LoanType; amount: number; decidedBy: string; decidedOn: number; signal: string }[];
  lossesByPool: { type: LoanType; amount: number }[];
  recoveries: number;
  provision: number;
  feeIncome: number;
  securitiesGains: number;
  overhead: { salaries: number; occupancy: number; other: number; assessment: number };
  tax: number;
  ledgerNetIncome: number; // must equal netIncome
}

export function defaultPolicy(): LoanPolicy {
  return {
    maxLtv: { ci: 0.8, cre_oo: 0.8, cre_inv: 0.75, construction: 0.8, resi: 0.9, consumer: 1.0, ag: 0.7, energy: 0.65, cards: 1.0 },
    minDscr: 1.2,
    maxLeverage: 4,
    requireGuarantor: false,
    maxSize: 5_000_000,
    allowed: { ci: true, cre_oo: true, cre_inv: true, construction: true, resi: true, consumer: true, ag: true, energy: true, cards: false },
    sectorCap: 0.35,
    version: 1,
  };
}

export interface Branch {
  id: string;
  county: string; // fips
  openedDay: number;
  deposits: number; // core deposits attributed to this branch
  fixedCost: number; // annual, dollars
  distanceKm: number; // from the home county
  competitiveTarget: number | null; // set monthly by county competition
}

export type LotKind = 'afs' | 'htm';
export type Product = 'treasury' | 'agency' | 'mbs';

export interface Lot {
  id: string;
  kind: LotKind;
  product: Product;
  cost: number; // amortized cost, dollars
  coupon: number; // annual
  duration: number; // years
  purchasedDay: number;
  fair: number; // last mark, dollars
}

export interface PlayerRecord {
  bankId: string;
  bankName: string;
  from: number;
  to: number | null;
  outcome: 'running' | 'failed' | 'sold';
}

export interface Player {
  cash: number;
  shares: number; // shares held in the current bank
  bankId: string | null;
  salary: number; // annual, dollars
  taxRate: number; // flat, on salary, dividends, and stock sale proceeds
  dividendsReceived: number; // after tax
  dividendsGross: number; // before tax, pro rata share of what the bank paid
  salaryReceived: number;
  stockSaleProceeds: number;
  invested: number; // dollars put into banks over the run
  record: PlayerRecord[];
  netWorthHistory: { day: number; value: number }[];
}

export type Regime = 'expansion' | 'late' | 'recession' | 'recovery';

export interface Economy {
  month: number; // months since 2024-01
  regime: Regime;
  regimeMonths: number;
  crisis: boolean; // this recession is a banking crisis
  monthsSinceRecession: number;
  fedFunds: number; // ratio, e.g. 0.0533
  curve: { m3: number; y2: number; y10: number; y30: number };
  gdpGrowth: number; // annualized ratio
  unemployment: number; // ratio
  inflation: number; // annualized ratio
  hpi: number; // index, 100 at start
  hpiGrowth: number; // last 12 months, ratio
  oil: number; // dollars per barrel
  sp500: number;
  sectors: Record<Sector, number>; // index levels, 100 at start
  sectorMomentum: Record<Sector, number>; // last month log change
  recessions: { startMonth: number; endMonth: number | null; crisis: boolean }[];
  fedPath: number[]; // last 24 months of fed funds
  nationalMomentum: number; // employment-weighted sector move last month
  oilPrev: number | null;
  hpiPrev: number | null;
  hist: EconomySnapshot[]; // last 13 month ends, oldest first
}

export interface EconomySnapshot {
  month: number;
  sectors: Record<Sector, number>;
  hpi: number;
  unemployment: number;
  oil: number;
}

export interface CountyState {
  fips: string;
  name: string;
  state: string;
  cbsa: string | null;
  population: number;
  income: number; // median household income
  perCapitaIncome: number | null;
  incomeBuckets: number[];
  wage: number; // average weekly wage
  employment: number;
  unemployment: number | null;
  homeValue: number | null;
  rent: number | null;
  sectors: Record<Sector, number>;
  centroid: [number, number];
  depositPool: number; // dollars of deposits the county supports
  condition: number; // local index, 100 at start
  localHpi: number; // 100 at start
  imputed: boolean;
}

export interface MetroState {
  cbsa: string;
  name: string;
  principalCity: string;
  state: string;
  counties: string[];
  population: number;
  rank: number;
  startable: boolean;
}

export interface StateState {
  abbr: string;
  name: string;
  fips: string;
  population: number;
  bankCount: number;
  totalAssets: number;
  totalDeposits: number;
  neighbors: string[];
  expanded: boolean; // individual banks simulated (D42)
}

export interface Geo {
  counties: Record<string, CountyState>;
  metros: Record<string, MetroState>;
  states: Record<string, StateState>;
  nationalShares: Record<Sector, number> | null; // employment-weighted sector mix
}

export type FeedSource = 'borrower' | 'depositor' | 'rival' | 'officer' | 'regulator' | 'market' | 'system';

export interface FeedItem {
  id: string;
  day: number;
  source: FeedSource;
  text: string;
  severity: 'info' | 'alert' | 'good';
  bankId: string | null;
  ref: { kind: string; id: string } | null;
}

export type PendingKind =
  | 'start'
  | 'failure'
  | 'loan_application'
  | 'loan_batch'
  | 'exception_request'
  | 'rate_prompt'
  | 'exam_result'
  | 'enforcement'
  | 'acquisition_offer'
  | 'competing_bid'
  | 'officer_event'
  | 'capital_raise'
  | 'ipo_window'
  | 'assisted_auction';

export interface PendingOption {
  key: string; // the keyboard key
  label: string;
}

export interface Pending {
  id: string;
  day: number;
  kind: PendingKind;
  expires: number | null; // day after which the item resolves itself (auctions close Monday)
  bankId: string | null;
  title: string;
  lines: string[]; // the body, one line each, terminal style
  options: PendingOption[];
  data: Record<string, unknown>;
}

export interface Decision {
  pendingId: string;
  choice: string; // an option key
  params?: Record<string, unknown>;
}

export interface Milestone {
  day: number;
  text: string;
}

export interface World {
  version: 1;
  seed: number;
  rng: Rng;
  day: number;
  economy: Economy;
  geo: Geo;
  banks: Record<string, Bank>;
  bankOrder: string[];
  playerBankId: string | null;
  player: Player;
  feed: FeedItem[];
  pending: Pending[];
  nextId: number;
  milestones: Milestone[];
  dataVintage: string | null;
  bankSeeds: Record<string, BankSeed[]>; // real institution sizes by state, anonymized
  failures: { day: number; state: string; assets: number; name: string }[]; // every failure in the world
  deals: DealRecord[]; // closed deals, for the record
}

export interface DealRecord {
  day: number;
  kind: 'assisted' | 'whole' | 'rival';
  buyer: string;
  target: string;
  assets: number;
  price: number;
  priceToBook: number | null;
  regime: Regime;
}

export const FEED_CAP = 2000;
export const INSURANCE_LIMIT = 250_000;

export function nextId(world: World, prefix: string): string {
  world.nextId += 1;
  return `${prefix}${world.nextId}`;
}

export function emptySectors(value: number): Record<Sector, number> {
  return {
    energy: value,
    agriculture: value,
    manufacturing: value,
    tech: value,
    finance: value,
    healthcare: value,
    government: value,
    tourism: value,
    construction: value,
    logistics: value,
    other: value,
  };
}

export function initialEconomy(data: WorldData | null): Economy {
  const n = data?.national;
  const pct = (x: number | undefined, fallback: number) => (x === undefined ? fallback : x / 100);
  // Fallbacks are only used by data-free tests (empty worlds). The real game
  // always starts from data/national.json.
  const fedFunds = pct(n?.fedFunds, 0.0533);
  return {
    month: 0,
    regime: 'late',
    regimeMonths: 0,
    crisis: false,
    monthsSinceRecession: 48,
    fedFunds,
    curve: {
      m3: pct(n?.dgs3mo, 0.054),
      y2: pct(n?.dgs2, 0.0425),
      y10: pct(n?.dgs10, 0.0388),
      y30: pct(n?.dgs30, 0.0403),
    },
    gdpGrowth: 0.025,
    unemployment: pct(n?.unemploymentRate, 0.037),
    inflation: pct(n?.cpiYoY, 0.034),
    hpi: 100,
    hpiGrowth: pct(n?.caseShillerYoY, 0.055),
    oil: n?.wti ?? 72,
    sp500: n?.sp500 ?? 4770,
    sectors: emptySectors(100),
    sectorMomentum: emptySectors(0),
    recessions: [],
    fedPath: [],
    nationalMomentum: 0,
    oilPrev: null,
    hpiPrev: null,
    hist: [],
  };
}

export function buildGeo(data: WorldData | null): Geo {
  const geo: Geo = { counties: {}, metros: {}, states: {}, nationalShares: null };
  if (!data) return geo;
  for (const c of data.counties) {
    geo.counties[c.fips] = {
      fips: c.fips,
      name: c.name,
      state: c.state,
      cbsa: c.cbsa,
      population: c.population,
      income: c.medianHouseholdIncome,
      perCapitaIncome: c.perCapitaIncome,
      incomeBuckets: c.incomeBuckets,
      wage: c.avgWeeklyWage,
      employment: c.employment,
      unemployment: c.unemploymentRate === null ? null : c.unemploymentRate / 100,
      homeValue: c.medianHomeValue,
      rent: c.medianRent,
      sectors: c.sectors,
      centroid: c.centroid,
      // County deposit pool: real FDIC Summary of Deposits total when present,
      // otherwise population times a per-capita figure scaled by income. The
      // scaled figure is aggregation of the state total, not invention: it
      // distributes the state's real FDIC deposits by population and income.
      depositPool: c.bankDeposits ?? 0,
      condition: 100,
      localHpi: 100,
      imputed: c.imputed,
    };
  }
  // National employment-weighted sector mix.
  const shares = emptySectors(0);
  let totalEmp = 0;
  for (const c of data.counties) {
    for (const s of SECTORS) shares[s] += (c.sectors[s] ?? 0) * c.employment;
    totalEmp += c.employment;
  }
  if (totalEmp > 0) for (const s of SECTORS) shares[s] /= totalEmp;
  geo.nationalShares = totalEmp > 0 ? shares : null;
  for (const m of data.metros) {
    geo.metros[m.cbsa] = {
      cbsa: m.cbsa,
      name: m.name,
      principalCity: m.principalCity,
      state: m.state,
      counties: m.counties,
      population: m.population,
      rank: m.rank,
      startable: m.startable,
    };
  }
  for (const s of data.states) {
    geo.states[s.abbr] = {
      abbr: s.abbr,
      name: s.name,
      fips: s.fips,
      population: s.population,
      bankCount: s.bankCount,
      totalAssets: s.totalAssets,
      totalDeposits: s.totalDeposits,
      neighbors: s.neighbors,
      expanded: false,
    };
  }
  // Counties without a Summary of Deposits figure get their share of the
  // state's real deposit total by population weighted by income.
  const byState: Record<string, CountyState[]> = {};
  for (const c of Object.values(geo.counties)) (byState[c.state] ??= []).push(c);
  for (const [abbr, counties] of Object.entries(byState)) {
    const st = geo.states[abbr];
    if (!st) continue;
    const known = counties.reduce((s, c) => s + (c.depositPool > 0 ? c.depositPool : 0), 0);
    const missing = counties.filter((c) => c.depositPool === 0);
    if (missing.length === 0) continue;
    const remaining = Math.max(0, st.totalDeposits - known);
    const weight = (c: CountyState) => c.population * Math.max(1, c.income);
    const totalWeight = missing.reduce((s, c) => s + weight(c), 0);
    for (const c of missing) c.depositPool = totalWeight > 0 ? Math.round((remaining * weight(c)) / totalWeight) : 0;
  }
  return geo;
}

export function createWorld(seed: number, data: WorldData | null = null): World {
  return {
    version: 1,
    seed,
    rng: makeRng(seed),
    day: 0,
    economy: initialEconomy(data),
    geo: buildGeo(data),
    banks: {},
    bankOrder: [],
    playerBankId: null,
    player: {
      cash: 0,
      shares: 0,
      bankId: null,
      salary: 0,
      taxRate: 0.3,
      dividendsReceived: 0,
      dividendsGross: 0,
      salaryReceived: 0,
      stockSaleProceeds: 0,
      invested: 0,
      record: [],
      netWorthHistory: [],
    },
    feed: [],
    pending: [],
    nextId: 0,
    milestones: [],
    dataVintage: data?.national.asOf ?? null,
    bankSeeds: data?.banksByState ?? {},
    failures: [],
    deals: [],
  };
}

export interface BankSpec {
  name: string;
  kind: BankKind;
  state: string;
  homeCounty?: string | null;
  homeMetro?: string | null;
  capital: number; // paid-in equity
  deposits?: Partial<Record<DepositType, number>>;
  loans?: number;
  securitiesAFS?: number;
  securitiesHTM?: number;
  shares?: number;
  criticized?: number; // share of loans graded 6 or worse at creation
}

export function createBank(world: World, spec: BankSpec): Bank {
  const acct = emptyAccounts();
  const deposits = spec.deposits ?? {};
  acct.checking = deposits.checking ?? 0;
  acct.savings = deposits.savings ?? 0;
  acct.mmda = deposits.mmda ?? 0;
  acct.cd = deposits.cd ?? 0;
  acct.loans = spec.loans ?? 0;
  acct.securitiesAFS = spec.securitiesAFS ?? 0;
  acct.securitiesHTM = spec.securitiesHTM ?? 0;
  acct.commonStock = spec.capital;
  // Cash is the plug: whatever funding is not deployed.
  acct.cash =
    acct.checking + acct.savings + acct.mmda + acct.cd + acct.commonStock - acct.loans - acct.securitiesAFS - acct.securitiesHTM;
  if (acct.cash < 0) throw new Error(`bank ${spec.name}: assets exceed funding by ${-acct.cash}`);
  const ff = world.economy.fedFunds;
  const bank: Bank = {
    id: nextId(world, 'b'),
    name: spec.name,
    kind: spec.kind,
    state: spec.state,
    homeCounty: spec.homeCounty ?? null,
    homeMetro: spec.homeMetro ?? null,
    charteredDay: world.day,
    status: 'open',
    failedDay: null,
    closureDay: null,
    acct,
    adb: emptyAdb(),
    is: { month: emptyIS(), quarter: emptyIS(), year: emptyIS(), lastQuarter: null, lastYear: null },
    rates: {
      checking: 0,
      savings: Math.max(0, ff * 0.2),
      mmda: Math.max(0, ff * 0.45),
      cd: Math.max(0, ff * 0.75),
    },
    loanYield: ff + 0.025,
    afsYield: Math.max(0.005, world.economy.curve.y2 - 0.001),
    htmYield: Math.max(0.005, world.economy.curve.y10 - 0.001),
    afsDuration: 2.5,
    htmDuration: 6,
    htmFairValue: acct.securitiesHTM,
    brokeredRate: ff + 0.002,
    fhlbRate: ff + 0.003,
    fedFundsRate: ff + 0.001,
    subDebtRate: ff + 0.03,
    overheadRate: 0.025,
    taxLossCarryforward: 0,
    shares: spec.shares ?? Math.max(1, Math.round(spec.capital / 10)),
    isPublic: false,
    price: null,
    bookValueAtLastClose: spec.capital,
    reports: [],
    confidence: 1,
    uninsuredShare: 0.3,
    dividendPayout: 0.3,
    dividendsPaid: 0,
    failedBankRecord: [],
    branches: [],
    franchise: { baseShare: 0, targetShare: 0, openedDay: world.day, pool: 0 },
    lots: [],
    brokeredRateOffered: 0,
    fhlbCapacityUsed: 0,
    liquidityStress: 0,
    officerCandidates: [],
    takeover: null,
    pools: [],
    loans: [],
    loanMix: emptyByType(0),
    loansToDeposits: 0.8,
    policy: defaultPolicy(),
    dial: { maxAuto: 250_000, minGrade: 5 },
    officers: [],
    reviews: [],
    interestByType: emptyByType(0),
    chargeOffsByType: emptyByType(0),
    recoveriesByType: emptyByType(0),
    originationsByType: emptyByType(0),
    originationAppetite: 1,
    applications: { received: 0, toDesk: 0, autoApproved: 0, autoApprovedAmount: 0, autoDeclined: 0, playerApproved: 0, playerDeclined: 0 },
    losses: [],
    lifetimeChargeOffsByType: emptyByType(0),
    ai: null,
    riskTilt: 1,
    forSale: false,
    national: false,
    represents: 1,
    weakQuarters: 0,
    underMonths: 0,
    holdingCompany: false,
    priceHistory: [],
    marketCapAtIpo: null,
    integration: [],
    lossShare: null,
    lines: emptyLines(),
    linesAssets: null,
    acquiredNames: [],
  };
  world.banks[bank.id] = bank;
  world.bankOrder.push(bank.id);
  if (bank.homeCounty) {
    const county = world.geo.counties[bank.homeCounty];
    const core = acct.checking + acct.savings + acct.mmda + acct.cd;
    bank.branches.push({
      id: nextId(world, 'br'),
      county: bank.homeCounty,
      openedDay: world.day,
      deposits: core,
      fixedCost: county ? branchFixedCost(county) : 0,
      distanceKm: 0,
      competitiveTarget: null,
    });
    if (county && county.depositPool > 0) {
      bank.franchise.baseShare = core / county.depositPool;
      bank.franchise.targetShare = bank.franchise.baseShare;
    }
    // A bank created with deposits is a seasoned franchise.
    if (core > 0) bank.franchise.openedDay = world.day - 20 * 365;
  }
  if (acct.loans > 0) seedPools(world, bank, acct.loans, derive(world.seed, hashString(`pools:${bank.id}:${bank.name}`)), spec.criticized ?? 0.05);
  else bank.loanMix = seedMix(world, bank);
  seedLots(world, bank);
  return bank;
}

function seedMix(world: World, bank: Bank): Record<LoanType, number> {
  const county = bank.homeCounty ? world.geo.counties[bank.homeCounty] : undefined;
  // Same rule as the pooled book, kept in credit.ts.
  return mixFor(county);
}

// A branch costs about six full-time salaries at the county's real wage
// plus occupancy scaled the same way. Aggregation of real wages, not fiction.
export function branchFixedCost(county: CountyState): number {
  const annualWage = county.wage * 52;
  return Math.round(annualWage * 6 * 1.35);
}

export function playerBank(world: World): Bank | null {
  return world.playerBankId ? (world.banks[world.playerBankId] ?? null) : null;
}

export function playerNetWorth(world: World): number {
  const bank = playerBank(world);
  let stake = 0;
  if (bank && bank.status === 'open' && bank.shares > 0) {
    const perShare = bank.isPublic && bank.price !== null ? bank.price : bookValuePerShare(bank);
    stake = Math.round(world.player.shares * perShare);
  }
  return world.player.cash + stake;
}

export function bookValuePerShare(bank: Bank): number {
  const a = bank.acct;
  const equity = a.commonStock + a.retainedEarnings + a.aoci;
  return bank.shares > 0 ? equity / bank.shares : 0;
}
