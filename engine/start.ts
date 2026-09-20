// Starting a bank (D4, D39). Charter a new one in any startable metro, or
// buy a controlling stake in a generated bank there. Sizes come from the
// metro's real population and the state's real bank size distribution.

import { calibration } from '../data/calibration';
import type { BankSeed } from '../data/types';
import { type Ctx, emit, milestone } from './ctx';
import { totalEquity } from './ledger';
import { generateBankName } from './names';
import { type Rng, derive, hashString, pick, randLogNormal, randNormal, rand } from './rng';
import { type Bank, type CountyState, type MetroState, type World, createBank, nextId } from './state';
import { defaultSalary } from './wealth';
import { money } from './format';
import { makeOfficer } from './officers';
import { generateApplication, ccoReview } from './borrowers';
import { inheritBook } from './loans';
import { totalAssets } from './ledger';
import { populateRivals } from './rivals';

export function startableMetros(world: World): MetroState[] {
  return Object.values(world.geo.metros)
    .filter((m) => m.startable)
    .sort((a, b) => a.rank - b.rank);
}

export function principalCounty(world: World, metro: MetroState): CountyState | null {
  let best: CountyState | null = null;
  for (const fips of metro.counties) {
    const c = world.geo.counties[fips];
    if (c && (!best || c.population > best.population)) best = c;
  }
  return best;
}

export interface CharterTerms {
  raise: number; // total capital raised
  founderCash: number; // what the player has
  minInvest: number;
  maxInvest: number;
  sharePrice: number;
}

// Charter capital scales with metro population on a log scale from $10M at
// 250,000 people to $30M at 20 million.
export function charterTerms(world: World, metro: MetroState): CharterTerms {
  const lo = Math.log(250_000);
  const hi = Math.log(20_000_000);
  const t = Math.max(0, Math.min(1, (Math.log(Math.max(metro.population, 250_000)) - lo) / (hi - lo)));
  const raise = Math.round((10_000_000 + 20_000_000 * t) / 100_000) * 100_000;
  const founderCash = world.player.cash;
  return {
    raise,
    founderCash,
    minInvest: Math.min(founderCash, Math.round(raise * 0.1)),
    maxInvest: Math.min(founderCash, raise),
    sharePrice: 10,
  };
}

export function founderCash(): number {
  return calibration.founderCash.typical * 1_000_000;
}

export interface TakeoverCandidate {
  key: string;
  name: string;
  county: string;
  assets: number;
  deposits: number;
  loans: number;
  securities: number;
  equity: number;
  leverage: number;
  criticizedShare: number; // share of loans graded 6 or worse
  yearsOld: number;
  stake: number; // fraction of shares for control
  price: number; // dollars for the stake
  premiumToBook: number;
  seed: number;
}

const CONTROL_STAKE = 0.3;

// Three candidates in the metro, drawn from the state's real bank size
// distribution (banks-by-state.json seeds), priced at a premium to book
// that rises with quality. Deterministic per world seed and metro.
// The banks a metro's counties belong to: every state the metro touches.
export function seedsForMetro(world: World, metro: MetroState): BankSeed[] {
  const states = new Set<string>();
  for (const fips of metro.counties) {
    const c = world.geo.counties[fips];
    if (c) states.add(c.state);
  }
  states.add(metro.state);
  const out: BankSeed[] = [];
  for (const st of [...states].sort()) out.push(...(world.bankSeeds[st] ?? []));
  return out;
}

export function takeoverCandidates(world: World, metro: MetroState, seeds: BankSeed[]): TakeoverCandidate[] {
  const r = derive(world.seed, hashString(`takeover:${metro.cbsa}`));
  const county = principalCounty(world, metro);
  if (!county) return [];
  const inMetro = seeds.filter((s) => s.county && metro.counties.includes(s.county) && s.assets > 20_000_000);
  const pool = inMetro.length >= 3 ? inMetro : seeds.filter((s) => s.assets > 20_000_000);
  const cash = world.player.cash;
  const out: TakeoverCandidate[] = [];
  const taken = new Set<string>();
  const sorted = [...pool].sort((a, b) => a.assets - b.assets);
  // Candidates the player can plausibly afford: a control stake at a premium
  // to book, at most about 1.2 times the founder's cash for a stretch.
  const affordable = sorted.filter((s) => s.assets * 0.09 * CONTROL_STAKE * 1.3 <= cash * 1.25);
  const source = affordable.length >= 3 ? affordable : sorted.slice(0, Math.max(3, Math.min(sorted.length, 6)));
  const picks: BankSeed[] = [];
  const idxs = new Set<number>();
  while (picks.length < Math.min(3, source.length)) {
    const i = Math.floor(rand(r) * source.length);
    if (idxs.has(i)) continue;
    idxs.add(i);
    picks.push(source[i] as BankSeed);
  }
  for (const s of picks) {
    const assets = Math.round(s.assets * Math.exp(randNormal(r, 0, 0.1)));
    const quality = rand(r); // 0 bad, 1 clean
    const leverage = 0.07 + 0.05 * quality + randNormal(r, 0, 0.005);
    const equity = Math.round(assets * Math.max(0.045, leverage));
    const deposits = Math.round(Math.min(s.deposits > 0 ? s.deposits * (assets / s.assets) : assets * 0.85, assets - equity));
    // The bank carries no wholesale funding at the takeover, so its balance
    // sheet is deposits plus equity, with at least three percent held as cash.
    const total = deposits + equity;
    const room = total - Math.round(total * 0.03);
    let loans = Math.min(room, Math.round(total * (0.55 + 0.2 * rand(r))));
    const securities = Math.min(room - loans, Math.round(total * (0.1 + 0.15 * rand(r))));
    const criticized = Math.max(0.005, 0.12 * (1 - quality) + randNormal(r, 0, 0.01));
    const premium = (calibration.takeoverPremium.low + (calibration.takeoverPremium.high - calibration.takeoverPremium.low) * quality) / 100;
    const price = Math.round(equity * CONTROL_STAKE * premium);
    const seedSalt = Math.floor(rand(r) * 1e9);
    const name = generateBankName(r, s.county && world.geo.counties[s.county] ? (world.geo.counties[s.county] as CountyState).name : county.name, metro.state, taken);
    out.push({
      key: String(out.length + 1),
      name,
      county: s.county && world.geo.counties[s.county] ? s.county : county.fips,
      assets: total,
      deposits,
      loans,
      securities,
      equity,
      leverage: equity / total,
      criticizedShare: criticized,
      yearsOld: Math.round(15 + 60 * rand(r)),
      stake: CONTROL_STAKE,
      price,
      premiumToBook: premium,
      seed: seedSalt,
    });
  }
  return out;
}

export interface StartCharter {
  mode: 'charter';
  cbsa: string;
  name: string;
  invest: number;
}

export interface StartTakeover {
  mode: 'takeover';
  cbsa: string;
  candidate: TakeoverCandidate;
}

export function startCharter(ctx: Ctx, opts: StartCharter): Bank {
  const { world } = ctx;
  const metro = world.geo.metros[opts.cbsa];
  if (!metro) throw new Error(`no metro ${opts.cbsa}`);
  const county = principalCounty(world, metro);
  if (!county) throw new Error(`metro ${opts.cbsa} has no counties`);
  const terms = charterTerms(world, metro);
  const invest = Math.max(terms.minInvest, Math.min(terms.maxInvest, Math.round(opts.invest)));
  if (invest > world.player.cash) throw new Error('not enough cash');
  const bank = createBank(world, {
    name: opts.name.trim() || `${county.name.replace(/ County$/, '')} Bank`,
    kind: 'player',
    state: metro.state,
    homeCounty: county.fips,
    homeMetro: metro.cbsa,
    capital: terms.raise,
    shares: Math.round(terms.raise / terms.sharePrice),
  });
  bank.franchise.baseShare = 0;
  bank.franchise.targetShare = calibration.deNovoShareCeiling.typical / 100;
  bank.franchise.openedDay = world.day;
  bank.dividendPayout = 0;
  const rr = pickRng(world, `officers:${bank.id}`);
  bank.officers.push(makeOfficer(world, rr, 'cco', terms.raise * 8, 50));
  bank.officers.push(makeOfficer(world, rr, 'cfo', terms.raise * 8, 50));
  bank.officers.push(makeOfficer(world, rr, 'clo', terms.raise * 8, 50));
  attachPlayer(ctx, bank, Math.round(invest / terms.sharePrice), invest);
  emit(ctx, 'system', `${bank.name} chartered in ${metro.name} with ${money(terms.raise)} of capital. You put in ${money(invest)} for ${((invest / terms.raise) * 100).toFixed(0)}% of the shares.`, {
    severity: 'good',
    bankId: bank.id,
  });
  milestone(ctx, `Chartered ${bank.name} in ${metro.name}`);
  return bank;
}

export function startTakeover(ctx: Ctx, opts: StartTakeover): Bank {
  const { world } = ctx;
  const metro = world.geo.metros[opts.cbsa];
  if (!metro) throw new Error(`no metro ${opts.cbsa}`);
  const c = opts.candidate;
  if (c.price > world.player.cash) throw new Error('not enough cash');
  const core = c.deposits;
  const bank = createBank(world, {
    name: c.name,
    kind: 'player',
    state: metro.state,
    homeCounty: c.county,
    homeMetro: metro.cbsa,
    capital: c.equity,
    deposits: {
      checking: Math.round(core * 0.3),
      savings: Math.round(core * 0.25),
      mmda: Math.round(core * 0.25),
      cd: core - Math.round(core * 0.3) - Math.round(core * 0.25) - Math.round(core * 0.25),
    },
    loans: c.loans,
    securitiesAFS: Math.round(c.securities * 0.7),
    securitiesHTM: c.securities - Math.round(c.securities * 0.7),
    shares: Math.round(c.equity / 10),
    criticized: c.criticizedShare,
  });
  bank.charteredDay = world.day - c.yearsOld * 365;
  bank.franchise.openedDay = bank.charteredDay;
  for (const br of bank.branches) br.openedDay = bank.charteredDay;
  bank.takeover = { criticizedShare: c.criticizedShare, seed: c.seed };
  // Someone else's problems: an existing CCO and a book of real loans.
  const r = derive(world.seed, c.seed);
  bank.officers.push(makeOfficer(world, r, 'cco', totalAssets(bank.acct), 45));
  bank.officers.push(makeOfficer(world, r, 'cfo', totalAssets(bank.acct), 45));
  bank.officers.push(makeOfficer(world, r, 'clo', totalAssets(bank.acct), 45));
  const county = world.geo.counties[bank.homeCounty as string];
  if (county) {
    const apps = [];
    const n = Math.min(120, Math.max(25, Math.round(c.assets / 4_000_000)));
    for (let i = 0; i < n; i++) {
      const app = generateApplication(world, bank, county, r);
      ccoReview(app, bank, bank.officers[0]?.skill ?? 40, r);
      apps.push(app);
    }
    inheritBook(ctx, bank, apps, r, c.criticizedShare);
  }
  const shares = Math.round(bank.shares * c.stake);
  // A secondary purchase: cash goes to the selling holders, not the bank.
  attachPlayer(ctx, bank, shares, c.price);
  emit(ctx, 'system', `You bought ${(c.stake * 100).toFixed(0)}% of ${bank.name} for ${money(c.price)}, ${(c.premiumToBook * 100).toFixed(0)}% of book. ${money(c.assets)} in assets.`, {
    severity: 'good',
    bankId: bank.id,
  });
  milestone(ctx, `Took over ${bank.name} in ${metro.name}`);
  return bank;
}

function attachPlayer(ctx: Ctx, bank: Bank, shares: number, paid: number): void {
  const { world } = ctx;
  const p = world.player;
  p.cash -= paid;
  p.invested += paid;
  p.shares = shares;
  p.bankId = bank.id;
  world.playerBankId = bank.id;
  p.salary = defaultSalary(totalEquity(bank.acct) * 10);
  p.record.push({ bankId: bank.id, bankName: bank.name, from: world.day, to: null, outcome: 'running' });
  const st = world.geo.states[bank.state];
  if (st && !st.expanded) populateRivals(world, bank.state);
  if (st) st.expanded = true;
}

export function newPlayer(world: World): void {
  world.player.cash = founderCash();
}

// Used by the desk to preview a takeover book before choosing.
export function describeCandidate(c: TakeoverCandidate): string[] {
  return [
    `${c.name}, ${c.yearsOld} years old`,
    `Assets ${money(c.assets)}  Deposits ${money(c.deposits)}  Loans ${money(c.loans)}`,
    `Equity ${money(c.equity)}  Leverage ${(c.leverage * 100).toFixed(1)}%  Criticized loans ${(c.criticizedShare * 100).toFixed(1)}%`,
    `${(c.stake * 100).toFixed(0)}% control stake for ${money(c.price)} (${(c.premiumToBook * 100).toFixed(0)}% of book)`,
  ];
}

export function pickRng(world: World, label: string): Rng {
  return derive(world.seed, hashString(label));
}

export { pick, randLogNormal, nextId };
