// FUND: deposits by type with the rate sheet, borrowings, securities lots,
// liquidity. Every action is a key on this screen.

import { useState } from 'react';
import type { Ctx } from '../engine/ctx';
import { DEFAULT_MIX, UNINSURED, bankDepositRate, closeBranch, coreDeposits, marketDepositRate, marketRate, setRate } from '../engine/deposits';
import { PRODUCT_LABEL, buySecurities, canRaiseBrokered, fhlbCapacity, borrowFhlb, raiseBrokered, repayBrokered, repayFhlb, sellSecurities, unrealizedLoss, unrealizedToCapital } from '../engine/funding';
import { DEPOSIT_TYPES, type DepositType, totalAssets, totalDeposits } from '../engine/ledger';
import { type Bank, type LotKind, type Product, type World } from '../engine/state';
import { SWAP_FLOOR, enterSwap, terminateSwap } from '../engine/regulation';
import { formatDate } from '../engine/time';
import { type Unit, dollars, num, pct, short, unitLabel } from './format';

const TYPE_LABEL: Record<DepositType, string> = { checking: 'Checking', savings: 'Savings', mmda: 'Money market', cd: 'Certificates' };

interface Props {
  world: World;
  bank: Bank;
  unit: Unit;
  act: (fn: (ctx: Ctx) => void) => void;
}

export function FundScreen({ world, bank, unit, act }: Props) {
  const a = bank.acct;
  const core = coreDeposits(bank);
  const assets = totalAssets(a);
  const step = Math.max(100_000, Math.round(assets * 0.01 / 100_000) * 100_000);
  const [kind, setKind] = useState<LotKind>('afs');
  const [product, setProduct] = useState<Product>('treasury');
  const [duration, setDuration] = useState(3);
  const county = bank.homeCounty ? world.geo.counties[bank.homeCounty] : undefined;
  return (
    <div>
      <div className="cols">
        <table>
          <thead>
            <tr>
              <th>DEPOSITS {unitLabel(unit)}</th>
              <th className="num">balance</th>
              <th className="num">share</th>
              <th className="num">your rate</th>
              <th className="num">market</th>
              <th className="num">uninsured</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {DEPOSIT_TYPES.map((t) => (
              <tr key={t}>
                <td>{TYPE_LABEL[t]}</td>
                <td className="num">{dollars(a[t], unit)}</td>
                <td className="num">{pct(core > 0 ? a[t] / core : DEFAULT_MIX[t], 1)}</td>
                <td className={'num' + (bank.rates[t] < marketRate(world, t) - 0.005 ? ' alert' : '')}>{pct(bank.rates[t])}</td>
                <td className="num">{pct(marketRate(world, t))}</td>
                <td className="num">{pct(UNINSURED[t], 0)}</td>
                <td>
                  <button className="key" onClick={() => act(({ world: w }) => setRate(w, t, bank.rates[t] - 0.0025))}>-25bp</button>
                  <button className="key" onClick={() => act(({ world: w }) => setRate(w, t, bank.rates[t] + 0.0025))}>+25bp</button>
                  <button className="key" onClick={() => act(({ world: w }) => setRate(w, t, marketRate(w, t)))}>market</button>
                </td>
              </tr>
            ))}
            <tr className="total">
              <td>Core deposits</td>
              <td className="num">{dollars(core, unit)}</td>
              <td className="num">100.0%</td>
              <td className="num">{pct(bankDepositRate(bank))}</td>
              <td className="num">{pct(marketDepositRate(world))}</td>
              <td className="num">{pct(bank.uninsuredShare, 0)}</td>
              <td></td>
            </tr>
            <tr>
              <td>Brokered</td>
              <td className="num">{dollars(a.brokered, unit)}</td>
              <td></td>
              <td className="num">{a.brokered > 0 ? pct(bank.brokeredRate) : ''}</td>
              <td className="num">{pct(world.economy.fedFunds + 0.002)}</td>
              <td></td>
              <td>
                <button className="key" disabled={!canRaiseBrokered(bank)} onClick={() => act((c) => raiseBrokered(c, bank, step * 5))}>raise {short(step * 5)}</button>
                <button className="key" disabled={a.brokered <= 0} onClick={() => act((c) => repayBrokered(c, bank, step * 5))}>run off</button>
                {!canRaiseBrokered(bank) && <span className="dim"> not well capitalized</span>}
              </td>
            </tr>
            <tr className="total">
              <td>Total deposits</td>
              <td className="num">{dollars(totalDeposits(a), unit)}</td>
              <td colSpan={5}></td>
            </tr>
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th>BORROWINGS AND LIQUIDITY {unitLabel(unit)}</th>
              <th className="num">balance</th>
              <th className="num">rate</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>FHLB advances (capacity {short(fhlbCapacity(bank))})</td>
              <td className="num">{dollars(a.fhlb, unit)}</td>
              <td className="num">{pct(bank.fhlbRate)}</td>
              <td>
                <button className="key" disabled={fhlbCapacity(bank) <= 0} onClick={() => act((c) => borrowFhlb(c, bank, step * 5))}>draw {short(step * 5)}</button>
                <button className="key" disabled={a.fhlb <= 0} onClick={() => act((c) => repayFhlb(c, bank, step * 5))}>repay</button>
              </td>
            </tr>
            <tr>
              <td>Fed funds purchased (overnight, automatic)</td>
              <td className="num">{dollars(a.fedFundsPurchased, unit)}</td>
              <td className="num">{pct(bank.fedFundsRate)}</td>
              <td></td>
            </tr>
            <tr>
              <td>Subordinated debt</td>
              <td className="num">{dollars(a.subDebt, unit)}</td>
              <td className="num">{a.subDebt > 0 ? pct(bank.subDebtRate) : ''}</td>
              <td></td>
            </tr>
            <tr className="total">
              <td>Cash</td>
              <td className="num">{dollars(a.cash, unit)}</td>
              <td className="num">{pct(assets > 0 ? a.cash / assets : 0, 1)} of assets</td>
              <td></td>
            </tr>
            <tr className={bank.confidence < 0.8 ? 'alert' : ''}>
              <td>Depositor confidence</td>
              <td className="num">{pct(bank.confidence, 0)}</td>
              <td colSpan={2}>{bank.confidence < 0.8 ? 'uninsured money is leaving' : 'steady'}</td>
            </tr>
            <tr className={unrealizedToCapital(bank) > 0.25 ? 'alert' : ''}>
              <td>Unrealized loss on securities</td>
              <td className="num">{dollars(unrealizedLoss(bank), unit)}</td>
              <td className="num">{pct(unrealizedToCapital(bank), 0)} of tier 1</td>
              <td></td>
            </tr>
            <tr>
              <td>Uninsured deposits</td>
              <td className="num">{dollars(Math.round(totalDeposits(a) * bank.uninsuredShare), unit)}</td>
              <td className="num">{pct(bank.uninsuredShare, 0)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
      <table>
        <thead>
          <tr>
            <th>SECURITIES {unitLabel(unit)}</th>
            <th>book</th>
            <th className="num">cost</th>
            <th className="num">fair value</th>
            <th className="num">unrealized</th>
            <th className="num">coupon</th>
            <th className="num">duration</th>
            <th className="num">bought</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {bank.lots.map((l) => (
            <tr key={l.id} className={l.fair < l.cost * 0.9 ? 'alert' : ''}>
              <td>{PRODUCT_LABEL[l.product]}</td>
              <td>{l.kind.toUpperCase()}</td>
              <td className="num">{dollars(l.cost, unit)}</td>
              <td className="num">{dollars(l.fair, unit)}</td>
              <td className="num">{dollars(l.fair - l.cost, unit)}</td>
              <td className="num">{pct(l.coupon)}</td>
              <td className="num">{l.duration.toFixed(1)}y</td>
              <td className="num">{formatDate(l.purchasedDay)}</td>
              <td>{l.kind === 'afs' && <button className="key" onClick={() => act((c) => sellSecurities(c, bank, l.id, Math.min(l.cost, step * 5)))}>sell {short(Math.min(l.cost, step * 5))}</button>}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={9}>
              buy:
              <button className={'key' + (kind === 'afs' ? ' on' : '')} onClick={() => setKind('afs')}>AFS</button>
              <button className={'key' + (kind === 'htm' ? ' on' : '')} onClick={() => setKind('htm')}>HTM</button>
              {(['treasury', 'agency', 'mbs'] as Product[]).map((p) => (
                <button key={p} className={'key' + (product === p ? ' on' : '')} onClick={() => setProduct(p)}>{PRODUCT_LABEL[p]}</button>
              ))}
              {[1, 3, 5, 7, 10].map((d) => (
                <button key={d} className={'key' + (duration === d ? ' on' : '')} onClick={() => setDuration(d)}>{d}y</button>
              ))}
              <button className="key" disabled={a.cash < step * 5} onClick={() => act((c) => buySecurities(c, bank, kind, product, step * 5, duration))}>buy {short(step * 5)}</button>
              <button className="key" disabled={a.cash < step * 25} onClick={() => act((c) => buySecurities(c, bank, kind, product, step * 25, duration))}>buy {short(step * 25)}</button>
            </td>
          </tr>
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th>SWAPS (pay fixed, receive floating; hedge the securities book; from {short(SWAP_FLOOR)} of assets)</th>
            <th className="num">notional {unitLabel(unit)}</th>
            <th className="num">fixed</th>
            <th className="num">tenor</th>
            <th className="num">value</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {bank.swaps.map((s) => (
            <tr key={s.id}>
              <td>since {formatDate(s.startedDay)}</td>
              <td className="num">{dollars(s.notional, unit)}</td>
              <td className="num">{pct(s.fixed)}</td>
              <td className="num">{s.tenor.toFixed(1)}y</td>
              <td className={'num' + (s.value < 0 ? ' alert' : '')}>{dollars(s.value, unit)}</td>
              <td><button className="key" onClick={() => act((c) => terminateSwap(c, bank, s.id))}>terminate</button></td>
            </tr>
          ))}
          <tr>
            <td colSpan={6}>
              {[2, 5, 10].map((t) => (
                <button key={t} className="key" disabled={assets < SWAP_FLOOR || a.securitiesAFS + a.securitiesHTM < step * 5} onClick={() => act((c) => enterSwap(c, bank, step * 5, t))}>
                  enter {t}y swap on {short(step * 5)}
                </button>
              ))}
              {assets < SWAP_FLOOR && <span className="dim">swaps unlock at regional scale</span>}
            </td>
          </tr>
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th>BRANCHES</th>
            <th className="num">deposits {unitLabel(unit)}</th>
            <th className="num">fixed cost / year</th>
            <th className="num">km from home</th>
            <th className="num">opened</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {bank.branches.map((br) => {
            const c = world.geo.counties[br.county];
            return (
              <tr key={br.id}>
                <td>{c ? `${c.name}, ${c.state}` : br.county}{br.county === bank.homeCounty ? ' (home)' : ''}</td>
                <td className="num">{dollars(br.deposits, unit)}</td>
                <td className="num">{num(br.fixedCost)}</td>
                <td className="num">{num(br.distanceKm)}</td>
                <td className="num">{formatDate(br.openedDay)}</td>
                <td>{br.county !== bank.homeCounty && <button className="key" onClick={() => act((ctx) => closeBranch(ctx, br.id))}>close</button>}</td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={6} className="dim">
              open a branch from the map: hover a county and press o. {county ? `Home county ${county.name}.` : ''}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
