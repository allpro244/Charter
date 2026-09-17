// The big-world performance test (CLAUDE.md rule 6): 300 banks, 40 simulated
// years, under 60 seconds in Node. Every phase must keep this passing.

import { describe, expect, it } from 'vitest';
import { tick } from '../engine/tick';
import { BIG_WORLD_BANKS, BIG_WORLD_BUDGET_MS, BIG_WORLD_YEARS, buildBigWorld } from './helpers/bigworld';

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
