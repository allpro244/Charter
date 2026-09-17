// Deposits and funding (SYSTEMS.md Part 1, system 4). Daily flows toward a
// target drawn from the home county's real deposit pool; monthly rate
// resets. Phase 1 version: one county, one branch, no rivals in the pool.
// Phase 3 adds types by branch, betas, brokered, FHLB, securities, runs.

import { calibration } from '../data/calibration';
import { type Ctx, emit } from './ctx';
import { DEPOSIT_TYPES, type DepositType, post, totalAssets } from './ledger';
import { randNormal } from './rng';
import { type Bank, type World } from './state';
import { money } from './format';

const DEFAULT_MIX: Record<DepositType, number> = { checking: 0.3, savings: 0.25, mmda: 0.25, cd: 0.2 };

export function coreDeposits(b: Bank): number {
  const a = b.acct;
  return a.checking + a.savings + a.mmda + a.cd;
}

// What the market pays on an average dollar of deposits, from Fed funds and
// the typical betas, weighted by the default mix.
export function marketDepositRate(world: World): number {
  const ff = world.economy.fedFunds;
  let r = 0;
  for (const t of DEPOSIT_TYPES) r += DEFAULT_MIX[t] * ff * calibration.depositBeta[t].typical;
  return r;
}

export function bankDepositRate(b: Bank): number {
  const core = coreDeposits(b);
  if (core <= 0) {
    let r = 0;
    for (const t of DEPOSIT_TYPES) r += DEFAULT_MIX[t] * b.rates[t];
    return r;
  }
  let r = 0;
  for (const t of DEPOSIT_TYPES) r += (b.acct[t] / core) * b.rates[t];
  return r;
}

// Target core deposits for a bank in its home county.
export function depositTarget(world: World, b: Bank): number {
  const county = b.homeCounty ? world.geo.counties[b.homeCounty] : undefined;
  if (!county || county.depositPool <= 0) return coreDeposits(b);
  const years = (world.day - b.franchise.openedDay) / 365;
  const ceiling = calibration.deNovoShareCeiling.typical / 100;
  // A franchise ramps from its starting share toward the ceiling over years.
  const ramp = ceiling * (1 - Math.exp(-years / 3));
  const share = Math.max(b.franchise.baseShare, Math.min(1, b.franchise.baseShare + ramp));
  const rateGap = bankDepositRate(b) - marketDepositRate(world);
  const rateFactor = Math.max(0.3, 1 + (calibration.depositRateElasticity.typical / 100) * (rateGap / 0.01));
  const confidenceFactor = Math.pow(Math.max(0, Math.min(1, b.confidence)), 3);
  const fromShare = county.depositPool * share * rateFactor * confidenceFactor;
  // Branch capacity scales with the county's wage level against the nation.
  const wageIndex = Math.max(0.5, Math.min(2, county.wage / 1300));
  const perBranch = calibration.depositsPerBranch.typical * 1e6 * wageIndex * rateFactor;
  const capacity = Math.max(1, b.branches.length) * perBranch * confidenceFactor;
  return Math.round(Math.min(fromShare, capacity));
}

export function depositsDaily(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status !== 'open' && b.status !== 'closing') continue;
    if (!b.homeCounty || !world.geo.counties[b.homeCounty]) continue;
    const current = coreDeposits(b);
    const target = depositTarget(world, b);
    const drift = (target - current) / 60;
    const noise = randNormal(world.rng, 0, Math.max(1000, current * 0.0015));
    let flow = Math.round(drift + noise);
    if (flow < -current) flow = -current;
    if (flow === 0) continue;
    const entry: Partial<Record<DepositType | 'cash', number>> = { cash: flow };
    let assigned = 0;
    const weights = current > 0 ? mixOf(b, current) : DEFAULT_MIX;
    for (const t of DEPOSIT_TYPES) {
      let x = Math.round(flow * weights[t]);
      if (flow < 0 && -x > b.acct[t]) x = -b.acct[t];
      entry[t] = x;
      assigned += x;
    }
    // Rounding remainder goes to checking.
    const rem = flow - assigned;
    if (rem !== 0) entry.checking = (entry.checking ?? 0) + rem;
    if (flow < 0 && -(entry.checking ?? 0) > b.acct.checking) {
      // Cannot draw below zero; shrink the outflow to what exists.
      const short = -(entry.checking ?? 0) - b.acct.checking;
      entry.checking = -b.acct.checking;
      entry.cash = (entry.cash ?? 0) + short;
    }
    post(b.acct, entry);
    if (b.branches.length === 1 && b.branches[0]) b.branches[0].deposits = coreDeposits(b);
    if (Math.abs(flow) > 0.03 * Math.max(current, 1) && current > 0) {
      emit(ctx, 'depositor', `${b.name}: ${flow > 0 ? 'inflow' : 'outflow'} of ${money(Math.abs(flow))} in a day`, {
        severity: flow < 0 ? 'alert' : 'info',
        bankId: b.id,
      });
    }
    coverCash(ctx, b);
  }
}

function mixOf(b: Bank, core: number): Record<DepositType, number> {
  return {
    checking: b.acct.checking / core,
    savings: b.acct.savings / core,
    mmda: b.acct.mmda / core,
    cd: b.acct.cd / core,
  };
}

// Overnight funding: a bank that runs its cash below zero borrows fed funds;
// one with ample cash repays them.
export function coverCash(ctx: Ctx, b: Bank): void {
  const a = b.acct;
  if (a.cash < 0) {
    const need = -a.cash;
    post(a, { cash: need, fedFundsPurchased: need });
    if (need > 0.005 * totalAssets(a)) {
      emit(ctx, 'market', `${b.name} borrowed ${money(need)} overnight to cover outflows`, { severity: 'alert', bankId: b.id });
    }
  } else if (a.fedFundsPurchased > 0) {
    const cushion = Math.round(0.03 * totalAssets(a));
    const repay = Math.min(a.fedFundsPurchased, Math.max(0, a.cash - cushion));
    if (repay > 0) post(a, { cash: -repay, fedFundsPurchased: -repay });
  }
}

// Monthly rate resets: every bank follows Fed funds with its betas. The
// player sets rates by hand on the FUND screen; rivals follow the market.
export function depositRatesMonthly(ctx: Ctx): void {
  const { world } = ctx;
  const ff = world.economy.fedFunds;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status === 'failed' || b.status === 'acquired') continue;
    if (b.id === world.playerBankId) continue;
    for (const t of DEPOSIT_TYPES) {
      const beta = calibration.depositBeta[t].typical;
      b.rates[t] = Math.max(0, Math.round(ff * beta * 10_000) / 10_000);
    }
    b.brokeredRate = ff + 0.002;
    b.fhlbRate = ff + 0.003;
    b.fedFundsRate = ff + 0.001;
    b.loanYield = ff + calibration.loanSpreadOverFedFunds.typical / 10_000;
  }
  const p = world.playerBankId ? world.banks[world.playerBankId] : undefined;
  if (p) {
    p.brokeredRate = ff + 0.002;
    p.fhlbRate = ff + 0.003;
    p.fedFundsRate = ff + 0.001;
  }
}
