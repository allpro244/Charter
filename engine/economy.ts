// Rates and the economy (SYSTEMS.md Part 1, system 2). Monthly.
// Regime-switching national cycle, Fed funds path, yield curve, national
// series, one index per sector, and county condition from real exposure (D41).

import { calibration } from '../data/calibration';
import { SECTORS, type Sector } from '../data/types';
import { type Ctx, emit, milestone } from './ctx';
import { type Economy, type Regime, type World } from './state';
import { chance, randNormal } from './rng';
import { pct } from './format';

// Monthly transition probabilities. Expansion about 4 years, late cycle about
// 2, recession about 1, recovery about 1.5: a cycle near 8.5 years, inside
// the 7 to 12 year band from NBER dates.
const P_EXPANSION_TO_LATE = 1 / 48;
const P_LATE_TO_RECESSION = 1 / 24;
const P_LATE_TO_EXPANSION = 1 / 72;
const P_RECESSION_TO_RECOVERY = 1 / 11;
const P_CRISIS_TO_RECOVERY = 1 / 16;
const P_RECOVERY_TO_EXPANSION = 1 / 18;

interface RegimeParams {
  fedTarget: number; // where the Fed wants to be, before inflation reaction
  y2Spread: number;
  y10Spread: number;
  gdp: number;
  unemployment: number;
  inflation: number;
  hpiGrowth: number;
}

const REGIME: Record<Regime, RegimeParams> = {
  expansion: { fedTarget: 0.03, y2Spread: 0.004, y10Spread: 0.011, gdp: 0.025, unemployment: 0.042, inflation: 0.025, hpiGrowth: 0.045 },
  late: { fedTarget: 0.0475, y2Spread: -0.004, y10Spread: -0.006, gdp: 0.02, unemployment: 0.037, inflation: 0.035, hpiGrowth: 0.06 },
  recession: { fedTarget: 0.0075, y2Spread: -0.006, y10Spread: 0.006, gdp: -0.02, unemployment: 0.07, inflation: 0.015, hpiGrowth: -0.03 },
  recovery: { fedTarget: 0.0125, y2Spread: 0.006, y10Spread: 0.016, gdp: 0.025, unemployment: 0.06, inflation: 0.02, hpiGrowth: 0.01 },
};

// Sector betas to the national cycle and own volatility (annual). Energy
// also follows oil; construction follows home prices. Realism first: these
// are structural facts about the sectors, not tuning knobs.
interface SectorParams {
  beta: number;
  oilBeta: number;
  hpiBeta: number;
  drift: number;
  sigma: number;
}

const SECTOR: Record<Sector, SectorParams> = {
  energy: { beta: 0.6, oilBeta: 0.7, hpiBeta: 0, drift: 0.0, sigma: 0.12 },
  agriculture: { beta: 0.3, oilBeta: 0.1, hpiBeta: 0, drift: 0.005, sigma: 0.1 },
  manufacturing: { beta: 1.6, oilBeta: -0.05, hpiBeta: 0, drift: 0.0, sigma: 0.06 },
  tech: { beta: 1.8, oilBeta: 0, hpiBeta: 0, drift: 0.02, sigma: 0.12 },
  finance: { beta: 1.5, oilBeta: 0, hpiBeta: 0.3, drift: 0.01, sigma: 0.08 },
  healthcare: { beta: 0.3, oilBeta: 0, hpiBeta: 0, drift: 0.015, sigma: 0.03 },
  government: { beta: 0.05, oilBeta: 0, hpiBeta: 0, drift: 0.005, sigma: 0.02 },
  tourism: { beta: 1.5, oilBeta: -0.1, hpiBeta: 0, drift: 0.01, sigma: 0.08 },
  construction: { beta: 1.4, oilBeta: 0, hpiBeta: 1.2, drift: 0.005, sigma: 0.08 },
  logistics: { beta: 1.2, oilBeta: -0.1, hpiBeta: 0, drift: 0.01, sigma: 0.05 },
  other: { beta: 1.0, oilBeta: 0, hpiBeta: 0, drift: 0.01, sigma: 0.03 },
};

const OIL_MEAN = 70;
const OIL_SIGMA_MONTHLY = 0.09;
const P_OIL_BUST = 1 / 84; // a large negative jump about every 7 years
const P_OIL_SPIKE = 1 / 96;

function step(e: Economy, r: World['rng'], ctx: Ctx): void {
  const prev = e.regime;
  let next: Regime = prev;
  switch (prev) {
    case 'expansion':
      if (chance(r, P_EXPANSION_TO_LATE)) next = 'late';
      break;
    case 'late':
      if (chance(r, P_LATE_TO_RECESSION)) next = 'recession';
      else if (chance(r, P_LATE_TO_EXPANSION)) next = 'expansion';
      break;
    case 'recession':
      if (chance(r, e.crisis ? P_CRISIS_TO_RECOVERY : P_RECESSION_TO_RECOVERY)) next = 'recovery';
      break;
    case 'recovery':
      if (chance(r, P_RECOVERY_TO_EXPANSION)) next = 'expansion';
      break;
  }
  if (next !== prev) {
    e.regime = next;
    e.regimeMonths = 0;
    if (next === 'recession') {
      e.crisis = chance(r, calibration.bankingCrisisShare.typical);
      e.recessions.push({ startMonth: e.month, endMonth: null, crisis: e.crisis });
      e.monthsSinceRecession = 0;
      milestone(ctx, e.crisis ? 'A banking crisis began' : 'A recession began');
    } else if (prev === 'recession') {
      const rec = e.recessions[e.recessions.length - 1];
      if (rec) rec.endMonth = e.month;
      milestone(ctx, 'The recession ended');
    }
  } else {
    e.regimeMonths += 1;
  }
  if (e.regime !== 'recession') e.monthsSinceRecession += 1;
}

function fedStep(e: Economy, r: World['rng'], ctx: Ctx): void {
  const p = REGIME[e.regime];
  // Taylor-style: regime target plus reaction to inflation above 2%.
  const target = Math.max(0.001, p.fedTarget + 0.5 * (e.inflation - 0.02) + (e.crisis && e.regime === 'recession' ? -0.005 : 0));
  const gap = target - e.fedFunds;
  const before = e.fedFunds;
  // The Fed moves in 25bp steps most months when away from target, and in
  // 50bp steps when far away or in a recession.
  if (Math.abs(gap) >= 0.00125 && chance(r, 0.6)) {
    const size = Math.abs(gap) > 0.015 || e.regime === 'recession' ? 0.005 : 0.0025;
    const move = Math.sign(gap) * Math.min(size, Math.abs(gap));
    e.fedFunds = Math.round((e.fedFunds + move) * 10_000) / 10_000;
  }
  e.fedFunds = Math.max(0.001, e.fedFunds);
  e.fedPath.push(e.fedFunds);
  if (e.fedPath.length > 24) e.fedPath.shift();
  if (e.fedFunds !== before) {
    const dir = e.fedFunds > before ? 'raised' : 'cut';
    emit(ctx, 'market', `Fed ${dir} the funds rate ${Math.round(Math.abs(e.fedFunds - before) * 10_000)}bp to ${pct(e.fedFunds)}`, {
      severity: 'info',
    });
  }
  const wasInverted = e.curve.y10 < e.curve.m3;
  e.curve.m3 = e.fedFunds + 0.0005 + randNormal(r, 0, 0.0003);
  e.curve.y2 = Math.max(0.001, e.fedFunds + p.y2Spread + randNormal(r, 0, 0.0015));
  e.curve.y10 = Math.max(0.005, e.fedFunds + p.y10Spread + randNormal(r, 0, 0.002));
  e.curve.y30 = e.curve.y10 + 0.003 + randNormal(r, 0, 0.001);
  const inverted = e.curve.y10 < e.curve.m3;
  if (inverted && !wasInverted) emit(ctx, 'market', `Yield curve inverted: 10 year ${pct(e.curve.y10)} below 3 month ${pct(e.curve.m3)}`, { severity: 'alert' });
  if (!inverted && wasInverted) emit(ctx, 'market', `Yield curve steepened: 10 year ${pct(e.curve.y10)} above 3 month ${pct(e.curve.m3)}`);
}

function nationalStep(e: Economy, r: World['rng'], ctx: Ctx): void {
  const p = REGIME[e.regime];
  const crisisPull = e.crisis && e.regime === 'recession' ? 1 : 0;
  const gdpTarget = p.gdp - 0.015 * crisisPull;
  e.gdpGrowth += 0.25 * (gdpTarget - e.gdpGrowth) + randNormal(r, 0, 0.004);
  const uTarget = p.unemployment + 0.02 * crisisPull;
  const prevU = e.unemployment;
  e.unemployment += (e.regime === 'recession' ? 0.15 : 0.06) * (uTarget - e.unemployment) + randNormal(r, 0, 0.0008);
  e.unemployment = Math.max(0.025, e.unemployment);
  if (Math.round(e.unemployment * 1000) !== Math.round(prevU * 1000) && Math.abs(e.unemployment - prevU) > 0.002) {
    emit(ctx, 'market', `Unemployment ${e.unemployment > prevU ? 'rose' : 'fell'} to ${pct(e.unemployment, 1)}`);
  }
  e.inflation += 0.1 * (p.inflation - e.inflation) + randNormal(r, 0, 0.0015);
  e.inflation = Math.max(-0.01, e.inflation);
  const hpiMonthly = (p.hpiGrowth - 0.07 * crisisPull) / 12 + randNormal(r, 0, 0.004);
  e.hpi *= 1 + hpiMonthly;
  e.hpiGrowth = e.hpiGrowth * (11 / 12) + hpiMonthly;
  if (e.month % 12 === 11) {
    emit(ctx, 'market', `Home prices ${e.hpiGrowth >= 0 ? 'up' : 'down'} ${pct(Math.abs(e.hpiGrowth), 1)} over the year`);
  }
  // Oil: mean reverting in logs with jumps.
  let oilRet = -0.02 * Math.log(e.oil / OIL_MEAN) + randNormal(r, 0, OIL_SIGMA_MONTHLY);
  if (chance(r, P_OIL_BUST)) oilRet -= 0.35 + 0.2 * randNormal(r, 0, 1) ** 2 * 0.25;
  if (chance(r, P_OIL_SPIKE)) oilRet += 0.3;
  if (e.regime === 'recession') oilRet -= 0.02;
  const prevOil = e.oil;
  e.oil = Math.max(8, e.oil * Math.exp(oilRet));
  if (Math.abs(e.oil / prevOil - 1) > 0.1) {
    emit(ctx, 'market', `Oil ${e.oil > prevOil ? 'jumped' : 'fell'} to $${e.oil.toFixed(0)} from $${prevOil.toFixed(0)}`, {
      severity: e.oil < prevOil ? 'alert' : 'info',
    });
  }
  // Equities follow earnings and the regime, loosely.
  const spRet = (e.gdpGrowth - 0.005) / 12 + (e.regime === 'recession' ? -0.02 : 0.004) + randNormal(r, 0, 0.04);
  e.sp500 = Math.max(100, e.sp500 * (1 + spRet));
}

function sectorStep(e: Economy, r: World['rng']): void {
  const oilRet = Math.log(e.oil / (e.oilPrev ?? e.oil));
  const hpiRet = Math.log(e.hpi / (e.hpiPrev ?? e.hpi));
  const gdpDev = (e.gdpGrowth - 0.02) / 12;
  for (const s of SECTORS) {
    const p = SECTOR[s];
    let ret = p.drift / 12 + p.beta * gdpDev + p.oilBeta * oilRet + p.hpiBeta * hpiRet + randNormal(r, 0, p.sigma / Math.sqrt(12));
    if (e.crisis && e.regime === 'recession' && (s === 'finance' || s === 'construction')) ret -= 0.01;
    e.sectorMomentum[s] = ret;
    e.sectors[s] *= Math.exp(ret);
  }
}

// County condition: the weighted sum of sector moves by real employment
// share, relative to the national mix. Local home prices follow the national
// index tilted by condition. (D41)
export function countyStep(world: World): void {
  const e = world.economy;
  // Deposit pools grow with nominal income: real growth plus inflation.
  const nominal = 1 + (e.gdpGrowth + e.inflation) / 12;
  for (const id of world.bankOrder) {
    const b = world.banks[id];
    if (b && b.franchise.pool > 0) b.franchise.pool = Math.round(b.franchise.pool * nominal);
  }
  for (const c of Object.values(world.geo.counties)) {
    c.depositPool = Math.round(c.depositPool * nominal);
    let local = 0;
    for (const s of SECTORS) local += (c.sectors[s] ?? 0) * e.sectorMomentum[s];
    c.condition *= Math.exp(local - e.nationalMomentum);
    // Local home prices: national move plus a third of the local gap.
    const hpiMove = Math.log(e.hpi / (e.hpiPrev ?? e.hpi));
    c.localHpi *= Math.exp(hpiMove + 0.35 * (local - e.nationalMomentum));
  }
}

export function economyMonthly(ctx: Ctx): void {
  const { world } = ctx;
  const e = world.economy;
  const r = world.rng;
  // Previous values are last month's recorded ones, so a shock applied
  // between closes (a scripted bust, a test) is seen by the sector step.
  const last = e.hist[e.hist.length - 1];
  e.oilPrev = last ? last.oil : e.oil;
  e.hpiPrev = last ? last.hpi : e.hpi;
  step(e, r, ctx);
  fedStep(e, r, ctx);
  nationalStep(e, r, ctx);
  sectorStep(e, r);
  // National momentum is the employment-weighted sector move. Without
  // geography, use the plain mean.
  let nm = 0;
  let w = 0;
  const shares = world.geo.nationalShares;
  for (const s of SECTORS) {
    const share = shares ? (shares[s] ?? 0) : 1 / SECTORS.length;
    nm += share * e.sectorMomentum[s];
    w += share;
  }
  e.nationalMomentum = w > 0 ? nm / w : 0;
  countyStep(world);
  e.hist.push({ month: e.month, sectors: { ...e.sectors }, hpi: e.hpi, unemployment: e.unemployment, oil: e.oil });
  if (e.hist.length > 13) e.hist.shift();
  e.month += 1;
}

// Twelve month log return of a sector index, or of home prices.
export function sectorReturn12(e: Economy, s: Sector): number {
  const first = e.hist[0];
  if (!first) return 0;
  return Math.log(e.sectors[s] / first.sectors[s]);
}

export function hpiReturn12(e: Economy): number {
  const first = e.hist[0];
  if (!first) return 0;
  return Math.log(e.hpi / first.hpi);
}

// Pure helper for tests and the desk: the local move for an exposure vector.
export function exposureMove(shares: Record<Sector, number>, momentum: Record<Sector, number>): number {
  let x = 0;
  for (const s of SECTORS) x += (shares[s] ?? 0) * momentum[s];
  return x;
}
