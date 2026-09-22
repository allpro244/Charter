// Capital markets (SYSTEMS.md system 10; D7, D19, D21). Private raises
// with passive investors, the holding company, IPO at the size floor, a
// stock price from earnings, growth, credit, capital and regime,
// buybacks, secondaries, player share sales, subordinated debt.
// Invariants: shares x price = market cap; ownership sums to 100%.

import { calibration } from '../data/calibration';
import { type Ctx, addPending, emit, milestone } from './ctx';
import { randomPolicy } from './rivals';
import { leverageRatio, post, tier1Capital, totalAssets, totalEquity } from './ledger';
import { PCA_WELL } from './regulation';
import { randNormal } from './rng';
import { type Bank, type World, bookValuePerShare, playerBank } from './state';
import { money, pct } from './format';

export const IPO_FLOOR = 1_000_000_000;
const HOLDCO_COST = 250_000;
const IPO_DISCOUNT = 0.9;
const IPO_FEE = 0.06;
const SECONDARY_DISCOUNT = 0.95;

export function trailingNetIncome(b: Bank): number {
  const n = Math.min(4, b.reports.length);
  if (n === 0) return 0;
  let x = 0;
  for (let i = b.reports.length - n; i < b.reports.length; i++) x += (b.reports[i]?.netIncome ?? 0) * (4 / n);
  return x;
}

export function tangibleEquity(b: Bank): number {
  return totalEquity(b.acct) - b.acct.goodwill;
}

export function nonaccrualShare(b: Bank): number {
  if (b.acct.loans <= 0) return 0;
  let na = 0;
  for (const p of b.pools) na += (p.grades[6] ?? 0) + (p.grades[7] ?? 0) + (p.grades[8] ?? 0);
  for (const l of b.loans) if (l.status === 'nonaccrual' || l.status === 'workout') na += l.balance;
  return na / b.acct.loans;
}

// Price to tangible book: the cycle's base, then the spread of return on
// equity over the cost of equity, growth, credit, and capital.
export function priceToBook(world: World, b: Bank): number {
  const e = world.economy;
  const band = e.regime === 'recession' ? calibration.bankPriceToBook.recession : calibration.bankPriceToBook.expansion;
  let pb = band.typical / 100;
  if (e.regime === 'recovery' || e.regime === 'late') pb = (calibration.bankPriceToBook.expansion.typical / 100 + calibration.bankPriceToBook.recession.typical / 100) / 2 + (e.regime === 'late' ? 0.15 : 0);
  const te = Math.max(1, tangibleEquity(b));
  const roe = trailingNetIncome(b) / te;
  const coe = calibration.costOfEquity.typical / 100;
  pb += 6 * (roe - coe);
  const ago = b.reports.length >= 5 ? b.reports[b.reports.length - 5] : undefined;
  const growth = ago && ago.assets > 0 ? totalAssets(b.acct) / ago.assets - 1 : 0;
  pb += 1.5 * Math.max(-0.3, Math.min(0.5, growth));
  pb -= 5 * Math.max(0, nonaccrualShare(b) - 0.02);
  pb -= 4 * Math.max(0, 0.06 - leverageRatio(b.acct));
  return Math.max(0.3, Math.min(3.5, pb));
}

export function tangibleBookPerShare(b: Bank): number {
  return b.shares > 0 ? tangibleEquity(b) / b.shares : 0;
}

// Fair value per share: price to tangible book, but never below what the
// earnings support or a fifth of total book. A bank whose tangible book
// is thin from goodwill still trades on its earnings.
export function fairPrice(world: World, b: Bank): number {
  const onBook = priceToBook(world, b) * tangibleBookPerShare(b);
  const eps = b.shares > 0 ? trailingNetIncome(b) / b.shares : 0;
  const onEarnings = eps > 0 ? 10 * eps : 0;
  const floor = 0.2 * bookValuePerShare(b);
  return Math.max(0.01, onBook, onEarnings, floor);
}

export function marketCap(b: Bank): number {
  return b.isPublic && b.price !== null ? Math.round(b.shares * b.price) : 0;
}

// Monthly: public banks drift toward fair value with market noise and a
// beta to the index.
export function stockMonthly(ctx: Ctx): void {
  const { world } = ctx;
  const e = world.economy;
  const last = e.hist[e.hist.length - 1];
  const spRet = 0; // the index move is inside the noise below; sp500 has no history yet
  void last;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (!b.isPublic || b.status !== 'open') continue;
    const target = fairPrice(world, b);
    const prev = b.price ?? target;
    let p = prev + 0.4 * (target - prev);
    p *= Math.exp(randNormal(world.rng, 0, 0.04) + spRet);
    b.price = Math.max(0.01, Math.round(p * 100) / 100);
    b.priceHistory.push({ day: world.day, price: b.price });
    if (b.priceHistory.length > 600) b.priceHistory.shift();
    if (b.id === world.playerBankId && Math.abs(b.price / prev - 1) > 0.08) {
      emit(ctx, 'market', `${b.name} stock ${b.price > prev ? 'up' : 'down'} ${pct(Math.abs(b.price / prev - 1), 0)} to ${b.price.toFixed(2)}, ${priceToBook(world, b).toFixed(2)}x book`, { severity: b.price > prev ? 'good' : 'alert', bankId: b.id });
    }
  }
}

export function ownership(world: World, b: Bank): { player: number; outside: number } {
  const p = world.playerBankId === b.id ? world.player.shares / Math.max(1, b.shares) : 0;
  return { player: p, outside: 1 - p };
}

export function formHoldingCompany(ctx: Ctx, b: Bank): boolean {
  if (b.holdingCompany || b.acct.cash < HOLDCO_COST) return false;
  post(b.acct, { cash: -HOLDCO_COST, retainedEarnings: -HOLDCO_COST });
  b.is.month.otherExpense += HOLDCO_COST;
  b.holdingCompany = true;
  emit(ctx, 'system', `Formed a bank holding company for ${b.name} (${money(HOLDCO_COST)} of legal cost). Stock deals, an IPO, and subordinated debt are now possible.`, { severity: 'good', bankId: b.id });
  return true;
}

// The price a private raise would set today (D61), so the desk can show
// where a raise would leave the CEO's stake before it happens.
export function raiseTerms(world: World, b: Bank, amount: number): { price: number; discount: number } | null {
  const maxRound = Math.max(1_000_000, Math.round(totalEquity(b.acct) * 0.75));
  if (amount <= 0 || amount > maxRound) return null;
  const book = bookValuePerShare(b);
  if (book <= 0) return null;
  let discount = Math.min(1.2, Math.max(0.55, 0.85 * priceToBook(world, b)));
  if (leverageRatio(b.acct) < PCA_WELL) discount *= 0.8;
  return { price: Math.max(0.01, book * discount), discount };
}

// Where a raise leaves the CEO's stake.
export function stakeAfterRaise(world: World, b: Bank, amount: number, playerPortion: number): number | null {
  const t = raiseTerms(world, b, amount);
  if (!t) return null;
  const own = Math.round(Math.max(0, Math.min(amount, playerPortion)) / t.price);
  const issued = Math.max(1, Math.round(amount / t.price));
  return (world.player.shares + own) / Math.max(1, b.shares + issued);
}

// Control (D61). With half the shares the CEO is the owner; below it the
// CEO serves at the board's pleasure, like nearly every real bank CEO.
export function controlWord(share: number): 'owner' | 'pleasure' {
  return share >= 0.5 ? 'owner' : 'pleasure';
}

// Quarterly: a board the CEO does not control replaces a CEO who has lost
// money for two years running, once the bank is past its third year (a
// de novo's early losses are the plan). It says it is restless a year in.
export function boardQuarterly(ctx: Ctx): void {
  const { world } = ctx;
  const b = playerBank(world);
  if (!b || b.status !== 'open') return;
  const share = ownership(world, b).player;
  if (share >= 0.5) return;
  if (world.day - b.charteredDay < 3 * 365) return;
  const reports = b.reports;
  let losing = 0;
  for (let i = reports.length - 1; i >= 0 && reports[i]!.netIncome < 0; i--) losing++;
  if (losing >= 4 && losing < 8 && (b.boardWarnedDay === undefined || world.day - b.boardWarnedDay >= 360)) {
    b.boardWarnedDay = world.day;
    emit(ctx, 'system', `The board is restless: ${losing} losing quarters and you hold ${pct(share, 0)} of the shares. Two years of losses and it will replace you.`, { severity: 'alert', bankId: b.id });
  }
  if (losing >= 8) removeCeo(ctx, b, `${losing} quarters of losses`);
}

function removeCeo(ctx: Ctx, b: Bank, why: string): void {
  const { world } = ctx;
  const p = world.player;
  // The CEO's shares are sold on the way out at the private sale price.
  const price = bookValuePerShare(b) * 0.8;
  const gross = Math.round(p.shares * Math.max(0, price));
  const net = Math.round(gross * (1 - p.taxRate));
  p.cash += net;
  p.stockSaleProceeds += net;
  p.shares = 0;
  p.bankId = null;
  world.playerBankId = null;
  const rec = p.record.find((x) => x.bankId === b.id);
  if (rec) {
    rec.to = world.day;
    rec.outcome = 'removed';
  }
  b.kind = 'rival';
  b.ai = randomPolicy(world.rng);
  milestone(ctx, `The board of ${b.name} replaced you after ${why}`);
  emit(ctx, 'system', `The board of ${b.name} replaced you as chief executive after ${why}. Your shares were sold at ${price.toFixed(2)}: ${money(net)} after tax.`, { severity: 'alert', bankId: b.id });
  addPending(ctx, {
    kind: 'failure',
    bankId: b.id,
    title: `The board of ${b.name} has replaced you`,
    lines: [`After ${why} with you holding under half the shares, the board named a new chief executive. The bank goes on without you.`, `Your shares were sold at ${price.toFixed(2)} a share, ${money(net)} after tax. You have ${money(p.cash)}.`, 'A CEO who keeps half the shares cannot be removed; a raise that takes you under half hands the board that power.'],
    options: [{ key: 'k', label: 'Acknowledge' }],
    data: {},
  });
}

// Private placement to passive investors at a discount to book that
// widens when the bank is weak or the cycle is bad. The player may take
// part of the round with personal cash. Everyone else is diluted.
export function raiseCapital(ctx: Ctx, b: Bank, amount: number, playerPortion: number): { shares: number; price: number } | null {
  const { world } = ctx;
  amount = Math.round(amount);
  playerPortion = Math.max(0, Math.min(amount, Math.round(playerPortion)));
  if (amount <= 0) return null;
  const isPlayer = world.playerBankId === b.id;
  if (isPlayer && playerPortion > world.player.cash) return null;
  const terms = raiseTerms(world, b, amount);
  if (!terms) return null;
  const { price, discount } = terms;
  const shares = Math.max(1, Math.round(amount / price));
  post(b.acct, { cash: amount, commonStock: amount });
  b.shares += shares;
  if (isPlayer) {
    const own = Math.round(playerPortion / price);
    world.player.shares += own;
    world.player.cash -= playerPortion;
    world.player.invested += playerPortion;
  }
  emit(ctx, 'system', `${b.name} raised ${money(amount)} of capital at ${price.toFixed(2)} a share (${(discount * 100).toFixed(0)}% of book). ${isPlayer ? `You put in ${money(playerPortion)}; your stake is now ${pct(ownership(world, b).player, 1)}.` : ''}`, {
    severity: 'good',
    bankId: b.id,
  });
  if (isPlayer) milestone(ctx, `Raised ${money(amount)} for ${b.name}`);
  return { shares, price };
}

export function canIpo(b: Bank): { ok: boolean; why: string } {
  if (b.isPublic) return { ok: false, why: 'already public' };
  if (!b.holdingCompany) return { ok: false, why: 'needs a holding company' };
  if (totalAssets(b.acct) < IPO_FLOOR) return { ok: false, why: `needs ${money(IPO_FLOOR)} of assets` };
  if (leverageRatio(b.acct) < PCA_WELL) return { ok: false, why: 'must be well capitalized' };
  return { ok: true, why: '' };
}

// IPO: primary shares raise capital for the bank; the player may sell
// secondary shares. Priced at a discount to fair value, less the
// underwriting fee.
export function ipo(ctx: Ctx, b: Bank, primary: number, playerSharesSold: number): boolean {
  const { world } = ctx;
  if (!canIpo(b).ok) return false;
  const price = Math.max(0.01, Math.round(fairPrice(world, b) * IPO_DISCOUNT * 100) / 100);
  primary = Math.max(0, Math.round(primary));
  const newShares = Math.round(primary / price);
  const fee = Math.round(primary * IPO_FEE);
  if (primary > 0) {
    post(b.acct, { cash: primary - fee, commonStock: primary - fee });
    b.shares += newShares;
  }
  b.isPublic = true;
  b.price = price;
  b.marketCapAtIpo = Math.round(b.shares * price);
  b.priceHistory.push({ day: world.day, price });
  if (world.playerBankId === b.id) {
    const p = world.player;
    const n = Math.max(0, Math.min(p.shares, Math.round(playerSharesSold)));
    if (n > 0) {
      const gross = Math.round(n * price * (1 - IPO_FEE));
      const net = Math.round(gross * (1 - p.taxRate));
      p.shares -= n;
      p.cash += net;
      p.stockSaleProceeds += net;
    }
    milestone(ctx, `${b.name} went public at ${price.toFixed(2)}, market cap ${money(b.marketCapAtIpo)}`);
  }
  emit(ctx, 'market', `${b.name} priced its IPO at ${price.toFixed(2)} a share: ${money(primary)} raised, market cap ${money(b.marketCapAtIpo)}, ${priceToBook(world, b).toFixed(2)}x book`, { severity: 'good', bankId: b.id });
  return true;
}

export function buyback(ctx: Ctx, b: Bank, amount: number): number {
  const { world } = ctx;
  if (!b.isPublic || b.price === null) return 0;
  amount = Math.min(Math.round(amount), Math.max(0, b.acct.cash));
  if (amount <= 0) return 0;
  const after = (tier1Capital(b.acct) - amount) / Math.max(1, totalAssets(b.acct) - b.acct.goodwill - amount);
  if (after < PCA_WELL) return 0;
  // At most a twentieth of the shares in one program, and never the
  // shares the player holds.
  const held = world.playerBankId === b.id ? world.player.shares : 0;
  const n = Math.min(Math.round(b.shares * 0.05), b.shares - held - 1, Math.round(amount / b.price));
  if (n <= 0) return 0;
  amount = Math.round(n * b.price);
  const fromStock = Math.min(b.acct.commonStock, amount);
  post(b.acct, { cash: -amount, commonStock: -fromStock, retainedEarnings: -(amount - fromStock) });
  b.shares -= n;
  emit(ctx, 'system', `${b.name} bought back ${money(amount)} of stock (${n.toLocaleString()} shares at ${b.price.toFixed(2)})`, { bankId: b.id });
  return n;
}

export function secondary(ctx: Ctx, b: Bank, amount: number): number {
  if (!b.isPublic || b.price === null) return 0;
  // No more than a fifth of the market cap in one offering.
  amount = Math.min(Math.round(amount), Math.round(marketCap(b) * 0.2));
  if (amount <= 0) return 0;
  const price = b.price * SECONDARY_DISCOUNT;
  const n = Math.round(amount / price);
  post(b.acct, { cash: amount, commonStock: amount });
  b.shares += n;
  emit(ctx, 'system', `${b.name} sold ${n.toLocaleString()} new shares at ${price.toFixed(2)} for ${money(amount)}`, { bankId: b.id });
  return n;
}

// The player sells shares: at market less impact when public, at a deep
// discount to book to passive investors when private.
export function sellPlayerShares(ctx: Ctx, n: number): number {
  const { world } = ctx;
  const b = playerBank(world);
  const p = world.player;
  if (!b) return 0;
  n = Math.max(0, Math.min(p.shares, Math.round(n)));
  if (n <= 0) return 0;
  let price: number;
  if (b.isPublic && b.price !== null) {
    const impact = Math.min(0.3, 0.5 * (n / Math.max(1, b.shares)));
    price = b.price * (1 - impact);
  } else {
    const cap = Math.round(p.shares * 0.1);
    n = Math.min(n, Math.max(1, cap));
    price = bookValuePerShare(b) * 0.8;
  }
  const gross = Math.round(n * price);
  const net = Math.round(gross * (1 - p.taxRate));
  p.shares -= n;
  p.cash += net;
  p.stockSaleProceeds += net;
  emit(ctx, 'system', `You sold ${n.toLocaleString()} shares of ${b.name} at ${price.toFixed(2)}: ${money(gross)}, ${money(net)} after tax. Stake now ${pct(ownership(world, b).player, 1)}.`, { bankId: b.id });
  return net;
}

export function issueSubDebt(ctx: Ctx, b: Bank, amount: number): number {
  const { world } = ctx;
  if (!b.holdingCompany) return 0;
  amount = Math.round(amount);
  const cap = Math.round(tier1Capital(b.acct) * 0.5) - b.acct.subDebt;
  amount = Math.min(amount, Math.max(0, cap));
  if (amount <= 0) return 0;
  b.subDebtRate = world.economy.fedFunds + 0.03;
  post(b.acct, { cash: amount, subDebt: amount });
  emit(ctx, 'system', `${b.name} issued ${money(amount)} of subordinated debt at ${pct(b.subDebtRate)}`, { bankId: b.id });
  return amount;
}
