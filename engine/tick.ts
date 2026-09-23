// The tick. tick(state, decisions) -> { state, pending, events }.
// Daily is light: cash and deposit movement, decision checks, events.
// Monthly close is heavy: accrual on average daily balance, economy,
// credit, regulation, rival AI. Quarterly: tax, dividends, call report.
// Systems are called here explicitly, in order. (CLAUDE.md rules 1, 5,
// 11, 21; D30.)

import { calibration } from '../data/calibration';
import { businessBalances, originateToTarget, poolsMonthly, refreshLoanYield, reserveQuarterly } from './credit';
import { type Ctx, emit, milestone } from './ctx';
import { decideRatePrompt, depositsDaily, depositsMonthly } from './deposits';
import { markSecurities, securitiesRunoff, investPolicyMonthly } from './funding';
import { economyMonthly } from './economy';
import { failuresDaily } from './failure';
import { decideWorkout, loansDaily, loansMonthly } from './loans';
import { branchOffersMonthly, decideBranchOffer } from './branchdeals';
import { decideDepositOffer, depositOffersMonthly, relationshipsMonthly } from './depositors';
import { peerGroup } from './peers';
import { decideOfficerEvent, officerPayroll, officersMonthly } from './officers';
import { reviewQuarterly } from './review';
import { rivalsMonthly, rivalsQuarterly } from './rivals';
import { stockMonthly, boardQuarterly } from './capital';
import { dealsMonthly, decideAuction, decideCompetingBid, decideOffer, expireDeals } from './deals';
import { feesMonthly, linesMonthly, linesYearEnd } from './lines';
import { emptyByType } from './loantypes';
import { closeForeign, countriesMonthly, foreignMonthly, globalQuarterly } from './global';
import { applicationsDaily, decideApplication, decideBatch, dialMonthly } from './underwriting';
import { ladderMonthly } from './ladder';
import { money } from './format';
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
import { assessmentRate, growthRestricted, regulationMonthly, stressTestAnnual } from './regulation';
import { type Bank, type Decision, type Pending, type World, emptyAdb, FEED_CAP, branchFixedCost } from './state';
import { dateOf, daysInMonth, formatDate, isMonthEnd, isQuarterEnd, isYearEnd, quarterOf } from './time';
import { wealthMonthly, wealthQuarterly } from './wealth';

export interface TickResult {
  state: World;
  pending: Pending[];
  events: import('./state').FeedItem[];
}

export function tick(world: World, decisions: Decision[] = []): TickResult {
  const ctx: Ctx = { world, events: [] };
  applyDecisions(ctx, decisions);
  world.day += 1;
  daily(ctx);
  if (isMonthEnd(world.day)) monthlyClose(ctx);
  if (isQuarterEnd(world.day)) quarterlyClose(ctx);
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
    resolve(ctx, pending, d);
  }
}

function resolve(ctx: Ctx, pending: Pending, decision: Decision): void {
  switch (pending.kind) {
    case 'failure':
      // Acknowledged. The desk returns to the map.
      return;
    case 'loan_application':
      decideApplication(ctx, pending, decision);
      return;
    case 'loan_batch':
      decideBatch(ctx, pending, decision);
      return;
    case 'officer_event':
      decideOfficerEvent(ctx, pending, decision);
      return;
    case 'rate_prompt':
      decideRatePrompt(ctx, pending, decision);
      return;
    case 'workout':
      decideWorkout(ctx, pending, decision);
      return;
    case 'branch_offer':
      decideBranchOffer(ctx, pending, decision);
      return;
    case 'deposit_offer':
      decideDepositOffer(ctx, pending, decision);
      return;
    case 'assisted_auction':
      decideAuction(ctx, pending, decision);
      return;
    case 'acquisition_offer':
      if (pending.data.foreign) {
        const buyer = pending.bankId ? ctx.world.banks[pending.bankId] : undefined;
        if (buyer && decision.choice !== 'w') closeForeign(ctx, buyer, pending.data.foreign as import('./global').ForeignCandidate);
        return;
      }
      decideOffer(ctx, pending, decision);
      return;
    case 'competing_bid':
      decideCompetingBid(ctx, pending, decision);
      return;
    case 'exam_result':
    case 'enforcement':
      return;
    default:
      return;
  }
}

function isLive(b: Bank): boolean {
  return b.status === 'open' || b.status === 'closing';
}

function daily(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (!isLive(b)) continue;
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
  depositsDaily(ctx);
  applicationsDaily(ctx);
  const player = world.playerBankId ? world.banks[world.playerBankId] : undefined;
  if (player && isLive(player)) loansDaily(ctx, player);
  failuresDaily(ctx);
  expireDeals(ctx);
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

  // Loan interest is posted by the credit system (pools pay at the close,
  // relationship loans accrue to the receivable). Securities and cash here.
  const secInterest = accrue(adb.securitiesAFS / days, b.afsYield, days) + accrue(adb.securitiesHTM / days, b.htmYield, days);
  if (secInterest !== 0) {
    post(a, { cash: secInterest, retainedEarnings: secInterest });
    m.interestSecurities += secInterest;
  }
  const cashYield = ctx.world.economy.fedFunds + calibration.cashYieldVsFedFunds.typical / 10_000;
  const cashInterest = accrue(Math.max(0, adb.cash) / days, Math.max(0, cashYield), days);
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
  // The premium on negotiated accounts (D62), over the sheet rate.
  for (const rel of b.relationships ?? []) {
    const x = accrue(rel.balance, rel.premium, days);
    if (x > 0) {
      post(a, { [rel.type]: x, retainedEarnings: -x } as Partial<Accounts>);
      m[isKey(rel.type)] += x;
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

  // Overhead on average assets, the ratio the call report keeps (FDIC
  // noninterest expense to assets), split by the calibration shares, plus
  // the fixed cost of every branch from real local wages and the officers'
  // pay.
  const avgEarning = (adb.cash + adb.securitiesAFS + adb.securitiesHTM + adb.loans) / days;
  // The officers are three of the home branch's six seats: a one branch
  // bank does not pay for them twice.
  let branchCost = 0;
  const seated = Math.min(3, b.officers.length);
  for (const br of b.branches) branchCost += br.county === b.homeCounty ? Math.round((br.fixedCost * (6 - seated)) / 6) : br.fixedCost;
  // A seeded rival's other offices cost what a branch costs at home, without
  // a branch record each (aggregation): the FDIC office count is real.
  if (b.officesExtra) {
    const home = b.homeCounty ? ctx.world.geo.counties[b.homeCounty] : undefined;
    if (home) branchCost += b.officesExtra * branchFixedCost(home);
  }
  const overhead = accrue(avgEarning, b.overheadRate, days) + accrue(branchCost + officerPayroll(b), 1, days);
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

function monthlyClose(ctx: Ctx): void {
  const { world } = ctx;
  const { y, m } = dateOf(world.day);
  const days = daysInMonth(y, m);
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (!isLive(b)) continue;
    accrueMonth(ctx, b);
    feesMonthly(ctx, b);
    if (b.id === world.playerBankId) loansMonthly(ctx, b, days, b.losses);
    poolsMonthly(ctx, b, days);
    b.operatingBase = businessBalances(b);
    relationshipsMonthly(ctx, b);
    linesMonthly(ctx, b);
    if (b.foreign.length > 0) foreignMonthly(ctx, b, days);
    // Rivals lend through pools. So do the player's lenders, under the
    // written policy, toward the loans to deposits target (D50); the desk
    // sees the large credits on top of that.
    if (!growthRestricted(b)) originateToTarget(ctx, b);
    if (b.id === world.playerBankId) investPolicyMonthly(ctx, b);
    refreshLoanYield(b);
    if (b.id === world.playerBankId) dialMonthly(ctx, b);
  }
  economyMonthly(ctx);
  ladderMonthly(ctx);
  countriesMonthly(ctx);
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (!isLive(b)) continue;
    securitiesRunoff(world, b);
    markSecurities(world, b);
  }
  rivalsMonthly(ctx);
  dealsMonthly(ctx);
  branchOffersMonthly(ctx);
  depositOffersMonthly(ctx);
  stockMonthly(ctx);
  depositsMonthly(ctx);
  officersMonthly(ctx);
  wealthMonthly(ctx);
  regulationMonthly(ctx);
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (!isLive(b)) continue;
    addIS(b.is.quarter, b.is.month);
    addIS(b.is.year, b.is.month);
    b.is.month = emptyIS();
    b.adb = emptyAdb();
    b.bookValueAtLastClose = totalEquity(b.acct);
  }
}

function quarterlyClose(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (!isLive(b)) continue;
    reserveQuarterly(ctx, b);
    assess(b);
    taxQuarter(b);
  }
  wealthQuarterly(ctx);
  boardQuarterly(ctx);
  reviewQuarterly(ctx);
  rivalsQuarterly(ctx);
  globalQuarterly(ctx);
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (!isLive(b)) continue;
    b.reports.push(callReport(world, b));
    if (b.id === world.playerBankId) {
      const { y, q } = quarterOf(world.day);
      (b.quarterHistory ??= []).push({ quarter: `${y}Q${q}`, is: b.is.quarter });
    }
    b.is.lastQuarter = b.is.quarter;
    b.is.quarter = emptyIS();
    if (isYearEnd(world.day)) {
      b.is.lastYear = b.is.year;
      b.is.year = emptyIS();
      b.originationsLastYear = Object.values(b.originationsByType).reduce((s, x) => s + x, 0);
      b.originationsByType = emptyByType(0);
      b.applicationsByType = emptyByType(0);
      b.declinedForFunding = 0;
      b.applications.toDeskYtd = 0;
      linesYearEnd(b);
    }
  }
  if (isYearEnd(world.day)) {
    stressTestAnnual(ctx);
    yearInReview(ctx);
  }
}

// The year in review for the player's bank: one line a casual player can
// read as a scorecard, and a milestone.
function yearInReview(ctx: Ctx): void {
  const { world } = ctx;
  const b = world.playerBankId ? world.banks[world.playerBankId] : undefined;
  if (!b || b.status !== 'open' || !b.is.lastYear) return;
  const { y } = dateOf(world.day);
  const ni = netIncome(b.is.lastYear);
  const assets = totalAssets(b.acct);
  const ago = b.reports.length >= 5 ? b.reports[b.reports.length - 5] : undefined;
  const growth = ago && ago.assets > 0 ? assets / ago.assets - 1 : null;
  const rank = world.ladder.rank;
  const rankAgo = world.ladder.rankYearAgo ?? null;
  const desk = b.desk;
  // Against the banks your size: the year's return on assets beside theirs.
  const g = peerGroup(world, b);
  const roa = ni / Math.max(1, assets);
  const verdict = Number.isFinite(g.peers.roa) && g.n >= 3 ? (roa > g.peers.roa + 0.002 ? ` A better year than most of the ${g.n} banks your size (they earned ${(100 * g.peers.roa).toFixed(2)}%).` : roa < g.peers.roa - 0.002 ? ` A worse year than most of the ${g.n} banks your size (they earned ${(100 * g.peers.roa).toFixed(2)}%).` : ` About the same year as the ${g.n} banks your size.`) : '';
  const text = `${y} in review: ${ni >= 0 ? 'profit' : 'loss'} ${money(Math.abs(ni))} (${(100 * ni / Math.max(1, assets)).toFixed(2)}% on assets), assets ${money(assets)}${growth !== null ? `, ${growth >= 0 ? 'up' : 'down'} ${(100 * Math.abs(growth)).toFixed(1)}%` : ''}${rank > 0 ? `, rank #${rank.toLocaleString('en-US')}${rankAgo !== null && rankAgo > 0 ? ` (from #${rankAgo.toLocaleString('en-US')})` : ''}` : ''}${desk ? `, ${desk.approved} loans approved at your desk, ${desk.wentBad} went bad` : ''}.${verdict}`;
  emit(ctx, 'system', text, { severity: ni >= 0 ? 'good' : 'alert', bankId: b.id });
  milestone(ctx, text);
  world.ladder.rankYearAgo = rank;
}

// FDIC insurance assessment, quarterly, on assets less tangible equity,
// at the risk based rate.
function assess(b: Bank): void {
  const a = b.acct;
  const base = Math.max(0, totalAssets(a) - tier1Capital(a));
  const x = Math.round((base * assessmentRate(b)) / 10_000 / 4);
  if (x > 0) {
    post(a, { cash: -x, retainedEarnings: -x });
    b.is.quarter.assessment += x;
    b.is.year.assessment += x;
  }
}

// Flat effective tax with a loss carryforward.
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
  const last = b.reports[b.reports.length - 1];
  const avgLoans = last ? (last.loans + a.loans) / 2 : a.loans;
  const earning = a.loans + a.securitiesAFS + a.securitiesHTM + a.cash;
  const nii =
    q.interestLoans +
    q.interestSecurities +
    q.interestCash -
    (q.interestChecking + q.interestSavings + q.interestMmda + q.interestCd + q.interestBrokered + q.interestBorrowings);
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
