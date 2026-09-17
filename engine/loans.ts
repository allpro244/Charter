// The relationship book (D29): individual loans for the player's bank, each
// with a borrower, a memo, a decision record, and a full lifecycle: funding,
// payments on the payment day, delinquency, nonaccrual, workout,
// foreclosure, REO, sale, charge-off. Capped in count; the smallest and
// oldest roll into pools. Every default names the signal that predicted it.

import { type Application, attributionFor, gradeFromZ, scoreSignals } from './borrowers';
import { TYPE, addToPool, lgdNow, stressFor, chargeOff } from './credit';
import { type Ctx, emit } from './ctx';
import { sectorReturn12 } from './economy';
import { post } from './ledger';
import { type Rng, chance, rand, randInt, randNormal } from './rng';
import { type Bank, type Loan, type LoanType, type World, nextId } from './state';
import { dateOf, daysInMonth, formatDate } from './time';
import { money } from './format';

export const RELATIONSHIP_CAP = 500;
const HISTORY_KEEP_DAYS = 730;

export interface LossRecord {
  day: number;
  loanId: string;
  borrower: string;
  type: LoanType;
  amount: number;
  decidedBy: string;
  decidedOn: number;
  signal: string;
}

export interface FundTerms {
  amount: number;
  rate: number;
  termMonths: number;
  ltv: number;
  guarantor: boolean;
}

function levelPayment(amount: number, rate: number, term: number): number {
  const r = rate / 12;
  if (r <= 0) return Math.round(amount / term);
  return Math.round((amount * r) / (1 - Math.pow(1 + r, -term)));
}

export function fundLoan(ctx: Ctx, b: Bank, app: Application, terms: FundTerms, by: Loan['decision']['by'], note: string, countered: boolean): Loan {
  const { world } = ctx;
  const loan: Loan = {
    id: nextId(world, 'l'),
    type: app.type,
    county: app.county,
    borrower: app.borrower,
    memo: { ...app.memo, amount: terms.amount, rate: terms.rate, termMonths: terms.termMonths, ltv: terms.ltv, guarantor: terms.guarantor },
    originated: world.day,
    principal: terms.amount,
    balance: terms.amount,
    rate: terms.rate,
    termMonths: terms.termMonths,
    paymentDay: randInt(world.rng, 1, 28),
    payment: levelPayment(terms.amount, terms.rate, Math.min(terms.termMonths, 360)),
    grade: app.memo.suggestedGrade,
    status: 'current',
    monthsLate: 0,
    accrued: 0,
    truePd: app.truePd,
    trueLgd: app.trueLgd,
    hidden: app.hidden,
    decision: { by, day: world.day, countered, note },
    attribution: null,
    lossToDate: 0,
    reoValue: 0,
    signals: app.signals,
  };
  post(b.acct, { loans: terms.amount, cash: -terms.amount });
  b.originationsByType[app.type] += terms.amount;
  b.loans.push(loan);
  rollToPools(ctx, b);
  return loan;
}

export function isActive(l: Loan): boolean {
  return l.status !== 'paid' && l.status !== 'chargedOff' && l.status !== 'reo';
}

export function isAccruing(l: Loan): boolean {
  return l.status === 'current' || l.status === 'late30' || l.status === 'late60';
}

// Over the cap, the smallest and oldest loans roll into pools by type and
// vintage at their grade. Paid and charged-off loans age out of the list.
export function rollToPools(ctx: Ctx, b: Bank): void {
  const { world } = ctx;
  b.loans = b.loans.filter((l) => isActive(l) || l.status === 'reo' || world.day - l.originated < HISTORY_KEEP_DAYS || (l.decision.day > world.day - HISTORY_KEEP_DAYS && l.lossToDate > 0));
  const active = b.loans.filter(isActive);
  if (active.length <= RELATIONSHIP_CAP) return;
  const excess = active.length - RELATIONSHIP_CAP;
  const ranked = [...active].sort((x, y) => x.balance * (1 + (x.originated - y.originated) / 3650) - y.balance);
  const rolled = new Set<string>();
  for (let i = 0; i < excess; i++) {
    const l = ranked[i] as Loan;
    addToPool(world, b, l.type, l.balance, l.rate, 1, l.grade, dateOf(l.originated).y);
    rolled.add(l.id);
  }
  b.loans = b.loans.filter((l) => !rolled.has(l.id));
}

// Daily: payments on the payment day. A borrower pays or misses by true
// PD under current stress; late loans cure with a falling probability.
export function loansDaily(ctx: Ctx, b: Bank): void {
  const { world } = ctx;
  const { y, m, d } = dateOf(world.day);
  const last = daysInMonth(y, m);
  let stressCache: Partial<Record<LoanType, number>> = {};
  for (const l of b.loans) {
    if (!isActive(l)) continue;
    if (Math.min(l.paymentDay, last) !== d) continue;
    let s = stressCache[l.type];
    if (s === undefined) {
      s = Math.pow(stressFor(world, b, l.type), 0.7);
      stressCache[l.type] = s;
    }
    const pMissBase = 1 - Math.pow(1 - Math.min(0.95, l.truePd * s), 1 / 12);
    let pays: boolean;
    switch (l.status) {
      case 'current':
        pays = !chance(world.rng, pMissBase);
        break;
      case 'late30':
        pays = chance(world.rng, 0.45 - 0.2 * Math.min(1, pMissBase * 6));
        break;
      case 'late60':
        pays = chance(world.rng, 0.3 - 0.15 * Math.min(1, pMissBase * 6));
        break;
      case 'late90':
        pays = chance(world.rng, 0.2);
        break;
      default:
        pays = chance(world.rng, 0.12);
    }
    if (pays) receivePayment(ctx, b, l);
    else missPayment(ctx, b, l);
  }
  stressCache = {};
}

function receivePayment(ctx: Ctx, b: Bank, l: Loan): void {
  const a = b.acct;
  const payment = Math.min(l.payment, l.balance + Math.max(0, l.accrued));
  if (isAccruing(l)) {
    const interest = Math.min(Math.max(0, l.accrued), payment);
    const principal = Math.min(l.balance, payment - interest);
    post(a, { cash: interest + principal, loans: -principal, interestReceivable: -interest });
    l.accrued -= interest;
    l.balance -= principal;
    if (l.status !== 'current') {
      l.status = l.status === 'late60' ? 'late30' : 'current';
      l.monthsLate = Math.max(0, l.monthsLate - 1);
    }
  } else {
    // Nonaccrual: cost recovery, everything to principal.
    const principal = Math.min(l.balance, payment);
    post(a, { cash: principal, loans: -principal });
    l.balance -= principal;
    if (l.status === 'late90') {
      l.status = 'late60';
      l.monthsLate = Math.max(0, l.monthsLate - 1);
    } else if (l.status === 'nonaccrual' || l.status === 'workout') {
      l.monthsLate = Math.max(0, l.monthsLate - 1);
      if (l.monthsLate === 0) {
        l.status = 'current';
        l.grade = Math.min(l.grade, 6);
        emit(ctx, 'borrower', `${l.borrower} brought the ${TYPE[l.type].label} loan current`, { severity: 'good', bankId: b.id, ref: { kind: 'loan', id: l.id } });
      }
    }
  }
  if (l.balance <= 0) {
    l.status = 'paid';
    l.balance = 0;
    emit(ctx, 'borrower', `${l.borrower} paid off the ${TYPE[l.type].label} loan`, { bankId: b.id, ref: { kind: 'loan', id: l.id } });
  }
}

function missPayment(ctx: Ctx, b: Bank, l: Loan): void {
  const { world } = ctx;
  l.monthsLate += 1;
  const prev = l.status;
  if (l.status === 'current') l.status = 'late30';
  else if (l.status === 'late30') l.status = 'late60';
  else if (l.status === 'late60') l.status = 'late90';
  else if (l.status === 'late90') l.status = 'nonaccrual';
  if (prev === 'current') {
    emit(ctx, 'borrower', `${l.borrower} missed a ${money(l.payment)} payment on the ${TYPE[l.type].label} loan`, { severity: 'alert', bankId: b.id, ref: { kind: 'loan', id: l.id } });
    l.grade = Math.max(l.grade, 5);
  } else if (l.status === 'late90' && prev === 'late60') {
    l.grade = Math.max(l.grade, 6);
  }
  if (l.status === 'nonaccrual' && prev !== 'nonaccrual') {
    // Reverse accrued interest; stop accruing. Name the signal (D34).
    if (l.accrued > 0) {
      post(b.acct, { interestReceivable: -l.accrued, retainedEarnings: -l.accrued });
      b.is.month.interestLoans -= l.accrued;
      b.interestByType[l.type] -= l.accrued;
      l.accrued = 0;
    }
    l.grade = Math.max(l.grade, 7);
    l.attribution = attributionFor(l);
    emit(ctx, 'borrower', `${l.borrower} is 90 days past due on ${money(l.balance)}: nonaccrual. ${l.attribution} predicted it. ${decidedText(l)}.`, {
      severity: 'alert',
      bankId: b.id,
      ref: { kind: 'loan', id: l.id },
    });
    void world;
  }
}

export function decidedText(l: Loan): string {
  const who = l.decision.by === 'player' ? 'You approved it' : l.decision.by === 'auto' ? 'Auto-approved under policy' : 'Inherited with the bank';
  return `${who} on ${formatDate(l.decision.day)}${l.decision.countered ? ' after a counter' : ''}`;
}

// Monthly: interest accrual on accruing loans, grade review, resolution of
// nonaccrual loans by workout, foreclosure to REO, or charge-off, REO sales.
export function loansMonthly(ctx: Ctx, b: Bank, days: number, losses: LossRecord[]): void {
  const { world } = ctx;
  const a = b.acct;
  const r = world.rng;
  let accrual = 0;
  for (const l of b.loans) {
    if (isActive(l) && isAccruing(l)) {
      const i = Math.round((l.balance * l.rate * days) / 365);
      l.accrued += i;
      accrual += i;
      b.interestByType[l.type] += i;
    }
  }
  if (accrual > 0) {
    post(a, { interestReceivable: accrual, retainedEarnings: accrual });
    b.is.month.interestLoans += accrual;
  }
  for (const l of b.loans) {
    if (l.status === 'reo') {
      sellReo(ctx, b, l, r);
      continue;
    }
    if (!isActive(l)) continue;
    // Prepayment in full.
    if (isAccruing(l) && chance(r, 1 - Math.pow(1 - TYPE[l.type].cpr, 1 / 12))) {
      post(a, { cash: l.balance + Math.max(0, l.accrued), loans: -l.balance, interestReceivable: -Math.max(0, l.accrued) });
      l.balance = 0;
      l.accrued = 0;
      l.status = 'paid';
      continue;
    }
    // Grade review: the bank's grade drifts toward what the memo and the
    // economy say, with the CCO's noise.
    if (isAccruing(l) && chance(r, 0.2)) regrade(world, b, l);
    if (l.status === 'nonaccrual' || l.status === 'workout') {
      if (l.status === 'nonaccrual' && l.monthsLate >= 6) l.status = 'workout';
      if (l.monthsLate >= 9) resolveDefault(ctx, b, l, losses);
    }
  }
}

function regrade(world: World, b: Bank, l: Loan): void {
  const m = l.memo;
  const signals = scoreSignals({
    dscr: m.dscr,
    ltv: m.ltv,
    leverage: m.leverage,
    guarantor: m.guarantor,
    paymentHistory: m.paymentHistory,
    tenure: m.tenureYears,
    sectorMove: sectorReturn12(world.economy, m.sector),
    type: l.type,
    sizeToCapital: 0,
  });
  let z = 0;
  for (const s of signals) z += s.contribution;
  const base = gradeFromZ(z + baseFor(l.type), l.type);
  const target = Math.max(1, Math.min(7, base + (l.monthsLate > 0 ? 1 : 0)));
  const noise = randNormal(world.rng, 0, 0.6);
  const next = Math.round(target + noise);
  l.grade = Math.max(1, Math.min(l.status === 'current' ? 6 : 7, next));
  void b;
}

function baseFor(type: LoanType): number {
  return { ci: -4.2, cre_oo: -4.6, cre_inv: -4.5, construction: -3.9, resi: -4.8, consumer: -3.5, ag: -4.6, energy: -3.7, cards: -3.2 }[type];
}

// Foreclosure or charge-off. Real estate goes to REO at liquidation value
// after local home prices; everything else is charged off at LGD with the
// rest recovered in cash.
function resolveDefault(ctx: Ctx, b: Bank, l: Loan, losses: LossRecord[]): void {
  const { world } = ctx;
  const a = b.acct;
  const realEstate = l.type === 'resi' || l.type === 'cre_oo' || l.type === 'cre_inv' || l.type === 'construction' || (l.type === 'ag' && l.memo.collateralType === 'farmland');
  const county = world.geo.counties[l.county];
  const localHpi = county ? county.localHpi / 100 : 1;
  let recovery: number;
  if (realEstate) {
    recovery = Math.round(l.memo.collateralValue * localHpi * 0.82 * (1 - 0.3 * Math.max(0, l.trueLgd - 0.2)));
  } else {
    recovery = Math.round(l.balance * (1 - Math.min(0.95, l.trueLgd * lgdNow(world, l.type) / TYPE[l.type].lgd)));
  }
  recovery = Math.max(0, Math.min(l.balance, recovery));
  const loss = l.balance - recovery;
  if (loss > 0) {
    chargeOff(b, loss);
    b.chargeOffsByType[l.type] += loss;
    b.lifetimeChargeOffsByType[l.type] += loss;
    l.lossToDate += loss;
    losses.push({ day: world.day, loanId: l.id, borrower: l.borrower, type: l.type, amount: loss, decidedBy: l.decision.by, decidedOn: l.decision.day, signal: l.attribution ?? attributionFor(l) });
  }
  if (realEstate) {
    if (recovery > 0) post(a, { reo: recovery, loans: -recovery });
    l.reoValue = recovery;
    l.balance = 0;
    l.status = 'reo';
    emit(ctx, 'borrower', `Foreclosed on ${l.borrower}: ${money(loss)} charged off, ${money(recovery)} of ${l.memo.collateralType} to REO. ${decidedText(l)}.`, {
      severity: 'alert',
      bankId: b.id,
      ref: { kind: 'loan', id: l.id },
    });
  } else {
    if (recovery > 0) post(a, { cash: recovery, loans: -recovery });
    l.balance = 0;
    l.status = 'chargedOff';
    emit(ctx, 'borrower', `Charged off ${money(loss)} on ${l.borrower}, recovered ${money(recovery)}. ${l.attribution ?? attributionFor(l)} predicted it. ${decidedText(l)}.`, {
      severity: 'alert',
      bankId: b.id,
      ref: { kind: 'loan', id: l.id },
    });
  }
}

function sellReo(ctx: Ctx, b: Bank, l: Loan, r: Rng): void {
  if (!chance(r, 0.12)) return;
  const a = b.acct;
  const county = ctx.world.geo.counties[l.county];
  const drift = county ? county.localHpi / 100 : 1;
  const price = Math.round(l.reoValue * (0.9 + 0.2 * rand(r)) * Math.pow(drift, 0.3));
  const gain = price - l.reoValue;
  post(a, { cash: price, reo: -l.reoValue, retainedEarnings: gain });
  if (gain >= 0) b.is.month.feeIncome += gain;
  else b.is.month.otherExpense += -gain;
  l.reoValue = 0;
  l.status = 'chargedOff';
  emit(ctx, 'borrower', `Sold REO from ${l.borrower} for ${money(price)} (${gain >= 0 ? 'gain' : 'loss'} ${money(Math.abs(gain))})`, { bankId: b.id, ref: { kind: 'loan', id: l.id } });
}

// Takeover: the bank comes with a book of existing relationship loans,
// inherited with someone else's decisions. Balance moves out of the pools
// so the ledger does not change.
export function inheritBook(ctx: Ctx, b: Bank, apps: Application[], r: Rng, criticized: number): void {
  const { world } = ctx;
  for (const app of apps) {
    const pool = b.pools.filter((p) => p.type === app.type && p.balance > app.memo.amount * 2);
    if (pool.length === 0) continue;
    const p = pool[randInt(r, 0, pool.length - 1)]!;
    let amount = app.memo.amount;
    // Take from performing grades first.
    let taken = 0;
    for (let g = 0; g < 6 && taken < amount; g++) {
      const x = Math.min(p.grades[g] ?? 0, amount - taken);
      p.grades[g] = (p.grades[g] ?? 0) - x;
      taken += x;
    }
    amount = taken;
    if (amount <= 0) continue;
    p.balance -= amount;
    p.count = Math.max(1, p.count - 1);
    const age = randInt(r, 3, Math.max(4, Math.min(app.memo.termMonths - 6, 60)));
    const bad = chance(r, criticized * 2.5);
    const loan: Loan = {
      id: nextId(world, 'l'),
      type: app.type,
      county: app.county,
      borrower: app.borrower,
      memo: app.memo,
      originated: world.day - age * 30,
      principal: Math.round(amount * 1.1),
      balance: amount,
      rate: app.memo.rate,
      termMonths: app.memo.termMonths,
      paymentDay: randInt(r, 1, 28),
      payment: levelPayment(Math.round(amount * 1.1), app.memo.rate, Math.min(app.memo.termMonths, 360)),
      grade: bad ? randInt(r, 6, 7) : app.memo.suggestedGrade,
      status: bad ? (chance(r, 0.5) ? 'late30' : 'late60') : 'current',
      monthsLate: bad ? 1 : 0,
      accrued: 0,
      truePd: bad ? Math.min(0.6, app.truePd * 4) : app.truePd,
      trueLgd: app.trueLgd,
      hidden: app.hidden,
      decision: { by: 'inherited', day: world.day - age * 30, countered: false, note: 'on the books at takeover' },
      attribution: null,
      lossToDate: 0,
      reoValue: 0,
      signals: app.signals,
    };
    b.loans.push(loan);
  }
}
