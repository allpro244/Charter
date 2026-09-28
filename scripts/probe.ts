// A pacing probe. Plays a casual CEO on the real data for a number of
// years and reports what the desk would feel like: how often the clock
// stops and for what, how much of the feed touches the bank, how fast a
// year runs, and where the bank ends up. Run:
// npx tsx scripts/probe.ts [seed] [years] [metroRank] [charter|takeover]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorldData } from '../data/types';
import type { Ctx } from '../engine/ctx';
import { loanHealth } from '../engine/health';
import { totalAssets, totalEquity, leverageRatio } from '../engine/ledger';
import { type Bank, type Pending, type World, createWorld } from '../engine/state';
import { newPlayer, seedsForMetro, startCharter, startTakeover, startableMetros, takeoverCandidates } from '../engine/start';
import { applyDecisions, tick } from '../engine/tick';
import { isYearEnd, isMonthEnd } from '../engine/time';
import { branchTarget, depositTargets, bankDepositRate, marketDepositRate, branchCandidates, branchOpenCheck, openBranch } from '../engine/deposits';
import { isMonthEnd as monthEnd } from '../engine/time';

const seed = Number(process.argv[2] ?? 1);
const years = Number(process.argv[3] ?? 10);
const metroRank = Number(process.argv[4] ?? 0);
const mode = process.argv[5] ?? 'charter';
const active = process.argv[6] === 'active';

const DIR = join(import.meta.dirname, '..', 'data');
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const data: WorldData = { counties: read('counties.json'), metros: read('metros.json'), states: read('states.json'), banksByState: read('banks-by-state.json'), national: read('national.json') };

const t0 = performance.now();
const world: World = createWorld(seed, data);
newPlayer(world);
const metro = startableMetros(world)[metroRank]!;
const ctx: Ctx = { world, events: [] };
let bank: Bank;
if (mode === 'takeover') {
  const cands = takeoverCandidates(world, metro, seedsForMetro(world, metro));
  const c = cands.find((x) => x.price <= world.player.cash) ?? cands[0]!;
  bank = startTakeover(ctx, { mode: 'takeover', cbsa: metro.cbsa, candidate: c });
} else {
  bank = startCharter(ctx, { mode: 'charter', cbsa: metro.cbsa, name: 'Probe Bank', invest: 2_000_000 });
}
world.feed.push(...ctx.events);
console.log(`world built in ${(performance.now() - t0).toFixed(0)} ms; ${metro.name}; ${world.bankOrder.length} banks; mode ${mode}`);

// A casual CEO: approves sound loans, takes the default on everything else.
function choose(p: Pending): string {
  const keys = p.options.map((o) => o.key);
  if (p.kind === 'loan_application') {
    const app = (p.data as { app: Parameters<typeof loanHealth>[2] }).app;
    return loanHealth(world, bank, app).score >= 65 ? 'a' : 'd';
  }
  if (p.kind === 'loan_batch') return keys.includes('s') ? 's' : keys[0]!;
  if (p.kind === 'rate_prompt') return keys.includes('m') ? 'm' : keys[0]!;
  if (active && p.kind === 'assisted_auction') return '2';
  if (keys.includes('k')) return 'k';
  if (keys.includes('p')) return 'p';
  if (keys.includes('d')) return 'd';
  return keys[keys.length - 1]!;
}

const stops: Record<string, number> = {};
const offers: Record<string, number> = {};
let mine = 0;
let all = 0;
let stopDays = 0;
let lastStop = -1;
const gaps: number[] = [];
let tickMs = 0;
const seen = new Set<string>();
for (let d = 0; d < years * 365; d++) {
  const a = performance.now();
  const r = tick(world);
  tickMs += performance.now() - a;
  for (const e of r.events) {
    all++;
    if (e.bankId === bank.id) mine++;
  }
  for (const p of world.pending) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (p.kind === 'enforcement' || p.kind === 'exam_result') console.log(`   [${Math.floor(world.day / 365)}] ${p.title}\n     ${p.lines.join('\n     ')}`);
    if (p.blocking) stops[p.kind] = (stops[p.kind] ?? 0) + 1;
    else offers[p.kind] = (offers[p.kind] ?? 0) + 1;
  }
  const blocking = world.pending.filter((p) => p.blocking);
  if (blocking.length > 0) {
    stopDays++;
    if (lastStop >= 0) gaps.push(world.day - lastStop);
    lastStop = world.day;
    const c: Ctx = { world, events: [] };
    applyDecisions(c, blocking.map((p) => ({ pendingId: p.id, choice: choose(p) })));
    world.feed.push(...c.events);
  }
  // Offers: an active CEO takes the growth ones; a casual one lets them expire.
  if (active) {
    const offers = world.pending.filter((p) => !p.blocking && (p.kind === 'branch_offer' || p.kind === 'deposit_offer'));
    if (offers.length > 0) {
      const c: Ctx = { world, events: [] };
      applyDecisions(c, offers.map((p) => ({ pendingId: p.id, choice: p.kind === 'branch_offer' ? 'b' : 'a' })));
      world.feed.push(...c.events);
      for (const p of offers) console.log(`   [${(world.day / 365).toFixed(1)}] took ${p.kind}: ${p.title}`);
    }
    // A branch a year when the ranked list says one pays within four years.
    if (monthEnd(world.day) && world.day % 365 < 31 && world.day > 365) {
      const best = branchCandidates(world, bank, 5).find((c) => c.paybackYear !== null && c.paybackYear <= 4 && c.existing === 0);
      const county = best ? world.geo.counties[best.fips] : undefined;
      if (county && branchOpenCheck(world, county).ok) {
        const c: Ctx = { world, events: [] };
        openBranch(c, county);
        world.feed.push(...c.events);
        console.log(`   [${(world.day / 365).toFixed(1)}] opened a branch in ${county.name} (payback year ${best!.paybackYear})`);
      }
    }
  }
  // Offers otherwise: take the default (let them expire).
  if (world.playerBankId !== bank.id) {
    console.log(`bank gone on day ${world.day}`);
    break;
  }
  if (process.env.WATCH && isMonthEnd(world.day) && Math.abs(world.day / 365 - Number(process.env.WATCH)) < 1) {
    const br = bank.branches[0]!;
    const tg = depositTargets(world, bank);
    const rivals = world.bankOrder.map((id) => world.banks[id]!).filter((x) => x.id !== bank.id && x.status === 'open' && x.branches.some((q) => q.county === br.county));
    const top = rivals.map((x) => `${((bankDepositRate(x) - marketDepositRate(world)) * 1e4).toFixed(0)}bp/${(x.branches.filter((q) => q.county === br.county).reduce((s2, q) => s2 + q.deposits, 0) / 1e6).toFixed(0)}`).join(' ');
    console.log(`  m${(world.day / 365).toFixed(2)} br dep ${(br.deposits / 1e6).toFixed(0)} own ${(branchTarget(world, bank, { ...br, competitiveTarget: null }) / 1e6).toFixed(0)} comp ${br.competitiveTarget === null ? '-' : (br.competitiveTarget / 1e6).toFixed(0)} tg ${Object.values(tg).map((v) => (v / 1e6).toFixed(0)).join('/')} me ${((bankDepositRate(bank) - marketDepositRate(world)) * 1e4).toFixed(0)}bp conf ${bank.confidence.toFixed(2)} rivals ${top}`);
  }
  if (isYearEnd(world.day)) {
    const y = Math.round(world.day / 365);
    console.log(
      `y${y} assets ${(totalAssets(bank.acct) / 1e6).toFixed(1)}MM eq ${(totalEquity(bank.acct) / 1e6).toFixed(1)}MM lev ${(leverageRatio(bank.acct) * 100).toFixed(1)}% rank ${world.ladder.rank}/${world.ladder.total} branches ${bank.branches.length} nw ${(world.player.cash / 1e6).toFixed(1)}MM cash`,
    );
    const a = bank.acct;
    const m = (x: number) => (x / 1e6).toFixed(0);
    console.log(`    dep chk ${m(a.checking)} sav ${m(a.savings)} mmda ${m(a.mmda)} cd ${m(a.cd)} brk ${m(a.brokered)} fhlb ${m(a.fhlb)} ff ${m(a.fedFundsPurchased)} | cash ${m(a.cash)} loans ${m(a.loans)} sec ${m(a.securitiesAFS + a.securitiesHTM)} | conf ${bank.confidence.toFixed(2)} ff ${(world.economy.fedFunds * 100).toFixed(2)}% enf ${bank.enforcement} rates ${JSON.stringify(bank.rates ?? {})}`);
  }
}
const yrs = world.day / 365;
console.log(`tick ${(tickMs / yrs).toFixed(0)} ms per year (${(tickMs / world.day).toFixed(2)} ms/day)`);
console.log(`clock stops per year: ${(stopDays / yrs).toFixed(1)}; median gap ${gaps.sort((x, y) => x - y)[Math.floor(gaps.length / 2)] ?? '-'} days`);
console.log('stops by kind per year:', Object.fromEntries(Object.entries(stops).map(([k, v]) => [k, +(v / yrs).toFixed(1)])));
console.log('offers by kind per year:', Object.fromEntries(Object.entries(offers).map(([k, v]) => [k, +(v / yrs).toFixed(1)])));
console.log(`feed lines per day: all ${(all / world.day).toFixed(2)}, this bank ${(mine / world.day).toFixed(2)}`);
console.log(`milestones: ${world.milestones.length}`);
for (const m of world.milestones.slice(-12)) console.log('  ', Math.floor(m.day / 365), m.text);
