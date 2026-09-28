// The year in review (D65). Each December the board's scorecard: profit
// and return against the banks your size, assets and growth, the climb on
// the ladder, the CEO's own calls, and the CEO's net worth. Home shows the
// latest for the first quarter of the new year; Results keeps every year.

import type { Bank, World, YearReview } from '../engine/state';
import { leverageRatio, totalAssets } from '../engine/ledger';
import { planScore } from '../engine/plan';
import { dateOf, dayOf } from '../engine/time';
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
          <td className="dim">{climb(r).replace(/^#[\d,]+, /, '')}</td>
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

// The de novo business plan on Home (D73): the three counts the FDIC
// holds a new bank to, for the three years and a quarter after.
export function PlanPanel({ world, bank }: { world: World; bank: Bank }) {
  const p = bank.plan;
  if (!p) return null;
  const age = world.day - p.filedDay;
  if (age > 3 * 365 + 90) return null;
  const year = Math.min(3, Math.floor(age / 365) + 1);
  const assets = totalAssets(bank.acct);
  const lev = leverageRatio(bank.acct);
  const score = planScore(bank);
  const quarter = bank.reports.length;
  return (
    <table className="wrap">
      <thead>
        <tr>
          <th>Your business plan{p.done ? ', the de novo years' : `, year ${year} of 3`}</th>
          <th className="num">plan</th>
          <th className="num">you</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {p.assets.map((target, i) => {
          const reached = p.yearsReported > i;
          const tone = '';
          return (
            <tr key={i}>
              <td>Assets at the end of year {i + 1}</td>
              <td className="num">{usd(target)}</td>
              <td className={'num ' + (reached ? ((p.actual?.[i] ?? 0) >= target ? 'positive' : 'alert') : tone)}>{reached ? usd(p.actual?.[i] ?? 0) : i === year - 1 && !p.done ? usd(assets) : ''}</td>
              <td className="dim">{reached ? ((p.actual?.[i] ?? 0) >= target ? 'met' : 'short') : i === year - 1 && !p.done ? `${assets >= target ? 'ahead' : 'to go: ' + usd(target - assets)}` : ''}</td>
            </tr>
          );
        })}
        <tr>
          <td>First profitable quarter</td>
          <td className="num">by quarter {p.breakevenBy}</td>
          <td className={'num' + (p.firstProfitQuarter !== null ? ' positive' : quarter > p.breakevenBy ? ' alert' : '')}>{p.firstProfitQuarter !== null ? `quarter ${p.firstProfitQuarter}` : 'not yet'}</td>
          <td className="dim">{p.firstProfitQuarter !== null ? 'done' : `quarter ${quarter + 1} closes next`}</td>
        </tr>
        <tr>
          <td>Leverage throughout</td>
          <td className="num">{pct(p.capitalFloor, 0)} or more</td>
          <td className={'num' + (lev < p.capitalFloor ? ' alert' : '')}>{pct(lev, 1)}</td>
          <td className="dim">{p.lowestLeverage !== null ? `lowest at a quarter end ${pct(p.lowestLeverage, 1)}` : ''}</td>
        </tr>
        <tr className="memo-row">
          <td colSpan={4}>
            {p.done
              ? `Met on ${score.met} of 3. The de novo years are over: the examiner now rates earnings against the industry.`
              : 'Filed with the FDIC with the charter. The asset path is what a well run new bank in your county gathers; the examiners hold you to the capital line.'}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// Your records (D77): the run's own bests, read only from what the game
// already kept (the year reviews, the deal log and the desk's lifetime
// record). Nothing is scored that did not happen.
export function personalRecords(world: World, bank: Bank): { label: string; value: string; when: string }[] {
  const rows: { label: string; value: string; when: string }[] = [];
  const years = bank.years ?? [];
  const best = <T,>(xs: T[], f: (x: T) => number): T | null => xs.reduce<T | null>((b, x) => (b === null || f(x) > f(b) ? x : b), null);
  const profit = best(years, (y) => y.profit);
  if (profit && profit.profit > 0) rows.push({ label: 'Best year by profit', value: usd(profit.profit), when: String(profit.year) });
  const roa = best(years.filter((y) => !y.deNovo), (y) => y.roa);
  if (roa && roa.roa > 0) rows.push({ label: 'Best return on assets', value: pct(roa.roa), when: String(roa.year) });
  const climbs = years.filter((y) => y.rankAgo !== null);
  const climb = best(climbs, (y) => (y.rankAgo as number) - y.rank);
  if (climb && (climb.rankAgo as number) > climb.rank) rows.push({ label: 'Biggest climb in a year', value: `${num((climb.rankAgo as number) - climb.rank)} places`, when: String(climb.year) });
  const peak = years.reduce<YearReview | null>((b, y) => (b === null || y.rank < b.rank ? y : b), null);
  if (peak) rows.push({ label: 'Best rank at a year end', value: `#${num(peak.rank)}`, when: String(peak.year) });
  const deal = best((world.deals ?? []).filter((d) => d.buyer === bank.name), (d) => d.assets);
  if (deal) rows.push({ label: 'Biggest deal', value: `${deal.target}, ${usd(deal.assets)}`, when: String(dateOf(deal.day).y) });
  const d = bank.desk;
  if (d.approved > 0) {
    rows.push({ label: 'Loans approved at the desk', value: `${num(d.approved)} for ${usd(d.approvedAmount)}`, when: 'lifetime' });
    rows.push({ label: 'Desk losses', value: d.approvedAmount > 0 ? `${pct(d.lost / d.approvedAmount)} of what you lent` : usd(d.lost), when: `${num(d.wentBad)} went bad` });
  }
  return rows;
}

export function RecordsTable({ world, bank }: { world: World; bank: Bank }) {
  const rows = personalRecords(world, bank);
  return (
    <table className="wrap">
      <thead>
        <tr>
          <th>Your records</th>
          <th className="num"></th>
          <th className="num">when</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td>{r.label}</td>
            <td className="num">{r.value}</td>
            <td className="num">{r.when}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={3} className="empty">
              Records start with your first December.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
