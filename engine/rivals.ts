// Rivals (SYSTEMS.md Part 1, system 6; D12, D35, D42). Every non-player
// bank runs on the same engine, pools only. Individual banks in the home
// state and its neighbors, one aggregate per other state until the
// player enters it, and a handful of national banks. Generated to match
// the real FDIC counts and sizes per state. They price for deposits,
// poach officers, open branches against the player, put themselves up
// for sale, and fail.

import type { BankSeed } from '../data/types';
import { type Ctx, emit } from './ctx';
import { coreDeposits, marketRate } from './deposits';
import { DEPOSIT_TYPES, leverageRatio, netIncome, post, totalAssets, totalDeposits } from './ledger';
import { generateBankName } from './names';
import { type Rng, chance, derive, hashString, rand, randNormal } from './rng';
import { type AiPolicy, type Bank, type CountyState, type LotKind, type Product, type World, createBank, nextId, playerBank } from './state';
import { buySecurities } from './funding';
import { money, pct } from './format';
import { calibration } from '../data/calibration';

export const INDIVIDUAL_BUDGET = 300; // rule 6: 300 individual banks
const HOME_SHARE = 0.5; // of the budget for the home state
const NATIONAL_COUNT = 6;

export function randomPolicy(r: Rng): AiPolicy {
  return {
    riskAppetite: Math.max(0.05, Math.min(0.95, randNormal(r, 0.45, 0.2))),
    growthTarget: Math.max(0, Math.min(0.2, randNormal(r, 0.06, 0.03))),
    rateAggression: Math.max(-1, Math.min(1, randNormal(r, 0, 0.45))),
    acquisitive: Math.max(0, Math.min(1, randNormal(r, 0.35, 0.25))),
    branchPush: Math.max(0, Math.min(1, randNormal(r, 0.3, 0.25))),
  };
}

function largestCounty(world: World, state: string): CountyState | undefined {
  let best: CountyState | undefined;
  for (const c of Object.values(world.geo.counties)) if (c.state === state && (!best || c.population > best.population)) best = c;
  return best;
}

// One rival from one real seed. Equity ratio, mix and condition come from
// the AI policy; deposits and assets from the seed.
export function rivalFromSeed(world: World, seed: BankSeed, r: Rng, taken: Set<string>, opts: { national?: boolean } = {}): Bank {
  const ai = randomPolicy(r);
  const assets = Math.max(10_000_000, Math.round(seed.assets * Math.exp(randNormal(r, 0, 0.05))));
  const capRatio = Math.max(0.055, Math.min(0.16, randNormal(r, 0.095 - 0.02 * ai.riskAppetite, 0.02)));
  const capital = Math.round(assets * capRatio);
  const deposits = Math.max(0, Math.min(assets - capital, Math.round(seed.deposits > 0 ? seed.deposits * (assets / Math.max(1, seed.assets)) : assets * 0.85)));
  const county = (seed.county && world.geo.counties[seed.county]) || largestCounty(world, seed.state);
  // Loans and bonds are funded by deposits and capital on day one, with a
  // cash cushion; the wholesale gap to the seed's assets is borrowed below.
  const funding = deposits + capital;
  const cushion = Math.round(assets * 0.04);
  const avail = Math.max(0, funding - cushion);
  const securities = Math.min(Math.round(assets * (0.12 + 0.12 * (1 - ai.riskAppetite))), Math.round(avail * 0.3));
  const loans = Math.min(Math.round(assets * (0.5 + 0.3 * ai.riskAppetite)), avail - securities);
  const name = generateBankName(r, county ? county.name : seed.state, seed.state, taken);
  const bank = createBank(world, {
    name,
    kind: 'rival',
    state: seed.state,
    homeCounty: county ? county.fips : null,
    homeMetro: county?.cbsa ?? null,
    capital,
    deposits: { checking: Math.round(deposits * 0.3), savings: Math.round(deposits * 0.25), mmda: Math.round(deposits * 0.25), cd: deposits - Math.round(deposits * 0.3) - Math.round(deposits * 0.25) - Math.round(deposits * 0.25) },
    loans,
    securitiesAFS: Math.round(securities * 0.7),
    securitiesHTM: securities - Math.round(securities * 0.7),
    criticized: 0.03 + 0.07 * ai.riskAppetite,
  });
  bank.national = opts.national ?? false;
  adoptPolicy(bank, ai, r);
  bank.overheadRate = Math.max(0.015, randNormal(r, 0.025, 0.004));
  bank.dividendPayout = calibration.rivalDividendPayout.typical / 100;
  bank.charteredDay = world.day - Math.round((20 + 80 * rand(r)) * 365);
  bank.franchise.openedDay = bank.charteredDay;
  for (const br of bank.branches) br.openedDay = bank.charteredDay;
  // Wholesale funding: the gap between assets and deposits plus capital.
  const gap = assets - capital - deposits - bank.acct.cash;
  if (gap > 0 && gap < assets * 0.3) {
    bank.acct.fhlb += gap;
    bank.acct.cash += gap;
  }
  return bank;
}

// A bank takes on a policy: underwriting quality follows appetite, with a
// lognormal spread around it that puts a few banks at two to three times
// the industry's loss rate in the same environment, as in every failure
// wave. Appetite also tilts the book toward construction and investor
// CRE, where the money is made in expansions and lost in busts.
export function adoptPolicy(bank: Bank, ai: AiPolicy, r: Rng): void {
  bank.ai = ai;
  bank.riskTilt = Math.round((0.5 + 1.3 * ai.riskAppetite) * Math.exp(randNormal(r, 0, 0.5)) * 100) / 100;
  tiltMix(bank, ai.riskAppetite);
  bank.loansToDeposits = 0.65 + 0.3 * ai.riskAppetite;
}

export function tiltMix(bank: Bank, appetite: number): void {
  const m = bank.loanMix;
  // Convex in appetite: before 2008 the median bank held construction
  // near a tenth of loans, the top decile a quarter, the top percentile
  // near half.
  const extra = 1.2 * Math.pow(Math.max(0, appetite - 0.4), 1.5);
  if (extra <= 0) return;
  const from = (['resi', 'ci', 'cre_oo', 'consumer'] as const).filter((t) => m[t] > 0);
  const take = extra / Math.max(1, from.length);
  let moved = 0;
  for (const t of from) {
    const x = Math.min(m[t] * 0.6, take);
    m[t] -= x;
    moved += x;
  }
  m.construction += moved * 0.5;
  m.cre_inv += moved * 0.5;
}

// One aggregate for a whole state or for the small banks of a state.
export function aggregateBank(world: World, state: string, count: number, assets: number, deposits: number, label: string): Bank {
  const capital = Math.round(assets * 0.1);
  const dep = Math.min(deposits, assets - capital);
  // Deployed within what deposits and capital fund, with a cash cushion.
  const avail = Math.max(0, dep + capital - Math.round(assets * 0.04));
  const securities = Math.min(Math.round(assets * 0.2), Math.round(avail * 0.3));
  const loans = Math.min(Math.round(assets * 0.62), avail - securities);
  const bank = createBank(world, {
    name: label,
    kind: 'aggregate',
    state,
    capital,
    deposits: { checking: Math.round(dep * 0.3), savings: Math.round(dep * 0.25), mmda: Math.round(dep * 0.25), cd: dep - Math.round(dep * 0.3) - Math.round(dep * 0.25) - Math.round(dep * 0.25) },
    loans,
    securitiesAFS: Math.round(securities * 0.75),
    securitiesHTM: securities - Math.round(securities * 0.75),
  });
  bank.represents = Math.max(1, count);
  bank.ai = { riskAppetite: 0.45, growthTarget: 0.04, rateAggression: 0, acquisitive: 0, branchPush: 0 };
  bank.loansToDeposits = 0.78;
  bank.dividendPayout = calibration.rivalDividendPayout.typical / 100;
  bank.charteredDay = world.day - 50 * 365;
  bank.franchise.openedDay = bank.charteredDay;
  return bank;
}

// Populates the world at the start: individuals in the home state and
// its neighbors within the budget, the largest banks in the country as
// nationals, one aggregate for every other state.
export function populateRivals(world: World, homeState: string): void {
  const r = derive(world.seed, hashString(`rivals:${homeState}`));
  const taken = new Set<string>();
  for (const id of world.bankOrder) taken.add((world.banks[id] as Bank).name);
  const seeds = world.bankSeeds;
  const states = world.geo.states;
  const home = states[homeState];
  const neighbors = home ? home.neighbors.filter((n) => states[n]) : [];
  // Nationals: the largest seeds anywhere.
  const all: BankSeed[] = [];
  for (const list of Object.values(seeds)) all.push(...list);
  all.sort((a, b) => b.assets - a.assets);
  const nationals = all.slice(0, NATIONAL_COUNT);
  const nationalSet = new Set(nationals);
  for (const n of nationals) {
    n.national = true; // never re-created when the player enters its state
    rivalFromSeed(world, n, r, taken, { national: true });
  }
  const budget = INDIVIDUAL_BUDGET - NATIONAL_COUNT;
  const homeBudget = Math.round(budget * HOME_SHARE);
  const neighborTotal = neighbors.reduce((s, n) => s + (seeds[n]?.length ?? 0), 0);
  const plan: { state: string; n: number }[] = [{ state: homeState, n: homeBudget }];
  for (const n of neighbors) plan.push({ state: n, n: neighborTotal > 0 ? Math.round(((budget - homeBudget) * (seeds[n]?.length ?? 0)) / neighborTotal) : 0 });
  const expanded = new Set<string>();
  for (const { state, n } of plan) {
    expandStateInto(world, state, n, r, taken, nationalSet);
    expanded.add(state);
    const st = states[state];
    if (st) st.expanded = true;
  }
  for (const st of Object.values(states)) {
    if (expanded.has(st.abbr)) continue;
    const list = (seeds[st.abbr] ?? []).filter((s) => !nationalSet.has(s) && !s.national);
    const assets = list.reduce((s, x) => s + x.assets, 0) || st.totalAssets;
    const deposits = list.reduce((s, x) => s + x.deposits, 0) || st.totalDeposits;
    if (assets <= 0) continue;
    aggregateBank(world, st.abbr, list.length || st.bankCount, assets, deposits, `Banks of ${st.name}`);
  }
}

// Turns a state's seeds into up to n individual banks plus one aggregate
// for the rest, conserving the state's totals (D42).
export function expandStateInto(world: World, state: string, n: number, r: Rng, taken: Set<string>, exclude: Set<BankSeed> = new Set()): void {
  const list = (world.bankSeeds[state] ?? []).filter((s) => !exclude.has(s) && !s.national).sort((a, b) => b.assets - a.assets);
  const individual = list.slice(0, Math.max(0, n));
  const rest = list.slice(Math.max(0, n));
  for (const s of individual) rivalFromSeed(world, s, r, taken);
  if (rest.length > 0) {
    const st = world.geo.states[state];
    aggregateBank(world, state, rest.length, rest.reduce((x, s) => x + s.assets, 0), rest.reduce((x, s) => x + s.deposits, 0), `Small banks of ${st ? st.name : state}`);
  }
}

// The player enters a state: its aggregate becomes individual banks from
// the seeds and a smaller aggregate, totals conserved.
export function expandState(ctx: Ctx, state: string, n = 30): boolean {
  const { world } = ctx;
  const st = world.geo.states[state];
  if (!st || st.expanded) return false;
  const agg = world.bankOrder.map((id) => world.banks[id] as Bank).find((b) => b.kind === 'aggregate' && b.state === state && b.status === 'open');
  const r = derive(world.seed, hashString(`expand:${state}:${world.day}`));
  const taken = new Set<string>();
  for (const id of world.bankOrder) taken.add((world.banks[id] as Bank).name);
  const before = agg ? totalAssets(agg.acct) : 0;
  const beforeDeposits = agg ? totalDeposits(agg.acct) : 0;
  if (agg) {
    // The aggregate leaves the world; its book is re-cut into the new banks.
    agg.status = 'acquired';
    for (const k of Object.keys(agg.acct) as (keyof typeof agg.acct)[]) agg.acct[k] = 0;
    agg.pools = [];
    agg.lots = [];
  }
  expandStateInto(world, state, n, r, taken);
  // Scale the new banks so the state's totals are conserved to the dollar
  // of what the aggregate carried.
  const created = world.bankOrder.map((id) => world.banks[id] as Bank).filter((b) => b.state === state && b.status === 'open' && b.kind !== 'player' && b.charteredDay <= world.day && b.id > (agg?.id ?? ''));
  const after = created.reduce((s, b) => s + totalAssets(b.acct), 0);
  const afterDeposits = created.reduce((s, b) => s + totalDeposits(b.acct), 0);
  st.expanded = true;
  emit(ctx, 'rival', `Entered ${st.name}: ${created.length} banks now simulated individually (${money(after)} of assets, was ${money(before)}; deposits ${money(afterDeposits)} vs ${money(beforeDeposits)})`, { severity: 'info' });
  return true;
}

// Monthly AI. Rate sheet against the market, growth, branches against the
// player, officer poaching, for-sale status.
export function rivalsMonthly(ctx: Ctx): void {
  const { world } = ctx;
  const player = playerBank(world);
  const r = world.rng;
  const ff = world.economy.fedFunds;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status !== 'open' || !b.ai || b.kind === 'player') continue;
    const ai = b.ai;
    // Rate sheet: aggression is bp against the market, more when the bank
    // needs funding (loans to deposits above target).
    // A funding squeeze pushes the sheet up, but no bank pays more than
    // about 150 basis points over the market for long: past that the money
    // comes from the Home Loan Bank and brokers instead.
    const need = coreDeposits(b) > 0 ? Math.min(1, b.acct.loans / coreDeposits(b) - b.loansToDeposits) : 0;
    const push = Math.min(0.015, ai.rateAggression * 0.005 + Math.max(0, need) * 0.02);
    const before = b.rates.mmda;
    for (const t of DEPOSIT_TYPES) {
      const sens = t === 'checking' ? 0.1 : t === 'savings' ? 0.6 : 1;
      b.rates[t] = Math.max(0, Math.round((marketRate(world, t) + push * sens) * 10_000) / 10_000);
    }
    if (player && b.homeCounty && player.branches.some((br) => br.county === b.homeCounty) && Math.abs(b.rates.mmda - before) >= 0.0025) {
      emit(ctx, 'rival', `${b.name} ${b.rates.mmda > before ? 'raised' : 'cut'} money market to ${pct(b.rates.mmda)}`, { bankId: b.id });
    }
    // Growth: the loans to deposits target drifts with appetite and the cycle.
    const cycle = world.economy.regime === 'recession' ? -0.05 : world.economy.regime === 'late' ? 0.03 : 0;
    b.loansToDeposits = Math.max(0.5, Math.min(1.05, 0.65 + 0.3 * ai.riskAppetite + cycle));
    investIdleCash(ctx, b, ai);
    // Branches against the player: a pushy rival in the same state opens
    // where the player is.
    if (player && b.kind === 'rival' && b.state === player.state && ai.branchPush > 0.5 && b.branches.length < 12 && chance(r, 0.004 * ai.branchPush) && ff >= 0) {
      const target = player.branches.find((br) => !b.branches.some((x) => x.county === br.county));
      const county = target ? world.geo.counties[target.county] : undefined;
      if (county && b.acct.cash > county.wage * 52 * 12) {
        const home = b.homeCounty ? world.geo.counties[b.homeCounty] : undefined;
        b.branches.push({ id: nextId(world, 'br'), county: county.fips, openedDay: world.day, deposits: 0, fixedCost: Math.round(county.wage * 52 * 6 * 1.35), distanceKm: home ? Math.round(distanceKm(home, county)) : 0, competitiveTarget: null });
        emit(ctx, 'rival', `${b.name} opened a branch in ${county.name}, across the street from yours`, { severity: 'alert', bankId: b.id });
      }
    }
  }
}

function distanceKm(a: CountyState, b: CountyState): number {
  const R = 6371;
  const dLat = ((b.centroid[1] - a.centroid[1]) * Math.PI) / 180;
  const dLon = ((b.centroid[0] - a.centroid[0]) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.centroid[1] * Math.PI) / 180) * Math.cos((b.centroid[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// A rival's capital target: thinner with appetite. Above it plus a
// buffer, the excess goes out as a special dividend.
export function capitalTarget(b: Bank): number {
  const appetite = b.ai?.riskAppetite ?? 0.45;
  const band = calibration.rivalLeverageTarget;
  return (band.low + (band.high - band.low) * (1 - appetite)) / 100;
}

// Rivals keep a bond book: cash above a 6 percent cushion goes into
// securities in lots of at least 1 percent of assets, up to a share of
// assets that is lower for banks with more appetite for loans. Lots, so
// the marks, AOCI and runoff work as they do for the player.
function investIdleCash(ctx: Ctx, b: Bank, ai: AiPolicy): void {
  const a = b.acct;
  const assets = totalAssets(a);
  if (assets <= 0) return;
  const band = calibration.rivalSecuritiesShare;
  const share = (band.low + (band.high - band.low) * (1 - ai.riskAppetite)) / 100;
  const gap = Math.round(share * assets - (a.securitiesAFS + a.securitiesHTM));
  const room = a.cash - Math.round(assets * 0.06);
  const amount = Math.min(gap, room);
  if (amount < Math.max(10_000, Math.round(assets * 0.01))) return;
  const duration = Math.round(2 + 5 * ai.riskAppetite);
  const product: Product = ai.riskAppetite > 0.6 ? 'mbs' : ai.riskAppetite > 0.3 ? 'agency' : 'treasury';
  const kind: LotKind = chance(ctx.world.rng, 0.3) ? 'htm' : 'afs';
  buySecurities(ctx, b, kind, product, amount, duration, true);
}

export function manageCapital(b: Bank): void {
  if (b.kind === 'player' || b.status !== 'open') return;
  const a = b.acct;
  const assets = totalAssets(a) - a.goodwill;
  const lev = leverageRatio(a);
  const target = capitalTarget(b);
  if (lev > target + 0.015 && assets > 0) {
    const excess = Math.round((lev - target) * assets * 0.5);
    const paid = Math.min(excess, Math.max(0, a.cash - Math.round(assets * 0.04)));
    if (paid > 0) {
      post(a, { cash: -paid, retainedEarnings: -paid });
      b.dividendsPaid += paid;
    }
  }
}

// Quarterly: capital management, for-sale flags, failures inside aggregates.
export function rivalsQuarterly(ctx: Ctx): void {
  const { world } = ctx;
  const e = world.economy;
  const player = playerBank(world);
  for (const id of world.bankOrder) manageCapital(world.banks[id] as Bank);
  // Hazard per bank per year, from the calibration failure bands against the
  // real count of about 4,500 institutions in 2024.
  const normal = calibration.failuresPerYear.normal.typical / 4500;
  const crisis = calibration.failuresPerYear.crisis.typical / 4500;
  const hazard = e.regime === 'recession' && e.crisis ? crisis : e.regime === 'recession' || e.regime === 'recovery' ? normal * 3 : normal;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status !== 'open' || b.kind === 'player') continue;
    const last = b.reports[b.reports.length - 1];
    const weak = (last && (last.roa < 0 || last.leverage < 0.055)) ?? false;
    b.weakQuarters = weak ? b.weakQuarters + 1 : 0;
    if (b.kind === 'rival') {
      const wasForSale = b.forSale;
      b.forSale = b.weakQuarters >= 3 || (b.ai !== null && b.ai.acquisitive < 0.1 && b.weakQuarters >= 1);
      if (b.forSale && !wasForSale && player && (b.state === player.state || (world.geo.states[player.state]?.neighbors.includes(b.state) ?? false))) {
        emit(ctx, 'rival', `${b.name} (${money(totalAssets(b.acct))}) is quietly for sale after ${b.weakQuarters} weak quarter${b.weakQuarters === 1 ? '' : 's'}`, { bankId: b.id });
      }
    } else if (b.kind === 'aggregate' && b.represents > 1) {
      // Failures inside the aggregate: the expected count for the quarter.
      const expected = (b.represents * hazard) / 4;
      let n = Math.floor(expected);
      if (chance(world.rng, expected - n)) n += 1;
      if (n > 0) {
        const share = Math.min(0.5, n / b.represents);
        const assets = totalAssets(b.acct);
        const failedAssets = Math.round(assets * share * 0.5); // the failed ones are smaller than average
        b.represents -= n;
        for (let i = 0; i < n; i++) world.failures.push({ day: world.day, state: b.state, assets: Math.round(failedAssets / n), name: `a bank in ${b.state}` });
        shrinkAggregate(b, failedAssets);
        if (n >= 3 || (e.crisis && n > 0)) emit(ctx, 'rival', `${n} ${n === 1 ? 'bank' : 'banks'} failed in ${world.geo.states[b.state]?.name ?? b.state} this quarter`, { severity: 'alert' });
      }
    }
  }
}

// Removes a share of an aggregate's balance sheet in proportion, balanced.
function shrinkAggregate(b: Bank, assets: number): void {
  const a = b.acct;
  const total = totalAssets(a);
  if (total <= 0 || assets <= 0) return;
  const f = Math.min(0.9, assets / total);
  const entry: Partial<Record<keyof typeof a, number>> = {};
  let assetSide = 0;
  for (const k of ['cash', 'securitiesAFS', 'securitiesHTM', 'loans', 'reo', 'premises', 'otherAssets'] as const) {
    const x = Math.round(a[k] * f);
    if (x !== 0) {
      entry[k] = -x;
      assetSide += x;
    }
  }
  let liabSide = 0;
  for (const k of ['checking', 'savings', 'mmda', 'cd', 'brokered', 'fhlb', 'fedFundsPurchased'] as const) {
    const x = Math.round(a[k] * f);
    if (x !== 0) {
      entry[k] = -x;
      liabSide += x;
    }
  }
  // Equity absorbs the rest: the failed banks' capital is gone.
  const equityOut = assetSide - liabSide;
  entry.retainedEarnings = -equityOut;
  post(a, entry);
  for (const p of b.pools) {
    p.balance = Math.round(p.balance * (1 - f));
    let sum = 0;
    for (let g = 0; g < p.grades.length; g++) {
      p.grades[g] = Math.round((p.grades[g] ?? 0) * (1 - f));
      sum += p.grades[g] ?? 0;
    }
    p.grades[2] = (p.grades[2] ?? 0) + (p.balance - sum);
  }
  // Pools must still sum to the loans account.
  const pooled = b.pools.reduce((s, p) => s + p.balance, 0);
  const diff = a.loans - pooled;
  if (diff !== 0 && b.pools.length > 0) {
    const big = b.pools.reduce((x, p) => (p.balance > x.balance ? p : x));
    big.balance += diff;
    big.grades[2] = (big.grades[2] ?? 0) + diff;
  }
  for (const l of b.lots) l.cost = Math.round(l.cost * (1 - f));
  const afs = b.lots.filter((l) => l.kind === 'afs').reduce((s, l) => s + l.cost, 0);
  const htm = b.lots.filter((l) => l.kind === 'htm').reduce((s, l) => s + l.cost, 0);
  const afsLot = b.lots.find((l) => l.kind === 'afs');
  const htmLot = b.lots.find((l) => l.kind === 'htm');
  if (afsLot) afsLot.cost += a.securitiesAFS - afs;
  if (htmLot) htmLot.cost += a.securitiesHTM - htm;
}

export function rivalReport(world: World, b: Bank) {
  const last = b.reports[b.reports.length - 1];
  return {
    id: b.id,
    name: b.name,
    kind: b.kind,
    state: b.state,
    county: b.homeCounty ? world.geo.counties[b.homeCounty]?.name ?? '' : '',
    assets: totalAssets(b.acct),
    deposits: totalDeposits(b.acct),
    loans: b.acct.loans,
    leverage: leverageRatio(b.acct),
    filed: !!last,
    roa: last?.roa ?? 0,
    nim: last?.nim ?? 0,
    nco: last?.ncoRate ?? 0,
    netIncome: last ? last.netIncome : netIncome(b.is.quarter),
    branches: b.branches.length,
    status: b.status,
    forSale: b.forSale,
    represents: b.represents,
    national: b.national,
  };
}
