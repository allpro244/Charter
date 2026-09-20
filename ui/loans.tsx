// Lending: the book by type with a health bar, then the relationship
// book, the written policy and the dial, and the pools for the player
// who wants the grade buckets. Every pool drills to a sample of
// representative loans generated on demand (D29), never stored.

import { useMemo, useState } from 'react';
import { TYPE, bookByType } from '../engine/credit';
import { GRADES, LOAN_TYPES, type LoanType, emptyByType } from '../engine/loantypes';
import { derive, hashString, rand, randNormal } from '../engine/rng';
import { type Bank, type Loan, type Pool, type World } from '../engine/state';
import { formatDate } from '../engine/time';
import { decidedText, isTroubled, noteSalePrice, reoQuickPrice, sellLoan, sellReoNow } from '../engine/loans';
import { nonperformingSale, sellNonperforming } from '../engine/credit';
import type { Ctx } from '../engine/ctx';
import { PRICING_MAX, PRICING_MIN, demandMultiplier, setDial, setPolicy, setPricing, setTypeAllowed } from '../engine/underwriting';
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

type Tab = 'book' | 'sheet' | 'policy' | 'pools';

export function LoansScreen({ world, bank, unit, refresh, act }: Props) {
  const [tab, setTab] = useState<Tab>('book');
  const [openPool, setOpenPool] = useState<string | null>(null);
  const [openLoan, setOpenLoan] = useState<string | null>(null);
  const rows = bookByType(bank);
  const total = rows.reduce((s, r) => s + r.balance, 0);
  return (
    <div>
      <p className="hint">The loans on your books by type, with a health bar showing the share graded weak. Below: the loans you decide one by one, the written policy and dial that decide the rest, and the pools for the detail.</p>
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
          <button className={tab === 'pools' ? 'on' : ''} onClick={() => setTab('pools')}>
            Pools (details)
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
                <td>
                  <HealthBar share={weak} />
                </td>
                <td className={'num' + (weak > 0.08 ? ' alert' : '')}>{pct(weak, 1)}</td>
                <td className="num">{pct(r.balance > 0 ? r.nonaccrual / r.balance : 0, 1)}</td>
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
      {tab === 'pools' && <Pools world={world} bank={bank} unit={unit} openPool={openPool} setOpenPool={setOpenPool} act={act} />}
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
          <th>Loans you decided ({loans.filter((l) => l.status !== 'paid' && l.status !== 'chargedOff' && l.status !== 'sold').length})</th>
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
              {bank.homeCounty ? 'No relationship loans yet. Applications arrive daily; the dial decides which reach you.' : 'No relationship loans in this build: without a home county, no applications arrive. The pools hold the book.'}
            </td>
          </tr>
        )}
      </tbody>
    </table>
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

function Pools({ world, bank, unit, openPool, setOpenPool, act }: { world: World; bank: Bank; unit: Unit; openPool: string | null; setOpenPool: (k: string | null) => void; act?: Props['act'] }) {
  const pools = [...bank.pools].sort((a, b) => (a.type === b.type ? b.vintage - a.vintage : LOAN_TYPES.indexOf(a.type) - LOAN_TYPES.indexOf(b.type)));
  const sales = LOAN_TYPES.map((t) => ({ t, ...nonperformingSale(world, bank, t) })).filter((x) => x.balance > 0);
  return (
    <div>
      {sales.length > 0 && (
        <table className="wrap">
          <thead>
            <tr>
              <th>Nonperforming pooled loans (grades 7 and 8)</th>
              <th className="num">balance</th>
              <th className="num">a buyer pays</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sales.map((x) => (
              <tr key={x.t}>
                <td>{TYPE[x.t].label}</td>
                <td className="num">{dollars(x.balance, unit)}</td>
                <td className="num">{dollars(x.price, unit)}</td>
                <td>
                  {act && (
                    <button className="btn small" onClick={() => act((c: Ctx) => sellNonperforming(c, bank, x.t))} title={`${usd(x.balance - x.price)} charged off today; the workouts and the drag on earnings go with the loans`}>
                      Sell them for {usd(x.price)}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="memo-row">
              <td colSpan={4}>A bulk sale to a distressed debt fund: the price is what the type's loss given default leaves, less a fifth for the buyer. Selling takes the loss now instead of over the coming year, and the examiner stops counting them.</td>
            </tr>
          </tbody>
        </table>
      )}
      <p className="hint">
        Each pool is one loan type and one year of origination. The g1 to g9 columns are the share of the balance in each <Term k="grade">grade</Term>: 1 is the safest, 6 and up are weak, 9 is a loss. Click a pool for a sample of the loans inside it.
      </p>
      <table>
        <thead>
          <tr>
            <th>Pools {unitLabel(unit)}</th>
            <th className="num">year</th>
            <th className="num">loans</th>
            <th className="num">balance</th>
            <th className="num">rate</th>
            <th className="num">age (mo)</th>
            {Array.from({ length: GRADES }, (_, g) => (
              <th key={g} className="num">
                g{g + 1}
              </th>
            ))}
            <th className="num">lost</th>
            <th className="num">of original</th>
          </tr>
        </thead>
        <tbody>
          {pools.map((p) => {
            const key = `${p.type}:${p.vintage}`;
            return <PoolRows key={key} world={world} bank={bank} p={p} unit={unit} open={openPool === key} toggle={() => setOpenPool(openPool === key ? null : key)} />;
          })}
        </tbody>
      </table>
    </div>
  );
}

function PoolRows({ world, bank, p, unit, open, toggle }: { world: World; bank: Bank; p: Pool; unit: Unit; open: boolean; toggle: () => void }) {
  const sample = useMemo(() => (open ? samplePool(world, bank, p) : []), [open, world, bank, p]);
  return (
    <>
      <tr className="row" onClick={toggle}>
        <td>
          <span className="chev">{open ? '▾' : '▸'}</span>
          {TYPE[p.type].label}
        </td>
        <td className="num">{p.vintage}</td>
        <td className="num">{num(p.count)}</td>
        <td className="num">{dollars(p.balance, unit)}</td>
        <td className="num">{pct(p.rate)}</td>
        <td className="num">{p.ageMonths}</td>
        {p.grades.map((g, i) => (
          <td key={i} className={'num' + (i >= 6 && g > 0 ? ' alert' : '')}>
            {pct(p.balance > 0 ? g / p.balance : 0, 0)}
          </td>
        ))}
        <td className="num">{dollars(p.cumLoss, unit)}</td>
        <td className="num">{pct(p.origBalance > 0 ? p.cumLoss / p.origBalance : 0)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={17}>
            <table className="inner stats">
              <thead>
                <tr>
                  <th>Representative loans (generated from the pool, not stored)</th>
                  <th className="num">balance {unitLabel(unit)}</th>
                  <th className="num">rate</th>
                  <th className="num">grade</th>
                </tr>
              </thead>
              <tbody>
                {sample.map((s, i) => (
                  <tr key={i}>
                    <td>{s.name}</td>
                    <td className="num">{dollars(s.balance, unit)}</td>
                    <td className="num">{pct(s.rate)}</td>
                    <td className="num">g{s.grade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

// Ten loans drawn from the pool's grade distribution and average size.
function samplePool(world: World, bank: Bank, p: Pool): { name: string; balance: number; rate: number; grade: number }[] {
  const r = derive(world.seed, hashString(`${bank.id}:${p.type}:${p.vintage}:${p.ageMonths}`));
  const out = [] as { name: string; balance: number; rate: number; grade: number }[];
  const avg = p.count > 0 ? p.balance / p.count : TYPE[p.type].avgSize;
  const names = ['Alvarez', 'Booth', 'Carver', 'Dunn', 'Eze', 'Farrow', 'Gaines', 'Huang', 'Ivers', 'Jost'];
  for (let i = 0; i < 10; i++) {
    let x = rand(r) * p.balance;
    let grade = 1;
    for (let g = 0; g < GRADES; g++) {
      x -= p.grades[g] ?? 0;
      if (x <= 0) {
        grade = g + 1;
        break;
      }
    }
    out.push({ name: `${names[i]} ${TYPE[p.type].label.toLowerCase()} borrower`, balance: Math.max(1000, Math.round(avg * Math.exp(randNormal(r, 0, 0.6)))), rate: Math.round((p.rate + randNormal(r, 0, 0.003)) * 10_000) / 10_000, grade });
  }
  return out;
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
              <td>Loans above this size come to you</td>
              <td className="num">{bank.dial.maxAuto === 0 ? 'every loan' : usd(bank.dial.maxAuto)}</td>
              <td>
                <AmountField value={bank.dial.maxAuto} onChange={(v) => dial(v, bank.dial.minGrade)} presets={[0, 100_000, 250_000, 1_000_000, 5_000_000]} label="Size" />
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
              <td colSpan={3}>Everything below the size line is decided by the loan officer under your written policy: within policy is approved, outside it is declined. Set the grade line to never and only size decides what you see.</td>
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
