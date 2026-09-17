// Borrowers and credit memos (D11, D32, D43). Every borrower is drawn from
// the county's real industry mix, income distribution, wages, and home
// prices. The memo shows the visible fields; true PD and LGD are a function
// of those fields plus a small hidden term. A careful reader gets close.

import { SECTORS, type Sector } from '../data/types';
import { TYPE, baseRate } from './credit';
import { sectorReturn12 } from './economy';
import { type Rng, chance, pick, pickWeighted, rand, randInt, randLogNormal, randNormal } from './rng';
import { type Bank, type CountyState, type LoanType, type Memo, type World } from './state';
import { money } from './format';

export interface Application {
  borrower: string;
  type: LoanType;
  county: string;
  memo: Memo;
  truePd: number;
  trueLgd: number;
  hidden: number;
  signals: { field: string; contribution: number; text: string }[];
}

const SURNAMES = ['Delgado', 'Nguyen', 'Whitfield', 'Okafor', 'Brennan', 'Tanaka', 'Mahoney', 'Patel', 'Kowalski', 'Ruiz', 'Chen', 'Abernathy', 'Novak', 'Fischer', 'Hale', 'Moreau', 'Singh', 'Larsen', 'Baptiste', 'Gutierrez', 'Reyes', 'Holt', 'Pruitt', 'Osei', 'Vance', 'Ibarra', 'Kessler', 'Lund', 'Quintero', 'Shah'];

const BUSINESS: Record<Sector, string[]> = {
  energy: ['Oilfield Services', 'Pressure Pumping', 'Pipe and Supply', 'Well Service', 'Energy Partners', 'Sand and Water', 'Hot Oil Service', 'Roustabout Co'],
  agriculture: ['Ranch', 'Farms', 'Cattle Co', 'Grain', 'Orchards', 'Dairy', 'Feed and Seed', 'Pecans'],
  manufacturing: ['Machine Works', 'Fabrication', 'Plastics', 'Tool and Die', 'Industries', 'Foods', 'Metal Products', 'Cabinetry'],
  tech: ['Software', 'Labs', 'Systems', 'Robotics', 'Data', 'Devices', 'Networks', 'Analytics'],
  finance: ['Insurance Agency', 'Advisors', 'Title Co', 'Capital', 'Realty', 'Accounting'],
  healthcare: ['Dental', 'Medical Group', 'Physical Therapy', 'Clinic', 'Pharmacy', 'Home Health', 'Orthodontics', 'Veterinary'],
  government: ['Contracting', 'Services', 'Consulting', 'Engineering', 'Security'],
  tourism: ['Hotel', 'Bistro', 'Grill', 'Cantina', 'Inn', 'Outfitters', 'Brewing', 'Event Center'],
  construction: ['Builders', 'Homes', 'Roofing', 'Concrete', 'Electric', 'Plumbing', 'Properties', 'Development', 'Paving'],
  logistics: ['Trucking', 'Freight', 'Logistics', 'Auto Group', 'Supply', 'Distributors', 'Market', 'Tire and Lube'],
  other: ['Services', 'Salon', 'Cleaners', 'Fitness', 'Printing', 'Daycare', 'Storage', 'Laundry'],
};

// EBITDA margins by sector, structural.
const MARGIN: Record<Sector, number> = { energy: 0.2, agriculture: 0.15, manufacturing: 0.12, tech: 0.18, finance: 0.25, healthcare: 0.15, government: 0.1, tourism: 0.1, construction: 0.08, logistics: 0.07, other: 0.1 };

// Base log-odds of annual default for a median loan of each type.
const BASE_Z: Record<LoanType, number> = { ci: -4.2, cre_oo: -4.6, cre_inv: -4.5, construction: -3.9, resi: -4.8, consumer: -3.5, ag: -4.6, energy: -3.7 };

export function businessName(r: Rng, sector: Sector, county: CountyState): string {
  const town = county.name.replace(/ (County|Parish|Borough|Census Area|Municipality|city)$/i, '');
  const forms = [
    () => `${pick(r, SURNAMES)} ${pick(r, BUSINESS[sector])}`,
    () => `${town} ${pick(r, BUSINESS[sector])}`,
    () => `${pick(r, SURNAMES)} and ${pick(r, SURNAMES)} ${pick(r, BUSINESS[sector])}`,
    () => `${pick(r, ['West', 'North', 'South', 'Central', 'Lone Star', 'Prairie', 'Basin', 'Valley', 'Coastal', 'Mesa'])} ${pick(r, BUSINESS[sector])}`,
  ];
  return pick(r, forms)();
}

export function householdName(r: Rng): string {
  return `${pick(r, SURNAMES)} household`;
}

// Draws a household income from the county's real ACS distribution
// (B19001 buckets), then within the bucket.
const BUCKET_EDGES = [0, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000, 40_000, 45_000, 50_000, 60_000, 75_000, 100_000, 125_000, 150_000, 200_000, 350_000];

export function drawIncome(r: Rng, county: CountyState): number {
  const shares = county.incomeBuckets.length === 16 ? county.incomeBuckets : null;
  if (!shares) return Math.round(county.income * randLogNormal(r, 0, 0.5));
  const i = pickWeighted(r, shares.map((_, k) => k), shares);
  const lo = BUCKET_EDGES[i] ?? 0;
  const hi = BUCKET_EDGES[i + 1] ?? lo * 2;
  return Math.round(lo + rand(r) * (hi - lo));
}

function loanTypeFor(r: Rng, sector: Sector, b: Bank): LoanType {
  const allowed = (t: LoanType) => b.policy.allowed[t];
  let choices: [LoanType, number][];
  switch (sector) {
    case 'energy':
      choices = [['energy', 0.6], ['ci', 0.3], ['cre_oo', 0.1]];
      break;
    case 'agriculture':
      choices = [['ag', 0.8], ['ci', 0.2]];
      break;
    case 'construction':
      choices = [['construction', 0.45], ['cre_inv', 0.3], ['ci', 0.25]];
      break;
    default:
      choices = [['ci', 0.55], ['cre_oo', 0.32], ['cre_inv', 0.13]];
  }
  const ok = choices.filter(([t]) => allowed(t));
  if (ok.length === 0) return 'ci';
  return pickWeighted(r, ok.map((c) => c[0]), ok.map((c) => c[1]));
}

// One application from a county. The county decides who walks in.
export function generateApplication(world: World, b: Bank, county: CountyState, r: Rng): Application {
  const e = world.economy;
  const localWage = county.wage * 52;
  const homeValue = county.homeValue ?? Math.round(county.income * 3.5);
  const priceLevel = Math.max(0.4, Math.min(4, homeValue / 300_000));
  const household = chance(r, 0.4);
  let type: LoanType;
  let sector: Sector;
  let borrower: string;
  let income: number;
  let employees = 0;
  let tenure: number;
  if (household) {
    type = chance(r, 0.62) && b.policy.allowed.resi ? 'resi' : 'consumer';
    if (!b.policy.allowed[type]) type = b.policy.allowed.resi ? 'resi' : 'consumer';
    sector = pickWeighted(r, SECTORS as unknown as Sector[], SECTORS.map((s) => county.sectors[s] ?? 0));
    borrower = householdName(r);
    income = Math.max(15_000, Math.round(drawIncome(r, county) * randLogNormal(r, 0.25, 0.25)));
    tenure = Math.max(0, Math.round(randLogNormal(r, 1.3, 0.8) * 10) / 10);
  } else {
    sector = pickWeighted(r, SECTORS as unknown as Sector[], SECTORS.map((s) => (s === 'government' ? 0.2 : 1) * (county.sectors[s] ?? 0)));
    type = loanTypeFor(r, sector, b);
    borrower = businessName(r, sector, county);
    employees = Math.max(2, Math.min(400, Math.round(randLogNormal(r, Math.log(12), 1.0))));
    income = Math.round(employees * localWage * 2.2 * randLogNormal(r, 0, 0.3));
    tenure = Math.max(0.5, Math.round(randLogNormal(r, 2.2, 0.7) * 10) / 10);
  }
  const p = TYPE[type];
  const ebitda = household ? income : Math.round(income * (MARGIN[sector] + randNormal(r, 0, 0.03)));
  let amount: number;
  let collateralValue: number;
  let collateralType: string;
  let ltv: number;
  let termMonths = p.term;
  let purpose: string;
  switch (type) {
    case 'resi': {
      collateralValue = Math.max(60_000, Math.round(homeValue * randLogNormal(r, 0, 0.35)));
      ltv = Math.min(0.97, 0.6 + 0.37 * rand(r));
      amount = Math.round(collateralValue * ltv);
      collateralType = 'single family home';
      purpose = chance(r, 0.7) ? 'purchase of a home' : 'refinance of a home';
      termMonths = 360;
      break;
    }
    case 'consumer': {
      collateralValue = Math.round((12_000 + 55_000 * rand(r)) * Math.max(0.6, Math.min(1.6, localWage / 60_000)));
      ltv = 0.8 + 0.35 * rand(r);
      amount = Math.round(collateralValue * ltv);
      collateralType = 'vehicle';
      purpose = 'auto purchase';
      termMonths = randInt(r, 48, 72);
      break;
    }
    case 'ci': {
      amount = Math.max(25_000, Math.min(20_000_000, Math.round(income * (0.08 + 0.27 * rand(r)))));
      collateralType = chance(r, 0.6) ? 'equipment and receivables' : 'blanket lien';
      collateralValue = Math.round(amount * (0.9 + 0.6 * rand(r)));
      ltv = amount / collateralValue;
      purpose = chance(r, 0.5) ? 'working capital line' : 'equipment purchase';
      termMonths = randInt(r, 36, 84);
      break;
    }
    case 'cre_oo': {
      collateralValue = Math.max(250_000, Math.min(15_000_000, Math.round(income * (0.6 + 0.9 * rand(r)) * priceLevel)));
      ltv = 0.55 + 0.3 * rand(r);
      amount = Math.round(collateralValue * ltv);
      collateralType = 'owner occupied building';
      purpose = 'purchase of the business premises';
      termMonths = 300;
      break;
    }
    case 'cre_inv': {
      collateralValue = Math.round((1_000_000 + 24_000_000 * Math.pow(rand(r), 2)) * Math.pow(priceLevel, 0.7));
      ltv = 0.6 + 0.25 * rand(r);
      amount = Math.round(collateralValue * ltv);
      collateralType = pick(r, ['retail center', 'office building', 'apartments', 'warehouse', 'self storage']);
      purpose = `${collateralType} acquisition`;
      termMonths = 300;
      const noi = collateralValue * (0.055 + 0.03 * rand(r));
      income = Math.round(noi);
      employees = 0;
      break;
    }
    case 'construction': {
      collateralValue = Math.round((1_000_000 + 14_000_000 * Math.pow(rand(r), 2)) * Math.pow(priceLevel, 0.7));
      ltv = 0.65 + 0.25 * rand(r);
      amount = Math.round(collateralValue * ltv);
      collateralType = pick(r, ['subdivision', 'apartment project', 'retail build', 'office build', 'spec homes']);
      purpose = `construction of a ${collateralType}`;
      termMonths = randInt(r, 18, 30);
      break;
    }
    case 'ag': {
      amount = Math.round(100_000 + 2_900_000 * Math.pow(rand(r), 2));
      collateralType = chance(r, 0.6) ? 'farmland' : 'equipment and livestock';
      collateralValue = Math.round(amount / (0.5 + 0.35 * rand(r)));
      ltv = amount / collateralValue;
      purpose = collateralType === 'farmland' ? 'land purchase' : 'equipment and operating line';
      termMonths = collateralType === 'farmland' ? 240 : 84;
      break;
    }
    case 'energy': {
      amount = Math.round(2_000_000 + 38_000_000 * Math.pow(rand(r), 2));
      ltv = 0.5 + 0.25 * rand(r);
      collateralValue = Math.round(amount / ltv);
      collateralType = 'proved developed producing reserves';
      purpose = 'reserve based revolver';
      termMonths = 48;
      break;
    }
  }
  const rate = baseRate(world, type) + randNormal(r, 0.002, 0.004);
  const monthlyRate = rate / 12;
  const payment = amount * (monthlyRate / (1 - Math.pow(1 + monthlyRate, -Math.min(termMonths, 360)))) || amount / termMonths;
  const annualDebtService = payment * 12;
  let dscr: number;
  let leverage: number;
  if (household) {
    const otherDebt = income * 0.12;
    dscr = income / Math.max(1, annualDebtService + otherDebt);
    leverage = (amount + income * 0.5) / Math.max(1, income);
  } else if (type === 'energy') {
    dscr = Math.max(0.5, Math.pow(e.oil / 70, 1.2) * (1.0 + 1.2 * rand(r)));
    leverage = amount / Math.max(1, ebitda);
  } else {
    dscr = ebitda / Math.max(1, annualDebtService * (type === 'construction' ? 0.6 : 1));
    leverage = (amount + income * 0.15) / Math.max(1, ebitda);
  }
  dscr = Math.round(Math.max(0.3, Math.min(6, dscr)) * 100) / 100;
  leverage = Math.round(Math.max(0.2, Math.min(15, leverage)) * 10) / 10;
  const guarantor = household ? false : chance(r, 0.7);
  const paymentHistory = pickWeighted(r, ['clean', 'minor', 'poor', 'none'] as const, [55, 25, 10, 10]);
  const netWorth = household ? Math.round(income * (0.5 + 5.5 * rand(r))) : Math.round(income * (0.2 + 1.8 * rand(r)));
  const hidden = randNormal(r, 0, 0.35);
  const signals = scoreSignals({ dscr, ltv, leverage, guarantor, paymentHistory, tenure, sectorMove: sectorReturn12(e, sector), type, sizeToCapital: 0 });
  let z = BASE_Z[type] + hidden;
  for (const s of signals) z += s.contribution;
  const truePd = 1 / (1 + Math.exp(-z));
  const trueLgd = lgdFor(type, ltv);
  const zVisible = z - hidden;
  const memo: Memo = {
    purpose,
    amount,
    termMonths,
    rate: Math.round(rate * 10_000) / 10_000,
    dscr,
    ltv: Math.round(ltv * 1000) / 1000,
    leverage,
    guarantor,
    collateralType,
    collateralValue,
    paymentHistory,
    tenureYears: tenure,
    sector,
    income,
    netWorth,
    employees,
    summary: '',
    redFlags: [],
    suggestedGrade: gradeFromZ(zVisible, type),
  };
  return { borrower, type, county: county.fips, memo, truePd, trueLgd, hidden, signals };
}

export interface SignalInput {
  dscr: number;
  ltv: number;
  leverage: number;
  guarantor: boolean;
  paymentHistory: Memo['paymentHistory'];
  tenure: number;
  sectorMove: number;
  type: LoanType;
  sizeToCapital: number;
}

// The visible part of the risk score, one entry per field, so every default
// can name the signal that predicted it (D32, D34).
export function scoreSignals(x: SignalInput): Application['signals'] {
  const out: Application['signals'] = [];
  out.push({ field: 'dscr', contribution: 1.6 * (1.25 - Math.min(x.dscr, 3)), text: `DSCR ${x.dscr.toFixed(2)}x` });
  out.push({ field: 'ltv', contribution: 2.2 * Math.max(0, x.ltv - 0.7) - 0.6 * Math.max(0, 0.7 - x.ltv), text: `LTV ${(x.ltv * 100).toFixed(0)}%` });
  out.push({ field: 'leverage', contribution: 0.22 * (Math.min(x.leverage, 10) - 3), text: `leverage ${x.leverage.toFixed(1)}x` });
  out.push({ field: 'guarantor', contribution: x.guarantor ? -0.45 : 0.1, text: x.guarantor ? 'personal guarantee' : 'no guarantee' });
  const hist = { clean: -0.4, minor: 0.05, poor: 1.0, none: 0.4 }[x.paymentHistory];
  out.push({ field: 'history', contribution: hist, text: `${x.paymentHistory} payment history` });
  out.push({ field: 'tenure', contribution: -0.06 * Math.min(x.tenure, 10) + 0.3, text: `${x.tenure.toFixed(0)} years in place` });
  out.push({ field: 'sector', contribution: -3 * x.sectorMove, text: `sector ${x.sectorMove >= 0 ? 'up' : 'down'} ${(Math.abs(x.sectorMove) * 100).toFixed(0)}% over the year` });
  return out;
}

export function lgdFor(type: LoanType, ltv: number): number {
  switch (type) {
    case 'resi':
    case 'cre_oo':
    case 'cre_inv':
    case 'construction':
    case 'ag':
      return Math.max(0.05, Math.min(0.9, 1 - 0.72 / Math.max(0.3, ltv) + 0.06 + (type === 'construction' ? 0.12 : 0)));
    case 'consumer':
      return Math.max(0.3, Math.min(0.9, 0.45 + 0.5 * Math.max(0, ltv - 0.9)));
    case 'energy':
      return Math.max(0.2, Math.min(0.85, 0.3 + 0.7 * Math.max(0, ltv - 0.5)));
    case 'ci':
      return Math.max(0.2, Math.min(0.8, 0.35 + 0.4 * Math.max(0, ltv - 0.8)));
  }
}

// Grade from the visible score. Grade 1 is the best.
export function gradeFromZ(z: number, type: LoanType): number {
  const rel = z - BASE_Z[type];
  if (rel < -1.6) return 1;
  if (rel < -0.9) return 2;
  if (rel < -0.2) return 3;
  if (rel < 0.5) return 4;
  if (rel < 1.2) return 5;
  if (rel < 2.0) return 6;
  return 7;
}

// The CCO's read of the memo. Skill sets how many true red flags get
// caught and how sharp the summary is. Never replaces the reading (D32).
export function ccoReview(app: Application, b: Bank, skill: number, r: Rng): void {
  const m = app.memo;
  const flags: string[] = [];
  const catchRate = 0.35 + 0.6 * (skill / 100);
  const consider = (cond: boolean, text: string) => {
    if (cond && chance(r, catchRate)) flags.push(text);
  };
  consider(m.dscr < b.policy.minDscr, `coverage ${m.dscr.toFixed(2)}x is below policy ${b.policy.minDscr.toFixed(2)}x`);
  consider(m.ltv > b.policy.maxLtv[app.type], `LTV ${(m.ltv * 100).toFixed(0)}% is above policy ${(b.policy.maxLtv[app.type] * 100).toFixed(0)}%`);
  consider(m.leverage > b.policy.maxLeverage, `leverage ${m.leverage.toFixed(1)}x is above policy ${b.policy.maxLeverage.toFixed(1)}x`);
  consider(m.paymentHistory === 'poor', 'poor payment history');
  consider(m.paymentHistory === 'none', 'no payment history on file');
  consider(m.tenureYears < 2, `only ${m.tenureYears.toFixed(1)} years in place`);
  const sectorSignal = app.signals.find((s) => s.field === 'sector');
  consider(!!sectorSignal && sectorSignal.contribution > 0.3, `${m.sector} sector is in decline`);
  consider(m.amount > 0.1 * Math.max(1, b.acct.commonStock + b.acct.retainedEarnings), `exposure is ${money(m.amount)}, over 10% of capital`);
  m.redFlags = flags;
  const tone = skill >= 70 ? 'sharp' : skill >= 45 ? 'plain' : 'thin';
  const verdict = flags.length === 0 ? 'no policy exceptions found' : `${flags.length} ${flags.length === 1 ? 'exception' : 'exceptions'} found`;
  if (tone === 'sharp') {
    m.summary = `${app.borrower}: ${m.purpose}, ${money(m.amount)} over ${m.termMonths} months. Coverage ${m.dscr.toFixed(2)}x, LTV ${(m.ltv * 100).toFixed(0)}%, leverage ${m.leverage.toFixed(1)}x, ${m.paymentHistory} history, ${m.tenureYears.toFixed(0)} years in place. ${verdict}. Suggested grade ${m.suggestedGrade}.`;
  } else if (tone === 'plain') {
    m.summary = `${m.purpose}, ${money(m.amount)}. Coverage ${m.dscr.toFixed(2)}x, LTV ${(m.ltv * 100).toFixed(0)}%. ${verdict}.`;
  } else {
    m.summary = `${m.purpose}, ${money(m.amount)}. ${verdict}.`;
  }
}

// Names the visible signal that most predicted a default.
export function attributionFor(app: { signals: Application['signals']; memo: Memo }): string {
  let best = app.signals[0];
  for (const s of app.signals) if (best && s.contribution > best.contribution) best = s;
  return best ? best.text : 'no visible signal';
}
