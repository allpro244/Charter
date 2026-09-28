// Running cost against assets by bank size and start, the first full year,
// against the nieToAssets band. Run: npx tsx scripts/costs.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorldData } from '../data/types';
import { noninterestExpense, totalAssets } from '../engine/ledger';
import { createWorld } from '../engine/state';
import { newPlayer, seedsForMetro, startTakeover, startableMetros, takeoverCandidates } from '../engine/start';
import { tick } from '../engine/tick';
const DIR = join(import.meta.dirname, '..', 'data');
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const data: WorldData = { counties: read('counties.json'), metros: read('metros.json'), states: read('states.json'), banksByState: read('banks-by-state.json'), national: read('national.json') };
for (const rank of [0, 10, 40, 80, 150]) {
  for (const pick of ['small', 'large'] as const) {
    const world = createWorld(11 + rank, data);
    newPlayer(world);
    const metro = startableMetros(world)[rank]!;
    const cands = takeoverCandidates(world, metro, seedsForMetro(world, metro)).sort((a, b) => a.assets - b.assets);
    const c = pick === 'small' ? cands[0]! : cands[cands.length - 1]!;
    world.player.cash = Math.max(world.player.cash, c.price);
    const b = startTakeover({ world, events: [] }, { mode: 'takeover', cbsa: metro.cbsa, candidate: c });
    let sum = 0;
    for (let d = 0; d < 365 * 2; d++) {
      tick(world);
      world.pending = world.pending.filter((p) => !p.blocking);
      if (d >= 365) sum += totalAssets(b.acct);
    }
    const nie = b.is.lastYear ? noninterestExpense(b.is.lastYear) : 0;
    console.log(`${metro.name.slice(0, 28).padEnd(28)} ${pick} assets ${(c.assets / 1e6).toFixed(0)}MM branches ${b.branches.length} offices ${c.offices} nie/assets ${((100 * nie) / (sum / 365)).toFixed(2)}%`);
  }
}
