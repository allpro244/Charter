// Operating accounts (D58): a business that borrows keeps its operating
// balances with the lender, so the checking target rises with the C&I and
// owner occupied CRE book at the hand band's share and nothing else.

import { describe, expect, it } from 'vitest';
import { calibration } from '../data/calibration';
import { businessBalances } from '../engine/credit';
import { depositTargets } from '../engine/deposits';
import { newPlayer, startCharter, startableMetros } from '../engine/start';
import { createWorld } from '../engine/state';
import { tick } from '../engine/tick';
import { loadFixtures } from './helpers/fixtures';

describe('operating accounts (D58)', () => {
  it('the checking target carries the band share of the business book, recomputed at the monthly close', () => {
    const world = createWorld(71, loadFixtures());
    newPlayer(world);
    const metro = startableMetros(world)[0]!;
    const ctx = { world, events: [] as never[] };
    const bank = startCharter(ctx, { mode: 'charter', cbsa: metro.cbsa, name: 'Business Bank', invest: 2_000_000 });
    bank.confidence = 1;
    const before = depositTargets(world, bank).checking;
    // A business book appears: the pooled lending books C&I and owner occupied CRE.
    bank.acct.cash += 30_000_000;
    bank.acct.commonStock += 30_000_000;
    let decisions: { pendingId: string; choice: string }[] = [];
    for (let d = 0; d < 70; d++) {
      const r = tick(world, decisions);
      decisions = r.pending.map((p) => ({ pendingId: p.id, choice: p.kind === 'loan_application' ? 'd' : p.kind === 'loan_batch' ? 's' : p.kind === 'rate_prompt' ? 'm' : p.options[0]!.key }));
    }
    // The base is what the last monthly close saw; the book has only grown since.
    const business = businessBalances(bank);
    expect(business).toBeGreaterThan(0);
    expect(bank.operatingBase ?? 0).toBeGreaterThan(0);
    expect(bank.operatingBase ?? 0).toBeLessThanOrEqual(business);
    const base = bank.operatingBase ?? 0;
    let ci = 0;
    for (const p of bank.pools) if (p.type === 'ci' || p.type === 'cre_oo') ci += p.balance;
    for (const l of bank.loans) if ((l.type === 'ci' || l.type === 'cre_oo') && l.status !== 'paid' && l.status !== 'chargedOff' && l.status !== 'reo' && l.status !== 'sold') ci += l.balance;
    expect(business).toBe(Math.round((ci * calibration.operatingBalanceShare.typical) / 100));
    // The target moves by exactly the operating balances at full confidence.
    bank.confidence = 1;
    const withBusiness = depositTargets(world, bank).checking;
    bank.operatingBase = 0;
    const without = depositTargets(world, bank).checking;
    expect(withBusiness - without).toBe(base);
    expect(without).toBeGreaterThan(0);
    void before;
  });
});
