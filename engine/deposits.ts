// Deposits (SYSTEMS.md Part 1, system 4). Daily flows by type toward a
// target drawn from each branch's county pool, moved by the rate sheet,
// confidence, tenure, and distance from home. Monthly: rate resets by
// beta for rivals, confidence, uninsured share. Runs: uninsured money
// leaves first when confidence breaks. Branches open and close on real
// counties at a fixed cost from local wages.

import { calibration } from '../data/calibration';
import { type Ctx, addPending, emit } from './ctx';
import { borrowFhlb, fhlbCapacity, sellSecurities, unrealizedToCapital } from './funding';
import { DEPOSIT_TYPES, type DepositType, leverageRatio, post, totalAssets } from './ledger';
import { nextFriday } from './regulation';
import { chance, randNormal } from './rng';
import { type Bank, type Branch, type CountyState, type Decision, type Pending, type World, branchFixedCost, nextId, playerBank } from './state';
import { money, pct } from './format';

const DEFAULT_MIX: Record<DepositType, number> = { checking: 0.3, savings: 0.25, mmda: 0.25, cd: 0.2 };
// Stickiness: how fast each type moves toward its target (share of the
// gap closed per month). Checking is relationships; CDs are rate shoppers.
const SPEED: Record<DepositType, number> = { checking: 0.15, savings: 0.3, mmda: 0.6, cd: 0.9 };
// Rate sensitivity by type relative to the elasticity band.
const SENSITIVITY: Record<DepositType, number> = { checking: 0.2, savings: 0.7, mmda: 1.3, cd: 1.8 };
// Share of each type above the insurance limit, structural (business
// checking and money market run large balances).
const UNINSURED: Record<DepositType, number> = { checking: 0.45, savings: 0.12, mmda: 0.4, cd: 0.1 };

export function coreDeposits(b: Bank): number {
  const a = b.acct;
  return a.checking + a.savings + a.mmda + a.cd;
}

export function marketRate(world: World, t: DepositType): number {
  return world.economy.fedFunds * calibration.depositBeta[t].typical;
}

export function marketDepositRate(world: World): number {
  let r = 0;
  for (const t of DEPOSIT_TYPES) r += DEFAULT_MIX[t] * marketRate(world, t);
  return r;
}

export function bankDepositRate(b: Bank): number {
  const core = coreDeposits(b);
  let r = 0;
  for (const t of DEPOSIT_TYPES) r += (core > 0 ? b.acct[t] / core : DEFAULT_MIX[t]) * b.rates[t];
  return r;
}

export function km(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// A branch's target deposits: its county's pool times a share that ramps
// with years in market toward the ceiling, discounted by distance from
// home, capped by branch capacity at local wages.
export function branchTarget(world: World, b: Bank, br: Branch, isHome = br.county === b.homeCounty): number {
  const county = world.geo.counties[br.county];
  // A bank whose deposits dwarf its home county gathers them from a wider
  // market than the county: its franchise pool, set at creation, stands in
  // for the county pool at home (a money center bank in one county).
  const pool = county ? Math.max(county.depositPool, isHome ? b.franchise.pool : 0) : b.franchise.pool;
  if (pool <= 0) return br.deposits;
  const years = Math.max(0, (world.day - br.openedDay) / 365);
  const ceiling = calibration.deNovoShareCeiling.typical / 100;
  const ramp = 1 - Math.exp(-years / 3);
  // Home: from the base share toward the franchise target. Elsewhere: a
  // new branch ramps from nothing toward the de novo ceiling.
  const base = isHome ? b.franchise.baseShare : 0;
  const target = isHome ? Math.max(b.franchise.targetShare, base) : ceiling;
  const share = Math.min(1, base + (target - base) * ramp);
  const distance = Math.exp(-br.distanceKm / 1500);
  const fromShare = br.competitiveTarget ?? pool * share * distance;
  // Branch capacity applies to real branches on real counties. Without
  // geography the franchise pool is the whole addressable market.
  if (!county) return Math.round(fromShare);
  const wageIndex = Math.max(0.5, Math.min(2, county.wage / 1300));
  // A branch gathers customers at a pace, whatever the county holds: a
  // twentieth of a mature branch's book in its first months, a third by
  // the end of year one, all of it after four years. A de novo in a huge
  // county still starts small.
  const seasoning = Math.min(1, 0.05 + years / 4);
  const perBranch = calibration.depositsPerBranch.typical * 1e6 * wageIndex * (isHome ? 3 : 1) * seasoning;
  // Capacity caps growth; it never pushes out what a branch already holds.
  return Math.round(Math.min(fromShare, Math.max(perBranch, br.deposits)));
}

// Attractiveness of a branch to depositors in its county: the rate sheet
// against the market, years in the market, the bank's size (reputation),
// and confidence. Pure, so it can be tested on its own.
export function attractiveness(rateGap: number, years: number, assets: number, confidence: number): number {
  const elasticity = calibration.depositRateElasticity.typical / 100;
  // Three points over or under the market is as far as depositors can tell.
  const gap = Math.max(-0.03, Math.min(0.03, rateGap));
  return Math.exp(elasticity * 8 * (gap / 0.01) + 0.4 * Math.log(1 + Math.min(Math.max(0, years), 30)) + 0.15 * Math.log(Math.max(assets, 1e6) / 1e8)) * Math.pow(Math.max(0.05, confidence), 2);
}

// Splits a county's simulated share of deposits among the branches there
// by attractiveness. Returns a target per branch. Pure.
export function splitCounty(pool: number, simulatedShare: number, branches: { attract: number }[]): number[] {
  let sum = 0;
  for (const b of branches) sum += b.attract;
  if (sum <= 0) return branches.map(() => 0);
  return branches.map((b) => Math.round((pool * simulatedShare * b.attract) / sum));
}

// Monthly: every county with more than one simulated branch is a contest.
// The simulated share of the county pool is what those branches hold now
// (it drifts with the winners' ramps), split by attractiveness.
export function competeCounties(world: World): void {
  const byCounty: Record<string, { bank: Bank; br: Branch }[]> = {};
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status !== 'open' && b.status !== 'closing') continue;
    for (const br of b.branches) (byCounty[br.county] ??= []).push({ bank: b, br });
  }
  for (const [fips, list] of Object.entries(byCounty)) {
    const county = world.geo.counties[fips];
    if (!county || county.depositPool <= 0) continue;
    if (list.length < 2) {
      for (const x of list) x.br.competitiveTarget = null;
      continue;
    }
    let held = 0;
    let natural = 0;
    const own: number[] = [];
    const attract = list.map(({ bank, br }) => {
      held += br.deposits;
      br.competitiveTarget = null;
      const mine = branchTarget(world, bank, br);
      own.push(mine);
      natural += mine;
      const years = (world.day - br.openedDay) / 365;
      return { attract: attractiveness(bankDepositRate(bank) - marketDepositRate(world), years, totalAssets(bank.acct), bank.confidence) };
    });
    // The contested pot: what the branches would hold on their own, capped
    // by the county pool. Winners take from losers inside it, but no branch
    // wins more than a quarter over what it could gather on its own: a new
    // branch does not inherit a giant's customers by pricing well.
    const pot = Math.min(county.depositPool, Math.max(held, natural));
    const targets = splitCounty(pot, 1, attract);
    list.forEach((x, i) => {
      const t = targets[i] ?? 0;
      x.br.competitiveTarget = Math.min(t, Math.max(Math.round((own[i] ?? 0) * 1.25), x.br.deposits));
    });
  }
}

// Target by type for the whole bank: the sum over branches, then the
// rate sheet and confidence move each type on its own sensitivity.
export function depositTargets(world: World, b: Bank): Record<DepositType, number> {
  let base = 0;
  for (const br of b.branches) base += branchTarget(world, b, br);
  // Without geography the bank's addressable pool stands in for its home
  // county (tests); the franchise is treated as the home branch.
  if (b.branches.length === 0) base = b.franchise.pool > 0 ? branchTarget(world, b, { id: '', county: b.homeCounty ?? '', openedDay: b.franchise.openedDay, deposits: coreDeposits(b), fixedCost: 0, distanceKm: 0, competitiveTarget: null }, true) : coreDeposits(b);
  const conf = Math.pow(Math.max(0, Math.min(1, b.confidence)), 3);
  const out = {} as Record<DepositType, number>;
  const elasticity = calibration.depositRateElasticity.typical / 100;
  for (const t of DEPOSIT_TYPES) {
    const gap = b.rates[t] - marketRate(world, t);
    const rateFactor = Math.max(0.2, 1 + elasticity * SENSITIVITY[t] * (gap / 0.01));
    out[t] = Math.round(base * DEFAULT_MIX[t] * rateFactor * conf);
  }
  return out;
}

export function depositsDaily(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status !== 'open' && b.status !== 'closing') continue;
    if (b.branches.length === 0 && b.franchise.pool <= 0) continue;
    const targets = depositTargets(world, b);
    const entry: Partial<Record<DepositType | 'cash', number>> = {};
    let flow = 0;
    const current = coreDeposits(b);
    for (const t of DEPOSIT_TYPES) {
      const bal = b.acct[t];
      const drift = ((targets[t] - bal) * SPEED[t]) / 30;
      const noise = randNormal(world.rng, 0, Math.max(500, bal * 0.0012));
      let x = Math.round(drift + noise);
      // A run: uninsured money leaves fast when confidence breaks.
      if (b.confidence < 0.8) {
        const speed = Math.pow(0.8 - b.confidence, 2) * 0.15;
        x -= Math.round(bal * UNINSURED[t] * speed);
      }
      if (x < -bal) x = -bal;
      if (x !== 0) {
        entry[t] = x;
        flow += x;
      }
    }
    if (flow === 0) continue;
    entry.cash = flow;
    post(b.acct, entry);
    allocateToBranches(world, b, flow);
    // Only the player's own big days make the feed: a twentieth of the
    // book in one day, not every rival's ordinary week.
    if (b.id === world.playerBankId && current > 0 && Math.abs(flow) > 0.05 * current) {
      emit(ctx, 'depositor', `${b.name}: ${flow > 0 ? 'inflow' : 'outflow'} of ${money(Math.abs(flow))} in a day${b.confidence < 0.8 ? ' as uninsured depositors leave' : ''}`, {
        severity: flow < 0 ? 'alert' : 'info',
        bankId: b.id,
      });
    }
    coverCash(ctx, b);
  }
}

function allocateToBranches(world: World, b: Bank, flow: number): void {
  if (b.branches.length === 0) return;
  if (b.branches.length === 1) {
    (b.branches[0] as Branch).deposits = coreDeposits(b);
    return;
  }
  let weight = 0;
  const w = b.branches.map((br) => {
    const x = Math.max(1, branchTarget(world, b, br));
    weight += x;
    return x;
  });
  b.branches.forEach((br, i) => {
    br.deposits = Math.max(0, br.deposits + Math.round((flow * (w[i] as number)) / weight));
  });
}

// A bank short of cash borrows overnight, then draws FHLB, then sells AFS
// securities at fair value. If nothing covers the withdrawals it is
// closed: a liquidity failure.
export function coverCash(ctx: Ctx, b: Bank): void {
  const { world } = ctx;
  const a = b.acct;
  if (a.cash >= 0) {
    if (a.fedFundsPurchased > 0) {
      const cushion = Math.round(0.03 * totalAssets(a));
      const repay = Math.min(a.fedFundsPurchased, Math.max(0, a.cash - cushion));
      if (repay > 0) post(a, { cash: -repay, fedFundsPurchased: -repay });
    }
    b.liquidityStress = Math.max(0, b.liquidityStress - 0.02);
    return;
  }
  let need = -a.cash;
  // Overnight unsecured funding dries up when confidence is gone.
  const ffCap = b.confidence >= 0.5 ? Math.round(0.1 * totalAssets(a)) - a.fedFundsPurchased : 0;
  const ff = Math.max(0, Math.min(need, ffCap));
  if (ff > 0) {
    post(a, { cash: ff, fedFundsPurchased: ff });
    need -= ff;
  }
  if (need > 0) {
    const drawn = borrowFhlb(ctx, b, Math.min(need, fhlbCapacity(b)), true);
    need -= drawn;
  }
  if (need > 0) {
    for (const lot of [...b.lots]) {
      if (need <= 0) break;
      if (lot.kind !== 'afs') continue;
      const proceeds = sellSecurities(ctx, b, lot.id, Math.min(lot.cost, Math.round(need * 1.05)), true);
      need -= proceeds;
    }
  }
  const wasCalm = b.liquidityStress < 0.3;
  b.liquidityStress = Math.min(1, b.liquidityStress + 0.25);
  if (a.cash < 0) {
    // Still short: the bank cannot meet withdrawals.
    const shortfall = -a.cash;
    post(a, { cash: shortfall, fedFundsPurchased: shortfall });
    if (b.status === 'open') {
      b.status = 'closing';
      b.closureDay = nextFriday(world.day);
      emit(ctx, 'regulator', `${b.name} could not meet ${money(shortfall)} of withdrawals. Regulators scheduled closure.`, { severity: 'alert', bankId: b.id });
    }
  } else if (b.id === world.playerBankId && wasCalm) {
    emit(ctx, 'market', `${b.name} covered withdrawals with borrowings and securities sales`, { severity: 'alert', bankId: b.id });
  }
}

// Confidence: capital, unrealized losses against capital, credit
// trouble, and recent failures nearby. Moves halfway to its target each
// month so a run builds over weeks, not a day.
export function confidenceTarget(world: World, b: Bank): number {
  let c = 1;
  const lev = leverageRatio(b.acct);
  if (lev < 0.06) c -= (0.06 - lev) * 15;
  const u = unrealizedToCapital(b);
  if (u > 0.25) c -= (u - 0.25) * 0.9;
  let nonaccrual = 0;
  for (const p of b.pools) nonaccrual += (p.grades[6] ?? 0) + (p.grades[7] ?? 0) + (p.grades[8] ?? 0);
  const na = b.acct.loans > 0 ? nonaccrual / b.acct.loans : 0;
  if (na > 0.04) c -= (na - 0.04) * 4;
  c -= 0.08 * recentFailures(world, b.state, 6);
  c -= 0.3 * b.liquidityStress;
  return Math.max(0.05, Math.min(1, c));
}

export function recentFailures(world: World, state: string, months: number): number {
  let n = 0;
  for (const id of world.bankOrder) {
    const x = world.banks[id] as Bank;
    if (x.status === 'failed' && x.state === state && x.failedDay !== null && world.day - x.failedDay < months * 30) n += 1;
  }
  return n;
}

export function depositsMonthly(ctx: Ctx): void {
  const { world } = ctx;
  const ff = world.economy.fedFunds;
  competeCounties(world);
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status === 'failed' || b.status === 'acquired') continue;
    // Banks without an AI follow the market by beta; rivals set their sheets
    // in rivalsMonthly; the player sets the sheet by hand.
    if (b.id !== world.playerBankId && !b.ai) {
      for (const t of DEPOSIT_TYPES) b.rates[t] = Math.max(0, Math.round(ff * calibration.depositBeta[t].typical * 10_000) / 10_000);
    }
    b.fhlbRate = ff + 0.003;
    b.fedFundsRate = ff + 0.001;
    if (b.acct.brokered > 0) b.brokeredRate = Math.max(b.brokeredRate, ff + 0.002);
    // Confidence and the uninsured share.
    const target = confidenceTarget(world, b);
    const prev = b.confidence;
    b.confidence += 0.5 * (target - b.confidence);
    if (b.id === world.playerBankId && b.confidence < 0.8 && prev >= 0.8) {
      emit(ctx, 'depositor', `Depositor confidence is slipping (${pct(b.confidence, 0)}). Uninsured money is starting to move.`, { severity: 'alert', bankId: b.id });
    }
    const core = coreDeposits(b);
    let un = 0;
    for (const t of DEPOSIT_TYPES) un += b.acct[t] * UNINSURED[t];
    const sizeTilt = Math.min(0.25, Math.max(0, Math.log10(Math.max(1, totalAssets(b.acct)) / 1e8) * 0.05));
    b.uninsuredShare = core > 0 ? Math.min(0.9, un / core + sizeTilt) : 0.3;
  }
  ratePrompt(ctx);
}

// Now and then the market asks the player about the rate sheet.
function ratePrompt(ctx: Ctx): void {
  const { world } = ctx;
  const b = playerBank(world);
  if (!b || b.status !== 'open') return;
  if (world.pending.some((p) => p.kind === 'rate_prompt')) return;
  const gap = marketDepositRate(world) - bankDepositRate(b);
  if (gap > 0.0075 && chance(world.rng, 0.2)) {
    addPending(ctx, {
      kind: 'rate_prompt',
      bankId: b.id,
      title: 'Depositors are asking about your rates',
      lines: [
        `The market pays ${pct(marketDepositRate(world))} on an average dollar of deposits. You pay ${pct(bankDepositRate(b))}.`,
        `Money market and CD customers move first. Match the market, or hold and keep the margin.`,
      ],
      options: [
        { key: 'm', label: 'Match the market on every type' },
        { key: 'h', label: 'Hold the sheet' },
      ],
      data: {},
    });
  }
}

export function decideRatePrompt(ctx: Ctx, pending: Pending, d: Decision): void {
  const { world } = ctx;
  const b = pending.bankId ? world.banks[pending.bankId] : undefined;
  if (!b) return;
  if (d.choice === 'm') {
    for (const t of DEPOSIT_TYPES) b.rates[t] = Math.round(marketRate(world, t) * 10_000) / 10_000;
    emit(ctx, 'depositor', `Rate sheet moved to market`, { bankId: b.id });
  }
}

// Player controls.
export function setRate(world: World, t: DepositType, rate: number): void {
  const b = playerBank(world);
  if (b) b.rates[t] = Math.max(0, Math.round(rate * 10_000) / 10_000);
}

export function openBranch(ctx: Ctx, county: CountyState): Branch | null {
  const { world } = ctx;
  const b = playerBank(world);
  if (!b || b.status !== 'open') return null;
  if (b.branches.some((br) => br.county === county.fips)) return null;
  const home = b.homeCounty ? world.geo.counties[b.homeCounty] : undefined;
  const distanceKm = home ? km(home.centroid, county.centroid) : 0;
  // Opening costs a year of the branch's fixed cost up front as premises.
  const fixedCost = branchFixedCost(county);
  const premises = Math.round(fixedCost * 1.0);
  if (b.acct.cash < premises) return null;
  post(b.acct, { cash: -premises, premises });
  const br: Branch = { id: nextId(world, 'br'), county: county.fips, openedDay: world.day, deposits: 0, fixedCost, distanceKm: Math.round(distanceKm), competitiveTarget: null };
  b.branches.push(br);
  emit(ctx, 'system', `Opened a branch in ${county.name}, ${county.state}: ${money(premises)} of premises, ${money(fixedCost)} a year to run, ${Math.round(distanceKm)} km from home`, { severity: 'good', bankId: b.id });
  return br;
}

export function closeBranch(ctx: Ctx, branchId: string): boolean {
  const { world } = ctx;
  const b = playerBank(world);
  if (!b) return false;
  const br = b.branches.find((x) => x.id === branchId);
  if (!br || br.county === b.homeCounty) return false;
  // Premises written off, a quarter of the fixed cost as severance.
  const writeOff = Math.round(br.fixedCost * 0.5);
  const severance = Math.round(br.fixedCost * 0.25);
  const premisesOut = Math.min(b.acct.premises, writeOff);
  post(b.acct, { premises: -premisesOut, cash: -severance, retainedEarnings: -(premisesOut + severance) });
  b.is.month.otherExpense += premisesOut + severance;
  b.branches = b.branches.filter((x) => x.id !== branchId);
  const county = world.geo.counties[br.county];
  emit(ctx, 'system', `Closed the branch in ${county ? county.name : br.county}. ${money(br.deposits)} of deposits will drift away.`, { severity: 'alert', bankId: b.id });
  return true;
}

export { DEFAULT_MIX, UNINSURED };
