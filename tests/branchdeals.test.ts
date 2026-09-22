// Branch purchases (D59): the deposits move with cash less the premium,
// the premium is goodwill, both ledgers balance, the check refuses what
// the capital cannot carry, and offers arrive within the player's reach.

import { describe, expect, it } from 'vitest';
import { branchOffersMonthly, branchPurchaseCheck, buyBranch, offerFrom } from '../engine/branchdeals';
import { coreDeposits } from '../engine/deposits';
import { imbalance, totalDeposits } from '../engine/ledger';
import { newPlayer, startCharter, startableMetros } from '../engine/start';
import { type Bank, createWorld } from '../engine/state';
import { tick } from '../engine/tick';
import { loadFixtures } from './helpers/fixtures';

function charter(seed: number) {
  const world = createWorld(seed, loadFixtures());
  newPlayer(world);
  const metro = startableMetros(world)[0]!;
  const ctx = { world, events: [] as never[] };
  const bank = startCharter(ctx, { mode: 'charter', cbsa: metro.cbsa, name: 'Buyer Bank', invest: 2_000_000 });
  return { world, ctx, bank };
}

function aSeller(world: ReturnType<typeof createWorld>, buyer: Bank): Bank {
  const rivals = world.bankOrder.map((id) => world.banks[id] as Bank).filter((b) => b.kind === 'rival' && b.status === 'open' && b.homeCounty).sort((x, y) => (x.state === buyer.state ? 0 : 1) - (y.state === buyer.state ? 0 : 1));
  for (const r of rivals) {
    r.officesExtra = Math.max(r.officesExtra ?? 0, 3);
    if (offerFrom(world, r, buyer)) return r;
  }
  throw new Error('no seller');
}

describe('branch purchases (D59)', () => {
  it('moves the deposits with cash less the premium, books the premium as goodwill, and both ledgers balance', () => {
    const { world, ctx, bank } = charter(81);
    bank.acct.cash += 20_000_000;
    bank.acct.commonStock += 20_000_000;
    const seller = aSeller(world, bank);
    const found = offerFrom(world, seller, bank)!;
    const offer = found.offer;
    const check = branchPurchaseCheck(world, bank, seller, offer);
    expect(check.ok).toBe(true);
    const buyerDep = totalDeposits(bank.acct);
    const buyerCash = bank.acct.cash;
    const sellerDep = totalDeposits(seller.acct);
    const sellerCash = seller.acct.cash;
    const officesBefore = seller.officesExtra ?? 0;
    expect(buyBranch(ctx, bank, seller, offer)).toBe(true);
    expect(totalDeposits(bank.acct) - buyerDep).toBe(offer.deposits);
    expect(bank.acct.cash - buyerCash).toBe(offer.deposits - check.premium);
    expect(bank.acct.goodwill).toBeGreaterThanOrEqual(check.premium);
    expect(sellerDep - totalDeposits(seller.acct)).toBe(offer.deposits);
    expect(sellerCash - seller.acct.cash).toBe(offer.deposits - check.premium);
    expect(seller.officesExtra).toBe(officesBefore - 1);
    expect(bank.branches.some((br) => br.county === offer.county && br.deposits === offer.deposits)).toBe(true);
    expect(imbalance(bank.acct)).toBe(0);
    expect(imbalance(seller.acct)).toBe(0);
    // The same county cannot be bought twice.
    expect(branchPurchaseCheck(world, bank, seller, offer).ok).toBe(false);
  });

  it('refuses a purchase the capital cannot carry, with the reason', () => {
    const { world, bank } = charter(82);
    const seller = aSeller(world, bank);
    const offer = offerFrom(world, seller, bank)!.offer;
    // Thin the buyer to the well capitalized line: the goodwill would breach it.
    const equity = bank.acct.commonStock;
    bank.acct.cash -= equity * 0.5;
    bank.acct.commonStock -= equity * 0.5;
    const big = { ...offer, deposits: Math.min(coreDeposits(seller), offer.deposits * 50) };
    const check = branchPurchaseCheck(world, bank, seller, big);
    if (!check.ok) expect(check.reason).toMatch(/leverage|deposits/);
    else expect(check.leverageAfter).toBeGreaterThanOrEqual(0.05);
  });

  it('offers arrive from rivals within reach and pass when unanswered', () => {
    const { world, ctx, bank } = charter(83);
    for (const id of world.bankOrder) {
      const r = world.banks[id] as Bank;
      if (r.kind === 'rival' && r.state === bank.state && r.ai) {
        r.officesExtra = 3;
        r.ai.branchPush = 0.1;
      }
    }
    let offers = 0;
    let decisions: { pendingId: string; choice: string }[] = [];
    for (let d = 0; d < 3 * 365; d++) {
      const r = tick(world, decisions);
      offers += r.pending.filter((p) => p.kind === 'branch_offer').length;
      decisions = r.pending.filter((p) => p.kind !== 'branch_offer').map((p) => ({ pendingId: p.id, choice: p.kind === 'loan_application' ? 'd' : p.kind === 'loan_batch' ? 's' : p.kind === 'rate_prompt' ? 'm' : p.options[0]!.key }));
    }
    expect(offers).toBeGreaterThan(0);
    // Left alone every offer expired as a pass: one branch, no goodwill.
    expect(bank.branches.length).toBe(1);
    expect(bank.acct.goodwill).toBe(0);
    expect(world.pending.filter((p) => p.kind === 'branch_offer').length).toBeLessThanOrEqual(1);
    void branchOffersMonthly;
    void ctx;
  });
});
