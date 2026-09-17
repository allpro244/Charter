// RIVALS: every bank in the world, call report style (D15). Individuals
// first by assets, then the state aggregates. Click a bank for its last
// quarters and its book by type.

import { useState } from 'react';
import { tangibleEquity } from '../engine/capital';
import { TYPE, bookByType } from '../engine/credit';
import type { Ctx } from '../engine/ctx';
import { dealCapacity, makeOffer, reservationPriceToBook } from '../engine/deals';
import { rivalReport } from '../engine/rivals';
import { type Bank, type World } from '../engine/state';
import { type Unit, dollars, num, pct, short, unitLabel } from './format';
import { ReportsTable } from './screens';

function OfferRow({ world, buyer, target, act }: { world: World; buyer: Bank; target: Bank; act: (fn: (ctx: Ctx) => void) => void }) {
  const [pb, setPb] = useState(Math.round(reservationPriceToBook(world, target) * 100) / 100);
  const [stock, setStock] = useState(0);
  const [last, setLast] = useState('');
  const book = tangibleEquity(target);
  const cap = dealCapacity(buyer);
  return (
    <table>
      <thead>
        <tr>
          <th>Offer for {target.name}</th>
          <th className="num">tangible book {short(book)}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Price to tangible book (boards ask about {reservationPriceToBook(world, target).toFixed(2)}x in this cycle)</td>
          <td className="num">
            <input className="short" type="number" step={0.05} min={0.3} max={3} value={pb} onChange={(e) => setPb(Number(e.target.value))} />
            <span className="nowrap">= {short(Math.round(book * pb))}</span>
          </td>
          <td>
            <button className="btn primary" onClick={() => act((ctx) => setLast(makeOffer(ctx, buyer, target.id, pb, stock).why))}>Make the offer</button>
          </td>
        </tr>
        <tr>
          <td>Stock share of the price (needs a holding company)</td>
          <td className="num">
            {[0, 0.25, 0.5, 0.75, 1].map((x) => (
              <button key={x} className={'key' + (stock === x ? ' on' : '')} onClick={() => setStock(x)} disabled={x > 0 && !cap.stock}>
                {pct(x, 0)}
              </button>
            ))}
          </td>
          <td className="dim">cash you can spend: {short(cap.cash)}</td>
        </tr>
        {last && (
          <tr>
            <td colSpan={3} className="dim">
              {last}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function RivalsScreen({ world, unit, act }: { world: World; unit: Unit; act?: (fn: (ctx: Ctx) => void) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [showAggregates, setShowAggregates] = useState(false);
  const [filter, setFilter] = useState('');
  const rows = world.bankOrder
    .map((id) => world.banks[id]!)
    .filter((b) => b.kind !== 'player' && b.status !== 'acquired')
    .map((b) => rivalReport(world, b))
    .sort((a, b) => (a.kind === b.kind ? b.assets - a.assets : a.kind === 'rival' ? -1 : 1));
  const q = filter.trim().toLowerCase();
  const shown = rows
    .filter((r) => showAggregates || r.kind === 'rival')
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.state.toLowerCase() === q || (r.county ?? '').toLowerCase().includes(q))
    .slice(0, 400);
  const failed = rows.filter((r) => r.status === 'failed').length;
  return (
    <div>
      <p className="hint">Every other bank in the world, largest first. Click a bank for its call reports and its book, and to make an offer for it.</p>
      <div className="toolbar">
        <input className="filter" style={{ maxWidth: 260 }} placeholder="Find a bank, state or town" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className={'btn' + (showAggregates ? ' on' : '')} onClick={() => setShowAggregates((x) => !x)}>
          {showAggregates ? 'Hide' : 'Show'} state aggregates
        </button>
        <span className="dim">
          {rows.filter((r) => r.kind === 'rival' && r.status === 'open').length} individual banks, {rows.filter((r) => r.kind === 'aggregate').length} aggregates, {failed} failed, {world.failures.length} failures recorded in the world
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Bank {unitLabel(unit)}</th>
            <th>state</th>
            <th>home</th>
            <th className="num">assets</th>
            <th className="num">deposits</th>
            <th className="num">loans</th>
            <th className="num">leverage</th>
            <th className="num">ROA</th>
            <th className="num">NIM</th>
            <th className="num">NCO</th>
            <th className="num">branches</th>
            <th>status</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const bank = world.banks[r.id]!;
            return (
              <RivalRows key={r.id} r={r} bank={bank} world={world} unit={unit} open={open === r.id} toggle={() => setOpen(open === r.id ? null : r.id)} act={act} />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RivalRows({ r, bank, world, unit, open, toggle, act }: { r: ReturnType<typeof rivalReport>; bank: World['banks'][string]; world: World; unit: Unit; open: boolean; toggle: () => void; act?: (fn: (ctx: Ctx) => void) => void }) {
  const cls = r.status === 'failed' ? 'row alert' : r.status === 'closing' ? 'row alert' : 'row';
  const player = world.playerBankId ? world.banks[world.playerBankId] : undefined;
  return (
    <>
      <tr className={cls} onClick={toggle}>
        <td>
          <span className="chev">{open ? '\u25BE' : '\u25B8'}</span>
          {r.name}
          {r.national ? ' (national)' : ''}
          {r.kind === 'aggregate' ? ` (${num(r.represents)} banks)` : ''}
          {r.forSale && r.status === 'open' ? <span className="pill warn" style={{ marginLeft: 6 }}>for sale</span> : ''}
        </td>
        <td>{r.state}</td>
        <td>{r.county}</td>
        <td className="num">{dollars(r.assets, unit)}</td>
        <td className="num">{dollars(r.deposits, unit)}</td>
        <td className="num">{dollars(r.loans, unit)}</td>
        <td className={'num' + (r.leverage < 0.05 && r.status === 'open' ? ' alert' : '')}>{pct(r.leverage, 1)}</td>
        <td className="num">{pct(r.roa)}</td>
        <td className="num">{pct(r.nim)}</td>
        <td className="num">{pct(r.nco)}</td>
        <td className="num">{r.branches}</td>
        <td>{r.status}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={12}>
            <div>
              <ReportsTable bank={bank} unit={unit} />
              <table className="inner">
                <thead>
                  <tr>
                    <th>Book by type {unitLabel(unit)}</th>
                    <th className="num">balance</th>
                    <th className="num">yield</th>
                    <th className="num">criticized</th>
                    <th className="num">nonaccrual</th>
                  </tr>
                </thead>
                <tbody>
                  {bookByType(bank).map((row) => (
                    <tr key={row.type}>
                      <td>{TYPE[row.type].label}</td>
                      <td className="num">{dollars(row.balance, unit)}</td>
                      <td className="num">{pct(row.yield)}</td>
                      <td className="num">{pct(row.balance > 0 ? row.criticized / row.balance : 0, 1)}</td>
                      <td className="num">{pct(row.balance > 0 ? row.nonaccrual / row.balance : 0, 1)}</td>
                    </tr>
                  ))}
                  {bank.ai && (
                    <tr className="memo-row">
                      <td colSpan={5}>
                        policy: risk appetite {pct(bank.ai.riskAppetite, 0)}, growth {pct(bank.ai.growthTarget, 0)}, rate aggression {(bank.ai.rateAggression * 50).toFixed(0)}bp, acquisitive {pct(bank.ai.acquisitive, 0)}, branch push {pct(bank.ai.branchPush, 0)}. Money market {pct(bank.rates.mmda)}, CDs {pct(bank.rates.cd)}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {player && act && bank.kind === 'rival' && bank.status === 'open' && <OfferRow world={world} buyer={player} target={bank} act={act} />}
            {bank.kind === 'aggregate' && bank.status === 'open' && (
              <p className="dim">An aggregate. Open a branch in this state or buy a bank there to see its banks individually (D42).</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
