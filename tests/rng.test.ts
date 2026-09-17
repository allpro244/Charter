import { describe, expect, it } from 'vitest';
import { chance, derive, makeRng, pick, pickWeighted, rand, randInt, randNormal } from '../engine/rng';

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const xs = Array.from({ length: 1000 }, () => rand(a));
    const ys = Array.from({ length: 1000 }, () => rand(b));
    expect(xs).toEqual(ys);
  });

  it('differs across seeds', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(rand(a)).not.toBe(rand(b));
  });

  it('is uniform enough on [0, 1)', () => {
    const r = makeRng(7);
    const n = 100_000;
    let sum = 0;
    let min = 1;
    let max = 0;
    for (let i = 0; i < n; i++) {
      const x = rand(r);
      sum += x;
      if (x < min) min = x;
      if (x > max) max = x;
    }
    expect(sum / n).toBeGreaterThan(0.495);
    expect(sum / n).toBeLessThan(0.505);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
  });

  it('randInt is inclusive on both ends', () => {
    const r = makeRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) seen.add(randInt(r, 1, 6));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('normal has the right moments', () => {
    const r = makeRng(9);
    const n = 100_000;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const x = randNormal(r, 2, 3);
      sum += x;
      sq += x * x;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sq / n - mean * mean);
    expect(Math.abs(mean - 2)).toBeLessThan(0.05);
    expect(Math.abs(sd - 3)).toBeLessThan(0.05);
  });

  it('chance and pick respect their inputs', () => {
    const r = makeRng(11);
    let hits = 0;
    for (let i = 0; i < 10_000; i++) if (chance(r, 0.25)) hits++;
    expect(hits / 10_000).toBeGreaterThan(0.23);
    expect(hits / 10_000).toBeLessThan(0.27);
    expect(['a', 'b']).toContain(pick(r, ['a', 'b']));
    let heavy = 0;
    for (let i = 0; i < 10_000; i++) if (pickWeighted(r, ['x', 'y'], [9, 1]) === 'x') heavy++;
    expect(heavy / 10_000).toBeGreaterThan(0.87);
  });

  it('derived streams are independent of the world stream', () => {
    const world = makeRng(5);
    const before = rand(world);
    const d1 = derive(5, 1);
    const d2 = derive(5, 1);
    expect(rand(d1)).toBe(rand(d2));
    const world2 = makeRng(5);
    expect(rand(world2)).toBe(before);
  });

  it('state is plain JSON', () => {
    const r = makeRng(1);
    rand(r);
    const copy = JSON.parse(JSON.stringify(r));
    expect(rand(copy)).toBe(rand(r));
  });
});
