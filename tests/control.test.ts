// Control (D61): the raise preview matches the raise, the board of a bank
// the CEO does not control replaces a CEO after two years of losses, and
// an owner cannot be removed.

import { describe, expect, it } from 'vitest';
import { boardQuarterly, ownership, raiseCapital, stakeAfterRaise } from '../engine/capital';
import { newPlayer, startCharter, startableMetros } from '../engine/start';
import { type CallReport, createWorld } from '../engine/state';
import { tick } from '../engine/tick';
import { loadFixtures } from './helpers/fixtures';

function charter(seed: number, days: number) {
  const world = createWorld(seed, loadFixtures());
  newPlayer(world);
  const metro = startableMetros(world)[0]!;
  const ctx = { world, events: [] as never[] };
  const bank = startCharter(ctx, { mode: 'charter', cbsa: metro.cbsa, name: 'Control Bank', invest: 2_000_000 });
  let decisions: { pendingId: string; choice: string }[] = [];
  for (let d = 0; d < days; d++) {
    const r = tick(world, decisions);
    decisions = r.pending.map((p) => ({ pendingId: p.id, choice: p.kind === 'loan_application' ? 'd' : p.kind === 'loan_batch' ? 's' : p.kind === 'rate_prompt' ? 'm' : p.options[0]!.key }));
  }
  return { world, ctx, bank };
}

describe('control and the board (D61)', () => {
  it('the desk\'s stake after a raise is the stake the raise leaves', () => {
    const { world, ctx, bank } = charter(91, 100);
    const amount = 3_000_000;
    const mine = Math.min(world.player.cash, 500_000);
    const said = stakeAfterRaise(world, bank, amount, mine)!;
    expect(said).not.toBeNull();
    expect(raiseCapital(ctx, bank, amount, mine)).not.toBeNull();
    expect(Math.abs(ownership(world, bank).player - said)).toBeLessThan(0.002);
  });

  it('a board the CEO does not control replaces the CEO after eight losing quarters; an owner stays', () => {
    const { world, ctx, bank } = charter(92, 100);
    expect(bank.reports.length).toBeGreaterThan(0);
    const template = bank.reports[bank.reports.length - 1] as CallReport;
    const losing = () => ({ ...template, netIncome: -1 });
    // Past the de novo years, so the losses count.
    bank.charteredDay = world.day - 4 * 365;
    // Owner: half the shares or more, losses change nothing.
    bank.reports = Array.from({ length: 8 }, losing);
    world.player.shares = bank.shares;
    expect(ownership(world, bank).player).toBeGreaterThanOrEqual(0.5);
    boardQuarterly(ctx);
    expect(world.playerBankId).toBe(bank.id);
    // Diluted under half: the board warns, then acts.
    bank.shares = world.player.shares * 3;
    bank.reports = Array.from({ length: 5 }, losing);
    boardQuarterly(ctx);
    expect(world.playerBankId).toBe(bank.id);
    expect(ctx.events.some((e) => /restless/.test((e as { text: string }).text))).toBe(true);
    bank.reports = Array.from({ length: 8 }, losing);
    const cashBefore = world.player.cash;
    boardQuarterly(ctx);
    expect(world.playerBankId).toBeNull();
    expect(world.player.bankId).toBeNull();
    expect(world.player.shares).toBe(0);
    expect(world.player.cash).toBeGreaterThan(cashBefore);
    expect(bank.kind).toBe('rival');
    expect(bank.ai).not.toBeNull();
    expect(world.player.record.find((r) => r.bankId === bank.id)?.outcome).toBe('removed');
    expect(world.pending.some((p) => p.kind === 'failure' && /replaced you/.test(p.title))).toBe(true);
    // The world keeps running without a player bank.
    tick(world, []);
    expect(bank.status).toBe('open');
  });
});
