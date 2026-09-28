// How many startable metros offer a takeover the founder can afford.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorldData } from '../data/types';
import { createWorld } from '../engine/state';
import { newPlayer, seedsForMetro, startableMetros, takeoverCandidates } from '../engine/start';
const DIR = join(import.meta.dirname, '..', 'data');
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const data: WorldData = { counties: read('counties.json'), metros: read('metros.json'), states: read('states.json'), banksByState: read('banks-by-state.json'), national: read('national.json') };
const world = createWorld(1, data);
newPlayer(world);
let none = 0;
let partial = 0;
let odd = 0;
const bad: string[] = [];
for (const m of startableMetros(world)) {
  const c = takeoverCandidates(world, m, seedsForMetro(world, m));
  const ok = c.filter((x) => x.price <= world.player.cash).length;
  if (ok === 0) { none++; bad.push(m.name); } else if (ok < c.length) partial++;
  odd += c.filter((x) => x.equity / x.assets > 0.25).length;
}
console.log(`metros ${startableMetros(world).length}: none affordable ${none}, some ${partial}; candidates with over 25% capital (not deposit banks) ${odd}`);
console.log(bad.slice(0, 20).join(' | '));
