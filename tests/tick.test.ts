import { describe, expect, it } from 'vitest';
import { netIncome, totalAssets, totalEquity, totalLiabilities } from '../engine/ledger';
import { createBank, createWorld } from '../engine/state';
import { assertWorldBalanced, tick } from '../engine/tick';
import { dateOf, dayOf, daysInMonth, formatDate, isMonthEnd, isQuarterEnd, monthIndex } from '../engine/time';
import { poolInterest } from '../engine/credit';

describe('time', () => {
  it('day 0 is Monday 2024-01-01', () => {
    expect(formatDate(0)).toBe('2024-01-01');
    expect(dateOf(0).dow).toBe(1);
  });
  it('knows month and quarter ends including leap years', () => {
    expect(isMonthEnd(dayOf(2024, 2, 29))).toBe(true);
    expect(isMonthEnd(dayOf(2024, 2, 28))).toBe(false);
    expect(isQuarterEnd(dayOf(2024, 3, 31))).toBe(true);
    expect(isQuarterEnd(dayOf(2024, 4, 30))).toBe(false);
    expect(monthIndex(dayOf(2025, 1, 15))).toBe(12);
  });
});

describe('tick', () => {
  it('empty world runs 365 ticks and round-trips through JSON', () => {
    const world = createWorld(1);
    for (let i = 0; i < 365; i++) {
      const r = tick(world);
      expect(r.state).toBe(world);
      expect(r.pending).toEqual([]);
    }
    expect(world.day).toBe(365);
    expect(formatDate(world.day)).toBe('2024-12-31');
    expect(world.economy.month).toBe(12);
    const text = JSON.stringify(world);
    const copy = JSON.parse(text);
    expect(copy).toEqual(world);
    // The copy keeps running identically.
    const a = createWorld(1);
    for (let i = 0; i < 365; i++) tick(a);
    for (let i = 0; i < 100; i++) {
      tick(copy);
      tick(a);
    }
    expect(JSON.stringify(copy)).toBe(JSON.stringify(a));
  });

  it('same seed gives the same world', () => {
    const a = createWorld(99);
    const b = createWorld(99);
    createBank(a, { name: 'A', kind: 'rival', state: 'TX', capital: 10_000_000, deposits: { checking: 50_000_000 }, loans: 40_000_000 });
    createBank(b, { name: 'A', kind: 'rival', state: 'TX', capital: 10_000_000, deposits: { checking: 50_000_000 }, loans: 40_000_000 });
    for (let i = 0; i < 400; i++) {
      tick(a);
      tick(b);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a bank with deposits and loans stays balanced and earns a spread over a year', () => {
    const world = createWorld(5);
    const bank = createBank(world, {
      name: 'First Test',
      kind: 'rival',
      state: 'TX',
      capital: 10_000_000,
      deposits: { checking: 30_000_000, savings: 20_000_000, mmda: 20_000_000, cd: 20_000_000 },
      loans: 70_000_000,
      securitiesAFS: 15_000_000,
    });
    world.playerBankId = bank.id;
    // Retained earnings move by net income less dividends. AOCI moves with
    // the securities mark and is outside net income.
    const startEquity = totalEquity(bank.acct) - bank.acct.aoci;
    expect(bank.pools.length).toBeGreaterThan(0);
    expect(bank.pools.reduce((s, p) => s + p.balance, 0)).toBe(70_000_000);
    // Pool interest is performing balance x rate x days/365, month by month.
    let expectedLoanInterest = 0;
    for (let i = 0; i < 366; i++) {
      if (isMonthEnd(world.day + 1)) {
        const { y, m } = dateOf(world.day + 1);
        for (const p of bank.pools) expectedLoanInterest += poolInterest(p, daysInMonth(y, m));
      }
      tick(world);
      const a = bank.acct;
      expect(totalAssets(a)).toBe(totalLiabilities(a) + totalEquity(a));
    }
    assertWorldBalanced(world);
    expect(bank.reports.length).toBe(4);
    // The player's bank keeps every closed quarter's statement, one per call report, and they agree on profit.
    expect(bank.quarterHistory.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(bank.quarterHistory[i]!.quarter).toBe(bank.reports[i]!.quarter);
      expect(netIncome(bank.quarterHistory[i]!.is)).toBeCloseTo(bank.reports[i]!.netIncome, 6);
    }
    const year = bank.is.lastYear;
    expect(year).not.toBeNull();
    expect(year!.days).toBe(365);
    // Interest on loans over the year equals balance x rate x days/365, month by month.
    expect(year!.interestLoans).toBe(expectedLoanInterest);
    // A plausible community bank earns something, and equity moved by exactly net income after tax.
    const ni = year!.interestLoans + year!.interestSecurities + year!.interestCash
      - (year!.interestChecking + year!.interestSavings + year!.interestMmda + year!.interestCd + year!.interestBrokered + year!.interestBorrowings)
      - year!.provision + year!.feeIncome + year!.securitiesGains - (year!.salaries + year!.occupancy + year!.otherExpense + year!.assessment) - year!.tax;
    expect(totalEquity(bank.acct) - bank.acct.aoci - startEquity).toBe(ni - bank.dividendsPaid);
    expect(bank.dividendsPaid).toBeGreaterThan(0);
    expect(bank.reports[3]!.roa).toBeGreaterThan(-0.02);
    expect(bank.reports[3]!.roa).toBeLessThan(0.03);
  });
});
