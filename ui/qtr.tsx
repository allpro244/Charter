// QTR: the quarterly earnings review (D34). Every dollar attributed: income
// by book, cost by deposit type, losses by loan and the decision that made
// them, overhead, provision, tax. Ties to the ledger to the dollar.

import { useState } from 'react';
import { TYPE } from '../engine/credit';
import { type Bank, type QuarterReview } from '../engine/state';
import { formatDate } from '../engine/time';
import { type Unit, dollars, unitLabel } from './format';

export function QtrScreen({ bank, unit }: { bank: Bank; unit: Unit }) {
  const [idx, setIdx] = useState<number | null>(null);
  const reviews = bank.reviews;
  if (reviews.length === 0) return <p className="empty">No quarter has closed yet. The first earnings review arrives at the end of March.</p>;
  const i = idx === null ? reviews.length - 1 : Math.max(0, Math.min(reviews.length - 1, idx));
  const r = reviews[i] as QuarterReview;
  const prev = i > 0 ? reviews[i - 1] : undefined;
  const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
  const overhead = r.overhead.salaries + r.overhead.occupancy + r.overhead.other + r.overhead.assessment;
  return (
    <div>
      <p className="hint">The quarterly earnings review: every dollar earned and lost, and which decisions made the losses. It ties to the ledger to the dollar.</p>
      <div className="toolbar">
        <button className="btn" onClick={() => setIdx(i - 1)} disabled={i === 0}>
          Previous quarter
        </button>
        <strong>
          {r.quarter}, closed {formatDate(r.day)}
        </strong>
        <button className="btn" onClick={() => setIdx(i + 1)} disabled={i === reviews.length - 1}>
          Next quarter
        </button>
      </div>
      <div className="cols">
        <table>
          <thead>
            <tr>
              <th>Earnings review {r.quarter} {unitLabel(unit)}</th>
              <th className="num">this quarter</th>
              <th className="num">prior</th>
            </tr>
          </thead>
          <tbody>
            {r.interestByBook.map((b) => (
              <tr key={b.book}>
                <td className="indent">Interest on {b.book}</td>
                <td className="num">{dollars(b.amount, unit)}</td>
                <td className="num">{prev ? dollars(prev.interestByBook.find((x) => x.book === b.book)?.amount ?? 0, unit) : ''}</td>
              </tr>
            ))}
            <tr>
              <td className="indent">Interest on securities and cash</td>
              <td className="num">{dollars(r.otherInterestIncome, unit)}</td>
              <td className="num">{prev ? dollars(prev.otherInterestIncome, unit) : ''}</td>
            </tr>
            <tr className="total">
              <td>Interest income</td>
              <td className="num">{dollars(sum(r.interestByBook) + r.otherInterestIncome, unit)}</td>
              <td className="num">{prev ? dollars(sum(prev.interestByBook) + prev.otherInterestIncome, unit) : ''}</td>
            </tr>
            {r.depositCostByType.map((d) => (
              <tr key={d.type}>
                <td className="indent">Cost of {d.type}</td>
                <td className="num">{dollars(d.amount, unit)}</td>
                <td className="num">{prev ? dollars(prev.depositCostByType.find((x) => x.type === d.type)?.amount ?? 0, unit) : ''}</td>
              </tr>
            ))}
            <tr>
              <td className="indent">Cost of borrowings</td>
              <td className="num">{dollars(r.otherInterestExpense, unit)}</td>
              <td className="num">{prev ? dollars(prev.otherInterestExpense, unit) : ''}</td>
            </tr>
            <tr className="total">
              <td>Net interest income</td>
              <td className="num">{dollars(sum(r.interestByBook) + r.otherInterestIncome - sum(r.depositCostByType) - r.otherInterestExpense, unit)}</td>
              <td className="num">{prev ? dollars(sum(prev.interestByBook) + prev.otherInterestIncome - sum(prev.depositCostByType) - prev.otherInterestExpense, unit) : ''}</td>
            </tr>
            <tr>
              <td>Provision for credit losses</td>
              <td className="num">{dollars(r.provision, unit)}</td>
              <td className="num">{prev ? dollars(prev.provision, unit) : ''}</td>
            </tr>
            <tr>
              <td>Fee income and REO gains</td>
              <td className="num">{dollars(r.feeIncome, unit)}</td>
              <td className="num">{prev ? dollars(prev.feeIncome, unit) : ''}</td>
            </tr>
            <tr>
              <td>Securities gains</td>
              <td className="num">{dollars(r.securitiesGains, unit)}</td>
              <td className="num">{prev ? dollars(prev.securitiesGains, unit) : ''}</td>
            </tr>
            <tr>
              <td className="indent">Salaries and officers</td>
              <td className="num">{dollars(r.overhead.salaries, unit)}</td>
              <td className="num">{prev ? dollars(prev.overhead.salaries, unit) : ''}</td>
            </tr>
            <tr>
              <td className="indent">Occupancy and branches</td>
              <td className="num">{dollars(r.overhead.occupancy, unit)}</td>
              <td className="num">{prev ? dollars(prev.overhead.occupancy, unit) : ''}</td>
            </tr>
            <tr>
              <td className="indent">Other expense and REO losses</td>
              <td className="num">{dollars(r.overhead.other, unit)}</td>
              <td className="num">{prev ? dollars(prev.overhead.other, unit) : ''}</td>
            </tr>
            <tr>
              <td className="indent">FDIC assessment</td>
              <td className="num">{dollars(r.overhead.assessment, unit)}</td>
              <td className="num">{prev ? dollars(prev.overhead.assessment, unit) : ''}</td>
            </tr>
            <tr className="total">
              <td>Overhead</td>
              <td className="num">{dollars(overhead, unit)}</td>
              <td className="num">{prev ? dollars(prev.overhead.salaries + prev.overhead.occupancy + prev.overhead.other + prev.overhead.assessment, unit) : ''}</td>
            </tr>
            <tr>
              <td>Income tax</td>
              <td className="num">{dollars(r.tax, unit)}</td>
              <td className="num">{prev ? dollars(prev.tax, unit) : ''}</td>
            </tr>
            <tr className={'total' + (r.netIncome < 0 ? ' alert' : ' positive')}>
              <td>Net income</td>
              <td className="num">{dollars(r.netIncome, unit)}</td>
              <td className="num">{prev ? dollars(prev.netIncome, unit) : ''}</td>
            </tr>
            <tr className="memo-row">
              <td>Ledger net income (must match)</td>
              <td className="num">{dollars(r.ledgerNetIncome, unit)}</td>
              <td className="num">{prev ? dollars(prev.ledgerNetIncome, unit) : ''}</td>
            </tr>
          </tbody>
        </table>
        <div>
          <table className="wrap">
            <thead>
              <tr>
                <th>Losses by loan and decision {unitLabel(unit)}</th>
                <th>type</th>
                <th className="num">loss</th>
                <th>decided by</th>
                <th className="num">on</th>
                <th>signal that predicted it</th>
              </tr>
            </thead>
            <tbody>
              {r.lossesByLoan.map((l, k) => (
                <tr key={k} className="alert">
                  <td>{l.loan}</td>
                  <td>{TYPE[l.type].label}</td>
                  <td className="num">{dollars(l.amount, unit)}</td>
                  <td>{l.decidedBy === 'player' ? 'you' : l.decidedBy}</td>
                  <td className="num">{formatDate(l.decidedOn)}</td>
                  <td>{l.signal}</td>
                </tr>
              ))}
              {r.lossesByLoan.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    No relationship loan losses this quarter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th>Pooled charge-offs by book {unitLabel(unit)}</th>
                <th className="num">charge-offs</th>
              </tr>
            </thead>
            <tbody>
              {r.lossesByPool.map((p) => (
                <tr key={p.type}>
                  <td>{TYPE[p.type].label}</td>
                  <td className="num">{dollars(p.amount, unit)}</td>
                </tr>
              ))}
              <tr className="memo-row">
                <td>Recoveries</td>
                <td className="num">{dollars(r.recoveries, unit)}</td>
              </tr>
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th>Your calls</th>
                <th className="num">loss</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Loans you approved</td>
                <td className="num">{dollars(r.lossesByLoan.filter((l) => l.decidedBy === 'player').reduce((s, l) => s + l.amount, 0), unit)}</td>
              </tr>
              <tr>
                <td>Auto-approved under your policy</td>
                <td className="num">{dollars(r.lossesByLoan.filter((l) => l.decidedBy === 'auto').reduce((s, l) => s + l.amount, 0), unit)}</td>
              </tr>
              <tr>
                <td>Inherited at takeover</td>
                <td className="num">{dollars(r.lossesByLoan.filter((l) => l.decidedBy === 'inherited').reduce((s, l) => s + l.amount, 0), unit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
