// The big world for the performance test (CLAUDE.md rule 6): 300 banks
// with deposits and pooled loans across ten states. No vitest imports so
// profiling scripts can build it too.

import { makeRng, randInt, randLogNormal } from '../../engine/rng';
import { createBank, createWorld } from '../../engine/state';

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
    const bank = createBank(world, {
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
    // No geography here: each bank's addressable market is a bank attribute
    // sized so the bank holds a small share of it.
    bank.franchise.pool = deposits * 40;
    bank.franchise.baseShare = 1 / 40;
    bank.franchise.targetShare = 1 / 40;
  }
  return world;
}
