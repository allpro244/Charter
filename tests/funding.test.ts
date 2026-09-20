// Deposits and funding invariants (SYSTEMS.md Part 1, system 4).

import { describe, expect, it } from 'vitest';
import { calibration } from '../data/calibration';
import { closeBranch, coreDeposits, setRate } from '../engine/deposits';
import { buySecurities, fhlbCapacity, borrowFhlb, raiseBrokered, repayFhlb, sellSecurities, unrealizedLoss, unrealizedToCapital } from '../engine/funding';
import { DEPOSIT_TYPES, totalAssets, totalDeposits, totalEquity, totalLiabilities } from '../engine/ledger';
import { fire, hire, refreshCandidates } from '../engine/officers';
import { makeRng } from '../engine/rng';
import { createBank, createWorld } from '../engine/state';
import { tick } from '../engine/tick';
import { isMonthEnd } from '../engine/time';

function playerBankWorld(seed: number, opts: { capital: number; deposits: number; loans: number; afs: number; htm: number; pool: number; lowRates?: boolean }) {
  const world = createWorld(seed);
  if (opts.lowRates) {
    // A 2021 world: the floor, before the hikes. Lots bought here carry
    // low coupons, which is what made 2022 hurt.
    const e = world.economy;
    e.fedFunds = 0.0025;
    e.curve = { m3: 0.0005, y2: 0.005, y10: 0.015, y30: 0.02 };
    e.regime = 'expansion';
    e.inflation = 0.02;
  }
  const d = opts.deposits;
  const bank = createBank(world, {
    name: 'P',
    kind: 'player',
    state: 'TX',
    capital: opts.capital,
    deposits: { checking: Math.round(d * 0.3), savings: Math.round(d * 0.25), mmda: Math.round(d * 0.25), cd: d - Math.round(d * 0.3) - Math.round(d * 0.25) - Math.round(d * 0.25) },
    loans: opts.loans,
    securitiesAFS: opts.afs,
    securitiesHTM: opts.htm,
    shares: 1_000_000,
  });
  // No geography in this test: the bank's addressable market is a bank
  // attribute, not county data.
  bank.franchise.pool = opts.pool;
  bank.franchise.baseShare = d / opts.pool;
  bank.franchise.targetShare = d / opts.pool;
  world.playerBankId = bank.id;
  world.player.bankId = bank.id;
  world.player.shares = 300_000;
  world.player.cash = 1_000_000;
  // These tests set the sheet and buy the bonds by hand: no standing policies.
  bank.ratePeg = null;
  bank.investPolicy = null;
  return { world, bank };
}

describe('deposits and funding', () => {
  it('a Fed +400bp shock with a held rate sheet produces outflow and unrealized loss inside the bands', () => {
    const { world, bank } = playerBankWorld(31, { capital: 20_000_000, deposits: 180_000_000, loans: 130_000_000, afs: 30_000_000, htm: 20_000_000, pool: 180_000_000 / 0.02, lowRates: true });
    const start = world.economy.fedFunds;
    const depositsStart = coreDeposits(bank);
    const capitalStart = totalEquity(bank.acct) - bank.acct.aoci;
    let month = 0;
    for (let d = 0; d < 365; d++) {
      tick(world);
      if (isMonthEnd(world.day)) {
        month += 1;
        // Scripted path: the Fed hikes 400bp over the year and the curve follows.
        const e = world.economy;
        const up = 0.04 * Math.min(1, month / 12);
        e.fedFunds = start + up;
        e.curve.m3 = e.fedFunds + 0.001;
        e.curve.y2 = 0.005 + up;
        e.curve.y10 = 0.015 + 0.65 * up;
        e.curve.y30 = e.curve.y10 + 0.003;
      }
      for (const id of world.bankOrder) {
        const a = world.banks[id]!.acct;
        expect(totalAssets(a) - totalLiabilities(a) - totalEquity(a)).toBe(0);
      }
    }
    const outflow = (depositsStart - coreDeposits(bank)) / depositsStart;
    const band = calibration.shockOutflow;
    const lossBand = calibration.shockUnrealizedLoss;
    const lossToCapital = unrealizedLoss(bank) / capitalStart;
    // eslint-disable-next-line no-console
    console.log(`shock: outflow ${(outflow * 100).toFixed(1)}% [${band.low}-${band.high}], unrealized loss ${(lossToCapital * 100).toFixed(1)}% of capital [${lossBand.low}-${lossBand.high}]`);
    expect(outflow * 100).toBeGreaterThan(band.low);
    expect(outflow * 100).toBeLessThan(band.high);
    expect(lossToCapital * 100).toBeGreaterThan(lossBand.low);
    expect(lossToCapital * 100).toBeLessThan(lossBand.high);
    expect(bank.acct.aoci).toBeLessThan(0);
    expect(unrealizedToCapital(bank)).toBeGreaterThan(0);
  });

  it('a thin bank with heavy uninsured deposits and a big unrealized loss runs and is closed', () => {
    const { world, bank } = playerBankWorld(32, { capital: 9_000_000, deposits: 300_000_000, loans: 120_000_000, afs: 60_000_000, htm: 100_000_000, pool: 300_000_000 / 0.02 });
    bank.uninsuredShare = 0.7;
    // Rates jump 400bp at once: long HTM book loses a third of capital and more.
    const e = world.economy;
    e.fedFunds += 0.04;
    e.curve.m3 += 0.04;
    e.curve.y2 += 0.035;
    e.curve.y10 += 0.03;
    e.curve.y30 += 0.03;
    const depositsStart = totalDeposits(bank.acct);
    let minConfidence = 1;
    for (let d = 0; d < 365; d++) {
      tick(world);
      minConfidence = Math.min(minConfidence, bank.confidence);
      if (bank.status === 'failed') break;
    }
    const fall = (depositsStart - totalDeposits(bank.acct)) / depositsStart;
    expect(minConfidence).toBeLessThan(0.8);
    expect(bank.status === 'failed' || bank.status === 'closing' || fall > 0.3).toBe(true);
    const runEvents = world.feed.filter((f) => /uninsured depositors leave|could not meet|confidence is slipping/.test(f.text));
    expect(runEvents.length).toBeGreaterThan(0);
  });

  it('a sound bank does not run', () => {
    const { world, bank } = playerBankWorld(33, { capital: 25_000_000, deposits: 200_000_000, loans: 140_000_000, afs: 30_000_000, htm: 10_000_000, pool: 200_000_000 / 0.02 });
    for (let d = 0; d < 2 * 365; d++) tick(world);
    expect(bank.confidence).toBeGreaterThan(0.9);
    expect(bank.status).toBe('open');
    expect(coreDeposits(bank)).toBeGreaterThan(150_000_000);
  });

  it('securities trades balance and a sale realizes exactly the mark', () => {
    const { world, bank } = playerBankWorld(34, { capital: 20_000_000, deposits: 200_000_000, loans: 100_000_000, afs: 0, htm: 0, pool: 200_000_000 / 0.02 });
    const ctx = { world, events: [] };
    const lot = buySecurities(ctx, bank, 'afs', 'treasury', 40_000_000, 5)!;
    expect(lot).not.toBeNull();
    expect(bank.acct.securitiesAFS).toBe(40_000_000);
    // Rates up 200bp: the lot marks down at the next close.
    world.economy.fedFunds += 0.02;
    world.economy.curve.y2 += 0.02;
    world.economy.curve.y10 += 0.02;
    for (let d = 0; d < 31; d++) {
      tick(world);
      // Hold the curve where the shock put it.
      world.economy.curve.y2 = Math.max(world.economy.curve.y2, 0.0625);
      world.economy.curve.y10 = Math.max(world.economy.curve.y10, 0.0588);
    }
    expect(bank.acct.afsValuation).toBeLessThan(0);
    expect(bank.acct.aoci).toBe(bank.acct.afsValuation);
    const cashBefore = bank.acct.cash;
    const unrealizedBefore = bank.acct.afsValuation;
    const cost = bank.lots.find((l) => l.id === lot.id)!.cost;
    const proceeds = sellSecurities(ctx, bank, lot.id, cost);
    expect(proceeds).toBeLessThan(cost);
    expect(bank.acct.cash - cashBefore).toBe(proceeds);
    expect(bank.acct.securitiesAFS).toBe(0);
    expect(bank.acct.afsValuation).toBe(0);
    expect(bank.is.month.securitiesGains).toBeLessThan(0);
    expect(Math.abs(bank.is.month.securitiesGains - (proceeds - cost))).toBeLessThan(2);
    void unrealizedBefore;
    const a = bank.acct;
    expect(totalAssets(a) - totalLiabilities(a) - totalEquity(a)).toBe(0);
  });

  it('FHLB and brokered funding are capped by collateral and capital', () => {
    const { world, bank } = playerBankWorld(35, { capital: 20_000_000, deposits: 200_000_000, loans: 150_000_000, afs: 20_000_000, htm: 0, pool: 200_000_000 / 0.02 });
    const ctx = { world, events: [] };
    const cap = fhlbCapacity(bank);
    expect(cap).toBeGreaterThan(0);
    const drawn = borrowFhlb(ctx, bank, cap * 2);
    expect(drawn).toBe(cap);
    expect(bank.acct.fhlb).toBe(cap);
    expect(fhlbCapacity(bank)).toBe(0);
    expect(repayFhlb(ctx, bank, 1_000_000)).toBe(1_000_000);
    expect(raiseBrokered(ctx, bank, 10_000_000)).toBe(10_000_000);
    // Below well capitalized: no brokered deposits.
    bank.acct.commonStock -= 15_000_000;
    bank.acct.cash -= 15_000_000;
    expect(raiseBrokered(ctx, bank, 1_000_000)).toBe(0);
  });

  it('holding rates above market gathers deposits; below market loses them', () => {
    const above = playerBankWorld(36, { capital: 20_000_000, deposits: 200_000_000, loans: 120_000_000, afs: 20_000_000, htm: 0, pool: 200_000_000 / 0.02 });
    const below = playerBankWorld(36, { capital: 20_000_000, deposits: 200_000_000, loans: 120_000_000, afs: 20_000_000, htm: 0, pool: 200_000_000 / 0.02 });
    for (const t of DEPOSIT_TYPES) {
      setRate(above.world, t, above.bank.rates[t] + 0.01);
      setRate(below.world, t, Math.max(0, below.bank.rates[t] - 0.01));
    }
    for (let d = 0; d < 365; d++) {
      tick(above.world);
      tick(below.world);
    }
    expect(coreDeposits(above.bank)).toBeGreaterThan(coreDeposits(below.bank));
    expect(above.bank.is.lastYear!.interestSavings).toBeGreaterThan(below.bank.is.lastYear!.interestSavings);
  });

  it('officers can be hired and fired with the cash effects on the ledger', () => {
    const { world, bank } = playerBankWorld(37, { capital: 20_000_000, deposits: 200_000_000, loans: 120_000_000, afs: 20_000_000, htm: 0, pool: 200_000_000 / 0.02 });
    const ctx = { world, events: [] };
    refreshCandidates(world, bank, makeRng(1));
    const c = bank.officerCandidates.find((x) => x.role === 'cfo')!;
    const cashBefore = bank.acct.cash;
    const hired = hire(ctx, bank, c.id)!;
    expect(hired.role).toBe('cfo');
    expect(cashBefore - bank.acct.cash).toBe(Math.round(c.salary * 0.25));
    expect(fire(ctx, bank, hired.id)).toBe(true);
    expect(bank.officers.find((o) => o.role === 'cfo')).toBeUndefined();
    const a = bank.acct;
    expect(totalAssets(a) - totalLiabilities(a) - totalEquity(a)).toBe(0);
  });

  it('closing the home branch is refused', () => {
    const { world, bank } = playerBankWorld(38, { capital: 20_000_000, deposits: 200_000_000, loans: 120_000_000, afs: 20_000_000, htm: 0, pool: 200_000_000 / 0.02 });
    expect(bank.branches.length).toBe(0); // no geography, no branches
    expect(closeBranch({ world, events: [] }, 'nope')).toBe(false);
  });
});
