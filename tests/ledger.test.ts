import { describe, expect, it } from 'vitest';
import {
  assertBalanced,
  emptyAccounts,
  imbalance,
  leverageRatio,
  post,
  totalAssets,
  totalEquity,
  totalLiabilities,
} from '../engine/ledger';

describe('ledger', () => {
  it('starts balanced and stays balanced through postings', () => {
    const a = emptyAccounts();
    assertBalanced(a);
    post(a, { cash: 10_000_000, commonStock: 10_000_000 });
    post(a, { cash: 50_000_000, checking: 30_000_000, savings: 20_000_000 });
    post(a, { loans: 40_000_000, cash: -40_000_000 });
    post(a, { interestReceivable: 200_000, retainedEarnings: 200_000 });
    post(a, { savings: 50_000, retainedEarnings: -50_000 });
    post(a, { allowance: 400_000, retainedEarnings: -400_000 });
    assertBalanced(a);
    expect(totalAssets(a)).toBe(totalLiabilities(a) + totalEquity(a));
    expect(imbalance(a)).toBe(0);
    expect(totalEquity(a)).toBe(9_750_000);
  });

  it('rejects an unbalanced entry', () => {
    const a = emptyAccounts();
    expect(() => post(a, { cash: 100 })).toThrow(/unbalanced/);
    expect(() => post(a, { cash: 100, checking: 99 })).toThrow(/unbalanced/);
    expect(imbalance(a)).toBe(0);
  });

  it('rejects fractional dollars', () => {
    const a = emptyAccounts();
    expect(() => post(a, { cash: 1.5, commonStock: 1.5 })).toThrow(/fractional/);
  });

  it('contra assets reduce assets', () => {
    const a = emptyAccounts();
    post(a, { cash: 1000, commonStock: 1000 });
    post(a, { loans: 1000, cash: -1000 });
    post(a, { allowance: 100, retainedEarnings: -100 });
    expect(totalAssets(a)).toBe(900);
    expect(totalEquity(a)).toBe(900);
  });

  it('leverage ratio excludes goodwill and aoci', () => {
    const a = emptyAccounts();
    post(a, { cash: 9_000_000, commonStock: 9_000_000 });
    post(a, { cash: 91_000_000, checking: 91_000_000 });
    post(a, { goodwill: 1_000_000, cash: -1_000_000 });
    post(a, { afsValuation: -500_000, aoci: -500_000 });
    // tier1 = 9M - 1M goodwill = 8M; assets ex goodwill = 100M - 0.5M - 1M = 98.5M
    expect(leverageRatio(a)).toBeCloseTo(8_000_000 / 98_500_000, 10);
  });
});
