// Rival invariants (SYSTEMS.md Part 1, system 6; D35, D42).

import { describe, expect, it } from 'vitest';
import { attractiveness, coreDeposits, splitCounty } from '../engine/deposits';
import { totalAssets, totalDeposits, totalEquity, totalLiabilities } from '../engine/ledger';
import { expandState, randomPolicy, tiltMix } from '../engine/rivals';
import { makeRng } from '../engine/rng';
import { createWorld } from '../engine/state';
import { newPlayer, startCharter, startableMetros } from '../engine/start';
import { tick } from '../engine/tick';
import { setRate } from '../engine/deposits';
import { DEPOSIT_TYPES } from '../engine/ledger';
import { buildBigWorld } from './helpers/bigworld';
import { FIXTURES_MISSING, hasFixtures, loadFixtures } from './helpers/fixtures';

describe('rivals', () => {
  it('failures cluster in recessions and spike in banking crises over the big world', () => {
    const world = buildBigWorld(77);
    // Give every rival an AI so it prices and grows like a rival.
    const r = makeRng(5);
    for (const id of world.bankOrder) {
      const b = world.banks[id]!;
      b.ai = randomPolicy(r);
      b.riskTilt = 0.6 + 0.9 * b.ai.riskAppetite;
      tiltMix(b, b.ai.riskAppetite);
      b.loansToDeposits = 0.65 + 0.3 * b.ai.riskAppetite;
    }
    const monthsBy = { expansion: 0, late: 0, recession: 0, recovery: 0 };
    const failuresBy = { expansion: 0, late: 0, recession: 0, recovery: 0 };
    let crisisMonths = 0;
    let crisisFailures = 0;
    let lastCount = 0;
    for (let d = 0; d < 40 * 365; d++) {
      tick(world);
      if (d % 30 === 29) {
        const e = world.economy;
        monthsBy[e.regime] += 1;
        const now = world.failures.length;
        failuresBy[e.regime] += now - lastCount;
        if (e.regime === 'recession' && e.crisis) {
          crisisMonths += 1;
          crisisFailures += now - lastCount;
        }
        lastCount = now;
      }
    }
    const rate = (k: keyof typeof monthsBy) => (monthsBy[k] > 0 ? failuresBy[k] / monthsBy[k] : 0);
    // eslint-disable-next-line no-console
    console.log(`failures per month: expansion ${rate('expansion').toFixed(3)}, late ${rate('late').toFixed(3)}, recession ${rate('recession').toFixed(3)}, recovery ${rate('recovery').toFixed(3)}, crisis ${(crisisMonths > 0 ? crisisFailures / crisisMonths : 0).toFixed(3)}; total ${world.failures.length}`);
    expect(world.failures.length).toBeGreaterThan(0);
    expect(rate('recession') + rate('recovery')).toBeGreaterThan(rate('expansion') + rate('late'));
    if (crisisMonths > 0) expect(crisisFailures / crisisMonths).toBeGreaterThanOrEqual(rate('recession'));
    for (const id of world.bankOrder) {
      const a = world.banks[id]!.acct;
      expect(totalAssets(a) - totalLiabilities(a) - totalEquity(a)).toBe(0);
    }
  });

  it('a branch that pays more, has been there longer, or belongs to a bigger bank attracts more', () => {
    const base = attractiveness(0, 5, 1e8, 1);
    expect(attractiveness(0.01, 5, 1e8, 1)).toBeGreaterThan(base);
    expect(attractiveness(0, 20, 1e8, 1)).toBeGreaterThan(base);
    expect(attractiveness(0, 5, 1e10, 1)).toBeGreaterThan(base);
    expect(attractiveness(0, 5, 1e8, 0.5)).toBeLessThan(base);
    const targets = splitCounty(1_000_000_000, 0.3, [{ attract: 2 }, { attract: 1 }]);
    expect(targets[0]! + targets[1]!).toBeCloseTo(300_000_000, -2);
    expect(targets[0]!).toBe(2 * targets[1]!);
  });
});

describe.skipIf(!hasFixtures())(`rivals with real geography (${hasFixtures() ? 'fixtures loaded' : FIXTURES_MISSING})`, () => {
  it('populates the home state and neighbors individually and the rest as aggregates matching FDIC totals', () => {
    const data = loadFixtures();
    const world = createWorld(1, data);
    newPlayer(world);
    const metro = startableMetros(world)[0]!;
    startCharter({ world, events: [] }, { mode: 'charter', cbsa: metro.cbsa, name: 'H', invest: 2_000_000 });
    const banks = world.bankOrder.map((id) => world.banks[id]!);
    const individuals = banks.filter((b) => b.kind === 'rival');
    const aggregates = banks.filter((b) => b.kind === 'aggregate');
    expect(individuals.length).toBeGreaterThan(0);
    expect(individuals.length).toBeLessThanOrEqual(300);
    expect(aggregates.length).toBeGreaterThan(0);
    for (const st of Object.values(world.geo.states)) {
      const inState = banks.filter((b) => b.state === st.abbr && b.kind !== 'player');
      const assets = inState.reduce((s, b) => s + totalAssets(b.acct), 0);
      const seeds = (data.banksByState[st.abbr] ?? []).reduce((s, x) => s + x.assets, 0);
      if (seeds > 0) expect(Math.abs(assets / seeds - 1)).toBeLessThan(0.25);
    }
    for (let d = 0; d < 365; d++) tick(world);
    for (const b of banks) {
      const a = b.acct;
      expect(totalAssets(a) - totalLiabilities(a) - totalEquity(a)).toBe(0);
    }
  });

  it('expanding a state aggregate into individual banks conserves assets and deposits', () => {
    const data = loadFixtures();
    const world = createWorld(2, data);
    newPlayer(world);
    const metro = startableMetros(world)[0]!;
    startCharter({ world, events: [] }, { mode: 'charter', cbsa: metro.cbsa, name: 'H', invest: 2_000_000 });
    const agg = world.bankOrder.map((id) => world.banks[id]!).find((b) => b.kind === 'aggregate' && b.represents > 5);
    expect(agg).toBeDefined();
    const before = totalAssets(agg!.acct);
    const beforeDeposits = totalDeposits(agg!.acct);
    expect(expandState({ world, events: [] }, agg!.state)).toBe(true);
    const after = world.bankOrder.map((id) => world.banks[id]!).filter((b) => b.state === agg!.state && b.status === 'open' && b.kind !== 'player');
    const assets = after.reduce((s, b) => s + totalAssets(b.acct), 0);
    const deposits = after.reduce((s, b) => s + totalDeposits(b.acct), 0);
    expect(Math.abs(assets / before - 1)).toBeLessThan(0.2);
    expect(Math.abs(deposits / beforeDeposits - 1)).toBeLessThan(0.25);
  });

  it('the player loses deposits to a rival that prices higher in the same county', () => {
    const data = loadFixtures();
    const world = createWorld(3, data);
    newPlayer(world);
    const metro = startableMetros(world)[0]!;
    const bank = startCharter({ world, events: [] }, { mode: 'charter', cbsa: metro.cbsa, name: 'H', invest: 2_000_000 });
    for (let d = 0; d < 3 * 365; d++) tick(world);
    const before = coreDeposits(bank);
    // A rival in the home county goes 150bp above market on every type; the
    // player holds still.
    const rival = world.bankOrder.map((id) => world.banks[id]!).find((b) => b.kind === 'rival' && b.homeCounty === bank.homeCounty && b.status === 'open');
    expect(rival).toBeDefined();
    rival!.ai!.rateAggression = 3;
    for (const t of DEPOSIT_TYPES) setRate(world, t, Math.max(0, bank.rates[t] - 0.005));
    for (let d = 0; d < 365; d++) tick(world);
    expect(coreDeposits(bank)).toBeLessThan(before);
  });

  it('an energy shock hurts a Midland bank and not a San Jose bank', () => {
    const data = loadFixtures();
    const run = (name: string) => {
      const world = createWorld(4, data);
      newPlayer(world);
      const metro = startableMetros(world).find((m) => m.name.startsWith(name))!;
      const bank = startCharter({ world, events: [] }, { mode: 'charter', cbsa: metro.cbsa, name: 'H', invest: 2_000_000 });
      const county = world.geo.counties[bank.homeCounty!]!;
      for (let d = 0; d < 3 * 365; d++) {
        if (d === 365 || d === 365 + 182) world.economy.oil = 25;
        tick(world);
      }
      return county.condition;
    };
    const midland = run('Midland');
    const sanJose = run('San Jose');
    expect(midland).toBeLessThan(sanJose);
  });
});
