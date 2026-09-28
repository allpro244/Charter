// Branch purchases (D59). A rival that is pulling back offers one of its
// branches with its deposits. The buyer assumes the deposits, takes the
// cash less a premium on them, and books the premium as goodwill (the
// core deposit intangible). It is the commonest small deal in banking
// and the one a young bank can reach.

import { calibration } from '../data/calibration';
import { type Ctx, addPending, emit, milestone } from './ctx';
import { DEPOSIT_TYPES, type DepositType, post, tier1Capital, totalAssets } from './ledger';
import { PCA_WELL, growthRestricted } from './regulation';
import { chance, derive, hashString } from './rng';
import { type Bank, type CountyState, type Decision, type Pending, type World, branchFixedCost, nextId, playerBank } from './state';
import { branchCase, coreDeposits, km, rivalBranches } from './deposits';
import { money, pct } from './format';

export function branchPremium(deposits: number): number {
  return Math.round((deposits * calibration.branchDepositPremium.typical) / 100);
}

// What is for sale: one of the seller's branch records, or one of the
// offices a seeded rival carries as a count (officesExtra), placed in a
// county near its home when it is sold.
export interface BranchOffer {
  branchId: string | null;
  county: string;
  deposits: number;
  fixedCost: number;
}

export function branchPurchaseCheck(world: World, buyer: Bank, seller: Bank, offer: BranchOffer): { ok: boolean; reason: string | null; premium: number; leverageAfter: number } {
  const premium = branchPremium(offer.deposits);
  const leverageAfter = (tier1Capital(buyer.acct) - premium) / Math.max(1, totalAssets(buyer.acct) + offer.deposits);
  if (offer.deposits <= 0) return { ok: false, reason: 'the branch holds no deposits', premium, leverageAfter };
  if (offer.branchId !== null && !seller.branches.some((x) => x.id === offer.branchId)) return { ok: false, reason: 'the branch is no longer for sale', premium, leverageAfter };
  if (offer.branchId === null && (seller.officesExtra ?? 0) < 1) return { ok: false, reason: 'the office is no longer for sale', premium, leverageAfter };
  if (offer.deposits > coreDeposits(seller)) return { ok: false, reason: 'the seller no longer holds those deposits', premium, leverageAfter };
  const county = world.geo.counties[offer.county];
  if (buyer.branches.some((x) => x.county === offer.county)) return { ok: false, reason: `you already have a branch in ${county ? county.name : offer.county}`, premium, leverageAfter };
  if (growthRestricted(buyer)) return { ok: false, reason: 'the enforcement order freezes the bank at its size', premium, leverageAfter };
  if (leverageAfter < PCA_WELL) return { ok: false, reason: `pro forma leverage ${pct(leverageAfter, 1)} after the goodwill would be below well capitalized`, premium, leverageAfter };
  return { ok: true, reason: null, premium, leverageAfter };
}

// The deposits move by the seller's mix; the cash follows less the premium.
export function buyBranch(ctx: Ctx, buyer: Bank, seller: Bank, offer: BranchOffer): boolean {
  const { world } = ctx;
  const check = branchPurchaseCheck(world, buyer, seller, offer);
  if (!check.ok) {
    emit(ctx, 'system', `No branch purchase: ${check.reason}.`, { severity: 'alert', bankId: buyer.id });
    return false;
  }
  const br = offer.branchId !== null ? seller.branches.find((x) => x.id === offer.branchId) : undefined;
  const d = offer.deposits;
  const p = check.premium;
  const core = Math.max(1, coreDeposits(seller));
  const out: Partial<Record<DepositType | 'cash' | 'retainedEarnings' | 'goodwill', number>> = {};
  const inn: Partial<Record<DepositType | 'cash' | 'retainedEarnings' | 'goodwill', number>> = {};
  let moved = 0;
  DEPOSIT_TYPES.forEach((t, i) => {
    const x = i === DEPOSIT_TYPES.length - 1 ? d - moved : Math.round((d * seller.acct[t]) / core);
    moved += x;
    out[t] = -x;
    inn[t] = x;
  });
  post(seller.acct, { ...out, cash: -(d - p), retainedEarnings: p });
  seller.is.month.feeIncome += p;
  post(buyer.acct, { ...inn, cash: d - p, goodwill: p });
  if (br) seller.branches = seller.branches.filter((x) => x.id !== br.id);
  else seller.officesExtra = Math.max(0, (seller.officesExtra ?? 0) - 1);
  const home = buyer.homeCounty ? world.geo.counties[buyer.homeCounty] : undefined;
  const county = world.geo.counties[offer.county];
  const distanceKm = home && county ? Math.round(km(home.centroid, county.centroid)) : 0;
  buyer.branches.push({ id: nextId(world, 'br'), county: offer.county, openedDay: br ? br.openedDay : seller.franchise.openedDay, deposits: d, fixedCost: offer.fixedCost, distanceKm, competitiveTarget: null });
  const label = county ? county.name : offer.county;
  world.deals.push({ day: world.day, kind: 'branch', buyer: buyer.name, target: `${seller.name}, ${label} branch`, assets: d, price: p, priceToBook: 0, regime: world.economy.regime });
  if (buyer.id === world.playerBankId) {
    milestone(ctx, `Bought the ${label} branch from ${seller.name}: ${money(d)} of deposits`);
    emit(ctx, 'system', `Bought ${seller.name}'s ${label} branch: ${money(d)} of deposits assumed, ${money(d - p)} of cash received, ${money(p)} of premium booked as goodwill. Leverage ${pct(check.leverageAfter, 1)}.`, { severity: 'good', bankId: buyer.id });
  }
  return true;
}

// The seller's offer: its branch record nearest the buyer's home, or, for a
// seeded rival whose other offices are a count, an office placed in the
// largest county pool within 150 km of the seller's home where neither
// bank has a branch, holding an equal share of the seller's deposits.
export function offerFrom(world: World, seller: Bank, buyer: Bank): { offer: BranchOffer; km: number } | null {
  const home = buyer.homeCounty ? world.geo.counties[buyer.homeCounty] : undefined;
  if (!home) return null;
  let best: BranchOffer | null = null;
  let bestKm = Infinity;
  for (const br of seller.branches) {
    if (br.county === seller.homeCounty || br.deposits < 1_000_000) continue;
    if (buyer.branches.some((x) => x.county === br.county)) continue;
    const c = world.geo.counties[br.county];
    if (!c) continue;
    const dist = km(home.centroid, c.centroid);
    if (dist < bestKm) {
      best = { branchId: br.id, county: br.county, deposits: br.deposits, fixedCost: br.fixedCost };
      bestKm = dist;
    }
  }
  if (!best && (seller.officesExtra ?? 0) >= 1 && seller.homeCounty) {
    const sh = world.geo.counties[seller.homeCounty];
    if (sh) {
      // The largest pool within 150 km of the seller's home; in a sparse
      // world (the test fixtures) the nearest county in the state.
      let county: CountyState | undefined;
      let nearest: CountyState | undefined;
      let nearestKm = Infinity;
      for (const c of Object.values(world.geo.counties)) {
        if (c.state !== seller.state || c.fips === seller.homeCounty || c.depositPool <= 0) continue;
        if (seller.branches.some((x) => x.county === c.fips) || buyer.branches.some((x) => x.county === c.fips)) continue;
        const dist = km(sh.centroid, c.centroid);
        if (dist < nearestKm) {
          nearest = c;
          nearestKm = dist;
        }
        if (dist > 150) continue;
        if (!county || c.depositPool > county.depositPool) county = c;
      }
      county ??= nearest;
      if (county) {
        // An office holds an equal share of the seller's deposits, never more
        // than one branch's capacity in that county.
        const wageIndex = Math.max(0.5, Math.min(2, county.wage / 1300));
        const capacity = Math.round(calibration.depositsPerBranch.typical * 1e6 * wageIndex * (world.economy.nominalIndex ?? 1));
        const share = Math.min(capacity, Math.round(coreDeposits(seller) / (seller.branches.length + (seller.officesExtra ?? 0))));
        if (share >= 1_000_000) {
          best = { branchId: null, county: county.fips, deposits: share, fixedCost: branchFixedCost(county) };
          bestKm = km(home.centroid, county.centroid);
        }
      }
    }
  }
  return best ? { offer: best, km: bestKm } : null;
}

// Monthly: a rival that is not pushing its network, with three offices
// or more, offers the one nearest the player's home, when it is within
// the player's reach, no bigger than four tenths of the player's own
// deposits, and the player could buy it today. One offer on the desk at
// a time, none within four months of the last, thirty days to answer,
// and passing is the default.
export function branchOffersMonthly(ctx: Ctx): void {
  const { world } = ctx;
  const player = playerBank(world);
  if (!player || player.status !== 'open' || !player.homeCounty) return;
  if (world.pending.some((p) => p.kind === 'branch_offer')) return;
  if (player.lastBranchOfferDay !== undefined && world.day - player.lastBranchOfferDay < 120) return;
  const home = world.geo.counties[player.homeCounty];
  if (!home) return;
  const myDeposits = coreDeposits(player);
  const reach = calibration.branchReachKm.typical * Math.pow(Math.max(totalAssets(player.acct), 1e7) / 1e8, 0.25);
  for (const id of world.bankOrder) {
    const r = world.banks[id] as Bank;
    if (r.kind !== 'rival' || r.status !== 'open' || !r.ai || r.ai.branchPush >= 0.35) continue;
    if (r.branches.length + (r.officesExtra ?? 0) < 3) continue;
    // A stream of its own, so the offers never move the world's path.
    if (!chance(derive(world.seed, hashString(`offer:${r.id}:${world.day}`)), 0.008)) continue;
    const found = offerFrom(world, r, player);
    if (!found || found.km > 1.2 * reach) continue;
    const offer = found.offer;
    if (offer.deposits > 0.4 * myDeposits || offer.deposits < 3_000_000) continue;
    const county = world.geo.counties[offer.county];
    if (!county) continue;
    const check = branchPurchaseCheck(world, player, r, offer);
    if (!check.ok) continue;
    player.lastBranchOfferDay = world.day;
    const rivals = rivalBranches(world);
    const kase = branchCase(world, player, county, rivals);
    const others = (rivals[county.fips] ?? []).filter((x) => x.br.id !== offer.branchId).length;
    addPending(ctx, {
      kind: 'branch_offer',
      bankId: player.id,
      blocking: false,
      expires: world.day + 30,
      title: `${r.name} offers its ${county.name} branch: ${money(offer.deposits)} of deposits for a ${pct(calibration.branchDepositPremium.typical / 100, 0)} premium`,
      lines: [
        `${r.name} is pulling back and will sell its branch in ${county.name}, ${county.state} (${Math.round(found.km)} km from your home) with its ${money(offer.deposits)} of deposits. ${others > 0 ? `${others} other ${others === 1 ? 'bank has a branch' : 'banks have branches'} there.` : 'No other simulated bank has a branch there.'}`,
        `You would assume the deposits and receive ${money(offer.deposits - check.premium)} of cash; the ${money(check.premium)} premium is booked as goodwill. The branch costs ${money(offer.fixedCost)} a year to run and, once yours, could hold up to ${money(kase.mature)} when mature.`,
        `Pro forma leverage ${pct(check.leverageAfter, 1)}.`,
        'Thirty days to answer; unanswered is a pass.',
      ],
      options: [
        { key: 'b', label: `Buy it for a ${money(check.premium)} premium` },
        { key: 'p', label: 'Pass' },
      ],
      data: { sellerId: r.id, offer },
    });
    return;
  }
}

export function decideBranchOffer(ctx: Ctx, pending: Pending, d: Decision | null): void {
  const { world } = ctx;
  const buyer = pending.bankId ? world.banks[pending.bankId] : undefined;
  const seller = world.banks[pending.data.sellerId as string];
  if (!buyer || !seller) return;
  if (!d || d.choice !== 'b') {
    emit(ctx, 'system', `Passed on ${seller.name}'s branch.`, { bankId: buyer.id });
    return;
  }
  buyBranch(ctx, buyer, seller, pending.data.offer as BranchOffer);
}

// Selling a branch (D69): the other side of D59. A rival nearby with the
// capital and cash for it assumes the branch's deposits and takes its
// premises at book, paying the branch deposit premium; the seller hands
// over cash for the deposits less the premium and the premises, and books
// the premium as a gain. The home branch is never for sale.
export interface BranchSale {
  ok: boolean;
  reason: string | null;
  buyer: Bank | null;
  deposits: number;
  premium: number;
  premises: number;
  cashOut: number; // cash the seller hands over
}

export function branchSaleQuote(world: World, b: Bank, branchId: string): BranchSale {
  const br = b.branches.find((x) => x.id === branchId);
  const none = (reason: string): BranchSale => ({ ok: false, reason, buyer: null, deposits: br?.deposits ?? 0, premium: 0, premises: 0, cashOut: 0 });
  if (!br) return none('no such branch');
  if (br.county === b.homeCounty) return none('the home branch is the bank itself');
  const d = Math.min(br.deposits, coreDeposits(b));
  if (d <= 0) return none('the branch holds no deposits yet; close it instead');
  const premium = branchPremium(d);
  const premises = Math.min(b.acct.premises, br.fixedCost);
  const cashOut = d - premium - premises;
  const county = world.geo.counties[br.county];
  const near = new Set([b.state, ...(world.geo.states[b.state]?.neighbors ?? [])]);
  // The buyer: the largest bank nearby without a branch in the county that
  // stays well capitalized after the goodwill and can fund the premises.
  let buyer: Bank | null = null;
  for (const id of world.bankOrder) {
    const x = world.banks[id] as Bank;
    if (x.id === b.id || x.kind !== 'rival' || x.status !== 'open' || !near.has(x.state)) continue;
    if (x.branches.some((q) => q.county === br.county) || growthRestricted(x)) continue;
    if ((tier1Capital(x.acct) - premium) / Math.max(1, totalAssets(x.acct) + d) < PCA_WELL) continue;
    if (x.acct.cash + d - premium < premises) continue;
    if (!buyer || totalAssets(x.acct) > totalAssets(buyer.acct)) buyer = x;
  }
  if (!buyer) return { ...none(`no bank near ${county ? county.name : br.county} can take it today`), deposits: d, premium, premises, cashOut };
  if (b.acct.cash < cashOut) return { ok: false, reason: `the buyer takes ${money(d)} of deposits and the bank must hand over ${money(cashOut)} of cash with them; it has ${money(b.acct.cash)} (sell bonds or draw on the Home Loan Bank first)`, buyer, deposits: d, premium, premises, cashOut };
  return { ok: true, reason: null, buyer, deposits: d, premium, premises, cashOut };
}

export function sellBranch(ctx: Ctx, branchId: string): boolean {
  const { world } = ctx;
  const b = playerBank(world);
  if (!b) return false;
  const q = branchSaleQuote(world, b, branchId);
  const br = b.branches.find((x) => x.id === branchId);
  const county = br ? world.geo.counties[br.county] : undefined;
  const label = county ? `${county.name}, ${county.state}` : (br?.county ?? '');
  if (!q.ok || !q.buyer || !br) {
    emit(ctx, 'system', `The ${label} branch did not sell: ${q.reason}.`, { severity: 'alert', bankId: b.id });
    return false;
  }
  const buyer = q.buyer;
  const core = Math.max(1, coreDeposits(b));
  const out: Partial<Record<DepositType | 'cash' | 'retainedEarnings' | 'goodwill' | 'premises', number>> = {};
  const inn: Partial<Record<DepositType | 'cash' | 'retainedEarnings' | 'goodwill' | 'premises', number>> = {};
  let moved = 0;
  DEPOSIT_TYPES.forEach((t, i) => {
    const x = i === DEPOSIT_TYPES.length - 1 ? q.deposits - moved : Math.round((q.deposits * b.acct[t]) / core);
    moved += x;
    out[t] = -x;
    inn[t] = x;
  });
  post(b.acct, { ...out, premises: -q.premises, cash: -q.cashOut, retainedEarnings: q.premium });
  b.is.month.feeIncome += q.premium;
  post(buyer.acct, { ...inn, premises: q.premises, cash: q.cashOut, goodwill: q.premium });
  b.branches = b.branches.filter((x) => x.id !== br.id);
  const buyerHome = buyer.homeCounty ? world.geo.counties[buyer.homeCounty] : undefined;
  const distanceKm = buyerHome && county ? Math.round(km(buyerHome.centroid, county.centroid)) : 0;
  buyer.branches.push({ id: nextId(world, 'br'), county: br.county, openedDay: br.openedDay, deposits: q.deposits, fixedCost: br.fixedCost, distanceKm, competitiveTarget: null });
  world.deals.push({ day: world.day, kind: 'branch', buyer: buyer.name, target: `${b.name}, ${label} branch`, assets: q.deposits, price: q.premium, priceToBook: 0, regime: world.economy.regime });
  milestone(ctx, `Sold the ${label} branch to ${buyer.name}: ${money(q.deposits)} of deposits for a ${money(q.premium)} premium`);
  emit(ctx, 'system', `Sold the ${label} branch to ${buyer.name}: ${money(q.deposits)} of deposits and the premises went with it, ${money(q.cashOut)} of cash handed over, ${money(q.premium)} of premium booked as a gain, and ${money(br.fixedCost)} a year of running cost gone.`, { severity: 'good', bankId: b.id });
  return true;
}
