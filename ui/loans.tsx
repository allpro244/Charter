// Lending: the book by type with a health bar, then one book at two
// levels of detail (D54): every loan that came through the application
// desk as its own file, and the officers' lending under policy by type
// and year (the pools, D29). Then the rate sheet, the policy and the dial.

import { useState } from 'react';
import { TYPE, bookByType } from '../engine/credit';
import { GRADES, LOAN_TYPES, type LoanType, emptyByType } from '../engine/loantypes';
import { type Bank, type Loan, type Pool, type World } from '../engine/state';
import { formatDate } from '../engine/time';
import { customerOf, decidedText, isTroubled, noteSalePrice, reoQuickPrice, sellLoan, sellReoNow } from '../engine/loans';
import { nonperformingSale, sellNonperforming } from '../engine/credit';
import type { Ctx } from '../engine/ctx';
import { PRICING_MAX, PRICING_MIN, autoSizeLine, committeeLine, demandMultiplier, setDial, setDialMode, setPolicy, setPricing, setTypeAllowed } from '../engine/underwriting';
import { baseRate } from '../engine/credit';
import { bankDepositRate } from '../engine/deposits';
import { calibration } from '../data/calibration';
import { type Unit, dollars, num, pct, short, unitLabel, usd } from './format';
import { AmountField, Stepper, Term } from './parts';

interface Props {
  world: World;
  bank: Bank;
  unit: Unit;
  refresh: () => void;
  act?: (fn: (ctx: Ctx) => void, note?: string) => void;
}

type Tab = 'book' | 'sheet' | 'policy';

export function LoansScreen({ world, bank, unit, refresh, act }: Props) {
  const [tab, setTab] = useState<Tab>('book');
  const [openLoan, setOpenLoan] = useState<string | null>(null);
  const rows = bookByType(bank);
  const total = rows.reduce((s, r) => s + r.balance, 0);
  return (
    <div>
      <p className="hint">The loans on your books by type, with a health bar showing the share graded weak. Below: the whole book, then the rate sheet, then the written policy and dial that decide what reaches your desk.</p>
      <div className="toolbar">
        <div className="seg">
          <button className={tab === 'book' ? 'on' : ''} onClick={() => setTab('book')}>
            Your book
          </button>
          <button className={tab === 'sheet' ? 'on' : ''} onClick={() => setTab('sheet')}>
            Rate sheet
          </button>
          <button className={tab === 'policy' ? 'on' : ''} onClick={() => setTab('policy')}>
            Policy and dial
          </button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Book by type {unitLabel(unit)}</th>
            <th className="num">balance</th>
            <th className="num">share</th>
            <th className="num">
              <Term k="yield">yield</Term>
            </th>
            <th>
              <Term k="criticized">health</Term>
            </th>
            <th className="num">weak</th>
            <th className="num">
              <Term k="nonaccrual">not paying</Term>
            </th>
            <th className="num">
              <Term k="charge-off">lost to date</Term>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const weak = r.balance > 0 ? r.criticized / r.balance : 0;
            return (
              <tr key={r.type}>
                <td>
                  <Term k={r.label}>{r.label}</Term>
                </td>
                <td className="num">{dollars(r.balance, unit)}</td>
                <td className="num">{pct(total > 0 ? r.balance / total : 0, 1)}</td>
                <td className="num">{pct(r.yield)}</td>
                <td>{r.balance >= 1_000_000 ? <HealthBar share={weak} /> : <span className="dim">under $1MM</span>}</td>
                <td className={'num' + (weak > 0.08 && r.balance >= 1_000_000 ? ' alert' : '')}>{r.balance >= 1_000_000 ? pct(weak, 1) : ''}</td>
                <td className="num">{r.balance >= 1_000_000 ? pct(r.balance > 0 ? r.nonaccrual / r.balance : 0, 1) : ''}</td>
                <td className="num">{dollars(bank.lifetimeChargeOffsByType[r.type], unit)}</td>
              </tr>
            );
          })}
          <tr className="total">
            <td>All loans</td>
            <td className="num">{dollars(bank.acct.loans, unit)}</td>
            <td className="num">100.0%</td>
            <td className="num">{pct(bank.loanYield)}</td>
            <td>
              <HealthBar share={total > 0 ? rows.reduce((s, r) => s + r.criticized, 0) / total : 0} />
            </td>
            <td className="num">{pct(total > 0 ? rows.reduce((s, r) => s + r.criticized, 0) / total : 0, 1)}</td>
            <td className="num">{pct(total > 0 ? rows.reduce((s, r) => s + r.nonaccrual, 0) / total : 0, 1)}</td>
            <td className="num">{dollars(LOAN_TYPES.reduce((s, t) => s + bank.lifetimeChargeOffsByType[t], 0), unit)}</td>
          </tr>
          <tr className="memo-row">
            <td>
              <Term k="allowance">Cushion against losses (allowance)</Term>
            </td>
            <td className="num">{dollars(bank.acct.allowance, unit)}</td>
            <td className="num">{pct(bank.acct.loans > 0 ? bank.acct.allowance / bank.acct.loans : 0)}</td>
            <td colSpan={5}>
              {bank.homeCounty
                ? `Applications: ${num(bank.applications.received)} received, ${num(bank.applications.toDesk)} to your desk, ${num(bank.applications.autoApproved)} approved under policy for ${usd(bank.applications.autoApprovedAmount)}, ${num(bank.applications.autoDeclined)} declined. Originated this year: ${usd(LOAN_TYPES.reduce((s, t) => s + bank.originationsByType[t], 0))}.`
                : `No home county in this build, so no applications reach the desk: the book grows through the pools. Originated this year: ${usd(LOAN_TYPES.reduce((s, t) => s + bank.originationsByType[t], 0))}.`}
            </td>
          </tr>
        </tbody>
      </table>
      {tab === 'book' && <Book world={world} bank={bank} unit={unit} openLoan={openLoan} setOpenLoan={setOpenLoan} act={act} />}
      {tab === 'sheet' && <RateSheet world={world} bank={bank} refresh={refresh} />}
      {tab === 'policy' && <Policy world={world} bank={bank} refresh={refresh} />}
    </div>
  );
}

function HealthBar({ share }: { share: number }) {
  const tone = share < 0.03 ? 'good' : share < 0.08 ? 'warn' : 'bad';
  return (
    <span className="bar" title={`${pct(share, 1)} of the balance is graded weak`}>
      <span className={'fill ' + tone} style={{ width: `${Math.min(100, (share / 0.2) * 100)}%` }} />
    </span>
  );
}

function statusLabel(l: Loan): string {
  switch (l.status) {
    case 'current':
      return 'current';
    case 'late30':
      return '30 days late';
    case 'late60':
      return '60 days late';
    case 'late90':
      return '90 days late';
    case 'nonaccrual':
      return 'not paying';
    case 'workout':
      return 'in workout';
    case 'reo':
      return 'foreclosed';
    case 'paid':
      return 'paid off';
    case 'sold':
      return 'sold';
    case 'chargedOff':
      return 'written off';
  }
}

function Book({ world, bank, unit, openLoan, setOpenLoan, act }: { world: World; bank: Bank; unit: Unit; openLoan: string | null; setOpenLoan: (id: string | null) => void; act?: Props['act'] }) {
  const loans = [...bank.loans].sort((a, b) => (a.status === b.status ? b.balance - a.balance : rank(a) - rank(b)));
  const troubled = loans.filter((l) => isTroubled(l) || l.status === 'reo');
  const onFile = loans.filter((l) => l.status !== 'paid' && l.status !== 'chargedOff' && l.status !== 'sold').length;
  return (
    <div>
    {troubled.length > 0 && (
      <p className="hint">
        When a loan fails: 30, 60 and 90 days late, then <Term k="nonaccrual">nonaccrual</Term> (its interest stops counting), workout, and at nine months the bank forecloses real estate into <Term k="REO">REO</Term> or charges the rest off. You can sell a troubled loan first with a <Term k="note sale">note sale</Term>: cash now, the shortfall written off today, the workout gone. Buttons are on the rows.
      </p>
    )}
    <table>
      <thead>
        <tr>
          <th>Loans on your desk ({num(onFile)})</th>
          <th>type</th>
          <th className="num">balance {unitLabel(unit)}</th>
          <th className="num">rate</th>
          <th className="num">
            <Term k="grade">grade</Term>
          </th>
          <th>status</th>
          <th className="num">
            <Term k="coverage">coverage</Term>
          </th>
          <th className="num">
            <Term k="loan to value">LTV</Term>
          </th>
          <th>decided</th>
          <th className="num">made</th>
        </tr>
      </thead>
      <tbody>
        {loans.slice(0, 300).map((l) => (
          <LoanRows key={l.id} world={world} bank={bank} l={l} unit={unit} open={openLoan === l.id} toggle={() => setOpenLoan(openLoan === l.id ? null : l.id)} act={act} />
        ))}
        {loans.length === 0 && (
          <tr>
            <td colSpan={10} className="empty">
              {bank.homeCounty ? 'No loans on the desk yet. Applications arrive daily; the dial decides which reach you and which the loan officer decides under your policy.' : 'No home county in this build, so no applications arrive. The rest of the book below holds the loans.'}
            </td>
          </tr>
        )}
      </tbody>
    </table>
    <p className="hint">
      Every loan that came through the application desk is a file above: the ones you decided, the ones the loan officer decided under your policy, and any that came with the bank. The lending your officers do to fill the book is below, by type and year, the way a CEO reads the rest of a book. The two together are the balance at the top.
      {onFile > 400 ? ' Past 500 files, the smallest and oldest move below.' : ''}
    </p>
    <RestOfBook world={world} bank={bank} unit={unit} act={act} />
    </div>
  );
}

function rank(l: Loan): number {
  return ['nonaccrual', 'workout', 'late90', 'late60', 'late30', 'reo', 'current', 'paid', 'chargedOff', 'sold'].indexOf(l.status);
}

function LoanRows({ world, bank, l, unit, open, toggle, act }: { world: World; bank: Bank; l: Loan; unit: Unit; open: boolean; toggle: () => void; act?: Props['act'] }) {
  const bad = l.status !== 'current' && l.status !== 'paid' && l.status !== 'sold';
  const notePrice = isTroubled(l) ? noteSalePrice(world, l) : 0;
  const reoPrice = l.status === 'reo' ? reoQuickPrice(world, l) : 0;
  return (
    <>
      <tr className={'row' + (bad ? ' alert' : '')} onClick={toggle}>
        <td>
          <span className="chev">{open ? '▾' : '▸'}</span>
          {l.borrower}
        </td>
        <td>{TYPE[l.type].label}</td>
        <td className="num">{dollars(l.status === 'reo' ? l.reoValue : l.balance, unit)}</td>
        <td className="num">{pct(l.rate)}</td>
        <td className="num">{l.grade}</td>
        <td>
          {statusLabel(l)}
          {act && isTroubled(l) && l.balance > 0 && (
            <button className="btn small" style={{ marginLeft: 6 }} onClick={(e) => { e.stopPropagation(); act((c: Ctx) => sellLoan(c, bank, l.id)); }} title={`A buyer pays ${usd(notePrice)} of the ${usd(l.balance)} owed; ${usd(l.balance - notePrice)} is charged off today`}>
              Sell the note for {usd(notePrice)}
            </button>
          )}
          {act && l.status === 'reo' && l.reoValue > 0 && (
            <button className="btn small" style={{ marginLeft: 6 }} onClick={(e) => { e.stopPropagation(); act((c: Ctx) => sellReoNow(c, bank, l.id)); }} title={`Carried at ${usd(l.reoValue)}; a quick sale brings ${usd(reoPrice)}. Left alone it sells in a few months near its carrying value.`}>
              Sell now for {usd(reoPrice)}
            </button>
          )}
        </td>
        <td className="num">{l.memo.dscr.toFixed(2)}x</td>
        <td className="num">{pct(l.memo.ltv, 0)}</td>
        <td>
          {l.decision.by}
          {l.decision.countered ? ' (countered)' : ''}
        </td>
        <td className="num">{formatDate(l.originated)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10}>
            <pre className="memo">
              {[
                `${l.memo.purpose}. ${l.memo.collateralType} valued ${short(l.memo.collateralValue)}. ${l.memo.guarantor ? 'Guaranteed.' : 'No guarantee.'}`,
                `Leverage ${l.memo.leverage.toFixed(1)}x, ${l.memo.paymentHistory} history, ${l.memo.tenureYears.toFixed(1)} years in place, sector ${l.memo.sector}, ${l.memo.employees > 0 ? `revenue ${short(l.memo.income)}, ${l.memo.employees} employees` : `income ${short(l.memo.income)}`}.`,
                `Original ${short(l.principal)} over ${l.termMonths} months, payment ${short(l.payment)} on day ${l.paymentDay}. Months late ${l.monthsLate}. Loss to date ${short(l.lossToDate)}.`,
                `${decidedText(l)}: ${l.decision.note}.${l.attribution ? ` Default signal: ${l.attribution}.` : ''}`,
                ...(() => {
                  const c = customerOf(bank, l);
                  return c && c.loans > 1 ? [`Customer since ${formatDate(l.originated - Math.round(c.tenureYears * 365))}: ${c.loans} loans here, ${c.paidOff} paid off, ${c.wentBad} went bad.`] : [];
                })(),
                ...(l.restructured ? [`Restructured on ${formatDate(l.restructured.day)}: was ${pct(l.restructured.oldRate)} and ${short(l.restructured.oldPayment)} a month; ${l.restructured.paidSince} clean payments since.`] : []),
                `CCO: ${l.memo.summary}`,
                ...l.memo.redFlags.map((f) => `  flag: ${f}`),
              ].join('\n')}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

interface TypeRow {
  t: LoanType;
  pools: Pool[];
  balance: number;
  count: number;
  rate: number;
  weak: number;
  nonaccrual: number;
  lost: number;
  orig: number;
  sale: { balance: number; price: number };
}

// The pooled book (D29) read by type, each type opening to its years.
function RestOfBook({ world, bank, unit, act }: { world: World; bank: Bank; unit: Unit; act?: Props['act'] }) {
  const [openType, setOpenType] = useState<LoanType | null>(null);
  const rows: TypeRow[] = [];
  for (const t of LOAN_TYPES) {
    const pools = bank.pools.filter((p) => p.type === t && (p.balance > 0 || p.count > 0)).sort((a, b) => b.vintage - a.vintage);
    if (pools.length === 0) continue;
    let balance = 0;
    let count = 0;
    let ysum = 0;
    let weak = 0;
    let nonaccrual = 0;
    let lost = 0;
    let orig = 0;
    for (const p of pools) {
      balance += p.balance;
      count += p.count;
      ysum += p.balance * p.rate;
      for (let g = 5; g < GRADES; g++) weak += p.grades[g] ?? 0;
      for (let g = 6; g < GRADES; g++) nonaccrual += p.grades[g] ?? 0;
      lost += p.cumLoss;
      orig += p.origBalance;
    }
    rows.push({ t, pools, balance, count, rate: balance > 0 ? ysum / balance : 0, weak, nonaccrual, lost, orig, sale: nonperformingSale(world, bank, t) });
  }
  const total = rows.reduce((a, r) => a + r.balance, 0);
  const count = rows.reduce((a, r) => a + r.count, 0);
  const weak = rows.reduce((a, r) => a + r.weak, 0);
  const nonaccrual = rows.reduce((a, r) => a + r.nonaccrual, 0);
  const lost = rows.reduce((a, r) => a + r.lost, 0);
  return (
    <table>
      <thead>
        <tr>
          <th>The rest of the book: made by your officers under policy ({num(count)} loans)</th>
          <th className="num">loans</th>
          <th className="num">balance {unitLabel(unit)}</th>
          <th className="num">rate</th>
          <th className="num">weak</th>
          <th className="num">
            <Term k="nonaccrual">not paying</Term>
          </th>
          <th className="num">
            <Term k="charge-off">lost to date</Term>
          </th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <TypeRows key={r.t} r={r} bank={bank} unit={unit} open={openType === r.t} toggle={() => setOpenType(openType === r.t ? null : r.t)} act={act} />
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={8} className="empty">
              Nothing yet. Your officers book loans every month toward the loans to deposits target in the written policy; that lending shows here.
            </td>
          </tr>
        )}
        {rows.length > 0 && (
          <tr className="total">
            <td>All of it</td>
            <td className="num">{num(count)}</td>
            <td className="num">{dollars(total, unit)}</td>
            <td className="num">{pct(total > 0 ? rows.reduce((a, r) => a + r.balance * r.rate, 0) / total : 0)}</td>
            <td className={'num' + (total > 0 && weak / total > 0.08 ? ' alert' : '')}>{pct(total > 0 ? weak / total : 0, 1)}</td>
            <td className="num">{pct(total > 0 ? nonaccrual / total : 0, 1)}</td>
            <td className="num">{dollars(lost, unit)}</td>
            <td></td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function TypeRows({ r, bank, unit, open, toggle, act }: { r: TypeRow; bank: Bank; unit: Unit; open: boolean; toggle: () => void; act?: Props['act'] }) {
  const weakShare = r.balance > 0 ? r.weak / r.balance : 0;
  return (
    <>
      <tr className={'row' + (r.sale.balance >= 100_000 ? ' alert' : '')} onClick={toggle}>
        <td>
          <span className="chev">{open ? '\u25be' : '\u25b8'}</span>
          <Term k={TYPE[r.t].label}>{TYPE[r.t].label}</Term>
        </td>
        <td className="num">{num(r.count)}</td>
        <td className="num">{dollars(r.balance, unit)}</td>
        <td className="num">{pct(r.rate)}</td>
        <td className={'num' + (weakShare > 0.08 ? ' alert' : '')}>{pct(weakShare, 1)}</td>
        <td className="num">{pct(r.balance > 0 ? r.nonaccrual / r.balance : 0, 1)}</td>
        <td className="num">{dollars(r.lost, unit)}</td>
        <td>
          {act && r.sale.balance >= 100_000 && (
            <button
              className="btn small"
              onClick={(e) => {
                e.stopPropagation();
                act((c: Ctx) => sellNonperforming(c, bank, r.t));
              }}
              title={`A bulk sale of the ${usd(r.sale.balance)} not paying to a distressed debt fund: ${usd(r.sale.balance - r.sale.price)} charged off today instead of over the coming year, the workouts gone, and the examiner stops counting them.`}
            >
              Sell the not paying ones for {usd(r.sale.price)}
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8}>
            <table className="inner stats">
              <thead>
                <tr>
                  <th>By year made</th>
                  <th className="num">loans</th>
                  <th className="num">balance {unitLabel(unit)}</th>
                  <th className="num">rate</th>
                  <th className="num">age (months)</th>
                  <th className="num">weak</th>
                  <th className="num">not paying</th>
                  <th className="num">lost</th>
                  <th className="num">of original</th>
                </tr>
              </thead>
              <tbody>
                {r.pools.map((p) => {
                  let w = 0;
                  let n = 0;
                  for (let g = 5; g < GRADES; g++) w += p.grades[g] ?? 0;
                  for (let g = 6; g < GRADES; g++) n += p.grades[g] ?? 0;
                  return (
                    <tr key={p.vintage}>
                      <td>{p.vintage}</td>
                      <td className="num">{num(p.count)}</td>
                      <td className="num">{dollars(p.balance, unit)}</td>
                      <td className="num">{pct(p.rate)}</td>
                      <td className="num">{p.ageMonths}</td>
                      <td className={'num' + (p.balance > 0 && w / p.balance > 0.08 ? ' alert' : '')}>{pct(p.balance > 0 ? w / p.balance : 0, 1)}</td>
                      <td className="num">{pct(p.balance > 0 ? n / p.balance : 0, 1)}</td>
                      <td className="num">{dollars(p.cumLoss, unit)}</td>
                      <td className="num">{pct(p.origBalance > 0 ? p.cumLoss / p.origBalance : 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="hint">One line per loan type and year made. A young year has had no time to go bad; an old one shows what it cost. Weak is the share graded 6 or worse; not paying is 7 or worse.</p>
          </td>
        </tr>
      )}
    </>
  );
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function Policy({ world, bank, refresh }: { world: World; bank: Bank; refresh: () => void }) {
  const p = bank.policy;
  const set = (patch: Partial<Bank['policy']>) => {
    setPolicy(world, patch);
    refresh();
  };
  const dial = (maxAuto: number, minGrade: number) => {
    setDial(world, maxAuto, minGrade);
    refresh();
  };
  return (
    <div>
      <p className="hint">
        The <Term k="delegation dial">dial</Term> decides which loans reach your desk; the <Term k="loan policy">written policy</Term> decides everything else. Small steps are for fine tuning; the larger ones are the old jumps.
      </p>
      <div className="cols">
        <table className="wrap">
          <thead>
            <tr>
              <th>Delegation dial</th>
              <th className="num">value</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Loans that reach your desk</td>
              <td className="num">{bank.dial.committee ? 'only the biggest' : bank.dial.maxAuto === 0 ? 'every loan' : 'above the line'}</td>
              <td>
                <div className="seg">
                  <button className={bank.dial.committee ? 'on' : ''} onClick={() => { setDialMode(world, { committee: true }); refresh(); }} title={`The loan committee decides credits up to ${usd(committeeLine(bank))}; you see the ones above that and get one line a month`}>
                    Only the biggest
                  </button>
                  <button className={!bank.dial.committee && bank.dial.maxAuto > 0 ? 'on' : ''} onClick={() => { setDialMode(world, { committee: false }); if (bank.dial.maxAuto === 0) setDialMode(world, { autoSize: true }); refresh(); }} title="Loans above the size line come to you; the loan officer decides the rest under your policy">
                    Above the size line
                  </button>
                  <button className={!bank.dial.committee && bank.dial.maxAuto === 0 ? 'on' : ''} onClick={() => { setDialMode(world, { committee: false }); setDial(world, 0, bank.dial.minGrade); refresh(); }} title="Every application stops the clock">
                    Every loan
                  </button>
                </div>
              </td>
            </tr>
            <tr>
              <td>The size line{bank.dial.committee ? ' (the committee decides up to three times it)' : ''}</td>
              <td className="num">{bank.dial.maxAuto === 0 ? 'every loan' : usd(bank.dial.maxAuto)}</td>
              <td>
                <button className={'btn small' + (bank.dial.autoSize ? ' on' : '')} onClick={() => { setDialMode(world, { autoSize: !bank.dial.autoSize }); refresh(); }} title={`Five percent of tier 1 capital, ${usd(autoSizeLine(bank))} today, reset each month as the bank grows`}>
                  {bank.dial.autoSize ? 'Follows capital (5%)' : 'Set by hand'}
                </button>
                <AmountField value={bank.dial.maxAuto} onChange={(v) => dial(v, bank.dial.minGrade)} presets={[100_000, 250_000, 1_000_000, 5_000_000]} label="Size" />
              </td>
            </tr>
            <tr>
              <td>Weak loans also come to you, whatever the size, when graded worse than</td>
              <td className="num">{bank.dial.minGrade >= 8 ? 'never' : `grade ${bank.dial.minGrade}`}</td>
              <td>
                <Stepper value={bank.dial.minGrade} steps={[{ d: 1, label: '1' }, { d: 2, label: '2' }]} fmt={(v) => (v >= 8 ? 'never' : `grade ${v}`)} onChange={(v) => dial(bank.dial.maxAuto, v)} min={0} max={8} />
              </td>
            </tr>
            <tr className="memo-row">
              <td colSpan={3}>Everything below the size line is decided by the loan officer under your written policy: within policy is approved, outside it is declined. With the committee deciding, credits up to three times the line are approved when sound (health 65 and up, within policy) and declined otherwise, and only the biggest reach you. A real CEO sets the authority and sits on committee for the large credits; five percent of capital is a common line.</td>
            </tr>
          </tbody>
        </table>
        <table className="wrap">
          <thead>
            <tr>
              <th>Written loan policy (version {p.version})</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Minimum <Term k="coverage">coverage</Term>
              </td>
              <td>
                <Stepper value={p.minDscr} steps={[{ d: 0.01, label: '0.01' }, { d: 0.1, label: '0.10' }]} fmt={(v) => `${v.toFixed(2)}x`} onChange={(v) => set({ minDscr: round2(v) })} min={0} max={5} />
              </td>
            </tr>
            <tr>
              <td>Maximum leverage (debt to income or earnings)</td>
              <td>
                <Stepper value={p.maxLeverage} steps={[{ d: 0.1, label: '0.1' }, { d: 0.5, label: '0.5' }]} fmt={(v) => `${v.toFixed(1)}x`} onChange={(v) => set({ maxLeverage: Math.round(v * 10) / 10 })} min={0.5} max={20} />
              </td>
            </tr>
            <tr>
              <td>Maximum single loan</td>
              <td>
                <AmountField value={p.maxSize} onChange={(v) => set({ maxSize: Math.max(10_000, v) })} presets={[250_000, 1_000_000, 5_000_000, 25_000_000]} label="Size" />
              </td>
            </tr>
            <tr>
              <td>
                <Term k="sector concentration">Sector concentration cap</Term>
              </td>
              <td>
                <Stepper value={p.sectorCap} steps={[{ d: 0.01, label: '1%' }, { d: 0.05, label: '5%' }]} fmt={(v) => pct(v, 0)} onChange={(v) => set({ sectorCap: round2(v) })} min={0.05} max={1} />
              </td>
            </tr>
            <tr>
              <td>
                Worst <Term k="grade">grade</Term> the loan officer may approve alone
              </td>
              <td>
                <Stepper value={p.maxGrade ?? 6} steps={[{ d: 1, label: '1' }, { d: 2, label: '2' }]} fmt={(v) => `grade ${v}`} onChange={(v) => set({ maxGrade: Math.round(v) })} min={1} max={8} />
              </td>
            </tr>
            <tr>
              <td>
                Lenders fill the book to <Term k="loans to deposits">loans to deposits</Term> of
              </td>
              <td>
                <Stepper value={p.targetLoansToDeposits ?? 0.75} steps={[{ d: 0.01, label: '1%' }, { d: 0.05, label: '5%' }]} fmt={(v) => pct(v, 0)} onChange={(v) => set({ targetLoansToDeposits: round2(v) })} min={0} max={1.1} />
              </td>
            </tr>
            <tr className="memo-row">
              <td colSpan={2}>
                Your loan officers book loans under this policy every month toward that target, in the home county's mix, without crossing your desk: the branch network's lending. Last month they booked {usd(bank.lendersBooked ?? 0)}. The credits above the size line still come to you on top. A community bank runs at 70% to 90%; above 100% the funding comes from the Home Loan Bank.
              </td>
            </tr>
            <tr>
              <td>Guarantee required on business loans</td>
              <td>
                <button className={'btn small' + (p.requireGuarantor ? ' on' : '')} onClick={() => set({ requireGuarantor: !p.requireGuarantor })}>
                  {p.requireGuarantor ? 'Required' : 'Not required'}
                </button>
              </td>
            </tr>
            {LOAN_TYPES.map((t) => (
              <tr key={t}>
                <td>
                  <Term k={TYPE[t].label}>{TYPE[t].label}</Term>: maximum <Term k="loan to value">loan to value</Term>
                </td>
                <td>
                  <Stepper value={p.maxLtv[t]} steps={[{ d: 0.01, label: '1%' }, { d: 0.05, label: '5%' }]} fmt={(v) => pct(v, 0)} onChange={(v) => set({ maxLtv: { ...p.maxLtv, [t]: round2(v) } })} min={0.1} max={1.5} />
                  <button
                    className={'btn small' + (p.allowed[t] ? '' : ' danger')}
                    onClick={() => {
                      setTypeAllowed(world, t, !p.allowed[t]);
                      refresh();
                    }}
                  >
                    {p.allowed[t] ? 'Lending on' : 'Lending off'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The rate sheet: your rate against the market for every type, one basis
// point at a time. Under market brings borrowers in and gives up yield;
// over market sends them to rivals and keeps it.
function RateSheet({ world, bank, refresh }: { world: World; bank: Bank; refresh: () => void }) {
  const pricing = bank.pricing ?? emptyByType(0);
  const received = bank.applicationsByType ?? emptyByType(0);
  const cost = bankDepositRate(bank);
  const per25 = calibration.loanRateElasticity.typical;
  const set = (t: LoanType, v: number) => {
    setPricing(world, t, v);
    refresh();
  };
  return (
    <div>
      <p className="hint">
        What you charge against the market, by loan type. Every 25 basis points under the market brings about {per25}% more borrowers of that type through the door; every 25 over sends that many away. The market rate moves with the Fed and the curve; your offset stays where you put it. Your deposits cost {pct(cost)} today.
      </p>
      <table className="wrap">
        <thead>
          <tr>
            <th>Rate sheet</th>
            <th className="num">market today</th>
            <th>your offset</th>
            <th className="num">your rate</th>
            <th className="num">borrowers</th>
            <th className="num">walked in this year</th>
            <th className="num">booked this year</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {LOAN_TYPES.filter((t) => t !== 'cards').map((t) => {
            const market = baseRate(world, t);
            const off = pricing[t] ?? 0;
            const m = demandMultiplier(bank, t);
            return (
              <tr key={t} className={bank.policy.allowed[t] ? '' : 'dim'}>
                <td>
                  <Term k={TYPE[t].label}>{TYPE[t].label}</Term>
                </td>
                <td className="num">{pct(market)}</td>
                <td>
                  <Stepper value={off} steps={[{ d: 0.0001, label: '1bp' }, { d: 0.0025, label: '25bp' }]} fmt={(v) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.round(Math.abs(v) * 10_000)}bp`} onChange={(v) => set(t, v)} min={PRICING_MIN} max={PRICING_MAX} />
                </td>
                <td className="num">{pct(market + off)}</td>
                <td className={'num ' + (m > 1.001 ? 'positive' : m < 0.999 ? 'alert' : '')}>{m > 1.001 ? `+${((m - 1) * 100).toFixed(0)}%` : m < 0.999 ? `(${((1 - m) * 100).toFixed(0)}%)` : 'market'}</td>
                <td className="num">{num(received[t] ?? 0)}</td>
                <td className="num">{usd(bank.originationsByType[t] ?? 0)}</td>
                <td>
                  {off !== 0 && (
                    <button className="btn small" onClick={() => set(t, 0)}>
                      Match market
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          <tr className="memo-row">
            <td colSpan={8}>
              Your rate is the market rate plus your offset; each borrower then pays their own premium for grade and term on top, as the memo shows. Credit cards price on the card line, not here. Turning a type off on Policy and dial stops it entirely; pricing it high keeps the door open for the borrowers who will pay.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
