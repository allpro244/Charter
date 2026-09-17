// Economy invariants (SYSTEMS.md Part 1, system 2), 20 seeds by default,
// 50 in npm run test:full (rule 19).

import { describe, expect, it } from 'vitest';
import { calibration } from '../data/calibration';
import { SECTORS } from '../data/types';
import { exposureMove } from '../engine/economy';
import { createWorld, emptySectors } from '../engine/state';
import { tick } from '../engine/tick';

const SEEDS = process.env.CHARTER_FULL ? 50 : 20;
const YEARS = 60;

function run(seed: number) {
  const world = createWorld(seed);
  const oilPath: number[] = [];
  const curve: { m3: number; y10: number; ff: number }[] = [];
  for (let d = 0; d < YEARS * 365; d++) {
    tick(world);
    if (d % 30 === 0) {
      oilPath.push(world.economy.oil);
      curve.push({ m3: world.economy.curve.m3, y10: world.economy.curve.y10, ff: world.economy.fedFunds });
    }
  }
  return { world, oilPath, curve };
}

function drawdowns(path: number[], depth: number): number {
  let peak = path[0] ?? 0;
  let count = 0;
  let inDraw = false;
  for (const x of path) {
    if (x > peak) {
      peak = x;
      inDraw = false;
    }
    if (!inDraw && x <= peak * (1 - depth)) {
      count += 1;
      inDraw = true;
      peak = x; // reset so the next drawdown needs a new peak
    }
  }
  return count;
}

describe('economy', () => {
  const runs = Array.from({ length: SEEDS }, (_, i) => run(1000 + i));

  it(`recessions average every 7 to 12 years across ${SEEDS} seeds`, () => {
    let total = 0;
    for (const { world } of runs) total += world.economy.recessions.length;
    const perYear = total / (SEEDS * YEARS);
    const interval = 1 / perYear;
    const band = calibration.recessionIntervalYears;
    expect(interval).toBeGreaterThan(band.low);
    expect(interval).toBeLessThan(band.high);
  });

  it('roughly one in three recessions is a banking crisis', () => {
    let n = 0;
    let crises = 0;
    for (const { world } of runs) {
      for (const r of world.economy.recessions) {
        n += 1;
        if (r.crisis) crises += 1;
      }
    }
    const share = crises / n;
    expect(share).toBeGreaterThan(calibration.bankingCrisisShare.low - 0.05);
    expect(share).toBeLessThan(calibration.bankingCrisisShare.high + 0.05);
  });

  it('recessions last about a year and end', () => {
    let months = 0;
    let n = 0;
    for (const { world } of runs) {
      for (const r of world.economy.recessions) {
        if (r.endMonth !== null) {
          months += r.endMonth - r.startMonth;
          n += 1;
        }
      }
    }
    expect(months / n).toBeGreaterThan(6);
    expect(months / n).toBeLessThan(24);
  });

  it('curve stays within historical bounds', () => {
    for (const { curve } of runs) {
      for (const c of curve) {
        expect(c.ff).toBeGreaterThanOrEqual(0.001);
        expect(c.ff).toBeLessThan(0.12);
        expect(c.y10).toBeGreaterThan(0.004);
        expect(c.y10).toBeLessThan(0.15);
        expect(c.y10 - c.m3).toBeGreaterThan(-0.03);
        expect(c.y10 - c.m3).toBeLessThan(0.05);
      }
    }
  });

  it('the curve inverts sometimes and is upward sloping most of the time', () => {
    let inverted = 0;
    let n = 0;
    for (const { curve } of runs) {
      for (const c of curve) {
        n += 1;
        if (c.y10 < c.m3) inverted += 1;
      }
    }
    const share = inverted / n;
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.45);
  });

  it('energy has at least one 50% drawdown per 15 years on average', () => {
    let count = 0;
    for (const { oilPath } of runs) count += drawdowns(oilPath, 0.5);
    const per15 = count / ((SEEDS * YEARS) / 15);
    expect(per15).toBeGreaterThanOrEqual(calibration.energyDrawdownPer15y.low);
    expect(per15).toBeLessThanOrEqual(calibration.energyDrawdownPer15y.high + 1);
  });

  it('unemployment rises in recessions and falls in expansions', () => {
    let recU = 0;
    let recN = 0;
    let expU = 0;
    let expN = 0;
    for (const seed of [5, 6, 7]) {
      const world = createWorld(seed);
      for (let d = 0; d < 40 * 365; d++) {
        tick(world);
        if (d % 30 === 0) {
          const e = world.economy;
          if (e.regime === 'recession') {
            recU += e.unemployment;
            recN += 1;
          } else if (e.regime === 'expansion') {
            expU += e.unemployment;
            expN += 1;
          }
        }
      }
    }
    expect(recU / recN).toBeGreaterThan(expU / expN + 0.01);
  });

  it('an exposure vector with 30% energy moves at least 3x one with 2% in an energy shock', () => {
    // Pure arithmetic on exposure vectors (D41): the same shock, two mixes.
    const momentum = emptySectors(0);
    momentum.energy = -0.2;
    momentum.other = -0.005;
    const heavy = emptySectors(0);
    heavy.energy = 0.3;
    heavy.other = 0.7;
    const light = emptySectors(0);
    light.energy = 0.02;
    light.other = 0.98;
    const h = Math.abs(exposureMove(heavy, momentum));
    const l = Math.abs(exposureMove(light, momentum));
    expect(h).toBeGreaterThan(3 * l);
    expect(SECTORS.length).toBe(11);
  });
});
