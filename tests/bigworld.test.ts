// The big-world performance test (CLAUDE.md rule 6): 300 banks, 40 simulated
// years, under 60 seconds in Node. Every phase must keep this passing. The
// world here is as large as the game will run: rival banks with deposits and
// loans across many states.

import { describe, expect, it } from 'vitest';
import { makeRng, randInt, randLogNormal } from '../engine/rng';
import { createBank, createWorld } from '../engine/state';
import { tick } from '../engine/tick';

export const BIG_WORLD_BANKS = 300;
export const BIG_WORLD_YEARS = 40;
export const BIG_WORLD_BUDGET_MS = 60_000;

export function buildBigWorld(seed = 2024) {
  const world = createWorld(seed);
  const r = makeRng(seed + 1);
  const states = ['TX', 'OK', 'NM', 'LA', 'AR', 'CA', 'NY', 'IL', 'OH', 'FL'];
  for (let i = 0; i < BIG_WORLD_BANKS; i++) {
    const assets = Math.round(randLogNormal(r, Math.log(300_000_000), 1.2));
    const capital = Math.round(assets * 0.1);
    const deposits = assets - capital;
    createBank(world, {
      name: `Bank ${i + 1}`,
      kind: 'rival',
      state: states[randInt(r, 0, states.length - 1)] as string,
      capital,
      deposits: {
        checking: Math.round(deposits * 0.3),
        savings: Math.round(deposits * 0.25),
        mmda: Math.round(deposits * 0.25),
        cd: deposits - Math.round(deposits * 0.3) - Math.round(deposits * 0.25) - Math.round(deposits * 0.25),
      },
      loans: Math.round(assets * 0.65),
      securitiesAFS: Math.round(assets * 0.15),
      securitiesHTM: Math.round(assets * 0.05),
    });
  }
  return world;
}

describe('big world', () => {
  it(`${BIG_WORLD_BANKS} banks over ${BIG_WORLD_YEARS} years run under ${BIG_WORLD_BUDGET_MS / 1000}s`, () => {
    const world = buildBigWorld();
    const days = BIG_WORLD_YEARS * 365 + 10;
    const start = performance.now();
    for (let i = 0; i < days; i++) tick(world);
    const elapsed = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(`big world: ${BIG_WORLD_BANKS} banks x ${BIG_WORLD_YEARS} years in ${(elapsed / 1000).toFixed(2)}s`);
    expect(elapsed).toBeLessThan(BIG_WORLD_BUDGET_MS);
    expect(world.day).toBe(days);
    const open = world.bankOrder.filter((id) => world.banks[id]!.status === 'open').length;
    expect(open).toBeGreaterThan(0);
  });
});
