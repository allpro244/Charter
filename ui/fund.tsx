// Money: deposits and what you pay for them, cash and borrowing, the bond
// book, and the balance sheet with the capital actions. Rates move a
// basis point at a time; every amount can be typed.

import { useState } from 'react';
import { calibration } from '../data/calibration';
import type { Ctx } from '../engine/ctx';
import { DEFAULT_MIX, UNINSURED, bankDepositRate, closeBranch, coreDeposits, marketDepositRate, marketRate, setPegMode, setRate, setRatePeg } from '../engine/deposits';
import { PRODUCT_LABEL, PRODUCT_SPREAD, buySecurities, canRaiseBrokered, executionCost, fhlbCapacity, borrowFhlb, marketYield, raiseBrokered, repayBrokered, repayFhlb, sellSecurities, setInvestPolicy, unrealizedLoss, unrealizedToCapital } from '../engine/funding';
import { DEPOSIT_TYPES, type DepositType, totalAssets, totalDeposits } from '../engine/ledger';
import { type Bank, type LotKind, type Product, type World } from '../engine/state';
import { SWAP_FLOOR, enterSwap, terminateSwap } from '../engine/regulation';
import { formatDate } from '../engine/time';
import { type Unit, dollars, num, pct, unitLabel, usd } from './format';
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
      {tab === 'bonds' && (
        <div>
          <InvestPolicyPanel world={world} bank={bank} act={act} />
          <Bonds world={world} bank={bank} unit={unit} act={act} />
        </div>
      )}
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
      <div className="toolbar">
        <div className="seg">
          <button className={bank.ratePeg ? 'on' : ''} onClick={() => act(({ world: w }) => setPegMode(w, true), 'The sheet now follows the market at your offsets')}>
            Follow the market at my offsets
          </button>
          <button className={bank.ratePeg ? '' : 'on'} onClick={() => act(({ world: w }) => setPegMode(w, false), 'The sheet is set by hand until you move it')}>
            Set each rate by hand
          </button>
        </div>
        <span className="dim">
          {bank.ratePeg
            ? 'Your CFO resets every rate to the market plus your offset at each month end (real banks reprice monthly). Move a rate and the offset moves with it.'
            : 'The rates stay where you put them while the market moves: margin when rates fall, runoff when they rise.'}
        </span>
      </div>
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
                  {bank.ratePeg ? (
                    <Stepper value={bank.ratePeg[t]} steps={BP} fmt={(v) => `${pct(Math.max(0, marketRate(world, t) + v))} (market ${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.round(Math.abs(v) * 10_000)}bp)`} onChange={(v) => act(({ world: w }) => setRatePeg(w, t, v), `${TYPE_LABEL[t]} now pays the market ${v >= 0 ? 'plus' : 'less'} ${Math.round(Math.abs(v) * 10_000)}bp`)} min={-0.05} max={0.05} />
                  ) : (
                    <Stepper value={bank.rates[t]} steps={BP} fmt={(v) => pct(v)} onChange={(v) => act(({ world: w }) => setRate(w, t, v), `${TYPE_LABEL[t]} now pays ${pct(v)}`)} min={0} max={0.2} />
                  )}
                  <button className="btn small" onClick={() => act(({ world: w }) => (bank.ratePeg ? setRatePeg(w, t, 0) : setRate(w, t, marketRate(w, t))), `${TYPE_LABEL[t]} matched to the market`)}>
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

// The CFO's standing order for idle cash (D50). Real banks run an
// investment policy the board sets; the CEO sets it here.
function InvestPolicyPanel({ world, bank, act }: { world: World; bank: Bank; act: Props['act'] }) {
  const p = bank.investPolicy;
  const assets = totalAssets(bank.acct);
  const cashShare = assets > 0 ? bank.acct.cash / assets : 0;
  const y = p ? marketYield(world, p.duration) + PRODUCT_SPREAD[p.product] : 0;
  return (
    <table className="wrap">
      <thead>
        <tr>
          <th>
            <Term k="investment policy">Investment policy</Term>
          </th>
          <th>setting</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Standing order</td>
          <td>
            <div className="seg">
              <button className={p ? 'on' : ''} onClick={() => act(({ world: w }) => setInvestPolicy(w, {}), 'The CFO invests idle cash under the policy')}>
                On
              </button>
              <button className={p ? '' : 'on'} onClick={() => act(({ world: w }) => setInvestPolicy(w, null), 'Idle cash stays as cash until you buy bonds yourself')}>
                Off
              </button>
            </div>
          </td>
          <td className="dim">
            {p
              ? `At each month end the CFO buys ${p.duration} year ${PRODUCT_LABEL[p.product]} (about ${pct(y)} today) with cash above ${pct(p.cashTarget, 0)} of assets. Cash is ${pct(cashShare, 1)} now. Sales are never automatic.`
              : `Cash is ${pct(cashShare, 1)} of assets and earns the Fed rate. A bank lends it or buys bonds with it.`}
          </td>
        </tr>
        {p && (
          <>
            <tr>
              <td>Cash to keep</td>
              <td>
                <Stepper value={p.cashTarget} steps={[{ d: 0.01, label: '1%' }, { d: 0.05, label: '5%' }]} fmt={(v) => `${pct(v, 0)} of assets`} onChange={(v) => act(({ world: w }) => setInvestPolicy(w, { cashTarget: v }), `Cash target ${pct(v, 0)}`)} min={0.03} max={0.5} />
              </td>
              <td className="dim">Examiners like 8% or more at a small bank. Below 4% a bad week means borrowing.</td>
            </tr>
            <tr>
              <td>What to buy</td>
              <td>
                <div className="seg">
                  {(['treasury', 'agency', 'mbs'] as const).map((k) => (
                    <button key={k} className={p.product === k ? 'on' : ''} onClick={() => act(({ world: w }) => setInvestPolicy(w, { product: k }), `The CFO buys ${PRODUCT_LABEL[k]}`)}>
                      {PRODUCT_LABEL[k]}
                    </button>
                  ))}
                </div>
              </td>
              <td className="dim">Treasuries pay the least and never default; agencies add {Math.round(PRODUCT_SPREAD.agency * 10_000)}bp; mortgage bonds add {Math.round(PRODUCT_SPREAD.mbs * 10_000)}bp and pay down early when rates fall.</td>
            </tr>
            <tr>
              <td>How long</td>
              <td>
                <Stepper value={p.duration} steps={[{ d: 1, label: '1y' }, { d: 3, label: '3y' }]} fmt={(v) => `${v} year${v === 1 ? '' : 's'}`} onChange={(v) => act(({ world: w }) => setInvestPolicy(w, { duration: Math.round(v) }), `${Math.round(v)} year bonds`)} min={1} max={10} />
              </td>
              <td className="dim">Longer pays more when the curve slopes up and loses more when rates rise.</td>
            </tr>
            <tr>
              <td>Held as</td>
              <td>
                <div className="seg">
                  <button className={p.kind === 'afs' ? 'on' : ''} onClick={() => act(({ world: w }) => setInvestPolicy(w, { kind: 'afs' }), 'Bought as available for sale')}>
                    Available for sale
                  </button>
                  <button className={p.kind === 'htm' ? 'on' : ''} onClick={() => act(({ world: w }) => setInvestPolicy(w, { kind: 'htm' }), 'Bought as held to maturity')}>
                    Held to maturity
                  </button>
                </div>
              </td>
              <td className="dim">Available for sale can be sold and its losses show in capital; held to maturity hides the mark and cannot be sold.</td>
            </tr>
          </>
        )}
      </tbody>
    </table>
  );
}

function Bonds({ world, bank, unit, act }: Props) {
  const a = bank.acct;
  const assets = totalAssets(a);
  const step = Math.max(100_000, Math.round((assets * 0.01) / 100_000) * 100_000);
  const [amount, setAmount] = useState(step * 5);
  const [kind, setKind] = useState<LotKind>('afs');
  const [product, setProduct] = useState<Product>('treasury');
  const [duration, setDuration] = useState(3);
  const e = world.economy;
  const cashYield = Math.max(0, e.fedFunds + calibration.cashYieldVsFedFunds.typical / 10_000);
  const yieldOf = (p: Product, d: number) => marketYield(world, d) + PRODUCT_SPREAD[p];
  const y = yieldOf(product, duration);
  const fee = Math.round(amount * executionCost(bank));
  const pickup = y - cashYield;
  const hit = amount * duration * 0.01;
  const bookCost = a.securitiesAFS + a.securitiesHTM;
  const bookFair = bank.lots.reduce((s, l) => s + l.fair, 0);
  const bookYield = bookCost > 0 ? (a.securitiesAFS * bank.afsYield + a.securitiesHTM * bank.htmYield) / bookCost : 0;
  const bookDuration = bookCost > 0 ? (a.securitiesAFS * bank.afsDuration + a.securitiesHTM * bank.htmDuration) / bookCost : 0;
  return (
    <div>
      <p className="hint">
        Idle cash earns the overnight rate. A bond locks money up for a term and pays more; the longer the term, the more it pays and the more its price moves when rates move. Pick a yield on the sheet, choose a book, and the panel shows exactly what you get before you buy.
      </p>
      <div className="cols">
        <table>
          <thead>
            <tr>
              <th>Rates today</th>
              {PRODUCTS.map((p) => (
                <th key={p} className="num">
                  <Term k={PRODUCT_LABEL[p]}>{PRODUCT_LABEL[p]}</Term>
                </th>
              ))}
              <th className="num">if rates rise 1 point</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Cash, overnight</td>
              <td className="num" colSpan={3}>
                {pct(cashYield)}
              </td>
              <td className="num">no change</td>
            </tr>
            {TERMS.map((d) => (
              <tr key={d}>
                <td>{d < 1 ? '3 months (Treasury bill)' : `${d} year${d > 1 ? 's' : ''}`}</td>
                {PRODUCTS.map((p) => (
                  <td key={p} className="num">
                    <button className={'btn small' + (product === p && duration === d ? ' on' : '')} onClick={() => { setProduct(p); setDuration(d); }} title={`${d} year ${PRODUCT_LABEL[p]}: pick this yield`}>
                      {pct(yieldOf(p, d))}
                    </button>
                  </td>
                ))}
                <td className="num alert">({pct(d * 0.01, d < 1 ? 2 : 0)} of price)</td>
              </tr>
            ))}
            <tr className="memo-row">
              <td colSpan={5}>
                A yield is what a bond bought today pays every year until it matures. Treasuries are the safest and pay the least; agencies pay {Math.round(PRODUCT_SPREAD.agency * 10_000)} basis points more; agency mortgage bonds pay {Math.round(PRODUCT_SPREAD.mbs * 10_000)} more but pay off early when rates fall. The last column is roughly how much of the price a one point rise in rates takes away.
              </td>
            </tr>
          </tbody>
        </table>
        <table className="wrap">
          <thead>
            <tr>
              <th colSpan={2}>Your pick</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Amount</td>
              <td>
                <AmountField value={amount} onChange={setAmount} presets={[step, step * 5, step * 25]} label="" />
              </td>
            </tr>
            <tr>
              <td>Book</td>
              <td>
                <div className="seg">
                  <button className={kind === 'afs' ? 'on' : ''} onClick={() => setKind('afs')}>
                    Available for sale
                  </button>
                  <button className={kind === 'htm' ? 'on' : ''} onClick={() => setKind('htm')}>
                    Held to maturity
                  </button>
                </div>
                <div className="dim">{kind === 'afs' ? 'Can be sold any day. Its price swings show up in equity every month.' : 'Cannot be sold. Carried at cost, so price swings stay off the books.'}</div>
              </td>
            </tr>
            <tr>
              <td>Bond</td>
              <td>
                {duration < 1 ? '3 month' : `${duration} year`} <Term k={PRODUCT_LABEL[product]}>{PRODUCT_LABEL[product]}</Term>
              </td>
            </tr>
            <tr className="total">
              <td>Yield</td>
              <td className="num">{pct(y)}</td>
            </tr>
            <tr>
              <td>Earns a year</td>
              <td className="num">{usd(amount * y)}</td>
            </tr>
            <tr>
              <td>Pickup over leaving it in cash</td>
              <td className={'num' + (pickup < 0 ? ' alert' : ' positive')}>
                {pickup >= 0 ? '+' : ''}
                {(pickup * 100).toFixed(2)} pts, {usd(amount * pickup)} a year
              </td>
            </tr>
            <tr>
              <td>If rates rise 1 point</td>
              <td className="num alert">
                ({usd(hit)}) of value, {kind === 'afs' ? 'taken from equity' : 'noted but not booked'}
              </td>
            </tr>
            <tr>
              <td>Dealer fee</td>
              <td className="num">{usd(fee)}</td>
            </tr>
            <tr>
              <td colSpan={2}>
                <button className="btn primary" disabled={a.cash < amount || amount <= 0} onClick={() => act((c) => buySecurities(c, bank, kind, product, amount, duration), `Bought ${usd(amount)} of ${duration < 1 ? '3 month' : `${duration} year`} ${PRODUCT_LABEL[product]} at ${pct(y)}`)}>
                  Buy {usd(amount)} of {duration < 1 ? '3 month' : `${duration} year`} {PRODUCT_LABEL[product]} at {pct(y)}
                </button>
                {a.cash < amount && <span className="dim"> Not enough cash: {usd(a.cash)} on hand.</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <table>
        <thead>
          <tr>
            <th>Bonds you hold {unitLabel(unit)}</th>
            <th>book</th>
            <th className="num">cost</th>
            <th className="num">worth today</th>
            <th className="num">
              <Term k="unrealized loss">unrealized</Term>
            </th>
            <th className="num">yield</th>
            <th className="num">earns a year</th>
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
                {l.duration < 0.75 ? 'Short' : `${Math.round(l.duration)} year`} <Term k={PRODUCT_LABEL[l.product]}>{PRODUCT_LABEL[l.product]}</Term>
              </td>
              <td>{l.kind === 'afs' ? 'for sale' : 'to maturity'}</td>
              <td className="num">{dollars(l.cost, unit)}</td>
              <td className="num">{dollars(l.fair, unit)}</td>
              <td className={'num' + (l.fair < l.cost ? ' alert' : '')}>{dollars(l.fair - l.cost, unit)}</td>
              <td className="num">{pct(l.coupon)}</td>
              <td className="num">{dollars(l.cost * l.coupon, unit)}</td>
              <td className="num">{l.duration.toFixed(1)}y</td>
              <td className="num">{formatDate(l.purchasedDay)}</td>
              <td>
                {l.kind === 'afs' && (
                  <button className="btn small" onClick={() => act((c) => sellSecurities(c, bank, l.id, Math.min(l.cost, amount)), `Sold ${usd(Math.min(l.cost, amount))} of ${PRODUCT_LABEL[l.product]}`)}>
                    Sell {usd(Math.min(l.cost, amount))}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {bank.lots.length === 0 && (
            <tr>
              <td colSpan={10} className="empty">
                No bonds held. Everything beyond the loans sits in cash at {pct(cashYield)}.
              </td>
            </tr>
          )}
          {bank.lots.length > 0 && (
            <tr className="total">
              <td>All bonds</td>
              <td></td>
              <td className="num">{dollars(bookCost, unit)}</td>
              <td className="num">{dollars(bookFair, unit)}</td>
              <td className={'num' + (bookFair < bookCost ? ' alert' : '')}>{dollars(bookFair - bookCost, unit)}</td>
              <td className="num">{pct(bookYield)}</td>
              <td className="num">{dollars(bookCost * bookYield, unit)}</td>
              <td className="num">{bookDuration.toFixed(1)}y</td>
              <td colSpan={2}></td>
            </tr>
          )}
        </tbody>
      </table>
      {assets < SWAP_FLOOR ? (
        <p className="hint">
          <Term k="swaps">Swaps</Term> to hedge the bond book unlock at {usd(SWAP_FLOOR)} of assets.
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

const TERMS = [0.25, 1, 2, 3, 5, 7, 10];
const PRODUCTS: Product[] = ['treasury', 'agency', 'mbs'];
