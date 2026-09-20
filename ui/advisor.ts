// Advisor cards (D17): one-line advice computed from the state, on by
// default, dismissible. No scripted flavor; every card names a number
// on the desk and what to do about it.

import { fhlbCapacity, unrealizedToCapital } from '../engine/funding';
import { bankDepositRate, marketDepositRate } from '../engine/deposits';
import { leverageRatio, totalAssets, totalDeposits } from '../engine/ledger';
import { capitalStack, creConcentration } from '../engine/regulation';
import { type World, playerBank } from '../engine/state';
import { pct, short } from './format';

export interface Card {
  key: string;
  text: string;
}

export function adviceFor(world: World): Card[] {
  const b = playerBank(world);
  if (!b) return [];
  const out: Card[] = [];
  const a = b.acct;
  const assets = totalAssets(a);
  const lev = leverageRatio(a);
  const stack = capitalStack(b);
  if (lev < 0.06) out.push({ key: 'lev', text: `Leverage ${pct(lev, 1)}: below 5% dividends stop and the examiner arrives. Raise capital on the You tab or slow lending on the Lending tab.` });
  if (stack.bufferShortfall > 0 && lev >= 0.06) out.push({ key: 'buffer', text: `CET1 buffer short by ${pct(stack.bufferShortfall, 1)}: payouts capped at ${pct(stack.maxPayout, 0)} of earnings.` });
  if (a.cash / Math.max(1, assets) < 0.03) out.push({ key: 'cash', text: `Cash is ${pct(a.cash / Math.max(1, assets), 1)} of assets. Below 3% a bad week means borrowing or selling bonds at a loss. See the Money tab.` });
  const line = a.fhlb + fhlbCapacity(b);
  if (line > 0 && a.fhlb / line > 0.5) out.push({ key: 'fhlb', text: `Home Loan Bank line ${pct(a.fhlb / line, 0)} used (${short(a.fhlb)} of ${short(line)}). What is left is what covers a bad week of withdrawals. Gather deposits on the Money tab or slow lending on the Lending tab.` });
  const last = b.reports[b.reports.length - 1];
  const prior = b.reports[b.reports.length - 2];
  if (last && prior && prior.deposits > 0 && last.deposits < prior.deposits * 0.95 && totalDeposits(a) < last.deposits) out.push({ key: 'runoff', text: `Deposits fell ${pct(1 - last.deposits / prior.deposits, 1)} last quarter and are still falling. Depositors leave for rate, for confidence, or for a rival's branch; the Money tab shows which.` });
  const gap = marketDepositRate(world) - bankDepositRate(b);
  if (gap > 0.0075) out.push({ key: 'rates', text: `You pay ${pct(bankDepositRate(b))} against a market at ${pct(marketDepositRate(world))}. Money market and CD money leaves first. The Money tab has the sheet.` });
  if (b.confidence < 0.85) out.push({ key: 'conf', text: `Depositor confidence ${pct(b.confidence, 0)}. Uninsured balances (${pct(b.uninsuredShare, 0)} of deposits) move first. Capital and cash calm it; nothing else does.` });
  const u = unrealizedToCapital(b);
  if (u > 0.3) out.push({ key: 'aoci', text: `Unrealized securities losses are ${pct(u, 0)} of tier 1. Examiners rate it; depositors read it. Shorten the book, or hedge with a swap if you are past ${short(1e9)}.` });
  const conc = creConcentration(b);
  if (conc.construction > 1 || conc.cre > 3) out.push({ key: 'cre', text: `CRE concentration: construction ${pct(conc.construction, 0)} and investor CRE ${pct(conc.cre, 0)} of capital. Above 100% and 300% the exam finding is automatic.` });
  const vacancies = ['cco', 'cfo', 'clo'].filter((r) => !b.officers.some((o) => o.role === r));
  if (vacancies.length > 0) out.push({ key: 'off', text: `${vacancies.length} officer ${vacancies.length === 1 ? 'seat is' : 'seats are'} vacant (${vacancies.join(', ').toUpperCase()}). A vacant desk runs at a low default skill. The People tab has candidates.` });
  if (b.dial.maxAuto === 0 && b.applications.received > 50) out.push({ key: 'dial', text: `The dial is at zero: every loan crosses your desk. Fine at ${short(assets)}; it will not scale. Lending tab, policy and dial.` });
  if (b.enforcement !== 'none') out.push({ key: 'enf', text: `Under a ${b.enforcement === 'mou' ? 'memorandum' : b.enforcement === 'consent' ? 'consent order' : 'PCA directive'}: fix the findings on the Money tab, balance sheet and capital, before the next exam. Ignored, it escalates.` });
  if (b.forSale === false && b.reviews.length >= 4) {
    const last = b.reviews[b.reviews.length - 1];
    if (last && last.netIncome < 0) out.push({ key: 'loss', text: `Last quarter lost ${short(-last.netIncome)}. The Earnings tab, where it came from, attributes every dollar; the losses table names the calls that made them.` });
  }
  if (world.player.salary > 0 && assets > 0 && world.player.salary > 0.01 * assets) out.push({ key: 'pay', text: `Your salary is ${pct(world.player.salary / assets, 2)} of assets. Every dollar you pay yourself is capital the bank does not have when the cycle turns.` });
  return out;
}
