// The year in review (D65). Each December the board's scorecard: profit
// and return against the banks your size, assets and growth, the climb on
// the ladder, the CEO's own calls, and the CEO's net worth. Home shows the
// latest for the first quarter of the new year; Results keeps every year.

import type { Bank, World, YearReview } from '../engine/state';
import { dayOf } from '../engine/time';
import { num, pct, usd } from './format';

function verdict(r: YearReview): { text: string; tone: 'positive' | 'alert' | '' } {
  if (r.peerRoa === null) return { text: r.profit >= 0 ? 'A profitable year.' : 'A losing year.', tone: r.profit >= 0 ? 'positive' : 'alert' };
  if (r.roa > r.peerRoa + 0.002) return { text: `A better year than most of the ${num(r.peers)} banks your size.`, tone: 'positive' };
  if (r.roa < r.peerRoa - 0.002 && r.deNovo) return { text: `A de novo year: a new bank earns little while it builds its book, and the ${num(r.peers)} banks your size are older.`, tone: '' };
  if (r.roa < r.peerRoa - 0.002) return { text: `A worse year than most of the ${num(r.peers)} banks your size.`, tone: 'alert' };
  return { text: `About the same year as the ${num(r.peers)} banks your size.`, tone: '' };
}

function climb(r: YearReview): string {
  if (r.rank <= 0) return 'not ranked yet';
  if (r.rankAgo === null) return 'your first year on the ladder';
  const d = r.rankAgo - r.rank;
  return `#${num(r.rank)}, ${d > 0 ? `up ${num(d)} places` : d < 0 ? `down ${num(-d)} places` : 'no change'}`;
}

// Home, January to March: the year just closed, in one panel.
export function YearPanel({ world, bank, onHide }: { world: World; bank: Bank; onHide: () => void }) {
  const r = bank.years?.[bank.years.length - 1];
  if (!r || world.day - dayOf(r.year, 12, 31) > 90) return null;
  const prev = bank.years && bank.years.length >= 2 ? bank.years[bank.years.length - 2] : undefined;
  const v = verdict(r);
  return (
    <table className="wrap">
      <thead>
        <tr>
          <th>{r.year} in review</th>
          <th className="num"></th>
          <th>
            <button className="btn small" onClick={onHide}>
              hide
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr className={'total ' + v.tone}>
          <td colSpan={3}>{v.text}</td>
        </tr>
        <tr>
          <td>{r.profit >= 0 ? 'Profit' : 'Loss'}</td>
          <td className="num">{usd(Math.abs(r.profit))}</td>
          <td className="dim">
            {pct(r.roa, 2)} on assets{r.peerRoa !== null ? `; the banks your size earned ${pct(r.peerRoa, 2)}` : ''}
          </td>
        </tr>
        <tr>
          <td>Assets</td>
          <td className="num">{usd(r.assets)}</td>
          <td className="dim">{r.growth === null ? 'first full year' : `${r.growth >= 0 ? 'up' : 'down'} ${pct(Math.abs(r.growth), 1)} on the year`}</td>
        </tr>
        <tr>
          <td>Rank in America</td>
          <td className="num">{r.rank > 0 ? `#${num(r.rank)}` : ''}</td>
          <td className="dim">{climb(r)}</td>
        </tr>
        <tr>
          <td>Your calls</td>
          <td className="num">{num(r.approved)}</td>
          <td className="dim">loans approved at your desk; {num(r.wentBad)} went bad this year</td>
        </tr>
        <tr>
          <td>Your net worth</td>
          <td className="num">{usd(r.netWorth)}</td>
          <td className="dim">{prev ? `${r.netWorth >= prev.netWorth ? 'up' : 'down'} ${usd(Math.abs(r.netWorth - prev.netWorth))} since ${prev.year}` : 'your stake at book plus your cash'}</td>
        </tr>
      </tbody>
    </table>
  );
}

// Results: every year the bank has run, newest first.
export function YearsTable({ bank }: { bank: Bank }) {
  const years = [...(bank.years ?? [])].reverse();
  if (years.length === 0) return <p className="hint">The first year in review closes on December 31.</p>;
  return (
    <table className="wrap">
      <thead>
        <tr>
          <th>year</th>
          <th className="num">profit</th>
          <th className="num">return on assets</th>
          <th className="num">banks your size</th>
          <th className="num">assets</th>
          <th className="num">growth</th>
          <th className="num">rank</th>
          <th className="num">your calls</th>
          <th className="num">went bad</th>
          <th className="num">your net worth</th>
        </tr>
      </thead>
      <tbody>
        {years.map((r) => (
          <tr key={r.year}>
            <td>{r.year}</td>
            <td className={'num' + (r.profit < 0 ? ' bad' : '')}>{r.profit < 0 ? `(${usd(-r.profit)})` : usd(r.profit)}</td>
            <td className="num">{pct(r.roa, 2)}</td>
            <td className="num">{r.peerRoa === null ? 'n/a' : pct(r.peerRoa, 2)}</td>
            <td className="num">{usd(r.assets)}</td>
            <td className="num">{r.growth === null ? 'n/a' : pct(r.growth, 1)}</td>
            <td className="num">{r.rank > 0 ? `#${num(r.rank)}` : ''}</td>
            <td className="num">{num(r.approved)}</td>
            <td className="num">{num(r.wentBad)}</td>
            <td className="num">{usd(r.netWorth)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
