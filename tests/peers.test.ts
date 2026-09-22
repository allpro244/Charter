// Peers and levers (D56): the peer group is the banks a third to three
// times the bank's size, the medians come from the same call reports the
// rivals file, and every lever's year is finite arithmetic on the desk's
// own balances.

import { describe, expect, it } from 'vitest';
import { PEER_METRICS, levers, peerGroup, statsOf } from '../engine/peers';
import { totalAssets } from '../engine/ledger';
import { newPlayer, startCharter, startableMetros } from '../engine/start';
import { createWorld } from '../engine/state';
import { tick } from '../engine/tick';
import { loadFixtures } from './helpers/fixtures';

function played(seed: number, days: number) {
  const world = createWorld(seed, loadFixtures());
  newPlayer(world);
  const metro = startableMetros(world)[0]!;
  const ctx = { world, events: [] as never[] };
  const bank = startCharter(ctx, { mode: 'charter', cbsa: metro.cbsa, name: 'Peer Bank', invest: 2_000_000 });
  let decisions: { pendingId: string; choice: string }[] = [];
  for (let d = 0; d < days; d++) {
    const r = tick(world, decisions);
    decisions = r.pending.map((p) => ({ pendingId: p.id, choice: p.kind === 'loan_application' ? 'd' : p.kind === 'loan_batch' ? 's' : p.kind === 'rate_prompt' ? 'm' : p.options[0]!.key }));
  }
  return { world, bank };
}

describe('peers and levers (D56)', () => {
  it('the peer group is banks near your size, at least eight of them, with finite medians after a year', () => {
    const { world, bank } = played(61, 520);
    const g = peerGroup(world, bank);
    expect(g.n).toBeGreaterThanOrEqual(8);
    for (const m of PEER_METRICS) expect(Number.isFinite(g.peers[m.key])).toBe(true);
    expect(g.peers.roa).toBeGreaterThan(-0.05);
    expect(g.peers.roa).toBeLessThan(0.05);
    expect(g.peers.efficiency).toBeGreaterThan(0.2);
    expect(g.peers.efficiency).toBeLessThan(1.5);
    expect(g.peers.leverage).toBeGreaterThan(0.04);
    // Your own numbers come from the same function, so the comparison is like for like.
    const you = statsOf(bank);
    expect(you.roa).toBe(g.you.roa);
    expect(Number.isFinite(you.nim)).toBe(true);
    // Every peer in the narrow window is within a third to three times the bank's size when the window holds eight.
    const assets = totalAssets(bank.acct);
    const near = world.bankOrder.map((id) => world.banks[id]!).filter((x) => x.id !== bank.id && x.kind === 'rival' && x.status === 'open' && x.reports.length > 0 && totalAssets(x.acct) >= assets / 3 && totalAssets(x.acct) <= assets * 3);
    if (near.length >= 8) expect(g.n).toBe(near.length);
  });

  it('every lever names a step with a finite year, and the sheet and pricing levers scale with the balances', () => {
    const { world, bank } = played(62, 200);
    const ls = levers(world, bank);
    expect(ls.length).toBeGreaterThanOrEqual(4);
    for (const l of ls) {
      expect(Number.isFinite(l.effect)).toBe(true);
      expect(l.today.length).toBeGreaterThan(0);
      expect(l.step.length).toBeGreaterThan(0);
      expect(['MONEY', 'LENDING', 'MAP', 'YOU']).toContain(l.tab);
    }
    const sheet = ls.find((l) => l.key === 'sheet')!;
    expect(sheet.effect).toBe(Math.round(0.001 * (bank.acct.savings + bank.acct.mmda + bank.acct.cd)));
    expect(ls.find((l) => l.key === 'ld')).toBeDefined();
    expect(ls.find((l) => l.key === 'branch')).toBeDefined();
    expect(ls.find((l) => l.key === 'costs')).toBeDefined();
  });
});
