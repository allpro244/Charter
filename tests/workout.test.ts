// The workout (D57): a nonaccrual loan can be restructured, sold or left
// to run. Restructured loans mostly come back on accrual after six clean
// payments and fail again at the modification band; loans above the size
// line come to the desk, the rest the workout officer decides by rule.

import { describe, expect, it } from 'vitest';
import { generateApplication } from '../engine/borrowers';
import { imbalance } from '../engine/ledger';
import { fundLoan, restructureLoan, restructureTerms } from '../engine/loans';
import { newPlayer, startCharter, startableMetros } from '../engine/start';
import { type Loan, createWorld } from '../engine/state';
import { tick } from '../engine/tick';
import { termsFrom } from '../engine/underwriting';
import { loadFixtures } from './helpers/fixtures';

function charter(seed: number) {
  const world = createWorld(seed, loadFixtures());
  newPlayer(world);
  const metro = startableMetros(world)[0]!;
  const ctx = { world, events: [] as never[] };
  const bank = startCharter(ctx, { mode: 'charter', cbsa: metro.cbsa, name: 'Workout Bank', invest: 2_000_000 });
  bank.acct.cash += 80_000_000;
  bank.acct.commonStock += 80_000_000;
  bank.policy.targetLoansToDeposits = 0;
  bank.investPolicy = null;
  return { world, ctx, bank };
}

function book(ctx: { world: ReturnType<typeof createWorld>; events: never[] }, bank: ReturnType<typeof charter>['bank'], n: number, by: 'player' | 'auto'): Loan[] {
  const { world } = ctx;
  const county = world.geo.counties[bank.homeCounty!]!;
  const out: Loan[] = [];
  for (let i = 0; i < n * 3 && out.length < n; i++) {
    const app = generateApplication(world, bank, county, world.rng);
    if (!app || app.memo.amount > 2_000_000) continue;
    const l = fundLoan(ctx, bank, app, termsFrom(app), by, 'test', false);
    out.push(l);
  }
  return out;
}

function run(world: ReturnType<typeof createWorld>, days: number): void {
  let decisions: { pendingId: string; choice: string }[] = [];
  for (let d = 0; d < days; d++) {
    const r = tick(world, decisions);
    decisions = r.pending.filter((p) => p.kind !== 'workout').map((p) => ({ pendingId: p.id, choice: p.kind === 'loan_application' ? 'd' : p.kind === 'loan_batch' ? 's' : p.kind === 'rate_prompt' ? 'm' : p.options[0]!.key }));
  }
}

describe('the workout (D57)', () => {
  it('a restructure takes a point off the rate, extends the term by half and lowers the payment', () => {
    const { world, ctx, bank } = charter(51);
    const [l] = book(ctx, bank, 1, 'player');
    expect(l).toBeDefined();
    const t = restructureTerms(world, l!);
    expect(t.rate).toBeCloseTo(l!.rate - 0.01, 4);
    expect(t.termMonths).toBeGreaterThan(l!.termMonths - 1);
    expect(t.payment).toBeLessThan(l!.payment);
    expect(t.dscr).toBeGreaterThan(l!.memo.dscr);
    l!.status = 'nonaccrual';
    l!.monthsLate = 4;
    const before = imbalance(bank.acct);
    expect(restructureLoan(ctx, bank, l!.id)).toBe(true);
    expect(l!.status).toBe('workout');
    expect(l!.payment).toBe(t.payment);
    expect(l!.restructured?.oldPayment).toBeGreaterThan(t.payment);
    expect(imbalance(bank.acct)).toBe(before);
    expect(restructureLoan(ctx, bank, l!.id)).toBe(true); // a second restructure is allowed while in workout
  });

  it('most restructured loans come back on accrual within two years and the rest fail at the band', () => {
    let cured = 0;
    let gone = 0;
    let total = 0;
    for (const seed of [52, 53]) {
      const { world, ctx, bank } = charter(seed);
      const loans = book(ctx, bank, 40, 'player');
      for (const l of loans) {
        l.status = 'nonaccrual';
        l.monthsLate = 4;
        l.grade = 7;
        l.accrued = 0;
        expect(restructureLoan(ctx, bank, l.id)).toBe(true);
      }
      run(world, 2 * 365);
      for (const l of loans) {
        total++;
        if (l.status === 'current' || l.status === 'paid' || l.status === 'late30' || l.status === 'late60') cured++;
        if (l.status === 'chargedOff' || l.status === 'reo') gone++;
      }
      expect(imbalance(bank.acct)).toBe(0);
    }
    expect(total).toBeGreaterThanOrEqual(40);
    // The band says about a third fail again within a year; the rest make
    // their six payments. Two years in, the failures have been resolved.
    expect(cured / total).toBeGreaterThan(0.4);
    expect(cured / total).toBeLessThan(0.9);
    expect(gone / total).toBeGreaterThan(0.1);
    expect(gone / total).toBeLessThan(0.6);
  });

  it('a loan above the size line brings a workout to the desk; below it the officer restructures when it covers', () => {
    const { world, ctx, bank } = charter(54);
    bank.dial.autoSize = false;
    bank.dial.maxAuto = 250_000;
    const loans = book(ctx, bank, 30, 'auto');
    const big = loans.filter((l) => l.balance > 250_000);
    const small = loans.filter((l) => l.balance <= 250_000);
    expect(big.length).toBeGreaterThan(0);
    expect(small.length).toBeGreaterThan(0);
    for (const l of loans) {
      l.status = 'late90';
      l.monthsLate = 3;
      l.truePd = 0.95; // they will miss again
      l.memo.paymentHistory = 'clean';
    }
    let workouts = 0;
    let decisions: { pendingId: string; choice: string }[] = [];
    for (let d = 0; d < 120; d++) {
      const r = tick(world, decisions);
      workouts += r.pending.filter((p) => p.kind === 'workout').length;
      decisions = r.pending.filter((p) => p.kind !== 'workout').map((p) => ({ pendingId: p.id, choice: p.kind === 'loan_application' ? 'd' : p.kind === 'loan_batch' ? 's' : p.kind === 'rate_prompt' ? 'm' : p.options[0]!.key }));
    }
    expect(workouts).toBeGreaterThan(0);
    // Every pending workout names a loan above the line.
    for (const p of world.pending.filter((p) => p.kind === 'workout')) {
      const l = loans.find((x) => x.id === p.data.loanId)!;
      expect(l.balance).toBeGreaterThan(250_000);
      expect(p.blocking).toBe(false);
    }
    // Small loans that went nonaccrual and covered were restructured by the officer, with no pending.
    const smallBad = small.filter((l) => l.status === 'nonaccrual' || l.status === 'workout');
    const covered = smallBad.filter((l) => restructureTerms(world, l).dscr >= 1 || l.restructured);
    for (const l of covered) expect(l.restructured).toBeDefined();
    expect(world.pending.filter((p) => p.kind === 'workout' && small.some((l) => l.id === p.data.loanId)).length).toBe(0);
  });
});
