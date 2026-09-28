// The ladder (D49): where the player's bank stands among America's banks
// by assets, and the milestones on the way up. The other banks are the
// seeds the world was built from, grown with the economy's nominal index,
// plus the banks simulated individually at their current size.

import { type Ctx, emit, milestone } from './ctx';
import { totalAssets } from './ledger';
import { type Bank, type World, playerBank } from './state';
import { sheetRate } from './deposits';
import { IPO_FLOOR } from './capital';
import { GLOBAL_FLOOR } from './global';
import { LINE_THRESHOLDS } from './lines';
import { THRESHOLD_DURBIN, THRESHOLD_GSIB, THRESHOLD_RESOLUTION, THRESHOLD_STRESS } from './regulation';
import { money } from './format';

export interface Rung {
  assets: number;
  state: string;
  name: string | null; // a simulated rival has a name; a seed is just a size
}

// Every other bank in the country, largest first.
export function rungs(world: World): Rung[] {
  const index = world.economy.nominalIndex ?? 1;
  const out: Rung[] = [];
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (id === world.playerBankId) continue;
    if (b.kind !== 'rival' || b.status !== 'open') continue;
    out.push({ assets: totalAssets(b.acct), state: b.state, name: b.name });
  }
  // Seeds stand in for every bank not simulated individually. A seed whose
  // state is expanded is already on the board as a live bank, or inside the
  // small-banks aggregate; the aggregate's members are the smaller seeds.
  for (const [state, list] of Object.entries(world.bankSeeds)) {
    const st = world.geo.states[state];
    const expanded = st?.expanded ?? false;
    for (const s of list) {
      if (s.national) continue; // on the board as a live national
      if (expanded && s.assets >= (list[Math.min(29, list.length - 1)]?.assets ?? 0)) continue; // the largest thirty became live rivals
      out.push({ assets: Math.round(s.assets * index), state, name: null });
    }
  }
  out.sort((a, b) => b.assets - a.assets);
  return out;
}

export interface Ladder {
  rank: number;
  total: number;
  ahead: Rung | null; // the next bank to pass
  behind: Rung | null; // the bank just passed
  largest: Rung | null;
  top100: number; // assets needed for the top 100
}

export function ladder(world: World): Ladder {
  const b = playerBank(world);
  const all = rungs(world);
  const mine = b ? totalAssets(b.acct) : 0;
  let rank = 1;
  let ahead: Rung | null = null;
  let behind: Rung | null = null;
  for (const r of all) {
    if (r.assets > mine) {
      rank++;
      ahead = r;
    } else if (!behind) behind = r;
  }
  return { rank, total: all.length + 1, ahead, behind, largest: all[0] ?? null, top100: all[98]?.assets ?? 0 };
}

export const RUNGS = [1000, 500, 250, 100, 50, 25, 10, 5, 2];

// Monthly: keep the rank on the world and mark the rungs as they pass.
export function ladderMonthly(ctx: Ctx): void {
  const { world } = ctx;
  const b = playerBank(world);
  if (!b || b.status !== 'open') return;
  localRaceMonthly(ctx, b);
  thresholdsMonthly(ctx, b);
  const l = ladder(world);
  const before = world.ladder.rank;
  world.ladder.rank = l.rank;
  world.ladder.total = l.total;
  for (const r of RUNGS) {
    if (l.rank <= r && (before === 0 || before > r) && !world.ladder.crossed.includes(r)) {
      world.ladder.crossed.push(r);
      const text = r === 2 ? `Second largest bank in America: only ${l.ahead ? money(l.ahead.assets) : 'one'} of assets stands ahead` : `Into the top ${r} banks in America at ${money(totalAssets(b.acct))} of assets`;
      milestone(ctx, text);
      emit(ctx, 'system', text, { severity: 'good', bankId: b.id });
    }
  }
}

// The race at home (D72): the banks with branches in the player's home
// county, by the deposits each holds there. The next bank to pass is the
// smallest one still ahead: a goal a young bank can reach, where the
// national ladder is years away. Simulated banks only; the aggregates are
// many banks at once and are not a name to pass.
export interface LocalRival {
  id: string;
  name: string;
  deposits: number; // what it holds in the county
  rateGap: number; // its rate sheet against yours, a fraction; positive pays more
}

export interface LocalStanding {
  county: string;
  countyName: string;
  rank: number;
  total: number;
  mine: number;
  ahead: LocalRival | null;
  behind: LocalRival | null;
  aheadIds: string[];
}

export function localStanding(world: World, b: Bank): LocalStanding | null {
  const fips = b.homeCounty;
  const county = fips ? world.geo.counties[fips] : undefined;
  if (!fips || !county) return null;
  const mine = b.branches.filter((br) => br.county === fips).reduce((x, br) => x + br.deposits, 0);
  const others: LocalRival[] = [];
  for (const id of world.bankOrder) {
    const x = world.banks[id] as Bank;
    if (x.id === b.id || x.kind !== 'rival' || x.status !== 'open') continue;
    const held = x.branches.filter((br) => br.county === fips).reduce((s, br) => s + br.deposits, 0);
    if (held > 0) others.push({ id: x.id, name: x.name, deposits: held, rateGap: sheetRate(x) - sheetRate(b) });
  }
  const aheadOf = others.filter((o) => o.deposits > mine).sort((a, c) => a.deposits - c.deposits);
  const behindOf = others.filter((o) => o.deposits <= mine).sort((a, c) => c.deposits - a.deposits);
  return { county: fips, countyName: county.name, rank: aheadOf.length + 1, total: others.length + 1, mine, ahead: aheadOf[0] ?? null, behind: behindOf[0] ?? null, aheadIds: aheadOf.map((o) => o.id) };
}

// Monthly: the passes both ways make the feed, and a pass up is a
// milestone; first place at home is one of its own.
export function localRaceMonthly(ctx: Ctx, b: Bank): void {
  const { world } = ctx;
  const s = localStanding(world, b);
  if (!s || s.total < 2) return;
  const prev = world.ladder.local;
  if (prev && prev.county === s.county) {
    const passed = prev.ahead.filter((id) => !s.aheadIds.includes(id) && world.banks[id]?.status === 'open');
    const passedBy = s.aheadIds.filter((id) => !prev.ahead.includes(id));
    if (passed.length > 0 && s.rank < prev.rank) {
      const names = passed.map((id) => world.banks[id]?.name ?? 'a bank');
      const text = `In ${s.countyName} you passed ${names.join(' and ')}: now #${s.rank} of ${s.total} banks with branches there by deposits`;
      milestone(ctx, text);
      emit(ctx, 'system', text, { severity: 'good', bankId: b.id });
    } else if (passedBy.length > 0 && s.rank > prev.rank) {
      const names = passedBy.map((id) => world.banks[id]?.name ?? 'a bank');
      emit(ctx, 'rival', `${names.join(' and ')} passed you in ${s.countyName}: now #${s.rank} of ${s.total} there by deposits`, { severity: 'alert', bankId: b.id });
    }
  }
  const led = prev?.ledOnce ?? false;
  if (s.rank === 1 && !led) {
    const text = `The largest bank in ${s.countyName} by deposits`;
    milestone(ctx, text);
    emit(ctx, 'system', text, { severity: 'good', bankId: b.id });
  }
  world.ladder.local = { county: s.county, rank: s.rank, total: s.total, ahead: s.aheadIds, ledOnce: led || s.rank === 1 };
}

// Size thresholds (D14, D74): each one changes what the bank may do and
// the rules it lives under. Every line names only what the engine does at
// that size, from the same constants the rules read.
export interface Threshold {
  assets: number;
  stage: string;
  brings: string;
}

export function thresholds(): Threshold[] {
  return [
    { assets: IPO_FLOOR, stage: 'a regional bank', brings: `an IPO opens (with a holding company) and so does a mortgage business line (${money(LINE_THRESHOLDS.mortgage)})` },
    { assets: THRESHOLD_DURBIN, stage: 'a large regional bank', brings: 'debit interchange is halved (Durbin), the community bank leverage ratio no longer applies, exams come every twelve months, deposit insurance prices wholesale and uninsured funding, and a card business line opens' },
    { assets: LINE_THRESHOLDS.wealth, stage: 'a large regional bank', brings: 'a wealth management business line opens' },
    { assets: THRESHOLD_RESOLUTION, stage: 'a large regional bank', brings: 'a resolution plan is required, a standing cost of about a basis point of assets a year' },
    { assets: THRESHOLD_STRESS, stage: 'a national bank', brings: 'the Fed stress tests the bank every year (a failed test stops dividends and sets a stress capital buffer), and investment banking and trading open' },
    { assets: GLOBAL_FLOOR, stage: 'a national bank', brings: 'banks abroad open to a holding company under no enforcement action' },
    { assets: THRESHOLD_GSIB, stage: 'a global bank', brings: 'with a business abroad, designation as a global systemically important bank and its capital surcharge' },
  ];
}

export function nextThreshold(assets: number): Threshold | null {
  return thresholds().find((t) => t.assets > assets) ?? null;
}

// Monthly with the ladder: a threshold crossed is a milestone that says
// what it brings.
export function thresholdsMonthly(ctx: Ctx, b: Bank): void {
  const { world } = ctx;
  const assets = totalAssets(b.acct);
  // A bank that starts, or a save that loads, past a threshold did not
  // just cross it: the first look marks those quietly.
  if (world.ladder.thresholds === undefined) {
    world.ladder.thresholds = thresholds().filter((t) => t.assets <= assets).map((t) => t.assets);
    return;
  }
  const crossed = world.ladder.thresholds;
  for (const t of thresholds()) {
    if (assets < t.assets || crossed.includes(t.assets)) continue;
    crossed.push(t.assets);
    const text = `Past ${money(t.assets)} of assets, ${t.stage}: ${t.brings}`;
    milestone(ctx, text);
    emit(ctx, 'system', text, { severity: 'good', bankId: b.id });
  }
}
