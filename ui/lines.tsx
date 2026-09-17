// LINES (D44): business lines with their P&L, balance sheet footprint,
// and on/off switch with the setup cost.

import type { Ctx } from '../engine/ctx';
import { GLOBAL_FLOOR, canGoGlobal, foreignCandidates, foreignSummary, offerForeign } from '../engine/global';
import { totalAssets } from '../engine/ledger';
import { pct } from './format';
import { LINE_LABEL, LINE_ORDER, LINE_THRESHOLDS, lineAvailable, setupCost, toggleLine } from '../engine/lines';
import { type Bank, type World } from '../engine/state';
import { formatDate } from '../engine/time';
import { type Unit, dollars, short, unitLabel, usd } from './format';

export function LinesScreen({ world, bank, unit, act, part = 'lines' }: { world: World; bank: Bank; unit: Unit; act: (fn: (ctx: Ctx) => void) => void; part?: 'lines' | 'abroad' }) {
  const assets = totalAssets(bank.acct);
  if (part === 'abroad') return <GlobalTables world={world} bank={bank} unit={unit} act={act} />;
  return (
    <div>
      <p className="hint">Business lines beyond lending, each unlocked when the bank reaches a size. A line is a staffed operation with its own revenue and cost; both flow through earnings.</p>
      <table className="wrap">
        <thead>
          <tr>
            <th>Business lines {unitLabel(unit)}</th>
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
            if (!available && !l.on) {
              return (
                <tr key={key} className="memo-row">
                  <td>{LINE_LABEL[key]}</td>
                  <td colSpan={8}>Unlocks at {short(LINE_THRESHOLDS[key])} of assets.</td>
                </tr>
              );
            }
            return (
              <tr key={key}>
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
                  <button className={'btn small' + (l.on ? ' danger' : ' primary')} disabled={!available || (!l.on && bank.acct.cash < setupCost(key))} onClick={() => act((ctx) => toggleLine(ctx, bank, key))}>
                    {l.on ? 'Wind down' : `Start (${short(setupCost(key))} setup)`}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">
        Assets {usd(assets)}. Mortgage banking: originate and sell, gain on sale, servicing and an MSR that moves with rates. Cards: receivables in a cards pool with card charge-offs, interchange less rewards and operations. Wealth: assets under management and fees. Investment banking: fees by cycle and a trading book with a fat left tail. Each line's cost includes a fixed staff. Card charge-offs and all lines flow through the income statement and the earnings review.
      </p>
      <p className="dim">{world.economy.regime === 'recession' ? 'In a recession, mortgage volume, IB fees and AUM all fall.' : ''}</p>
    </div>
  );
}

// The global stage (D45): countries, subsidiaries, banks for sale abroad.
function GlobalTables({ world, bank, unit, act }: { world: World; bank: Bank; unit: Unit; act: (fn: (ctx: Ctx) => void) => void }) {
  const countries = Object.values(world.countries);
  const ok = canGoGlobal(bank);
  if (!ok && bank.foreign.length === 0) {
    return (
      <div>
        <p className="hint">The world beyond the border unlocks at {short(GLOBAL_FLOOR)} of assets, with a holding company and no enforcement action. Until then the countries below are the backdrop: their rates and cycles move the world you lend in.</p>
        <table>
          <thead>
            <tr>
              <th>Countries</th>
              <th>currency</th>
              <th className="num">per USD</th>
              <th className="num">policy rate</th>
              <th className="num">10 year</th>
              <th>cycle</th>
            </tr>
          </thead>
          <tbody>
            {countries.map((c) => (
              <tr key={c.code}>
                <td>
                  {c.name} ({c.city})
                </td>
                <td>{c.currency}</td>
                <td className="num">{c.fx.toFixed(c.fx > 20 ? 1 : 3)}</td>
                <td className="num">{pct(c.rate)}</td>
                <td className="num">{pct(c.y10)}</td>
                <td>{c.regime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div>
      <p className="hint">Countries, your subsidiaries abroad, and the banks for sale there. Books abroad stay in local currency; the translation runs through AOCI.</p>
      <div>
        <table>
          <thead>
            <tr>
              <th>Countries</th>
              <th>currency</th>
              <th className="num">per USD</th>
              <th className="num">vs start</th>
              <th className="num">policy rate</th>
              <th className="num">10 year</th>
              <th className="num">activity</th>
              <th>cycle</th>
              <th className="num">sovereign spread</th>
            </tr>
          </thead>
          <tbody>
            {countries.map((c) => (
              <tr key={c.code} className={c.sovereignStress > 0.5 ? 'alert' : ''}>
                <td>{c.name} ({c.city})</td>
                <td>{c.currency}</td>
                <td className="num">{c.fx.toFixed(c.fx > 20 ? 1 : 3)}</td>
                <td className="num">{pct(c.fx / c.fxStart - 1, 1)}</td>
                <td className="num">{pct(c.rate)}</td>
                <td className="num">{pct(c.y10)}</td>
                <td className="num">{c.index.toFixed(1)}</td>
                <td>{c.regime}</td>
                <td className="num">{(c.sovereignSpread * 10_000).toFixed(0)}bp</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th>Subsidiaries abroad {unitLabel(unit)}</th>
              <th>country</th>
              <th className="num">assets</th>
              <th className="num">deposits</th>
              <th className="num">loans</th>
              <th className="num">equity</th>
              <th className="num">leverage</th>
              <th className="num">currency vs start</th>
            </tr>
          </thead>
          <tbody>
            {bank.foreign.map((f) => {
              const s = foreignSummary(world, f);
              return (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>{world.countries[f.country]?.name}</td>
                  <td className="num">{dollars(s.assets, unit)}</td>
                  <td className="num">{dollars(s.deposits, unit)}</td>
                  <td className="num">{dollars(s.loans, unit)}</td>
                  <td className="num">{dollars(s.equity, unit)}</td>
                  <td className="num">{pct(s.leverage, 1)}</td>
                  <td className="num">{pct(-s.fxChange, 1)}</td>
                </tr>
              );
            })}
            <tr className={bank.gsib ? 'alert' : 'memo-row'}>
              <td colSpan={8}>
                {bank.gsib ? `Global systemically important bank since ${formatDate(bank.gsib.since)}: CET1 surcharge ${pct(bank.gsib.surcharge, 1)}.` : `Global stage from ${short(GLOBAL_FLOOR)} of assets with a holding company and no enforcement action. Books abroad stay in local currency; translation runs through AOCI.`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {ok && (
        <table>
          <thead>
            <tr>
              <th>Banks for sale abroad</th>
              <th>country</th>
              <th className="num">assets (USD)</th>
              <th className="num">deposits (USD)</th>
              <th className="num">equity (USD)</th>
              <th className="num">price to book</th>
              <th className="num">price (USD)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {countries.flatMap((c) =>
              foreignCandidates(world, c.code).map((cand) => (
                <tr key={`${c.code}${cand.key}`}>
                  <td>{cand.name}</td>
                  <td>{c.name}</td>
                  <td className="num">{short(Math.round(cand.assetsLocal / c.fx))}</td>
                  <td className="num">{short(Math.round(cand.depositsLocal / c.fx))}</td>
                  <td className="num">{short(Math.round(cand.equityLocal / c.fx))}</td>
                  <td className="num">{cand.priceToBook.toFixed(2)}x</td>
                  <td className="num">{short(cand.priceUsd)}</td>
                  <td>
                    <button className="btn primary small" onClick={() => act((ctx) => offerForeign(ctx, bank, cand))}>Offer</button>
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
