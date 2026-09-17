// Phase 1 screens: FEED, BS, IS, ME, DEBUG. Tables, monospace numbers,
// one accent for alerts, one for positive. Every number drillable where
// there is something beneath it.

import { useState } from 'react';
import type React from 'react';
import { calibration, unverifiedBands, type Band } from '../data/calibration';
import { type IncomeStatement, interestExpense, interestIncome, netIncome, netInterestIncome, noninterestExpense, pretaxIncome, totalAssets, totalDeposits, totalEquity, totalLiabilities, leverageRatio, tier1Capital } from '../engine/ledger';
import { PCA_LABEL, pcaCategory } from '../engine/regulation';
import { type Bank, type Pending, type World, bookValuePerShare, playerNetWorth } from '../engine/state';
import { formatDate } from '../engine/time';
import { playerStake } from '../engine/wealth';
import { type Unit, dollars, num, pct, short, unitLabel } from './format';

export function FeedScreen({ world, onDecide }: { world: World; onDecide: (p: Pending, key: string) => void }) {
  const items = world.feed.slice(-400).reverse();
  return (
    <div>
      {world.pending.map((p) => (
        <PendingPanel key={p.id} p={p} onDecide={onDecide} />
      ))}
      <table>
        <thead>
          <tr>
            <th>date</th>
            <th>source</th>
            <th>item</th>
          </tr>
        </thead>
        <tbody>
          {items.map((f) => (
            <tr key={f.id} className={f.severity === 'alert' ? 'alert' : f.severity === 'good' ? 'positive' : ''}>
              <td className="num">{formatDate(f.day)}</td>
              <td>{f.source}</td>
              <td>{f.text}</td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={3} className="dim">
                nothing yet. press space to run.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function PendingPanel({ p, onDecide }: { p: Pending; onDecide: (p: Pending, key: string) => void }) {
  return (
    <div className="pending">
      <div className="pending-title">
        {formatDate(p.day)} {p.title}
      </div>
      {p.lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
      <div className="options">
        {p.options.map((o) => (
          <button key={o.key} className="key" onClick={() => onDecide(p, o.key)}>
            {o.key}: {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Line({ label, value, unit, bold, indent, onClick }: { label: string; value: number; unit: Unit; bold?: boolean; indent?: boolean; onClick?: () => void }) {
  return (
    <tr className={(bold ? 'total' : '') + (onClick ? ' row' : '')} onClick={onClick}>
      <td className={indent ? 'indent' : ''}>{label}</td>
      <td className="num">{dollars(value, unit)}</td>
    </tr>
  );
}

export function BalanceSheetScreen({ bank, unit }: { bank: Bank; unit: Unit }) {
  const a = bank.acct;
  const [open, setOpen] = useState<Record<string, boolean>>({ loans: false, deposits: true, securities: true });
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const lev = leverageRatio(a);
  return (
    <div className="cols">
      <table>
        <thead>
          <tr>
            <th>ASSETS</th>
            <th className="num">{unitLabel(unit)}</th>
          </tr>
        </thead>
        <tbody>
          <Line label="Cash and due from banks" value={a.cash} unit={unit} />
          <Line label="Securities" value={a.securitiesAFS + a.securitiesHTM + a.afsValuation} unit={unit} onClick={() => toggle('securities')} />
          {open.securities && (
            <>
              <Line label="Available for sale, at cost" value={a.securitiesAFS} unit={unit} indent />
              <Line label="AFS fair value adjustment" value={a.afsValuation} unit={unit} indent />
              <Line label="Held to maturity, at cost" value={a.securitiesHTM} unit={unit} indent />
            </>
          )}
          <Line label="Loans, gross" value={a.loans} unit={unit} />
          <Line label="Allowance for credit losses" value={-a.allowance} unit={unit} indent />
          <Line label="Loans, net" value={a.loans - a.allowance} unit={unit} bold />
          <Line label="Interest receivable" value={a.interestReceivable} unit={unit} />
          <Line label="Other real estate owned" value={a.reo} unit={unit} />
          <Line label="Premises and equipment" value={a.premises} unit={unit} />
          <Line label="Goodwill" value={a.goodwill} unit={unit} />
          <Line label="Other assets" value={a.otherAssets} unit={unit} />
          <Line label="Total assets" value={totalAssets(a)} unit={unit} bold />
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th>LIABILITIES AND EQUITY</th>
            <th className="num">{unitLabel(unit)}</th>
          </tr>
        </thead>
        <tbody>
          <Line label="Deposits" value={totalDeposits(a)} unit={unit} onClick={() => toggle('deposits')} />
          {open.deposits && (
            <>
              <Line label="Checking" value={a.checking} unit={unit} indent />
              <Line label="Savings" value={a.savings} unit={unit} indent />
              <Line label="Money market" value={a.mmda} unit={unit} indent />
              <Line label="Certificates of deposit" value={a.cd} unit={unit} indent />
              <Line label="Brokered" value={a.brokered} unit={unit} indent />
            </>
          )}
          <Line label="FHLB advances" value={a.fhlb} unit={unit} />
          <Line label="Fed funds purchased" value={a.fedFundsPurchased} unit={unit} />
          <Line label="Subordinated debt" value={a.subDebt} unit={unit} />
          <Line label="Interest payable" value={a.interestPayable} unit={unit} />
          <Line label="Other liabilities" value={a.otherLiabilities} unit={unit} />
          <Line label="Total liabilities" value={totalLiabilities(a)} unit={unit} bold />
          <Line label="Common stock and surplus" value={a.commonStock} unit={unit} />
          <Line label="Retained earnings" value={a.retainedEarnings} unit={unit} />
          <Line label="Accumulated other comprehensive income" value={a.aoci} unit={unit} />
          <Line label="Total equity" value={totalEquity(a)} unit={unit} bold />
          <Line label="Total liabilities and equity" value={totalLiabilities(a) + totalEquity(a)} unit={unit} bold />
          <tr className="memo-row">
            <td>Tier 1 capital</td>
            <td className="num">{dollars(tier1Capital(a), unit)}</td>
          </tr>
          <tr className={'memo-row' + (lev < 0.05 ? ' alert' : '')}>
            <td>Leverage ratio, {PCA_LABEL[pcaCategory(lev)]}</td>
            <td className="num">{pct(lev)}</td>
          </tr>
          <tr className="memo-row">
            <td>Shares outstanding</td>
            <td className="num">{num(bank.shares)}</td>
          </tr>
          <tr className="memo-row">
            <td>Book value per share</td>
            <td className="num">{bookValuePerShare(bank).toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const IS_LINES: { label: string; get: (s: IncomeStatement) => number; bold?: boolean; indent?: boolean }[] = [
  { label: 'Interest on loans', get: (s) => s.interestLoans, indent: true },
  { label: 'Interest on securities', get: (s) => s.interestSecurities, indent: true },
  { label: 'Interest on cash', get: (s) => s.interestCash, indent: true },
  { label: 'Total interest income', get: interestIncome, bold: true },
  { label: 'Checking', get: (s) => s.interestChecking, indent: true },
  { label: 'Savings', get: (s) => s.interestSavings, indent: true },
  { label: 'Money market', get: (s) => s.interestMmda, indent: true },
  { label: 'Certificates', get: (s) => s.interestCd, indent: true },
  { label: 'Brokered', get: (s) => s.interestBrokered, indent: true },
  { label: 'Borrowings', get: (s) => s.interestBorrowings, indent: true },
  { label: 'Total interest expense', get: interestExpense, bold: true },
  { label: 'Net interest income', get: netInterestIncome, bold: true },
  { label: 'Provision for credit losses', get: (s) => s.provision },
  { label: 'Fee income', get: (s) => s.feeIncome },
  { label: 'Securities gains (losses)', get: (s) => s.securitiesGains },
  { label: 'Salaries and benefits', get: (s) => s.salaries, indent: true },
  { label: 'Occupancy', get: (s) => s.occupancy, indent: true },
  { label: 'Other expense', get: (s) => s.otherExpense, indent: true },
  { label: 'FDIC assessment', get: (s) => s.assessment, indent: true },
  { label: 'Total noninterest expense', get: noninterestExpense, bold: true },
  { label: 'Pretax income', get: pretaxIncome, bold: true },
  { label: 'Income tax', get: (s) => s.tax },
  { label: 'Net income', get: netIncome, bold: true },
  { label: 'Memo: net charge-offs', get: (s) => s.chargeOffs - s.recoveries },
  { label: 'Memo: days', get: (s) => s.days },
];

export function IncomeScreen({ bank, unit }: { bank: Bank; unit: Unit }) {
  const cols: { label: string; s: IncomeStatement | null }[] = [
    { label: 'month to date', s: bank.is.month },
    { label: 'quarter to date', s: bank.is.quarter },
    { label: 'last quarter', s: bank.is.lastQuarter },
    { label: 'year to date', s: bank.is.year },
    { label: 'last year', s: bank.is.lastYear },
  ];
  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>INCOME {unitLabel(unit)}</th>
            {cols.map((c) => (
              <th key={c.label} className="num">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {IS_LINES.map((l) => (
            <tr key={l.label} className={l.bold ? 'total' : ''}>
              <td className={l.indent ? 'indent' : ''}>{l.label}</td>
              {cols.map((c) => (
                <td key={c.label} className="num">
                  {c.s ? (l.label === 'Memo: days' ? num(l.get(c.s)) : dollars(l.get(c.s), unit)) : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ReportsTable bank={bank} unit={unit} />
    </div>
  );
}

export function ReportsTable({ bank, unit }: { bank: Bank; unit: Unit }) {
  const reports = bank.reports.slice(-12).reverse();
  if (reports.length === 0) return null;
  return (
    <table>
      <thead>
        <tr>
          <th>CALL REPORT</th>
          <th className="num">assets</th>
          <th className="num">loans</th>
          <th className="num">deposits</th>
          <th className="num">equity</th>
          <th className="num">leverage</th>
          <th className="num">net income</th>
          <th className="num">ROA</th>
          <th className="num">NIM</th>
          <th className="num">NCO</th>
        </tr>
      </thead>
      <tbody>
        {reports.map((r) => (
          <tr key={r.quarter}>
            <td>{r.quarter}</td>
            <td className="num">{dollars(r.assets, unit)}</td>
            <td className="num">{dollars(r.loans, unit)}</td>
            <td className="num">{dollars(r.deposits, unit)}</td>
            <td className="num">{dollars(r.equity, unit)}</td>
            <td className="num">{pct(r.leverage)}</td>
            <td className="num">{dollars(r.netIncome, unit)}</td>
            <td className="num">{pct(r.roa)}</td>
            <td className="num">{pct(r.nim)}</td>
            <td className="num">{pct(r.ncoRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MeScreen({ world, onSalary, onPayout, capital }: { world: World; onSalary: (delta: number) => void; onPayout: (delta: number) => void; capital?: React.ReactNode }) {
  const p = world.player;
  const bank = world.playerBankId ? world.banks[world.playerBankId] : null;
  const stake = playerStake(world);
  const perShare = bank ? (bank.isPublic && bank.price !== null ? bank.price : bookValuePerShare(bank)) : 0;
  const stakeValue = bank ? Math.round(p.shares * perShare) : 0;
  return (
    <div className="cols">
      <table>
        <thead>
          <tr>
            <th>PERSONAL</th>
            <th className="num">($)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Cash</td>
            <td className="num">{num(p.cash)}</td>
          </tr>
          <tr>
            <td>Shares held</td>
            <td className="num">{num(p.shares)}</td>
          </tr>
          <tr>
            <td>Stake</td>
            <td className="num">{pct(stake, 1)}</td>
          </tr>
          <tr>
            <td>{bank?.isPublic ? 'Market value per share' : 'Book value per share'}</td>
            <td className="num">{perShare.toFixed(2)}</td>
          </tr>
          <tr>
            <td>Stake value</td>
            <td className="num">{num(stakeValue)}</td>
          </tr>
          <tr className="total">
            <td>Net worth</td>
            <td className="num">{num(playerNetWorth(world))}</td>
          </tr>
          <tr>
            <td>Salary, annual (+ and - change it)</td>
            <td className="num">{num(p.salary)}</td>
          </tr>
          <tr>
            <td>Dividend payout, share of quarterly earnings ([ and ] change it)</td>
            <td className="num">{bank ? pct(bank.dividendPayout, 0) : ''}</td>
          </tr>
          <tr>
            <td>Tax rate, flat</td>
            <td className="num">{pct(p.taxRate, 0)}</td>
          </tr>
          <tr>
            <td>Invested in banks</td>
            <td className="num">{num(p.invested)}</td>
          </tr>
          <tr>
            <td>Salary received after tax</td>
            <td className="num">{num(p.salaryReceived)}</td>
          </tr>
          <tr>
            <td>Dividends received after tax</td>
            <td className="num">{num(p.dividendsReceived)}</td>
          </tr>
          <tr>
            <td>Stock sale proceeds</td>
            <td className="num">{num(p.stockSaleProceeds)}</td>
          </tr>
        </tbody>
      </table>
      <div>
        <table>
          <thead>
            <tr>
              <th>NET WORTH</th>
              <th className="num">last 10 years</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={2}>
                <Sparkline values={p.netWorthHistory.slice(-120).map((h) => h.value)} />
              </td>
            </tr>
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th>RECORD</th>
              <th>from</th>
              <th>to</th>
              <th>outcome</th>
            </tr>
          </thead>
          <tbody>
            {p.record.map((r) => (
              <tr key={r.bankId} className={r.outcome === 'failed' ? 'alert' : ''}>
                <td>{r.bankName}</td>
                <td className="num">{formatDate(r.from)}</td>
                <td className="num">{r.to === null ? '' : formatDate(r.to)}</td>
                <td>{r.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th>MILESTONES</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {world.milestones
              .slice(-20)
              .reverse()
              .map((m, i) => (
                <tr key={i}>
                  <td className="num">{formatDate(m.day)}</td>
                  <td>{m.text}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <div className="keys-inline">
          <button className="key" onClick={() => onSalary(-10_000)}>- salary</button>
          <button className="key" onClick={() => onSalary(10_000)}>+ salary</button>
          <button className="key" onClick={() => onPayout(-0.1)}>[ payout</button>
          <button className="key" onClick={() => onPayout(0.1)}>] payout</button>
        </div>
        {capital}
      </div>
    </div>
  );
}

export function Sparkline({ values, width = 320, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} className="spark" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - ((v - min) / span) * (height - 2) - 1).toFixed(1)}`);
  return (
    <svg width={width} height={height} className="spark">
      <polyline points={pts.join(' ')} />
    </svg>
  );
}

export function DebugScreen({ world, tickMs, manifest, dataOk }: { world: World; tickMs: number; manifest: Record<string, unknown> | null; dataOk: boolean }) {
  const unverified = unverifiedBands();
  const banks = Object.values(world.banks);
  return (
    <div className="cols">
      <table>
        <thead>
          <tr>
            <th>DEBUG</th>
            <th className="num"></th>
          </tr>
        </thead>
        <tbody>
          <tr><td>seed</td><td className="num">{world.seed}</td></tr>
          <tr><td>day</td><td className="num">{world.day} ({formatDate(world.day)})</td></tr>
          <tr><td>last batch, ms</td><td className="num">{tickMs.toFixed(1)}</td></tr>
          <tr><td>banks open / failed</td><td className="num">{banks.filter((b) => b.status === 'open').length} / {banks.filter((b) => b.status === 'failed').length}</td></tr>
          <tr><td>counties / metros / states</td><td className="num">{Object.keys(world.geo.counties).length} / {Object.keys(world.geo.metros).length} / {Object.keys(world.geo.states).length}</td></tr>
          <tr><td>data vintage</td><td className="num">{world.dataVintage ?? 'none'}</td></tr>
          <tr><td>data files</td><td className="num">{dataOk ? 'loaded' : 'missing'}</td></tr>
          <tr><td>feed items / pending</td><td className="num">{world.feed.length} / {world.pending.length}</td></tr>
          <tr><td>regime</td><td className="num">{world.economy.regime}{world.economy.crisis ? ' (crisis)' : ''}, month {world.economy.month}</td></tr>
          <tr><td>fed funds / 2y / 10y</td><td className="num">{pct(world.economy.fedFunds)} / {pct(world.economy.curve.y2)} / {pct(world.economy.curve.y10)}</td></tr>
          <tr><td>unemployment / inflation / gdp</td><td className="num">{pct(world.economy.unemployment, 1)} / {pct(world.economy.inflation, 1)} / {pct(world.economy.gdpGrowth, 1)}</td></tr>
          <tr><td>oil / hpi / sp500</td><td className="num">{world.economy.oil.toFixed(0)} / {world.economy.hpi.toFixed(1)} / {world.economy.sp500.toFixed(0)}</td></tr>
          <tr><td>save</td><td className="num">s saves, n starts a new world</td></tr>
          {manifest && (
            <tr><td>manifest</td><td className="num">{String((manifest as { builtOn?: string }).builtOn ?? 'present')}</td></tr>
          )}
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th>CALIBRATION, unverified ({unverified.length})</th>
            <th className="num">typical</th>
            <th>unit</th>
          </tr>
        </thead>
        <tbody>
          {unverified.map((path) => {
            const band = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], calibration) as Band;
            return (
              <tr key={path} className="alert">
                <td>{path}</td>
                <td className="num">{band.typical}</td>
                <td>{band.unit}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th>SECTOR INDICES</th>
            <th className="num">level</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(world.economy.sectors).map(([s, v]) => (
            <tr key={s}>
              <td>{s}</td>
              <td className="num">{v.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatusBar({ world, speed, screen, unit }: { world: World; speed: number; screen: string; unit: Unit }) {
  const bank = world.playerBankId ? world.banks[world.playerBankId] : null;
  const lev = bank ? leverageRatio(bank.acct) : 0;
  return (
    <header className="bar">
      <span className="title">CHARTER</span>
      <span>{bank ? bank.name : 'no bank'}</span>
      <span className="num">{formatDate(world.day)}</span>
      <span>{speed === 0 ? 'PAUSED' : `speed ${speed}`}</span>
      {bank && (
        <>
          <span className="num">assets {short(totalAssets(bank.acct))}</span>
          <span className={'num' + (lev < 0.05 ? ' alert' : '')}>lev {pct(lev, 1)}</span>
        </>
      )}
      <span className="num">net worth {short(playerNetWorth(world))}</span>
      <span className="dim">{screen} {unitLabel(unit)}</span>
    </header>
  );
}
