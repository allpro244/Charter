// RIVALS: every bank in the world, call report style (D15). Individuals
// first by assets, then the state aggregates. Click a bank for its last
// quarters and its book by type.

import { useState } from 'react';
import { TYPE, bookByType } from '../engine/credit';
import { rivalReport } from '../engine/rivals';
import { type World } from '../engine/state';
import { type Unit, dollars, num, pct, unitLabel } from './format';
import { ReportsTable } from './screens';

export function RivalsScreen({ world, unit }: { world: World; unit: Unit }) {
  const [open, setOpen] = useState<string | null>(null);
  const [showAggregates, setShowAggregates] = useState(false);
  const rows = world.bankOrder
    .map((id) => world.banks[id]!)
    .filter((b) => b.kind !== 'player' && b.status !== 'acquired')
    .map((b) => rivalReport(world, b))
    .sort((a, b) => (a.kind === b.kind ? b.assets - a.assets : a.kind === 'rival' ? -1 : 1));
  const shown = rows.filter((r) => showAggregates || r.kind === 'rival').slice(0, 400);
  const failed = rows.filter((r) => r.status === 'failed').length;
  return (
    <div>
      <div className="keys-inline">
        <button className={'key' + (showAggregates ? ' on' : '')} onClick={() => setShowAggregates((x) => !x)}>
          {showAggregates ? 'hide' : 'show'} state aggregates
        </button>
        <span className="dim">
          {rows.filter((r) => r.kind === 'rival' && r.status === 'open').length} individual banks, {rows.filter((r) => r.kind === 'aggregate').length} aggregates, {failed} failed, {world.failures.length} failures recorded in the world
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>BANK {unitLabel(unit)}</th>
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
              <RivalRows key={r.id} r={r} bank={bank} world={world} unit={unit} open={open === r.id} toggle={() => setOpen(open === r.id ? null : r.id)} />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RivalRows({ r, bank, world, unit, open, toggle }: { r: ReturnType<typeof rivalReport>; bank: World['banks'][string]; world: World; unit: Unit; open: boolean; toggle: () => void }) {
  const cls = r.status === 'failed' ? 'row alert' : r.status === 'closing' ? 'row alert' : 'row';
  return (
    <>
      <tr className={cls} onClick={toggle}>
        <td>
          {r.name}
          {r.national ? ' (national)' : ''}
          {r.kind === 'aggregate' ? ` (${num(r.represents)} banks)` : ''}
          {r.forSale ? ' [for sale]' : ''}
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
            <div className="cols">
              <ReportsTable bank={bank} unit={unit} />
              <table>
                <thead>
                  <tr>
                    <th>BOOK BY TYPE {unitLabel(unit)}</th>
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
            <p className="dim">{world.geo.counties[bank.homeCounty ?? '']?.name ?? ''}</p>
          </td>
        </tr>
      )}
    </>
  );
}
