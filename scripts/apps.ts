// Application census: what walks into the bank and what the desk sees.
// Generates applications in a real metro for a fresh charter and tallies
// policy failures by reason, health scores, and grades, for everything and
// for the loans above the size line. Run: npx tsx scripts/apps.ts [metroRank]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorldData } from '../data/types';
import { ccoReview, generateApplication } from '../engine/borrowers';
import { loanHealth } from '../engine/health';
import { makeRng } from '../engine/rng';
import { createWorld } from '../engine/state';
import { newPlayer, startCharter, startableMetros } from '../engine/start';
import { aboveDial, policyCheck, termsFrom } from '../engine/underwriting';

const DIR = join(import.meta.dirname, '..', 'data');
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const data: WorldData = { counties: read('counties.json'), metros: read('metros.json'), states: read('states.json'), banksByState: read('banks-by-state.json'), national: read('national.json') };
const world = createWorld(7, data);
newPlayer(world);
const metro = startableMetros(world)[Number(process.argv[2] ?? 10)]!;
const b = startCharter({ world, events: [] }, { mode: 'charter', cbsa: metro.cbsa, name: 'Census', invest: 2_000_000 });
const county = world.geo.counties[b.homeCounty!]!;
const r = makeRng(3);
const tally = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
const all = { n: 0, fail: 0, reasons: {} as Record<string, number>, health: [] as number[], grade: {} as Record<string, number>, byType: {} as Record<string, number> };
const desk = { n: 0, fail: 0, reasons: {} as Record<string, number>, health: [] as number[], grade: {} as Record<string, number>, byType: {} as Record<string, number> };
for (let i = 0; i < 4000; i++) {
  const app = generateApplication(world, b, county, r);
  ccoReview(app, b, 55, r);
  const c = policyCheck(b, app, termsFrom(app));
  const h = loanHealth(world, b, app, !c.pass).score;
  for (const s of aboveDial(b, app) ? [all, desk] : [all]) {
    s.n++;
    if (!c.pass) s.fail++;
    tally(s.byType, `breaks:${Math.min(2, c.reasons.filter((x) => !x.includes('legal lending')).length)}${c.reasons.some((x) => x.includes('legal lending')) ? '+limit' : ''}${app.memo.suggestedGrade >= 7 ? '+g7' : ''}`);
    for (const x of c.reasons) tally(s.reasons, x.replace(/[\d.,$KM%x]+/g, '#'));
    s.health.push(h);
    tally(s.grade, String(app.memo.suggestedGrade));
    tally(s.byType, app.type);
  }
}
const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)];
for (const [name, s] of [['all', all], ['desk (above line ' + b.dial.maxAuto + ')', desk]] as const) {
  console.log(`== ${name}: n ${s.n}, fail policy ${(100 * s.fail / s.n).toFixed(0)}%, health p25/50/75 ${q(s.health, 0.25)}/${q(s.health, 0.5)}/${q(s.health, 0.75)}, >=65 ${(100 * s.health.filter((x) => x >= 65).length / s.n).toFixed(0)}%`);
  console.log('  grades', JSON.stringify(s.grade));
  console.log('  types', JSON.stringify(s.byType));
  console.log('  reasons', JSON.stringify(Object.entries(s.reasons).sort((a, b2) => b2[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}: ${(100 * v / s.n).toFixed(0)}%`)));
}
