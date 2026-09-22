// Overview: the home screen. Five gauges that answer "how am I doing", a
// plain-words profit summary, three sparklines, what to do next, and the
// recent feed. Every gauge links to the tab that changes it.

import { useMemo, useState } from 'react';
import type React from 'react';
import { calibration } from '../data/calibration';
import { bookByType } from '../engine/credit';
import { bankDepositRate, marketDepositRate } from '../engine/deposits';
import { fhlbCapacity } from '../engine/funding';
import { type IncomeStatement, interestExpense, interestIncome, leverageRatio, netIncome, noninterestExpense, tier1Capital, totalAssets, totalDeposits } from '../engine/ledger';
import { PEER_METRICS, levers, peerGroup } from '../engine/peers';
import { PCA_LABEL, pcaCategory } from '../engine/regulation';
import { type Bank, type FeedItem, type Pending, type World, emptyDesk } from '../engine/state';
import { formatDate } from '../engine/time';
import { num, pct, usd } from './format';
import { Pill, Term } from './parts';
import { DecisionCard, FeedList, Sparkline } from './screens';

type Tone = 'good' | 'warn' | 'bad' | 'neutral';

interface Gauge {
  key: string;
  label: React.ReactNode;
  value: string;
  tone: Tone;
  status: string;
  meaning: string;
  go: string;
  goLabel: string;
}

function gauges(world: World, b: Bank): Gauge[] {
  const a = b.acct;
  const assets = totalAssets(a);
  const deposits = totalDeposits(a);
  const out: Gauge[] = [];

  const lev = leverageRatio(a);
  const cat = pcaCategory(lev);
  const cushion = tier1Capital(a) - 0.05 * (assets - a.goodwill);
  out.push({
    key: 'capital',
    label: <Term k="leverage ratio">Capital</Term>,
    value: pct(lev, 1),
    tone: cat === 'well' ? 'good' : cat === 'adequate' ? 'warn' : 'bad',
    status: cat === 'well' ? 'Well capitalized' : PCA_LABEL[cat],
    meaning: cushion >= 0 ? `Cushion above the well capitalized line: ${usd(cushion)}. Losses eat it first.` : `Short of the well capitalized line by ${usd(-cushion)}. Raise capital or shrink.`,
    go: 'MONEY',
    goLabel: 'Money',
  });

  const cashShare = assets > 0 ? a.cash / assets : 0;
  const cover = deposits > 0 ? (a.cash + fhlbCapacity(b)) / deposits : 0;
  out.push({
    key: 'cash',
    label: <Term k="depositor confidence">Cash</Term>,
    value: pct(cashShare, 1),
    tone: cashShare >= 0.05 ? 'good' : cashShare >= 0.03 ? 'warn' : 'bad',
    status: cashShare >= 0.05 ? 'Comfortable' : cashShare >= 0.03 ? 'Tight' : 'Thin',
    meaning: `Cash and the Home Loan Bank line cover a run of ${pct(Math.min(1, cover), 0)} of deposits.${b.confidence < 0.9 ? ` Depositor confidence is ${pct(b.confidence, 0)}.` : ''}`,
    go: 'MONEY',
    goLabel: 'Money',
  });

  const book = bookByType(b);
  const crit = book.reduce((s, r) => s + r.criticized, 0);
  const non = book.reduce((s, r) => s + r.nonaccrual, 0);
  const critShare = a.loans > 0 ? crit / a.loans : 0;
  out.push({
    key: 'loans',
    label: <Term k="criticized">Loans</Term>,
    value: `${pct(critShare, 1)} weak`,
    tone: critShare < 0.03 ? 'good' : critShare < 0.08 ? 'warn' : 'bad',
    status: critShare < 0.03 ? 'Healthy' : critShare < 0.08 ? 'Watch' : 'Trouble',
    meaning: `${usd(crit)} of loans are graded weak and ${usd(non)} have stopped paying. The allowance holds ${usd(a.allowance)} against them.`,
    go: 'LENDING',
    goLabel: 'Lending',
  });

  const last = b.reports[b.reports.length - 1];
  const roa = last ? last.roa : 0;
  const band = assets < 1e9 ? calibration.roa.under1b : assets < 1e10 ? calibration.roa.from1bTo10b : assets < 2.5e11 ? calibration.roa.from10bTo250b : calibration.roa.over250b;
  const qtd = netIncome(b.is.quarter);
  out.push({
    key: 'profit',
    label: <Term k="return on assets">Profit</Term>,
    value: last ? usd(last.netIncome) : usd(qtd),
    tone: !last ? 'neutral' : roa >= 0.008 ? 'good' : roa >= 0 ? 'warn' : 'bad',
    status: !last ? 'First quarter' : roa >= 0.008 ? 'Earning' : roa >= 0 ? 'Thin' : 'Losing money',
    meaning: last ? `Last quarter. Return on assets ${pct(roa)}; a typical bank this size earns about ${band.typical}%. So far this quarter: ${usd(qtd)}.` : `So far this quarter. The first call report closes at the end of the quarter.`,
    go: 'EARNINGS',
    goLabel: 'Earnings',
  });

  const ago = b.reports.length >= 5 ? b.reports[b.reports.length - 5] : undefined;
  const growth = ago && ago.assets > 0 ? assets / ago.assets - 1 : null;
  const depGrowth = ago && ago.deposits > 0 ? deposits / ago.deposits - 1 : null;
  const gap = marketDepositRate(world) - bankDepositRate(b);
  out.push({
    key: 'growth',
    label: 'Growth',
    value: growth === null ? 'n/a' : pct(growth, 1),
    tone: growth === null ? 'neutral' : growth > 0.05 ? 'good' : growth >= 0 ? 'warn' : 'bad',
    status: growth === null ? 'Too early to tell' : growth > 0.05 ? 'Growing' : growth >= 0 ? 'Slow' : 'Shrinking',
    meaning:
      growth === null
        ? 'A year of call reports is needed to measure it.'
        : `Assets over the last year. Deposits ${depGrowth !== null && depGrowth >= 0 ? 'up' : 'down'} ${pct(Math.abs(depGrowth ?? 0), 1)}; you pay ${pct(bankDepositRate(b))} against a market at ${pct(marketDepositRate(world))}${gap > 0.005 ? ', which costs you balances' : ''}.`,
    go: 'MONEY',
    goLabel: 'Money',
  });
  return out;
}

const PLAIN: { label: React.ReactNode; get: (s: IncomeStatement) => number; bold?: boolean; negative?: boolean }[] = [
  { label: 'Earned on loans, bonds and cash', get: interestIncome },
  { label: 'Paid to depositors and lenders', get: interestExpense, negative: true },
  { label: <Term k="provision">Set aside for loans going bad</Term>, get: (s) => s.provision, negative: true },
  { label: 'Fees and gains', get: (s) => s.feeIncome + s.securitiesGains },
  { label: 'Running the bank: people, buildings, insurance, other', get: noninterestExpense, negative: true },
  { label: 'Tax', get: (s) => s.tax, negative: true },
  { label: 'Profit', get: netIncome, bold: true },
];

export function OverviewScreen({
  world,
  bank,
  cards,
  advisorOn,
  onToggleAdvisor,
  onDismiss,
  onGo,
  onDecide,
  speed,
  onPlay,
}: {
  world: World;
  bank: Bank;
  cards: { key: string; text: string }[];
  advisorOn: boolean;
  onToggleAdvisor: () => void;
  onDismiss: (key: string) => void;
  onGo: (tab: string) => void;
  onDecide: (p: Pending, key: string) => void;
  speed: number;
  onPlay: () => void;
}) {
  const [fullFeed, setFullFeed] = useState(false);
  const g = gauges(world, bank);
  const waiting = world.pending.filter((p) => !p.blocking);
  // The recent feed is what touches this bank: its own events, the
  // economy, the regulator, and any bank that failed or was sold. The full
  // feed has everything.
  const relevant = (f: FeedItem) => f.bankId === bank.id || f.bankId === null || f.source === 'market' || f.source === 'system' || f.source === 'regulator' || f.severity === 'alert';
  const recentRelevant = world.feed.filter(relevant).slice(-10).reverse();
  const desk = bank.desk ?? emptyDesk();
  const mine = bank.loans.filter((l) => l.decision.by === 'player');
  const late = mine.filter((l) => l.status === 'late30' || l.status === 'late60').length;
  const nonaccrual = mine.filter((l) => l.status === 'nonaccrual').length;
  return (
    <div>
      <p className="hint">How the bank is doing, in five numbers, then against the banks your size, then what one step of each lever is worth. Hover any underlined word for what it means; click a gauge or a lever to open the tab that changes it.</p>
      <div className="gauges">
        {g.map((x) => (
          <button key={x.key} className={'gauge ' + x.tone} onClick={() => onGo(x.go)}>
            <div className="gauge-head">
              <span className="gauge-label">{x.label}</span>
              <Pill tone={x.tone}>{x.status}</Pill>
            </div>
            <div className="gauge-value">{x.value}</div>
            <div className="gauge-meaning">{x.meaning}</div>
            <div className="gauge-go">Open {x.goLabel}</div>
          </button>
        ))}
      </div>
      <div className="feed-grid">
        <div>
          <Peers world={world} bank={bank} />
          <Levers world={world} bank={bank} onGo={onGo} />
          <table className="wrap">
            <thead>
              <tr>
                <th>Profit, in plain words</th>
                <th className="num">this quarter so far</th>
                <th className="num">last quarter</th>
              </tr>
            </thead>
            <tbody>
              {PLAIN.map((l, i) => {
                const now = l.get(bank.is.quarter);
                const prev = bank.is.lastQuarter ? l.get(bank.is.lastQuarter) : null;
                const show = (v: number) => (l.negative ? (v > 0 ? `(${usd(v).replace(/^\$/, '$')})` : usd(-v)) : usd(v));
                return (
                  <tr key={i} className={l.bold ? 'total' + (now < 0 ? ' alert' : ' positive') : ''}>
                    <td>{l.label}</td>
                    <td className="num">{show(now)}</td>
                    <td className="num">{prev === null ? '' : show(prev)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="side-title">
            {fullFeed ? 'The full feed' : 'Recent'}
            <button className="btn small" onClick={() => setFullFeed((v) => !v)}>
              {fullFeed ? 'Show recent only' : 'Show the full feed'}
            </button>
          </div>
          <FeedList items={fullFeed ? world.feed.slice(-300).reverse() : recentRelevant} speed={speed} onPlay={onPlay} />
        </div>
        <aside>
          <div className="side-title">
            What to do next
            <button className="btn small" onClick={onToggleAdvisor}>
              {advisorOn ? 'hide' : 'show'}
            </button>
          </div>
          {advisorOn && cards.length === 0 && <p className="hint">Nothing pressing. Let the clock run and watch the feed.</p>}
          {advisorOn &&
            cards.map((c) => (
              <div key={c.key} className="advice">
                <p>{c.text}</p>
                <button className="btn small" onClick={() => onDismiss(c.key)} title="dismiss for 90 days">
                  dismiss
                </button>
              </div>
            ))}
          {waiting.length > 0 && <div className="side-title">Waiting for you</div>}
          {waiting.map((p) => (
            <DecisionCard key={p.id} world={world} p={p} onDecide={onDecide} />
          ))}
          <table className="wrap">
            <thead>
              <tr>
                <th>Your calls</th>
                <th className="num"></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Approved at your desk</td>
                <td className="num">{num(desk.approved)}{desk.approved > 0 ? `, ${usd(desk.approvedAmount)}` : ''}</td>
              </tr>
              <tr>
                <td>Declined</td>
                <td className="num">{num(desk.declined)}</td>
              </tr>
              <tr>
                <td>Paid off in full</td>
                <td className="num positive">{num(desk.paidOff)}</td>
              </tr>
              <tr>
                <td>Late right now</td>
                <td className={'num' + (late > 0 ? ' alert' : '')}>{num(late)}</td>
              </tr>
              <tr>
                <td>Went bad</td>
                <td className={'num' + (desk.wentBad > 0 ? ' alert' : '')}>{num(desk.wentBad)}{nonaccrual > 0 ? ` (${nonaccrual} still on the books)` : ''}</td>
              </tr>
              <tr className="total">
                <td>Lost on your approvals</td>
                <td className={'num' + (desk.lost > 0 ? ' alert' : '')}>{usd(desk.lost)}</td>
              </tr>
              <tr className="memo-row">
                <td colSpan={2}>{desk.approved === 0 ? 'Nothing decided yet. Loans above the size line on the Lending tab come to you.' : desk.lost === 0 ? 'Not a dollar lost yet on your own calls.' : `${pct(desk.approvedAmount > 0 ? desk.lost / desk.approvedAmount : 0, 1)} of what you approved has been written off.`}</td>
              </tr>
            </tbody>
          </table>
        </aside>
      </div>
    </div>
  );
}

// The three sparklines: assets, profit by quarter, deposits, on Results.
export function Sparks({ bank }: { bank: Bank }) {
  const reports = bank.reports.slice(-40);
  if (reports.length < 2) return null;
  return (
    <div className="sparks">
      <SparkPanel label="Assets" value={usd(totalAssets(bank.acct))} values={reports.map((r) => r.assets)} />
      <SparkPanel label="Profit by quarter" value={usd(reports[reports.length - 1]!.netIncome)} values={reports.map((r) => r.netIncome)} />
      <SparkPanel label="Deposits" value={usd(totalDeposits(bank.acct))} values={reports.map((r) => r.deposits)} />
    </div>
  );
}

function SparkPanel({ label, value, values }: { label: string; value: string; values: number[] }) {
  return (
    <div className="spark-panel">
      <div className="gauge-head">
        <span className="gauge-label">{label}</span>
        <span className="num">{value}</span>
      </div>
      <Sparkline values={values} width={300} height={40} />
    </div>
  );
}

// Banks your size (D56): the peer medians beside your own numbers.
function Peers({ world, bank }: { world: World; bank: Bank }) {
  const g = useMemo(() => peerGroup(world, bank), [world, bank, world.day]);
  const filed = bank.reports.length > 0;
  return (
    <table className="wrap">
      <thead>
        <tr>
          <th>Banks your size ({num(g.n)} of them)</th>
          <th className="num">you</th>
          <th className="num">they</th>
          <th>which is</th>
        </tr>
      </thead>
      <tbody>
        {PEER_METRICS.map((m) => {
          const you = g.you[m.key];
          const they = g.peers[m.key];
          const have = filed && Number.isFinite(you) && Number.isFinite(they);
          const diff = have ? you - they : 0;
          const close = Math.abs(diff) < 0.001;
          const better = m.higherIsBetter ? diff > 0 : diff < 0;
          const word = !have ? '' : close ? 'about the same' : better ? 'better' : 'worse';
          return (
            <tr key={m.key}>
              <td>
                <Term k={m.label}>{m.label}</Term>
              </td>
              <td className="num">{have ? pct(you, 2) : filed ? 'n/a' : ''}</td>
              <td className="num">{Number.isFinite(they) ? pct(they, 2) : 'n/a'}</td>
              <td className={word === 'better' ? 'positive' : word === 'worse' ? 'alert' : 'dim'}>{word}</td>
            </tr>
          );
        })}
        <tr className="memo-row">
          <td colSpan={4}>{filed ? 'Medians of the simulated banks between a third and three times your assets, from their last call report; growth needs a year of reports.' : 'Your first call report closes at the end of the quarter; the other banks have filed.'}</td>
        </tr>
      </tbody>
    </table>
  );
}

// What moves the needle (D56): one step of each lever and a year of it.
function Levers({ world, bank, onGo }: { world: World; bank: Bank; onGo: (tab: string) => void }) {
  const ls = useMemo(() => levers(world, bank), [world, bank, world.day]);
  return (
    <table className="wrap">
      <thead>
        <tr>
          <th>What moves the needle</th>
          <th>today</th>
          <th>one step</th>
          <th className="num">a year of it</th>
        </tr>
      </thead>
      <tbody>
        {ls.map((l) => (
          <tr key={l.key} className="row" onClick={() => onGo(l.tab)} title={l.note}>
            <td>{l.label}</td>
            <td>{l.today}</td>
            <td>{l.step}</td>
            <td className={'num' + (l.effect > 0 ? ' positive' : l.effect < 0 ? ' alert' : '')}>{l.effect === 0 ? '' : (l.effect > 0 ? '+' : '-') + usd(Math.abs(l.effect))}</td>
          </tr>
        ))}
        <tr className="memo-row">
          <td colSpan={4}>Profit before tax from one step, on today's balances, before anyone reacts; hover a line for what it leaves out. Click a line to open the tab that moves it.</td>
        </tr>
      </tbody>
    </table>
  );
}

export function EconomyPanel({ world }: { world: World }) {
  const e = world.economy;
  return (
    <table className="wrap">
      <thead>
        <tr>
          <th>
            The <Term k="cycle">economy</Term>
          </th>
          <th className="num">now</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Cycle</td>
          <td className="num">
            {e.regime === 'late' ? 'late cycle' : e.regime}
            {e.crisis && e.regime === 'recession' ? ', banking crisis' : ''}
          </td>
        </tr>
        <tr>
          <td>
            <Term k="fed funds rate">Fed funds</Term>
          </td>
          <td className="num">{pct(e.fedFunds)}</td>
        </tr>
        <tr>
          <td>10 year Treasury</td>
          <td className="num">{pct(e.curve.y10)}</td>
        </tr>
        <tr>
          <td>Unemployment</td>
          <td className="num">{pct(e.unemployment, 1)}</td>
        </tr>
        <tr>
          <td>Inflation</td>
          <td className="num">{pct(e.inflation, 1)}</td>
        </tr>
        <tr>
          <td>Home prices, 12 months</td>
          <td className={'num' + (e.hpiGrowth < 0 ? ' alert' : '')}>{pct(e.hpiGrowth, 1)}</td>
        </tr>
        <tr>
          <td>Oil</td>
          <td className="num">${e.oil.toFixed(0)}</td>
        </tr>
        <tr className="memo-row">
          <td colSpan={2}>
            {e.regime === 'recession' ? 'In a recession loans go bad faster and deposits get nervous. Keep cash and capital.' : e.regime === 'late' ? 'Late in the cycle: rates are high and lending standards loosen everywhere. Tighten yours.' : e.regime === 'recovery' ? 'Recovery: losses fade, growth returns, deals are cheap.' : 'Expansion: grow, but remember the cycle turns.'}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function formatDay(day: number): string {
  return formatDate(day);
}
