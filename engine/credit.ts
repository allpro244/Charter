// Credit, pooled book (SYSTEMS.md Part 1, system 3; D29). Every bank's
// loans outside the player's relationship book live in pools: one record
// per type and vintage with balances by grade. Monthly: amortization,
// prepayment, interest, grade migration under stress from the economy,
// charge-offs against the allowance. Quarterly: CECL-style reserve.

import { calibration } from '../data/calibration';
import type { Sector } from '../data/types';
import { type Ctx, emit } from './ctx';
import { hpiReturn12, sectorReturn12 } from './economy';
import { post } from './ledger';
import { type Rng, randNormal } from './rng';
import { GRADES, LOAN_TYPES, type LoanType, emptyByType } from './loantypes';
import type { Bank, CountyState, Pool, World } from './state';
import { dateOf } from './time';
import { money } from './format';

export interface TypeParams {
  term: number; // months
  balloon: number | null; // months, when the loan pays off before full amortization
  cpr: number; // annual prepayment rate
  lgd: number; // loss given default, through the cycle
  spread: number; // over the base rate
  base: 'ff' | 'y2' | 'y10';
  downScale: number; // multiplier on downgrade probabilities
  sector: Sector | null; // sector index that drives stress
  housing: number; // weight of home prices in stress
  local: number; // weight of county condition in stress
  avgSize: number; // typical loan, dollars
  label: string;
}

export const TYPE: Record<LoanType, TypeParams> = {
  ci: { term: 60, balloon: null, cpr: 0.15, lgd: 0.4, spread: 0.025, base: 'ff', downScale: 1.0, sector: null, housing: 0, local: 0.5, avgSize: 350_000, label: 'C&I' },
  cre_oo: { term: 300, balloon: 120, cpr: 0.06, lgd: 0.3, spread: 0.022, base: 'y10', downScale: 0.6, sector: 'construction', housing: 0.3, local: 1.0, avgSize: 1_200_000, label: 'CRE owner occupied' },
  cre_inv: { term: 300, balloon: 120, cpr: 0.06, lgd: 0.35, spread: 0.026, base: 'y10', downScale: 0.75, sector: 'construction', housing: 0.5, local: 1.0, avgSize: 2_500_000, label: 'CRE investor' },
  construction: { term: 24, balloon: null, cpr: 0.15, lgd: 0.45, spread: 0.035, base: 'ff', downScale: 1.3, sector: 'construction', housing: 1.0, local: 1.0, avgSize: 3_000_000, label: 'Construction' },
  resi: { term: 360, balloon: null, cpr: 0.08, lgd: 0.2, spread: 0.018, base: 'y10', downScale: 0.5, sector: null, housing: 1.2, local: 0.6, avgSize: 300_000, label: '1-4 family' },
  consumer: { term: 60, balloon: null, cpr: 0.15, lgd: 0.65, spread: 0.06, base: 'ff', downScale: 2.6, sector: null, housing: 0, local: 0.6, avgSize: 25_000, label: 'Consumer' },
  ag: { term: 84, balloon: null, cpr: 0.08, lgd: 0.3, spread: 0.025, base: 'ff', downScale: 0.6, sector: 'agriculture', housing: 0, local: 0.3, avgSize: 400_000, label: 'Agriculture' },
  energy: { term: 60, balloon: null, cpr: 0.12, lgd: 0.5, spread: 0.04, base: 'ff', downScale: 1.4, sector: 'energy', housing: 0, local: 0.3, avgSize: 4_000_000, label: 'Oil and gas' },
};

// Annual probability of moving one grade down, by grade 1 to 8 (grade 9 is
// charged off), and of moving one grade up by grade 2 to 8. Through the
// cycle; the stress factor moves them.
const DOWN = [0.03, 0.05, 0.07, 0.10, 0.15, 0.32, 0.35, 0.5, 0];
const UP = [0, 0.10, 0.10, 0.10, 0.08, 0.2, 0.12, 0.05, 0];
// Annual probability of default from each grade through the cycle. Scaled
// by stress each month, this is the direct flow to charge-off; the one
// notch moves above shape the criticized share around it.
export const PD_BY_GRADE = [0.001, 0.002, 0.004, 0.008, 0.015, 0.05, 0.15, 0.4, 1];
const PD_M = PD_BY_GRADE.map(monthly);

const NONACCRUAL_GRADE = 7; // grades 7 to 9 do not accrue
const G = GRADES; // local copy: hot loops must not read a module binding
const DOWN_M = DOWN.map(monthly);
const UP_M = UP.map(monthly);
const SMM: Record<LoanType, number> = {} as Record<LoanType, number>;
for (const t of LOAN_TYPES) SMM[t] = 1 - Math.pow(1 - TYPE[t].cpr, 1 / 12);
// Vintages kept individually per type; older ones merge into one seasoned
// pool. The vintage curve matters in the first years of a loan's life;
// after that the book is one aggregate (D29: aggregation, not fiction).
const MAX_VINTAGES = 6;
const scratch = new Array<number>(GRADES).fill(0);

// Seasoned grade distribution for a book that already exists.
const SEASONED = [0.05, 0.15, 0.3, 0.25, 0.15, 0.05, 0.03, 0.015, 0.005];

function monthly(pAnnual: number): number {
  return 1 - Math.pow(1 - pAnnual, 1 / 12);
}

export function baseRate(world: World, t: LoanType): number {
  const e = world.economy;
  const p = TYPE[t];
  const base = p.base === 'ff' ? e.fedFunds : p.base === 'y2' ? e.curve.y2 : e.curve.y10;
  return base + p.spread;
}

export function emptyPool(type: LoanType, vintage: number, rate: number): Pool {
  return { type, vintage, count: 0, balance: 0, grades: new Array(GRADES).fill(0), rate, origBalance: 0, cumLoss: 0, termMonths: TYPE[type].term, ageMonths: 0 };
}

export function findPool(b: Bank, type: LoanType, vintage: number): Pool | undefined {
  for (const p of b.pools) if (p.type === type && p.vintage === vintage) return p;
  return undefined;
}

// Adds originated balance to the current vintage pool, all in grade 3 to 4.
export function addToPool(world: World, b: Bank, type: LoanType, amount: number, rate: number, count: number, grade = 3, vintage?: number): Pool {
  const year = vintage ?? dateOf(world.day).y;
  let p = findPool(b, type, year);
  if (!p) {
    p = emptyPool(type, year, rate);
    b.pools.push(p);
  }
  // Weighted coupon.
  p.rate = p.balance + amount > 0 ? (p.rate * p.balance + rate * amount) / (p.balance + amount) : rate;
  p.balance += amount;
  p.origBalance += amount;
  p.count += count;
  const g = Math.max(1, Math.min(GRADES, grade)) - 1;
  p.grades[g] = (p.grades[g] ?? 0) + amount;
  return p;
}

// Loan mix for a bank from its county's real sector shares. Energy and
// agriculture lending scale with local employment in those sectors.
export function mixFor(county: CountyState | undefined): Record<LoanType, number> {
  const energy = Math.min(0.3, 6 * (county?.sectors.energy ?? 0.005));
  const ag = Math.min(0.3, 4 * (county?.sectors.agriculture ?? 0.01));
  const construction = Math.min(0.15, 0.06 + 0.5 * (county?.sectors.construction ?? 0.06));
  const rest = 1 - energy - ag - construction;
  const mix: Record<LoanType, number> = {
    energy,
    ag,
    construction,
    ci: rest * 0.24,
    cre_oo: rest * 0.24,
    cre_inv: rest * 0.22,
    resi: rest * 0.22,
    consumer: rest * 0.08,
  };
  return mix;
}

// Turns a loan lump into seasoned vintage pools. Used when a bank is
// created with a book: rivals, aggregates, takeover targets. criticized
// shifts balance into grades 6 and worse.
export function seedPools(world: World, b: Bank, total: number, r: Rng, criticized = 0.05): void {
  const county = b.homeCounty ? world.geo.counties[b.homeCounty] : undefined;
  b.loanMix = mixFor(county);
  const year = dateOf(world.day).y;
  const dist = [...SEASONED];
  // Move mass into criticized grades to match the requested share.
  const crit = dist[5]! + dist[6]! + dist[7]! + dist[8]!;
  const scale = criticized / crit;
  for (let g = 5; g < GRADES; g++) dist[g] = dist[g]! * scale;
  const pass = 1 - criticized;
  const passSum = dist[0]! + dist[1]! + dist[2]! + dist[3]! + dist[4]!;
  for (let g = 0; g < 5; g++) dist[g] = (dist[g]! / passSum) * pass;
  let assigned = 0;
  for (const t of LOAN_TYPES) {
    const share = b.loanMix[t];
    if (share <= 0) continue;
    const typeTotal = Math.round(total * share);
    const p = TYPE[t];
    // Vintages spread over the last years, newer heavier, older ones aged.
    const years = Math.max(1, Math.min(8, Math.round(p.term / 12)));
    let typeAssigned = 0;
    for (let k = 0; k < years; k++) {
      const w = Math.pow(0.8, k);
      const wsum = (1 - Math.pow(0.8, years)) / 0.2;
      const amount = k === years - 1 ? typeTotal - typeAssigned : Math.round((typeTotal * w) / wsum);
      if (amount <= 0) continue;
      const rate = Math.max(0.01, baseRate(world, t) + randNormal(r, 0, 0.004) + k * 0.001);
      const pool = emptyPool(t, year - k, rate);
      pool.ageMonths = k * 12 + 6;
      pool.balance = amount;
      pool.origBalance = Math.round(amount * (1 + 0.15 * k));
      pool.count = Math.max(1, Math.round(amount / p.avgSize));
      let gAssigned = 0;
      for (let g = 0; g < GRADES; g++) {
        const x = g === GRADES - 1 ? amount - gAssigned : Math.round(amount * dist[g]!);
        pool.grades[g] = x;
        gAssigned += x;
      }
      b.pools.push(pool);
      typeAssigned += amount;
    }
    assigned += typeAssigned;
  }
  // Rounding differences land in the largest pool so pools sum to the ledger.
  const diff = total - assigned;
  if (diff !== 0 && b.pools.length > 0) {
    const big = b.pools.reduce((a, p) => (p.balance > a.balance ? p : a));
    big.balance += diff;
    big.grades[2] = (big.grades[2] ?? 0) + diff;
  }
  b.loansToDeposits = 0.8;
  refreshLoanYield(b);
}

export function pooledBalance(b: Bank): number {
  let x = 0;
  for (const p of b.pools) x += p.balance;
  return x;
}

export function relationshipBalance(b: Bank): number {
  let x = 0;
  for (const l of b.loans) if (l.status !== 'paid' && l.status !== 'chargedOff' && l.status !== 'reo') x += l.balance;
  return x;
}

export function reoBalance(b: Bank): number {
  let x = 0;
  for (const l of b.loans) if (l.status === 'reo') x += l.reoValue;
  return x;
}

// Weighted yield on the accruing balance, for the desk and the call report.
export function refreshLoanYield(b: Bank): void {
  let bal = 0;
  let sum = 0;
  for (const p of b.pools) {
    let perf = 0;
    for (let g = 0; g < NONACCRUAL_GRADE - 1; g++) perf += p.grades[g] ?? 0;
    bal += perf;
    sum += perf * p.rate;
  }
  for (const l of b.loans) {
    if (l.status === 'current' || l.status === 'late30' || l.status === 'late60') {
      bal += l.balance;
      sum += l.balance * l.rate;
    }
  }
  b.loanYield = bal > 0 ? sum / bal : 0;
}

// Stress on downgrade probabilities for one bank and loan type this month.
// Unemployment against its long-run level, the driving sector's 12 month
// move, home prices for housing-linked types, and the home county's
// condition (D41). Multiplicative, clamped.
export function stressFor(world: World, b: Bank, t: LoanType): number {
  const e = world.economy;
  const p = TYPE[t];
  // Asymmetric: rising unemployment hurts far more than low unemployment
  // helps, and a booming sector or housing market only helps so much.
  const uGap = e.unemployment - 0.045;
  let logS = uGap > 0 ? 25 * uGap : 8 * uGap;
  if (p.sector) logS += -6 * Math.min(0.05, sectorReturn12(e, p.sector));
  else logS += -12 * Math.min(0.01, e.gdpGrowth - 0.02);
  if (p.housing > 0) logS += -5 * p.housing * Math.min(0.04, hpiReturn12(e));
  if (p.local > 0 && b.homeCounty) {
    const c = world.geo.counties[b.homeCounty];
    if (c) logS += -5 * p.local * Math.log(c.condition / 100);
  }
  if (e.crisis && e.regime === 'recession') logS += 0.6;
  // Underwriting quality, and concentration: a book heavy in one type
  // moves together (SYSTEMS.md system 3).
  logS += Math.log(b.riskTilt);
  const loans = b.acct.loans;
  if (loans > 0) {
    let typeBal = 0;
    for (const p of b.pools) if (p.type === t) typeBal += p.balance;
    const share = typeBal / loans;
    if (share > 0.25) logS += (share - 0.25) * 2;
  }
  return Math.max(0.6, Math.min(e.crisis ? 20 : 12, Math.exp(logS)));
}

// Interest for one pool over a month: performing balance x rate x days/365.
export function poolInterest(p: Pool, days: number): number {
  let perf = 0;
  for (let g = 0; g < NONACCRUAL_GRADE - 1; g++) perf += p.grades[g] ?? 0;
  return Math.round((perf * p.rate * days) / 365);
}

function levelPrincipalShare(rate: number, remaining: number): number {
  if (remaining <= 1) return 1;
  const r = rate / 12;
  if (r <= 0) return 1 / remaining;
  return r / (Math.pow(1 + r, remaining) - 1);
}

// One month for every pool of a bank. Posts to the ledger as it goes.
export function poolsMonthly(ctx: Ctx, b: Bank, days: number): void {
  const { world } = ctx;
  const a = b.acct;
  const stress = emptyByType(1);
  for (const t of LOAN_TYPES) stress[t] = stressFor(world, b, t);
  let interest = 0;
  let principal = 0;
  let chargeOffs = 0;
  let recoveries = 0;
  const survivors: Pool[] = [];
  for (const p of b.pools) {
    const tp = TYPE[p.type];
    const g = p.grades;
    // Interest on performing balance.
    const i = poolInterest(p, days);
    interest += i;
    b.interestByType[p.type] += i;
    // Scheduled principal on performing grades plus prepayment.
    const remaining = Math.max(1, (tp.balloon ?? tp.term) - p.ageMonths);
    const sched = levelPrincipalShare(p.rate, tp.balloon ? tp.term - p.ageMonths : remaining);
    const payShare = Math.min(1, sched + SMM[p.type]);
    let paid = 0;
    for (let k = 0; k < NONACCRUAL_GRADE - 1; k++) {
      const x = Math.round((g[k] ?? 0) * payShare);
      g[k] = (g[k] ?? 0) - x;
      paid += x;
    }
    // Migration. Downgrades scaled by stress, upgrades by its inverse.
    const s = stress[p.type] * tp.downScale;
    const sInv = 1 / Math.sqrt(s);
    const next = scratch;
    for (let k = 0; k < G; k++) next[k] = 0;
    for (let k = 0; k < G; k++) {
      const bal = g[k] as number;
      if (bal <= 0) continue;
      const pDefault = k < G - 1 ? Math.min(0.5, (PD_M[k] as number) * s) : 0;
      const pDown = k < G - 2 ? Math.min(0.8, (DOWN_M[k] as number) * s) : 0;
      const pUp = k > 0 ? Math.min(0.5, (UP_M[k] as number) * sInv) : 0;
      const dflt = Math.round(bal * pDefault);
      const down = Math.round((bal - dflt) * pDown);
      const up = Math.round((bal - dflt) * pUp);
      next[k] = (next[k] as number) + bal - dflt - down - up;
      if (dflt > 0) next[G - 1] = (next[G - 1] as number) + dflt;
      if (down > 0) next[k + 1] = (next[k + 1] as number) + down;
      if (up > 0) next[k - 1] = (next[k - 1] as number) + up;
    }
    // Grade 9 is charged off: the loss against the allowance, the rest recovered.
    const lost = next[G - 1] as number;
    next[G - 1] = 0;
    const co = Math.round(lost * lgdNow(world, p.type));
    const rec = lost - co;
    chargeOffs += co;
    recoveries += rec;
    b.chargeOffsByType[p.type] += co;
    b.recoveriesByType[p.type] += rec;
    b.lifetimeChargeOffsByType[p.type] += co;
    p.cumLoss += co;
    for (let k = 0; k < G; k++) g[k] = next[k] as number;
    p.ageMonths += 1;
    // Balloon or maturity: the performing balance pays off.
    const life = tp.balloon ?? tp.term;
    if (p.ageMonths >= life) {
      for (let k = 0; k < NONACCRUAL_GRADE - 1; k++) {
        paid += g[k] ?? 0;
        g[k] = 0;
      }
    }
    principal += paid;
    let bal = 0;
    for (let k = 0; k < G; k++) bal += g[k] as number;
    p.balance = bal;
    p.count = Math.max(0, Math.round(p.count * (p.origBalance > 0 ? Math.min(1, bal / Math.max(1, p.origBalance)) + 0.05 : 1)));
    if (bal > 0) survivors.push(p);
  }
  b.pools = survivors;
  consolidatePools(b);
  if (interest > 0) {
    post(a, { cash: interest, retainedEarnings: interest });
    b.is.month.interestLoans += interest;
  }
  if (principal > 0) post(a, { cash: principal, loans: -principal });
  if (recoveries > 0) post(a, { cash: recoveries, loans: -recoveries });
  if (chargeOffs > 0) chargeOff(b, chargeOffs);
  if (chargeOffs > 0 && b.id === world.playerBankId && chargeOffs > 0.0005 * Math.max(1, a.loans)) {
    emit(ctx, 'borrower', `Pooled charge-offs of ${money(chargeOffs)} this month`, { severity: 'alert', bankId: b.id });
  }
}

// Keeps the newest vintages of each type and merges the older ones into one
// seasoned pool per type.
export function consolidatePools(b: Bank): void {
  for (const t of LOAN_TYPES) {
    let n = 0;
    for (const p of b.pools) if (p.type === t) n += 1;
    if (n <= MAX_VINTAGES) continue;
    const ofType = b.pools.filter((p) => p.type === t).sort((x, y) => y.vintage - x.vintage);
    const keep = ofType.slice(0, MAX_VINTAGES - 1);
    const old = ofType.slice(MAX_VINTAGES - 1);
    const merged = old[0] as Pool;
    for (let i = 1; i < old.length; i++) {
      const p = old[i] as Pool;
      const total = merged.balance + p.balance;
      merged.rate = total > 0 ? (merged.rate * merged.balance + p.rate * p.balance) / total : merged.rate;
      merged.ageMonths = total > 0 ? Math.round((merged.ageMonths * merged.balance + p.ageMonths * p.balance) / total) : merged.ageMonths;
      merged.vintage = Math.min(merged.vintage, p.vintage);
      for (let k = 0; k < G; k++) merged.grades[k] = (merged.grades[k] as number) + (p.grades[k] as number);
      merged.balance = total;
      merged.count += p.count;
      merged.origBalance += p.origBalance;
      merged.cumLoss += p.cumLoss;
    }
    b.pools = b.pools.filter((p) => p.type !== t).concat(keep, [merged]);
  }
}

// Loss given default moves with collateral values: worse when home prices
// have fallen over the year.
export function lgdNow(world: World, t: LoanType): number {
  const p = TYPE[t];
  const h = hpiReturn12(world.economy);
  return Math.max(0.05, Math.min(0.95, p.lgd - p.housing * 0.8 * h));
}

// Charges off against the allowance, provisioning first if it is short.
export function chargeOff(b: Bank, amount: number): void {
  const a = b.acct;
  if (amount <= 0) return;
  if (a.allowance < amount) {
    const short = amount - a.allowance;
    post(a, { allowance: short, retainedEarnings: -short });
    b.is.month.provision += short;
  }
  post(a, { allowance: -amount, loans: -amount });
  b.is.month.chargeOffs += amount;
}

// Rivals and takeover targets keep lending: pooled originations move loans
// toward the target loans-to-deposits ratio each month. The player's pooled
// originations come from auto-approved applications instead.
export function originateToTarget(ctx: Ctx, b: Bank): void {
  const { world } = ctx;
  const a = b.acct;
  const deposits = a.checking + a.savings + a.mmda + a.cd + a.brokered;
  const target = Math.round(deposits * b.loansToDeposits);
  const gap = target - a.loans;
  if (gap <= 0) return;
  // Lend up to a twelfth of the gap plus runoff, limited by cash on hand
  // above a liquidity cushion.
  const cushion = Math.round(0.06 * (a.cash + a.loans + a.securitiesAFS + a.securitiesHTM));
  const room = Math.max(0, a.cash - cushion);
  const amount = Math.min(room, Math.round(gap / 6));
  if (amount < 10_000) return;
  let assigned = 0;
  const types = LOAN_TYPES.filter((t) => b.loanMix[t] > 0);
  for (let i = 0; i < types.length; i++) {
    const t = types[i] as LoanType;
    const x = i === types.length - 1 ? amount - assigned : Math.round(amount * b.loanMix[t]);
    if (x <= 0) continue;
    const rate = baseRate(world, t) + randNormal(world.rng, 0, 0.003);
    addToPool(world, b, t, x, Math.max(0.01, rate), Math.max(1, Math.round(x / TYPE[t].avgSize)), 3);
    b.originationsByType[t] += x;
    assigned += x;
  }
  post(a, { loans: amount, cash: -amount });
}

// CECL-style reserve, quarterly. The allowance target is lifetime expected
// loss on the book under current conditions; the provision is the gap.
export function reserveQuarterly(ctx: Ctx, b: Bank): number {
  const { world } = ctx;
  let target = 0;
  for (const p of b.pools) {
    const tp = TYPE[p.type];
    const s = Math.min(6, stressFor(world, b, p.type) * tp.downScale);
    const life = Math.min(4, Math.max(0.5, ((tp.balloon ?? tp.term) - p.ageMonths) / 24));
    const lgd = lgdNow(world, p.type);
    for (let g = 0; g < GRADES; g++) {
      const bal = p.grades[g] ?? 0;
      if (bal <= 0) continue;
      const pd = Math.min(1, (PD_BY_GRADE[g] ?? 1) * (0.6 + 0.4 * s) * life);
      target += bal * pd * lgd;
    }
  }
  for (const l of b.loans) {
    if (l.status === 'paid' || l.status === 'chargedOff' || l.status === 'reo') continue;
    const life = Math.min(4, Math.max(0.5, (l.termMonths - monthsSince(world, l.originated)) / 24));
    const pd = Math.min(1, (PD_BY_GRADE[Math.max(0, l.grade - 1)] ?? 1) * life * (l.status === 'current' ? 1 : 2));
    target += l.balance * pd * Math.max(l.trueLgd * 0.6, lgdNow(world, l.type));
  }
  target = Math.round(target);
  const a = b.acct;
  const provision = target - a.allowance;
  if (provision !== 0) {
    post(a, { allowance: provision, retainedEarnings: -provision });
    b.is.quarter.provision += provision;
    b.is.year.provision += provision;
  }
  return provision;
}

function monthsSince(world: World, day: number): number {
  return Math.max(0, Math.floor((world.day - day) / 30.4));
}

// Lifetime charge-offs by type, for calibration tests and the desk.
export function noteLifetimeLoss(b: Bank, t: LoanType, amount: number): void {
  b.lifetimeChargeOffsByType[t] += amount;
}

// Bank-level view for the desk.
export function bookByType(b: Bank): { type: LoanType; label: string; balance: number; count: number; criticized: number; nonaccrual: number; yield: number }[] {
  const out = [] as ReturnType<typeof bookByType>;
  for (const t of LOAN_TYPES) {
    let balance = 0;
    let count = 0;
    let criticized = 0;
    let nonaccrual = 0;
    let ysum = 0;
    for (const p of b.pools) {
      if (p.type !== t) continue;
      balance += p.balance;
      count += p.count;
      ysum += p.balance * p.rate;
      for (let g = 5; g < GRADES; g++) criticized += p.grades[g] ?? 0;
      for (let g = 6; g < GRADES; g++) nonaccrual += p.grades[g] ?? 0;
    }
    for (const l of b.loans) {
      if (l.type !== t || l.status === 'paid' || l.status === 'chargedOff' || l.status === 'reo') continue;
      balance += l.balance;
      count += 1;
      ysum += l.balance * l.rate;
      if (l.grade >= 6) criticized += l.balance;
      if (l.status === 'nonaccrual' || l.status === 'workout' || l.grade >= 7) nonaccrual += l.balance;
    }
    if (balance > 0 || count > 0) out.push({ type: t, label: TYPE[t].label, balance, count, criticized, nonaccrual, yield: balance > 0 ? ysum / balance : 0 });
  }
  return out;
}

export function typeBand(t: LoanType) {
  return calibration.chargeOffRate[t];
}

export { NONACCRUAL_GRADE };
