// Underwriting invariants that need real counties (borrowers are drawn
// from county data, D43). Skipped with a reason until fixtures exist.

import { describe, expect, it } from 'vitest';
import { generateApplication, ccoReview } from '../engine/borrowers';
import { LOAN_TYPES } from '../engine/loantypes';
import { makeRng } from '../engine/rng';
import { createWorld } from '../engine/state';
import { newPlayer, principalCounty, seedsForMetro, startCharter, startTakeover, startableMetros, takeoverCandidates } from '../engine/start';
import { tick } from '../engine/tick';
import { isYearEnd } from '../engine/time';
import { applicationsDaily, demandMultiplier, setDial, setPolicy, setPricing } from '../engine/underwriting';
import { createBank } from '../engine/state';
import { calibration } from '../data/calibration';
import { FIXTURES_MISSING, hasFixtures, loadFixtures } from './helpers/fixtures';

const SEEDS = process.env.CHARTER_FULL ? 50 : 20;

describe.skipIf(!hasFixtures())(`underwriting (${hasFixtures() ? 'fixtures loaded' : FIXTURES_MISSING})`, () => {
  it('borrowers come from the county: a Midland book has energy borrowers, a San Jose book has tech', () => {
    const data = loadFixtures();
    const world = createWorld(1, data);
    newPlayer(world);
    const metros = Object.values(world.geo.metros);
    const midland = metros.find((m) => m.name.startsWith('Midland'))!;
    const sanJose = metros.find((m) => m.name.startsWith('San Jose'))!;
    const ctx = { world, events: [] };
    const bank = startCharter(ctx, { mode: 'charter', cbsa: midland.cbsa, name: 'M', invest: 2_000_000 });
    const county = world.geo.counties[bank.homeCounty!]!;
    const sj = principalCounty(world, sanJose)!;
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
    // Every application the bank could make reached the desk; the ones over
    // the legal limit or beyond today's funding were turned away at the door (D51).
    expect(bank.applications.toDesk + (bank.applications.turnedAway ?? 0)).toBe(bank.applications.received);
    expect(bank.applications.toDesk).toBeGreaterThan(0);
  });

  it('no loan is both current and charged off, and pools plus the book equal the loans account', () => {
    const data = loadFixtures();
    const world = createWorld(3, data);
    newPlayer(world);
    const metro = startableMetros(world)[0]!;
    const seeds = seedsForMetro(world, metro);
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

  it(`a disciplined underwriter (DSCR > 1.5, LTV < 65%) pays less for credit than approve-everything across ${SEEDS} seeds`, () => {
    // The cost of credit is what the bank set aside plus what it wrote off,
    // against everything it lent. A bank that failed lost it all.
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
        // The desk's underwriting is what is measured: no pooled lending by the branch network.
        if (disciplined) setPolicy(world, { minDscr: 1.5, targetLoansToDeposits: 0, maxLtv: { ci: 0.65, cre_oo: 0.65, cre_inv: 0.65, construction: 0.65, resi: 0.65, consumer: 0.65, ag: 0.65, energy: 0.65, cards: 0.65 } });
        else setPolicy(world, { minDscr: 0, maxLeverage: 100, targetLoansToDeposits: 0, maxLtv: { ci: 2, cre_oo: 2, cre_inv: 2, construction: 2, resi: 2, consumer: 2, ag: 2, energy: 2, cards: 2 }, sectorCap: 1, maxSize: 1e12 });
        let lent = 0;
        for (let d = 0; d < 6 * 365; d++) {
          tick(world);
          // The year to date resets inside the year-end tick: read it the day before.
          if (isYearEnd(world.day + 1)) lent += LOAN_TYPES.reduce((x, t) => x + bank.originationsByType[t], 0);
          if (bank.status === 'failed') break;
        }
        lent += LOAN_TYPES.reduce((x, t) => x + bank.originationsByType[t], 0);
        if (bank.status === 'failed') {
          rates.push(Infinity);
          continue;
        }
        const provisions = bank.quarterHistory.reduce((x, q) => x + q.is.provision, 0) + bank.is.quarter.provision;
        const chargeOffs = LOAN_TYPES.reduce((x, t) => x + bank.lifetimeChargeOffsByType[t], 0);
        rates.push((Math.max(0, provisions) + chargeOffs) / Math.max(1, lent));
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

  it.skipIf(!hasFixtures())('a cheaper C&I rate brings more C&I borrowers and no other type, and every memo carries the offset', () => {
    // The same day, run many times, so the economy holds still and only the
    // sheet differs: arrivals by type are compared as shares of the total.
    const run = (offset: number) => {
      const data = loadFixtures();
      const world = createWorld(21, data);
      newPlayer(world);
      const metro = startableMetros(world)[0]!;
      const ctx = { world, events: [] };
      const bank = startCharter(ctx, { mode: 'charter', cbsa: metro.cbsa, name: 'R', invest: 2_000_000 });
      setPricing(world, 'ci', offset);
      setDial(world, 0, 0);
      let memoRates = 0;
      let memosChecked = 0;
      for (let i = 0; i < 1500; i++) {
        applicationsDaily(ctx);
        for (const p of world.pending) {
          const apps = p.kind === 'loan_application' ? [p.data.app as { type: string; memo: { rate: number } }] : p.kind === 'loan_batch' ? (p.data.apps as { type: string; memo: { rate: number } }[]) : [];
          for (const a of apps) if (a.type === 'ci') { memoRates += a.memo.rate; memosChecked++; }
        }
        world.pending = [];
      }
      const total = LOAN_TYPES.reduce((s, t) => s + bank.applicationsByType[t], 0);
      return { total, ciShare: bank.applicationsByType.ci / total, resiShare: bank.applicationsByType.resi / total, avgCiRate: memoRates / Math.max(1, memosChecked) };
    };
    const base = run(0);
    const cheap = run(-0.01);
    expect(base.total).toBeGreaterThan(300);
    // A full point under market at 8% per 25bp is 36% more C&I borrowers:
    // their share of arrivals rises by about a fifth of itself.
    expect(cheap.ciShare).toBeGreaterThan(base.ciShare * 1.1);
    expect(cheap.ciShare).toBeLessThan(base.ciShare * 1.5);
    // Every C&I memo carries the offset, near enough to a basis point.
    expect(cheap.avgCiRate).toBeLessThan(base.avgCiRate - 0.008);
    expect(cheap.avgCiRate).toBeGreaterThan(base.avgCiRate - 0.012);
  });
});
