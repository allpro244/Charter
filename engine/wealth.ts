// Personal wealth (SYSTEMS.md Part 1, system 9). Cash, shares, salary,
// dividends, flat tax. Score is cash plus shares at book or market (D7).

import { calibration } from '../data/calibration';
import { type Ctx, emit, milestone } from './ctx';
import { netIncome, post } from './ledger';
import { canPayDividend } from './regulation';
import { type Bank, type World, playerBank, playerNetWorth } from './state';
import { money } from './format';

// CEO pay scales with size on a log curve, from the calibration typical at
// $1B of assets.
export function defaultSalary(assets: number): number {
  const at1b = calibration.ceoSalaryPerBillionAssets.typical * 1000;
  const scale = Math.max(0.4, Math.pow(Math.max(assets, 1) / 1e9, 0.3));
  return Math.round((at1b * scale) / 5000) * 5000;
}

export function wealthMonthly(ctx: Ctx): void {
  const { world } = ctx;
  const p = world.player;
  const b = playerBank(world);
  if (b && b.status !== 'failed' && p.salary > 0) {
    const gross = Math.round(p.salary / 12);
    if (b.acct.cash >= gross) {
      post(b.acct, { cash: -gross, retainedEarnings: -gross });
      b.is.month.salaries += gross;
      const net = Math.round(gross * (1 - p.taxRate));
      p.cash += net;
      p.salaryReceived += net;
    }
  }
  p.netWorthHistory.push({ day: world.day, value: playerNetWorth(world) });
  if (p.netWorthHistory.length > 1200) p.netWorthHistory.shift();
}

export function payDividend(ctx: Ctx, b: Bank): number {
  const { world } = ctx;
  const ni = netIncome(b.is.quarter);
  if (ni <= 0 || b.dividendPayout <= 0) return 0;
  const d = Math.round(ni * b.dividendPayout);
  if (d <= 0) return 0;
  if (!canPayDividend(b, d) || b.acct.cash < d) {
    if (b.id === world.playerBankId) {
      emit(ctx, 'regulator', `Dividend of ${money(d)} blocked: it would leave ${b.name} below adequately capitalized`, { severity: 'alert', bankId: b.id });
    }
    return 0;
  }
  post(b.acct, { cash: -d, retainedEarnings: -d });
  b.dividendsPaid += d;
  if (b.id === world.playerBankId) {
    const p = world.player;
    const gross = Math.round((d * p.shares) / b.shares);
    const net = Math.round(gross * (1 - p.taxRate));
    p.cash += net;
    p.dividendsGross += gross;
    p.dividendsReceived += net;
    if (b.dividendsPaid === d) milestone(ctx, `First dividend: ${money(d)} paid, ${money(net)} of it yours after tax`);
    emit(ctx, 'system', `${b.name} paid ${money(d)} in dividends. Your share ${money(gross)}, ${money(net)} after tax.`, {
      severity: 'good',
      bankId: b.id,
    });
  }
  return d;
}

export function wealthQuarterly(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status === 'failed' || b.status === 'acquired') continue;
    payDividend(ctx, b);
  }
}

// Player settings. The desk calls these between ticks.
export function setDividendPayout(world: World, ratio: number): void {
  const b = playerBank(world);
  if (b) b.dividendPayout = Math.max(0, Math.min(1, ratio));
}

export function setSalary(world: World, annual: number): void {
  world.player.salary = Math.max(0, Math.round(annual));
}

export function playerStake(world: World): number {
  const b = playerBank(world);
  return b && b.shares > 0 ? world.player.shares / b.shares : 0;
}
