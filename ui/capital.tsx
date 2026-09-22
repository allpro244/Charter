// Capital actions on ME (D44): holding company, private raise, IPO,
// buyback, secondary, share sales, subordinated debt.

import { useState } from 'react';
import { IPO_FLOOR, buyback, canIpo, controlWord, fairPrice, formHoldingCompany, ipo, issueSubDebt, marketCap, ownership, priceToBook, raiseCapital, raiseTerms, secondary, sellPlayerShares, stakeAfterRaise } from '../engine/capital';
import type { Ctx } from '../engine/ctx';
import { totalAssets, totalEquity } from '../engine/ledger';
import { type Bank, type World, bookValuePerShare } from '../engine/state';
import { num, pct, short } from './format';
import { Sparkline } from './screens';

export function CapitalPanel({ world, bank, act }: { world: World; bank: Bank; act: (fn: (ctx: Ctx) => void) => void }) {
  const [raise, setRaise] = useState<number>(Math.round(totalEquity(bank.acct) * 0.25));
  const [playerPart, setPlayerPart] = useState<number>(0);
  const [sellN, setSellN] = useState<number>(Math.round(world.player.shares * 0.05));
  const own = ownership(world, bank);
  const ipoCheck = canIpo(bank);
  const step = Math.max(1_000_000, Math.round(totalEquity(bank.acct) * 0.1));
  return (
    <div>
      <table className="wrap">
        <thead>
          <tr>
            <th>Capital and stock</th>
            <th className="num">value</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Holding company</td>
            <td className="num">{bank.holdingCompany ? 'formed' : 'none'}</td>
            <td>{!bank.holdingCompany && <button className="btn primary small" onClick={() => act((c) => formHoldingCompany(c, bank))}>Form one ($250K)</button>}</td>
          </tr>
          <tr>
            <td>Shares outstanding / your stake</td>
            <td className="num">
              {num(bank.shares)} / {pct(own.player, 1)}
            </td>
            <td></td>
          </tr>
          <tr>
            <td>Control</td>
            <td className="num">{controlWord(own.player) === 'owner' ? 'yours' : "the board's"}</td>
            <td className={controlWord(own.player) === 'owner' ? 'dim' : 'alert'}>
              {controlWord(own.player) === 'owner' ? 'You hold half the shares or more: nobody can remove you.' : 'Under half, you serve at the board\u2019s pleasure: after the third year it can replace you after two years of losses.'}
            </td>
          </tr>
          <tr>
            <td>Book value per share / fair value per share</td>
            <td className="num">
              {bookValuePerShare(bank).toFixed(2)} / {fairPrice(world, bank).toFixed(2)} ({priceToBook(world, bank).toFixed(2)}x book)
            </td>
            <td></td>
          </tr>
          {bank.isPublic && (
            <tr>
              <td>Market price / market cap</td>
              <td className="num">
                {(bank.price ?? 0).toFixed(2)} / {short(marketCap(bank))}
              </td>
              <td>
                <Sparkline values={bank.priceHistory.slice(-120).map((h) => h.price)} width={200} height={20} />
              </td>
            </tr>
          )}
          <tr>
            <td>Private raise (passive investors, dilutes everyone)</td>
            <td className="num">
              <input className="amount" type="number" value={raise} step={step} min={step} onChange={(e) => setRaise(Number(e.target.value))} />
            </td>
            <td>
              <button className="btn primary small" disabled={bank.isPublic} onClick={() => act((c) => raiseCapital(c, bank, raise, playerPart))}>Raise</button>{' '}
              {(() => {
                const t = raiseTerms(world, bank, raise);
                const after = stakeAfterRaise(world, bank, raise, playerPart);
                if (!t || after === null) return <span className="dim">too large a round for the equity</span>;
                return <span className={after < 0.5 && own.player >= 0.5 ? 'alert' : 'dim'}>at {t.price.toFixed(2)} a share you would hold {pct(after, 1)}{after < 0.5 && own.player >= 0.5 ? ': below half, the board could replace you' : ''}</span>;
              })()}
            </td>
          </tr>
          <tr>
            <td className="indent">Your own money in that raise</td>
            <td className="num">
              <input className="amount" type="number" value={playerPart} step={100_000} min={0} max={world.player.cash} onChange={(e) => setPlayerPart(Number(e.target.value))} />
            </td>
            <td></td>
          </tr>
          <tr>
            <td>IPO (floor {short(IPO_FLOOR)}, holding company, well capitalized)</td>
            <td className="num">{ipoCheck.ok ? `priced about ${(fairPrice(world, bank) * 0.9).toFixed(2)}` : ipoCheck.why}</td>
            <td>
              <button className="key" disabled={!ipoCheck.ok} onClick={() => act((c) => ipo(c, bank, raise, Math.round(world.player.shares * 0.1)))}>
                IPO: raise {short(raise)}, sell 10% of your shares
              </button>
            </td>
          </tr>
          {bank.isPublic && (
            <>
              <tr>
                <td>Buyback (stays well capitalized)</td>
                <td className="num">{short(step)}</td>
                <td>
                  <button className="key" onClick={() => act((c) => buyback(c, bank, step))}>buy back</button>
                </td>
              </tr>
              <tr>
                <td>Secondary offering at 95% of market</td>
                <td className="num">{short(step)}</td>
                <td>
                  <button className="key" onClick={() => act((c) => secondary(c, bank, step))}>issue</button>
                </td>
              </tr>
            </>
          )}
          <tr>
            <td>Sell your shares ({bank.isPublic ? 'at market less impact' : 'privately at 80% of book, up to 10% at a time'})</td>
            <td className="num">
              <input className="amount" type="number" value={sellN} step={1000} min={0} max={world.player.shares} onChange={(e) => setSellN(Number(e.target.value))} />
            </td>
            <td>
              <button className="key" disabled={sellN <= 0} onClick={() => act((c) => sellPlayerShares(c, sellN))}>sell</button>
            </td>
          </tr>
          <tr>
            <td>Subordinated debt (tier 2, needs a holding company, up to half of tier 1)</td>
            <td className="num">{short(bank.acct.subDebt)} outstanding</td>
            <td>
              <button className="key" disabled={!bank.holdingCompany} onClick={() => act((c) => issueSubDebt(c, bank, step))}>issue {short(step)}</button>
            </td>
          </tr>
          <tr className="memo-row">
            <td colSpan={3}>
              Assets {short(totalAssets(bank.acct))}. Every dollar you raise dilutes your stake; every dollar you pay yourself is capital the bank does not have when the cycle turns.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
