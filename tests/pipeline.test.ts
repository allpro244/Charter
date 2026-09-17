// Unit tests for the pure helpers behind scripts/fetch-data.ts,
// scripts/build-data.ts and scripts/calibrate.ts. No county, metro, state,
// or bank data appears here (CLAUDE.md rule 17): inputs are abstract rows,
// code lookups, a dummy text file, and the calibration object itself.

import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findColumn, findColumnOrNull, normalizeHeader, padCode, parseCsv, parseCsvLine, parseNumber } from '../scripts/lib/csv';
import { QCEW_INDUSTRY_CODES, SECTOR_FORMULAS, renormalize, sectorShares, zeroShares, type CellTable } from '../scripts/lib/naics';
import { sha256File, sha256Text, shouldSkipDownload, upsertEntry, type RawEntry, type RawManifest } from '../scripts/lib/manifest';
import { STATES, STATE_NEIGHBORS } from '../scripts/lib/states';
import { bandFromYearly, isBand, median, percentile, renderCalibrationFile, type CalibrationTree } from '../scripts/lib/calibration-file';
import { centroid } from '../scripts/lib/geo';
import { C24030_CELLS, INCOME_BUCKET_BOUNDS, VALUE_BUCKET_BOUNDS, RENT_BUCKET_BOUNDS, bucketMedian, c24030Column, countyOfGeoid, sectorsFromC24030, sumTractsToCounties } from '../scripts/lib/acs';
import { SECTORS } from '../data/types';
import { calibration } from '../data/calibration';

describe('csv parser', () => {
  it('parses quoted fields with commas and doubled quotes', () => {
    expect(parseCsvLine('a,b,"c,d"')).toEqual(['a', 'b', 'c,d']);
    expect(parseCsvLine('"x ""quoted"" y",,z')).toEqual(['x "quoted" y', '', 'z']);
    expect(parseCsvLine('"01001","0","10","70"')).toEqual(['01001', '0', '10', '70']);
  });

  it('parses multi-line text with CRLF and newlines inside quotes', () => {
    const rows = parseCsv('h1,h2\r\n1,"line\nbreak"\r\n2,x\r\n');
    expect(rows).toEqual([
      ['h1', 'h2'],
      ['1', 'line\nbreak'],
      ['2', 'x'],
    ]);
  });

  it('finds columns by any spelling and reports the header when missing', () => {
    const header = ['﻿CBSA Code', 'FIPS State Code', 'Metropolitan/Micropolitan Statistical Area'];
    expect(findColumn(header, ['cbsa_code'], 'f.csv', 'code')).toBe(0);
    expect(findColumn(header, ['FIPSSTATECODE'], 'f.csv', 'state')).toBe(1);
    expect(findColumnOrNull(header, ['nope'])).toBe(-1);
    expect(() => findColumn(header, ['Year'], 'f.csv', 'year')).toThrow(/f\.csv.*year.*Header row is/);
    expect(normalizeHeader('Annual Change (%)')).toBe('annualchange');
  });

  it('parses numbers with separators and placeholders', () => {
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber(' 12.5 ')).toBe(12.5);
    expect(parseNumber('.')).toBeNull();
    expect(parseNumber('(D)')).toBeNull();
    expect(parseNumber('(NA)')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(7)).toBe(7);
    expect(padCode(1001, 5)).toBe('01001');
  });
});

describe('naics sector mapping (D41)', () => {
  it('covers every game sector except the residual and keeps codes unique', () => {
    const mapped = Object.keys(SECTOR_FORMULAS).sort();
    expect(mapped).toEqual(SECTORS.filter((s) => s !== 'other').sort());
    expect(new Set(QCEW_INDUSTRY_CODES).size).toBe(QCEW_INDUSTRY_CODES.length);
    expect(QCEW_INDUSTRY_CODES).toContain('31-33');
    expect(QCEW_INDUSTRY_CODES).toContain('5415');
    expect(QCEW_INDUSTRY_CODES).not.toContain('213'); // inside 21, not double counted
  });

  it('moves 324 and 486 into energy and leaves the rest as the residual', () => {
    const cells: CellTable = {
      '21': { emp: 100, suppressed: false },
      '324': { emp: 10, suppressed: false },
      '486': { emp: 5, suppressed: false },
      '31-33': { emp: 60, suppressed: false },
      '48-49': { emp: 25, suppressed: false },
      'gov:1': { emp: 20, suppressed: false },
      'gov:2': { emp: 30, suppressed: false },
      'gov:3': { emp: 50, suppressed: false },
    };
    const { shares, imputed } = sectorShares(cells, 1000, null);
    expect(imputed).toEqual([]);
    expect(shares.energy).toBeCloseTo(0.115, 10);
    expect(shares.manufacturing).toBeCloseTo(0.05, 10);
    expect(shares.logistics).toBeCloseTo(0.02, 10);
    expect(shares.government).toBeCloseTo(0.1, 10);
    expect(shares.other).toBeCloseTo(1 - 0.115 - 0.05 - 0.02 - 0.1, 10);
    expect(SECTORS.reduce((a, s) => a + shares[s], 0)).toBeCloseTo(1, 12);
  });

  it('fills a suppressed sector from the fallback share and flags it', () => {
    const fallback = { ...zeroShares(), finance: 0.2, other: 0.8 };
    const cells: CellTable = {
      '52': { emp: 0, suppressed: true },
      '62': { emp: 300, suppressed: false },
    };
    const { shares, imputed } = sectorShares(cells, 1000, fallback);
    expect(imputed).toEqual(['finance']);
    expect(shares.finance).toBeCloseTo(0.2, 10);
    expect(shares.healthcare).toBeCloseTo(0.3, 10);
    expect(shares.other).toBeCloseTo(0.5, 10);
  });

  it('renormalizes when imputed cells push the mapped total past the area total', () => {
    const fallback = { ...zeroShares(), tourism: 0.5, other: 0.5 };
    const cells: CellTable = {
      '71': { emp: 0, suppressed: true },
      '72': { emp: 0, suppressed: true },
      '62': { emp: 800, suppressed: false },
    };
    const { shares } = sectorShares(cells, 1000, fallback);
    const sum = SECTORS.reduce((a, s) => a + shares[s], 0);
    expect(sum).toBeCloseTo(1, 12);
    expect(shares.other).toBe(0);
    expect(shares.tourism).toBeCloseTo(500 / 1300, 10);
  });

  it('renormalize scales to one and leaves all-zero alone', () => {
    const r = renormalize({ ...zeroShares(), energy: 2, other: 6 });
    expect(r.energy).toBeCloseTo(0.25, 12);
    expect(r.other).toBeCloseTo(0.75, 12);
    expect(SECTORS.every((s) => renormalize(zeroShares())[s] === 0)).toBe(true);
  });
});

describe('manifest and idempotence', () => {
  it('hashes a dummy text file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'charter-pipeline-'));
    try {
      const file = join(dir, 'dummy.txt');
      writeFileSync(file, 'hello\n');
      expect(await sha256File(file)).toBe('5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03');
      expect(sha256Text('hello\n')).toBe('5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips only a complete file and never under --force', () => {
    expect(shouldSkipDownload({ force: false, exists: true, sizeOnDisk: 100, expectedBytes: 100 })).toBe(true);
    expect(shouldSkipDownload({ force: false, exists: true, sizeOnDisk: 90, expectedBytes: 100 })).toBe(false);
    expect(shouldSkipDownload({ force: false, exists: true, sizeOnDisk: 100, expectedBytes: null })).toBe(true);
    expect(shouldSkipDownload({ force: false, exists: true, sizeOnDisk: 0, expectedBytes: null })).toBe(false);
    expect(shouldSkipDownload({ force: false, exists: false, sizeOnDisk: null, expectedBytes: 100 })).toBe(false);
    expect(shouldSkipDownload({ force: true, exists: true, sizeOnDisk: 100, expectedBytes: 100 })).toBe(false);
  });

  it('upserts entries by name', () => {
    const entry = (name: string, ok: boolean): RawEntry => ({
      name,
      kind: 'file',
      required: true,
      ok,
      file: null,
      url: null,
      status: null,
      bytes: null,
      sha256: null,
      fetchedOn: '',
      skipped: false,
      attempts: [],
    });
    const m: RawManifest = { fetchedOn: '', vintage: 0, entries: [entry('a', false)] };
    upsertEntry(m, entry('b', true));
    upsertEntry(m, entry('a', true));
    expect(m.entries.map((e) => [e.name, e.ok])).toEqual([
      ['a', true],
      ['b', true],
    ]);
  });
});

describe('state geography tables', () => {
  it('lists 51 states with unique codes and a symmetric adjacency', () => {
    expect(STATES.length).toBe(51);
    const abbrs = new Set(STATES.map((s) => s.abbr));
    expect(abbrs.size).toBe(51);
    expect(Object.keys(STATE_NEIGHBORS).sort()).toEqual([...abbrs].sort());
    for (const [a, list] of Object.entries(STATE_NEIGHBORS)) {
      for (const b of list) {
        expect(abbrs.has(b), `${a} -> ${b}`).toBe(true);
        expect(STATE_NEIGHBORS[b], `${b} should list ${a}`).toContain(a);
        expect(b).not.toBe(a);
      }
    }
    expect(STATE_NEIGHBORS.AK).toEqual([]);
    expect(STATE_NEIGHBORS.HI).toEqual([]);
  });
});

describe('geometry helpers', () => {
  it('computes an area weighted centroid and handles the antimeridian', () => {
    const square: [number, number] = centroid({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    });
    expect(square).toEqual([1, 1]);
    const wrapped = centroid({
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [178, 50],
            [180, 50],
            [180, 52],
            [178, 52],
            [178, 50],
          ],
        ],
        [
          [
            [-180, 50],
            [-178, 50],
            [-178, 52],
            [-180, 52],
            [-180, 50],
          ],
        ],
      ],
    });
    expect(Math.abs(wrapped[0])).toBe(180);
    expect(wrapped[1]).toBe(51);
  });
});

describe('calibration file', () => {
  it('computes percentiles and bands', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([5, 1], 0)).toBe(1);
    expect(percentile([5, 1], 1)).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    const b = bandFromYearly([0.1, 0.2, 0.3, 0.4, 0.5], 'percent', 'src', 'q', 'w', 'n');
    expect(b.verified).toBe(true);
    expect(b.typical).toBe(0.3);
    expect(b.low).toBeLessThan(b.typical);
    expect(b.high).toBeGreaterThan(b.typical);
    expect(isBand(b)).toBe(true);
    expect(isBand({ low: 1 })).toBe(false);
  });

  it('renders data/calibration.ts and round trips the current object', async () => {
    const tree = JSON.parse(JSON.stringify(calibration)) as CalibrationTree;
    const text = renderCalibrationFile(tree, { roa: ['Return on assets.'] });
    expect(text).toContain('export interface Band');
    expect(text).toContain('export const calibration = {');
    expect(text).toContain('export function unverifiedBands()');
    expect(text).toContain('// Return on assets.');
    expect(text).not.toContain('function hand(');
    expect(text).not.toMatch(/[\u2013\u2014]/);
    const dir = mkdtempSync(join(tmpdir(), 'charter-calibration-'));
    try {
      const file = join(dir, 'calibration.ts');
      writeFileSync(file, text);
      const mod = (await import(/* @vite-ignore */ file)) as { calibration: unknown; unverifiedBands: () => string[] };
      expect(mod.calibration).toEqual(tree);
      expect(mod.unverifiedBands().length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('acs mirror helpers', () => {
  it('interpolates a bucket median and handles the open top bucket', () => {
    // 10 households: 4 under 10k, 4 in 10 to 15k, 2 in 15 to 20k: the middle
    // household (the fifth) sits a quarter of the way into the second bucket.
    const counts = [4, 4, 2, ...new Array(13).fill(0)];
    expect(bucketMedian(counts, INCOME_BUCKET_BOUNDS)).toBe(11250);
    // Everyone in the open top bucket: its lower bound times 1.25.
    const top = [...new Array(15).fill(0), 7];
    expect(bucketMedian(top, INCOME_BUCKET_BOUNDS)).toBe(250000);
    expect(bucketMedian(new Array(16).fill(0), INCOME_BUCKET_BOUNDS)).toBeNull();
    expect(VALUE_BUCKET_BOUNDS.length).toBe(26);
    expect(RENT_BUCKET_BOUNDS.length).toBe(24);
    expect(() => bucketMedian([1, 2], INCOME_BUCKET_BOUNDS)).toThrow();
  });

  it('maps every C24030 industry cell to exactly one sector and keeps the table total', () => {
    const cells = Object.values(C24030_CELLS).flat().sort((a, b) => a - b);
    expect(cells).toEqual([4, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 18, 19, 20, 22, 23, 25, 26, 27, 28]);
    expect(new Set(cells).size).toBe(cells.length);
    // A row where every leaf cell holds one worker for men and two for women.
    const sums: Record<string, number> = { C24030_001E: cells.length * 3 };
    for (const c of cells) {
      sums[c24030Column(c)] = 1;
      sums[c24030Column(c + 27)] = 2;
    }
    const res = sectorsFromC24030(sums);
    expect(res.covered).toBe(res.total);
    expect(res.counts.energy).toBe(3);
    expect(res.counts.other).toBe(15);
    expect(Object.values(res.shares).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(c24030Column(5)).toBe('C24030_005E');
  });

  it('reads the county from either geoid spelling and sums tracts, flagging all-null columns', () => {
    expect(countyOfGeoid('48201100000')).toBe('48201');
    expect(countyOfGeoid('14000US48201100000')).toBe('48201');
    expect(countyOfGeoid('bad')).toBeNull();
    const rows = [
      { GEOID: '14000US01001020100', a: 1, b: null },
      { GEOID: '01001020200', a: 2, b: null },
      { GEOID: '01003010100', a: 5, b: 7 },
    ];
    const r = sumTractsToCounties(rows, ['a', 'b']);
    expect(r.tracts).toBe(3);
    expect(r.counties.get('01001')).toEqual({ a: 3, b: 0 });
    expect(r.counties.get('01003')).toEqual({ a: 5, b: 7 });
    expect([...(r.missing.get('01001') ?? [])]).toEqual(['b']);
    expect(r.missing.has('01003')).toBe(false);
  });
});
