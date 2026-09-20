// Regulation (SYSTEMS.md system 12; D14). The capital stack with risk
// weights and buffers, prompt corrective action, CAMELS exams with
// findings tied to the book, an enforcement ladder to closure, size
// thresholds (Durbin, resolution plans, stress tests, SIFI liquidity),
// risk-based insurance assessments. Thresholds are the statutory ones
// (12 CFR 324), which is law, not calibration.

import { type Ctx, addPending, emit, milestone } from './ctx';
import { PD_BY_GRADE, TYPE, lgdNow } from './credit';
import { unrealizedToCapital } from './funding';
import { leverageRatio, netIncome, post, tier1Capital, totalAssets, totalDeposits } from './ledger';
import { GRADES, type LoanType } from './loantypes';
import { type Bank, type Camels, type Decision, type Finding, type Pending, type World, nextId } from './state';
import { dateOf, formatDate } from './time';
import { money, pct } from './format';

export const PCA_WELL = 0.05;
export const PCA_ADEQUATE = 0.04;
export const PCA_SIGNIFICANT = 0.03;
export const PCA_CRITICAL = 0.02;
// Risk based minimums and the capital conservation buffer (12 CFR 324.10, 324.11).
export const CET1_MIN = 0.045;
export const TIER1_MIN = 0.06;
export const TOTAL_MIN = 0.08;
export const BUFFER = 0.025;
export const CBLR = 0.09; // community bank leverage ratio option under $10B
export const THRESHOLD_DURBIN = 10e9;
export const THRESHOLD_RESOLUTION = 50e9;
export const THRESHOLD_STRESS = 100e9;
export const THRESHOLD_SIFI = 250e9;
export const THRESHOLD_GSIB = 1e12;

export type PcaCategory = 'well' | 'adequate' | 'under' | 'significant' | 'critical';

export const PCA_LABEL: Record<PcaCategory, string> = {
  well: 'well capitalized',
  adequate: 'adequately capitalized',
  under: 'undercapitalized',
  significant: 'significantly undercapitalized',
  critical: 'critically undercapitalized',
};

// Standardized risk weights (12 CFR 324.32): cash and Treasuries 0,
// agencies 20, residential mortgages 50, most loans 100, high volatility
// commercial real estate 150.
const LOAN_WEIGHT: Record<LoanType, number> = { ci: 1, cre_oo: 1, cre_inv: 1, construction: 1.5, resi: 0.5, consumer: 1, ag: 1, energy: 1, cards: 1 };

export interface CapitalStack {
  rwa: number;
  cet1: number;
  tier1: number;
  tier2: number;
  total: number;
  cet1Ratio: number;
  tier1Ratio: number;
  totalRatio: number;
  leverage: number;
  cblr: boolean; // using the community bank leverage ratio
  buffer: number; // CET1 above the minimum, ratio
  bufferShortfall: number; // below the conservation buffer, ratio
  maxPayout: number; // share of earnings that may be paid out
  category: PcaCategory;
}

export function riskWeightedAssets(b: Bank): number {
  const a = b.acct;
  let rwa = 0;
  for (const p of b.pools) rwa += p.balance * LOAN_WEIGHT[p.type];
  for (const l of b.loans) if (l.status !== 'paid' && l.status !== 'chargedOff' && l.status !== 'reo') rwa += l.balance * LOAN_WEIGHT[l.type];
  for (const lot of b.lots) rwa += lot.cost * (lot.product === 'treasury' ? 0 : 0.2);
  rwa += a.reo + a.premises + a.otherAssets + a.interestReceivable;
  // Cash at the Fed is zero weight; a fifth of it is due from banks at 20.
  rwa += a.cash * 0.2 * 0.2;
  return Math.round(rwa);
}

export function capitalStack(b: Bank): CapitalStack {
  const a = b.acct;
  const rwa = Math.max(1, riskWeightedAssets(b));
  const cet1 = a.commonStock + a.retainedEarnings - a.goodwill;
  const tier1 = cet1;
  const tier2 = Math.min(a.allowance, Math.round(rwa * 0.0125)) + a.subDebt;
  const total = tier1 + tier2;
  const leverage = leverageRatio(a);
  const cet1Ratio = cet1 / rwa;
  const tier1Ratio = tier1 / rwa;
  const totalRatio = total / rwa;
  const assets = totalAssets(a);
  const cblr = assets < THRESHOLD_DURBIN && leverage >= CBLR;
  let category: PcaCategory;
  if (cblr || (cet1Ratio >= 0.065 && tier1Ratio >= 0.08 && totalRatio >= 0.1 && leverage >= PCA_WELL)) category = 'well';
  else if (cet1Ratio >= CET1_MIN && tier1Ratio >= TIER1_MIN && totalRatio >= TOTAL_MIN && leverage >= PCA_ADEQUATE) category = 'adequate';
  else if (leverage <= PCA_CRITICAL || cet1Ratio < 0.02) category = 'critical';
  else if (cet1Ratio < 0.03 || tier1Ratio < 0.04 || totalRatio < 0.06 || leverage < PCA_SIGNIFICANT) category = 'significant';
  else category = 'under';
  const required = BUFFER + (b.gsib?.surcharge ?? 0) + (b.stressTest ? Math.max(0, b.stressTest.buffer - BUFFER) : 0);
  const buffer = cblr ? required : cet1Ratio - CET1_MIN;
  const bufferShortfall = Math.max(0, required - buffer);
  // Payout limits by quartile of the buffer (12 CFR 324.11), the G-SIB
  // surcharge and the stress capital buffer on top.
  const q = buffer / required;
  const maxPayout = q >= 1 ? 1 : q > 0.75 ? 0.6 : q > 0.5 ? 0.4 : q > 0.25 ? 0.2 : 0;
  return { rwa, cet1, tier1, tier2, total, cet1Ratio, tier1Ratio, totalRatio, leverage, cblr, buffer, bufferShortfall, maxPayout, category };
}

export function pcaCategory(leverage: number): PcaCategory {
  if (leverage >= PCA_WELL) return 'well';
  if (leverage >= PCA_ADEQUATE) return 'adequate';
  if (leverage >= PCA_SIGNIFICANT) return 'under';
  if (leverage > PCA_CRITICAL) return 'significant';
  return 'critical';
}

export function leverageOf(b: Bank): number {
  return leverageRatio(b.acct);
}

export function nextFriday(day: number): number {
  const dow = dateOf(day).dow;
  let delta = (5 - dow + 7) % 7;
  if (delta < 2) delta += 7;
  return day + delta;
}

// A dividend may not leave the bank less than adequately capitalized,
// may not exceed the conservation buffer's payout limit, and is barred
// under a consent order or a PCA directive.
export function canPayDividend(b: Bank, amount: number): boolean {
  if (b.enforcement === 'consent' || b.enforcement === 'pca') return false;
  if (b.stressTest && !b.stressTest.passed) return false;
  const a = b.acct;
  const tier1 = tier1Capital(a) - amount;
  const assets = totalAssets(a) - a.goodwill - amount;
  if (assets <= 0) return false;
  if (tier1 / assets < PCA_ADEQUATE) return false;
  const stack = capitalStack(b);
  const earnings = Math.max(0, netIncome(b.is.quarter));
  if (stack.maxPayout < 1 && amount > earnings * stack.maxPayout) return false;
  return true;
}

// The legal lending limit: 15% of capital and surplus to one borrower.
export function lendingLimit(b: Bank): number {
  return Math.round(0.15 * Math.max(0, tier1Capital(b.acct) + b.acct.allowance));
}

// An order forbids growth, not lending: the bank may replace runoff up to
// the size it had when the order came, and no more.
export function growthRestricted(b: Bank): boolean {
  if (b.enforcement !== 'consent' && b.enforcement !== 'pca') return false;
  const frozen = b.enforcementAssets ?? 0;
  return frozen <= 0 || totalAssets(b.acct) >= frozen;
}

// CRE concentration against the interagency guidance: construction over
// 100% of capital, or total non owner occupied CRE over 300%.
export function creConcentration(b: Bank): { construction: number; cre: number } {
  const t1 = Math.max(1, tier1Capital(b.acct) + b.acct.allowance);
  let construction = 0;
  let cre = 0;
  for (const p of b.pools) {
    if (p.type === 'construction') construction += p.balance;
    if (p.type === 'construction' || p.type === 'cre_inv') cre += p.balance;
  }
  for (const l of b.loans) {
    if (l.status === 'paid' || l.status === 'chargedOff' || l.status === 'reo') continue;
    if (l.type === 'construction') construction += l.balance;
    if (l.type === 'construction' || l.type === 'cre_inv') cre += l.balance;
  }
  return { construction: construction / t1, cre: cre / t1 };
}

export function criticizedShareOf(b: Bank): number {
  if (b.acct.loans <= 0) return 0;
  let x = 0;
  for (const p of b.pools) for (let g = 5; g < GRADES; g++) x += p.grades[g] ?? 0;
  for (const l of b.loans) if (l.grade >= 6 && l.status !== 'paid' && l.status !== 'chargedOff' && l.status !== 'reo') x += l.balance;
  return x / b.acct.loans;
}

function trailingRoa(b: Bank): number {
  const n = Math.min(4, b.reports.length);
  if (n === 0) return 0.01;
  let x = 0;
  for (let i = b.reports.length - n; i < b.reports.length; i++) x += b.reports[i]?.roa ?? 0;
  return x / n;
}

// The exam. Each component from the book; findings where the numbers
// cross the lines examiners use; the composite from the components with
// management and asset quality weighted.
export function examine(ctx: Ctx, b: Bank): Camels {
  const { world } = ctx;
  const stack = capitalStack(b);
  const c = b.camels;
  const findings: Finding[] = c.findings.filter((f) => !f.resolved);
  const raised = new Set<string>();
  // One open finding per key. Raised again, it keeps its first date and
  // takes the new text; not raised, it resolves.
  const add = (component: Finding['component'], key: string, text: string) => {
    raised.add(key);
    const existing = findings.find((f) => f.key === key);
    if (existing) existing.text = text;
    else findings.push({ id: nextId(world, 'f'), key, day: world.day, text, component, resolved: false });
  };
  // Capital.
  const capital = stack.category === 'well' && stack.bufferShortfall === 0 ? (stack.leverage > 0.09 ? 1 : 2) : stack.category === 'well' || stack.category === 'adequate' ? 3 : stack.category === 'under' ? 4 : 5;
  if (capital >= 3) add('C', 'C', `Capital: ${PCA_LABEL[stack.category]}, CET1 ${pct(stack.cet1Ratio, 1)}, leverage ${pct(stack.leverage, 1)}. Raise capital or shrink.`);
  // Asset quality.
  const crit = criticizedShareOf(b);
  const conc = creConcentration(b);
  const last = b.reports[b.reports.length - 1];
  const nco = last?.ncoRate ?? 0;
  let assets = crit < 0.03 && nco < 0.005 ? 1 : crit < 0.06 ? 2 : crit < 0.1 ? 3 : crit < 0.15 ? 4 : 5;
  if (conc.construction > 1.0 || conc.cre > 3.0) {
    assets = Math.max(assets, 3);
    add('A', 'A:concentration', `Commercial real estate concentration: construction ${pct(conc.construction, 0)} and non owner occupied CRE ${pct(conc.cre, 0)} of capital against guidance of 100% and 300%. Reduce or add capital and monitoring.`);
  }
  if (crit >= 0.1) add('A', 'A:criticized', `Criticized loans ${pct(crit, 1)} of the book. Workouts and charge-offs are overdue.`);
  // Management: vacancies, weak officers, policy exceptions, unresolved findings.
  const vacancies = ['cco', 'cfo', 'clo'].filter((r) => !b.officers.some((o) => o.role === r)).length;
  const weak = b.officers.filter((o) => o.skill < 40).length;
  const exceptions = b.applications.autoApproved > 0 ? b.loans.filter((l) => l.decision.note.includes('exception')).length / Math.max(1, b.loans.length) : 0;
  const unresolved = c.findings.filter((f) => !f.resolved && world.day - f.day > 365).length;
  let management = 1 + (b.kind === 'player' ? vacancies : 0) + (weak > 0 ? 1 : 0) + (exceptions > 0.15 ? 1 : 0) + (unresolved > 0 ? 1 : 0);
  management = Math.min(5, management);
  if (b.kind === 'player' && vacancies > 0) add('M', 'M:vacancies', `Management: ${vacancies} officer ${vacancies === 1 ? 'seat is' : 'seats are'} vacant. Fill them.`);
  if (exceptions > 0.15) add('M', 'M:exceptions', `Management: ${pct(exceptions, 0)} of relationship loans were policy exceptions. Follow the written policy or change it.`);
  // Earnings. A new charter is expected to lose money while it builds a
  // book: for its first three years (the de novo period) examiners rate
  // earnings against the business plan, not the industry, and raise no
  // finding for planned losses.
  const roa = trailingRoa(b);
  const deNovo = world.day - b.charteredDay < 3 * 365;
  let earnings = roa > 0.012 ? 1 : roa > 0.007 ? 2 : roa > 0.002 ? 3 : roa > -0.005 ? 4 : 5;
  if (deNovo) earnings = Math.min(earnings, 3);
  if (earnings >= 4) add('E', 'E', `Earnings: return on assets ${pct(roa)} over the last year. The bank is not earning its cost of capital.`);
  // Liquidity.
  const cashToAssets = b.acct.cash / Math.max(1, totalAssets(b.acct));
  const wholesale = (b.acct.fhlb + b.acct.brokered + b.acct.fedFundsPurchased) / Math.max(1, totalAssets(b.acct));
  const liquidity = cashToAssets > 0.08 && wholesale < 0.1 && b.uninsuredShare < 0.5 ? 1 : cashToAssets > 0.04 && wholesale < 0.25 ? 2 : cashToAssets > 0.02 ? 3 : b.liquidityStress > 0.5 ? 5 : 4;
  if (liquidity >= 3) add('L', 'L', `Liquidity: cash ${pct(cashToAssets, 1)} of assets, wholesale funding ${pct(wholesale, 0)}, uninsured deposits ${pct(b.uninsuredShare, 0)}. Hold more liquid assets and reduce reliance on borrowed money.`);
  // Sensitivity to market risk.
  const u = unrealizedToCapital(b);
  const sensitivity = u < 0.1 ? 1 : u < 0.25 ? 2 : u < 0.5 ? 3 : u < 0.8 ? 4 : 5;
  if (sensitivity >= 3) add('S', 'S', `Sensitivity: unrealized securities losses are ${pct(u, 0)} of tier 1 capital. Shorten the book or hedge.`);
  for (const f of findings) if (!raised.has(f.key)) f.resolved = true;
  const composite = Math.round((capital * 1.2 + assets * 1.5 + management * 1.3 + earnings + liquidity * 1.2 + sensitivity * 0.8) / 7);
  // Small, clean banks are examined every 18 months; everyone else, and
  // any bank under an action, every 12.
  const next = world.day + (composite <= 2 && totalAssets(b.acct) < THRESHOLD_DURBIN && b.enforcement === 'none' && findings.every((f) => f.resolved) ? 540 : 365);
  const result: Camels = { capital, assets, management, earnings, liquidity, sensitivity, composite: Math.max(1, Math.min(5, composite)), lastExam: world.day, nextExam: next, findings };
  b.camels = result;
  return result;
}

const LADDER: Record<Bank['enforcement'], number> = { none: 0, mou: 1, consent: 2, pca: 3 };
const LADDER_LABEL: Record<Bank['enforcement'], string> = { none: 'no action', mou: 'memorandum of understanding', consent: 'consent order', pca: 'prompt corrective action directive' };

// The ladder. A composite 3 brings a memorandum; a 4, unresolved findings
// or undercapitalization a consent order with real restrictions; a 5 or
// significant undercapitalization a PCA directive with a 90 day clock.
function escalate(ctx: Ctx, b: Bank, stack: CapitalStack): void {
  const { world } = ctx;
  const c = b.camels;
  const unresolved = c.findings.filter((f) => !f.resolved && f.day < world.day).length;
  const unresolvedTwoCycles = c.findings.filter((f) => !f.resolved && world.day - f.day > 730).length;
  let target: Bank['enforcement'] = 'none';
  if (c.composite >= 3 || unresolved > 0) target = 'mou';
  if (c.composite >= 4 || unresolvedTwoCycles > 0 || stack.category === 'under') target = 'consent';
  if (c.composite >= 5 || stack.category === 'significant' || stack.category === 'critical') target = 'pca';
  if (LADDER[target] > LADDER[b.enforcement]) {
    b.enforcement = target;
    b.enforcementSince = world.day;
    b.enforcementAssets = totalAssets(b.acct);
    if (b.kind === 'player') {
      const lines = target === 'mou'
        ? ['Informal action. Fix the findings before the next exam or it becomes an order.']
        : target === 'consent'
          ? ['No dividends. No growth beyond runoff. No brokered deposits. Raise capital or sell within twelve months.', 'Ignore it and the next step is a directive with a 90 day clock.']
          : ['Recapitalize to adequately capitalized within 90 days or the bank is closed.'];
      addPending(ctx, {
        kind: 'enforcement',
        bankId: b.id,
        title: `Enforcement: ${LADDER_LABEL[target]} (CAMELS ${c.composite})`,
        lines: [...c.findings.filter((f) => !f.resolved).map((f) => `${f.component}: ${f.text}`), ...lines],
        options: [{ key: 'k', label: 'Acknowledge' }],
        data: { level: target },
      });
      milestone(ctx, `Regulators issued a ${LADDER_LABEL[target]}`);
    }
  } else if (LADDER[target] < LADDER[b.enforcement] && c.composite <= 2 && stack.category === 'well') {
    emit(ctx, 'regulator', `${b.name}: the ${LADDER_LABEL[b.enforcement]} is lifted after a clean exam`, { severity: 'good', bankId: b.id });
    b.enforcement = 'none';
    b.enforcementSince = null;
    b.enforcementAssets = null;
  }
}

export function examsMonthly(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status !== 'open' || b.kind === 'aggregate') continue;
    if (world.day < b.camels.nextExam) continue;
    const before = b.camels.composite;
    const result = examine(ctx, b);
    const stack = capitalStack(b);
    if (b.kind === 'player') {
      const open = result.findings.filter((f) => !f.resolved);
      addPending(ctx, {
        kind: 'exam_result',
        bankId: b.id,
        title: `Exam closed: CAMELS ${result.composite} (C${result.capital} A${result.assets} M${result.management} E${result.earnings} L${result.liquidity} S${result.sensitivity})`,
        lines: [
          `Capital: CET1 ${pct(stack.cet1Ratio, 1)}, tier 1 ${pct(stack.tier1Ratio, 1)}, total ${pct(stack.totalRatio, 1)}, leverage ${pct(stack.leverage, 1)}${stack.cblr ? ' (community bank leverage ratio)' : ''}: ${PCA_LABEL[stack.category]}.`,
          ...(open.length === 0 ? ['No findings.'] : open.map((f) => `${f.component}: ${f.text}`)),
          `Next exam about ${formatDate(result.nextExam)}. Insurance assessment ${assessmentRate(b)} basis points.`,
        ],
        options: [{ key: 'k', label: 'Acknowledge' }],
        data: {},
      });
      if (result.composite !== before) emit(ctx, 'regulator', `CAMELS moved from ${before} to ${result.composite}`, { severity: result.composite > before ? 'alert' : 'good', bankId: b.id });
    }
    escalate(ctx, b, stack);
  }
}

// Risk based assessment rate in basis points of assets less tangible
// equity: the FDIC schedule by capital and CAMELS, with a surcharge for
// heavy brokered and uninsured funding at large banks.
export function assessmentRate(b: Bank): number {
  const stack = capitalStack(b);
  const c = b.camels.composite;
  let bp: number;
  if (stack.category === 'well' && c <= 2) bp = 5;
  else if (c <= 3) bp = 10;
  else bp = 20;
  if (totalAssets(b.acct) >= THRESHOLD_DURBIN) {
    bp = Math.max(4, bp - 1);
    const wholesale = (b.acct.brokered + b.acct.fhlb) / Math.max(1, totalDeposits(b.acct));
    if (wholesale > 0.15 || b.uninsuredShare > 0.6) bp += 2;
  }
  return bp;
}

export function regulationMonthly(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status === 'failed' || b.status === 'acquired') continue;
    const stack = capitalStack(b);
    const lev = stack.leverage;
    b.underMonths = stack.category === 'well' || stack.category === 'adequate' ? 0 : b.underMonths + 1;
    // PCA: critically undercapitalized closes now; a directive's 90 day
    // clock closes a bank that stays significantly undercapitalized; a bank
    // undercapitalized for a year without a restoration closes too.
    const pcaExpired = b.enforcement === 'pca' && b.enforcementSince !== null && world.day - b.enforcementSince > 90 && (stack.category === 'significant' || stack.category === 'critical');
    const prolonged = b.underMonths >= 12 && (stack.category === 'significant' || stack.category === 'critical');
    if (b.status === 'open' && (stack.category === 'critical' || pcaExpired || prolonged)) {
      b.status = 'closing';
      b.closureDay = nextFriday(world.day);
      emit(ctx, 'regulator', `${b.name} is ${stack.category === 'critical' ? 'critically undercapitalized' : 'undercapitalized with no restoration'} at ${pct(lev)} leverage. Closure scheduled.`, {
        severity: 'alert',
        bankId: b.id,
      });
    } else if (b.status === 'closing' && (stack.category === 'well' || stack.category === 'adequate')) {
      b.status = 'open';
      b.closureDay = null;
      emit(ctx, 'regulator', `${b.name} recapitalized to ${pct(lev)} leverage. Closure withdrawn.`, { severity: 'good', bankId: b.id });
    } else if (b.status === 'open' && b.kind !== 'aggregate' && (stack.category === 'under' || stack.category === 'significant') && b.enforcement !== 'pca' && stack.category === 'significant') {
      b.enforcement = 'pca';
      b.enforcementSince = world.day;
      b.enforcementAssets = totalAssets(b.acct);
      if (b.kind === 'player') {
        addPending(ctx, {
          kind: 'enforcement',
          bankId: b.id,
          title: 'Prompt corrective action directive',
          lines: [`${PCA_LABEL[stack.category]}: leverage ${pct(lev, 1)}, CET1 ${pct(stack.cet1Ratio, 1)}.`, 'Recapitalize to adequately capitalized within 90 days or the bank is closed. No dividends, no growth, no brokered deposits.'],
          options: [{ key: 'k', label: 'Acknowledge' }],
          data: { level: 'pca' },
        });
      }
    } else if (b.id === world.playerBankId && stack.category !== 'well' && b.status === 'open' && world.day % 30 === 0) {
      emit(ctx, 'regulator', `Capital: ${PCA_LABEL[stack.category]} (CET1 ${pct(stack.cet1Ratio, 1)}, leverage ${pct(lev, 1)}). Dividends restricted.`, { severity: 'alert', bankId: b.id });
    }
    // Resolution plans above $50B: a standing cost.
    if (totalAssets(b.acct) >= THRESHOLD_RESOLUTION && b.status === 'open') {
      const cost = Math.round((totalAssets(b.acct) * 0.0001) / 12);
      post(b.acct, { cash: -cost, retainedEarnings: -cost });
      b.is.month.otherExpense += cost;
    }
  }
  examsMonthly(ctx);
  swapsMonthly(ctx);
}

// Annual supervisory stress test above $100B: a severe recession's nine
// quarter losses against capital. Failing blocks dividends for a year
// and sets a stress capital buffer.
export function stressTestAnnual(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status !== 'open' || b.kind === 'aggregate' || totalAssets(b.acct) < THRESHOLD_STRESS) continue;
    let losses = 0;
    for (const p of b.pools) {
      const tp = TYPE[p.type];
      const lgd = Math.min(0.95, lgdNow(world, p.type) + 0.15);
      for (let g = 0; g < GRADES; g++) losses += (p.grades[g] ?? 0) * Math.min(1, (PD_BY_GRADE[g] ?? 1) * Math.min(tp.crisisCap, 8) * 2.25) * lgd;
    }
    for (const l of b.loans) if (l.status !== 'paid' && l.status !== 'chargedOff') losses += l.balance * Math.min(1, l.truePd * 6) * l.trueLgd;
    // Securities: a 200bp shock against the book; trading: a quarter of the book.
    losses += b.lots.reduce((s, l) => s + l.cost * l.duration * 0.02, 0);
    losses += (b.linesAssets?.trading ?? 0) * 0.25;
    losses = Math.round(losses);
    const stack = capitalStack(b);
    const ratioAfter = (stack.cet1 - losses) / stack.rwa;
    const passed = ratioAfter >= CET1_MIN;
    const buffer = Math.max(BUFFER, (stack.cet1 - Math.max(0, stack.cet1 - losses)) / stack.rwa);
    b.stressTest = { day: world.day, passed, losses, buffer };
    if (b.kind === 'player') {
      emit(ctx, 'regulator', `Stress test: projected nine quarter losses ${money(losses)}, CET1 falls to ${pct(ratioAfter, 1)} against ${pct(CET1_MIN, 1)}. ${passed ? 'Passed.' : 'Failed: dividends and buybacks are blocked for a year.'} Stress capital buffer ${pct(buffer, 1)}.`, { severity: passed ? 'good' : 'alert', bankId: b.id });
      if (!passed) milestone(ctx, 'Failed the supervisory stress test');
    }
  }
}

// SIFI liquidity above $250B: high quality liquid assets against a month
// of stressed outflows. A shortfall is a finding and a monthly cost of
// carrying the gap in Treasuries.
export function liquidityCoverage(b: Bank): { hqla: number; outflows: number; ratio: number } {
  const a = b.acct;
  let hqla = a.cash;
  for (const l of b.lots) hqla += l.fair * (l.product === 'treasury' ? 1 : 0.85);
  const outflows = Math.round(totalDeposits(a) * (0.1 + 0.3 * b.uninsuredShare) + a.fedFundsPurchased + a.brokered * 0.5);
  return { hqla, outflows, ratio: outflows > 0 ? hqla / outflows : 9 };
}

export function decideRegulatory(ctx: Ctx, pending: Pending, d: Decision): void {
  void ctx;
  void pending;
  void d;
}

// Swaps: pay fixed, receive floating, marked through AOCI. Unlocked at
// regional scale (D16). Monthly: net settlement to income, mark to AOCI,
// tenor runs off.
export const SWAP_FLOOR = 1e9;

export function enterSwap(ctx: Ctx, b: Bank, notional: number, tenor: number): boolean {
  const { world } = ctx;
  if (totalAssets(b.acct) < SWAP_FLOOR) return false;
  notional = Math.round(notional);
  if (notional <= 0 || notional > b.acct.securitiesAFS + b.acct.securitiesHTM) return false;
  const fixed = tenor <= 2 ? world.economy.curve.y2 : tenor <= 10 ? world.economy.curve.y2 + ((world.economy.curve.y10 - world.economy.curve.y2) * (tenor - 2)) / 8 : world.economy.curve.y10;
  b.swaps.push({ id: nextId(world, 'sw'), notional, fixed: Math.round(fixed * 10_000) / 10_000, tenor, startedDay: world.day, value: 0 });
  emit(ctx, 'system', `Entered a ${tenor} year pay fixed swap on ${money(notional)} at ${pct(fixed)}`, { bankId: b.id });
  return true;
}

export function terminateSwap(ctx: Ctx, b: Bank, id: string): boolean {
  const s = b.swaps.find((x) => x.id === id);
  if (!s) return false;
  // Settle the mark in cash: a gain comes in, a loss goes out, through AOCI.
  if (s.value > 0) post(b.acct, { cash: s.value, otherAssets: -s.value });
  else if (s.value < 0) post(b.acct, { cash: s.value, otherLiabilities: s.value });
  if (s.value !== 0) post(b.acct, { aoci: -s.value, retainedEarnings: s.value });
  b.is.month.securitiesGains += s.value;
  b.swaps = b.swaps.filter((x) => x.id !== id);
  emit(ctx, 'system', `Terminated the swap on ${money(s.notional)} for ${money(Math.abs(s.value))} ${s.value >= 0 ? 'gain' : 'loss'}`, { bankId: b.id });
  return true;
}

export function swapsMonthly(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.swaps.length === 0 || b.status !== 'open') continue;
    const floating = world.economy.fedFunds;
    const keep: typeof b.swaps = [];
    for (const s of b.swaps) {
      const net = Math.round((s.notional * (floating - s.fixed)) / 12);
      if (net !== 0) {
        post(b.acct, { cash: net, retainedEarnings: net });
        b.is.month.interestSecurities += net;
      }
      const current = s.tenor <= 2 ? world.economy.curve.y2 : s.tenor <= 10 ? world.economy.curve.y2 + ((world.economy.curve.y10 - world.economy.curve.y2) * (s.tenor - 2)) / 8 : world.economy.curve.y10;
      const value = Math.round(s.notional * s.tenor * (current - s.fixed));
      const delta = value - s.value;
      if (delta !== 0) {
        // Positive value sits in other assets, negative in other liabilities.
        const prevAsset = Math.max(0, s.value);
        const prevLiab = Math.max(0, -s.value);
        const newAsset = Math.max(0, value);
        const newLiab = Math.max(0, -value);
        post(b.acct, { otherAssets: newAsset - prevAsset, otherLiabilities: newLiab - prevLiab, aoci: delta });
        s.value = value;
      }
      s.tenor = Math.max(0, s.tenor - 1 / 12);
      if (s.tenor > 0.05) keep.push(s);
      else if (s.value !== 0) {
        post(b.acct, { otherAssets: -Math.max(0, s.value), otherLiabilities: -Math.max(0, -s.value), aoci: -s.value });
      }
    }
    b.swaps = keep;
  }
}

export function playerLeverage(world: World): number | null {
  const b = world.playerBankId ? world.banks[world.playerBankId] : undefined;
  return b ? leverageRatio(b.acct) : null;
}

export { LADDER_LABEL };
