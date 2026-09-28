// The de novo business plan (D73). A new charter files a three year plan
// with its application for deposit insurance: where its assets will be at
// each year end, when it first makes money, and capital held at or above
// the de novo floor throughout. The targets come from the engine's own
// franchise ramp for the home office, so the plan asks what a well run
// new bank in that county does. The desk tracks it; the examiner holds
// the bank to the capital floor.

import { calibration } from '../data/calibration';
import { type Ctx, emit, milestone } from './ctx';
import { branchTarget } from './deposits';
import { leverageRatio, totalAssets, totalEquity } from './ledger';
import { type Bank, type World } from './state';
import { money, pct } from './format';

export interface BusinessPlan {
  filedDay: number;
  assets: number[]; // targets at the end of years one, two and three
  breakevenBy: number; // the quarter, counted from the charter, of the first profit
  capitalFloor: number; // tier 1 leverage, a fraction
  lowestLeverage: number | null; // the lowest at any quarter end so far
  firstProfitQuarter: number | null;
  yearsReported: number;
  actual?: number[]; // assets at each year end reported
  done?: boolean;
}

export function filePlan(world: World, b: Bank): BusinessPlan | null {
  const home = b.branches[0];
  if (!home) return null;
  const equity = totalEquity(b.acct);
  const assets = [1, 2, 3].map((y) => Math.round(equity + branchTarget(world, b, { ...home, openedDay: world.day - y * 365, deposits: 0, competitiveTarget: null }, true)));
  return {
    filedDay: world.day,
    assets,
    breakevenBy: Math.round(calibration.deNovoBreakevenQuarters.typical),
    capitalFloor: calibration.deNovoCapitalFloor.typical / 100,
    lowestLeverage: null,
    firstProfitQuarter: null,
    yearsReported: 0,
  };
}

export function inDeNovo(world: World, b: Bank): boolean {
  return !!b.plan && !b.plan.done && world.day - b.plan.filedDay < 3 * 365 + 1;
}

// Quarter ends: the lowest leverage and the first profit. Year ends: the
// assets against the plan, and at the third the verdict.
export function planQuarterly(ctx: Ctx, b: Bank): void {
  const { world } = ctx;
  const p = b.plan;
  if (!p || p.done) return;
  const lev = leverageRatio(b.acct);
  const quarter = b.reports.length;
  // The opening quarter's leverage is all capital and no book: the floor is
  // measured from the first full quarter.
  if (quarter >= 1) p.lowestLeverage = p.lowestLeverage === null ? lev : Math.min(p.lowestLeverage, lev);
  const last = b.reports[b.reports.length - 1];
  if (p.firstProfitQuarter === null && last && last.netIncome > 0) {
    p.firstProfitQuarter = quarter;
    const text = `First profitable quarter, quarter ${quarter} of the business plan${quarter <= p.breakevenBy ? `, inside the plan's ${p.breakevenBy}` : `, later than the plan's ${p.breakevenBy}`}`;
    milestone(ctx, text);
    emit(ctx, 'system', text, { severity: 'good', bankId: b.id });
  }
  if (lev < p.capitalFloor && world.day - p.filedDay < 3 * 365) {
    emit(ctx, 'regulator', `Leverage ${pct(lev, 1)} is under the ${pct(p.capitalFloor, 0)} the business plan commits to for the de novo years: the examiners write it up. Slow the growth or raise capital (Money, balance sheet and capital).`, { severity: 'alert', bankId: b.id });
  }
  const years = Math.floor((world.day - p.filedDay + 5) / 365);
  if (years > p.yearsReported && years <= 3) {
    p.yearsReported = years;
    const target = p.assets[years - 1] ?? 0;
    const have = totalAssets(b.acct);
    (p.actual ??= []).push(have);
    emit(ctx, 'system', `Business plan, year ${years} of 3: assets ${money(have)} against the plan's ${money(target)}, ${have >= target ? 'ahead' : 'behind'} by ${pct(Math.abs(have / Math.max(1, target) - 1), 0)}.`, { severity: have >= target ? 'good' : 'info', bankId: b.id });
    if (years === 3) {
      const met = planScore(b);
      const text = `De novo years complete: the business plan met on ${met.met} of 3 (assets ${met.assets ? 'reached' : 'short'}, profit ${met.profit ? 'on time' : 'late'}, capital ${met.capital ? 'held' : 'under the floor'})`;
      milestone(ctx, text);
      emit(ctx, 'system', text, { severity: met.met === 3 ? 'good' : 'info', bankId: b.id });
      p.done = true;
    }
  }
}

export function planScore(b: Bank): { assets: boolean; profit: boolean; capital: boolean; met: number } {
  const p = b.plan;
  if (!p) return { assets: false, profit: false, capital: false, met: 0 };
  const assets = totalAssets(b.acct) >= (p.assets[2] ?? Infinity);
  const profit = p.firstProfitQuarter !== null && p.firstProfitQuarter <= p.breakevenBy;
  const capital = p.lowestLeverage === null || p.lowestLeverage >= p.capitalFloor;
  return { assets, profit, capital, met: Number(assets) + Number(profit) + Number(capital) };
}
