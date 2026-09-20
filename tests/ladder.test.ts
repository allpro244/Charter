// The ladder (D49): rank among every bank in America, other banks grown
// with the economy, milestones as rungs pass. Seeds here are bank sizes,
// not county data (rule 17 concerns counties and metros).

import { describe, expect, it } from 'vitest';
import { ladder, ladderMonthly, rungs } from '../engine/ladder';
import { createBank, createWorld } from '../engine/state';

describe('the ladder', () => {
  it('ranks the player among seeds grown with the nominal index and names the next bank to pass', () => {
    const world = createWorld(5);
    const bank = createBank(world, { name: 'Mine', kind: 'rival', state: 'TX', capital: 10_000_000, deposits: { checking: 90_000_000 }, loans: 60_000_000 });
    world.playerBankId = bank.id;
    world.bankSeeds = {
      TX: [
        { state: 'TX', county: null, assets: 500_000_000, deposits: 400_000_000, offices: 5 },
        { state: 'TX', county: null, assets: 50_000_000, deposits: 40_000_000, offices: 1 },
      ],
      OK: [{ state: 'OK', county: null, assets: 120_000_000, deposits: 100_000_000, offices: 2 }],
    };
    const l = ladder(world);
    expect(l.total).toBe(4);
    expect(l.rank).toBe(3); // 500M and 120M ahead of 100M
    expect(l.ahead?.assets).toBe(120_000_000);
    expect(l.ahead?.state).toBe('OK');
    expect(l.behind?.assets).toBe(50_000_000);
    expect(l.largest?.assets).toBe(500_000_000);
    // The economy lifts everyone else: at a 10% index the 120M bank is out of reach by more.
    world.economy.nominalIndex = 1.1;
    expect(rungs(world).map((r) => r.assets)).toEqual([550_000_000, 132_000_000, 55_000_000]);
  });

  it('marks rungs once as the bank climbs and never twice', () => {
    const world = createWorld(6);
    const bank = createBank(world, { name: 'Mine', kind: 'rival', state: 'TX', capital: 10_000_000, deposits: { checking: 90_000_000 }, loans: 60_000_000 });
    world.playerBankId = bank.id;
    const seeds = Array.from({ length: 1200 }, (_, i) => ({ state: 'TX', county: null, assets: 200_000_000 + i * 1_000_000, deposits: 100_000_000, offices: 1 }));
    world.bankSeeds = { TX: seeds };
    const ctx = { world, events: [] };
    ladderMonthly(ctx);
    expect(world.ladder.rank).toBe(1201);
    expect(world.ladder.crossed).toEqual([]);
    // Grow past all but 40 of them.
    bank.acct.cash += 1_260_000_000;
    bank.acct.commonStock += 1_260_000_000;
    ladderMonthly(ctx);
    expect(world.ladder.rank).toBeLessThanOrEqual(50);
    expect(world.ladder.crossed).toEqual([1000, 500, 250, 100, 50]);
    expect(world.milestones.filter((m) => /top 100 banks/.test(m.text)).length).toBe(1);
    ladderMonthly(ctx);
    expect(world.ladder.crossed).toEqual([1000, 500, 250, 100, 50]);
  });
});
