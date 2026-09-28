// The year in review (D65) and no impossible decisions (D66). Real
// geography, so applications arrive; skipped until the fixtures exist.

import { describe, expect, it } from 'vitest';
import { canTakeLargeDeposit } from '../engine/depositors';
import { localRaceMonthly, localStanding, nextThreshold, thresholdsMonthly } from '../engine/ladder';
import { totalAssets } from '../engine/ledger';
import { createWorld } from '../engine/state';
import { metroProfile, newPlayer, startCharter, startTakeover, startableMetros } from '../engine/start';
import { applyDecisions, tick } from '../engine/tick';
import { generateApplication } from '../engine/borrowers';
import { makeRng } from '../engine/rng';
import { leverageTested, policyCheck, termsFrom } from '../engine/underwriting';
import { FIXTURES_MISSING, affordableTakeover, hasFixtures, loadFixtures } from './helpers/fixtures';

function charter(seed: number) {
  const world = createWorld(seed, loadFixtures());
  newPlayer(world);
  const metro = startableMetros(world)[0]!;
  const bank = startCharter({ world, events: [] }, { mode: 'charter', cbsa: metro.cbsa, name: 'Year Bank', invest: 2_000_000 });
  return { world, bank };
}

describe.skipIf(!hasFixtures())(`year in review and the desk (${hasFixtures() ? 'fixtures loaded' : FIXTURES_MISSING})`, () => {
  it('keeps one review a year with that year\'s own desk calls', () => {
    const { world, bank } = charter(65);
    for (let d = 0; d < 365 * 2 + 5; d++) {
      tick(world);
      const blocking = world.pending.filter((p) => p.blocking);
      if (blocking.length > 0) applyDecisions({ world, events: [] }, blocking.map((p) => ({ pendingId: p.id, choice: p.options.some((o) => o.key === 'a') ? 'a' : p.options[0]!.key })));
    }
    const years = bank.years ?? [];
    expect(years.map((r) => r.year)).toEqual([2024, 2025]);
    expect(years[0]!.deNovo).toBe(true);
    expect(years[0]!.approved + years[1]!.approved).toBe(bank.deskAtYear!.approved);
    expect(years[1]!.rankAgo).toBe(years[0]!.rank);
    expect(world.milestones.some((m) => m.text.includes('approved at your desk this year'))).toBe(true);
  });

  it('a bank frozen by an order sees no loan applications and no big deposit offers (D66)', () => {
    const { world, bank } = charter(66);
    for (let d = 0; d < 200; d++) tick(world);
    world.pending = world.pending.filter((p) => !p.blocking);
    bank.enforcement = 'consent';
    bank.enforcementSince = world.day;
    bank.enforcementAssets = Math.round(totalAssets(bank.acct) * 0.5);
    expect(canTakeLargeDeposit(bank)).toBe(false);
    let apps = 0;
    for (let d = 0; d < 120; d++) {
      tick(world);
      apps += world.pending.filter((p) => p.kind === 'loan_application' || p.kind === 'loan_batch' || p.kind === 'deposit_offer').length;
      world.pending = world.pending.filter((p) => !p.blocking);
    }
    expect(apps).toBe(0);
    expect(world.feed.some((f) => f.text.includes('enforcement order freezes the bank'))).toBe(true);
  });
});

describe.skipIf(!hasFixtures())(`the desk carries decisions worth making (D67, ${hasFixtures() ? 'fixtures loaded' : FIXTURES_MISSING})`, () => {
  it('never fails a real estate or household loan on the leverage cap, and screens multi-break applications at the door', () => {
    const { world, bank } = charter(67);
    const county = world.geo.counties[bank.homeCounty!]!;
    const r = makeRng(9);
    let leverageFails = 0;
    for (let i = 0; i < 2000; i++) {
      const app = generateApplication(world, bank, county, r);
      const c = policyCheck(bank, app, termsFrom(app));
      if (!leverageTested(app.type) && c.reasons.some((x) => x.startsWith('leverage'))) leverageFails++;
    }
    expect(leverageFails).toBe(0);
    // Two years at the desk: every loan that reaches it breaks at most one line.
    for (let d = 0; d < 730; d++) {
      tick(world);
      for (const p of world.pending.filter((x) => x.kind === 'loan_application')) {
        const app = p.data.app as Parameters<typeof policyCheck>[1];
        expect(policyCheck(bank, app, termsFrom(app)).reasons.length).toBeLessThanOrEqual(1);
      }
      const blocking = world.pending.filter((p) => p.blocking);
      if (blocking.length > 0) applyDecisions({ world, events: [] }, blocking.map((p) => ({ pendingId: p.id, choice: p.options.some((o) => o.key === 'd') ? 'd' : p.options[0]!.key })));
    }
    expect(bank.applications.screened ?? 0).toBeGreaterThan(0);
    expect(world.feed.filter((f) => f.text.startsWith('Turned down at the door this month')).length).toBeLessThanOrEqual(25);
  });
});

describe.skipIf(!hasFixtures())(`the race at home (D72, ${hasFixtures() ? 'fixtures loaded' : FIXTURES_MISSING})`, () => {
  it('names the next bank to pass in the home county and marks the pass', () => {
    const { world, bank } = charter(72);
    for (let d = 0; d < 60; d++) tick(world);
    world.pending = world.pending.filter((p) => !p.blocking);
    const s = localStanding(world, bank)!;
    expect(s).not.toBeNull();
    expect(s.total).toBeGreaterThan(1);
    expect(s.ahead).not.toBeNull();
    // Deposits land at home just past the next bank: at the month end the
    // pass is a milestone and a feed line.
    const gap = s.ahead!.deposits - s.mine + 1_000_000;
    bank.acct.checking += gap;
    bank.acct.cash += gap;
    bank.branches[0]!.deposits += gap;
    world.ladder.local = { county: s.county, rank: s.rank, total: s.total, ahead: s.aheadIds };
    localRaceMonthly({ world, events: [] }, bank);
    expect(world.milestones.some((m) => m.text.includes(`you passed ${s.ahead!.name}`))).toBe(true);
    expect(localStanding(world, bank)!.rank).toBe(s.rank - 1);
  });
});

describe.skipIf(!hasFixtures())(`the de novo business plan (D73, ${hasFixtures() ? 'fixtures loaded' : FIXTURES_MISSING})`, () => {
  it('a charter files a rising three year plan and hears the verdict at the end; a takeover files none', () => {
    const { world, bank } = charter(73);
    const plan = bank.plan!;
    expect(plan.assets.length).toBe(3);
    expect(plan.assets[0]!).toBeLessThan(plan.assets[1]!);
    expect(plan.assets[1]!).toBeLessThan(plan.assets[2]!);
    expect(plan.capitalFloor).toBe(0.08);
    for (let d = 0; d < 3 * 365 + 10; d++) {
      tick(world);
      const blocking = world.pending.filter((p) => p.blocking);
      if (blocking.length > 0) applyDecisions({ world, events: [] }, blocking.map((p) => ({ pendingId: p.id, choice: p.options.some((o) => o.key === 'd') ? 'd' : p.options[0]!.key })));
    }
    expect(plan.yearsReported).toBe(3);
    expect(plan.done).toBe(true);
    expect(world.milestones.some((m) => m.text.startsWith('De novo years complete'))).toBe(true);
    expect(world.feed.filter((f) => f.text.startsWith('Business plan, year')).length).toBe(3);
    const t = createWorld(74, loadFixtures());
    newPlayer(t);
    const { metro, candidate } = affordableTakeover(t);
    expect(startTakeover({ world: t, events: [] }, { mode: 'takeover', cbsa: metro.cbsa, candidate }).plan).toBeUndefined();
  });
});

describe.skipIf(!hasFixtures())(`size thresholds (D74, ${hasFixtures() ? 'fixtures loaded' : FIXTURES_MISSING})`, () => {
  it('announces each threshold once, from the engine constants, and never one the bank started past', () => {
    const { world, bank } = charter(75);
    const ctx = { world, events: [] };
    thresholdsMonthly(ctx, bank);
    expect(world.ladder.thresholds).toEqual([]);
    bank.acct.cash += 1_200_000_000;
    bank.acct.commonStock += 1_200_000_000;
    thresholdsMonthly(ctx, bank);
    thresholdsMonthly(ctx, bank);
    const past = world.milestones.filter((m) => m.text.startsWith('Past '));
    expect(past.length).toBe(1);
    expect(past[0]!.text).toMatch(/IPO/);
    expect(nextThreshold(totalAssets(bank.acct))!.assets).toBe(10e9);
  });
});

describe.skipIf(!hasFixtures())(`a metro as a place to start (D75, ${hasFixtures() ? 'fixtures loaded' : FIXTURES_MISSING})`, () => {
  it('profiles each fixture metro from its counties, with what it rides on above the national share', () => {
    const world = createWorld(76, loadFixtures());
    for (const m of startableMetros(world)) {
      const p = metroProfile(world, m);
      expect(p.income).toBeGreaterThan(20_000);
      expect(p.depositPool).toBeGreaterThan(0);
      for (const l of p.leaning) {
        expect(l.times).toBeGreaterThanOrEqual(1.2);
        expect(l.excess).toBeGreaterThanOrEqual(0.01);
      }
    }
  });
});
