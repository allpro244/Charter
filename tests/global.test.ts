// Global stage (D45): a $1T+ bank in three countries with a reconciled
// multi-currency balance sheet, translation through AOCI, sovereign
// events, G-SIB designation and surcharge.

import { describe, expect, it } from 'vitest';
import { formHoldingCompany } from '../engine/capital';
import type { Ctx } from '../engine/ctx';
import { closeForeign, foreignCandidates, foreignSummary, gsibSurcharge, offerForeign, sovereignEvent } from '../engine/global';
import { totalAssets, totalEquity, totalLiabilities } from '../engine/ledger';
import { makeRng } from '../engine/rng';
import { makeOfficer } from '../engine/officers';
import { capitalStack } from '../engine/regulation';
import { type Bank, type World, createBank, createWorld } from '../engine/state';
import { tick } from '../engine/tick';
import { marketRate, setRate } from '../engine/deposits';
import { DEPOSIT_TYPES } from '../engine/ledger';

function balanced(world: World) {
  for (const id of world.bankOrder) {
    const a = world.banks[id]!.acct;
    expect(totalAssets(a) - totalLiabilities(a) - totalEquity(a)).toBe(0);
  }
}

function giant(world: World, assets: number): Bank {
  const capital = Math.round(assets * 0.1);
  const dep = assets - capital;
  const b = createBank(world, {
    name: 'Global Bank',
    kind: 'player',
    state: 'NY',
    capital,
    deposits: { checking: Math.round(dep * 0.3), savings: Math.round(dep * 0.3), mmda: Math.round(dep * 0.2), cd: dep - Math.round(dep * 0.3) - Math.round(dep * 0.3) - Math.round(dep * 0.2) },
    loans: Math.round(assets * 0.55),
    securitiesAFS: Math.round(assets * 0.15),
    securitiesHTM: Math.round(assets * 0.05),
    shares: Math.round(capital / 10),
  });
  b.franchise.pool = dep * 20;
  b.franchise.baseShare = 1 / 20;
  b.franchise.targetShare = 1 / 20;
  world.playerBankId = b.id;
  world.player.bankId = b.id;
  world.player.shares = Math.round(b.shares * 0.2);
  const r = makeRng(1);
  for (const role of ['cco', 'cfo', 'clo'] as const) b.officers.push(makeOfficer(world, r, role, assets, 70));
  formHoldingCompany({ world, events: [] }, b);
  return b;
}

describe('global stage', () => {
  it('a $1T bank in three countries keeps a reconciled multi-currency balance sheet for five years', () => {
    const world = createWorld(71);
    const me = giant(world, 900_000_000_000);
    const ctx = { world, events: [] };
    for (const code of ['GB', 'JP', 'DE'] as const) {
      const cands = foreignCandidates(world, code);
      expect(cands.length).toBe(3);
      const c = cands.reduce((x, y) => (y.assetsLocal > x.assetsLocal ? y : x));
      expect(offerForeign(ctx, me, c).ok).toBe(true);
      // Close the pending deal at once for the test.
      const p = world.pending.find((x) => x.kind === 'acquisition_offer')!;
      world.pending = world.pending.filter((x) => x.id !== p.id);
      closeForeign(ctx, me, c);
    }
    expect(me.foreign.length).toBe(3);
    balanced(world);
    const aociBefore = me.acct.aoci;
    let fxMoved = false;
    for (let d = 0; d < 5 * 365; d++) {
      tick(world);
      balanced(world);
      // The treasury desk keeps the rate sheet at market.
      if (d % 30 === 0) for (const t of DEPOSIT_TYPES) setRate(world, t, marketRate(world, t));
      if (Math.abs(world.countries.GB!.fx / world.countries.GB!.fxStart - 1) > 0.05) fxMoved = true;
      for (const p of world.pending) if (p.kind === 'enforcement' || p.kind === 'exam_result') tick(world, [{ pendingId: p.id, choice: 'k' }]);
    }
    expect(fxMoved).toBe(true);
    // Translation went through AOCI, and the consolidated lines carry the
    // subsidiaries at the closing rate.
    expect(me.acct.aoci).not.toBe(aociBefore);
    let carriedAssets = 0;
    for (const f of me.foreign) {
      const s = foreignSummary(world, f);
      expect(s.assets).toBeGreaterThan(0);
      carriedAssets += f.carried.cash + f.carried.loans + f.carried.securitiesHTM + f.carried.securitiesAFS + f.carried.otherAssets + f.carried.premises + f.carried.reo + f.carried.interestReceivable;
      expect(Math.abs(carriedAssets)).toBeGreaterThan(0);
    }
    expect(me.status).toBe('open');
    expect(totalAssets(me.acct)).toBeGreaterThan(1_000_000_000_000);
  });

  it('a sovereign event haircuts the local bonds and stays balanced', () => {
    const world = createWorld(72);
    const me = giant(world, 600_000_000_000);
    const ctx: Ctx = { world, events: [] };
    const c = foreignCandidates(world, 'JP')[0]!;
    closeForeign(ctx, me, c);
    const op = me.foreign[0]!;
    const bondsBefore = op.sovereignBonds;
    const fxBefore = world.countries.JP!.fx;
    sovereignEvent(ctx, world.countries.JP!);
    expect(op.sovereignBonds).toBeLessThan(bondsBefore);
    expect(world.countries.JP!.fx).toBeGreaterThan(fxBefore);
    for (let d = 0; d < 40; d++) tick(world);
    balanced(world);
    expect(ctx.events.some((f) => /sovereign/.test(f.text))).toBe(true);
  });

  it('G-SIB designation adds a surcharge to the buffer and the largest bank milestone fires', () => {
    const world = createWorld(73);
    const me = giant(world, 1_200_000_000_000);
    const ctx = { world, events: [] };
    closeForeign(ctx, me, foreignCandidates(world, 'GB')[0]!);
    const before = capitalStack(me);
    for (let d = 0; d < 100; d++) {
      tick(world);
      for (const p of world.pending) tick(world, [{ pendingId: p.id, choice: p.options[0]!.key }]);
    }
    expect(me.gsib).not.toBeNull();
    expect(me.gsib!.surcharge).toBe(gsibSurcharge(totalAssets(me.acct)));
    const after = capitalStack(me);
    // The required buffer rose by the surcharge, so the payout quartile can only fall.
    expect(after.maxPayout).toBeLessThanOrEqual(before.maxPayout);
    expect(world.milestones.some((m) => /systemically important/.test(m.text))).toBe(true);
    // Passing the largest bank in America: a giant raise and the deposits to go with it.
    me.acct.cash += 3_000_000_000_000;
    me.acct.checking += 2_700_000_000_000;
    me.acct.commonStock += 300_000_000_000;
    // The franchise grows with the deposits so they stay.
    me.franchise.pool = (me.acct.checking + me.acct.savings + me.acct.mmda + me.acct.cd) * 20;
    me.franchise.baseShare = 1 / 20;
    me.franchise.targetShare = 1 / 20;
    for (let d = 0; d < 100; d++) {
      tick(world);
      for (const p of world.pending) tick(world, [{ pendingId: p.id, choice: p.options[0]!.key }]);
    }
    expect(world.milestones.some((m) => /largest bank in America/.test(m.text))).toBe(true);
    balanced(world);
  });

  it('foreign banks are cheaper in a local recession', () => {
    const world = createWorld(74);
    world.countries.DE!.regime = 'expansion';
    const boom = foreignCandidates(world, 'DE').reduce((s, c) => s + c.priceToBook, 0) / 3;
    world.countries.DE!.regime = 'recession';
    const bust = foreignCandidates(world, 'DE').reduce((s, c) => s + c.priceToBook, 0) / 3;
    expect(bust).toBeLessThan(boom);
  });
});
