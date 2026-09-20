// Funding beyond core deposits (SYSTEMS.md system 4): securities as a
// treasury function (D16), FHLB advances, brokered deposits, fed funds.
// Securities are lots with a coupon and a duration; AFS marks to fair
// value through AOCI, HTM stays at cost with fair value tracked off ledger.

import { type Ctx, emit } from './ctx';
import { post, tier1Capital, totalAssets, totalDeposits } from './ledger';
import { officer } from './officers';
import { PCA_WELL, leverageOf } from './regulation';
import { type Bank, type Lot, type LotKind, type Product, type World, nextId } from './state';
import { money, pct } from './format';

export const PRODUCT_SPREAD: Record<Product, number> = { treasury: 0, agency: 0.002, mbs: 0.006 };
export const PRODUCT_LABEL: Record<Product, string> = { treasury: 'Treasury', agency: 'Agency', mbs: 'Agency MBS' };

// Par yield for a duration from the curve, linear between the points.
export function marketYield(world: World, duration: number): number {
  const c = world.economy.curve;
  const pts: [number, number][] = [
    [0.25, c.m3],
    [2, c.y2],
    [10, c.y10],
    [30, c.y30],
  ];
  if (duration <= 0.25) return c.m3;
  for (let i = 1; i < pts.length; i++) {
    const [d0, y0] = pts[i - 1] as [number, number];
    const [d1, y1] = pts[i] as [number, number];
    if (duration <= d1) return y0 + ((y1 - y0) * (duration - d0)) / (d1 - d0);
  }
  return c.y30;
}

// Price of a lot as a fraction of cost: duration times the yield gap.
export function fairFraction(world: World, lot: Lot): number {
  const y = marketYield(world, lot.duration) + PRODUCT_SPREAD[lot.product];
  const f = 1 - lot.duration * (y - lot.coupon);
  return Math.max(0.4, Math.min(1.3, f));
}

// Execution cost from the CFO: a weak CFO pays more of the bid-ask.
export function executionCost(b: Bank): number {
  const cfo = officer(b, 'cfo');
  const skill = cfo?.skill ?? 35;
  return 0.0015 * (1 - skill / 100);
}

// Banks are created with one AFS lot and one HTM lot from their lumps.
export function seedLots(world: World, b: Bank): void {
  const a = b.acct;
  if (a.securitiesAFS > 0) {
    const dur = 3;
    b.lots.push({ id: nextId(world, 's'), kind: 'afs', product: 'agency', cost: a.securitiesAFS, coupon: marketYield(world, dur) + PRODUCT_SPREAD.agency, duration: dur, purchasedDay: world.day, fair: a.securitiesAFS });
  }
  if (a.securitiesHTM > 0) {
    const dur = 6;
    b.lots.push({ id: nextId(world, 's'), kind: 'htm', product: 'mbs', cost: a.securitiesHTM, coupon: marketYield(world, dur) + PRODUCT_SPREAD.mbs, duration: dur, purchasedDay: world.day, fair: a.securitiesHTM });
  }
  refreshYields(b);
  b.htmFairValue = a.securitiesHTM;
}

export function refreshYields(b: Bank): void {
  let afsCost = 0;
  let afsSum = 0;
  let htmCost = 0;
  let htmSum = 0;
  let afsDur = 0;
  let htmDur = 0;
  for (const l of b.lots) {
    if (l.kind === 'afs') {
      afsCost += l.cost;
      afsSum += l.cost * l.coupon;
      afsDur += l.cost * l.duration;
    } else {
      htmCost += l.cost;
      htmSum += l.cost * l.coupon;
      htmDur += l.cost * l.duration;
    }
  }
  b.afsYield = afsCost > 0 ? afsSum / afsCost : 0;
  b.htmYield = htmCost > 0 ? htmSum / htmCost : 0;
  b.afsDuration = afsCost > 0 ? afsDur / afsCost : 0;
  b.htmDuration = htmCost > 0 ? htmDur / htmCost : 0;
}

// Monthly mark. AFS fair value less cost is the valuation account, offset
// in AOCI. HTM fair value is tracked for the unrealized loss memo.
export function markSecurities(world: World, b: Bank): void {
  const a = b.acct;
  let afsFair = 0;
  let afsCost = 0;
  let htmFair = 0;
  for (const l of b.lots) {
    l.fair = Math.round(l.cost * fairFraction(world, l));
    if (l.kind === 'afs') {
      afsFair += l.fair;
      afsCost += l.cost;
    } else htmFair += l.fair;
  }
  const target = afsFair - afsCost;
  const delta = target - a.afsValuation;
  if (delta !== 0) post(a, { afsValuation: delta, aoci: delta });
  b.htmFairValue = htmFair;
  // Lots amortize: duration shortens a little each month, and MBS pay down.
  for (const l of b.lots) {
    l.duration = Math.max(0.25, l.duration - 1 / 12);
  }
  refreshYields(b);
}

// Securities that matured or paid down return cash at par. Simple: each
// lot returns cost / (duration years remaining x 12) monthly.
export function securitiesRunoff(world: World, b: Bank): void {
  const a = b.acct;
  let afs = 0;
  let htm = 0;
  const survivors: Lot[] = [];
  for (const l of b.lots) {
    const months = Math.max(1, Math.round(l.duration * 12 * 1.6));
    let pay = Math.round(l.cost / months);
    if (pay >= l.cost || l.duration <= 0.3) pay = l.cost;
    l.cost -= pay;
    l.fair = Math.round(l.cost * fairFraction(world, l));
    if (l.kind === 'afs') afs += pay;
    else htm += pay;
    if (l.cost > 0) survivors.push(l);
  }
  b.lots = survivors;
  if (afs > 0) post(a, { cash: afs, securitiesAFS: -afs });
  if (htm > 0) post(a, { cash: htm, securitiesHTM: -htm });
}

export function buySecurities(ctx: Ctx, b: Bank, kind: LotKind, product: Product, amount: number, duration: number, quiet = false): Lot | null {
  const { world } = ctx;
  const a = b.acct;
  amount = Math.round(amount);
  if (amount <= 0 || amount > a.cash) return null;
  const coupon = marketYield(world, duration) + PRODUCT_SPREAD[product];
  const cost = executionCost(b);
  const fee = Math.round(amount * cost);
  const lot: Lot = { id: nextId(world, 's'), kind, product, cost: amount, coupon, duration, purchasedDay: world.day, fair: amount };
  post(a, kind === 'afs' ? { cash: -amount, securitiesAFS: amount } : { cash: -amount, securitiesHTM: amount });
  if (fee > 0) {
    post(a, { cash: -fee, retainedEarnings: -fee });
    b.is.month.otherExpense += fee;
  }
  b.lots.push(lot);
  refreshYields(b);
  if (!quiet) emit(ctx, 'system', `Bought ${money(amount)} of ${duration} year ${PRODUCT_LABEL[product]} at ${pct(coupon)}, ${kind.toUpperCase()}`, { bankId: b.id });
  return lot;
}

// Sells all or part of an AFS lot at fair value. The gain or loss moves
// from AOCI to earnings. HTM cannot be sold (it taints the portfolio).
export function sellSecurities(ctx: Ctx, b: Bank, lotId: string, amount: number, quiet = false): number {
  const { world } = ctx;
  const a = b.acct;
  const lot = b.lots.find((l) => l.id === lotId);
  if (!lot || lot.kind !== 'afs') return 0;
  amount = Math.min(lot.cost, Math.round(amount));
  if (amount <= 0) return 0;
  const fraction = fairFraction(world, lot);
  const fee = Math.round(amount * executionCost(b));
  const proceeds = Math.round(amount * fraction) - fee;
  const gain = proceeds - amount;
  // The lot's recorded mark reverses out of the valuation account and AOCI
  // exactly: what stays is the rounded remainder for the cost that stays.
  const unrealized = lot.fair - lot.cost;
  const remainingCost = lot.cost - amount;
  const remainingUnrealized = remainingCost > 0 ? Math.round((unrealized * remainingCost) / lot.cost) : 0;
  const share = unrealized - remainingUnrealized;
  post(a, { cash: proceeds, securitiesAFS: -amount, afsValuation: -share, aoci: -share, retainedEarnings: gain });
  b.is.month.securitiesGains += gain;
  lot.cost = remainingCost;
  lot.fair = remainingCost + remainingUnrealized;
  if (lot.cost <= 0) b.lots = b.lots.filter((l) => l.id !== lotId);
  refreshYields(b);
  // Another bank's forced sales are its own business; the player's show.
  if (!quiet || b.id === world.playerBankId) emit(ctx, 'system', `Sold ${money(amount)} of ${PRODUCT_LABEL[lot.product]} for ${money(proceeds)}, ${gain >= 0 ? 'gain' : 'loss'} ${money(Math.abs(gain))}`, { severity: gain < 0 ? 'alert' : 'info', bankId: b.id });
  return proceeds;
}

// FHLB lends against mortgages, CRE, and agencies. Capacity is what those
// support less advances outstanding.
export function fhlbCapacity(b: Bank): number {
  let eligible = 0;
  for (const p of b.pools) if (p.type === 'resi' || p.type === 'cre_oo' || p.type === 'cre_inv') eligible += p.balance;
  for (const l of b.loans) if ((l.type === 'resi' || l.type === 'cre_oo' || l.type === 'cre_inv') && l.status === 'current') eligible += l.balance;
  const securities = b.acct.securitiesAFS + b.acct.securitiesHTM;
  return Math.max(0, Math.round(0.6 * eligible + 0.9 * securities - b.acct.fhlb));
}

export function borrowFhlb(ctx: Ctx, b: Bank, amount: number, quiet = false): number {
  amount = Math.min(Math.round(amount), fhlbCapacity(b));
  if (amount <= 0) return 0;
  post(b.acct, { cash: amount, fhlb: amount });
  // Automatic draws to cover withdrawals show for the player's bank only,
  // and only when they are large.
  if (!quiet || (b.id === ctx.world.playerBankId && amount > 0.01 * totalAssets(b.acct))) emit(ctx, 'system', `Drew ${money(amount)} of FHLB advances at ${pct(b.fhlbRate)}`, { bankId: b.id });
  return amount;
}

export function repayFhlb(ctx: Ctx, b: Bank, amount: number): number {
  amount = Math.min(Math.round(amount), b.acct.fhlb, b.acct.cash);
  if (amount <= 0) return 0;
  post(b.acct, { cash: -amount, fhlb: -amount });
  emit(ctx, 'system', `Repaid ${money(amount)} of FHLB advances`, { bankId: b.id });
  return amount;
}

// Brokered deposits: rate-sensitive money at fed funds plus a spread. A
// bank that is not well capitalized may not accept them (12 CFR 337.6).
export function canRaiseBrokered(b: Bank): boolean {
  return leverageOf(b) >= PCA_WELL && b.enforcement !== 'consent' && b.enforcement !== 'pca';
}

export function raiseBrokered(ctx: Ctx, b: Bank, amount: number): number {
  const { world } = ctx;
  amount = Math.round(amount);
  if (amount <= 0 || !canRaiseBrokered(b)) return 0;
  const cfo = officer(b, 'cfo');
  const spread = 0.002 + 0.002 * (1 - (cfo?.skill ?? 35) / 100);
  b.brokeredRate = world.economy.fedFunds + spread;
  post(b.acct, { cash: amount, brokered: amount });
  emit(ctx, 'system', `Raised ${money(amount)} of brokered deposits at ${pct(b.brokeredRate)}`, { bankId: b.id });
  return amount;
}

export function repayBrokered(ctx: Ctx, b: Bank, amount: number): number {
  amount = Math.min(Math.round(amount), b.acct.brokered, b.acct.cash);
  if (amount <= 0) return 0;
  post(b.acct, { cash: -amount, brokered: -amount });
  emit(ctx, 'system', `Ran off ${money(amount)} of brokered deposits`, { bankId: b.id });
  return amount;
}

export function unrealizedLoss(b: Bank): number {
  return -b.acct.afsValuation + (b.acct.securitiesHTM - b.htmFairValue);
}

// Unrealized loss against tier 1 capital: the 2023 measure of trouble.
export function unrealizedToCapital(b: Bank): number {
  const t1 = tier1Capital(b.acct);
  return t1 > 0 ? unrealizedLoss(b) / t1 : 1;
}

export function liquidity(b: Bank): { cash: number; cashToAssets: number; fhlbAvailable: number; uninsured: number } {
  const a = b.acct;
  const assets = totalAssets(a);
  return { cash: a.cash, cashToAssets: assets > 0 ? a.cash / assets : 0, fhlbAvailable: fhlbCapacity(b), uninsured: Math.round(totalDeposits(a) * b.uninsuredShare) };
}
