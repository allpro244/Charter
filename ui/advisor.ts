// Advisor cards (D17): one-line advice computed from the state, on by
// default, dismissible. No scripted flavor; every card names a number
// on the desk and what to do about it.

import { fhlbCapacity, unrealizedToCapital } from '../engine/funding';
import { bankDepositRate, marketDepositRate } from '../engine/deposits';
import { leverageRatio, totalAssets, totalDeposits } from '../engine/ledger';
import { capitalStack, creConcentration } from '../engine/regulation';
import { dealCapacity, reservationPriceToBook } from '../engine/deals';
import { ownership, tangibleEquity } from '../engine/capital';
import { defaultSalary } from '../engine/wealth';
import { type World, playerBank } from '../engine/state';
import { dateOf } from '../engine/time';
import { pct, usd } from './format';

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
  if (line > 0 && a.fhlb / line > 0.5) out.push({ key: 'fhlb', text: `Home Loan Bank line ${pct(a.fhlb / line, 0)} used (${usd(a.fhlb)} of ${usd(line)}). What is left is what covers a bad week of withdrawals. Gather deposits on the Money tab or slow lending on the Lending tab.` });
  const last = b.reports[b.reports.length - 1];
  const prior = b.reports[b.reports.length - 2];
  if (last && prior && prior.deposits > 0 && last.deposits < prior.deposits * 0.95 && totalDeposits(a) < last.deposits) out.push({ key: 'runoff', text: `Deposits fell ${pct(1 - last.deposits / prior.deposits, 1)} last quarter and are still falling. Depositors leave for rate, for confidence, or for a rival's branch; the Money tab shows which.` });
  const gap = marketDepositRate(world) - bankDepositRate(b);
  if (gap > 0.0075) out.push({ key: 'rates', text: `You pay ${pct(bankDepositRate(b))} against a market at ${pct(marketDepositRate(world))}. Money market and CD money leaves first. The Money tab has the sheet.` });
  if (b.confidence < 0.85) out.push({ key: 'conf', text: `Depositor confidence ${pct(b.confidence, 0)}. Uninsured balances (${pct(b.uninsuredShare, 0)} of deposits) move first. Capital and cash calm it; nothing else does.` });
  const u = unrealizedToCapital(b);
  if (u > 0.3) out.push({ key: 'aoci', text: `Unrealized securities losses are ${pct(u, 0)} of tier 1. Examiners rate it; depositors read it. Shorten the book, or hedge with a swap if you are past ${usd(1e9)}.` });
  const conc = creConcentration(b);
  if (conc.construction > 1 || conc.cre > 3) out.push({ key: 'cre', text: `CRE concentration: construction ${pct(conc.construction, 0)} and investor CRE ${pct(conc.cre, 0)} of capital. Above 100% and 300% the exam finding is automatic.` });
  const vacancies = ['cco', 'cfo', 'clo'].filter((r) => !b.officers.some((o) => o.role === r));
  if (vacancies.length > 0) out.push({ key: 'off', text: `${vacancies.length} officer ${vacancies.length === 1 ? 'seat is' : 'seats are'} vacant (${vacancies.join(', ').toUpperCase()}). A vacant desk runs at a low default skill. The People tab has candidates.` });
  const monthsThisYear = Math.max(1, dateOf(world.day).m - 1 + dateOf(world.day).d / 30);
  const deskPerMonth = (b.applications.toDeskYtd ?? 0) / monthsThisYear;
  if (deskPerMonth > 20 && monthsThisYear >= 2) out.push({ key: 'desk', text: `About ${Math.round(deskPerMonth)} loans a month reach your desk. Raise the size line on the Lending tab (policy and dial) so only the credits that matter at ${usd(assets)} stop the clock; the rest are decided under your written policy.` });
  const cashShare = assets > 0 ? a.cash / assets : 0;
  if (cashShare > 0.25 && assets > 30_000_000) out.push({ key: 'idle', text: `Cash is ${pct(cashShare, 0)} of assets, earning the Fed rate and nothing more. Lend it (Lending tab, loans to deposits target) or let the CFO buy bonds with it (Money tab, investment policy).` });
  if (b.dial.maxAuto === 0 && b.applications.received > 50) out.push({ key: 'dial', text: `The dial is at zero: every loan crosses your desk. Fine at ${usd(assets)}; it will not scale. Lending tab, policy and dial.` });
  if (b.enforcement !== 'none') {
    const open = b.camels.findings.filter((f) => !f.resolved);
    const where = open.map((f) => (f.component === 'A' ? 'the troubled loans (Loans tab: sell the notes or wait out the workouts, and tighten the policy)' : f.component === 'M' ? (/exception/.test(f.text) ? 'policy exceptions (approve inside the written policy, or change the policy)' : 'the empty officer seats (You tab, your team)') : f.component === 'C' ? 'capital (Money tab, balance sheet and capital: raise it, or shrink)' : f.component === 'E' ? 'earnings (Home, results: the margin and the costs)' : f.component === 'L' ? 'cash (Money tab: hold more, borrow less)' : 'the bond book (Money tab, bonds: shorter)'));
    out.push({ key: 'enf', text: `Under ${b.enforcement === 'mou' ? 'an informal agreement' : b.enforcement === 'consent' ? 'a consent order' : 'a directive'}: ${where.length > 0 ? `fix ${[...new Set(where)].join('; ')}` : 'fix the findings'} before the next exam. Ignored, it escalates.` });
  }
  // Growing: the moves a strong bank can make, named while it can make them.
  const strong = lev >= 0.09 && b.enforcement === 'none' && b.status === 'open';
  const ageYears = (world.day - b.charteredDay) / 365;
  if (strong && ageYears >= 2 && b.branches.length < 3 && cashShare >= 0.06 && totalDeposits(a) > 50_000_000) out.push({ key: 'grow', text: `Capital is strong (${pct(lev, 1)}). A second branch in a nearby county gathers new deposits to lend: open the Map, click a county, read what a branch there would gather and cost.` });
  const cap = dealCapacity(b);
  const nearby = new Set([b.state, ...(world.geo.states[b.state]?.neighbors ?? [])]);
  const target = world.bankOrder.map((id) => world.banks[id]!).filter((t) => t.kind === 'rival' && t.status === 'open' && t.forSale && nearby.has(t.state) && totalAssets(t.acct) < 0.6 * assets).sort((x, y) => totalAssets(y.acct) - totalAssets(x.acct))[0];
  if (strong && target) {
    const price = reservationPriceToBook(world, target) * tangibleEquity(target);
    if (price <= cap.cash) out.push({ key: 'buy', text: `${target.name} (${usd(totalAssets(target.acct))} of assets) is for sale nearby for about ${usd(price)}, and you can pay it. Buying a bank is the fastest way up the ladder: World tab, the other banks, open it and make an offer.` });
  }
  if (ageYears >= 3 && strong && b.dividendPayout === 0 && b.reports.slice(-4).every((r) => r.netIncome > 0) && b.reports.length >= 4) out.push({ key: 'div', text: `Three years in, profitable and well capitalized: the bank can start paying a dividend. You own ${pct(world.player.shares / Math.max(1, b.shares), 0)} of it, so a payout is your money too. You tab, dividend payout.` });
  const share = ownership(world, b).player;
  if (share < 0.5 && ageYears >= 2.5) {
    let losing = 0;
    for (let i = b.reports.length - 1; i >= 0 && b.reports[i]!.netIncome < 0; i--) losing++;
    if (losing >= 2) out.push({ key: 'control', text: `You hold ${pct(share, 0)} of the bank and it has lost money for ${losing} quarters. Under half, the board can replace you after two years of losses. Put your own money into the next raise on the You tab, or get the bank back in the black.` });
  }
  const boardPay = defaultSalary(assets);
  if (world.player.salary < boardPay * 0.5 && assets > 50_000_000 && strong) out.push({ key: 'pay', text: `A CEO of a ${usd(assets)} bank is usually paid about ${usd(boardPay)}; you take ${usd(world.player.salary)}. The You tab sets your salary. Too much and the board notices; the advisor says so at 1% of assets.` });
  if (b.forSale === false && b.reviews.length >= 4) {
    const last = b.reviews[b.reviews.length - 1];
    if (last && last.netIncome < 0) out.push({ key: 'loss', text: `Last quarter lost ${usd(-last.netIncome)}. The Earnings tab, where it came from, attributes every dollar; the losses table names the calls that made them.` });
  }
  if (world.player.salary > 0 && assets > 0 && world.player.salary > 0.01 * assets) out.push({ key: 'paytoo', text: `Your salary is ${pct(world.player.salary / assets, 2)} of assets. Every dollar you pay yourself is capital the bank does not have when the cycle turns.` });
  return out;
}
