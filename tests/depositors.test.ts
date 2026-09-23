// Large depositors (D62): an accepted account arrives with its cash, holds
// in the targets for its term, costs its premium at the close, leaves the
// targets when the term ends, and the ledger balances throughout.

import { describe, expect, it } from 'vitest';
import { type DepositOffer, decideDepositOffer, depositOffersMonthly, relationshipsMonthly } from '../engine/depositors';
import { depositTargets } from '../engine/deposits';
import { imbalance, totalDeposits } from '../engine/ledger';
import { newPlayer, startCharter, startableMetros } from '../engine/start';
import { type Pending, createWorld } from '../engine/state';
import { accrueMonth, tick } from '../engine/tick';
import { loadFixtures } from './helpers/fixtures';

function charter(seed: number, days: number) {
  const world = createWorld(seed, loadFixtures());
  newPlayer(world);
  const metro = startableMetros(world)[0]!;
  const ctx = { world, events: [] as never[] };
  const bank = startCharter(ctx, { mode: 'charter', cbsa: metro.cbsa, name: 'Depositor Bank', invest: 2_000_000 });
  let decisions: { pendingId: string; choice: string }[] = [];
  for (let d = 0; d < days; d++) {
    const r = tick(world, decisions);
    decisions = r.pending.filter((p) => p.kind !== 'deposit_offer').map((p) => ({ pendingId: p.id, choice: p.kind === 'loan_application' ? 'd' : p.kind === 'loan_batch' ? 's' : p.kind === 'rate_prompt' ? 'm' : p.options[0]!.key }));
  }
  return { world, ctx, bank };
}

function anOffer(world: ReturnType<typeof createWorld>): Pending {
  // Ask month after month until one arrives (a stream of its own per day).
  for (let i = 0; i < 120; i++) {
    const ctx = { world, events: [] as never[] };
    depositOffersMonthly(ctx);
    const p = world.pending.find((x) => x.kind === 'deposit_offer');
    if (p) return p;
    world.day += 30;
  }
  throw new Error('no offer in ten years');
}

describe('large depositors (D62)', () => {
  it('an accepted account arrives with cash, sits in the targets, costs its premium, and leaves the targets when the term ends', () => {
    const { world, ctx, bank } = charter(101, 200);
    bank.confidence = 1;
    const p = anOffer(world);
    const offer = p.data.offer as DepositOffer;
    expect(offer.amount).toBeGreaterThanOrEqual(1_000_000);
    expect(offer.premium).toBeGreaterThan(0);
    const before = depositTargets(world, bank)[offer.type];
    const dep = totalDeposits(bank.acct);
    const cash = bank.acct.cash;
    world.pending = world.pending.filter((x) => x.id !== p.id);
    decideDepositOffer(ctx, p, { pendingId: p.id, choice: 'a' });
    expect(totalDeposits(bank.acct) - dep).toBe(offer.amount);
    expect(bank.acct.cash - cash).toBe(offer.amount);
    expect(bank.relationships?.length).toBe(1);
    expect(depositTargets(world, bank)[offer.type] - before).toBe(offer.amount);
    expect(imbalance(bank.acct)).toBe(0);
    // The premium is paid at the close, on top of the sheet.
    const costBefore = bank.is.month.interestMmda + bank.is.month.interestCd;
    accrueMonth(ctx, bank);
    const cost = bank.is.month.interestMmda + bank.is.month.interestCd - costBefore;
    expect(cost).toBeGreaterThanOrEqual(Math.round((offer.amount * offer.premium * 28) / 365));
    expect(imbalance(bank.acct)).toBe(0);
    // Confidence gone: the money leaves the targets first.
    bank.confidence = 0.5;
    expect(depositTargets(world, bank)[offer.type]).toBeLessThan(before + offer.amount);
    bank.confidence = 1;
    // The term ends: the agreement goes, the balance stays.
    bank.relationships![0]!.until = world.day;
    relationshipsMonthly(ctx, bank);
    expect(bank.relationships?.length).toBe(0);
    expect(totalDeposits(bank.acct) - dep).toBeGreaterThanOrEqual(offer.amount); // the balance stays, plus the interest credited
    expect(depositTargets(world, bank)[offer.type]).toBe(before);
    expect(ctx.events.some((e) => /rate agreement ended/.test((e as { text: string }).text))).toBe(true);
  });

  it('a declined or expired offer changes nothing', () => {
    const { world, ctx, bank } = charter(102, 200);
    const p = anOffer(world);
    const dep = totalDeposits(bank.acct);
    world.pending = world.pending.filter((x) => x.id !== p.id);
    decideDepositOffer(ctx, p, null);
    expect(totalDeposits(bank.acct)).toBe(dep);
    expect(bank.relationships ?? []).toEqual([]);
    expect(ctx.events.some((e) => /to a rival/.test((e as { text: string }).text))).toBe(true);
  });
});
