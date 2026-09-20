// Business lines (D26, D44; SYSTEMS.md system 11) and fee income for every
// bank. Mortgage banking at $1B: originate, sell, service, MSR. Cards at
// $10B: receivables as a pool, interchange, rewards, ops cost. Wealth at
// $25B: AUM and fees. Investment banking and trading at $100B: fees by
// regime and a trading book with a VaR-lite loss. Each line is a real
// P&L: revenue, cost, and a balance sheet footprint.

import { calibration } from '../data/calibration';
import { addToPool, baseRate } from './credit';
import { type Ctx, emit } from './ctx';
import { post, totalAssets } from './ledger';
import { chance, randNormal } from './rng';
import { type Bank, type LineKey, type World } from './state';
import { money } from './format';

export const LINE_THRESHOLDS: Record<LineKey, number> = { mortgage: 1e9, cards: 10e9, wealth: 25e9, ib: 100e9 };
export const LINE_LABEL: Record<LineKey, string> = { mortgage: 'Mortgage banking', cards: 'Credit cards', wealth: 'Wealth management', ib: 'Investment banking and trading' };
export const LINE_ORDER: LineKey[] = ['mortgage', 'cards', 'wealth', 'ib'];
// One-time setup as a share of the threshold, and the fixed cost to run
// the line each year as a share of the threshold.
const SETUP_SHARE: Record<LineKey, number> = { mortgage: 0.002, cards: 0.0015, wealth: 0.0004, ib: 0.0005 };
const FIXED_SHARE: Record<LineKey, number> = { mortgage: 0.0015, cards: 0.001, wealth: 0.0002, ib: 0.0003 };
const DURBIN_THRESHOLD = 10e9;

export function lineAvailable(b: Bank, key: LineKey): boolean {
  return b.lines[key].on || totalAssets(b.acct) >= LINE_THRESHOLDS[key];
}

export function setupCost(key: LineKey): number {
  return Math.round(LINE_THRESHOLDS[key] * SETUP_SHARE[key]);
}

export function toggleLine(ctx: Ctx, b: Bank, key: LineKey): boolean {
  const { world } = ctx;
  const line = b.lines[key];
  if (line.on) {
    line.on = false;
    emit(ctx, 'system', `${LINE_LABEL[key]} wound down. Its book runs off.`, { bankId: b.id });
    return true;
  }
  if (!lineAvailable(b, key)) return false;
  const cost = setupCost(key);
  if (b.acct.cash < cost) return false;
  post(b.acct, { cash: -cost, retainedEarnings: -cost });
  b.is.month.otherExpense += cost;
  line.on = true;
  line.startedDay = world.day;
  emit(ctx, 'system', `Started ${LINE_LABEL[key].toLowerCase()} for ${money(cost)} of setup`, { severity: 'good', bankId: b.id });
  return true;
}

function revenue(b: Bank, key: LineKey, amount: number, account: 'feeIncome' | 'securitiesGains'): void {
  if (amount === 0) return;
  post(b.acct, { cash: amount, retainedEarnings: amount });
  b.is.month[account] += amount;
  b.lines[key].ytdRevenue += amount;
}

function cost(b: Bank, key: LineKey, amount: number, account: 'salaries' | 'otherExpense'): void {
  if (amount <= 0) return;
  post(b.acct, { cash: -amount, retainedEarnings: -amount });
  b.is.month[account] += amount;
  b.lines[key].ytdCost += amount;
}

// Deposits the bank's branches can reach: the sum of their counties'
// pools, or the franchise pool without geography.
function footprintPool(world: World, b: Bank): number {
  let pool = 0;
  const seen = new Set<string>();
  for (const br of b.branches) {
    if (seen.has(br.county)) continue;
    seen.add(br.county);
    pool += world.geo.counties[br.county]?.depositPool ?? 0;
  }
  if (pool === 0) pool = b.franchise.pool;
  return pool;
}

// Service charges and debit interchange for every bank: real noninterest
// income that every call report shows. Durbin halves debit interchange
// above $10B (D14).
export function feesMonthly(ctx: Ctx, b: Bank): void {
  const a = b.acct;
  const core = a.checking + a.savings + a.mmda + a.cd;
  // Service charges on accounts, debit interchange on checking (halved
  // past the Durbin line), and loan fees: what a community bank earns
  // besides interest before it has a business line.
  const service = Math.round((core * calibration.serviceChargeRate.typical) / 100 / 12);
  const durbin = totalAssets(a) >= DURBIN_THRESHOLD ? 0.5 : 1;
  const debit = Math.round((a.checking * calibration.interchangeRate.typical * durbin) / 100 / 12);
  const loanFees = Math.round((a.loans * calibration.loanFeeRate.typical) / 100 / 12);
  const x = service + debit + loanFees;
  if (x > 0) {
    post(a, { cash: x, retainedEarnings: x });
    b.is.month.feeIncome += x;
  }
  void ctx;
}

export function linesMonthly(ctx: Ctx, b: Bank): void {
  const { world } = ctx;
  const e = world.economy;
  const assets = totalAssets(b.acct);
  for (const key of LINE_ORDER) {
    const line = b.lines[key];
    const fixed = line.on ? Math.round((LINE_THRESHOLDS[key] * FIXED_SHARE[key]) / 12) : 0;
    switch (key) {
      case 'mortgage': {
        // Volume follows the footprint and falls hard when long rates rise.
        if (line.on) {
          const rateFactor = Math.max(0.3, Math.min(3, Math.exp(-8 * (e.curve.y10 - 0.04))));
          const volume = Math.round((footprintPool(world, b) * 0.0025 * rateFactor) / 12);
          const gain = Math.round((volume * calibration.mortgageGainOnSale.typical) / 10_000);
          revenue(b, key, gain, 'feeIncome');
          cost(b, key, Math.round(volume * 0.011) + fixed, 'salaries');
          line.balance += volume; // serviced balance
        }
        // Servicing on the serviced book, which runs off.
        if (line.balance > 0) {
          const fee = Math.round((line.balance * 0.0025) / 12);
          revenue(b, key, fee, 'feeIncome');
          line.balance = Math.round(line.balance * (1 - 0.12 / 12));
          // MSR asset: 1% of the serviced book, lower when rates fall.
          const msrTarget = Math.round(line.balance * 0.01 * Math.max(0.5, Math.min(1.5, 1 + 6 * (e.curve.y10 - 0.04))));
          const msrNow = b.linesAssets?.msr ?? 0;
          const delta = msrTarget - msrNow;
          if (delta !== 0) {
            post(b.acct, { otherAssets: delta, retainedEarnings: delta });
            if (delta > 0) b.is.month.feeIncome += delta;
            else b.is.month.otherExpense += -delta;
            line.ytdRevenue += delta;
            b.linesAssets = { ...(b.linesAssets ?? { msr: 0, trading: 0 }), msr: msrTarget };
          }
        }
        break;
      }
      case 'cards': {
        if (line.on) {
          const target = Math.round(Math.min(assets * 0.06, footprintPool(world, b) * 0.01));
          let receivables = 0;
          for (const p of b.pools) if (p.type === 'cards') receivables += p.balance;
          const grow = Math.max(0, Math.round((target - receivables) / 12));
          const room = Math.max(0, b.acct.cash - Math.round(assets * 0.05));
          const amount = Math.min(grow, room);
          if (amount > 0) {
            // A card book is a blend of prime and subprime accounts that
            // loses 3 to 4 percent a year in normal times, so it enters the
            // pool two grades below a commercial origination.
            addToPool(world, b, 'cards', amount, baseRate(world, 'cards'), Math.max(1, Math.round(amount / 5000)), 4);
            post(b.acct, { loans: amount, cash: -amount });
            b.originationsByType.cards += amount;
          }
          const volume = Math.round((receivables * 8) / 12);
          revenue(b, key, Math.round((volume * calibration.cardInterchange.typical) / 10_000), 'feeIncome');
          cost(b, key, Math.round(volume * 0.012) + Math.round((receivables * 0.03) / 12) + fixed, 'otherExpense');
          line.balance = receivables;
        } else {
          let receivables = 0;
          for (const p of b.pools) if (p.type === 'cards') receivables += p.balance;
          line.balance = receivables;
        }
        break;
      }
      case 'wealth': {
        if (line.on) {
          const target = Math.round(footprintPool(world, b) * 0.05 + assets * 0.15);
          line.balance += Math.round((target - line.balance) * 0.015);
        } else line.balance = Math.round(line.balance * 0.97);
        // Markets move the assets under management.
        const last = e.hist[e.hist.length - 1];
        void last;
        line.balance = Math.max(0, Math.round(line.balance * (1 + 0.6 * ((e.regime === 'recession' ? -0.02 : 0.006) + randNormal(world.rng, 0, 0.02)))));
        if (line.balance > 0) {
          const fee = Math.round((line.balance * calibration.wealthFeeRate.typical) / 10_000 / 12);
          revenue(b, key, fee, 'feeIncome');
          cost(b, key, Math.round(fee * 0.6) + fixed, 'salaries');
        }
        break;
      }
      case 'ib': {
        if (!line.on) break;
        const regime = e.regime === 'expansion' ? 1.2 : e.regime === 'late' ? 1.0 : e.regime === 'recession' ? 0.5 : 0.8;
        const fee = Math.round((assets * calibration.ibFeeToAssets.typical * regime) / 10_000 / 12);
        revenue(b, key, fee, 'feeIncome');
        cost(b, key, Math.round(fee * 0.55) + fixed, 'salaries');
        // Trading: a book of 2% of assets in other assets; a monthly P&L
        // with a fat left tail.
        const bookTarget = Math.round(assets * 0.02);
        const now = b.linesAssets?.trading ?? 0;
        if (bookTarget !== now) {
          post(b.acct, { otherAssets: bookTarget - now, cash: -(bookTarget - now) });
          b.linesAssets = { ...(b.linesAssets ?? { msr: 0, trading: 0 }), trading: bookTarget };
        }
        let pnl = Math.round(randNormal(world.rng, bookTarget * 0.01, bookTarget * 0.03));
        if (chance(world.rng, 1 / 48)) pnl -= Math.round(bookTarget * 0.2);
        revenue(b, key, pnl, 'securitiesGains');
        if (pnl < -bookTarget * 0.1 && b.id === world.playerBankId) emit(ctx, 'market', `Trading desk lost ${money(-pnl)} this month`, { severity: 'alert', bankId: b.id });
        line.balance = bookTarget;
        break;
      }
    }
  }
}

export function linesYearEnd(b: Bank): void {
  for (const key of LINE_ORDER) {
    const l = b.lines[key];
    l.lastYearRevenue = l.ytdRevenue;
    l.lastYearCost = l.ytdCost;
    l.ytdRevenue = 0;
    l.ytdCost = 0;
  }
}
