// Money: deposits and what you pay for them, cash and borrowing, the bond
// book, and the balance sheet with the capital actions. Rates move a
// basis point at a time; every amount can be typed.

import { useState } from 'react';
import type { Ctx } from '../engine/ctx';
import { DEFAULT_MIX, UNINSURED, bankDepositRate, closeBranch, coreDeposits, marketDepositRate, marketRate, setRate } from '../engine/deposits';
import { PRODUCT_LABEL, buySecurities, canRaiseBrokered, fhlbCapacity, borrowFhlb, raiseBrokered, repayBrokered, repayFhlb, sellSecurities, unrealizedLoss, unrealizedToCapital } from '../engine/funding';
import { DEPOSIT_TYPES, type DepositType, totalAssets, totalDeposits } from '../engine/ledger';
import { type Bank, type LotKind, type Product, type World } from '../engine/state';
import { SWAP_FLOOR, enterSwap, terminateSwap } from '../engine/regulation';
import { formatDate } from '../engine/time';
import { type Unit, dollars, num, pct, short, unitLabel, usd } from './format';
import { AmountField, Stepper, Term } from './parts';
import { CapitalPanel } from './capital';
import { BalanceSheetScreen } from './screens';

const TYPE_LABEL: Record<DepositType, string> = { checking: 'Checking', savings: 'Savings', mmda: 'Money market', cd: 'Certificates' };
const BP: [{ d: number; label: string }, { d: number; label: string }] = [
  { d: 0.0001, label: '1bp' },
  { d: 0.0025, label: '25bp' },
];

interface Props {
  world: World;
  bank: Bank;
  unit: Unit;
  act: (fn: (ctx: Ctx) => void, note?: string) => void;
}

export function FundScreen({ world, bank, unit, act }: Props) {
  const [tab, setTab] = useState<'deposits' | 'bonds' | 'capital'>('deposits');
  return (
    <div>
      <div className="toolbar">
        <div className="seg">
          <button className={tab === 'deposits' ? 'on' : ''} onClick={() => setTab('deposits')}>
            Deposits and cash
          </button>
          <button className={tab === 'bonds' ? 'on' : ''} onClick={() => setTab('bonds')}>
            Bonds
          </button>
          <button className={tab === 'capital' ? 'on' : ''} onClick={() => setTab('capital')}>
            Balance sheet and capital
          </button>
        </div>
      </div>
      {tab === 'deposits' && <Deposits world={world} bank={bank} unit={unit} act={act} />}
      {tab === 'bonds' && <Bonds world={world} bank={bank} unit={unit} act={act} />}
      {tab === 'capital' && (
        <div>
          <BalanceSheetScreen bank={bank} unit={unit} />
          <CapitalPanel world={world} bank={bank} act={act} />
        </div>
      )}
    </div>
  );
}

function Deposits({ world, bank, unit, act }: Props) {
  const a = bank.acct;
  const core = coreDeposits(bank);
  const assets = totalAssets(a);
  const step = Math.max(100_000, Math.round((assets * 0.01) / 100_000) * 100_000);
  const [amount, setAmount] = useState(step * 5);
  const county = bank.homeCounty ? world.geo.counties[bank.homeCounty] : undefined;
  return (
    <div>
      <p className="hint">
        What depositors keep with you and what you pay them. A rate below the market slowly loses <Term k="Money market">money market</Term> and <Term k="Certificates">certificate</Term> balances; checking and savings barely move. Steps are one basis point or twenty five.
      </p>
      <table className="wrap">
        <thead>
          <tr>
            <th>Deposits {unitLabel(unit)}</th>
            <th className="num">balance</th>
            <th className="num">share</th>
            <th className="num">market pays</th>
            <th>your rate</th>
            <th className="num">
              <Term k="uninsured">uninsured</Term>
            </th>
          </tr>
        </thead>
        <tbody>
          {DEPOSIT_TYPES.map((t) => {
            const gap = marketRate(world, t) - bank.rates[t];
            return (
              <tr key={t}>
                <td>
                  <Term k={TYPE_LABEL[t]}>{TYPE_LABEL[t]}</Term>
                </td>
                <td className="num">{dollars(a[t], unit)}</td>
                <td className="num">{pct(core > 0 ? a[t] / core : DEFAULT_MIX[t], 1)}</td>
                <td className="num">{pct(marketRate(world, t))}</td>
                <td className={gap > 0.005 ? 'alert' : ''}>
                  <Stepper value={bank.rates[t]} steps={BP} fmt={(v) => pct(v)} onChange={(v) => act(({ world: w }) => setRate(w, t, v), `${TYPE_LABEL[t]} now pays ${pct(v)}`)} min={0} max={0.2} />
                  <button className="btn small" onClick={() => act(({ world: w }) => setRate(w, t, marketRate(w, t)), `${TYPE_LABEL[t]} matched to the market`)}>
                    Match market
                  </button>
                </td>
                <td className="num">{pct(UNINSURED[t], 0)}</td>
              </tr>
            );
          })}
          <tr className="total">
            <td>Core deposits</td>
            <td className="num">{dollars(core, unit)}</td>
            <td className="num">100.0%</td>
            <td className="num">{pct(marketDepositRate(world))}</td>
            <td className="num">{pct(bankDepositRate(bank))} average</td>
            <td className="num">{pct(bank.uninsuredShare, 0)}</td>
          </tr>
          <tr>
            <td>
              <Term k="Brokered">Brokered</Term>
            </td>
            <td className="num">{dollars(a.brokered, unit)}</td>
            <td></td>
            <td className="num">{pct(world.economy.fedFunds + 0.002)}</td>
            <td>
              {a.brokered > 0 ? <span className="num">{pct(bank.brokeredRate)} </span> : ''}
              <button className="btn small" disabled={!canRaiseBrokered(bank)} onClick={() => act((c) => raiseBrokered(c, bank, amount))}>
                Raise {usd(amount)}
              </button>
              <button className="btn small" disabled={a.brokered <= 0} onClick={() => act((c) => repayBrokered(c, bank, Math.min(amount, a.brokered)))}>
                Run off {usd(Math.min(amount, a.brokered))}
              </button>
              {!canRaiseBrokered(bank) && <span className="dim"> needs a well capitalized bank</span>}
            </td>
            <td></td>
          </tr>
          <tr className="total">
            <td>Total deposits</td>
            <td className="num">{dollars(totalDeposits(a), unit)}</td>
            <td colSpan={4}></td>
          </tr>
        </tbody>
      </table>
      <div className="toolbar">
        <AmountField value={amount} onChange={setAmount} presets={[step, step * 5, step * 25]} label="Amount for the buttons below and above" />
      </div>
      <table className="wrap">
        <thead>
          <tr>
            <th>Cash and borrowing {unitLabel(unit)}</th>
            <th className="num">balance</th>
            <th className="num">rate</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr className="total">
            <td>Cash</td>
            <td className="num">{dollars(a.cash, unit)}</td>
            <td className="num">{pct(assets > 0 ? a.cash / assets : 0, 1)} of assets</td>
            <td className="dim">Below 3% a bad week means borrowing or selling bonds at a loss.</td>
          </tr>
          <tr>
            <td>
              <Term k="FHLB advances">Home Loan Bank line</Term> (room {usd(fhlbCapacity(bank))})
            </td>
            <td className="num">{dollars(a.fhlb, unit)}</td>
            <td className="num">{pct(bank.fhlbRate)}</td>
            <td>
              <button className="btn small" disabled={fhlbCapacity(bank) <= 0} onClick={() => act((c) => borrowFhlb(c, bank, Math.min(amount, fhlbCapacity(bank))))}>
                Draw {usd(Math.min(amount, Math.max(0, fhlbCapacity(bank))))}
              </button>
              <button className="btn small" disabled={a.fhlb <= 0} onClick={() => act((c) => repayFhlb(c, bank, Math.min(amount, a.fhlb)))}>
                Repay {usd(Math.min(amount, a.fhlb))}
              </button>
            </td>
          </tr>
          <tr>
            <td>
              <Term k="fed funds purchased">Overnight borrowing</Term> (automatic)
            </td>
            <td className="num">{dollars(a.fedFundsPurchased, unit)}</td>
            <td className="num">{pct(bank.fedFundsRate)}</td>
            <td></td>
          </tr>
          <tr>
            <td>
              <Term k="subordinated debt">Subordinated debt</Term>
            </td>
            <td className="num">{dollars(a.subDebt, unit)}</td>
            <td className="num">{a.subDebt > 0 ? pct(bank.subDebtRate) : ''}</td>
            <td className="dim">issued under Balance sheet and capital</td>
          </tr>
          <tr className={bank.confidence < 0.8 ? 'alert' : ''}>
            <td>
              <Term k="depositor confidence">Depositor confidence</Term>
            </td>
            <td className="num">{pct(bank.confidence, 0)}</td>
            <td colSpan={2}>{bank.confidence < 0.8 ? 'uninsured money is leaving' : 'steady'}</td>
          </tr>
          <tr className={unrealizedToCapital(bank) > 0.25 ? 'alert' : ''}>
            <td>
              <Term k="unrealized loss">Unrealized loss on bonds</Term>
            </td>
            <td className="num">{dollars(unrealizedLoss(bank), unit)}</td>
            <td className="num">{pct(unrealizedToCapital(bank), 0)} of tier 1</td>
            <td></td>
          </tr>
          <tr>
            <td>
              <Term k="uninsured">Uninsured deposits</Term>
            </td>
            <td className="num">{dollars(Math.round(totalDeposits(a) * bank.uninsuredShare), unit)}</td>
            <td className="num">{pct(bank.uninsuredShare, 0)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th>Branches</th>
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
                <td>
                  {c ? `${c.name}, ${c.state}` : br.county}
                  {br.county === bank.homeCounty ? ' (home)' : ''}
                </td>
                <td className="num">{dollars(br.deposits, unit)}</td>
                <td className="num">{num(br.fixedCost)}</td>
                <td className="num">{num(br.distanceKm)}</td>
                <td className="num">{formatDate(br.openedDay)}</td>
                <td>
                  {br.county !== bank.homeCounty && (
                    <button className="btn small danger" onClick={() => act((ctx) => closeBranch(ctx, br.id))}>
                      Close
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={6} className="dim">
              {bank.branches.length === 0 ? 'No branches: the playtest bank has no home town. ' : ''}Open a branch from the Map tab: hover a county and click Open a branch. {county ? `Home county ${county.name}.` : ''}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Bonds({ bank, unit, act }: Props) {
  const a = bank.acct;
  const assets = totalAssets(a);
  const step = Math.max(100_000, Math.round((assets * 0.01) / 100_000) * 100_000);
  const [amount, setAmount] = useState(step * 5);
  const [kind, setKind] = useState<LotKind>('afs');
  const [product, setProduct] = useState<Product>('treasury');
  const [duration, setDuration] = useState(3);
  return (
    <div>
      <p className="hint">
        Idle cash earns the overnight rate; bonds earn more and carry rate risk. <Term k="available for sale">Available for sale</Term> bonds can be sold but swing with the market; <Term k="held to maturity">held to maturity</Term> bonds stay at cost and stay put.
      </p>
      <table>
        <thead>
          <tr>
            <th>Bonds {unitLabel(unit)}</th>
            <th>book</th>
            <th className="num">cost</th>
            <th className="num">worth today</th>
            <th className="num">
              <Term k="unrealized loss">unrealized</Term>
            </th>
            <th className="num">coupon</th>
            <th className="num">
              <Term k="duration">duration</Term>
            </th>
            <th className="num">bought</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {bank.lots.map((l) => (
            <tr key={l.id} className={l.fair < l.cost * 0.9 ? 'alert' : ''}>
              <td>
                <Term k={PRODUCT_LABEL[l.product]}>{PRODUCT_LABEL[l.product]}</Term>
              </td>
              <td>{l.kind.toUpperCase()}</td>
              <td className="num">{dollars(l.cost, unit)}</td>
              <td className="num">{dollars(l.fair, unit)}</td>
              <td className="num">{dollars(l.fair - l.cost, unit)}</td>
              <td className="num">{pct(l.coupon)}</td>
              <td className="num">{l.duration.toFixed(1)}y</td>
              <td className="num">{formatDate(l.purchasedDay)}</td>
              <td>
                {l.kind === 'afs' && (
                  <button className="btn small" onClick={() => act((c) => sellSecurities(c, bank, l.id, Math.min(l.cost, amount)))}>
                    Sell {usd(Math.min(l.cost, amount))}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {bank.lots.length === 0 && (
            <tr>
              <td colSpan={9} className="empty">
                No bonds held.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="toolbar">
        <AmountField value={amount} onChange={setAmount} presets={[step, step * 5, step * 25]} label="Amount" />
        <span className="seg-label">Buy</span>
        <div className="seg">
          <button className={kind === 'afs' ? 'on' : ''} onClick={() => setKind('afs')} title="available for sale: marked to market, can be sold">
            AFS
          </button>
          <button className={kind === 'htm' ? 'on' : ''} onClick={() => setKind('htm')} title="held to maturity: carried at cost, cannot be sold">
            HTM
          </button>
        </div>
        <div className="seg">
          {(['treasury', 'agency', 'mbs'] as Product[]).map((p) => (
            <button key={p} className={product === p ? 'on' : ''} onClick={() => setProduct(p)}>
              {PRODUCT_LABEL[p]}
            </button>
          ))}
        </div>
        <div className="seg">
          {[1, 3, 5, 7, 10].map((d) => (
            <button key={d} className={duration === d ? 'on' : ''} onClick={() => setDuration(d)}>
              {d} year
            </button>
          ))}
        </div>
        <button className="btn primary" disabled={a.cash < amount} onClick={() => act((c) => buySecurities(c, bank, kind, product, amount, duration))}>
          Buy {usd(amount)}
        </button>
      </div>
      {assets < SWAP_FLOOR ? (
        <p className="hint">
          <Term k="swaps">Swaps</Term> to hedge the bond book unlock at {short(SWAP_FLOOR)} of assets.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>
                <Term k="swaps">Swaps</Term> (pay fixed, receive floating)
              </th>
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
                <td>
                  <button className="btn small" onClick={() => act((c) => terminateSwap(c, bank, s.id))}>
                    Terminate
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={6}>
                {[2, 5, 10].map((t) => (
                  <button key={t} className="btn small" disabled={a.securitiesAFS + a.securitiesHTM < amount} onClick={() => act((c) => enterSwap(c, bank, amount, t))}>
                    Enter a {t} year swap on {usd(amount)}
                  </button>
                ))}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
