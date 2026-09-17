// Underwriting invariants that need real counties (borrowers are drawn
// from county data, D43). Skipped with a reason until fixtures exist.

import { describe, expect, it } from 'vitest';
import { generateApplication, ccoReview } from '../engine/borrowers';
import { LOAN_TYPES } from '../engine/loantypes';
import { makeRng } from '../engine/rng';
import { createWorld } from '../engine/state';
import { newPlayer, startCharter, startTakeover, startableMetros, takeoverCandidates } from '../engine/start';
import { tick } from '../engine/tick';
import { demandMultiplier, setDial, setPolicy, setPricing } from '../engine/underwriting';
import { createBank } from '../engine/state';
import { calibration } from '../data/calibration';
import { FIXTURES_MISSING, hasFixtures, loadFixtures } from './helpers/fixtures';

const SEEDS = process.env.CHARTER_FULL ? 50 : 20;

describe.skipIf(!hasFixtures())(`underwriting (${hasFixtures() ? 'fixtures loaded' : FIXTURES_MISSING})`, () => {
  it('borrowers come from the county: a Midland book has energy borrowers, a San Jose book has tech', () => {
    const data = loadFixtures();
    const world = createWorld(1, data);
    newPlayer(world);
    const metros = startableMetros(world);
    const midland = metros.find((m) => m.name.startsWith('Midland'))!;
    const sanJose = metros.find((m) => m.name.startsWith('San Jose'))!;
    const ctx = { world, events: [] };
    const bank = startCharter(ctx, { mode: 'charter', cbsa: midland.cbsa, name: 'M', invest: 2_000_000 });
    const county = world.geo.counties[bank.homeCounty!]!;
    const sj = world.geo.counties[sanJose.counties[0]!]!;
    const r = makeRng(3);
    let energyM = 0;
    let techSJ = 0;
    for (let i = 0; i < 400; i++) {
      const a = generateApplication(world, bank, county, r);
      if (a.memo.sector === 'energy') energyM += 1;
      const s = generateApplication(world, bank, sj, r);
      if (s.memo.sector === 'tech') techSJ += 1;
    }
    expect(energyM).toBeGreaterThan(30);
    expect(techSJ).toBeGreaterThan(30);
  });

  it('the dial at zero routes every application to the desk', () => {
    const data = loadFixtures();
    const world = createWorld(2, data);
    newPlayer(world);
    const metro = startableMetros(world)[0]!;
    const bank = startCharter({ world, events: [] }, { mode: 'charter', cbsa: metro.cbsa, name: 'D', invest: 2_000_000 });
    setDial(world, 0, 0);
    let pendings = 0;
    for (let d = 0; d < 120; d++) {
      const r = tick(world);
      pendings += r.pending.length;
      // Decline everything so the queue clears.
      const decisions = world.pending.map((p) => ({ pendingId: p.id, choice: 'd' }));
      if (decisions.length > 0) tick(world, decisions);
    }
    expect(bank.applications.received).toBeGreaterThan(0);
    expect(bank.applications.autoApproved + bank.applications.autoDeclined).toBe(0);
    expect(bank.applications.toDesk).toBe(bank.applications.received);
  });

  it('no loan is both current and charged off, and pools plus the book equal the loans account', () => {
    const data = loadFixtures();
    const world = createWorld(3, data);
    newPlayer(world);
    const metro = startableMetros(world)[0]!;
    const seeds = data.banksByState[metro.state] ?? [];
    const c = takeoverCandidates(world, metro, seeds).find((x) => x.price <= world.player.cash)!;
    const bank = startTakeover({ world, events: [] }, { mode: 'takeover', cbsa: metro.cbsa, candidate: c });
    setDial(world, 50_000_000, 7); // everything auto
    for (let d = 0; d < 5 * 365; d++) {
      tick(world);
      const pooled = bank.pools.reduce((s, p) => s + p.balance, 0);
      const book = bank.loans.filter((l) => l.status !== 'paid' && l.status !== 'chargedOff' && l.status !== 'reo').reduce((s, l) => s + l.balance, 0);
      expect(pooled + book).toBe(bank.acct.loans);
      for (const l of bank.loans) {
        if (l.status === 'chargedOff' || l.status === 'paid') expect(l.balance).toBe(0);
        if (l.status === 'current') expect(l.lossToDate).toBe(0);
      }
    }
    expect(bank.loans.length).toBeLessThanOrEqual(500 + 400);
  });

  it(`a disciplined underwriter (DSCR > 1.5, LTV < 65%) loses less than approve-everything across ${SEEDS} seeds`, () => {
    const data = loadFixtures();
    let disciplinedWins = 0;
    for (let s = 0; s < SEEDS; s++) {
      const rates: number[] = [];
      for (const disciplined of [true, false]) {
        const world = createWorld(1000 + s, data);
        newPlayer(world);
        const metro = startableMetros(world)[0]!;
        const bank = startCharter({ world, events: [] }, { mode: 'charter', cbsa: metro.cbsa, name: 'U', invest: 2_000_000 });
        setDial(world, 100_000_000, 7);
        if (disciplined) setPolicy(world, { minDscr: 1.5, maxLtv: { ci: 0.65, cre_oo: 0.65, cre_inv: 0.65, construction: 0.65, resi: 0.65, consumer: 0.65, ag: 0.65, energy: 0.65, cards: 0.65 } });
        else setPolicy(world, { minDscr: 0, maxLeverage: 100, maxLtv: { ci: 2, cre_oo: 2, cre_inv: 2, construction: 2, resi: 2, consumer: 2, ag: 2, energy: 2, cards: 2 }, sectorCap: 1, maxSize: 1e12 });
        for (let d = 0; d < 6 * 365; d++) tick(world);
        const co = LOAN_TYPES.reduce((x, t) => x + bank.lifetimeChargeOffsByType[t], 0);
        const orig = LOAN_TYPES.reduce((x, t) => x + bank.originationsByType[t], 0) + bank.acct.loans;
        rates.push(co / Math.max(1, orig));
      }
      if (rates[0]! < rates[1]!) disciplinedWins += 1;
    }
    expect(disciplinedWins / SEEDS).toBeGreaterThan(0.75);
  });

  it('CCO skill changes what the memo says, never the truth', () => {
    const data = loadFixtures();
    const world = createWorld(4, data);
    newPlayer(world);
    const metro = startableMetros(world)[0]!;
    const bank = startCharter({ world, events: [] }, { mode: 'charter', cbsa: metro.cbsa, name: 'S', invest: 2_000_000 });
    const county = world.geo.counties[bank.homeCounty!]!;
    const r = makeRng(9);
    let flagsHigh = 0;
    let flagsLow = 0;
    for (let i = 0; i < 300; i++) {
      const a = generateApplication(world, bank, county, r);
      const pd = a.truePd;
      const copy = JSON.parse(JSON.stringify(a));
      ccoReview(a, bank, 90, makeRng(i));
      ccoReview(copy, bank, 20, makeRng(i));
      flagsHigh += a.memo.redFlags.length;
      flagsLow += copy.memo.redFlags.length;
      expect(a.truePd).toBe(pd);
    }
    expect(flagsHigh).toBeGreaterThan(flagsLow);
  });
});

describe('the rate sheet', () => {
  it('pricing under market brings borrowers in by the calibrated share, over market sends them away, market is one', () => {
    const world = createWorld(11);
    const bank = createBank(world, { name: 'P', kind: 'rival', state: 'TX', capital: 5_000_000, deposits: { checking: 40_000_000 }, loans: 30_000_000 });
    world.playerBankId = bank.id;
    expect(demandMultiplier(bank, 'ci')).toBe(1);
    setPricing(world, 'ci', -0.0025);
    const per25 = calibration.loanRateElasticity.typical / 100;
    expect(demandMultiplier(bank, 'ci')).toBeCloseTo(1 + per25, 6);
    setPricing(world, 'ci', 0.0025);
    expect(demandMultiplier(bank, 'ci')).toBeCloseTo(1 / (1 + per25), 6);
    // Clamped to the sheet's range and rounded to a basis point.
    setPricing(world, 'resi', -0.5);
    expect(bank.pricing.resi).toBe(-0.02);
    setPricing(world, 'resi', 0.00123);
    expect(bank.pricing.resi).toBe(0.0012);
  });

  it.skipIf(!hasFixtures())('a cheaper C&I rate brings more C&I borrowers and no other type over a year, and every memo carries the offset', () => {
    const run = (offset: number) => {
      const data = loadFixtures();
      const world = createWorld(21, data);
      newPlayer(world);
      const metro = startableMetros(world)[0]!;
      const ctx = { world, events: [] };
      const bank = startCharter(ctx, { mode: 'charter', cbsa: metro.cbsa, name: 'R', invest: 2_000_000 });
      setPricing(world, 'ci', offset);
      setDial(world, 0, 0);
      let rateCheck = true;
      for (let d = 0; d < 360; d++) {
        tick(world);
        for (const p of world.pending) {
          if (p.kind === 'loan_application') {
            const app = p.data.app as { type: string; memo: { rate: number } };
            if (app.type === 'ci' && offset !== 0 && app.memo.rate <= 0) rateCheck = false;
          }
        }
        world.pending = [];
      }
      return { ci: bank.applicationsByType.ci, resi: bank.applicationsByType.resi, rateCheck };
    };
    const base = run(0);
    const cheap = run(-0.01);
    expect(cheap.rateCheck).toBe(true);
    expect(cheap.ci).toBeGreaterThan(base.ci * 1.15);
    expect(Math.abs(cheap.resi - base.resi)).toBeLessThan(Math.max(10, base.resi * 0.35));
  });
});
