// The generated banking sector (D48): when the data carries no FDIC list,
// the engine builds one from the hand bands and the real county incomes,
// deterministically by seed, and conserves its own totals. Skipped with a
// reason until fixtures exist.

import { describe, expect, it } from 'vitest';
import { calibration } from '../data/calibration';
import { createWorld } from '../engine/state';
import { newPlayer, seedsForMetro, startCharter, startableMetros, takeoverCandidates } from '../engine/start';
import { FIXTURES_MISSING, hasFixtures, loadFixtures } from './helpers/fixtures';

const tag = (name: string) => (calibration.banksPerMillionPeople.verified ? name : `[unverified] ${name}`);

describe.skipIf(!hasFixtures())(`generated bank seeds (${hasFixtures() ? 'fixtures loaded' : FIXTURES_MISSING})`, () => {
  it(tag('builds a banking sector from income when the data has no FDIC list, deterministic by seed'), () => {
    const data = loadFixtures();
    const stripped = { ...data, banksByState: Object.fromEntries(Object.keys(data.banksByState).map((k) => [k, []])) };
    const a = createWorld(7, stripped);
    const b = createWorld(7, stripped);
    expect(a.geo.bankData).toBe('generated');
    expect(JSON.stringify(a.bankSeeds)).toBe(JSON.stringify(b.bankSeeds));
    expect(JSON.stringify(createWorld(8, stripped).bankSeeds)).not.toBe(JSON.stringify(a.bankSeeds));
    for (const st of Object.values(a.geo.states)) {
      const seeds = a.bankSeeds[st.abbr] ?? [];
      expect(seeds.length).toBe(st.bankCount);
      expect(seeds.reduce((s, x) => s + x.assets, 0)).toBe(st.totalAssets);
      expect(seeds.reduce((s, x) => s + x.deposits, 0)).toBe(st.totalDeposits);
      for (const s of seeds) {
        expect(s.county && a.geo.counties[s.county]?.state).toBe(st.abbr);
        expect(s.assets).toBeGreaterThanOrEqual(s.deposits);
      }
      // Deposit pools follow income: every county with people has one.
      for (const c of Object.values(a.geo.counties)) if (c.state === st.abbr && c.population > 0) expect(c.depositPool).toBeGreaterThan(0);
    }
    // The largest seed anywhere is the hand band's giant.
    expect(a.largestNational).toBe(calibration.largestBankAssets.typical * 1e12);
    // The start flow finds takeover candidates and a charter runs.
    newPlayer(a);
    const metro = startableMetros(a)[0]!;
    expect(takeoverCandidates(a, metro, seedsForMetro(a, metro)).length).toBeGreaterThan(0);
    const bank = startCharter({ world: a, events: [] }, { mode: 'charter', cbsa: metro.cbsa, name: 'T', invest: 2_000_000 });
    expect(bank.homeCounty).not.toBeNull();
  });
});
