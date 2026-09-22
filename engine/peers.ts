// Peers and levers (D56): how the bank is doing against the banks its
// size, from the same call reports every bank files, and what one step
// of each lever the CEO holds is worth in a year, from today's balances.
// Pure functions over the world; the desk shows them on Home.

import { LOAN_TYPES } from './loantypes';
import { type IncomeStatement, netInterestIncome, noninterestExpense, totalAssets, totalDeposits } from './ledger';
import { type Bank, type World, branchFixedCost } from './state';
import { calibration } from '../data/calibration';
import { tier1Capital } from './ledger';
import { TYPE } from './credit';
import { bankDepositRate, branchCandidates, branchMargin, marketDepositRate } from './deposits';
import { bookByType, typeBand } from './credit';
import { defaultSalary } from './wealth';
import { dateOf } from './time';
import { money, pct } from './format';

export interface PeerStats {
  roa: number; // annualized, last quarter
  nim: number;
  efficiency: number; // overhead over revenue
  nco: number; // net charge-offs over loans, annualized
  leverage: number;
  growth: number; // assets over the last year
  depositCost: number; // interest on deposits over deposits, annualized
  loansToDeposits: number;
}

export const PEER_METRICS: { key: keyof PeerStats; label: string; higherIsBetter: boolean; ratio: boolean }[] = [
  { key: 'roa', label: 'Return on assets', higherIsBetter: true, ratio: true },
  { key: 'nim', label: 'Net interest margin', higherIsBetter: true, ratio: true },
  { key: 'efficiency', label: 'Costs as a share of revenue', higherIsBetter: false, ratio: true },
  { key: 'nco', label: 'Loans lost a year', higherIsBetter: false, ratio: true },
  { key: 'depositCost', label: 'Cost of deposits', higherIsBetter: false, ratio: true },
  { key: 'loansToDeposits', label: 'Loans to deposits', higherIsBetter: true, ratio: true },
  { key: 'growth', label: 'Growth over a year', higherIsBetter: true, ratio: true },
  { key: 'leverage', label: 'Capital (leverage ratio)', higherIsBetter: true, ratio: true },
];

function depositInterest(q: IncomeStatement): number {
  return q.interestChecking + q.interestSavings + q.interestMmda + q.interestCd + q.interestBrokered;
}

// One bank's numbers from its last call report and last closed quarter;
// NaN where the history is not there yet.
export function statsOf(b: Bank): PeerStats {
  const r = b.reports[b.reports.length - 1];
  const ago = b.reports[b.reports.length - 5];
  const q = b.is.lastQuarter;
  const annual = q && q.days > 0 ? 365 / q.days : 4;
  const revenue = q ? netInterestIncome(q) + q.feeIncome + q.securitiesGains : 0;
  return {
    roa: r ? r.roa : NaN,
    nim: r ? r.nim : NaN,
    efficiency: q && revenue > 0 ? noninterestExpense(q) / revenue : NaN,
    nco: r ? r.ncoRate : NaN,
    leverage: r ? r.leverage : NaN,
    growth: r && ago && ago.assets > 0 ? r.assets / ago.assets - 1 : NaN,
    depositCost: q && r && r.deposits > 0 ? (depositInterest(q) * annual) / r.deposits : NaN,
    loansToDeposits: r && r.deposits > 0 ? r.loans / r.deposits : NaN,
  };
}

function median(xs: number[]): number {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
}

// The banks a third to three times this bank's size, widened to a tenth
// to ten times when fewer than eight have filed, then to every bank.
export function peerGroup(world: World, b: Bank): { n: number; peers: PeerStats; you: PeerStats } {
  const assets = totalAssets(b.acct);
  const all: { assets: number; s: PeerStats }[] = [];
  for (const id of world.bankOrder) {
    const x = world.banks[id] as Bank;
    if (x.id === b.id || x.kind !== 'rival' || x.status !== 'open' || x.reports.length === 0) continue;
    all.push({ assets: totalAssets(x.acct), s: statsOf(x) });
  }
  let set = all.filter((x) => x.assets >= assets / 3 && x.assets <= assets * 3);
  if (set.length < 8) set = all.filter((x) => x.assets >= assets / 10 && x.assets <= assets * 10);
  if (set.length < 8) set = all;
  const peers = {} as PeerStats;
  for (const m of PEER_METRICS) peers[m.key] = median(set.map((x) => x.s[m.key]));
  return { n: set.length, peers, you: statsOf(b) };
}

export interface Lever {
  key: string;
  label: string;
  today: string; // where the lever sits
  step: string; // one step of it
  effect: number; // a year of that step, dollars of profit before tax, from today's balances
  note: string; // what the number leaves out
  tab: string; // the tab that moves it
}

// A year of one step on each lever, from today's balances. Every number
// is arithmetic on the desk's own figures and the hand bands; what it
// leaves out is said in the note.
export function levers(world: World, b: Bank): Lever[] {
  const out: Lever[] = [];
  const a = b.acct;
  const assets = totalAssets(a);
  const deposits = totalDeposits(a);
  const sensitive = a.savings + a.mmda + a.cd;
  const market = marketDepositRate(world);
  const mine = bankDepositRate(b);
  out.push({
    key: 'sheet',
    label: 'Deposit rate sheet',
    today: `${pct(mine)} against a market at ${pct(market)}`,
    step: 'ten basis points off the sheet',
    effect: Math.round(0.001 * sensitive),
    note: `on today's ${money(sensitive)} of savings, money market and CDs. Below the market, balances leave at the elasticity band; checking barely moves.`,
    tab: 'MONEY',
  });
  // Loans to deposits: five points more lent, at the loan yield against
  // the two year Treasury, less the typical loss for the mix.
  const book = bookByType(b);
  const bookTotal = book.reduce((s, r) => s + r.balance, 0);
  let lossRate = 0;
  if (bookTotal > 0) for (const r of book) lossRate += (r.balance / bookTotal) * (typeBand(r.type).typical / 100);
  else lossRate = typeBand('ci').typical / 100;
  const y2 = world.economy.curve.y2;
  const spread = b.loanYield - y2 - lossRate;
  out.push({
    key: 'ld',
    label: 'Loans to deposits target',
    today: `${pct(b.policy.targetLoansToDeposits, 0)} in the policy; the book is at ${pct(deposits > 0 ? a.loans / deposits : 0, 0)}`,
    step: 'five points more of deposits lent',
    effect: Math.round(0.05 * deposits * spread),
    note: `${pct(b.loanYield)} on loans against ${pct(y2)} on two year Treasuries, less ${pct(lossRate)} a year of losses at the typical rate for your mix. Lending needs the borrowers to walk in.`,
    tab: 'LENDING',
  });
  // Loan pricing: a quarter point on the year's new loans.
  const { m, d } = dateOf(world.day);
  const months = Math.max(1, m - 1 + d / 30);
  const ytd = LOAN_TYPES.reduce((s, t) => s + b.originationsByType[t], 0);
  // Early in the year the pace is last year's; from March on, this year's.
  const originations = months >= 3 || !b.originationsLastYear ? Math.round((ytd * 12) / months) : b.originationsLastYear;
  const offsets = LOAN_TYPES.map((t) => b.pricing?.[t] ?? 0);
  const avgOffset = offsets.reduce((s, x) => s + x, 0) / offsets.length;
  out.push({
    key: 'pricing',
    label: 'Loan rate sheet',
    today: `${Math.round(avgOffset * 10_000)} basis points against the market on average`,
    step: 'a quarter point more on new loans',
    effect: Math.round(0.0025 * originations),
    note: `on about ${money(originations)} of new loans a year at this pace. Above the market, fewer borrowers come, at the elasticity band.`,
    tab: 'LENDING',
  });
  // A branch: the best opening on the map.
  const best = branchCandidates(world, b, 1)[0];
  if (best) {
    out.push({
      key: 'branch',
      label: 'A new branch',
      today: `${b.branches.length} ${b.branches.length === 1 ? 'branch' : 'branches'}`,
      step: `open in ${best.name}, ${best.state}`,
      effect: best.profit,
      note: `a mature year: your margin on ${money(best.contested)} of deposits less ${money(best.fixedCost)} to run it, after ${money(best.premises)} up front and years of ramp.`,
      tab: 'MAP',
    });
  }
  // Running costs: the weakest branch, or the CEO's own pay.
  const q = b.is.lastQuarter;
  const overhead = q && q.days > 0 ? Math.round((noninterestExpense(q) * 365) / q.days) : Math.round(noninterestExpense(b.is.year));
  const margin = branchMargin(b);
  let weakest: { name: string; loss: number } | null = null;
  for (const br of b.branches) {
    if (br.county === b.homeCounty) continue;
    const county = world.geo.counties[br.county];
    const contribution = br.deposits * margin - (county ? branchFixedCost(county) : br.fixedCost);
    if (contribution < 0 && (!weakest || contribution < -weakest.loss)) weakest = { name: county ? county.name : br.county, loss: -contribution };
  }
  // Interest rates: a one point rise, the way every bank reports it. Assets
  // that reprice within a year against liabilities that do, at the deposit
  // betas; and what the bond book loses in value at its duration.
  let floating = 0;
  let fixedReprice = 0;
  for (const r of book) {
    const tp = TYPE[r.type];
    if (tp.base === 'ff') floating += r.balance;
    else fixedReprice += r.balance * Math.min(1, 12 / (tp.balloon ?? tp.term));
  }
  let secReprice = 0;
  let bondHit = 0;
  let durWeight = 0;
  let bondValue = 0;
  for (const lot of b.lots) {
    const v = lot.fair > 0 ? lot.fair : lot.cost;
    secReprice += lot.duration <= 1 ? v : v / Math.max(1, lot.duration);
    bondHit += v * lot.duration * 0.01;
    durWeight += v * lot.duration;
    bondValue += v;
  }
  const betas = calibration.depositBeta;
  const liabReprice = a.checking * betas.checking.typical + a.savings * betas.savings.typical + a.mmda * betas.mmda.typical + a.cd * betas.cd.typical + a.brokered + a.fhlb + a.fedFundsPurchased;
  const assetReprice = a.cash + floating + fixedReprice + secReprice;
  const nii = Math.round(0.01 * (assetReprice - liabReprice));
  const tier1 = Math.max(1, tier1Capital(a));
  const duration = bondValue > 0 ? durWeight / bondValue : 0;
  out.push({
    key: 'rates',
    label: 'Interest rates',
    today: `bond book ${duration.toFixed(1)} years; ${pct(a.loans > 0 ? floating / a.loans : 0, 0)} of loans float`,
    step: 'the Fed raises a point',
    effect: nii,
    note: `${money(assetReprice)} of assets reprice within a year against ${money(Math.round(liabReprice))} of funding at the deposit betas. The bonds would lose about ${money(Math.round(bondHit))} of value (${pct(bondHit / tier1, 0)} of tier 1), which examiners rate and depositors read; a cut does the reverse. Shorten the bond book or lend floating to trade margin for safety.`,
    tab: 'MONEY',
  });
  const board = defaultSalary(assets);
  const salary = world.player.salary;
  if (weakest) {
    out.push({ key: 'costs', label: 'Running costs', today: `${money(overhead)} a year`, step: `close the branch in ${weakest.name}`, effect: Math.round(weakest.loss), note: `it holds less than it costs at your margin; its deposits drift away when it closes.`, tab: 'MONEY' });
  } else if (salary > board) {
    out.push({ key: 'costs', label: 'Running costs', today: `${money(overhead)} a year`, step: `your salary back to the board's ${money(board)}`, effect: Math.round(salary - board), note: `you take ${money(salary)}; every dollar of it is capital the bank keeps otherwise.`, tab: 'YOU' });
  } else {
    out.push({ key: 'costs', label: 'Running costs', today: `${money(overhead)} a year`, step: 'nothing obvious to cut', effect: 0, note: `every branch pays for itself at your margin and your salary is at or under the board's ${money(board)}.`, tab: 'MONEY' });
  }
  return out;
}
