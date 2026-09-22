// M&A (SYSTEMS.md system 11; D28, D31, D42). FDIC assisted auctions with
// loss share over a weekend, whole bank deals with due diligence,
// purchase accounting, integration cost, deposit attrition and approval
// time, rival competing bids, rival consolidation, and the player's own
// failure resolved by a purchase and assumption.

import { decideWorkout } from './loans';
import { calibration } from '../data/calibration';
import { fairPrice, ownership, priceToBook, tangibleEquity } from './capital';
import { TYPE, absorbPool, consolidatePools, lgdNow, PD_BY_GRADE, stressFor } from './credit';
import { type Ctx, addPending, emit, milestone } from './ctx';
import { type Account, type Accounts, leverageRatio, post, totalAssets, totalDeposits } from './ledger';
import { GRADES } from './loantypes';
import { PCA_WELL } from './regulation';
import { marketYield } from './funding';
import { expandState } from './rivals';
import { type ForeignCandidate, closeForeign } from './global';
import { chance, rand, randNormal } from './rng';
import { type Bank, type Decision, type Lot, type LotKind, type Pending, type Pool, type World, nextId, playerBank } from './state';
import { formatDate } from './time';
import { money, pct } from './format';

export interface Snapshot {
  name: string;
  state: string;
  county: string | null;
  acct: Accounts;
  pools: Pool[];
  lots: Lot[];
  branches: Bank['branches'];
  expectedLoss: number; // credit mark on the loans
  unrealized: number; // securities loss not on the ledger (HTM)
  franchisePool: number; // addressable market without geography
  coreDeposits: number;
}

// Lifetime expected loss on a book under today's conditions: the credit
// mark a buyer takes.
export function creditMark(world: World, b: Bank): number {
  let mark = 0;
  for (const p of b.pools) {
    const tp = TYPE[p.type];
    const s = Math.min(6, stressFor(world, b, p.type) * tp.downScale);
    const life = Math.min(4, Math.max(0.5, ((tp.balloon ?? tp.term) - p.ageMonths) / 24));
    const lgd = lgdNow(world, p.type);
    for (let g = 0; g < GRADES; g++) {
      const bal = p.grades[g] ?? 0;
      if (bal <= 0) continue;
      mark += bal * Math.min(1, (PD_BY_GRADE[g] ?? 1) * (0.6 + 0.4 * s) * life) * lgd;
    }
  }
  for (const l of b.loans) if (l.status !== 'paid' && l.status !== 'chargedOff' && l.status !== 'reo') mark += l.balance * Math.min(1, l.truePd * 2) * l.trueLgd;
  return Math.round(mark);
}

export function snapshot(world: World, b: Bank): Snapshot {
  return {
    name: b.name,
    state: b.state,
    county: b.homeCounty,
    acct: { ...b.acct },
    pools: b.pools.map((p) => ({ ...p, grades: [...p.grades] })),
    lots: b.lots.map((l) => ({ ...l })),
    branches: b.branches.map((br) => ({ ...br })),
    expectedLoss: creditMark(world, b),
    unrealized: Math.max(0, b.acct.securitiesHTM - b.htmFairValue),
    franchisePool: b.franchise.pool,
    coreDeposits: b.acct.checking + b.acct.savings + b.acct.mmda + b.acct.cd,
  };
}

function zero(b: Bank): void {
  for (const k of Object.keys(b.acct) as Account[]) b.acct[k] = 0;
  b.pools = [];
  b.lots = [];
  b.branches = [];
  b.loans = [];
}

// Assumes a snapshot at fair value. Loans come over net of the mark with
// no allowance; securities at fair; deposits and borrowings at par. The
// FDIC (or the seller in a whole bank deal) settles the gap in cash. A
// premium paid is a franchise intangible. Balanced by construction.
export function assume(ctx: Ctx, buyer: Bank, snap: Snapshot, premium: number, lossShare: number, label: string): void {
  const { world } = ctx;
  const a = buyer.acct;
  const s = snap.acct;
  const fairLoans = Math.max(0, s.loans - snap.expectedLoss);
  const afsFair = s.securitiesAFS + s.afsValuation;
  const htmFair = Math.max(0, s.securitiesHTM - snap.unrealized);
  const fairAssets = s.cash + afsFair + htmFair + fairLoans + s.interestReceivable + s.reo + s.premises + s.otherAssets;
  const liabilities = s.checking + s.savings + s.mmda + s.cd + s.brokered + s.fhlb + s.fedFundsPurchased + s.subDebt + s.interestPayable + s.otherLiabilities;
  const gap = liabilities - fairAssets; // paid to the buyer when positive
  const entry: Partial<Accounts> = {
    cash: s.cash + gap - premium,
    securitiesAFS: afsFair,
    securitiesHTM: htmFair,
    loans: fairLoans,
    interestReceivable: s.interestReceivable,
    reo: s.reo,
    premises: s.premises,
    otherAssets: s.otherAssets,
    goodwill: premium,
    checking: s.checking,
    savings: s.savings,
    mmda: s.mmda,
    cd: s.cd,
    brokered: s.brokered,
    fhlb: s.fhlb,
    fedFundsPurchased: s.fedFundsPurchased,
    subDebt: s.subDebt,
    interestPayable: s.interestPayable,
    otherLiabilities: s.otherLiabilities,
  };
  for (const k of Object.keys(entry) as Account[]) if (entry[k] === 0) delete entry[k];
  post(a, entry);
  // Pools come over scaled to the fair balance, grades kept.
  const scale = s.loans > 0 ? fairLoans / s.loans : 0;
  let pooled = 0;
  for (const p of snap.pools) {
    const q: Pool = { ...p, grades: p.grades.map((g) => Math.round(g * scale)) };
    q.balance = q.grades.reduce((x, y) => x + y, 0);
    pooled += q.balance;
    absorbPool(buyer, q);
  }
  const diff = fairLoans - pooled;
  if (diff !== 0 && buyer.pools.length > 0) {
    const big = buyer.pools.reduce((x, p) => (p.balance > x.balance ? p : x));
    big.balance += diff;
    big.grades[2] = (big.grades[2] ?? 0) + diff;
  }
  consolidatePools(buyer);
  const taken: Record<LotKind, { sum: number; first: Lot | null }> = { afs: { sum: 0, first: null }, htm: { sum: 0, first: null } };
  for (const l of snap.lots) {
    const fair = l.kind === 'afs' ? Math.round(l.cost * (afsFair / Math.max(1, s.securitiesAFS))) : Math.round(l.cost * (htmFair / Math.max(1, s.securitiesHTM)));
    if (fair > 0) {
      const lot: Lot = { ...l, cost: fair, fair, purchasedDay: world.day };
      buyer.lots.push(lot);
      taken[l.kind].sum += fair;
      taken[l.kind].first ??= lot;
    }
  }
  // Lots are rounded one by one and the account took the total: the
  // difference lands on one lot, or a lot is made for a book the target
  // carried without lots, so lots and the ledger agree to the dollar.
  for (const kind of ['afs', 'htm'] as const) {
    const diff = (kind === 'afs' ? afsFair : htmFair) - taken[kind].sum;
    const first = taken[kind].first;
    if (diff === 0) continue;
    if (first) {
      first.cost += diff;
      first.fair += diff;
    } else if (diff > 0) {
      buyer.lots.push({ id: nextId(world, 's'), kind, product: 'agency', cost: diff, coupon: marketYield(world, 3), duration: 3, purchasedDay: world.day, fair: diff });
    }
  }
  for (const br of snap.branches) {
    if (buyer.branches.some((x) => x.county === br.county)) {
      const mine = buyer.branches.find((x) => x.county === br.county);
      if (mine) mine.deposits += br.deposits;
    } else buyer.branches.push({ ...br, competitiveTarget: null });
  }
  // Without geography (tests) the target's addressable market joins the
  // buyer's franchise so the acquired deposits have somewhere to live.
  if (buyer.branches.length === 0 && snap.franchisePool > 0) {
    const mine = buyer.acct.checking + buyer.acct.savings + buyer.acct.mmda + buyer.acct.cd;
    buyer.franchise.pool += snap.franchisePool;
    const share = buyer.franchise.pool > 0 ? mine / buyer.franchise.pool : 0;
    buyer.franchise.baseShare = share;
    buyer.franchise.targetShare = Math.max(buyer.franchise.targetShare * (buyer.franchise.pool - snap.franchisePool) / Math.max(1, buyer.franchise.pool), share);
  }
  if (lossShare > 0) {
    buyer.lossShare = { balance: fairLoans + (buyer.lossShare?.balance ?? 0), share: lossShare, until: world.day + 5 * 365 };
  }
  const deposits = s.checking + s.savings + s.mmda + s.cd;
  buyer.integration.push({
    remaining: Math.round((totalAssetsOf(s) * calibration.integrationCost.typical) / 100),
    perQuarter: Math.round((totalAssetsOf(s) * calibration.integrationCost.typical) / 100 / 4),
    deposits,
    until: world.day + 365,
  });
  buyer.acquiredNames.push(snap.name);
  if (buyer.homeMetro === null && snap.county) buyer.homeCounty = buyer.homeCounty ?? snap.county;
  emit(ctx, 'system', `${buyer.name} ${label} ${snap.name}: ${money(deposits)} of deposits, ${money(fairLoans)} of loans after a ${money(snap.expectedLoss)} credit mark${premium > 0 ? `, ${money(premium)} premium` : ''}${lossShare > 0 ? `, FDIC loss share ${pct(lossShare, 0)}` : ''}`, {
    severity: 'good',
    bankId: buyer.id,
  });
}

function totalAssetsOf(a: Accounts): number {
  return a.cash + a.securitiesAFS + a.securitiesHTM + a.afsValuation + a.loans - a.allowance + a.interestReceivable + a.reo + a.premises + a.goodwill + a.otherAssets;
}

// Leverage after assuming a failed bank at fair value: the buyer's tier 1
// over its assets plus the liabilities taken on. The FDIC only accepts
// bids from banks that stay well capitalized.
export function leverageAfterAssuming(buyer: Bank, liabilities: number, premium: number): number {
  const tier1 = buyer.acct.commonStock + buyer.acct.retainedEarnings - buyer.acct.goodwill;
  const assets = totalAssets(buyer.acct) - buyer.acct.goodwill + liabilities - premium;
  return assets > 0 ? tier1 / assets : 0;
}

function liabilitiesOf(a: Accounts): number {
  return a.checking + a.savings + a.mmda + a.cd + a.brokered + a.fhlb + a.fedFundsPurchased + a.subDebt + a.interestPayable + a.otherLiabilities;
}

// AI bidders for a failed bank: well capitalized rivals nearby with the
// appetite and the size. Returns the best premium and the bidder.
export function aiBids(world: World, failed: { state: string; deposits: number; liabilities: number }, excludeId: string | null): { bidder: Bank; premium: number }[] {
  const st = world.geo.states[failed.state];
  const nearby = new Set<string>([failed.state, ...(st?.neighbors ?? [])]);
  const out: { bidder: Bank; premium: number }[] = [];
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.id === excludeId || b.status !== 'open' || b.kind !== 'rival' || !b.ai) continue;
    if (!nearby.has(b.state) && !b.national) continue;
    if (leverageRatio(b.acct) < PCA_WELL) continue;
    if (b.ai.acquisitive < 0.25) continue;
    const premium = Math.max(0, (calibration.assistedDepositPremium.typical / 100) * (0.5 + 2 * b.ai.acquisitive) * (world.economy.regime === 'recession' ? 0.5 : 1) + randNormal(world.rng, 0, 0.003));
    if (leverageAfterAssuming(b, failed.liabilities, Math.round(failed.deposits * premium)) < PCA_WELL) continue;
    out.push({ bidder: b, premium });
  }
  return out.sort((x, y) => y.premium - x.premium);
}

export function playerEligible(world: World, failed: Bank): boolean {
  const p = playerBank(world);
  if (!p || p.id === failed.id || p.status !== 'open') return false;
  if (p.enforcement === 'consent' || p.enforcement === 'pca') return false;
  const st = world.geo.states[failed.state];
  const nearby = new Set<string>([failed.state, ...(st?.neighbors ?? [])]);
  if (!nearby.has(p.state) && !p.branches.some((br) => world.geo.counties[br.county]?.state === failed.state)) return false;
  // Eligible only if the bank stays well capitalized after taking the
  // failed bank's liabilities at the top bid the desk can make.
  return leverageRatio(p.acct) >= PCA_WELL && leverageAfterAssuming(p, liabilitiesOf(failed.acct), Math.round(totalDeposits(failed.acct) * 0.03)) >= PCA_WELL;
}

// The Friday closure. Takes the snapshot, zeroes the failed bank, and
// either opens an auction for the player (closes Monday) or lets the
// best AI bidder assume at once. Without a bidder the FDIC pays out.
export function resolveFailure(ctx: Ctx, failed: Bank): void {
  const { world } = ctx;
  const snap = snapshot(world, failed);
  const deposits = totalDeposits(failed.acct);
  const liabilities = liabilitiesOf(failed.acct);
  const eligible = playerEligible(world, failed);
  zero(failed);
  const bids = aiBids(world, { state: failed.state, deposits, liabilities }, failed.id);
  const best = bids[0];
  if (eligible && deposits > 0) {
    const p = playerBank(world) as Bank;
    const loss = snap.expectedLoss;
    addPending(ctx, {
      kind: 'assisted_auction',
      bankId: p.id,
      title: `FDIC auction: ${snap.name} (${money(totalAssetsOf(snap.acct))} of assets) closed today. Bids due Monday.`,
      lines: [
        `Deposits ${money(deposits)}, loans ${money(snap.acct.loans)} with an expected loss of ${money(loss)} (${pct(snap.acct.loans > 0 ? loss / snap.acct.loans : 0, 1)}), securities ${money(snap.acct.securitiesAFS + snap.acct.securitiesHTM)}, ${snap.branches.length} branches.`,
        `Terms: assume all deposits, take the assets at fair value, FDIC pays the gap in cash, 80% loss share on the loans for five years.`,
        `You bid a premium on deposits. ${bids.length} other ${bids.length === 1 ? 'bank is' : 'banks are'} bidding.`,
      ],
      options: [
        { key: '1', label: 'Bid 0.5% of deposits' },
        { key: '2', label: 'Bid 1.5% of deposits' },
        { key: '3', label: 'Bid 3% of deposits' },
        { key: 'p', label: 'Pass' },
      ],
      data: { snap, deposits, aiBest: best ? best.premium : null, aiBidder: best ? best.bidder.id : null, failedId: failed.id },
      expires: world.day + 3,
    });
    return;
  }
  if (best) {
    const premium = Math.round(deposits * best.premium);
    assume(ctx, best.bidder, snap, premium, 0.8, 'assumed the deposits of');
    world.deals.push({ day: world.day, kind: 'assisted', buyer: best.bidder.name, target: snap.name, assets: totalAssetsOf(snap.acct), price: premium, priceToBook: null, regime: world.economy.regime });
    emit(ctx, 'rival', `${best.bidder.name} bought ${snap.name}'s deposits over the weekend with a ${pct(best.premium)} premium`, { bankId: best.bidder.id });
    if (world.player.record.some((r) => r.bankId === failed.id)) {
      const rec = world.player.record.find((r) => r.bankId === failed.id);
      if (rec) rec.outcome = 'failed';
      emit(ctx, 'regulator', `${best.bidder.name} reopened your branches on Monday under its own name.`, { severity: 'alert' });
    }
  } else {
    emit(ctx, 'regulator', `No buyer for ${snap.name}. The FDIC paid insured depositors and is liquidating the assets.`, { severity: 'alert' });
  }
}

export function decideAuction(ctx: Ctx, pending: Pending, d: Decision | null): void {
  const { world } = ctx;
  const p = pending.bankId ? world.banks[pending.bankId] : undefined;
  const snap = pending.data.snap as Snapshot;
  const deposits = pending.data.deposits as number;
  const aiBest = pending.data.aiBest as number | null;
  const aiBidder = pending.data.aiBidder ? world.banks[pending.data.aiBidder as string] : undefined;
  const bid = d?.choice === '1' ? 0.005 : d?.choice === '2' ? 0.015 : d?.choice === '3' ? 0.03 : null;
  if (p && bid !== null && (aiBest === null || bid >= aiBest)) {
    const premium = Math.round(deposits * bid);
    assume(ctx, p, snap, premium, 0.8, 'won the FDIC auction for');
    world.deals.push({ day: world.day, kind: 'assisted', buyer: p.name, target: snap.name, assets: totalAssetsOf(snap.acct), price: premium, priceToBook: null, regime: world.economy.regime });
    milestone(ctx, `Bought ${snap.name} from the FDIC`);
    return;
  }
  if (aiBidder && aiBest !== null) {
    const premium = Math.round(deposits * aiBest);
    assume(ctx, aiBidder, snap, premium, 0.8, 'assumed the deposits of');
    world.deals.push({ day: world.day, kind: 'assisted', buyer: aiBidder.name, target: snap.name, assets: totalAssetsOf(snap.acct), price: premium, priceToBook: null, regime: world.economy.regime });
    emit(ctx, 'rival', `${aiBidder.name} won ${snap.name} with a ${pct(aiBest)} premium${bid !== null ? `; your ${pct(bid)} bid lost` : ''}`, { severity: 'alert', bankId: aiBidder.id });
  } else {
    emit(ctx, 'regulator', `No buyer for ${snap.name}. The FDIC paid insured depositors.`, { severity: 'alert' });
  }
}

// Reservation price for a whole bank: the cycle's band, then quality and
// whether the board is a willing seller. Crisis-year deals are cheaper.
export function reservationPriceToBook(world: World, target: Bank): number {
  const e = world.economy;
  const band = e.regime === 'recession' ? calibration.dealPriceToBook.recession : calibration.dealPriceToBook.expansion;
  let pb = band.typical / 100;
  if (e.regime === 'recovery') pb = (calibration.dealPriceToBook.recession.typical / 100 + calibration.dealPriceToBook.expansion.typical / 100) / 2;
  if (e.crisis && e.regime === 'recession') pb -= 0.15;
  if (target.forSale) pb -= 0.2;
  const last = target.reports[target.reports.length - 1];
  if (last) pb += (last.roa - 0.01) * 20;
  pb += 1.5 * Math.max(0, priceToBook(world, target) - 1.2);
  pb -= 2 * Math.max(0, leverageRatio(target.acct) < 0.06 ? 0.06 - leverageRatio(target.acct) : 0) * 10;
  return Math.max(0.4, Math.min(2.6, pb));
}

export function dealCapacity(buyer: Bank): { cash: number; stock: boolean } {
  const cash = Math.max(0, buyer.acct.cash - Math.round(totalAssets(buyer.acct) * 0.04));
  return { cash, stock: buyer.holdingCompany };
}

// Pro forma leverage after a deal: stock adds capital, goodwill is
// deducted, the target's assets come on at fair value.
export function proFormaLeverage(buyer: Bank, target: Bank, price: number, stockShare: number, mark: number): number {
  const book = tangibleEquity(target);
  const fairNet = book - mark - Math.max(0, target.acct.securitiesHTM - target.htmFairValue);
  const goodwill = Math.max(0, price - fairNet);
  const stockPart = Math.round(price * stockShare);
  const cashPart = price - stockPart;
  const tier1 = buyer.acct.commonStock + buyer.acct.retainedEarnings - buyer.acct.goodwill + stockPart - goodwill;
  const assets = totalAssets(buyer.acct) - buyer.acct.goodwill + (totalAssets(target.acct) - target.acct.goodwill - mark) - cashPart;
  return assets > 0 ? tier1 / assets : 0;
}

export function nationalDepositShare(world: World, deposits: number): number {
  let total = 0;
  for (const st of Object.values(world.geo.states)) total += st.totalDeposits;
  return total > 0 ? deposits / total : 0;
}

// The player's offer. The board answers at once; an accepted offer goes
// into approval and closes when the pending item expires unless the
// player walks. A rival may top it.
export function makeOffer(ctx: Ctx, buyer: Bank, targetId: string, priceToBookOffered: number, stockShare: number): { ok: boolean; why: string } {
  const { world } = ctx;
  const target = world.banks[targetId];
  if (!target || target.status !== 'open' || target.kind !== 'rival') return { ok: false, why: 'not for sale as an individual bank' };
  if (leverageRatio(buyer.acct) < PCA_WELL) return { ok: false, why: 'you must be well capitalized' };
  if (buyer.enforcement === 'consent' || buyer.enforcement === 'pca') return { ok: false, why: 'no acquisitions under an enforcement order' };
  if (world.pending.some((p) => p.kind === 'acquisition_offer' || p.kind === 'competing_bid')) return { ok: false, why: 'a deal is already pending' };
  const book = tangibleEquity(target);
  const price = Math.round(book * priceToBookOffered);
  stockShare = Math.max(0, Math.min(1, stockShare));
  const cap = dealCapacity(buyer);
  if (stockShare > 0 && !cap.stock) return { ok: false, why: 'stock deals need a holding company' };
  const cashPart = Math.round(price * (1 - stockShare));
  if (cashPart > cap.cash) return { ok: false, why: `cash part ${money(cashPart)} exceeds what you can spend (${money(cap.cash)})` };
  if (nationalDepositShare(world, totalDeposits(buyer.acct) + totalDeposits(target.acct)) > 0.1) return { ok: false, why: 'the combined bank would hold over 10% of national deposits' };
  const markNow = creditMark(world, target);
  const proForma = proFormaLeverage(buyer, target, price, stockShare, markNow);
  if (proForma < PCA_WELL) return { ok: false, why: `regulators would not approve: pro forma leverage ${pct(proForma, 1)} after goodwill, below well capitalized. More stock, a lower price, or a smaller target.` };
  const reservation = reservationPriceToBook(world, target) * Math.exp(randNormal(world.rng, 0, 0.05));
  if (priceToBookOffered < reservation) {
    const counter = Math.round((reservation + 0.05) * 100) / 100;
    emit(ctx, 'rival', `${target.name}'s board turned down ${priceToBookOffered.toFixed(2)}x book and would consider ${counter.toFixed(2)}x`, { bankId: target.id });
    return { ok: true, why: `declined; the board wants ${counter.toFixed(2)}x` };
  }
  // Due diligence: the CCO's read of the target's book.
  const mark = creditMark(world, target);
  const closing = world.day + 90 + Math.round(rand(world.rng) * 90);
  addPending(ctx, {
    kind: 'acquisition_offer',
    bankId: buyer.id,
    title: `Agreed: ${target.name} at ${priceToBookOffered.toFixed(2)}x tangible book, ${money(price)}. Regulatory approval expected by ${formatDate(closing)}.`,
    lines: [
      `Due diligence: loans ${money(target.acct.loans)} with an expected loss of ${money(mark)} (${pct(target.acct.loans > 0 ? mark / target.acct.loans : 0, 1)}), criticized ${pct(criticizedShare(target), 1)}, unrealized securities loss ${money(-target.acct.afsValuation + Math.max(0, target.acct.securitiesHTM - target.htmFairValue))}.`,
      `Consideration: ${money(cashPart)} cash, ${money(price - cashPart)} in stock. Goodwill on closing about ${money(Math.max(0, price - (book - mark)))}. Integration cost ${pct(calibration.integrationCost.typical / 100, 0)} of target assets over four quarters; expect ${pct(calibration.acquiredDepositAttrition.typical / 100, 0)} of acquired deposits to leave in the first year.`,
      `Walk away before closing and pay a ${money(Math.round(price * 0.02))} break fee.`,
    ],
    options: [{ key: 'w', label: 'Walk away (break fee)' }],
    data: { targetId, price, stockShare, priceToBook: priceToBookOffered, mark },
    expires: closing,
    blocking: false,
  });
  emit(ctx, 'system', `Agreed to buy ${target.name} for ${money(price)} (${priceToBookOffered.toFixed(2)}x book). Approval pending.`, { severity: 'good', bankId: buyer.id });
  // The most acquisitive larger rival in the state may top the bid.
  const rivals = world.bankOrder.map((id) => world.banks[id] as Bank).filter((b) => b.kind === 'rival' && b.status === 'open' && b.ai && b.state === target.state && b.id !== buyer.id && totalAssets(b.acct) > totalAssets(target.acct) * 1.5 && leverageRatio(b.acct) >= PCA_WELL);
  const keenest = rivals.length > 0 ? rivals.reduce((x, y) => ((y.ai?.acquisitive ?? 0) > (x.ai?.acquisitive ?? 0) ? y : x)) : undefined;
  const challenger = keenest && chance(world.rng, 0.35 * (keenest.ai?.acquisitive ?? 0)) ? keenest : undefined;
  if (challenger) {
    const topped = Math.round(priceToBookOffered * 1.1 * 100) / 100;
    addPending(ctx, {
      kind: 'competing_bid',
      bankId: buyer.id,
      title: `${challenger.name} topped your offer for ${target.name}: ${topped.toFixed(2)}x book`,
      lines: [`Raise to ${(topped + 0.05).toFixed(2)}x (${money(Math.round(book * (topped + 0.05)))}) or let it go.`],
      options: [
        { key: 'r', label: 'Raise' },
        { key: 'l', label: 'Let it go' },
      ],
      data: { targetId, challengerId: challenger.id, topped },
    });
  }
  return { ok: true, why: 'agreed' };
}

export function criticizedShare(b: Bank): number {
  if (b.acct.loans <= 0) return 0;
  let x = 0;
  for (const p of b.pools) for (let g = 5; g < GRADES; g++) x += p.grades[g] ?? 0;
  return x / b.acct.loans;
}

export function decideOffer(ctx: Ctx, pending: Pending, d: Decision | null): void {
  const { world } = ctx;
  const buyer = pending.bankId ? world.banks[pending.bankId] : undefined;
  const target = world.banks[pending.data.targetId as string];
  if (!buyer) return;
  if (d && d.choice === 'w') {
    const fee = Math.round((pending.data.price as number) * 0.02);
    const paid = Math.min(fee, Math.max(0, buyer.acct.cash));
    if (paid > 0) {
      post(buyer.acct, { cash: -paid, retainedEarnings: -paid });
      buyer.is.month.otherExpense += paid;
    }
    emit(ctx, 'system', `Walked away from ${target?.name ?? 'the deal'}; paid ${money(paid)} break fee`, { bankId: buyer.id });
    return;
  }
  if (!target || target.status !== 'open') {
    emit(ctx, 'regulator', `The deal for ${target?.name ?? 'the target'} lapsed: the target is no longer available`, { severity: 'alert', bankId: buyer.id });
    return;
  }
  if (leverageRatio(buyer.acct) < PCA_WELL || proFormaLeverage(buyer, target, pending.data.price as number, pending.data.stockShare as number, creditMark(world, target)) < PCA_WELL) {
    emit(ctx, 'regulator', `Regulators denied the ${target.name} deal: ${buyer.name} would not be well capitalized after closing`, { severity: 'alert', bankId: buyer.id });
    return;
  }
  closeDeal(ctx, buyer, target, pending.data.price as number, pending.data.stockShare as number, pending.data.priceToBook as number);
}

export function decideCompetingBid(ctx: Ctx, pending: Pending, d: Decision): void {
  const { world } = ctx;
  const buyer = pending.bankId ? world.banks[pending.bankId] : undefined;
  const target = world.banks[pending.data.targetId as string];
  const challenger = world.banks[pending.data.challengerId as string];
  const offer = world.pending.find((p) => p.kind === 'acquisition_offer' && p.data.targetId === pending.data.targetId);
  if (!buyer || !target) return;
  if (d.choice === 'r' && offer) {
    const pb = (pending.data.topped as number) + 0.05;
    const price = Math.round(tangibleEquity(target) * pb);
    offer.data.price = price;
    offer.data.priceToBook = pb;
    offer.title = `Agreed: ${target.name} at ${pb.toFixed(2)}x tangible book, ${money(price)} after the bidding war.`;
    emit(ctx, 'system', `Raised to ${pb.toFixed(2)}x book for ${target.name}; ${challenger?.name ?? 'the rival'} withdrew`, { bankId: buyer.id });
  } else {
    if (offer) world.pending = world.pending.filter((p) => p.id !== offer.id);
    if (challenger && challenger.status === 'open') {
      closeDeal(ctx, challenger, target, Math.round(tangibleEquity(target) * (pending.data.topped as number)), 0, pending.data.topped as number);
      emit(ctx, 'rival', `${challenger.name} bought ${target.name} out from under you`, { severity: 'alert', bankId: challenger.id });
    }
  }
}

// Closing: purchase accounting. Target assets at fair value, goodwill for
// the rest of the price, stock issued at the buyer's price. Bargain
// purchases go to income.
export function closeDeal(ctx: Ctx, buyer: Bank, target: Bank, price: number, stockShare: number, priceToBookPaid: number): void {
  const { world } = ctx;
  const snap = snapshot(world, target);
  const book = tangibleEquity(target);
  const fairNet = book - snap.expectedLoss - snap.unrealized;
  const goodwill = price - fairNet;
  const cashPart = Math.round(price * (1 - stockShare));
  const stockPart = price - cashPart;
  zero(target);
  target.status = 'acquired';
  // Assume at fair value with no gap payment: the seller's holders get the
  // price instead. assume() pays the gap into cash; reverse it so the
  // buyer pays the price.
  const liabilities = totalDeposits(snap.acct) + snap.acct.fhlb + snap.acct.fedFundsPurchased + snap.acct.subDebt + snap.acct.interestPayable + snap.acct.otherLiabilities;
  assume(ctx, buyer, snap, 0, 0, 'closed the purchase of');
  const fairAssets = liabilities + fairNet;
  const gapPaid = liabilities - fairAssets; // negative of fairNet
  void gapPaid;
  // Undo the gap the FDIC would have paid (here the gap is what the buyer
  // owes the holders): cash -= fairNet + goodwill... net: buyer pays price.
  // After assume(): cash moved by (snap.cash + liabilities - fairAssets) = snap.cash - fairNet.
  // The buyer should be at snap.cash - cashPart with goodwill and stock.
  const adjust = fairNet - cashPart; // cash to add back relative to the assume() result
  if (goodwill >= 0) {
    post(buyer.acct, { cash: adjust, goodwill, commonStock: stockPart, retainedEarnings: 0 });
  } else {
    post(buyer.acct, { cash: adjust, commonStock: stockPart, retainedEarnings: -goodwill });
    buyer.is.month.feeIncome += -goodwill;
  }
  if (stockPart > 0) {
    const perShare = buyer.isPublic && buyer.price !== null ? buyer.price : Math.max(0.01, tangibleEquity(buyer) / Math.max(1, buyer.shares));
    buyer.shares += Math.round(stockPart / perShare);
  }
  for (const o of target.officers) buyer.officerCandidates.push(o);
  target.officers = [];
  world.deals.push({ day: world.day, kind: buyer.kind === 'player' ? 'whole' : 'rival', buyer: buyer.name, target: snap.name, assets: totalAssetsOf(snap.acct), price, priceToBook: priceToBookPaid, regime: world.economy.regime });
  if (buyer.id === world.playerBankId) {
    milestone(ctx, `Acquired ${snap.name} for ${money(price)} (${priceToBookPaid.toFixed(2)}x book)`);
    emit(ctx, 'regulator', `Regulators approved ${buyer.name}'s purchase of ${snap.name}. Closed today. Goodwill ${money(Math.max(0, goodwill))}${goodwill < 0 ? `, bargain purchase gain ${money(-goodwill)}` : ''}. Your stake is ${pct(ownership(world, buyer).player, 1)}.`, { severity: 'good', bankId: buyer.id });
  }
}

// Monthly: integration cost and deposit attrition run off; loss share
// expires; rivals consolidate.
export function dealsMonthly(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status !== 'open') continue;
    if (b.integration.length > 0) {
      const keep = [] as Bank['integration'];
      for (const it of b.integration) {
        const cost = Math.min(it.remaining, Math.round(it.perQuarter / 3));
        if (cost > 0 && b.acct.cash >= cost) {
          post(b.acct, { cash: -cost, retainedEarnings: -cost });
          b.is.month.otherExpense += cost;
          it.remaining -= cost;
        }
        // Acquired deposits leave at the attrition rate over the year.
        if (world.day < it.until) {
          const out = Math.round((it.deposits * (calibration.acquiredDepositAttrition.typical / 100)) / 12);
          const types = ['checking', 'savings', 'mmda', 'cd'] as const;
          let left = out;
          const entry: Partial<Accounts> = {};
          for (const t of types) {
            const x = Math.min(b.acct[t], Math.round(out / 4));
            if (x > 0) {
              entry[t] = -x;
              left -= x;
            }
          }
          const moved = out - left;
          if (moved > 0) {
            entry.cash = -moved;
            post(b.acct, entry);
          }
        }
        if (it.remaining > 0 || world.day < it.until) keep.push(it);
      }
      b.integration = keep;
    }
    if (b.lossShare && world.day > b.lossShare.until) b.lossShare = null;
  }
  rivalDeals(ctx);
}

// FDIC loss share reimburses a share of charge-offs on covered balances.
export function lossShareRecovery(b: Bank, chargeOffs: number): number {
  if (!b.lossShare || b.acct.loans <= 0 || chargeOffs <= 0) return 0;
  const covered = Math.min(1, b.lossShare.balance / b.acct.loans);
  const x = Math.round(chargeOffs * covered * b.lossShare.share);
  b.lossShare.balance = Math.max(0, b.lossShare.balance - chargeOffs * covered);
  return x;
}

function rivalDeals(ctx: Ctx): void {
  const { world } = ctx;
  const player = playerBank(world);
  const banks = world.bankOrder.map((id) => world.banks[id] as Bank);
  for (const t of banks) {
    if (t.kind !== 'rival' || t.status !== 'open' || !t.forSale) continue;
    // Nobody buys an undercapitalized bank without FDIC help; it fails first.
    if (leverageRatio(t.acct) < PCA_WELL) continue;
    if (!chance(world.rng, 0.04)) continue;
    const buyer = banks.find((b) => b.kind === 'rival' && b.status === 'open' && b.ai && b.id !== t.id && b.state === t.state && b.ai.acquisitive > 0.4 && leverageRatio(b.acct) >= PCA_WELL && totalAssets(b.acct) > totalAssets(t.acct) * 2 && b.acct.cash > tangibleEquity(t) * 0.5);
    if (!buyer) continue;
    const pb = reservationPriceToBook(world, t);
    const price = Math.round(tangibleEquity(t) * pb);
    closeDeal(ctx, buyer, t, price, buyer.holdingCompany ? 0.5 : 0, pb);
    if (player && (player.state === t.state || player.state === buyer.state)) {
      emit(ctx, 'rival', `${buyer.name} bought ${t.name} for ${money(price)} (${pb.toFixed(2)}x book)`, { bankId: buyer.id });
    }
  }
}

export function expireDeals(ctx: Ctx): void {
  const { world } = ctx;
  const due = world.pending.filter((p) => p.expires !== null && world.day >= p.expires);
  if (due.length === 0) return;
  world.pending = world.pending.filter((p) => !due.includes(p));
  for (const p of due) {
    if (p.kind === 'assisted_auction') decideAuction(ctx, p, null);
    else if (p.kind === 'acquisition_offer' && p.data.foreign) {
      const buyer = p.bankId ? world.banks[p.bankId] : undefined;
      if (buyer) closeForeign(ctx, buyer, p.data.foreign as ForeignCandidate);
    } else if (p.kind === 'acquisition_offer') decideOffer(ctx, p, null);
    else if (p.kind === 'workout') decideWorkout(ctx, p, null);
  }
}

export function enterState(ctx: Ctx, state: string): boolean {
  return expandState(ctx, state);
}

export { fairPrice };
