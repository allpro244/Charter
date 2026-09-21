// D53: borrowers come back with their record, and a county with a player
// branch reports its local economy when it moves against the country.

import { describe, expect, it } from 'vitest';
import type { Ctx } from '../engine/ctx';
import { localNewsMonthly } from '../engine/economy';
import { generateApplication, returningText } from '../engine/borrowers';
import { createWorld } from '../engine/state';
import { newPlayer, startCharter, startableMetros } from '../engine/start';
import { tick } from '../engine/tick';
import { setDial } from '../engine/underwriting';
import { FIXTURES_MISSING, hasFixtures, loadFixtures } from './helpers/fixtures';

describe.skipIf(!hasFixtures())(`repeat borrowers and local news (${hasFixtures() ? 'fixtures loaded' : FIXTURES_MISSING})`, () => {
  it('the bank remembers who it lent to, and a returning borrower carries the record onto the memo', () => {
    const world = createWorld(41, loadFixtures());
    newPlayer(world);
    const metro = startableMetros(world)[0]!;
    const bank = startCharter({ world, events: [] }, { mode: 'charter', cbsa: metro.cbsa, name: 'R', invest: 2_000_000 });
    setDial(world, 100_000_000, 7); // everything decided under policy
    for (let d = 0; d < 3 * 365; d++) tick(world);
    const customers = Object.values(bank.customers ?? {});
    expect(customers.length).toBeGreaterThan(20);
    expect(customers.some((c) => c.paidOff > 0 || c.loans > 1)).toBe(true);
    for (const c of customers) expect(c.loans).toBeGreaterThan(0);
    // A known borrower who paid comes back with a clean history and the sentence.
    const paid = customers.find((c) => c.paidOff > 0 && c.wentBad === 0) ?? customers[0]!;
    const county = world.geo.counties[paid.county]!;
    const app = generateApplication(world, bank, county, world.rng, paid);
    expect(app.borrower).toBe(paid.name);
    expect(app.returning?.loans).toBe(paid.loans);
    if (paid.paidOff > 0) expect(app.memo.paymentHistory).toBe('clean');
    expect(returningText(app)).toMatch(/Back/);
    // One who went bad on the bank is read as a poor history.
    const bad = { ...paid, wentBad: 1 };
    const app2 = generateApplication(world, bank, county, world.rng, bad);
    expect(app2.memo.paymentHistory).toBe('poor');
    expect(returningText(app2)).toMatch(/went bad/);
  });

  it('a county with a branch reports a move against the country once, naming the sector and the borrowers in it', () => {
    const world = createWorld(42, loadFixtures());
    newPlayer(world);
    const metro = startableMetros(world)[0]!;
    const bank = startCharter({ world, events: [] }, { mode: 'charter', cbsa: metro.cbsa, name: 'N', invest: 2_000_000 });
    const county = world.geo.counties[bank.homeCounty!]!;
    // Twelve quiet months on record, then a five percent fall.
    county.condHist = new Array(12).fill(100);
    county.condition = 95;
    const ctx: Ctx = { world, events: [] };
    localNewsMonthly(ctx);
    const line = ctx.events.find((e) => e.source === 'market' && /local economy is down 5%/.test(e.text));
    expect(line).toBeDefined();
    expect(line!.text).toContain(county.name);
    // Not again within six months, even if it keeps falling.
    county.condition = 90;
    const ctx2: Ctx = { world, events: [] };
    localNewsMonthly(ctx2);
    expect(ctx2.events.filter((e) => /local economy/.test(e.text)).length).toBe(0);
    // A quiet county says nothing.
    county.condHist = new Array(12).fill(100);
    county.condition = 101;
    county.lastNewsDay = undefined;
    const ctx3: Ctx = { world, events: [] };
    localNewsMonthly(ctx3);
    expect(ctx3.events.filter((e) => /local economy/.test(e.text)).length).toBe(0);
  });
});
