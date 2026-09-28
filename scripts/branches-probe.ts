// Prints the ranked branch list for a charter after two years (D68 check).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorldData } from '../data/types';
import { branchCandidates, branchMargin } from '../engine/deposits';
import { createWorld } from '../engine/state';
import { newPlayer, startCharter, startableMetros } from '../engine/start';
import { tick } from '../engine/tick';
const DIR = join(import.meta.dirname, '..', 'data');
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const data: WorldData = { counties: read('counties.json'), metros: read('metros.json'), states: read('states.json'), banksByState: read('banks-by-state.json'), national: read('national.json') };
const world = createWorld(5, data);
newPlayer(world);
const b = startCharter({ world, events: [] }, { mode: 'charter', cbsa: startableMetros(world)[Number(process.argv[2] ?? 10)]!.cbsa, name: 'B', invest: 2_000_000 });
for (let d = 0; d < 730; d++) { tick(world); world.pending = world.pending.filter((p) => !p.blocking); }
console.log('margin', (branchMargin(b) * 100).toFixed(2), '% overhead', b.overheadRate);
for (const c of branchCandidates(world, b, 10)) console.log(c.name, c.state, 'mature', (c.mature / 1e6).toFixed(1), 'contested', (c.contested / 1e6).toFixed(1), 'cost', (c.fixedCost / 1e3).toFixed(0), 'K profit', (c.profit / 1e3).toFixed(0), 'K payback', c.paybackYear);
