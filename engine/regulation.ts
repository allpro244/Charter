// Regulation (SYSTEMS.md Part 1, system 12). Phase 1 version: leverage
// ratio only, closure below 2%. Prompt corrective action categories are
// the statutory ones (12 CFR 324.403), which is law, not calibration.

import { type Ctx, emit } from './ctx';
import { leverageRatio, tier1Capital, totalAssets } from './ledger';
import { type Bank, type World } from './state';
import { dateOf } from './time';
import { pct } from './format';

export const PCA_WELL = 0.05;
export const PCA_ADEQUATE = 0.04;
export const PCA_SIGNIFICANT = 0.03;
export const PCA_CRITICAL = 0.02;

export type PcaCategory = 'well' | 'adequate' | 'under' | 'significant' | 'critical';

export function pcaCategory(leverage: number): PcaCategory {
  if (leverage >= PCA_WELL) return 'well';
  if (leverage >= PCA_ADEQUATE) return 'adequate';
  if (leverage >= PCA_SIGNIFICANT) return 'under';
  if (leverage > PCA_CRITICAL) return 'significant';
  return 'critical';
}

export const PCA_LABEL: Record<PcaCategory, string> = {
  well: 'well capitalized',
  adequate: 'adequately capitalized',
  under: 'undercapitalized',
  significant: 'significantly undercapitalized',
  critical: 'critically undercapitalized',
};

// The next Friday strictly after today, and at least two days out.
export function nextFriday(day: number): number {
  const dow = dateOf(day).dow;
  let delta = (5 - dow + 7) % 7;
  if (delta < 2) delta += 7;
  return day + delta;
}

export function regulationMonthly(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status === 'failed' || b.status === 'acquired') continue;
    const lev = leverageRatio(b.acct);
    if (b.status === 'open' && lev <= PCA_CRITICAL) {
      b.status = 'closing';
      b.closureDay = nextFriday(world.day);
      emit(ctx, 'regulator', `${b.name} is critically undercapitalized at ${pct(lev)} leverage. Closure scheduled.`, {
        severity: 'alert',
        bankId: b.id,
      });
    } else if (b.status === 'closing' && lev >= PCA_ADEQUATE) {
      b.status = 'open';
      b.closureDay = null;
      emit(ctx, 'regulator', `${b.name} recapitalized to ${pct(lev)} leverage. Closure withdrawn.`, { severity: 'good', bankId: b.id });
    } else if (b.id === world.playerBankId && lev < PCA_ADEQUATE && lev > PCA_CRITICAL) {
      emit(ctx, 'regulator', `Leverage ratio ${pct(lev)}: ${PCA_LABEL[pcaCategory(lev)]}. Dividends restricted.`, {
        severity: 'alert',
        bankId: b.id,
      });
    }
  }
}

// A dividend may not leave the bank less than adequately capitalized.
export function canPayDividend(b: Bank, amount: number): boolean {
  const a = b.acct;
  const tier1 = tier1Capital(a) - amount;
  const assets = totalAssets(a) - a.goodwill - amount;
  if (assets <= 0) return false;
  return tier1 / assets >= PCA_ADEQUATE;
}

export function playerLeverage(world: World): number | null {
  const b = world.playerBankId ? world.banks[world.playerBankId] : undefined;
  return b ? leverageRatio(b.acct) : null;
}
