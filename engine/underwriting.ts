// Underwriting (D20, D32, rule 21). Applications arrive daily at the
// player's bank from its counties. Above the dial they pause with the memo;
// below it the CCO decides under the written policy with error. More than
// five above the dial in a day become one batch.

import { calibration } from '../data/calibration';
import { type Application, ccoReview, generateApplication } from './borrowers';
import { TYPE } from './credit';
import { type Ctx, addPending, emit } from './ctx';
import { fundLoan, type FundTerms } from './loans';
import { ccoSkill, cloAppetite, cloPricingEdge } from './officers';
import { chance, pick, rand } from './rng';
import { type Bank, type Decision, type LoanType, type Pending, type World, playerBank } from './state';
import { LOAN_TYPES, emptyByType } from './loantypes';
import { money, pct } from './format';
import { creConcentration, growthRestricted } from './regulation';
import { tier1Capital } from './ledger';

export const REGIME_DEMAND = { expansion: 1.1, late: 1.0, recession: 0.65, recovery: 0.9 } as const;

function poisson(world: World, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rand(world.rng);
  } while (p > L);
  return k - 1;
}

export function arrivalRate(world: World, b: Bank): number {
  const assets = b.acct.cash + b.acct.loans + b.acct.securitiesAFS + b.acct.securitiesHTM;
  const size = Math.max(0.5, Math.min(3, Math.pow(Math.max(assets, 1) / 100_000_000, 0.3)));
  const branches = Math.max(1, b.branches.length);
  return (0.25 + 0.3 * branches) * REGIME_DEMAND[world.economy.regime] * size * b.originationAppetite * cloAppetite(b);
}

// Your rate against the market moves who walks in: every 25 basis points
// under market brings about the calibrated share more borrowers of that
// type, every 25 over sends the same share away. Smooth, symmetric.
export function demandMultiplier(b: Bank, t: LoanType): number {
  const offset = b.pricing ? (b.pricing[t] ?? 0) : 0;
  if (offset === 0) return 1;
  const k = Math.log(1 + calibration.loanRateElasticity.typical / 100) / 0.0025;
  return Math.exp(-k * offset);
}

export const PRICING_MIN = -0.02;
export const PRICING_MAX = 0.03;

export function setPricing(world: World, t: LoanType, offset: number): void {
  const b = playerBank(world);
  if (!b) return;
  if (!b.pricing) b.pricing = emptyByType(0);
  b.pricing[t] = Math.max(PRICING_MIN, Math.min(PRICING_MAX, Math.round(offset * 10_000) / 10_000));
}

export function aboveDial(b: Bank, app: Application): boolean {
  return app.memo.amount > b.dial.maxAuto || app.memo.suggestedGrade > b.dial.minGrade;
}

export interface PolicyCheck {
  pass: boolean;
  reasons: string[];
}

export function policyCheck(b: Bank, app: Application, terms: FundTerms): PolicyCheck {
  const m = app.memo;
  const p = b.policy;
  const reasons: string[] = [];
  if (!p.allowed[app.type]) reasons.push(`${TYPE[app.type].label} lending is off`);
  if (m.dscr < p.minDscr) reasons.push(`coverage ${m.dscr.toFixed(2)}x under ${p.minDscr.toFixed(2)}x`);
  if (terms.ltv > p.maxLtv[app.type]) reasons.push(`LTV ${(terms.ltv * 100).toFixed(0)}% over ${(p.maxLtv[app.type] * 100).toFixed(0)}%`);
  if (m.leverage > p.maxLeverage) reasons.push(`leverage ${m.leverage.toFixed(1)}x over ${p.maxLeverage.toFixed(1)}x`);
  if (p.requireGuarantor && !terms.guarantor && m.employees > 0) reasons.push('no guarantor');
  if (terms.amount > p.maxSize) reasons.push(`size ${money(terms.amount)} over ${money(p.maxSize)}`);
  const sectorShare = sectorExposure(b, m.sector) ;
  if (sectorShare > p.sectorCap && b.acct.loans > 0) reasons.push(`${m.sector} concentration ${(sectorShare * 100).toFixed(0)}% over ${(p.sectorCap * 100).toFixed(0)}%`);
  // The interagency commercial real estate guidance is part of every
  // written policy: construction past 100% of capital, or investor CRE
  // past 300%, is an exception the CCO will not approve on their own.
  if (app.type === 'construction' || app.type === 'cre_inv') {
    const conc = creConcentration(b);
    const t1 = Math.max(1, tier1Capital(b.acct) + b.acct.allowance);
    const after = terms.amount / t1;
    if (app.type === 'construction' && conc.construction + after > 1.0) reasons.push(`construction would be ${((conc.construction + after) * 100).toFixed(0)}% of capital, guidance 100%`);
    if (conc.cre + after > 3.0) reasons.push(`investor CRE would be ${((conc.cre + after) * 100).toFixed(0)}% of capital, guidance 300%`);
  }
  return { pass: reasons.length === 0, reasons };
}

export function sectorExposure(b: Bank, sector: string): number {
  if (b.acct.loans <= 0) return 0;
  let x = 0;
  for (const l of b.loans) if (l.memo.sector === sector && l.status !== 'paid' && l.status !== 'chargedOff' && l.status !== 'reo') x += l.balance;
  // Pools carry no sector; count energy and ag pools as their sectors.
  for (const p of b.pools) {
    if (sector === 'energy' && p.type === 'energy') x += p.balance;
    if (sector === 'agriculture' && p.type === 'ag') x += p.balance;
    if (sector === 'construction' && p.type === 'construction') x += p.balance;
  }
  return x / b.acct.loans;
}

export function termsFrom(app: Application): FundTerms {
  return { amount: app.memo.amount, rate: app.memo.rate, termMonths: app.memo.termMonths, ltv: app.memo.ltv, guarantor: app.memo.guarantor };
}

export function memoLines(app: Application, b: Bank): string[] {
  const m = app.memo;
  const lines = [
    `${app.borrower}  ${TYPE[app.type].label}  ${m.purpose}`,
    `Amount ${money(m.amount)}  Term ${m.termMonths} months  Rate ${pct(m.rate)}  Suggested grade ${m.suggestedGrade}`,
    `Coverage ${m.dscr.toFixed(2)}x  LTV ${(m.ltv * 100).toFixed(0)}%  Leverage ${m.leverage.toFixed(1)}x  ${m.guarantor ? 'Guaranteed' : 'No guarantee'}`,
    `Collateral ${m.collateralType} valued ${money(m.collateralValue)}  History ${m.paymentHistory}  ${m.tenureYears.toFixed(1)} years in place`,
    `${m.employees > 0 ? `Revenue ${money(m.income)}, ${m.employees} employees` : `Household income ${money(m.income)}`}  Net worth ${money(m.netWorth)}  Sector ${m.sector}`,
    `CCO: ${m.summary}`,
  ];
  for (const f of m.redFlags) lines.push(`  flag: ${f}`);
  const check = policyCheck(b, app, termsFrom(app));
  if (!check.pass) lines.push(`Policy exceptions: ${check.reasons.join('; ')}`);
  return lines;
}

export function applicationsDaily(ctx: Ctx): void {
  const { world } = ctx;
  const b = playerBank(world);
  if (!b || b.status !== 'open' || !b.homeCounty) return;
  // Pricing under market on any type raises the arrival rate to the best
  // multiplier; each application then stays with the odds of its own type
  // against that best, so every type arrives at exactly its own rate.
  let best = 1;
  for (const t of LOAN_TYPES) best = Math.max(best, demandMultiplier(b, t));
  const n = poisson(world, arrivalRate(world, b) * best);
  if (n === 0) return;
  const skill = ccoSkill(b);
  const forPlayer: Application[] = [];
  for (let i = 0; i < n; i++) {
    const branch = b.branches.length > 0 ? pick(world.rng, b.branches) : null;
    const county = world.geo.counties[branch ? branch.county : b.homeCounty];
    if (!county) continue;
    const app = generateApplication(world, b, county, world.rng);
    const m = demandMultiplier(b, app.type);
    if (m < best && !chance(world.rng, m / best)) continue;
    const offset = b.pricing ? (b.pricing[app.type] ?? 0) : 0;
    app.memo.rate = Math.round((app.memo.rate + cloPricingEdge(b) + offset) * 10_000) / 10_000;
    ccoReview(app, b, skill, world.rng);
    b.applications.received += 1;
    if (!b.applicationsByType) b.applicationsByType = emptyByType(0);
    b.applicationsByType[app.type] += 1;
    if (aboveDial(b, app)) forPlayer.push(app);
    else autoDecide(ctx, b, app, skill);
  }
  if (forPlayer.length === 0) return;
  if (forPlayer.length > 5) {
    b.applications.toDesk += forPlayer.length;
    addPending(ctx, {
      kind: 'loan_batch',
      bankId: b.id,
      title: `${forPlayer.length} applications above the dial today, ${money(forPlayer.reduce((s, a) => s + a.memo.amount, 0))} in total`,
      lines: forPlayer.map((a) => `${a.borrower}  ${TYPE[a.type].label}  ${money(a.memo.amount)}  grade ${a.memo.suggestedGrade}  coverage ${a.memo.dscr.toFixed(2)}x  LTV ${(a.memo.ltv * 100).toFixed(0)}%${policyCheck(b, a, termsFrom(a)).pass ? '' : '  (policy exception)'}`),
      options: [
        { key: 'a', label: 'Approve all within policy, decline the rest' },
        { key: 'd', label: 'Decline all' },
        { key: 'r', label: 'Review one by one' },
      ],
      data: { apps: forPlayer },
    });
  } else {
    for (const app of forPlayer) queueApplication(ctx, b, app);
  }
}

export function queueApplication(ctx: Ctx, b: Bank, app: Application): void {
  b.applications.toDesk += 1;
  addPending(ctx, {
    kind: 'loan_application',
    bankId: b.id,
    title: `Loan application: ${app.borrower}, ${money(app.memo.amount)} ${TYPE[app.type].label}`,
    lines: memoLines(app, b),
    options: [
      { key: 'a', label: 'Approve as requested' },
      { key: 'c', label: 'Counter (rate up 100bp, LTV down 10 points, guarantee required)' },
      { key: 'd', label: 'Decline' },
    ],
    data: { app },
  });
}

// The CCO decides under policy. Error rises as skill falls: a wrong call
// is an approval that fails policy or a decline that passed it.
export function autoDecide(ctx: Ctx, b: Bank, app: Application, skill: number): void {
  const { world } = ctx;
  const terms = termsFrom(app);
  const check = policyCheck(b, app, terms);
  // Underwriting error is a marginal thing: a weak CCO misses a policy
  // exception on a loan that reads well enough, or turns away a good one.
  // Nobody funds a borrower who cannot cover the payment by mistake.
  // Turning away a good borrower is the common error; waving a policy
  // exception through is a quarter as common.
  const errorRate = 0.02 + 0.1 * (1 - skill / 100);
  let approve = check.pass && !growthRestricted(b);
  if (approve) {
    if (chance(world.rng, errorRate)) approve = false;
  } else if (app.memo.suggestedGrade <= 6 && app.memo.dscr >= 1 && chance(world.rng, errorRate / 4)) {
    approve = !growthRestricted(b);
  }
  // A loan is funded from cash the bank has: below a working cushion the
  // desk declines for lack of funding rather than overdrawing the Fed.
  const assets = b.acct.cash + b.acct.loans + b.acct.securitiesAFS + b.acct.securitiesHTM;
  if (approve && b.acct.cash - terms.amount < 0.03 * assets) {
    approve = false;
    b.applications.autoDeclined += 1;
    b.declinedForFunding = (b.declinedForFunding ?? 0) + 1;
    return;
  }
  if (approve) {
    fundLoan(ctx, b, app, terms, 'auto', check.pass ? 'within policy' : 'policy exception missed', false);
    b.applications.autoApproved += 1;
    b.applications.autoApprovedAmount += terms.amount;
    if (terms.amount > 0.02 * Math.max(1, b.acct.commonStock + b.acct.retainedEarnings)) {
      emit(ctx, 'borrower', `Auto-approved ${money(terms.amount)} ${TYPE[app.type].label} to ${app.borrower} (grade ${app.memo.suggestedGrade})`, { bankId: b.id });
    }
  } else {
    b.applications.autoDeclined += 1;
  }
}

// Counter terms: rate up, LTV down, guarantee. Acceptance falls with the
// distance from the request. A tighter loan is a safer loan.
export function counterTerms(app: Application): FundTerms {
  const m = app.memo;
  const ltv = Math.max(0.3, m.ltv - 0.1);
  return { amount: Math.round(m.collateralValue * ltv), rate: m.rate + 0.01, termMonths: m.termMonths, ltv, guarantor: true };
}

export function decideApplication(ctx: Ctx, pending: Pending, d: Decision): void {
  const { world } = ctx;
  const b = pending.bankId ? world.banks[pending.bankId] : undefined;
  const app = pending.data.app as Application | undefined;
  if (!b || !app || b.status !== 'open') return;
  const desk = world.player;
  void desk;
  if (growthRestricted(b) && d.choice !== 'd') {
    b.applications.playerDeclined += 1;
    emit(ctx, 'regulator', `Under the enforcement order the bank may not grow: ${app.borrower} declined`, { severity: 'alert', bankId: b.id });
    return;
  }
  switch (d.choice) {
    case 'a': {
      const terms = termsFrom(app);
      fundLoan(ctx, b, app, terms, 'player', policyCheck(b, app, terms).pass ? 'approved' : 'approved as a policy exception', false);
      b.applications.playerApproved += 1;
      emit(ctx, 'borrower', `Approved ${money(terms.amount)} ${TYPE[app.type].label} to ${app.borrower}`, { severity: 'good', bankId: b.id });
      return;
    }
    case 'c': {
      const terms = counterTerms(app);
      const accept = chance(world.rng, 0.55 - (app.memo.guarantor ? 0 : 0.15) + (app.memo.suggestedGrade >= 5 ? 0.15 : 0));
      if (accept) {
        const tightened = { ...app, truePd: app.truePd * Math.exp(-0.45 * (app.memo.guarantor ? 0 : 1)) * Math.exp(-2.2 * 0.1), trueLgd: Math.max(0.05, app.trueLgd - 0.08) };
        fundLoan(ctx, b, tightened, terms, 'player', 'countered', true);
        b.applications.playerApproved += 1;
        emit(ctx, 'borrower', `${app.borrower} accepted the counter: ${money(terms.amount)} at ${pct(terms.rate)}, LTV ${(terms.ltv * 100).toFixed(0)}%, guaranteed`, { severity: 'good', bankId: b.id });
      } else {
        b.applications.playerDeclined += 1;
        emit(ctx, 'borrower', `${app.borrower} walked away from the counter`, { bankId: b.id });
      }
      return;
    }
    default:
      b.applications.playerDeclined += 1;
      emit(ctx, 'borrower', `Declined ${app.borrower}`, { bankId: b.id });
      return;
  }
}

export function decideBatch(ctx: Ctx, pending: Pending, d: Decision): void {
  const { world } = ctx;
  const b = pending.bankId ? world.banks[pending.bankId] : undefined;
  const apps = pending.data.apps as Application[] | undefined;
  if (!b || !apps || b.status !== 'open') return;
  switch (d.choice) {
    case 'a': {
      let n = 0;
      let total = 0;
      for (const app of apps) {
        const terms = termsFrom(app);
        if (policyCheck(b, app, terms).pass) {
          fundLoan(ctx, b, app, terms, 'player', 'batch approval within policy', false);
          n += 1;
          total += terms.amount;
          b.applications.playerApproved += 1;
        } else {
          b.applications.playerDeclined += 1;
        }
      }
      emit(ctx, 'borrower', `Approved ${n} of ${apps.length} applications within policy, ${money(total)}`, { severity: 'good', bankId: b.id });
      return;
    }
    case 'r':
      for (const app of apps) queueApplication(ctx, b, app);
      return;
    default:
      b.applications.playerDeclined += apps.length;
      emit(ctx, 'borrower', `Declined ${apps.length} applications`, { bankId: b.id });
      return;
  }
}

// Player controls for the desk.
export function setDial(world: World, maxAuto: number, minGrade: number): void {
  const b = playerBank(world);
  if (!b) return;
  b.dial.maxAuto = Math.max(0, Math.round(maxAuto));
  b.dial.minGrade = Math.max(0, Math.min(7, Math.round(minGrade)));
}

export function setPolicy(world: World, patch: Partial<Bank['policy']>): void {
  const b = playerBank(world);
  if (!b) return;
  Object.assign(b.policy, patch);
  b.policy.version += 1;
}

export function setTypeAllowed(world: World, t: LoanType, on: boolean): void {
  const b = playerBank(world);
  if (b) {
    b.policy.allowed[t] = on;
    b.policy.version += 1;
  }
}

export function calibrationTypical(t: LoanType): number {
  return calibration.chargeOffRate[t].typical;
}
