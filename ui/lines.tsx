// LINES (D44): business lines with their P&L, balance sheet footprint,
// and on/off switch with the setup cost.

import type { Ctx } from '../engine/ctx';
import { totalAssets } from '../engine/ledger';
import { LINE_LABEL, LINE_ORDER, LINE_THRESHOLDS, lineAvailable, setupCost, toggleLine } from '../engine/lines';
import { type Bank, type World } from '../engine/state';
import { formatDate } from '../engine/time';
import { type Unit, dollars, short, unitLabel } from './format';

export function LinesScreen({ world, bank, unit, act }: { world: World; bank: Bank; unit: Unit; act: (fn: (ctx: Ctx) => void) => void }) {
  const assets = totalAssets(bank.acct);
  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>BUSINESS LINES {unitLabel(unit)}</th>
            <th className="num">threshold</th>
            <th>status</th>
            <th className="num">footprint</th>
            <th className="num">YTD revenue</th>
            <th className="num">YTD cost</th>
            <th className="num">YTD net</th>
            <th className="num">last year net</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {LINE_ORDER.map((key) => {
            const l = bank.lines[key];
            const available = lineAvailable(bank, key);
            const footprint = key === 'mortgage' ? 'serviced' : key === 'cards' ? 'receivables' : key === 'wealth' ? 'AUM' : 'trading book';
            return (
              <tr key={key} className={l.on ? '' : available ? '' : 'dim'}>
                <td>{LINE_LABEL[key]}</td>
                <td className="num">{short(LINE_THRESHOLDS[key])}</td>
                <td>{l.on ? `on since ${formatDate(l.startedDay ?? 0)}` : available ? 'available' : `needs ${short(LINE_THRESHOLDS[key])} of assets`}</td>
                <td className="num">
                  {dollars(l.balance, unit)} {footprint}
                </td>
                <td className="num">{dollars(l.ytdRevenue, unit)}</td>
                <td className="num">{dollars(l.ytdCost, unit)}</td>
                <td className={'num' + (l.ytdRevenue - l.ytdCost < 0 ? ' alert' : '')}>{dollars(l.ytdRevenue - l.ytdCost, unit)}</td>
                <td className="num">{dollars(l.lastYearRevenue - l.lastYearCost, unit)}</td>
                <td>
                  <button className="key" disabled={!available || (!l.on && bank.acct.cash < setupCost(key))} onClick={() => act((ctx) => toggleLine(ctx, bank, key))}>
                    {l.on ? 'wind down' : `start (${short(setupCost(key))} setup)`}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="dim">
        Assets {short(assets)}. Mortgage banking: originate and sell, gain on sale, servicing and an MSR that moves with rates. Cards: receivables in a cards pool with card charge-offs, interchange less rewards and operations. Wealth: assets under management and fees. Investment banking: fees by cycle and a trading book with a fat left tail. Each line's cost includes a fixed staff. Card charge-offs and all lines flow through the income statement and the earnings review.
      </p>
      <p className="dim">{world.economy.regime === 'recession' ? 'In a recession, mortgage volume, IB fees and AUM all fall.' : ''}</p>
    </div>
  );
}
