// LOANS: the relationship book, the pools, the written policy, the dial.
// Every pool drills to a sample of representative loans generated on
// demand from its distribution (D29), never stored.

import { useMemo, useState } from 'react';
import { TYPE, bookByType } from '../engine/credit';
import { GRADES } from '../engine/loantypes';
import { LOAN_TYPES, type LoanType } from '../engine/loantypes';
import { derive, hashString, rand, randNormal } from '../engine/rng';
import { type Bank, type Loan, type Pool, type World } from '../engine/state';
import { formatDate } from '../engine/time';
import { decidedText } from '../engine/loans';
import { setDial, setPolicy, setTypeAllowed } from '../engine/underwriting';
import { type Unit, dollars, num, pct, short, unitLabel } from './format';

interface Props {
  world: World;
  bank: Bank;
  unit: Unit;
  refresh: () => void;
}

type Tab = 'book' | 'pools' | 'policy';

export function LoansScreen({ world, bank, unit, refresh }: Props) {
  const [tab, setTab] = useState<Tab>('book');
  const [openPool, setOpenPool] = useState<string | null>(null);
  const [openLoan, setOpenLoan] = useState<string | null>(null);
  const rows = bookByType(bank);
  const total = rows.reduce((s, r) => s + r.balance, 0);
  return (
    <div>
      <p className="hint">The loans on your books by type, then the detail: the relationship book you decide loan by loan, the pooled book, and the written policy and dial that decide which loans reach your desk.</p>
      <div className="toolbar">
        <div className="seg">
          <button className={tab === 'book' ? 'on' : ''} onClick={() => setTab('book')}>Relationship book</button>
          <button className={tab === 'pools' ? 'on' : ''} onClick={() => setTab('pools')}>Pools</button>
          <button className={tab === 'policy' ? 'on' : ''} onClick={() => setTab('policy')}>Policy and dial</button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Book by type {unitLabel(unit)}</th>
            <th className="num">balance</th>
            <th className="num">share</th>
            <th className="num">loans</th>
            <th className="num">yield</th>
            <th className="num">criticized</th>
            <th className="num">nonaccrual</th>
            <th className="num">YTD originations</th>
            <th className="num">lifetime charge-offs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.type}>
              <td>{r.label}</td>
              <td className="num">{dollars(r.balance, unit)}</td>
              <td className="num">{pct(total > 0 ? r.balance / total : 0, 1)}</td>
              <td className="num">{num(r.count)}</td>
              <td className="num">{pct(r.yield)}</td>
              <td className={'num' + (r.balance > 0 && r.criticized / r.balance > 0.1 ? ' alert' : '')}>{pct(r.balance > 0 ? r.criticized / r.balance : 0, 1)}</td>
              <td className="num">{pct(r.balance > 0 ? r.nonaccrual / r.balance : 0, 1)}</td>
              <td className="num">{dollars(bank.originationsByType[r.type], unit)}</td>
              <td className="num">{dollars(bank.lifetimeChargeOffsByType[r.type], unit)}</td>
            </tr>
          ))}
          <tr className="total">
            <td>Total loans</td>
            <td className="num">{dollars(bank.acct.loans, unit)}</td>
            <td className="num">100.0%</td>
            <td className="num">{num(rows.reduce((s, r) => s + r.count, 0))}</td>
            <td className="num">{pct(bank.loanYield)}</td>
            <td className="num">{pct(total > 0 ? rows.reduce((s, r) => s + r.criticized, 0) / total : 0, 1)}</td>
            <td className="num">{pct(total > 0 ? rows.reduce((s, r) => s + r.nonaccrual, 0) / total : 0, 1)}</td>
            <td className="num">{dollars(LOAN_TYPES.reduce((s, t) => s + bank.originationsByType[t], 0), unit)}</td>
            <td className="num">{dollars(LOAN_TYPES.reduce((s, t) => s + bank.lifetimeChargeOffsByType[t], 0), unit)}</td>
          </tr>
          <tr className="memo-row">
            <td>Allowance</td>
            <td className="num">{dollars(bank.acct.allowance, unit)}</td>
            <td className="num">{pct(bank.acct.loans > 0 ? bank.acct.allowance / bank.acct.loans : 0)}</td>
            <td colSpan={6}>
              applications: {num(bank.applications.received)} received, {num(bank.applications.toDesk)} to the desk, {num(bank.applications.autoApproved)} auto-approved for {short(bank.applications.autoApprovedAmount)}, {num(bank.applications.autoDeclined)} auto-declined
            </td>
          </tr>
        </tbody>
      </table>
      {tab === 'book' && <Book bank={bank} unit={unit} openLoan={openLoan} setOpenLoan={setOpenLoan} />}
      {tab === 'pools' && <Pools world={world} bank={bank} unit={unit} openPool={openPool} setOpenPool={setOpenPool} />}
      {tab === 'policy' && <Policy world={world} bank={bank} refresh={refresh} />}
    </div>
  );
}

function statusLabel(l: Loan): string {
  switch (l.status) {
    case 'current':
      return 'current';
    case 'late30':
      return '30 days';
    case 'late60':
      return '60 days';
    case 'late90':
      return '90 days';
    case 'nonaccrual':
      return 'nonaccrual';
    case 'workout':
      return 'workout';
    case 'reo':
      return 'REO';
    case 'paid':
      return 'paid';
    case 'chargedOff':
      return 'charged off';
  }
}

function Book({ bank, unit, openLoan, setOpenLoan }: { bank: Bank; unit: Unit; openLoan: string | null; setOpenLoan: (id: string | null) => void }) {
  const loans = [...bank.loans].sort((a, b) => (a.status === b.status ? b.balance - a.balance : rank(a) - rank(b)));
  return (
    <table>
      <thead>
        <tr>
          <th>Relationship book ({loans.filter((l) => l.status !== 'paid' && l.status !== 'chargedOff').length} loans)</th>
          <th>type</th>
          <th className="num">balance {unitLabel(unit)}</th>
          <th className="num">rate</th>
          <th className="num">grade</th>
          <th>status</th>
          <th className="num">DSCR</th>
          <th className="num">LTV</th>
          <th>decided</th>
          <th className="num">originated</th>
        </tr>
      </thead>
      <tbody>
        {loans.slice(0, 300).map((l) => (
          <LoanRows key={l.id} l={l} unit={unit} open={openLoan === l.id} toggle={() => setOpenLoan(openLoan === l.id ? null : l.id)} />
        ))}
        {loans.length === 0 && (
          <tr>
            <td colSpan={10} className="empty">
              No relationship loans yet. Applications arrive daily from the bank's home county; the dial decides which reach you.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function rank(l: Loan): number {
  return ['nonaccrual', 'workout', 'late90', 'late60', 'late30', 'reo', 'current', 'paid', 'chargedOff'].indexOf(l.status);
}

function LoanRows({ l, unit, open, toggle }: { l: Loan; unit: Unit; open: boolean; toggle: () => void }) {
  const bad = l.status !== 'current' && l.status !== 'paid';
  return (
    <>
      <tr className={'row' + (bad ? ' alert' : '')} onClick={toggle}>
        <td>{l.borrower}</td>
        <td>{TYPE[l.type].label}</td>
        <td className="num">{dollars(l.status === 'reo' ? l.reoValue : l.balance, unit)}</td>
        <td className="num">{pct(l.rate)}</td>
        <td className="num">{l.grade}</td>
        <td>{statusLabel(l)}</td>
        <td className="num">{l.memo.dscr.toFixed(2)}x</td>
        <td className="num">{pct(l.memo.ltv, 0)}</td>
        <td>{l.decision.by}{l.decision.countered ? ' (countered)' : ''}</td>
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

function Pools({ world, bank, unit, openPool, setOpenPool }: { world: World; bank: Bank; unit: Unit; openPool: string | null; setOpenPool: (k: string | null) => void }) {
  const pools = [...bank.pools].sort((a, b) => (a.type === b.type ? b.vintage - a.vintage : LOAN_TYPES.indexOf(a.type) - LOAN_TYPES.indexOf(b.type)));
  return (
    <table>
      <thead>
        <tr>
          <th>Pools {unitLabel(unit)}</th>
          <th className="num">vintage</th>
          <th className="num">loans</th>
          <th className="num">balance</th>
          <th className="num">rate</th>
          <th className="num">age (mo)</th>
          {Array.from({ length: GRADES }, (_, g) => (
            <th key={g} className="num">
              g{g + 1}
            </th>
          ))}
          <th className="num">cum loss</th>
          <th className="num">of original</th>
        </tr>
      </thead>
      <tbody>
        {pools.map((p) => {
          const key = `${p.type}:${p.vintage}`;
          return (
            <PoolRows key={key} world={world} bank={bank} p={p} unit={unit} open={openPool === key} toggle={() => setOpenPool(openPool === key ? null : key)} />
          );
        })}
      </tbody>
    </table>
  );
}

function PoolRows({ world, bank, p, unit, open, toggle }: { world: World; bank: Bank; p: Pool; unit: Unit; open: boolean; toggle: () => void }) {
  const sample = useMemo(() => (open ? samplePool(world, bank, p) : []), [open, world, bank, p]);
  return (
    <>
      <tr className="row" onClick={toggle}>
        <td>{TYPE[p.type].label}</td>
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
          <td colSpan={16}>
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

function Policy({ world, bank, refresh }: { world: World; bank: Bank; refresh: () => void }) {
  const p = bank.policy;
  const set = (patch: Partial<Bank['policy']>) => {
    setPolicy(world, patch);
    refresh();
  };
  const ltv = (t: LoanType, d: number) => set({ maxLtv: { ...p.maxLtv, [t]: Math.max(0.1, Math.min(1.5, Math.round((p.maxLtv[t] + d) * 100) / 100)) } });
  return (
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
            <td className="num">{num(bank.dial.maxAuto)}</td>
            <td>
              <button className="key" onClick={() => { setDial(world, bank.dial.maxAuto / 2, bank.dial.minGrade); refresh(); }}>halve</button>
              <button className="key" onClick={() => { setDial(world, bank.dial.maxAuto === 0 ? 50_000 : bank.dial.maxAuto * 2, bank.dial.minGrade); refresh(); }}>double</button>
              <button className="key" title="every loan crosses your desk" onClick={() => { setDial(world, 0, 0); refresh(); }}>all to me</button>
            </td>
          </tr>
          <tr>
            <td>Loans graded worse than this come to you</td>
            <td className="num">{bank.dial.minGrade}</td>
            <td>
              <button className="key" onClick={() => { setDial(world, bank.dial.maxAuto, bank.dial.minGrade - 1); refresh(); }}>tighter</button>
              <button className="key" onClick={() => { setDial(world, bank.dial.maxAuto, bank.dial.minGrade + 1); refresh(); }}>looser</button>
            </td>
          </tr>
        </tbody>
      </table>
      <table className="wrap">
        <thead>
          <tr>
            <th>Written loan policy (version {p.version})</th>
            <th className="num">value</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Minimum coverage (DSCR)</td>
            <td className="num">{p.minDscr.toFixed(2)}x</td>
            <td>
              <button className="key" onClick={() => set({ minDscr: Math.max(0, Math.round((p.minDscr - 0.05) * 100) / 100) })}>-</button>
              <button className="key" onClick={() => set({ minDscr: Math.round((p.minDscr + 0.05) * 100) / 100 })}>+</button>
            </td>
          </tr>
          <tr>
            <td>Maximum leverage</td>
            <td className="num">{p.maxLeverage.toFixed(1)}x</td>
            <td>
              <button className="key" onClick={() => set({ maxLeverage: Math.max(0.5, Math.round((p.maxLeverage - 0.5) * 10) / 10) })}>-</button>
              <button className="key" onClick={() => set({ maxLeverage: Math.round((p.maxLeverage + 0.5) * 10) / 10 })}>+</button>
            </td>
          </tr>
          <tr>
            <td>Maximum single loan</td>
            <td className="num">{num(p.maxSize)}</td>
            <td>
              <button className="key" onClick={() => set({ maxSize: Math.max(50_000, Math.round(p.maxSize / 2)) })}>halve</button>
              <button className="key" onClick={() => set({ maxSize: p.maxSize * 2 })}>double</button>
            </td>
          </tr>
          <tr>
            <td>Sector concentration cap</td>
            <td className="num">{pct(p.sectorCap, 0)}</td>
            <td>
              <button className="key" onClick={() => set({ sectorCap: Math.max(0.05, Math.round((p.sectorCap - 0.05) * 100) / 100) })}>-</button>
              <button className="key" onClick={() => set({ sectorCap: Math.min(1, Math.round((p.sectorCap + 0.05) * 100) / 100) })}>+</button>
            </td>
          </tr>
          <tr>
            <td>Guarantee required on business loans</td>
            <td className="num">{p.requireGuarantor ? 'yes' : 'no'}</td>
            <td>
              <button className="key" onClick={() => set({ requireGuarantor: !p.requireGuarantor })}>toggle</button>
            </td>
          </tr>
          {LOAN_TYPES.map((t) => (
            <tr key={t}>
              <td>{TYPE[t].label}: max LTV, allowed</td>
              <td className="num">
                {pct(p.maxLtv[t], 0)} {p.allowed[t] ? 'on' : 'off'}
              </td>
              <td>
                <button className="key" onClick={() => ltv(t, -0.05)}>-</button>
                <button className="key" onClick={() => ltv(t, 0.05)}>+</button>
                <button className="key" onClick={() => { setTypeAllowed(world, t, !p.allowed[t]); refresh(); }}>{p.allowed[t] ? 'turn off' : 'turn on'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
