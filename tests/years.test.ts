// The year in review (D65) and no impossible decisions (D66). Real
// geography, so applications arrive; skipped until the fixtures exist.

import { describe, expect, it } from 'vitest';
import { canTakeLargeDeposit } from '../engine/depositors';
import { totalAssets } from '../engine/ledger';
import { createWorld } from '../engine/state';
import { newPlayer, startCharter, startableMetros } from '../engine/start';
import { applyDecisions, tick } from '../engine/tick';
import { FIXTURES_MISSING, hasFixtures, loadFixtures } from './helpers/fixtures';

function charter(seed: number) {
  const world = createWorld(seed, loadFixtures());
  newPlayer(world);
  const metro = startableMetros(world)[0]!;
  const bank = startCharter({ world, events: [] }, { mode: 'charter', cbsa: metro.cbsa, name: 'Year Bank', invest: 2_000_000 });
  return { world, bank };
}

describe.skipIf(!hasFixtures())(`year in review and the desk (${hasFixtures() ? 'fixtures loaded' : FIXTURES_MISSING})`, () => {
  it('keeps one review a year with that year\'s own desk calls', () => {
    const { world, bank } = charter(65);
    for (let d = 0; d < 365 * 2 + 5; d++) {
      tick(world);
      const blocking = world.pending.filter((p) => p.blocking);
      if (blocking.length > 0) applyDecisions({ world, events: [] }, blocking.map((p) => ({ pendingId: p.id, choice: p.options.some((o) => o.key === 'a') ? 'a' : p.options[0]!.key })));
    }
    const years = bank.years ?? [];
    expect(years.map((r) => r.year)).toEqual([2024, 2025]);
    expect(years[0]!.deNovo).toBe(true);
    expect(years[0]!.approved + years[1]!.approved).toBe(bank.deskAtYear!.approved);
    expect(years[1]!.rankAgo).toBe(years[0]!.rank);
    expect(world.milestones.some((m) => m.text.includes('approved at your desk this year'))).toBe(true);
  });

  it('a bank frozen by an order sees no loan applications and no big deposit offers (D66)', () => {
    const { world, bank } = charter(66);
    for (let d = 0; d < 200; d++) tick(world);
    world.pending = world.pending.filter((p) => !p.blocking);
    bank.enforcement = 'consent';
    bank.enforcementSince = world.day;
    bank.enforcementAssets = Math.round(totalAssets(bank.acct) * 0.5);
    expect(canTakeLargeDeposit(bank)).toBe(false);
    let apps = 0;
    for (let d = 0; d < 120; d++) {
      tick(world);
      apps += world.pending.filter((p) => p.kind === 'loan_application' || p.kind === 'loan_batch' || p.kind === 'deposit_offer').length;
      world.pending = world.pending.filter((p) => !p.blocking);
    }
    expect(apps).toBe(0);
    expect(world.feed.some((f) => f.text.includes('enforcement order freezes the bank'))).toBe(true);
  });
});
