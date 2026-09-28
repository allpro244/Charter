// Your records (D77): built only from what the run kept. Abstract bank,
// no county data (rule 17).

import { describe, expect, it } from 'vitest';
import { createBank, createWorld } from '../engine/state';
import { personalRecords } from '../ui/years';

describe('your records', () => {
  it('is empty before the first December and reads the run afterwards', () => {
    const world = createWorld(7);
    const bank = createBank(world, { name: 'R', kind: 'rival', state: 'TX', capital: 10_000_000, deposits: { checking: 60_000_000 }, loans: 40_000_000 });
    expect(personalRecords(world, bank)).toEqual([]);
    const base = { approved: 0, wentBad: 0, peerRoa: null, peers: 0, netWorth: 0, growth: null };
    bank.years = [
      { ...base, year: 2024, profit: -200_000, roa: -0.004, assets: 50e6, rank: 4000, rankAgo: null, deNovo: true },
      { ...base, year: 2025, profit: 900_000, roa: 0.011, assets: 80e6, rank: 3500, rankAgo: 4000 },
      { ...base, year: 2026, profit: 700_000, roa: 0.008, assets: 90e6, rank: 3400, rankAgo: 3500 },
    ];
    world.deals.push({ day: 700, kind: 'assisted', buyer: 'R', target: 'Failed Bank', assets: 30e6, price: 0, priceToBook: null, regime: 'recession' });
    world.deals.push({ day: 800, kind: 'whole', buyer: 'Someone Else', target: 'Big', assets: 900e6, price: 0, priceToBook: null, regime: 'expansion' });
    bank.desk = { approved: 10, approvedAmount: 5_000_000, countered: 0, declined: 0, paidOff: 0, wentBad: 1, lost: 50_000 };
    const rows = Object.fromEntries(personalRecords(world, bank).map((r) => [r.label, r]));
    expect(rows['Best year by profit']!.when).toBe('2025');
    expect(rows['Best return on assets']!.when).toBe('2025');
    expect(rows['Biggest climb in a year']!.value).toBe('500 places');
    expect(rows['Best rank at a year end']!.value).toBe('#3,400');
    expect(rows['Biggest deal']!.value).toMatch(/^Failed Bank/);
    expect(rows['Desk losses']!.value).toMatch(/^1\.00%/);
    for (const r of Object.values(rows)) expect(`${r.label}${r.value}${r.when}`).not.toMatch(/[–—]/);
  });
});
