import { describe, expect, it } from 'vitest';
import { netIncome, totalAssets, totalEquity, totalLiabilities } from '../engine/ledger';
import { makeRng, randInt, randLogNormal } from '../engine/rng';
import { createBank, createWorld, playerNetWorth } from '../engine/state';
import { tick } from '../engine/tick';
import { dateOf, isQuarterEnd } from '../engine/time';
import { setDividendPayout, setSalary } from '../engine/wealth';
import { PCA_CRITICAL, nextFriday } from '../engine/regulation';

function randomWorld(seed: number, banks: number) {
  const world = createWorld(seed);
  const r = makeRng(seed * 7 + 1);
  for (let i = 0; i < banks; i++) {
    const assets = Math.round(randLogNormal(r, Math.log(200_000_000), 1.0));
    const capRatio = 0.05 + 0.08 * (randInt(r, 0, 100) / 100);
    const capital = Math.round(assets * capRatio);
    const deposits = assets - capital;
    createBank(world, {
      name: `Bank ${i}`,
      kind: 'rival',
      state: 'TX',
      capital,
      deposits: { checking: Math.round(deposits * 0.4), savings: Math.round(deposits * 0.3), mmda: 0, cd: deposits - Math.round(deposits * 0.4) - Math.round(deposits * 0.3) },
      loans: Math.round(assets * (0.5 + 0.3 * (randInt(r, 0, 100) / 100))),
      securitiesAFS: Math.round(assets * 0.1),
    });
  }
  return world;
}

describe('phase 1: ledger, wealth, feed', () => {
  it('30 year random run keeps A = L + E every tick for every bank', () => {
    for (const seed of [1, 2, 3]) {
      const world = randomWorld(seed, 25);
      for (let d = 0; d < 30 * 365; d++) {
        tick(world);
        for (const id of world.bankOrder) {
          const a = world.banks[id]!.acct;
          expect(totalAssets(a) - totalLiabilities(a) - totalEquity(a)).toBe(0);
        }
      }
      // Failed banks are fully in receivership: every account zero.
      for (const id of world.bankOrder) {
        const b = world.banks[id]!;
        if (b.status === 'failed') {
          expect(totalAssets(b.acct)).toBe(0);
          expect(totalLiabilities(b.acct)).toBe(0);
        }
      }
      expect(world.feed.length).toBeGreaterThan(0);
    }
  });

  it('dividends reconcile: bank equity falls by the dividend, player gets the pro rata share after tax', () => {
    const world = createWorld(11);
    const bank = createBank(world, {
      name: 'Player Bank',
      kind: 'player',
      state: 'TX',
      capital: 20_000_000,
      deposits: { checking: 60_000_000, savings: 40_000_000, mmda: 40_000_000, cd: 40_000_000 },
      loans: 150_000_000,
      securitiesAFS: 30_000_000,
      shares: 2_000_000,
    });
    world.playerBankId = bank.id;
    world.player.bankId = bank.id;
    world.player.shares = 600_000; // 30%
    world.player.cash = 1_000_000;
    setDividendPayout(world, 0.5);
    setSalary(world, 0);
    const retained = () => totalEquity(bank.acct) - bank.acct.aoci;
    let equityBefore = retained();
    let quarters = 0;
    // Three years: a seed may open in a banking crisis with no profitable quarter.
    for (let d = 0; d < 3 * 365; d++) {
      const cashBefore = world.player.cash;
      const grossBefore = world.player.dividendsGross;
      const paidBefore = bank.dividendsPaid;
      tick(world);
      if (isQuarterEnd(world.day)) {
        const paid = bank.dividendsPaid - paidBefore;
        const q = bank.is.lastQuarter!;
        const ni = netIncome(q);
        if (ni > 0) {
          expect(paid).toBe(Math.round(ni * 0.5));
          const gross = world.player.dividendsGross - grossBefore;
          expect(gross).toBe(Math.round(paid * 0.3));
          expect(world.player.cash - cashBefore).toBe(Math.round(gross * (1 - world.player.taxRate)));
          // Retained earnings over the quarter moved by net income less the dividend.
          expect(retained() - equityBefore).toBe(ni - paid);
          quarters += 1;
        }
        equityBefore = retained();
      }
    }
    expect(quarters).toBeGreaterThanOrEqual(4);
    expect(playerNetWorth(world)).toBeGreaterThan(1_000_000);
    expect(world.player.netWorthHistory.length).toBe(36);
  });

  it('salary is a bank expense and reaches the player after tax', () => {
    const world = createWorld(12);
    const bank = createBank(world, { name: 'P', kind: 'player', state: 'TX', capital: 10_000_000, deposits: { checking: 50_000_000 }, loans: 40_000_000 });
    world.playerBankId = bank.id;
    world.player.bankId = bank.id;
    world.player.shares = bank.shares;
    world.player.cash = 0;
    setSalary(world, 240_000);
    setDividendPayout(world, 0);
    for (let d = 0; d < 31; d++) tick(world);
    expect(world.player.cash).toBe(Math.round(20_000 * (1 - world.player.taxRate)));
    expect(bank.is.year.salaries).toBeGreaterThanOrEqual(20_000);
  });

  it('a bank below 2% leverage is closed on a Friday and the player loses the stake', () => {
    const world = createWorld(13);
    const bank = createBank(world, {
      name: 'Thin Bank',
      kind: 'player',
      state: 'TX',
      capital: 2_500_000,
      deposits: { checking: 50_000_000, savings: 47_500_000 },
      loans: 90_000_000,
    });
    // Burn capital fast: heavy overhead, no yield.
    bank.overheadRate = 0.06;
    bank.loanYield = 0.0;
    world.playerBankId = bank.id;
    world.player.bankId = bank.id;
    world.player.shares = bank.shares;
    world.player.cash = 500_000;
    setSalary(world, 120_000);
    world.player.record.push({ bankId: bank.id, bankName: bank.name, from: 0, to: null, outcome: 'running' });
    let closureDay: number | null = null;
    let failedOn: number | null = null;
    for (let d = 0; d < 3 * 365 && failedOn === null; d++) {
      tick(world);
      if (bank.status === 'closing' && closureDay === null) {
        closureDay = bank.closureDay;
        expect(closureDay).not.toBeNull();
        expect(dateOf(closureDay!).dow).toBe(5);
        expect(closureDay!).toBeGreaterThan(world.day);
      }
      if (bank.status === 'failed') failedOn = world.day;
    }
    expect(failedOn).not.toBeNull();
    expect(dateOf(failedOn!).dow).toBe(5);
    expect(failedOn).toBe(closureDay);
    expect(world.player.shares).toBe(0);
    expect(world.playerBankId).toBeNull();
    expect(world.player.cash).toBeGreaterThan(500_000); // salary arrived before the end
    expect(world.player.record[0]!.outcome).toBe('failed');
    const failurePending = world.pending.filter((p) => p.kind === 'failure');
    expect(failurePending.length).toBe(1);
    expect(totalAssets(bank.acct)).toBe(0);
    // Acknowledge clears it.
    tick(world, [{ pendingId: failurePending[0]!.id, choice: 'k' }]);
    expect(world.pending.filter((p) => p.kind === 'failure').length).toBe(0);
    const alert = world.feed.find((f) => f.source === 'regulator' && /closed by its regulator/.test(f.text));
    expect(alert).toBeDefined();
  });

  it('nextFriday lands on a Friday at least two days out', () => {
    for (let d = 0; d < 14; d++) {
      const f = nextFriday(d);
      expect(dateOf(f).dow).toBe(5);
      expect(f - d).toBeGreaterThanOrEqual(2);
      expect(f - d).toBeLessThanOrEqual(8);
    }
    expect(PCA_CRITICAL).toBe(0.02);
  });

  it('feed has market events with real state changes behind them', () => {
    const world = randomWorld(21, 5);
    for (let d = 0; d < 5 * 365; d++) tick(world);
    const fed = world.feed.filter((f) => f.source === 'market' && /Fed (raised|cut)/.test(f.text));
    expect(fed.length).toBeGreaterThan(0);
    for (const f of world.feed) {
      expect(f.text).not.toMatch(/[–—]/);
      expect(f.day).toBeGreaterThan(0);
    }
    // Oldest first in the store; the desk renders newest at the top.
    for (let i = 1; i < world.feed.length; i++) expect(world.feed[i]!.day).toBeGreaterThanOrEqual(world.feed[i - 1]!.day);
  });
});
