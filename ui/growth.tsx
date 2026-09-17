// Earnings growth: quarter over quarter and year over year. Every line of
// the statement and the balance sheet against the period before, then the
// same comparison quarter by quarter so a trend is visible at a glance.

import { type IncomeStatement, interestExpense, interestIncome, netIncome, netInterestIncome, noninterestExpense, pretaxIncome } from '../engine/ledger';
import type { Bank, CallReport } from '../engine/state';
import { change, pct, usd } from './format';
import { Term } from './parts';

type Mode = 'qoq' | 'yoy';

interface Row {
  label: React.ReactNode;
  get: (is: IncomeStatement | null, r: CallReport | undefined) => number | null;
  // Profit falls back to the call report when a save predates the
  // quarter history; every other statement line needs the statement.
  cost?: boolean; // up is bad
  bold?: boolean;
  ratio?: boolean; // shown as a rate, compared in points
}

const ROWS: Row[] = [
  { label: 'Assets', get: (_, r) => r?.assets ?? null, bold: true },
  { label: 'Loans', get: (_, r) => r?.loans ?? null },
  { label: 'Deposits', get: (_, r) => r?.deposits ?? null },
  { label: 'Equity', get: (_, r) => r?.equity ?? null },
  { label: 'Interest earned', get: (is) => (is ? interestIncome(is) : null) },
  { label: 'Interest paid', get: (is) => (is ? interestExpense(is) : null), cost: true },
  { label: <Term k="net interest margin">Net interest income</Term>, get: (is) => (is ? netInterestIncome(is) : null), bold: true },
  { label: <Term k="provision">Set aside for loans going bad</Term>, get: (is) => is?.provision ?? null, cost: true },
  { label: 'Fees and gains', get: (is) => (is ? is.feeIncome + is.securitiesGains : null) },
  { label: 'Running costs', get: (is) => (is ? noninterestExpense(is) : null), cost: true },
  { label: 'Profit before tax', get: (is) => (is ? pretaxIncome(is) : null), bold: true },
  { label: 'Profit', get: (is, r) => (is ? netIncome(is) : (r?.netIncome ?? null)), bold: true },
  { label: <Term k="return on assets">Return on assets</Term>, get: (_, r) => r?.roa ?? null, ratio: true },
  { label: <Term k="net interest margin">Net interest margin</Term>, get: (_, r) => r?.nim ?? null, ratio: true },
  { label: <Term k="leverage ratio">Leverage ratio</Term>, get: (_, r) => r?.leverage ?? null, ratio: true },
];

interface Period {
  label: string;
  is: IncomeStatement | null;
  r: CallReport | undefined;
}

export function GrowthScreen({ bank, mode }: { bank: Bank; mode: Mode }) {
  // One period per call report; the statement joins by quarter where the
  // save has it (saves from before the quarter history have reports only).
  const byQuarter = new Map((bank.quarterHistory ?? []).map((h) => [h.quarter, h.is]));
  const periods: Period[] = bank.reports.map((r) => ({ label: r.quarter, is: byQuarter.get(r.quarter) ?? null, r }));
  const n = periods.length;
  if (n === 0) return <p className="empty">No quarter has closed yet. The first comparison arrives at the end of March.</p>;
  const back = mode === 'qoq' ? 1 : 4;
  const now = periods[n - 1] as Period;
  const then = n - 1 - back >= 0 ? periods[n - 1 - back] : undefined;
  return (
    <div>
      <p className="hint">
        {mode === 'qoq'
          ? 'Each line of the last closed quarter against the quarter before it. A plus is growth; parentheses mean a fall. For costs, a fall is the good direction.'
          : 'Each line of the last closed quarter against the same quarter a year earlier, so seasonal swings cancel out. Below, the last twelve months against the twelve before.'}
      </p>
      <div className="cols">
        <CompareTable title={mode === 'qoq' ? 'Quarter over quarter' : 'Year over year'} now={now} then={then} thenLabel={then ? then.label : mode === 'qoq' ? 'no earlier quarter yet' : 'needs a year of history'} />
        {mode === 'yoy' && <TrailingTable periods={periods} />}
      </div>
      <HistoryTable periods={periods} back={back} />
    </div>
  );
}

function CompareTable({ title, now, then, thenLabel }: { title: string; now: Period; then: Period | undefined; thenLabel: string }) {
  return (
    <table className="wrap">
      <thead>
        <tr>
          <th>{title}</th>
          <th className="num">{thenLabel}</th>
          <th className="num">{now.label}</th>
          <th className="num">change</th>
          <th className="num">change %</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row, i) => {
          const a = row.get(now.is, now.r);
          const b = then ? row.get(then.is, then.r) : null;
          return (
            <tr key={i} className={row.bold ? 'total' : ''}>
              <td>{row.label}</td>
              <td className="num">{b === null ? '' : row.ratio ? pct(b) : usd(b)}</td>
              <td className="num">{a === null ? '' : row.ratio ? pct(a) : usd(a)}</td>
              {row.ratio ? (
                <>
                  <td className={'num ' + tone(a !== null && b !== null ? a - b : 0, row.cost)}>{a !== null && b !== null ? points(a - b) : ''}</td>
                  <td className="num"></td>
                </>
              ) : (
                <>
                  <td className={'num ' + tone(a !== null && b !== null ? a - b : 0, row.cost)}>{a !== null && b !== null ? usd(a - b) : ''}</td>
                  <td className={'num ' + tone(a !== null && b !== null ? a - b : 0, row.cost)}>{a !== null && b !== null ? change(a, b) : ''}</td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// The last four closed quarters against the four before them.
function TrailingTable({ periods }: { periods: Period[] }) {
  const n = periods.length;
  if (n < 8 || periods.slice(n - 8).some((p) => !p.is)) {
    return (
      <table className="wrap">
        <thead>
          <tr>
            <th>Last twelve months against the twelve before</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="empty">Needs two full years of statements. {n < 4 ? `${4 - n} more quarters until the first twelve months close.` : n < 8 ? `${8 - n} more quarters until the comparison year closes.` : 'This save started keeping statements recently; the comparison fills in as quarters close.'}</td>
          </tr>
        </tbody>
      </table>
    );
  }
  const sum = (ps: Period[]) => {
    const t: IncomeStatement = { ...(ps[0] as Period).is! };
    for (const k of Object.keys(t) as (keyof IncomeStatement)[]) t[k] = 0;
    for (const p of ps) if (p.is) for (const k of Object.keys(t) as (keyof IncomeStatement)[]) t[k] += p.is[k];
    return t;
  };
  const recent = periods.slice(n - 4);
  const before = periods.slice(n - 8, n - 4);
  const a = sum(recent);
  const b = sum(before);
  const rows = ROWS.filter((r) => !r.ratio && r.get(a, undefined) !== null);
  return (
    <table className="wrap">
      <thead>
        <tr>
          <th>Twelve months</th>
          <th className="num">
            {(before[0] as Period).label} to {(before[3] as Period).label}
          </th>
          <th className="num">
            {(recent[0] as Period).label} to {(recent[3] as Period).label}
          </th>
          <th className="num">change</th>
          <th className="num">change %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const x = row.get(a, undefined) as number;
          const y = row.get(b, undefined) as number;
          return (
            <tr key={i} className={row.bold ? 'total' : ''}>
              <td>{row.label}</td>
              <td className="num">{usd(y)}</td>
              <td className="num">{usd(x)}</td>
              <td className={'num ' + tone(x - y, row.cost)}>{usd(x - y)}</td>
              <td className={'num ' + tone(x - y, row.cost)}>{change(x, y)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const HISTORY: { label: string; get: (p: Period) => number | null }[] = [
  { label: 'profit', get: (p) => (p.is ? netIncome(p.is) : (p.r?.netIncome ?? null)) },
  { label: 'net interest income', get: (p) => (p.is ? netInterestIncome(p.is) : null) },
  { label: 'running costs', get: (p) => (p.is ? noninterestExpense(p.is) : null) },
  { label: 'assets', get: (p) => p.r?.assets ?? null },
  { label: 'loans', get: (p) => p.r?.loans ?? null },
  { label: 'deposits', get: (p) => p.r?.deposits ?? null },
];

function HistoryTable({ periods, back }: { periods: Period[]; back: number }) {
  const n = periods.length;
  const rows = periods.slice(Math.max(0, n - 16)).reverse();
  return (
    <table>
      <thead>
        <tr>
          <th>Quarter by quarter{back === 4 ? ', each against a year earlier' : ''}</th>
          {HISTORY.map((h) => (
            <th key={h.label} className="num" colSpan={2}>
              {h.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const i = periods.indexOf(p);
          const prev = i - back >= 0 ? periods[i - back] : undefined;
          return (
            <tr key={p.label}>
              <td>{p.label}</td>
              {HISTORY.map((h) => {
                const a = h.get(p);
                const b = prev ? h.get(prev) : null;
                const cost = h.label === 'running costs';
                return (
                  <FragmentCells key={h.label} a={a} b={b} cost={cost} />
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FragmentCells({ a, b, cost }: { a: number | null; b: number | null; cost: boolean }) {
  return (
    <>
      <td className={'num' + (a !== null && a < 0 ? ' alert' : '')}>{a === null ? '' : usd(a)}</td>
      <td className={'num dim ' + (a !== null && b !== null ? tone(a - b, cost) : '')}>{a !== null && b !== null ? change(a, b) : ''}</td>
    </>
  );
}

function tone(delta: number, cost = false): string {
  if (Math.abs(delta) < 1e-9) return '';
  const good = cost ? delta < 0 : delta > 0;
  return good ? 'positive' : 'alert';
}

function points(d: number): string {
  const s = `${(Math.abs(d) * 100).toFixed(2)} pts`;
  return d < 0 ? `(${s})` : `+${s}`;
}
