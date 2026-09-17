// Earnings review (D34, SYSTEMS.md system 8). Quarterly. Attributes every
// dollar: income by book, cost by deposit type, losses by loan and by the
// decision that made them, overhead, provision, tax. Ties to the ledger.

import { TYPE } from './credit';
import { type Ctx, emit } from './ctx';
import { interestIncome, netIncome } from './ledger';
import { LOAN_TYPES, type Bank, type QuarterReview, type World } from './state';
import { quarterOf } from './time';
import { money, pct } from './format';

export function buildReview(world: World, b: Bank): QuarterReview {
  const q = b.is.quarter;
  const { y, q: qn } = quarterOf(world.day);
  const interestByBook: QuarterReview['interestByBook'] = [];
  let loansSum = 0;
  for (const t of LOAN_TYPES) {
    const x = b.interestByType[t];
    if (x !== 0) interestByBook.push({ book: TYPE[t].label, amount: x });
    loansSum += x;
  }
  // Interest on loans in the ledger not attributed to a type (none expected,
  // kept as a line so the review always ties).
  const unattributed = q.interestLoans - loansSum;
  if (unattributed !== 0) interestByBook.push({ book: 'Loans, other', amount: unattributed });
  const lossesByLoan = b.losses.map((l) => ({ loan: l.borrower, type: l.type, amount: l.amount, decidedBy: l.decidedBy, decidedOn: l.decidedOn, signal: l.signal }));
  const lossesByPool: QuarterReview['lossesByPool'] = [];
  for (const t of LOAN_TYPES) {
    const relbook = b.losses.filter((l) => l.type === t).reduce((s, l) => s + l.amount, 0);
    const pool = b.chargeOffsByType[t] - relbook;
    if (pool !== 0) lossesByPool.push({ type: t, amount: pool });
  }
  const review: QuarterReview = {
    quarter: `${y}Q${qn}`,
    day: world.day,
    netIncome: 0,
    interestByBook,
    depositCostByType: [
      { type: 'checking', amount: q.interestChecking },
      { type: 'savings', amount: q.interestSavings },
      { type: 'money market', amount: q.interestMmda },
      { type: 'certificates', amount: q.interestCd },
      { type: 'brokered', amount: q.interestBrokered },
    ],
    otherInterestExpense: q.interestBorrowings,
    otherInterestIncome: q.interestSecurities + q.interestCash,
    lossesByLoan,
    lossesByPool,
    recoveries: q.recoveries,
    provision: q.provision,
    feeIncome: q.feeIncome,
    securitiesGains: q.securitiesGains,
    overhead: { salaries: q.salaries, occupancy: q.occupancy, other: q.otherExpense, assessment: q.assessment },
    tax: q.tax,
    ledgerNetIncome: netIncome(q),
  };
  // Net income rebuilt from the attribution lines. Charge-offs are not a
  // P and L line (the provision is), so the losses lists are memo items.
  const income = interestByBook.reduce((s, x) => s + x.amount, 0) + review.otherInterestIncome;
  const depositCost = review.depositCostByType.reduce((s, x) => s + x.amount, 0);
  const overhead = q.salaries + q.occupancy + q.otherExpense + q.assessment;
  review.netIncome = income - depositCost - review.otherInterestExpense - q.provision + q.feeIncome + q.securitiesGains - overhead - q.tax;
  if (review.netIncome !== review.ledgerNetIncome) {
    throw new Error(`earnings review does not tie: ${review.netIncome} vs ledger ${review.ledgerNetIncome} (interest ${income} vs ${interestIncome(q)})`);
  }
  return review;
}

export function reviewQuarterly(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id];
    if (!b || b.status === 'failed' || b.status === 'acquired') continue;
    if (b.id === world.playerBankId) {
      const review = buildReview(world, b);
      b.reviews.push(review);
      if (b.reviews.length > 400) b.reviews.shift();
      const assets = b.acct.cash + b.acct.loans - b.acct.allowance + b.acct.securitiesAFS + b.acct.securitiesHTM + b.acct.afsValuation + b.acct.reo + b.acct.interestReceivable + b.acct.premises + b.acct.goodwill + b.acct.otherAssets;
      const roa = assets > 0 ? (review.netIncome * 4) / assets : 0;
      emit(ctx, 'system', `${review.quarter} closed: net income ${money(review.netIncome)}, ROA ${pct(roa)}, provision ${money(review.provision)}, charge-offs ${money(b.is.quarter.chargeOffs)}. See the Earnings tab for the review.`, {
        severity: review.netIncome >= 0 ? 'good' : 'alert',
        bankId: b.id,
      });
    }
    for (const t of LOAN_TYPES) {
      b.interestByType[t] = 0;
      b.chargeOffsByType[t] = 0;
      b.recoveriesByType[t] = 0;
    }
    b.losses = [];
  }
}
