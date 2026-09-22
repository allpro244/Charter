// The ladder (D49): where the player's bank stands among America's banks
// by assets, and the milestones on the way up. The other banks are the
// seeds the world was built from, grown with the economy's nominal index,
// plus the banks simulated individually at their current size.

import { type Ctx, emit, milestone } from './ctx';
import { totalAssets } from './ledger';
import { type Bank, type World, playerBank } from './state';
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
