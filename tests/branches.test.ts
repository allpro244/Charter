// Where to open a branch (D55): the case for a county comes from the
// branch's own target formula, the candidates are ranked by what they
// would earn, the check names why a branch cannot open, and a branch
// opened from the top of the list gathers a real share of its case.

import { describe, expect, it } from 'vitest';
import { branchCandidates, branchCase, branchOpenCheck, openBranch } from '../engine/deposits';
import { imbalance } from '../engine/ledger';
import { newPlayer, startCharter, startableMetros } from '../engine/start';
import { createWorld } from '../engine/state';
import { tick } from '../engine/tick';
import { loadFixtures } from './helpers/fixtures';

function charter(seed: number) {
  const world = createWorld(seed, loadFixtures());
  newPlayer(world);
  const metro = startableMetros(world)[0]!;
  const ctx = { world, events: [] as never[] };
  const bank = startCharter(ctx, { mode: 'charter', cbsa: metro.cbsa, name: 'Branch Bank', invest: 2_000_000 });
  return { world, ctx, bank };
}

describe('where to open a branch (D55)', () => {
  it('ranks candidates by a mature year of earnings, never a county with your branch, from the branch formula', () => {
    const { world, bank } = charter(41);
    const cands = branchCandidates(world, bank, 10);
    expect(cands.length).toBeGreaterThan(0);
    for (let i = 1; i < cands.length; i++) expect(Math.floor(cands[i - 1]!.profit / 50_000)).toBeGreaterThanOrEqual(Math.floor(cands[i]!.profit / 50_000));
    for (const k of cands) {
      expect(bank.branches.some((br) => br.county === k.fips)).toBe(false);
      expect(k.year1).toBeLessThanOrEqual(k.year3);
      expect(k.year3).toBeLessThanOrEqual(k.mature);
      expect(k.mature).toBeLessThanOrEqual(k.pool);
      expect(k.contested).toBeLessThanOrEqual(k.mature);
      if (k.rivalBranches === 0) expect(k.contested).toBe(k.mature);
      expect(k.breakEven).toBe(Math.round(k.fixedCost / k.margin));
      expect(k.profit).toBe(Math.round(k.contested * k.margin - k.fixedCost));
      if (k.paybackYear !== null) expect(k.paybackYear).toBeGreaterThanOrEqual(1);
    }
    // The card and the list agree.
    const top = cands[0]!;
    const card = branchCase(world, bank, world.geo.counties[top.fips]!);
    expect(card.year3).toBe(top.year3);
    expect(card.mature).toBe(top.mature);
    expect(card.contested).toBe(top.contested);
  });

  it('says why a branch cannot open, and opens once it can', () => {
    const { world, ctx, bank } = charter(42);
    const home = world.geo.counties[bank.homeCounty!]!;
    expect(branchOpenCheck(world, home).ok).toBe(false);
    expect(branchOpenCheck(world, home).reason).toMatch(/already have a branch/);
    const top = branchCandidates(world, bank, 1)[0]!;
    const county = world.geo.counties[top.fips]!;
    const cash = bank.acct.cash;
    bank.acct.cash = top.premises - 1;
    bank.acct.commonStock -= cash - (top.premises - 1);
    const short = branchOpenCheck(world, county);
    expect(short.ok).toBe(false);
    expect(short.reason).toMatch(/cash/);
    expect(openBranch(ctx, county)).toBeNull();
    expect(ctx.events.some((e) => /No branch in/.test((e as { text: string }).text))).toBe(true);
    bank.acct.cash = cash;
    bank.acct.commonStock += cash - (top.premises - 1);
    expect(branchOpenCheck(world, county).ok).toBe(true);
    const br = openBranch(ctx, county);
    expect(br).not.toBeNull();
    expect(bank.acct.premises).toBeGreaterThanOrEqual(top.premises);
    expect(branchOpenCheck(world, county).ok).toBe(false);
    expect(imbalance(bank.acct)).toBe(0);
  });

  it('a branch opened from the top of the list gathers a real share of its case within six years', () => {
    const results: number[] = [];
    for (const seed of [43, 44]) {
      const { world, ctx, bank } = charter(seed);
      bank.acct.cash += 20_000_000;
      bank.acct.commonStock += 20_000_000;
      const top = branchCandidates(world, bank, 1)[0]!;
      const br = openBranch(ctx, world.geo.counties[top.fips]!)!;
      expect(br).not.toBeNull();
      let decisions: { pendingId: string; choice: string }[] = [];
      for (let d = 0; d < 6 * 365; d++) {
        const r = tick(world, decisions);
        decisions = r.pending.map((p) => ({ pendingId: p.id, choice: p.kind === 'loan_application' ? 'd' : p.kind === 'loan_batch' ? 's' : p.kind === 'rate_prompt' ? 'm' : p.options[0]!.key }));
      }
      results.push(br.deposits / top.mature);
    }
    // The case is the uncontested ceiling; a real branch reaches a good part of it and never more than the ceiling by much.
    for (const x of results) {
      expect(x).toBeGreaterThan(0.3);
      expect(x).toBeLessThan(1.3);
    }
  });
});
