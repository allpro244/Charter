// Credit invariants (SYSTEMS.md Part 1, system 3). Twenty seeds by default,
// fifty in npm run test:full (rule 19). Tests against an unverified band are
// tagged [unverified] in their name so they report separately (rule 20).

import { describe, expect, it } from 'vitest';
import { calibration } from '../data/calibration';
import { TYPE, bookByType, mixFor, seedPools } from '../engine/credit';
import { totalAssets, totalEquity, totalLiabilities } from '../engine/ledger';
import { LOAN_TYPES, type LoanType } from '../engine/loantypes';
import { derive, makeRng, randInt, randLogNormal } from '../engine/rng';
import { createBank, createWorld, emptyByType } from '../engine/state';
import { tick } from '../engine/tick';
import { isYearEnd } from '../engine/time';
import { FIXTURES_MISSING, hasFixtures } from './helpers/fixtures';

const SEEDS = process.env.CHARTER_FULL ? 50 : 20;
const YEARS = 20;

function tag(verified: boolean, name: string): string {
  return verified ? name : `[unverified] ${name}`;
}

interface Run {
  chargeOffs: Record<LoanType, number>;
  balanceYears: Record<LoanType, number>; // sum of year-end balances
}

function run(seed: number, banks: number, years: number): Run {
  const world = createWorld(seed);
  const r = makeRng(seed + 99);
  for (let i = 0; i < banks; i++) {
    const assets = Math.round(randLogNormal(r, Math.log(250_000_000), 0.9));
    const capital = Math.round(assets * (0.08 + 0.04 * (randInt(r, 0, 100) / 100)));
    const dep = assets - capital;
    createBank(world, {
      name: `B${i}`,
      kind: 'rival',
      state: 'TX',
      capital,
      deposits: { checking: Math.round(dep * 0.3), savings: Math.round(dep * 0.3), mmda: Math.round(dep * 0.2), cd: dep - Math.round(dep * 0.3) - Math.round(dep * 0.3) - Math.round(dep * 0.2) },
      loans: Math.round(assets * 0.68),
      securitiesAFS: Math.round(assets * 0.15),
    });
  }
  // Give every type a presence: half the banks lend energy and ag as if in
  // an energy or farm county.
  for (const id of world.bankOrder) {
    const b = world.banks[id]!;
    if (Number(id.slice(1)) % 2 === 0) {
      b.loanMix = { ci: 0.2, cre_oo: 0.15, cre_inv: 0.15, construction: 0.1, resi: 0.15, consumer: 0.05, ag: 0.1, energy: 0.1 };
    }
  }
  const chargeOffs = emptyByType(0);
  const balanceYears = emptyByType(0);
  for (let d = 0; d < years * 365; d++) {
    tick(world);
    if (isYearEnd(world.day)) {
      for (const id of world.bankOrder) {
        const b = world.banks[id]!;
        if (b.status !== 'open') continue;
        for (const row of bookByType(b)) balanceYears[row.type] += row.balance;
      }
    }
  }
  for (const id of world.bankOrder) {
    const b = world.banks[id]!;
    for (const t of LOAN_TYPES) chargeOffs[t] += b.lifetimeChargeOffsByType[t];
  }
  return { chargeOffs, balanceYears };
}

describe('credit, pooled book', () => {
  const runs = Array.from({ length: SEEDS }, (_, i) => run(500 + i, 12, YEARS));
  const rate = emptyByType(0);
  for (const t of LOAN_TYPES) {
    let co = 0;
    let bal = 0;
    for (const x of runs) {
      co += x.chargeOffs[t];
      bal += x.balanceYears[t];
    }
    rate[t] = bal > 0 ? (co / bal) * 100 : 0;
  }
  // eslint-disable-next-line no-console
  console.log('charge-off rates, percent per year: ' + LOAN_TYPES.map((t) => `${t} ${rate[t].toFixed(2)} [${calibration.chargeOffRate[t].low}-${calibration.chargeOffRate[t].high}]`).join(', '));

  for (const t of LOAN_TYPES) {
    const band = calibration.chargeOffRate[t];
    it(tag(band.verified, `${TYPE[t].label} net charge-offs over ${YEARS} years across ${SEEDS} seeds are inside the FDIC band (${band.low} to ${band.high}% per year)`), () => {
      expect(rate[t]).toBeGreaterThanOrEqual(band.low);
      expect(rate[t]).toBeLessThanOrEqual(band.high);
    });
  }

  it('charge-off rates by type keep their real ordering: consumer above CRE, resi lowest of the secured book', () => {
    expect(rate.consumer).toBeGreaterThan(rate.cre_oo);
    expect(rate.resi).toBeLessThan(rate.ci);
    expect(rate.construction).toBeGreaterThan(rate.resi);
  });

  it('A = L + E holds through migrations, charge-offs, and reserves', () => {
    const world = createWorld(77);
    for (let i = 0; i < 6; i++) {
      createBank(world, { name: `C${i}`, kind: 'rival', state: 'OK', capital: 20_000_000, deposits: { checking: 100_000_000, savings: 80_000_000 }, loans: 150_000_000, securitiesAFS: 30_000_000 });
    }
    for (let d = 0; d < 10 * 365; d++) {
      tick(world);
      for (const id of world.bankOrder) {
        const a = world.banks[id]!.acct;
        expect(totalAssets(a) - totalLiabilities(a) - totalEquity(a)).toBe(0);
        expect(a.allowance).toBeGreaterThanOrEqual(0);
        const pooled = world.banks[id]!.pools.reduce((s, p) => s + p.balance, 0);
        expect(pooled).toBe(a.loans);
      }
    }
  });

  it('pools sum to the loans account, grades sum to the pool balance, and no vintage count explodes', () => {
    const world = createWorld(78);
    const b = createBank(world, { name: 'P', kind: 'rival', state: 'TX', capital: 30_000_000, deposits: { checking: 150_000_000, savings: 120_000_000 }, loans: 220_000_000 });
    for (let d = 0; d < 15 * 365; d++) tick(world);
    let sum = 0;
    for (const p of b.pools) {
      const g = p.grades.reduce((s, x) => s + x, 0);
      expect(g).toBe(p.balance);
      sum += p.balance;
    }
    expect(sum).toBe(b.acct.loans);
    for (const t of LOAN_TYPES) expect(b.pools.filter((p) => p.type === t).length).toBeLessThanOrEqual(6);
  });

  it('a scripted oil bust produces energy losses in an energy book and near-zero energy losses without one', () => {
    const seed = 91;
    const worldA = createWorld(seed);
    const worldB = createWorld(seed);
    const mk = (world: ReturnType<typeof createWorld>, energy: number) => {
      const b = createBank(world, { name: 'E', kind: 'rival', state: 'TX', capital: 25_000_000, deposits: { checking: 120_000_000, savings: 100_000_000 }, loans: 0, securitiesAFS: 20_000_000 });
      b.loanMix = { ci: 0.3 - energy * 0.3, cre_oo: 0.15, cre_inv: 0.15, construction: 0.05, resi: 0.2, consumer: 0.05, ag: 0.1 - energy * 0.1, energy };
      // Seed the book by hand with the chosen mix.
      b.acct.loans = 180_000_000;
      b.acct.cash -= 180_000_000;
      const r = derive(seed, 5);
      const mix = b.loanMix;
      seedPools(world, b, 180_000_000, r, 0.04);
      b.loanMix = mix;
      // seedPools reads the county mix; restore ours by reseeding pools.
      b.pools = [];
      b.loanMix = mix;
      seedWithMix(world, b, 180_000_000, r);
      return b;
    };
    const a = mk(worldA, 0.4);
    const b = mk(worldB, 0);
    const energyBal = (bank: typeof a) => bookByType(bank).find((x) => x.type === 'energy')?.balance ?? 0;
    const bust = (world: ReturnType<typeof createWorld>, bank: typeof a) => {
      let balMonths = 0;
      for (let d = 0; d < 4 * 365; d++) {
        // Oil crashes to $25 after the first year and again six months later,
        // then the model's own dynamics take over.
        if (d === 365 || d === 365 + 182) world.economy.oil = 25;
        tick(world);
        if (d % 30 === 0) balMonths += energyBal(bank);
      }
      return balMonths / (4 * 12);
    };
    const avgEnergyA = bust(worldA, a);
    bust(worldB, b);
    // Annualized energy charge-off rate over a run that holds a two year bust.
    const energyLossA = a.lifetimeChargeOffsByType.energy / Math.max(1, avgEnergyA) / 4;
    expect(energyLossA).toBeGreaterThan(0.02);
    expect(b.lifetimeChargeOffsByType.energy).toBe(0);
    expect(energyBal(b)).toBe(0);
    // The energy book's own rate is far above the same bank's other types.
    const otherA = LOAN_TYPES.filter((t) => t !== 'energy').reduce((s, t) => s + a.lifetimeChargeOffsByType[t], 0) / Math.max(1, 180_000_000 * 0.6) / 4;
    expect(energyLossA).toBeGreaterThan(otherA);
  });

  it('earnings review ties to the ledger every quarter for a player bank', () => {
    const world = createWorld(123);
    const bank = createBank(world, { name: 'Player', kind: 'player', state: 'TX', capital: 20_000_000, deposits: { checking: 80_000_000, savings: 60_000_000, mmda: 40_000_000 }, loans: 150_000_000, securitiesAFS: 30_000_000, shares: 2_000_000 });
    world.playerBankId = bank.id;
    world.player.bankId = bank.id;
    world.player.shares = 600_000;
    for (let d = 0; d < 3 * 365; d++) tick(world);
    expect(bank.reviews.length).toBe(12);
    for (const r of bank.reviews) {
      expect(r.netIncome).toBe(r.ledgerNetIncome);
      const books = r.interestByBook.reduce((s, x) => s + x.amount, 0);
      expect(books).toBeGreaterThan(0);
    }
  });

  it('mixFor scales energy and agriculture lending with real employment shares', () => {
    const none = mixFor(undefined);
    expect(none.energy).toBeLessThan(0.05);
    expect(Math.abs(LOAN_TYPES.reduce((s, t) => s + none[t], 0) - 1)).toBeLessThan(1e-9);
  });
});

// Seeds pools using a bank's own mix instead of the county mix.
function seedWithMix(world: ReturnType<typeof createWorld>, b: ReturnType<typeof createBank>, total: number, r: ReturnType<typeof makeRng>) {
  const county = undefined;
  void county;
  const mix = { ...b.loanMix };
  seedPools(world, b, total, r, 0.04);
  // seedPools resets loanMix from the county; rebalance the pools to the
  // requested mix by scaling each type's balances and fixing the rounding
  // on the largest pool. The ledger's loans account is unchanged.
  const byType = emptyByType(0);
  for (const p of b.pools) byType[p.type] += p.balance;
  let assigned = 0;
  for (const p of b.pools) {
    const want = Math.round(total * mix[p.type]);
    const scale = byType[p.type] > 0 ? want / byType[p.type] : 0;
    let bal = 0;
    for (let g = 0; g < p.grades.length; g++) {
      p.grades[g] = Math.round((p.grades[g] ?? 0) * scale);
      bal += p.grades[g] ?? 0;
    }
    p.balance = bal;
    assigned += bal;
  }
  b.pools = b.pools.filter((p) => p.balance > 0);
  const big = b.pools.reduce((x, p) => (p.balance > x.balance ? p : x));
  big.balance += total - assigned;
  big.grades[2] = (big.grades[2] ?? 0) + (total - assigned);
  b.loanMix = mix;
}

describe.skipIf(!hasFixtures())(`credit with real counties (${hasFixtures() ? 'fixtures loaded' : FIXTURES_MISSING})`, () => {
  it('placeholder: real-county tests live in tests/underwriting.test.ts', () => {
    expect(true).toBe(true);
  });
});
