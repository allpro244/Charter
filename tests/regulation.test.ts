// Regulation invariants (SYSTEMS.md system 12; D14). A bad CRE
// concentration gets a finding; ignoring it escalates; a failed stress
// test blocks dividends; the capital stack follows the rule book.

import { describe, expect, it } from 'vitest';
import { canPayDividend, capitalStack, creConcentration, enterSwap, examine, assessmentRate, riskWeightedAssets, CBLR, THRESHOLD_STRESS, stressTestAnnual } from '../engine/regulation';
import { canRaiseBrokered, unrealizedLoss } from '../engine/funding';
import { totalAssets, totalEquity, totalLiabilities } from '../engine/ledger';
import { makeRng } from '../engine/rng';
import { type Bank, type World, createBank, createWorld } from '../engine/state';
import { tick } from '../engine/tick';
import { seedPools } from '../engine/credit';
import { payDividend } from '../engine/wealth';
import { makeOfficer } from '../engine/officers';

function balanced(world: World) {
  for (const id of world.bankOrder) {
    const a = world.banks[id]!.acct;
    expect(totalAssets(a) - totalLiabilities(a) - totalEquity(a)).toBe(0);
  }
}

function player(world: World, assets: number, capitalRatio = 0.1): Bank {
  const capital = Math.round(assets * capitalRatio);
  const dep = assets - capital;
  const b = createBank(world, {
    name: 'Reg Bank',
    kind: 'player',
    state: 'TX',
    capital,
    deposits: { checking: Math.round(dep * 0.3), savings: Math.round(dep * 0.3), mmda: Math.round(dep * 0.2), cd: dep - Math.round(dep * 0.3) - Math.round(dep * 0.3) - Math.round(dep * 0.2) },
    loans: Math.round(assets * 0.65),
    securitiesAFS: Math.round(assets * 0.15),
    shares: Math.round(capital / 10),
  });
  b.franchise.pool = dep * 30;
  b.franchise.baseShare = 1 / 30;
  b.franchise.targetShare = 1 / 30;
  world.playerBankId = b.id;
  world.player.bankId = b.id;
  world.player.shares = Math.round(b.shares * 0.4);
  const r = makeRng(assets % 1000);
  for (const role of ['cco', 'cfo', 'clo'] as const) b.officers.push(makeOfficer(world, r, role, assets, 60));
  return b;
}

// Reseeds the pooled book with a chosen mix, ledger unchanged.
function remix(world: World, b: Bank, mix: Partial<Record<keyof Bank['loanMix'], number>>) {
  const total = b.acct.loans;
  b.pools = [];
  b.loanMix = { ci: 0, cre_oo: 0, cre_inv: 0, construction: 0, resi: 0, consumer: 0, ag: 0, energy: 0, cards: 0, ...mix };
  seedPools(world, b, total, makeRng(3), 0.04);
  // seedPools resets the mix from the county; put ours back and rescale.
  const want = { ci: 0, cre_oo: 0, cre_inv: 0, construction: 0, resi: 0, consumer: 0, ag: 0, energy: 0, cards: 0, ...mix };
  const byType: Record<string, number> = {};
  for (const p of b.pools) byType[p.type] = (byType[p.type] ?? 0) + p.balance;
  let assigned = 0;
  for (const p of b.pools) {
    const scale = (byType[p.type] ?? 0) > 0 ? (total * (want[p.type] ?? 0)) / (byType[p.type] ?? 1) : 0;
    let bal = 0;
    for (let g = 0; g < p.grades.length; g++) {
      p.grades[g] = Math.round((p.grades[g] ?? 0) * scale);
      bal += p.grades[g] ?? 0;
    }
    p.balance = bal;
    assigned += bal;
  }
  b.pools = b.pools.filter((p) => p.balance > 0);
  const big = b.pools.reduce((x, p) => (p.balance > x.balance ? p : x));
  big.balance += total - assigned;
  big.grades[2] = (big.grades[2] ?? 0) + (total - assigned);
  b.loanMix = want;
}

describe('regulation', () => {
  it('the capital stack applies the standardized risk weights and the community bank leverage ratio', () => {
    const world = createWorld(61);
    const b = player(world, 500_000_000, 0.1);
    remix(world, b, { resi: 0.5, ci: 0.3, construction: 0.2 });
    const rwa = riskWeightedAssets(b);
    // Residential at 50%, C&I at 100%, construction at 150%, agencies at 20%.
    const loans = b.acct.loans;
    const expectedLoans = loans * (0.5 * 0.5 + 0.3 * 1 + 0.2 * 1.5);
    expect(Math.abs(rwa - expectedLoans - b.acct.securitiesAFS * 0.2 - b.acct.cash * 0.04)).toBeLessThan(loans * 0.01);
    const stack = capitalStack(b);
    expect(stack.cet1).toBe(b.acct.commonStock + b.acct.retainedEarnings - b.acct.goodwill);
    expect(stack.cet1Ratio).toBeCloseTo(stack.cet1 / stack.rwa, 10);
    expect(stack.leverage).toBeGreaterThan(CBLR);
    expect(stack.cblr).toBe(true);
    expect(stack.category).toBe('well');
    expect(stack.maxPayout).toBe(1);
  });

  it('a construction-heavy book gets a CRE concentration finding and ignoring it escalates to an order', () => {
    const world = createWorld(62);
    const b = player(world, 300_000_000, 0.08);
    remix(world, b, { construction: 0.35, cre_inv: 0.3, ci: 0.2, resi: 0.15 });
    const conc = creConcentration(b);
    expect(conc.construction).toBeGreaterThan(1.0);
    expect(conc.cre).toBeGreaterThan(3.0);
    const ctx = { world, events: [] };
    const result = examine(ctx, b);
    const finding = result.findings.find((f) => /concentration/.test(f.text));
    expect(finding).toBeDefined();
    expect(result.assets).toBeGreaterThanOrEqual(3);
    // Keep lending the same way for two exam cycles: the memorandum comes,
    // then the consent order once the finding is a year old.
    b.camels.nextExam = world.day + 30;
    const seen: string[] = [];
    for (let d = 0; d < 3 * 365; d++) {
      tick(world);
      if (!seen.includes(b.enforcement)) seen.push(b.enforcement);
      // Keep the concentration on: pooled lending follows the same mix.
      for (const p of world.pending) if (p.kind === 'exam_result' || p.kind === 'enforcement') tick(world, [{ pendingId: p.id, choice: 'k' }]);
    }
    expect(seen).toContain('mou');
    expect(seen).toContain('consent');
    expect(world.milestones.some((m) => /consent order/.test(m.text))).toBe(true);
    balanced(world);
  });

  it('a consent order blocks dividends and brokered deposits', () => {
    const world = createWorld(63);
    const b = player(world, 200_000_000, 0.1);
    b.enforcement = 'consent';
    b.enforcementSince = 0;
    expect(canPayDividend(b, 100_000)).toBe(false);
    expect(canRaiseBrokered(b)).toBe(false);
    b.enforcement = 'none';
    expect(canPayDividend(b, 100_000)).toBe(true);
    expect(canRaiseBrokered(b)).toBe(true);
  });

  it('a failed stress test blocks dividends for a year', () => {
    const world = createWorld(64);
    const b = player(world, 120_000_000_000, 0.07);
    remix(world, b, { construction: 0.3, cre_inv: 0.3, ci: 0.3, consumer: 0.1 });
    // Above the threshold with a risky book at thin capital.
    expect(totalAssets(b.acct)).toBeGreaterThan(THRESHOLD_STRESS);
    const ctx = { world, events: [] };
    stressTestAnnual(ctx);
    expect(b.stressTest).not.toBeNull();
    expect(b.stressTest!.losses).toBeGreaterThan(0);
    expect(b.stressTest!.passed).toBe(false);
    b.is.quarter.interestLoans = 500_000_000; // a profitable quarter
    expect(payDividend(ctx, b)).toBe(0);
    expect(canPayDividend(b, 1_000_000)).toBe(false);
    // A sound bank passes.
    const world2 = createWorld(65);
    const s = player(world2, 120_000_000_000, 0.12);
    remix(world2, s, { resi: 0.6, ci: 0.3, consumer: 0.1 });
    stressTestAnnual({ world: world2, events: [] });
    expect(s.stressTest!.passed).toBe(true);
  });

  it('assessment rates rise with risk', () => {
    const world = createWorld(66);
    const good = player(world, 200_000_000, 0.12);
    expect(assessmentRate(good)).toBe(5);
    good.camels.composite = 3;
    expect(assessmentRate(good)).toBe(10);
    good.camels.composite = 4;
    expect(assessmentRate(good)).toBe(20);
  });

  it('a pay-fixed swap offsets the securities loss when rates rise', () => {
    const world = createWorld(67);
    const b = player(world, 2_000_000_000, 0.1);
    const ctx = { world, events: [] };
    const notional = Math.round(b.acct.securitiesAFS * 0.8);
    expect(enterSwap(ctx, b, notional, 3)).toBe(true);
    world.economy.fedFunds += 0.02;
    world.economy.curve.y2 += 0.02;
    world.economy.curve.y10 += 0.02;
    for (let d = 0; d < 31; d++) {
      tick(world);
      world.economy.curve.y2 = Math.max(world.economy.curve.y2, 0.0625);
      world.economy.curve.y10 = Math.max(world.economy.curve.y10, 0.0588);
    }
    const swap = b.swaps[0]!;
    expect(swap.value).toBeGreaterThan(0);
    expect(unrealizedLoss(b)).toBeGreaterThan(0);
    // AOCI carries both: the securities mark and the hedge.
    expect(b.acct.aoci).toBeGreaterThan(b.acct.afsValuation);
    balanced(world);
  });
});
