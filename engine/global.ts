// The global stage (D45, SYSTEMS.md system 11 geography, D14 G-SIB). A
// country layer with its own index, policy rate, currency, deposit pool,
// regulator and sovereign risk. Foreign subsidiaries keep books in local
// currency, run the same pool and deposit code, and translate into the
// consolidated dollar ledger at each close with the difference in AOCI.
// Cross-border deals buy generated local banks. G-SIB designation at $1T
// adds a capital surcharge and a compliance cost.

import { calibration } from '../data/calibration';
import { type Ctx, addPending, emit, milestone } from './ctx';
import { TYPE, emptyPool } from './credit';
import { DEPOSIT_TYPES, type Account, type Accounts, emptyAccounts, post, totalAssets, totalDeposits, totalEquity } from './ledger';
import { GRADES, type LoanType } from './loantypes';
import { PCA_WELL, THRESHOLD_GSIB } from './regulation';
import { chance, derive, hashString, randNormal, rand } from './rng';
import { type Bank, type Country, type CountryCode, type ForeignOp, type World, nextId, playerBank } from './state';
import { money, pct } from './format';

export const COUNTRY_CODES: CountryCode[] = ['GB', 'JP', 'DE', 'HK'];
export const GLOBAL_FLOOR = 250e9; // the national stage before going abroad (D25)

// Monthly: each country's cycle follows the US with its beta plus its
// own shocks; the policy rate follows its own inflation and growth; the
// currency drifts with the rate gap and moves with the country's index.
export function countriesMonthly(ctx: Ctx): void {
  const { world } = ctx;
  const us = world.economy;
  const r = world.rng;
  const vol = calibration.fxVolatility.typical / 100 / Math.sqrt(12);
  for (const c of Object.values(world.countries)) {
    const band = calibration.countries[c.code];
    const beta = band.beta.typical / 100;
    const own = randNormal(r, 0, 0.012);
    const drift = c.regime === 'recession' ? -0.02 / 12 : 0.02 / 12;
    const move = drift + beta * us.nationalMomentum + own;
    c.momentum = move;
    c.index *= Math.exp(move);
    // Regime follows the index over the year.
    c.regime = move < -0.006 ? 'recession' : move < 0 ? 'late' : c.regime === 'recession' ? 'recovery' : 'expansion';
    // Policy rate: toward the US rate plus the country's own gap, slowly.
    const target = Math.max(-0.001, us.fedFunds + (band.rate.typical / 100 - 0.0533) + (c.regime === 'recession' ? -0.01 : 0));
    c.rate += 0.15 * (target - c.rate);
    c.y10 = c.rate + 0.005 + c.sovereignSpread + randNormal(r, 0, 0.001);
    // Currency: interest parity drift plus noise; a pegged currency stays.
    if (c.code === 'HK') c.fx = Math.max(7.75, Math.min(7.85, c.fx + randNormal(r, 0, 0.01)));
    else c.fx *= Math.exp((us.fedFunds - c.rate) / 12 - 0.3 * move + randNormal(r, 0, vol));
    // Sovereign stress builds in recessions and can break.
    c.sovereignStress = Math.max(0, Math.min(1, c.sovereignStress + (c.regime === 'recession' ? 0.03 : -0.02)));
    const hazard = (calibration.sovereignEventPerYear.typical / 100 / 12) * (1 + 4 * c.sovereignStress);
    if (chance(r, hazard) && (c.lastEvent === null || world.day - c.lastEvent > 5 * 365)) sovereignEvent(ctx, c);
    c.depositPool = Math.round(c.depositPool * (1 + 0.035 / 12));
  }
}

// A sovereign event: bonds take a haircut, the currency drops, the index
// falls, the spread widens. Every subsidiary there feels it.
export function sovereignEvent(ctx: Ctx, c: Country): void {
  const { world } = ctx;
  c.lastEvent = world.day;
  c.sovereignSpread += 0.02;
  c.index *= 0.88;
  c.momentum -= 0.12;
  if (c.code !== 'HK') c.fx *= 1.2;
  c.sovereignStress = 0;
  const haircut = 0.2;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    for (const f of b.foreign) {
      if (f.country !== c.code || f.sovereignBonds <= 0) continue;
      const loss = Math.round(f.sovereignBonds * haircut);
      post(f.acct, { securitiesHTM: -loss, retainedEarnings: -loss });
      f.sovereignBonds -= loss;
      f.lots.forEach((l) => {
        if (l.product === 'treasury') l.cost = Math.round(l.cost * (1 - haircut));
      });
      if (b.id === world.playerBankId) emit(ctx, 'market', `${c.name} sovereign event: ${money(Math.round(loss / c.fx))} haircut on ${f.name}'s government bonds, ${c.currency} down ${c.code === 'HK' ? '0%' : '17%'}`, { severity: 'alert', bankId: b.id });
    }
  }
  emit(ctx, 'market', `${c.name}: sovereign debt crisis. Spreads up 200bp, ${c.currency} ${c.code === 'HK' ? 'held by the peg' : 'down 17%'}, activity down 12%`, { severity: 'alert' });
}

export function canGoGlobal(b: Bank): boolean {
  return totalAssets(b.acct) >= GLOBAL_FLOOR && b.holdingCompany && b.enforcement === 'none';
}

// Generated local banks for sale in a country, priced to book in the
// country's cycle. Deterministic per world and country.
export interface ForeignCandidate {
  key: string;
  country: CountryCode;
  name: string;
  assetsLocal: number;
  depositsLocal: number;
  equityLocal: number;
  priceToBook: number;
  priceUsd: number;
}

const FOREIGN_NAMES: Record<CountryCode, string[]> = {
  GB: ['Thames Mercantile Bank', 'Northern Counties Bank', 'Albion Savings', 'Clydeside Bank', 'Wessex and Mercia Bank'],
  JP: ['Kanto Shinkin Bank', 'Osaka Trust Bank', 'Tohoku Regional Bank', 'Nagoya Commerce Bank', 'Kyushu Sogo Bank'],
  DE: ['Rheinische Handelsbank', 'Hanseatische Sparbank', 'Bayerische Gewerbebank', 'Sachsen Kreditbank', 'Westfalen Volksbank'],
  HK: ['Victoria Harbour Bank', 'Kowloon Commercial Bank', 'Pearl River Finance', 'Lantau Trust Bank', 'Wan Chai Banking Corp'],
};

export function foreignCandidates(world: World, code: CountryCode): ForeignCandidate[] {
  const c = world.countries[code];
  if (!c) return [];
  const r = derive(world.seed, hashString(`foreign:${code}:${Math.floor(world.day / 365)}`));
  const out: ForeignCandidate[] = [];
  const names = FOREIGN_NAMES[code];
  for (let i = 0; i < 3; i++) {
    const assetsUsd = 10e9 * Math.exp(randNormal(r, 0.5, 0.8));
    const assetsLocal = Math.round(assetsUsd * c.fx);
    const equityLocal = Math.round(assetsLocal * (0.05 + 0.04 * rand(r)));
    const depositsLocal = Math.round(assetsLocal * (0.65 + 0.15 * rand(r)));
    const band = c.regime === 'recession' ? calibration.dealPriceToBook.recession : calibration.dealPriceToBook.expansion;
    const pb = Math.max(0.4, band.typical / 100 * 0.8 + randNormal(r, 0, 0.1));
    out.push({ key: String(i + 1), country: code, name: names[i % names.length] as string, assetsLocal, depositsLocal, equityLocal, priceToBook: Math.round(pb * 100) / 100, priceUsd: Math.round((equityLocal * pb) / c.fx) });
  }
  return out;
}

// Buys a local bank: a subsidiary appears with the target's book in local
// currency; the parent pays the price in dollars, goodwill for the excess
// over book. Approval by the foreign regulator takes six months, modeled
// as a pending item that closes on expiry.
export function offerForeign(ctx: Ctx, b: Bank, cand: ForeignCandidate): { ok: boolean; why: string } {
  const { world } = ctx;
  if (!canGoGlobal(b)) return { ok: false, why: `needs ${money(GLOBAL_FLOOR)} of assets, a holding company, and no enforcement action` };
  const cash = b.acct.cash - Math.round(totalAssets(b.acct) * 0.04);
  if (cand.priceUsd > cash) return { ok: false, why: `price ${money(cand.priceUsd)} exceeds spendable cash ${money(cash)}` };
  if (world.pending.some((p) => p.kind === 'acquisition_offer')) return { ok: false, why: 'a deal is already pending' };
  const c = world.countries[cand.country] as Country;
  addPending(ctx, {
    kind: 'acquisition_offer',
    bankId: b.id,
    title: `Agreed: ${cand.name} (${c.name}) at ${cand.priceToBook.toFixed(2)}x book, ${money(cand.priceUsd)}. Approval by the ${c.name} regulator expected in six months.`,
    lines: [`Assets ${money(Math.round(cand.assetsLocal / c.fx))}, deposits ${money(Math.round(cand.depositsLocal / c.fx))} in ${c.currency}. Books stay in ${c.currency}; translation goes through AOCI.`, `Walk away before closing and pay a ${money(Math.round(cand.priceUsd * 0.02))} break fee.`],
    options: [{ key: 'w', label: 'Walk away (break fee)' }],
    data: { foreign: cand },
    expires: world.day + 182,
  });
  emit(ctx, 'system', `Agreed to buy ${cand.name} in ${c.city} for ${money(cand.priceUsd)}`, { severity: 'good', bankId: b.id });
  return { ok: true, why: 'agreed' };
}

export function closeForeign(ctx: Ctx, b: Bank, cand: ForeignCandidate): ForeignOp {
  const { world } = ctx;
  const c = world.countries[cand.country] as Country;
  const acct = emptyAccounts();
  const loans = Math.round(cand.assetsLocal * 0.6);
  const securities = Math.round(cand.assetsLocal * 0.2);
  acct.loans = loans;
  acct.securitiesHTM = securities;
  acct.checking = Math.round(cand.depositsLocal * 0.35);
  acct.savings = Math.round(cand.depositsLocal * 0.35);
  acct.mmda = Math.round(cand.depositsLocal * 0.2);
  acct.cd = cand.depositsLocal - acct.checking - acct.savings - acct.mmda;
  acct.commonStock = cand.equityLocal;
  const funding = cand.depositsLocal + cand.equityLocal;
  acct.cash = funding - loans - securities;
  if (acct.cash < 0) {
    acct.fhlb = -acct.cash; // wholesale funding in the local market
    acct.cash = 0;
  }
  const op: ForeignOp = {
    id: nextId(world, 'fo'),
    country: cand.country,
    name: cand.name,
    acct,
    pools: [],
    lots: [],
    rates: { checking: 0, savings: c.rate * 0.3, mmda: c.rate * 0.5, cd: c.rate * 0.8 },
    loanYield: c.rate + 0.025,
    overheadRate: 0.02,
    franchise: { baseShare: cand.depositsLocal / c.depositPool, targetShare: cand.depositsLocal / c.depositPool, openedDay: world.day - 20 * 365 },
    carried: emptyAccounts(),
    startedDay: world.day,
    sovereignBonds: securities,
  };
  // The book as pools: local C&I, CRE and mortgages.
  const mix: [LoanType, number][] = [['ci', 0.35], ['cre_inv', 0.25], ['resi', 0.4]];
  let assigned = 0;
  for (const [t, share] of mix) {
    const amount = t === 'resi' ? loans - assigned : Math.round(loans * share);
    assigned += amount;
    const p = emptyPool(t, 2024 + Math.floor(world.day / 365), c.rate + TYPE[t].spread);
    p.balance = amount;
    p.origBalance = amount;
    p.count = Math.max(1, Math.round(amount / (TYPE[t].avgSize * c.fx)));
    const dist = [0.05, 0.15, 0.3, 0.25, 0.15, 0.05, 0.03, 0.015, 0.005];
    let g = 0;
    for (let k = 0; k < GRADES; k++) {
      const x = k === GRADES - 1 ? amount - g : Math.round(amount * (dist[k] ?? 0));
      p.grades[k] = x;
      g += x;
    }
    op.pools.push(p);
  }
  b.foreign.push(op);
  // The parent pays: cash out, goodwill for the price above book, and the
  // subsidiary's net assets come onto the ledger through translation.
  const bookUsd = Math.round(cand.equityLocal / c.fx);
  const goodwill = Math.max(0, cand.priceUsd - bookUsd);
  post(b.acct, { cash: -cand.priceUsd, goodwill, otherAssets: cand.priceUsd - goodwill });
  // The investment in the subsidiary sits in other assets until the first
  // translation replaces it with the consolidated lines.
  op.carried.otherAssets = cand.priceUsd - goodwill;
  translate(ctx, b, op, true);
  world.deals.push({ day: world.day, kind: 'whole', buyer: b.name, target: `${cand.name} (${c.name})`, assets: Math.round(cand.assetsLocal / c.fx), price: cand.priceUsd, priceToBook: cand.priceToBook, regime: world.economy.regime });
  milestone(ctx, `Entered ${c.name}: bought ${cand.name} in ${c.city}`);
  emit(ctx, 'regulator', `The ${c.name} regulator approved the purchase of ${cand.name}. Closed today. ${b.name} now operates in ${new Set(b.foreign.map((f) => f.country)).size} ${b.foreign.length === 1 ? 'country' : 'countries'} abroad.`, { severity: 'good', bankId: b.id });
  return op;
}

// A subsidiary's month in local currency: interest on its book, deposit
// cost, overhead, credit losses by the country's cycle, deposit flow.
export function foreignMonthly(ctx: Ctx, b: Bank, days: number): void {
  const { world } = ctx;
  for (const op of b.foreign) {
    const c = world.countries[op.country] as Country;
    const a = op.acct;
    const accrue = (bal: number, rate: number) => Math.round((bal * rate * days) / 365);
    let interest = 0;
    let nonaccrual = 0;
    for (const p of op.pools) {
      let perf = 0;
      for (let g = 0; g < 6; g++) perf += p.grades[g] ?? 0;
      interest += accrue(perf, p.rate);
      nonaccrual += p.balance - perf;
    }
    interest += accrue(a.securitiesHTM, c.y10) + accrue(a.cash, Math.max(0, c.rate));
    if (interest > 0) post(a, { cash: interest, retainedEarnings: interest });
    let expense = 0;
    for (const t of DEPOSIT_TYPES) expense += accrue(a[t], op.rates[t]);
    expense += accrue(a.fhlb, c.rate + 0.003);
    if (expense > 0) post(a, { cash: -expense, retainedEarnings: -expense });
    const overhead = accrue(totalAssets(a), op.overheadRate);
    if (overhead > 0) post(a, { cash: -overhead, retainedEarnings: -overhead });
    // Credit: the country's cycle moves the grades; losses charged off.
    const stress = Math.max(0.6, Math.min(12, Math.exp(-8 * c.momentum * 12 + (c.regime === 'recession' ? 0.8 : 0))));
    let chargeOffs = 0;
    for (const p of op.pools) {
      const pd = [0.001, 0.002, 0.004, 0.008, 0.015, 0.05, 0.15, 0.4, 1];
      let lost = 0;
      for (let g = 0; g < GRADES - 1; g++) {
        const bal = p.grades[g] ?? 0;
        const d = Math.round(bal * Math.min(0.5, (1 - Math.pow(1 - (pd[g] ?? 0), 1 / 12)) * stress));
        const down = g < GRADES - 2 ? Math.round((bal - d) * Math.min(0.5, 0.005 * stress)) : 0;
        p.grades[g] = bal - d - down;
        p.grades[g + 1] = (p.grades[g + 1] ?? 0) + down;
        lost += d;
      }
      const co = Math.round(lost * TYPE[p.type].lgd);
      chargeOffs += co;
      p.cumLoss += co;
      // Runoff and new lending keep the book near the deposit base.
      const pay = Math.round(p.balance * 0.01);
      let paid = 0;
      for (let g = 0; g < 6 && paid < pay; g++) {
        const x = Math.min(p.grades[g] ?? 0, pay - paid);
        p.grades[g] = (p.grades[g] ?? 0) - x;
        paid += x;
      }
      p.balance = p.grades.reduce((s, x) => s + x, 0);
      // Principal and recoveries come back in cash; the loss hits earnings.
      post(a, { cash: paid + (lost - co), loans: -(paid + lost), retainedEarnings: -co });
    }
    void chargeOffs;
    void nonaccrual;
    // Deposits move with the country's pool share and cycle.
    const core = a.checking + a.savings + a.mmda + a.cd;
    const target = Math.round(c.depositPool * op.franchise.targetShare * (c.regime === 'recession' ? 0.97 : 1));
    const flow = Math.round((target - core) * 0.1);
    if (flow !== 0) {
      const entry: Partial<Accounts> = { cash: flow };
      let left = flow;
      for (const t of DEPOSIT_TYPES) {
        const x = t === 'cd' ? left : Math.round(flow * (t === 'checking' ? 0.35 : t === 'savings' ? 0.35 : 0.2));
        entry[t] = x;
        left -= x;
      }
      post(a, entry);
    }
    // Lend the cash above a cushion into the local book.
    const room = a.cash - Math.round(totalAssets(a) * 0.06);
    if (room > 0 && a.loans < core * 0.85) {
      const amount = Math.min(room, Math.round((core * 0.85 - a.loans) / 6));
      if (amount > 0) {
        const p = op.pools[0];
        if (p) {
          p.grades[2] = (p.grades[2] ?? 0) + amount;
          p.balance += amount;
          post(a, { loans: amount, cash: -amount });
        }
      }
    }
    // Local regulator: below its leverage minimum the parent must inject.
    const lev = totalEquity(a) / Math.max(1, totalAssets(a));
    if (lev < c.leverageMin) {
      const need = Math.round((c.leverageMin + 0.02) * totalAssets(a) - totalEquity(a));
      const usd = Math.round(need / c.fx);
      if (b.acct.cash >= usd) {
        post(b.acct, { cash: -usd, otherAssets: usd });
        op.carried.otherAssets += usd;
        post(a, { cash: need, commonStock: need });
        if (b.id === world.playerBankId) emit(ctx, 'regulator', `${c.name}: injected ${money(usd)} into ${op.name} to meet the ${pct(c.leverageMin, 2)} leverage minimum`, { severity: 'alert', bankId: b.id });
      }
    }
    translate(ctx, b, op, false);
  }
}

// Translation: every line of the subsidiary's book in dollars at the
// closing rate replaces what the parent carried. The change in net
// assets splits into the period's local earnings at the closing rate
// (retained earnings) and the rest (AOCI, the translation adjustment).
export function translate(ctx: Ctx, b: Bank, op: ForeignOp, initial: boolean): void {
  const { world } = ctx;
  const c = world.countries[op.country] as Country;
  const entry: Partial<Accounts> = {};
  let assetsDelta = 0;
  let liabDelta = 0;
  const assetLines: Account[] = ['cash', 'securitiesAFS', 'securitiesHTM', 'loans', 'interestReceivable', 'reo', 'premises', 'otherAssets'];
  const liabLines: Account[] = ['checking', 'savings', 'mmda', 'cd', 'brokered', 'fhlb', 'fedFundsPurchased', 'subDebt', 'interestPayable', 'otherLiabilities'];
  for (const k of assetLines) {
    const usd = k === 'otherAssets' ? Math.round(op.acct.otherAssets / c.fx) : Math.round(op.acct[k] / c.fx);
    const delta = usd - op.carried[k];
    if (delta !== 0) {
      entry[k] = delta;
      assetsDelta += delta;
      op.carried[k] = usd;
    }
  }
  for (const k of liabLines) {
    const usd = Math.round(op.acct[k] / c.fx);
    const delta = usd - op.carried[k];
    if (delta !== 0) {
      entry[k] = delta;
      liabDelta += delta;
      op.carried[k] = usd;
    }
  }
  const net = assetsDelta - liabDelta;
  if (net === 0 && Object.keys(entry).length === 0) return;
  // Local earnings this month at the closing rate; the rest is translation.
  const earningsLocal = op.acct.retainedEarnings - op.carried.retainedEarnings;
  const earningsUsd = initial ? 0 : Math.round(earningsLocal / c.fx);
  op.carried.retainedEarnings = op.acct.retainedEarnings;
  const cta = net - earningsUsd;
  if (earningsUsd !== 0) {
    entry.retainedEarnings = earningsUsd;
    if (earningsUsd > 0) b.is.month.feeIncome += earningsUsd;
    else b.is.month.otherExpense += -earningsUsd;
  }
  if (cta !== 0) entry.aoci = (entry.aoci ?? 0) + cta;
  post(b.acct, entry);
}

// Consolidated dollar view of a subsidiary for the desk.
export function foreignSummary(world: World, op: ForeignOp): { assets: number; deposits: number; equity: number; loans: number; leverage: number; currency: string; fx: number; fxChange: number } {
  const c = world.countries[op.country] as Country;
  const a = op.acct;
  return {
    assets: Math.round(totalAssets(a) / c.fx),
    deposits: Math.round(totalDeposits(a) / c.fx),
    equity: Math.round(totalEquity(a) / c.fx),
    loans: Math.round(a.loans / c.fx),
    leverage: totalEquity(a) / Math.max(1, totalAssets(a)),
    currency: c.currency,
    fx: c.fx,
    fxChange: c.fx / c.fxStart - 1,
  };
}

// G-SIB: a bank above $1T with operations abroad carries a surcharge by
// size and a compliance cost. Passing the largest bank in America is the
// milestone the whole game points at (D7).
export function gsibSurcharge(assets: number): number {
  if (assets >= 3e12) return 0.025;
  if (assets >= 2e12) return 0.02;
  if (assets >= 1.5e12) return 0.015;
  return 0.01;
}

export function globalQuarterly(ctx: Ctx): void {
  const { world } = ctx;
  for (const id of world.bankOrder) {
    const b = world.banks[id] as Bank;
    if (b.status !== 'open') continue;
    const assets = totalAssets(b.acct);
    if (assets >= THRESHOLD_GSIB && b.foreign.length > 0) {
      const surcharge = gsibSurcharge(assets);
      if (!b.gsib) {
        b.gsib = { since: world.day, surcharge };
        if (b.id === world.playerBankId) {
          milestone(ctx, `Designated a global systemically important bank (surcharge ${pct(surcharge, 1)})`);
          addPending(ctx, {
            kind: 'enforcement',
            bankId: b.id,
            title: 'Designated a global systemically important bank',
            lines: [`${money(assets)} of assets across ${new Set(b.foreign.map((f) => f.country)).size + 1} countries.`, `A CET1 surcharge of ${pct(surcharge, 1)} now sits on top of the conservation buffer: below it, payouts are limited. Annual compliance cost 3 basis points of assets. Resolution planning is global.`],
            options: [{ key: 'k', label: 'Acknowledge' }],
            data: { level: 'gsib' },
          });
        }
      } else b.gsib.surcharge = surcharge;
      const cost = Math.round((assets * 0.0003) / 4);
      post(b.acct, { cash: -cost, retainedEarnings: -cost });
      b.is.quarter.otherExpense += cost;
      b.is.year.otherExpense += cost;
    } else if (b.gsib) b.gsib = null;
    if (b.id === world.playerBankId && assets > world.largestNational && !world.milestones.some((m) => /largest bank in America/.test(m.text))) {
      milestone(ctx, `Passed the largest bank in America: ${money(assets)} of assets`);
      emit(ctx, 'system', `${b.name} is now the largest bank in America at ${money(assets)} of assets. The world goes on.`, { severity: 'good', bankId: b.id });
    }
  }
}

export function playerCountries(world: World): CountryCode[] {
  const b = playerBank(world);
  return b ? [...new Set(b.foreign.map((f) => f.country))] : [];
}

export { PCA_WELL };
