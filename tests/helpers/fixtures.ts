// Loads data/fixtures/ when it exists. Tests that need geography skip with a
// clear reason until scripts/fetch-data.ts and scripts/build-data.ts have
// run (CLAUDE.md rule 17: never synthetic county data, not even for tests).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorldData } from '../../data/types';
import type { World, MetroState } from '../../engine/state';
import { seedsForMetro, startableMetros, takeoverCandidates, type TakeoverCandidate } from '../../engine/start';

const DIR = join(import.meta.dirname, '..', '..', 'data', 'fixtures');

export function hasFixtures(): boolean {
  return ['counties.json', 'metros.json', 'states.json', 'banks-by-state.json', 'national.json'].every((f) => existsSync(join(DIR, f)));
}

export function loadFixtures(): WorldData {
  const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  return {
    counties: read('counties.json'),
    metros: read('metros.json'),
    states: read('states.json'),
    banksByState: read('banks-by-state.json'),
    national: read('national.json'),
  };
}

export const FIXTURES_MISSING = 'data/fixtures/ missing: run npm run fetch-data and npm run build-data -- --fixtures';

// The first startable metro with a takeover the founder can afford, and
// that candidate: with the real FDIC list, the biggest cities have no bank
// small enough for a founder's cash, as in life (D70).
export function affordableTakeover(world: World): { metro: MetroState; candidate: TakeoverCandidate } {
  for (const metro of startableMetros(world)) {
    const c = takeoverCandidates(world, metro, seedsForMetro(world, metro)).find((x) => x.price <= world.player.cash);
    if (c) return { metro, candidate: c };
  }
  throw new Error('no affordable takeover in the fixtures');
}
