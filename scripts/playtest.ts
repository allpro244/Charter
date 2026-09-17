// A scripted player. Drives the engine through every desk action for many
// years and seeds, the way a person would, and reports anything that
// looks like a bug: exceptions, NaN, negative balances, pools that do not
// sum, decisions that never resolve, feed spam, text that breaks the
// rules. Run: npx tsx scripts/playtest.ts [seeds] [years]

import { buyback, canIpo, formHoldingCompany, ipo, raiseCapital, secondary, sellPlayerShares } from '../engine/capital';
import type { Ctx } from '../engine/ctx';
import { closeBranch, marketRate, setRate } from '../engine/deposits';
import { creditMark, makeOffer, proFormaLeverage, reservationPriceToBook } from '../engine/deals';
import { borrowFhlb, buySecurities, raiseBrokered, repayBrokered, repayFhlb, sellSecurities } from '../engine/funding';
import { canGoGlobal, foreignCandidates, offerForeign } from '../engine/global';
import { DEPOSIT_TYPES, totalAssets, totalEquity, totalLiabilities } from '../engine/ledger';
import { LINE_ORDER, lineAvailable, toggleLine } from '../engine/lines';
import { fire, hire, makeOfficer } from '../engine/officers';
import { enterSwap, terminateSwap } from '../engine/regulation';
import { adoptPolicy, randomPolicy } from '../engine/rivals';
import { type Rng, chance, makeRng, pick, rand, randInt, randLogNormal } from '../engine/rng';
import { type Bank, type World, createBank, createWorld } from '../engine/state';
import { tick } from '../engine/tick';
import { isMonthEnd, isYearEnd } from '../engine/time';
import { setDial, setPolicy } from '../engine/underwriting';
import { setDividendPayout, setSalary } from '../engine/wealth';

const seeds = Number(process.argv[2] ?? 6);
const years = Number(process.argv[3] ?? 25);
// --save <path>: run one seed for the given years and write the world as a
// save file for the desk (import on DEBUG or on the no-data screen).
const saveArg = process.argv.indexOf('--save');
const savePath = saveArg > 0 ? process.argv[saveArg + 1] : null;

interface Anomaly {
  seed: number;
  day: number;
  what: string;
}
const anomalies: Anomaly[] = [];
const tallies: Record<string, number> = {};
const traced: { id: string; made: number; expires: number | null; gone: number | null; cause: string }[] = [];
function tally(key: string): void {
  tallies[key] = (tallies[key] ?? 0) + 1;
}
function note(seed: number, day: number, what: string): void {
  if (anomalies.length < 400) anomalies.push({ seed, day, what });
}

function makeWorld(seed: number): { world: World; me: Bank; r: Rng } {
  const world = createWorld(seed);
  const r = makeRng(seed * 31 + 7);
  const assets = 80_000_000;
  const capital = Math.round(assets * 0.11);
  const dep = assets - capital;
  const me = createBank(world, {
    name: 'Playtest Bank',
    kind: 'player',
    state: 'TX',
    capital,
    deposits: { checking: Math.round(dep * 0.3), savings: Math.round(dep * 0.3), mmda: Math.round(dep * 0.2), cd: dep - Math.round(dep * 0.3) - Math.round(dep * 0.3) - Math.round(dep * 0.2) },
    loans: Math.round(assets * 0.62),
    securitiesAFS: Math.round(assets * 0.15),
    securitiesHTM: Math.round(assets * 0.05),
    shares: Math.round(capital / 10),
  });
  me.franchise.pool = dep * 25;
  me.franchise.baseShare = 1 / 25;
  me.franchise.targetShare = 1 / 25;
  world.playerBankId = me.id;
  world.player.bankId = me.id;
  world.player.shares = Math.round(me.shares * 0.35);
  world.player.cash = 3_000_000;
  world.player.salary = 150_000;
  world.player.record.push({ bankId: me.id, bankName: me.name, from: 0, to: null, outcome: 'running' });
  for (const role of ['cco', 'cfo', 'clo'] as const) me.officers.push(makeOfficer(world, r, role, assets, 55));
  const states = ['TX', 'TX', 'TX', 'OK', 'NM', 'LA', 'AR'];
  for (let i = 0; i < 60; i++) {
    const a = Math.round(randLogNormal(r, Math.log(200_000_000), 1.1));
    const c = Math.round(a * 0.1);
    const d = a - c;
    const b = createBank(world, {
      name: `Rival ${i + 1}`,
      kind: 'rival',
      state: states[randInt(r, 0, states.length - 1)] as string,
      capital: c,
      deposits: { checking: Math.round(d * 0.3), savings: Math.round(d * 0.3), mmda: Math.round(d * 0.2), cd: d - Math.round(d * 0.3) - Math.round(d * 0.3) - Math.round(d * 0.2) },
      loans: Math.round(a * 0.65),
      securitiesAFS: Math.round(a * 0.15),
    });
    adoptPolicy(b, randomPolicy(r), r);
    b.franchise.pool = d * 40;
    b.franchise.baseShare = 1 / 40;
    b.franchise.targetShare = 1 / 40;
  }
  return { world, me, r };
}

function scanNumbers(obj: unknown, path: string, out: string[], depth = 0): void {
  if (depth > 6 || out.length > 20) return;
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) out.push(`${path} is ${obj}`);
    return;
  }
  if (Array.isArray(obj)) {
    if (obj.length > 50) obj = obj.slice(0, 50);
    (obj as unknown[]).forEach((v, i) => scanNumbers(v, `${path}[${i}]`, out, depth + 1));
    return;
  }
  if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) scanNumbers(v, `${path}.${k}`, out, depth + 1);
}

function checks(world: World, me: Bank, seed: number, feedCount: { n: number; days: number }): void {
  const day = world.day;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    const a = b.acct;
    if (totalAssets(a) - totalLiabilities(a) - totalEquity(a) !== 0) note(seed, day, `${b.name}: ledger gap`);
    if (b.status === 'open') {
      for (const k of ['cash', 'loans', 'securitiesAFS', 'securitiesHTM', 'allowance', 'reo', 'premises', 'goodwill', 'checking', 'savings', 'mmda', 'cd', 'brokered', 'fhlb', 'fedFundsPurchased', 'subDebt'] as const) {
        if (a[k] < 0) note(seed, day, `${b.name}: ${k} negative ${a[k]}`);
      }
      const pooled = b.pools.reduce((s, p) => s + p.balance, 0);
      const book = b.loans.filter((l) => l.status !== 'paid' && l.status !== 'chargedOff' && l.status !== 'reo').reduce((s, l) => s + l.balance, 0);
      if (pooled + book !== a.loans) note(seed, day, `${b.name}: pools ${pooled} + book ${book} != loans ${a.loans}`);
      for (const p of b.pools) {
        const g = p.grades.reduce((s, x) => s + x, 0);
        if (g !== p.balance) note(seed, day, `${b.name}: pool ${p.type} ${p.vintage} grades ${g} != balance ${p.balance}`);
        if (p.grades.some((x) => x < 0)) note(seed, day, `${b.name}: pool ${p.type} ${p.vintage} negative grade`);
        if (!(p.rate > 0 && p.rate < 0.5)) note(seed, day, `${b.name}: pool rate ${p.rate}`);
      }
      const afs = b.lots.filter((l) => l.kind === 'afs').reduce((s, l) => s + l.cost, 0);
      const htm = b.lots.filter((l) => l.kind === 'htm').reduce((s, l) => s + l.cost, 0);
      if (afs !== a.securitiesAFS) note(seed, day, `${b.name}: AFS lots ${afs} != account ${a.securitiesAFS}`);
      if (htm !== a.securitiesHTM) note(seed, day, `${b.name}: HTM lots ${htm} != account ${a.securitiesHTM}`);
      if (b.shares <= 0) note(seed, day, `${b.name}: shares ${b.shares}`);
      if (b.isPublic && !(b.price !== null && b.price > 0)) note(seed, day, `${b.name}: public without a price`);
      if (b.confidence < 0 || b.confidence > 1) note(seed, day, `${b.name}: confidence ${b.confidence}`);
      if (!(b.loanYield >= 0 && b.loanYield < 0.5)) note(seed, day, `${b.name}: loanYield ${b.loanYield}`);
    }
  }
  const p = world.player;
  if (p.shares > me.shares) note(seed, day, `player shares ${p.shares} > bank shares ${me.shares}`);
  if (me.isPublic && me.price !== null && me.price < 0.1 * (totalEquity(me.acct) / Math.max(1, me.shares))) note(seed, day, `price ${me.price} below a tenth of book per share`);
  if (me.shares > 1e10) note(seed, day, `share count ${me.shares} looks inflated`);
  if (p.cash < 0) note(seed, day, `player cash negative ${p.cash}`);
  const bad: string[] = [];
  scanNumbers(me, 'me', bad);
  scanNumbers(world.economy, 'economy', bad);
  scanNumbers(world.player, 'player', bad);
  for (const x of bad) note(seed, day, x);
  for (const pend of world.pending) {
    if (pend.expires === null && day - pend.day > 45) note(seed, day, `pending ${pend.kind} unanswered for ${day - pend.day} days (bot answers everything, so this never resolved)`);
  }
  for (const f of world.feed.slice(-40)) {
    if (/undefined|NaN|\[object|null/.test(f.text)) note(seed, day, `feed text: ${f.text.slice(0, 100)}`);
    if (/[–—]/.test(f.text)) note(seed, day, `feed dash: ${f.text.slice(0, 80)}`);
  }
  void feedCount;
}

function offerIds(world: World): string[] {
  return world.pending.filter((p) => p.kind === 'acquisition_offer').map((p) => p.id);
}

function answer(world: World, r: Rng, seed: number): void {
  for (const p of [...world.pending]) {
    if (p.options.length === 0) {
      note(seed, world.day, `pending ${p.kind} has no options`);
      continue;
    }
    let choice = pick(r, p.options).key;
    if (p.kind === 'competing_bid') choice = chance(r, 0.5) ? 'r' : 'l';
    // Decide once per offer whether to walk, on the day it is made.
    if (p.kind === 'acquisition_offer') {
      if (p.data.botDecided === undefined) p.data.botDecided = chance(r, 0.1) ? 'w' : '';
      choice = p.data.botDecided as string;
    }
    if (choice === '') continue; // let it close on expiry
    const before = world.pending.length;
    const offersBefore = offerIds(world);
    tick(world, [{ pendingId: p.id, choice }]);
    const offersAfter = offerIds(world);
    for (const id of offersBefore) if (!offersAfter.includes(id) && p.kind !== 'acquisition_offer') tally(`offer removed while answering ${p.kind} with ${choice}`);
    if (world.pending.length >= before && world.pending.some((x) => x.id === p.id)) tally(`pending ${p.kind} not removed by decision ${choice}`);
  }
}

function monthlyActions(ctx: Ctx, me: Bank, r: Rng): void {
  const { world } = ctx;
  const assets = totalAssets(me.acct);
  const step = Math.max(500_000, Math.round(assets * 0.02));
  // Rates: follow the market with noise, sometimes stubborn.
  for (const t of DEPOSIT_TYPES) {
    const m = marketRate(world, t);
    setRate(world, t, chance(r, 0.8) ? m + (rand(r) - 0.5) * 0.005 : me.rates[t]);
  }
  // Securities.
  if (chance(r, 0.4) && me.acct.cash > step * 3) buySecurities(ctx, me, chance(r, 0.6) ? 'afs' : 'htm', pick(r, ['treasury', 'agency', 'mbs'] as const), step, pick(r, [1, 3, 5, 7, 10]));
  if (chance(r, 0.2)) {
    const lot = me.lots.find((l) => l.kind === 'afs');
    if (lot) sellSecurities(ctx, me, lot.id, Math.round(lot.cost * rand(r)));
  }
  // Borrowings.
  if (chance(r, 0.15)) borrowFhlb(ctx, me, step);
  if (chance(r, 0.15)) repayFhlb(ctx, me, step);
  if (chance(r, 0.1)) raiseBrokered(ctx, me, step);
  if (chance(r, 0.1)) repayBrokered(ctx, me, step);
  // Officers: fill vacancies, sometimes fire.
  for (const role of ['cco', 'cfo', 'clo'] as const) {
    if (!me.officers.some((o) => o.role === role)) {
      const c = me.officerCandidates.find((x) => x.role === role);
      if (c) hire(ctx, me, c.id);
    }
  }
  if (chance(r, 0.02) && me.officers.length > 0) fire(ctx, me, pick(r, me.officers).id);
  // Capital.
  if (!me.holdingCompany && chance(r, 0.3)) formHoldingCompany(ctx, me);
  const lev = (totalEquity(me.acct) - me.acct.goodwill) / Math.max(1, assets);
  if (lev < 0.075 && chance(r, 0.6)) {
    if (me.isPublic) secondary(ctx, me, Math.round(assets * 0.03));
    else raiseCapital(ctx, me, Math.round(assets * 0.03), Math.min(world.player.cash * 0.3, assets * 0.005));
  }
  if (!me.isPublic && canIpo(me).ok && chance(r, 0.5)) ipo(ctx, me, Math.round(totalEquity(me.acct) * 0.2), Math.round(world.player.shares * 0.1));
  if (me.isPublic && chance(r, 0.05)) buyback(ctx, me, step);
  if (chance(r, 0.03)) sellPlayerShares(ctx, Math.round(world.player.shares * 0.05));
  if (chance(r, 0.1)) setDividendPayout(world, pick(r, [0, 0.2, 0.4, 0.6]));
  if (chance(r, 0.05)) setSalary(world, Math.round(world.player.salary * (0.8 + 0.5 * rand(r))));
  // Policy and dial (no applications without geography, but the setters must not break).
  if (chance(r, 0.1)) setDial(world, pick(r, [0, 100_000, 500_000, 2_000_000]), randInt(r, 3, 6));
  if (chance(r, 0.05)) setPolicy(world, { minDscr: 1 + rand(r) * 0.5, maxLeverage: 3 + rand(r) * 3 });
  // Lines.
  for (const key of LINE_ORDER) {
    if (lineAvailable(me, key) && !me.lines[key].on && chance(r, 0.3)) toggleLine(ctx, me, key);
    else if (me.lines[key].on && chance(r, 0.01)) toggleLine(ctx, me, key);
  }
  // Swaps.
  if (chance(r, 0.05) && assets >= 1e9) enterSwap(ctx, me, Math.round(me.acct.securitiesAFS * 0.3), pick(r, [2, 5, 10]));
  if (chance(r, 0.05) && me.swaps.length > 0) terminateSwap(ctx, me, pick(r, me.swaps).id);
  // Deals: an offer every so often, priced near the board's ask.
  if (chance(r, 0.15) && !world.pending.some((p) => p.kind === 'acquisition_offer')) {
    const targets = world.bankOrder.map((id) => world.banks[id] as Bank).filter((b) => b.kind === 'rival' && b.status === 'open' && totalAssets(b.acct) < assets * 1.2);
    if (targets.length > 0) {
      const t = pick(r, targets);
      const pb = reservationPriceToBook(world, t) + (rand(r) - 0.3) * 0.3;
      const price = Math.round(pb * (totalEquity(t.acct) - t.acct.goodwill));
      const stock = me.holdingCompany ? pick(r, [0, 0.5, 1]) : 0;
      if (proFormaLeverage(me, t, price, stock, creditMark(world, t)) >= 0.07) {
        const res = makeOffer(ctx, me, t.id, Math.round(pb * 100) / 100, stock);
        tally(`offer: ${res.why.replace(/[0-9.$,%MKB]+/g, '#').slice(0, 60)}`);
        if (res.why === 'agreed') {
          const o = world.pending.find((x) => x.kind === 'acquisition_offer');
          traced.push({ id: o?.id ?? 'none', made: world.day, expires: o?.expires ?? null, gone: null, cause: '' });
        }
      } else tally('offer: skipped, pro forma under 7%');
    }
  }
  if (canGoGlobal(me) && chance(r, 0.2) && !world.pending.some((p) => p.kind === 'acquisition_offer')) {
    const code = pick(r, ['GB', 'JP', 'DE', 'HK'] as const);
    const c = pick(r, foreignCandidates(world, code));
    offerForeign(ctx, me, c);
  }
  if (chance(r, 0.02) && me.branches.length > 1) closeBranch(ctx, pick(r, me.branches).id);
}

function run(seed: number): { years: number; assets: number; status: string; feedPerDay: number; pendingPerWeek: number; deals: number; failed: boolean; ms: number; ipo: boolean; lines: number; maxRoa: number; minRoa: number } {
  const { world, me, r } = makeWorld(seed);
  const ctx: Ctx = { world, events: [] };
  const t0 = performance.now();
  let feedItems = 0;
  let pendings = 0;
  let maxRoa = -1;
  let minRoa = 1;
  let days = 0;
  for (let d = 0; d < years * 365; d++) {
    let res;
    const offersBefore = offerIds(world);
    try {
      res = tick(world);
      for (const id of offersBefore) if (!offerIds(world).includes(id)) tally(`offer removed by a plain tick (expiry or lapse): ${res.events.map((e) => e.text.slice(0, 30)).join(' / ').slice(0, 80)}`);
    } catch (e) {
      note(seed, world.day, `EXCEPTION in tick: ${(e as Error).message}`);
      break;
    }
    days += 1;
    feedItems += res.events.length;
    for (const e of res.events) {
      if (/Closed today|denied|lapsed|Walked away|out from under|withdrew|topped/.test(e.text)) tally(`deal event: ${e.text.replace(/[0-9.$,%MKBx]+/g, '#').slice(0, 70)}`);
    }
    pendings += world.pending.some((p) => p.blocking) ? 1 : 0;
    world.feed.push(...ctx.events);
    ctx.events = [];
    for (const p of world.pending) tally(`pending ${p.kind}`);
    try {
      answer(world, r, seed);
    } catch (e) {
      note(seed, world.day, `EXCEPTION in decision: ${(e as Error).message}`);
    }
    if (isMonthEnd(world.day) && me.status === 'open') {
      try {
        monthlyActions(ctx, me, r);
        world.feed.push(...ctx.events);
        ctx.events = [];
      } catch (e) {
        note(seed, world.day, `EXCEPTION in action: ${(e as Error).message}`);
      }
      checks(world, me, seed, { n: feedItems, days });
      tally(`enforcement ${me.enforcement}`);
      tally(`camels ${me.camels.composite}`);
      const last = me.reports[me.reports.length - 1];
      if (last) {
        maxRoa = Math.max(maxRoa, last.roa);
        minRoa = Math.min(minRoa, last.roa);
      }
    }
    if (isYearEnd(world.day)) {
      // Save and load: the copy must continue identically.
      const copy = JSON.parse(JSON.stringify(world)) as World;
      const a = JSON.parse(JSON.stringify(world)) as World;
      for (let i = 0; i < 20; i++) {
        tick(copy);
        tick(a);
      }
      if (JSON.stringify(copy) !== JSON.stringify(a)) note(seed, world.day, 'save and load diverged after 20 ticks');
    }
    for (const t of traced) {
      if (t.gone === null && !world.pending.some((x) => x.id === t.id)) {
        t.gone = world.day;
        t.cause = `pending now: ${world.pending.map((x) => x.kind).join(',') || 'none'}; feed: ${world.feed.slice(-3).map((f) => f.text.slice(0, 40)).join(' / ')}`;
      }
    }
    if (world.playerBankId === null) break;
  }
  const rep = { years: days / 365, assets: totalAssets(me.acct), status: me.status, feedPerDay: feedItems / Math.max(1, days), pendingPerWeek: (pendings / Math.max(1, days)) * 7, deals: world.deals.filter((x) => x.buyer === me.name).length, failed: me.status === 'failed', ms: performance.now() - t0, ipo: me.isPublic, lines: LINE_ORDER.filter((k) => me.lines[k].on).length, maxRoa, minRoa };
  return rep;
}

if (savePath) {
  const { world, me } = makeWorld(900);
  const r = makeRng(1);
  const ctx: Ctx = { world, events: [] };
  for (let d = 0; d < years * 365; d++) {
    tick(world);
    answer(world, r, 900);
    if (isMonthEnd(world.day) && me.status === 'open') {
      monthlyActions(ctx, me, r);
      world.feed.push(...ctx.events);
      ctx.events = [];
    }
  }
  const { writeFileSync } = await import('node:fs');
  writeFileSync(savePath, JSON.stringify(world));
  console.log(`wrote ${savePath}: day ${world.day}, ${me.name} ${(totalAssets(me.acct) / 1e6).toFixed(0)}M assets, ${world.pending.length} pending, ${world.feed.length} feed items`);
  process.exit(0);
}

const summaries = [];
for (let s = 0; s < seeds; s++) summaries.push({ seed: 900 + s, ...run(900 + s) });
console.log('seed  years  assets       status   feed/day  pending/wk  deals  ipo  lines  roa range        ms');
for (const s of summaries) console.log(`${s.seed}  ${s.years.toFixed(1).padStart(5)}  ${(s.assets / 1e6).toFixed(0).padStart(8)}M  ${s.status.padEnd(8)} ${s.feedPerDay.toFixed(2).padStart(8)}  ${s.pendingPerWeek.toFixed(2).padStart(10)}  ${String(s.deals).padStart(5)}  ${s.ipo ? 'yes' : 'no '}  ${String(s.lines).padStart(5)}  ${(s.minRoa * 100).toFixed(1).padStart(6)} to ${(s.maxRoa * 100).toFixed(1).padStart(5)}  ${s.ms.toFixed(0).padStart(6)}`);
console.log('\ntallies (bank-months or events):');
for (const [k, v] of Object.entries(tallies).sort((x, y) => y[1] - x[1])) console.log(`${String(v).padStart(6)}  ${k}`);
console.log('\noffers traced:');
for (const t of traced.slice(0, 12)) console.log(`  ${t.id} made ${t.made} expires ${t.expires} gone ${t.gone} (${t.gone !== null ? t.gone - t.made : '-'} days): ${t.cause.slice(0, 160)}`);
console.log(`\n${anomalies.length} anomalies`);
const grouped: Record<string, Anomaly[]> = {};
for (const a of anomalies) {
  const key = a.what.replace(/[0-9.,-]+/g, '#').slice(0, 90);
  (grouped[key] ??= []).push(a);
}
for (const [k, list] of Object.entries(grouped).sort((x, y) => y[1].length - x[1].length).slice(0, 30)) {
  const first = list[0] as Anomaly;
  console.log(`${String(list.length).padStart(4)}x  ${k}   e.g. seed ${first.seed} day ${first.day}: ${first.what.slice(0, 140)}`);
}
