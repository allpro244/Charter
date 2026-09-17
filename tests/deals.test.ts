// Capital markets, M&A, and business lines (SYSTEMS.md systems 10 and 11).

import { describe, expect, it } from 'vitest';
import { calibration } from '../data/calibration';
import { buyback, canIpo, formHoldingCompany, ipo, marketCap, ownership, raiseCapital, secondary, sellPlayerShares } from '../engine/capital';
import { bookByType } from '../engine/credit';
import { creditMark, makeOffer, proFormaLeverage, reservationPriceToBook } from '../engine/deals';
import { LOAN_TYPES } from '../engine/loantypes';
import { toggleLine } from '../engine/lines';
import { totalAssets, totalDeposits, totalEquity, totalLiabilities } from '../engine/ledger';
import { randomPolicy } from '../engine/rivals';
import { makeRng, randLogNormal } from '../engine/rng';
import { type Bank, type World, createBank, createWorld } from '../engine/state';
import { makeOfficer } from '../engine/officers';
import { tick } from '../engine/tick';
import { isYearEnd } from '../engine/time';

function balanced(world: World) {
  for (const id of world.bankOrder) {
    const a = world.banks[id]!.acct;
    expect(totalAssets(a) - totalLiabilities(a) - totalEquity(a)).toBe(0);
  }
}

function rival(world: World, name: string, assets: number, r: ReturnType<typeof makeRng>, state = 'TX'): Bank {
  const capital = Math.round(assets * 0.1);
  const dep = assets - capital;
  const b = createBank(world, {
    name,
    kind: 'rival',
    state,
    capital,
    deposits: { checking: Math.round(dep * 0.3), savings: Math.round(dep * 0.3), mmda: Math.round(dep * 0.2), cd: dep - Math.round(dep * 0.3) - Math.round(dep * 0.3) - Math.round(dep * 0.2) },
    loans: Math.round(assets * 0.65),
    securitiesAFS: Math.round(assets * 0.15),
  });
  b.ai = randomPolicy(r);
  b.franchise.pool = dep * 40;
  b.franchise.baseShare = 1 / 40;
  b.franchise.targetShare = 1 / 40;
  return b;
}

function player(world: World, assets: number): Bank {
  const capital = Math.round(assets * 0.12);
  const dep = assets - capital;
  const b = createBank(world, {
    name: 'Player Bank',
    kind: 'player',
    state: 'TX',
    capital,
    deposits: { checking: Math.round(dep * 0.3), savings: Math.round(dep * 0.3), mmda: Math.round(dep * 0.2), cd: dep - Math.round(dep * 0.3) - Math.round(dep * 0.3) - Math.round(dep * 0.2) },
    loans: Math.round(assets * 0.6),
    securitiesAFS: Math.round(assets * 0.15),
    shares: Math.round(capital / 10),
  });
  b.franchise.pool = dep * 30;
  b.franchise.baseShare = 1 / 30;
  b.franchise.targetShare = 1 / 30;
  world.playerBankId = b.id;
  world.player.bankId = b.id;
  world.player.shares = Math.round(b.shares * 0.4);
  world.player.cash = 2_000_000;
  world.player.record.push({ bankId: b.id, bankName: b.name, from: 0, to: null, outcome: 'running' });
  const r = makeRng(assets % 997);
  for (const role of ['cco', 'cfo', 'clo'] as const) b.officers.push(makeOfficer(world, r, role, assets, 60));
  return b;
}

describe('capital markets and deals', () => {
  it('crisis-year deals are measurably cheaper than expansion-year deals', () => {
    const world = createWorld(41);
    const r = makeRng(1);
    const target = rival(world, 'T', 400_000_000, r);
    for (let d = 0; d < 400; d++) tick(world);
    world.economy.regime = 'expansion';
    world.economy.crisis = false;
    const boom = reservationPriceToBook(world, target);
    world.economy.regime = 'recession';
    world.economy.crisis = true;
    const bust = reservationPriceToBook(world, target);
    expect(bust).toBeLessThan(boom - 0.3);
    expect(calibration.dealPriceToBook.recession.typical).toBeLessThan(calibration.dealPriceToBook.expansion.typical);
  });

  it('grows from $50M to billions by acquisition without breaking any invariant', () => {
    const world = createWorld(42);
    const r = makeRng(7);
    const me = player(world, 50_000_000);
    const targets: Bank[] = [];
    for (let i = 0; i < 40; i++) targets.push(rival(world, `R${i}`, Math.round(randLogNormal(r, Math.log(60_000_000), 0.9)), r));
    const ctx = { world, events: [] };
    formHoldingCompany(ctx, me);
    let deals = 0;
    let offers = 0;
    let peak = 0;
    for (let d = 0; d < 30 * 365; d++) {
      tick(world);
      balanced(world);
      peak = Math.max(peak, totalAssets(me.acct));
      const pendingDeal = world.pending.some((p) => p.kind === 'acquisition_offer' || p.kind === 'competing_bid');
      // Answer competing bids by letting go; auctions by bidding 1.5%.
      for (const p of [...world.pending]) {
        if (p.kind === 'competing_bid') tick(world, [{ pendingId: p.id, choice: 'l' }]);
        if (p.kind === 'assisted_auction') tick(world, [{ pendingId: p.id, choice: '2' }]);
        if (p.kind === 'officer_event' || p.kind === 'rate_prompt') tick(world, [{ pendingId: p.id, choice: p.options[0]!.key }]);
      }
      if (d % 90 === 0 && !pendingDeal) {
        // Buy the largest target the cash allows, half in stock, keeping
        // pro forma leverage at 8% or better.
        const affordable = targets
          .filter((t) => t.status === 'open' && totalAssets(t.acct) <= totalAssets(me.acct) * 1.5)
          .sort((a, b) => totalAssets(b.acct) - totalAssets(a.acct))
          .find((t) => {
            const pb = reservationPriceToBook(world, t) + 0.1;
            const price = Math.round(pb * (totalEquity(t.acct) - t.acct.goodwill));
            return price * 0.5 < me.acct.cash - totalAssets(me.acct) * 0.04 && proFormaLeverage(me, t, price, 0.5, creditMark(world, t)) >= 0.08;
          });
        if (affordable) {
          offers += 1;
          const res = makeOffer(ctx, me, affordable.id, Math.round((reservationPriceToBook(world, affordable) + 0.1) * 100) / 100, 0.5);
          if (res.why === 'agreed') deals += 1;
        }
      }
      if (!me.isPublic && canIpo(me).ok) ipo(ctx, me, Math.round(totalEquity(me.acct) * 0.2), Math.round(world.player.shares * 0.1));
      // A growth bank raises equity to keep its cushion: private before the
      // IPO, a secondary after.
      if (d % 365 === 180 && me.status === 'open' && totalEquity(me.acct) / totalAssets(me.acct) < 0.09) {
        const amount = Math.round(totalAssets(me.acct) * 0.03);
        if (me.isPublic) secondary(ctx, me, amount);
        else raiseCapital(ctx, me, amount, 0);
      }
      if (me.status === 'failed') break;
    }
    // The bank may fail in a crisis like any other; the invariants held
    // every tick and the growth happened.
    expect(peak).toBeGreaterThan(500_000_000);
    expect(offers).toBeGreaterThan(0);
    expect(deals).toBeGreaterThan(2);
    expect(me.acquiredNames.length).toBeGreaterThan(2);
    expect(world.deals.filter((x) => x.buyer === me.name).length).toBe(me.acquiredNames.length);
    expect(me.acct.goodwill).toBeGreaterThanOrEqual(0);
    // Pools still sum to the loans account after every purchase.
    expect(me.pools.reduce((s, p) => s + p.balance, 0)).toBe(me.acct.loans);
    // Ownership sums to 100% and the player still holds a stake.
    const own = ownership(world, me);
    expect(own.player + own.outside).toBeCloseTo(1, 10);
    expect(world.player.shares).toBeLessThanOrEqual(me.shares);
    if (me.isPublic) expect(marketCap(me)).toBe(Math.round(me.shares * (me.price ?? 0)));
  });

  it('private raise, IPO, buyback, secondary and share sales keep shares x price = market cap and ownership at 100%', () => {
    const world = createWorld(43);
    const me = player(world, 1_200_000_000);
    const ctx = { world, events: [] };
    for (let d = 0; d < 400; d++) tick(world);
    const sharesBefore = me.shares;
    const stakeBefore = ownership(world, me).player;
    expect(raiseCapital(ctx, me, 20_000_000, 0)).not.toBeNull();
    expect(me.shares).toBeGreaterThan(sharesBefore);
    expect(ownership(world, me).player).toBeLessThan(stakeBefore);
    expect(canIpo(me).ok).toBe(false); // no holding company yet
    formHoldingCompany(ctx, me);
    expect(canIpo(me).ok).toBe(true);
    const cashBefore = world.player.cash;
    expect(ipo(ctx, me, 50_000_000, 10_000)).toBe(true);
    expect(me.isPublic).toBe(true);
    expect(world.player.cash).toBeGreaterThan(cashBefore);
    expect(marketCap(me)).toBe(Math.round(me.shares * (me.price ?? 0)));
    for (let d = 0; d < 100; d++) tick(world);
    expect(me.priceHistory.length).toBeGreaterThan(1);
    const s1 = me.shares;
    expect(buyback(ctx, me, 5_000_000)).toBeGreaterThan(0);
    expect(me.shares).toBeLessThan(s1);
    expect(secondary(ctx, me, 5_000_000)).toBeGreaterThan(0);
    const ps = world.player.shares;
    const pc = world.player.cash;
    expect(sellPlayerShares(ctx, 5_000)).toBeGreaterThan(0);
    expect(world.player.shares).toBe(ps - 5_000);
    expect(world.player.cash).toBeGreaterThan(pc);
    const own = ownership(world, me);
    expect(own.player + own.outside).toBeCloseTo(1, 10);
    balanced(world);
  });

  it('a failed rival goes to auction on Friday; the winning bid assumes deposits with loss share on Monday', () => {
    const world = createWorld(44);
    const r = makeRng(3);
    const me = player(world, 600_000_000);
    const weak = rival(world, 'Weak', 150_000_000, r);
    // Burn the weak bank's capital.
    weak.overheadRate = 0.09;
    weak.loanYield = 0;
    weak.acct.commonStock -= 9_000_000;
    weak.acct.cash -= 9_000_000;
    let auction: World['pending'][number] | undefined;
    const depositsBefore = totalDeposits(me.acct);
    for (let d = 0; d < 4 * 365 && !auction; d++) {
      tick(world);
      auction = world.pending.find((p) => p.kind === 'assisted_auction');
      balanced(world);
    }
    expect(auction).toBeDefined();
    expect(weak.status).toBe('failed');
    expect(totalAssets(weak.acct)).toBe(0);
    const snapDeposits = auction!.data.deposits as number;
    expect(snapDeposits).toBeGreaterThan(0);
    const mine = totalDeposits(me.acct);
    tick(world, [{ pendingId: auction!.id, choice: '3' }]);
    // The failed bank's remaining deposits (some ran before the closure) come over.
    expect(totalDeposits(me.acct)).toBeGreaterThan(mine + snapDeposits * 0.9);
    expect(totalDeposits(me.acct)).toBeGreaterThan(depositsBefore);
    expect(me.lossShare).not.toBeNull();
    expect(me.lossShare!.share).toBe(0.8);
    expect(me.acct.goodwill).toBeGreaterThan(0);
    expect(world.deals.some((x) => x.kind === 'assisted' && x.buyer === me.name)).toBe(true);
    balanced(world);
    for (let d = 0; d < 365; d++) {
      tick(world);
      balanced(world);
    }
    expect(me.pools.reduce((s, p) => s + p.balance, 0)).toBe(me.acct.loans);
  });

  it("the player's failed bank has its deposits bought by a rival over the weekend", () => {
    const world = createWorld(45);
    const r = makeRng(9);
    const me = player(world, 100_000_000);
    me.overheadRate = 0.1;
    me.loanYield = 0;
    const big = rival(world, 'Big', 2_000_000_000, r);
    big.ai!.acquisitive = 0.9;
    for (let d = 0; d < 6 * 365 && me.status !== 'failed'; d++) tick(world);
    expect(me.status).toBe('failed');
    expect(world.player.record[0]!.outcome).toBe('failed');
    expect(big.acquiredNames).toContain('Player Bank');
    expect(world.feed.some((f) => /reopened your branches/.test(f.text))).toBe(true);
    balanced(world);
  });

  it('business lines run a real P&L and card charge-offs land inside the card band', () => {
    const world = createWorld(46);
    const me = player(world, 15_000_000_000);
    const ctx = { world, events: [] };
    expect(toggleLine(ctx, me, 'ib')).toBe(false); // below the threshold
    expect(toggleLine(ctx, me, 'mortgage')).toBe(true);
    expect(toggleLine(ctx, me, 'cards')).toBe(true);
    let cardBalanceYears = 0;
    for (let d = 0; d < 20 * 365; d++) {
      tick(world);
      if (isYearEnd(world.day)) {
        cardBalanceYears += bookByType(me).find((x) => x.type === 'cards')?.balance ?? 0;
        balanced(world);
      }
    }
    expect(me.lines.mortgage.lastYearRevenue).toBeGreaterThan(0);
    expect(me.lines.cards.balance).toBeGreaterThan(0);
    expect(me.lines.cards.lastYearRevenue).toBeGreaterThan(0);
    const cardRate = (me.lifetimeChargeOffsByType.cards / cardBalanceYears) * 100;
    const band = calibration.chargeOffRate.cards;
    // eslint-disable-next-line no-console
    console.log(`cards: charge-offs ${cardRate.toFixed(2)}% per year [${band.low}-${band.high}]; mortgage net ${me.lines.mortgage.lastYearRevenue - me.lines.mortgage.lastYearCost}`);
    expect(cardRate).toBeGreaterThanOrEqual(band.low);
    expect(cardRate).toBeLessThanOrEqual(band.high);
    expect(LOAN_TYPES).toContain('cards');
  });
});
