// Start flows need real metro data. Skipped with a reason until fixtures exist.

import { describe, expect, it } from 'vitest';
import { totalAssets, totalEquity } from '../engine/ledger';
import { createWorld } from '../engine/state';
import { charterTerms, newPlayer, seedsForMetro, startCharter, startTakeover, startableMetros, takeoverCandidates } from '../engine/start';
import { tick } from '../engine/tick';
import { FIXTURES_MISSING, affordableTakeover, hasFixtures, loadFixtures } from './helpers/fixtures';

describe.skipIf(!hasFixtures())(`start (${hasFixtures() ? 'fixtures loaded' : FIXTURES_MISSING})`, () => {
  it('lists startable metros sorted by population and sizes a charter by metro', () => {
    const world = createWorld(1, loadFixtures());
    const metros = startableMetros(world);
    expect(metros.length).toBeGreaterThan(0);
    for (let i = 1; i < metros.length; i++) expect(metros[i]!.population).toBeLessThanOrEqual(metros[i - 1]!.population);
    for (const m of metros) {
      const t = charterTerms(world, m);
      expect(t.raise).toBeGreaterThanOrEqual(10_000_000);
      expect(t.raise).toBeLessThanOrEqual(30_000_000);
    }
  });

  it('charters a new bank with deposits sized from the county and runs a year', () => {
    const world = createWorld(2, loadFixtures());
    newPlayer(world);
    const metro = startableMetros(world)[0]!;
    const ctx = { world, events: [] };
    const bank = startCharter(ctx, { mode: 'charter', cbsa: metro.cbsa, name: 'Test Bank', invest: 2_000_000 });
    expect(world.playerBankId).toBe(bank.id);
    expect(totalEquity(bank.acct)).toBe(charterTerms(world, metro).raise);
    expect(bank.branches.length).toBe(1);
    for (let d = 0; d < 365; d++) tick(world);
    expect(bank.acct.checking + bank.acct.savings + bank.acct.mmda + bank.acct.cd).toBeGreaterThan(0);
    expect(totalAssets(bank.acct)).toBeGreaterThan(0);
  });

  it('takes over a generated bank in the metro for a control stake', () => {
    const data = loadFixtures();
    const world = createWorld(3, data);
    newPlayer(world);
    const { metro, candidate: c } = affordableTakeover(world);
    expect(takeoverCandidates(world, metro, seedsForMetro(world, metro)).length).toBeGreaterThan(0);
    const cashBefore = world.player.cash;
    const bank = startTakeover({ world, events: [] }, { mode: 'takeover', cbsa: metro.cbsa, candidate: c });
    expect(world.player.cash).toBe(cashBefore - c.price);
    expect(world.player.shares / bank.shares).toBeCloseTo(c.stake, 2);
    for (let d = 0; d < 365; d++) tick(world);
    expect(bank.status).not.toBe('failed');
  });

  it('a takeover arrives with its real offices as branches, deposits split as the Summary of Deposits says (D70)', () => {
    const world = createWorld(70, loadFixtures());
    newPlayer(world);
    const { metro, candidate } = affordableTakeover(world);
    const c = { ...candidate, offices: 3 };
    const bank = startTakeover({ world, events: [] }, { mode: 'takeover', cbsa: metro.cbsa, candidate: c });
    expect(bank.branches.length).toBeGreaterThan(1);
    expect(bank.branches.length).toBeLessThanOrEqual(3);
    expect(new Set(bank.branches.map((b) => b.county)).size).toBe(bank.branches.length);
    const total = bank.branches.reduce((x, b) => x + b.deposits, 0);
    expect(total).toBe(bank.acct.checking + bank.acct.savings + bank.acct.mmda + bank.acct.cd);
    const home = bank.branches[0]!;
    expect(home.deposits).toBeGreaterThan(bank.branches[1]!.deposits);
    for (let d = 0; d < 365; d++) tick(world);
    expect(bank.status).not.toBe('failed');
  });
});
