// The loan health meter (DESIGN.md Part 3, Layers): scored from the memo
// alone, monotone in every factor a banker reads, and separate from the
// hidden risk term. Memos here are abstract: no county data (rule 17).

import { describe, expect, it } from 'vitest';
import type { Application } from '../engine/borrowers';
import { createBank, createWorld } from '../engine/state';
import { policyCheck, termsFrom } from '../engine/underwriting';
import { healthLabel, loanHealth, ramp } from '../ui/health';

function memo(over: Partial<Application['memo']> = {}): Application {
  return {
    borrower: 'Test Co',
    type: 'ci',
    county: 'none',
    memo: {
      purpose: 'equipment',
      amount: 500_000,
      termMonths: 60,
      rate: 0.08,
      dscr: 1.6,
      ltv: 0.6,
      leverage: 2.5,
      guarantor: true,
      collateralType: 'equipment',
      collateralValue: 830_000,
      paymentHistory: 'clean',
      tenureYears: 12,
      sector: 'manufacturing',
      income: 3_000_000,
      netWorth: 1_200_000,
      employees: 20,
      summary: '',
      redFlags: [],
      suggestedGrade: 3,
      ...over,
    },
    truePd: 0.01,
    trueLgd: 0.4,
    hidden: 0,
    signals: [],
  };
}

describe('loan health meter', () => {
  const world = createWorld(1);
  const bank = createBank(world, { name: 'H', kind: 'rival', state: 'TX', capital: 10_000_000, deposits: { checking: 60_000_000 }, loans: 40_000_000 });
  world.playerBankId = bank.id;

  it('ramps interpolate and clamp', () => {
    expect(ramp(0.5, [[1, 100], [2, 0]])).toBe(100);
    expect(ramp(1.5, [[1, 100], [2, 0]])).toBe(50);
    expect(ramp(3, [[1, 100], [2, 0]])).toBe(0);
    expect(healthLabel(90)).toBe('strong');
    expect(healthLabel(20)).toBe('poor');
  });

  it('a clean, covered, well secured borrower scores strong and a stretched one scores poor', () => {
    const good = loanHealth(world, bank, memo());
    const bad = loanHealth(world, bank, memo({ dscr: 0.7, ltv: 0.98, leverage: 9, guarantor: false, paymentHistory: 'poor', tenureYears: 0.5, netWorth: 20_000, redFlags: ['a', 'b'], suggestedGrade: 7 }));
    expect(good.score).toBeGreaterThanOrEqual(80);
    expect(good.label).toBe('strong');
    expect(bad.score).toBeLessThan(35);
    expect(bad.label).toBe('poor');
    expect(good.factors.map((f) => f.key)).toEqual(['capacity', 'leverage', 'collateral', 'character', 'capital', 'conditions', 'concentration']);
    expect(good.factors.reduce((s, f) => s + f.weight, 0)).toBe(100);
    expect(bad.concerns).toContain('capacity');
    expect(good.strengths).toContain('collateral');
    // Never the hidden term: two memos alike in every visible field score alike.
    const twin = loanHealth(world, bank, { ...memo(), truePd: 0.5, hidden: 3 });
    expect(twin.score).toBe(good.score);
  });

  it('is monotone: better coverage, more collateral cushion, and a smaller exposure never lower the score', () => {
    for (const [a, b] of [[1.0, 1.4], [0.9, 1.1]]) expect(loanHealth(world, bank, memo({ dscr: b })).score).toBeGreaterThanOrEqual(loanHealth(world, bank, memo({ dscr: a })).score);
    expect(loanHealth(world, bank, memo({ ltv: 0.6 })).score).toBeGreaterThanOrEqual(loanHealth(world, bank, memo({ ltv: 0.9 })).score);
    const small = loanHealth(world, bank, memo({ amount: 200_000 }));
    const huge = loanHealth(world, bank, memo({ amount: 2_500_000 }));
    expect(small.factors.find((f) => f.key === 'concentration')!.score).toBeGreaterThan(huge.factors.find((f) => f.key === 'concentration')!.score);
    expect(huge.factors.find((f) => f.key === 'concentration')!.note).toMatch(/lending limit/);
  });

  it('prices the loan against cost of money, expected loss and running cost', () => {
    const cheap = loanHealth(world, bank, memo({ rate: 0.015 }));
    const rich = loanHealth(world, bank, memo({ rate: 0.09 }));
    expect(rich.pricing.margin).toBeGreaterThan(cheap.pricing.margin);
    expect(rich.pricing.tone).toBe('good');
    expect(cheap.pricing.tone).toBe('bad');
  });

  it('the written policy has a worst grade the CCO may approve alone', () => {
    expect(policyCheck(bank, memo({ suggestedGrade: 6 }), termsFrom(memo({ suggestedGrade: 6 }))).pass).toBe(true);
    const weak = memo({ suggestedGrade: 7 });
    const check = policyCheck(bank, weak, termsFrom(weak));
    expect(check.pass).toBe(false);
    expect(check.reasons.join(' ')).toMatch(/grade 7 is worse than policy grade 6/);
  });
});
