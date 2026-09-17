// The tick. tick(state, decisions) -> { state, pending, events }.
// Daily is light: cash and deposit movement, decision checks, events.
// Monthly close is heavy: accrual on average daily balance, credit,
// economy, regulation, rival AI. Quarterly: tax, call report, dividends.
// (CLAUDE.md rules 1, 5, 21; D30.)

import { calibration } from '../data/calibration';
import {
  type Accounts,
  type DepositType,
  DEPOSIT_TYPES,
  addIS,
  assertBalanced,
  emptyIS,
  leverageRatio,
  netIncome,
  post,
  pretaxIncome,
  totalAssets,
  totalDeposits,
  totalEquity,
  tier1Capital,
} from './ledger';
import {
  type Bank,
  type Decision,
  type FeedItem,
  type FeedSource,
  type Pending,
  type World,
  emptyAdb,
  nextId,
  FEED_CAP,
} from './state';
import { dateOf, formatDate, isMonthEnd, isQuarterEnd, isYearEnd, quarterOf } from './time';

export interface TickResult {
  state: World;
  pending: Pending[];
  events: FeedItem[];
}

export interface Ctx {
  world: World;
  events: FeedItem[];
}

export function emit(
  ctx: Ctx,
  source: FeedSource,
  text: string,
  opts: { severity?: FeedItem['severity']; bankId?: string | null; ref?: FeedItem['ref'] } = {},
): FeedItem {
  const item: FeedItem = {
    id: nextId(ctx.world, 'e'),
    day: ctx.world.day,
    source,
    text,
    severity: opts.severity ?? 'info',
    bankId: opts.bankId ?? null,
    ref: opts.ref ?? null,
  };
  ctx.events.push(item);
  return item;
}

export function addPending(ctx: Ctx, p: Omit<Pending, 'id' | 'day'>): Pending {
  const item: Pending = { ...p, id: nextId(ctx.world, 'p'), day: ctx.world.day };
  ctx.world.pending.push(item);
  return item;
}

// Decision handlers are registered by the systems that own them. Kept as a
// plain table, filled by engine/decisions.ts.
export type DecisionHandler = (ctx: Ctx, pending: Pending, decision: Decision) => void;
export const decisionHandlers: Partial<Record<Pending['kind'], DecisionHandler>> = {};

// Hooks filled by later systems. Each is a plain list of functions.
export const dailyHooks: ((ctx: Ctx) => void)[] = [];
export const monthlyHooks: ((ctx: Ctx) => void)[] = [];
export const quarterlyHooks: ((ctx: Ctx) => void)[] = [];
export const yearlyHooks: ((ctx: Ctx) => void)[] = [];

export function tick(world: World, decisions: Decision[] = []): TickResult {
  const ctx: Ctx = { world, events: [] };
  applyDecisions(ctx, decisions);
  world.day += 1;
  daily(ctx);
  if (isMonthEnd(world.day)) monthlyClose(ctx);
  if (isQuarterEnd(world.day)) quarterlyClose(ctx);
  if (isYearEnd(world.day)) for (const h of yearlyHooks) h(ctx);
  assertWorldBalanced(world);
  if (ctx.events.length > 0) {
    world.feed.push(...ctx.events);
    if (world.feed.length > FEED_CAP) world.feed.splice(0, world.feed.length - FEED_CAP);
  }
  return { state: world, pending: world.pending, events: ctx.events };
}

export function applyDecisions(ctx: Ctx, decisions: Decision[]): void {
  for (const d of decisions) {
    const idx = ctx.world.pending.findIndex((p) => p.id === d.pendingId);
    if (idx < 0) continue;
    const pending = ctx.world.pending[idx] as Pending;
    ctx.world.pending.splice(idx, 1);
    const handler = decisionHandlers[pending.kind];
    if (handler) handler(ctx, pending, d);
  }
}

function daily(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status === 'failed' || b.status === 'acquired') continue;
    const a = b.acct;
    const adb = b.adb;
    adb.days += 1;
    adb.cash += a.cash;
    adb.securitiesAFS += a.securitiesAFS;
    adb.securitiesHTM += a.securitiesHTM;
    adb.loans += a.loans;
    adb.checking += a.checking;
    adb.savings += a.savings;
    adb.mmda += a.mmda;
    adb.cd += a.cd;
    adb.brokered += a.brokered;
    adb.fhlb += a.fhlb;
    adb.fedFundsPurchased += a.fedFundsPurchased;
    adb.subDebt += a.subDebt;
  }
  for (const h of dailyHooks) h(ctx);
}

const DAYS_IN_YEAR = 365;

function accrue(avg: number, rate: number, days: number): number {
  return Math.round((avg * rate * days) / DAYS_IN_YEAR);
}

// Monthly accrual for one bank on average daily balances (rule 21). Every
// posting is one balanced entry so the identity holds at every step.
export function accrueMonth(ctx: Ctx, b: Bank): void {
  const a = b.acct;
  const adb = b.adb;
  const days = adb.days;
  if (days === 0) return;
  const m = b.is.month;
  m.days += days;

  // Interest income. Loans accrue to a receivable and pools pay at the close.
  // Nonaccrual balances are excluded by the credit system, which sets
  // b.loanYield on the accruing balance only.
  const loanInterest = accrue(adb.loans / days, b.loanYield, days);
  if (loanInterest !== 0) {
    post(a, { interestReceivable: loanInterest, retainedEarnings: loanInterest });
    m.interestLoans += loanInterest;
  }
  const afsInterest = accrue(adb.securitiesAFS / days, b.afsYield, days);
  const htmInterest = accrue(adb.securitiesHTM / days, b.htmYield, days);
  const secInterest = afsInterest + htmInterest;
  if (secInterest !== 0) {
    post(a, { cash: secInterest, retainedEarnings: secInterest });
    m.interestSecurities += secInterest;
  }
  const cashYield = ctx.world.economy.fedFunds + calibration.cashYieldVsFedFunds.typical / 10_000;
  const cashInterest = accrue(adb.cash / days, Math.max(0, cashYield), days);
  if (cashInterest !== 0) {
    post(a, { cash: cashInterest, retainedEarnings: cashInterest });
    m.interestCash += cashInterest;
  }

  // Interest expense on deposits is credited to the accounts.
  for (const t of DEPOSIT_TYPES) {
    const x = accrue(adb[t] / days, b.rates[t], days);
    if (x !== 0) {
      post(a, { [t]: x, retainedEarnings: -x } as Partial<Accounts>);
      m[isKey(t)] += x;
    }
  }
  const brokered = accrue(adb.brokered / days, b.brokeredRate, days);
  if (brokered !== 0) {
    post(a, { brokered, retainedEarnings: -brokered });
    m.interestBrokered += brokered;
  }
  const borrowings =
    accrue(adb.fhlb / days, b.fhlbRate, days) +
    accrue(adb.fedFundsPurchased / days, b.fedFundsRate, days) +
    accrue(adb.subDebt / days, b.subDebtRate, days);
  if (borrowings !== 0) {
    post(a, { cash: -borrowings, retainedEarnings: -borrowings });
    m.interestBorrowings += borrowings;
  }

  // Overhead on average assets, split by the calibration shares.
  const avgAssets = (adb.cash + adb.securitiesAFS + adb.securitiesHTM + adb.loans) / days;
  const overhead = accrue(avgAssets, b.overheadRate, days);
  if (overhead > 0) {
    const salaries = Math.round((overhead * calibration.salariesShareOfNie.typical) / 100);
    const occupancy = Math.round((overhead * calibration.occupancyShareOfNie.typical) / 100);
    const other = overhead - salaries - occupancy;
    post(a, { cash: -overhead, retainedEarnings: -overhead });
    m.salaries += salaries;
    m.occupancy += occupancy;
    m.otherExpense += other;
  }
}

function isKey(t: DepositType): 'interestChecking' | 'interestSavings' | 'interestMmda' | 'interestCd' {
  switch (t) {
    case 'checking':
      return 'interestChecking';
    case 'savings':
      return 'interestSavings';
    case 'mmda':
      return 'interestMmda';
    case 'cd':
      return 'interestCd';
  }
}

// Collects the interest receivable in cash. Pools pay at the close; the
// relationship book pays on payment days and the credit system nets it.
function collectReceivable(b: Bank): void {
  const x = b.acct.interestReceivable;
  if (x !== 0) post(b.acct, { cash: x, interestReceivable: -x });
}

function monthlyClose(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status === 'failed' || b.status === 'acquired') continue;
    accrueMonth(ctx, b);
    collectReceivable(b);
  }
  for (const h of monthlyHooks) h(ctx);
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status === 'failed' || b.status === 'acquired') continue;
    addIS(b.is.quarter, b.is.month);
    addIS(b.is.year, b.is.month);
    b.is.month = emptyIS();
    b.adb = emptyAdb();
    b.bookValueAtLastClose = totalEquity(b.acct);
  }
  world.economy.month += 1;
}

function quarterlyClose(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status === 'failed' || b.status === 'acquired') continue;
    assess(b);
    taxQuarter(b);
  }
  for (const h of quarterlyHooks) h(ctx);
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status === 'failed' || b.status === 'acquired') continue;
    b.reports.push(callReport(world, b));
    b.is.lastQuarter = b.is.quarter;
    b.is.quarter = emptyIS();
    if (isYearEnd(world.day)) {
      b.is.lastYear = b.is.year;
      b.is.year = emptyIS();
    }
  }
}

// FDIC insurance assessment, quarterly, on assets less tangible equity.
function assess(b: Bank): void {
  const a = b.acct;
  const base = Math.max(0, totalAssets(a) - tier1Capital(a));
  const x = Math.round((base * calibration.fdicAssessment.typical) / 10_000 / 4);
  if (x > 0) {
    post(a, { cash: -x, retainedEarnings: -x });
    b.is.quarter.assessment += x;
    b.is.year.assessment += x;
  }
}

// Flat effective tax with a loss carryforward. Real enough: banks pay tax
// on positive quarters and carry losses forward.
function taxQuarter(b: Bank): void {
  const pretax = pretaxIncome(b.is.quarter);
  if (pretax > 0) {
    const shield = Math.min(pretax, b.taxLossCarryforward);
    b.taxLossCarryforward -= shield;
    const tax = Math.round(((pretax - shield) * calibration.effectiveTaxRate.typical) / 100);
    if (tax > 0) {
      post(b.acct, { cash: -tax, retainedEarnings: -tax });
      b.is.quarter.tax += tax;
      b.is.year.tax += tax;
    }
  } else if (pretax < 0) {
    b.taxLossCarryforward += -pretax;
  }
}

export function callReport(world: World, b: Bank): Bank['reports'][number] {
  const a = b.acct;
  const q = b.is.quarter;
  const { y, q: qn } = quarterOf(world.day);
  const assets = totalAssets(a);
  const ni = netIncome(q);
  const days = q.days || 1;
  const annualize = (x: number) => (x * DAYS_IN_YEAR) / days;
  const avgLoans = b.reports.length > 0 ? ((b.reports[b.reports.length - 1] as { loans: number }).loans + a.loans) / 2 : a.loans;
  const earning = a.loans + a.securitiesAFS + a.securitiesHTM + a.cash;
  const nii = q.interestLoans + q.interestSecurities + q.interestCash - (q.interestChecking + q.interestSavings + q.interestMmda + q.interestCd + q.interestBrokered + q.interestBorrowings);
  return {
    day: world.day,
    quarter: `${y}Q${qn}`,
    assets,
    loans: a.loans,
    securities: a.securitiesAFS + a.securitiesHTM,
    deposits: totalDeposits(a),
    equity: totalEquity(a),
    tier1: tier1Capital(a),
    leverage: leverageRatio(a),
    netIncome: ni,
    roa: assets > 0 ? annualize(ni) / assets : 0,
    nim: earning > 0 ? annualize(nii) / earning : 0,
    provision: q.provision,
    chargeOffs: q.chargeOffs,
    ncoRate: avgLoans > 0 ? annualize(q.chargeOffs - q.recoveries) / avgLoans : 0,
    uninsuredShare: b.uninsuredShare,
    unrealizedLoss: -a.afsValuation + (a.securitiesHTM - b.htmFairValue),
  };
}

export function assertWorldBalanced(world: World): void {
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    assertBalanced(b.acct, `${b.name} on ${formatDate(world.day)}`);
  }
}

export function describeDay(world: World): string {
  const { dow } = dateOf(world.day);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${names[dow]} ${formatDate(world.day)}`;
}
