// The core screens and the shell's pieces: the top bar with the clock,
// the feed with its side column, decisions as cards or a dialog, the
// balance sheet, income, You, help, debug. Panels are titled tables;
// every number is drillable where there is something beneath it.

import { useState } from 'react';
import type React from 'react';
import { calibration, unverifiedBands, type Band } from '../data/calibration';
import { type IncomeStatement, interestExpense, interestIncome, netIncome, netInterestIncome, noninterestExpense, pretaxIncome, totalAssets, totalDeposits, totalEquity, totalLiabilities, leverageRatio, tier1Capital } from '../engine/ledger';
import { LADDER_LABEL, PCA_LABEL, capitalStack, creConcentration, liquidityCoverage, pcaCategory, THRESHOLD_SIFI, THRESHOLD_STRESS } from '../engine/regulation';
import { type Bank, type Pending, type World, bookValuePerShare, playerNetWorth } from '../engine/state';
import { formatDate } from '../engine/time';
import { playerStake } from '../engine/wealth';
import { type Unit, dollars, num, pct, short, unitLabel } from './format';

// Days per real second by speed. Speed 4 is D3's top speed: a year in
// two minutes. Speed 5 is for skipping ahead.
export const SPEEDS = [0, 0.5, 1, 2, 3, 6];
const SPEED_LABELS = ['', 'Slow', 'Normal', 'Fast', 'Faster', 'Max'];

export function TopBar({ world, speed, onSpeed, onToggle, onSave, saved, onHelp }: { world: World; speed: number; onSpeed: (n: number) => void; onToggle: () => void; onSave: () => void; saved: boolean; onHelp: () => void }) {
  const bank = world.playerBankId ? world.banks[world.playerBankId] : null;
  const assets = bank ? totalAssets(bank.acct) : 0;
  const lev = bank ? leverageRatio(bank.acct) : 0;
  const cat = bank ? pcaCategory(lev) : null;
  const pill = cat === 'well' ? 'good' : cat === 'adequate' ? 'warn' : 'bad';
  return (
    <header className="topbar">
      <div className="brand">CHARTER</div>
      <div className="bankname">
        {bank ? bank.name : 'No bank'}
        <small>{bank ? `${bank.state}, since ${formatDate(bank.charteredDay)}` : 'between banks'}</small>
      </div>
      <div className="clock">
        <span className="date">{formatDate(world.day)}</span>
        <button className={'btn play' + (speed === 0 ? ' primary' : '')} onClick={onToggle} title="space">
          {speed === 0 ? 'Play' : 'Pause'}
        </button>
        <div className="seg" role="group" aria-label="Speed">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className={speed === n ? 'on' : ''} title={`${SPEEDS[n]} days per second (key ${n})`} onClick={() => onSpeed(n)}>
              {SPEED_LABELS[n]}
            </button>
          ))}
        </div>
      </div>
      {bank && (
        <div className="topstats">
          <div className="stat">
            <span className="k">Assets</span>
            <span className="v">{short(assets)}</span>
          </div>
          <div className="stat">
            <span className="k">Leverage</span>
            <span className={'v' + (lev < 0.05 ? ' bad' : '')}>
              {pct(lev, 1)} <span className={'pill ' + pill}>{cat === 'well' ? 'well capitalized' : cat ? PCA_LABEL[cat] : ''}</span>
            </span>
          </div>
          <div className="stat">
            <span className="k">Cash</span>
            <span className="v">{pct(assets > 0 ? bank.acct.cash / assets : 0, 1)}</span>
          </div>
          <div className="stat">
            <span className="k">Net worth</span>
            <span className="v">{short(playerNetWorth(world))}</span>
          </div>
        </div>
      )}
      <div className="topbar-actions">
        <button className="btn" onClick={onSave} title="s">
          {saved ? 'Saved' : 'Save'}
        </button>
        <button className="btn" onClick={onHelp} title="?">
          Help
        </button>
      </div>
    </header>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  borrower: 'borrower',
  depositor: 'depositor',
  rival: 'rival',
  officer: 'officer',
  regulator: 'regulator',
  market: 'market',
  system: 'bank',
  deal: 'deal',
};

export function FeedScreen({
  world,
  speed,
  onPlay,
  onDecide,
  cards,
  advisorOn,
  onToggleAdvisor,
  onDismiss,
}: {
  world: World;
  speed: number;
  onPlay: () => void;
  onDecide: (p: Pending, key: string) => void;
  cards: { key: string; text: string }[];
  advisorOn: boolean;
  onToggleAdvisor: () => void;
  onDismiss: (key: string) => void;
}) {
  const items = world.feed.slice(-300).reverse();
  const waiting = world.pending.filter((p) => !p.blocking);
  const e = world.economy;
  return (
    <div className="feed-grid">
      <div>
        <p className="hint">Everything that happens to your bank, newest first. A decision that needs you stops the clock and opens a dialog; offers wait beside the feed.</p>
        <table className="feed">
          <thead>
            <tr>
              <th>Feed</th>
              <th>source</th>
              <th>what happened</th>
            </tr>
          </thead>
          <tbody>
            {items.map((f) => (
              <tr key={f.id} className={f.severity === 'alert' ? 'alert' : f.severity === 'good' ? 'positive' : ''}>
                <td className="num when">{formatDate(f.day)}</td>
                <td>
                  <span className="chip">{SOURCE_LABEL[f.source] ?? f.source}</span>
                </td>
                <td>
                  <span className={'dot' + (f.severity === 'alert' ? ' alert' : f.severity === 'good' ? ' good' : '')} />
                  {f.text}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={3} className="empty">
                  Nothing has happened yet.{' '}
                  {speed === 0 && (
                    <button className="btn primary" onClick={onPlay}>
                      Press Play to start the clock
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <aside>
        {waiting.length > 0 && <div className="side-title">Waiting for you</div>}
        {waiting.map((p) => (
          <DecisionCard key={p.id} p={p} onDecide={onDecide} />
        ))}
        <div className="side-title">
          Advisor
          <button className="btn small" onClick={onToggleAdvisor}>
            {advisorOn ? 'hide' : 'show'}
          </button>
        </div>
        {advisorOn && cards.length === 0 && <p className="hint">Nothing to flag right now.</p>}
        {advisorOn &&
          cards.map((c) => (
            <div key={c.key} className="advice">
              <p>{c.text}</p>
              <button className="btn small" onClick={() => onDismiss(c.key)} title="dismiss for 90 days">
                dismiss
              </button>
            </div>
          ))}
        <table>
          <thead>
            <tr>
              <th>Economy</th>
              <th className="num">now</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Cycle</td>
              <td className="num">
                {e.regime === 'late' ? 'late cycle' : e.regime}
                {e.crisis && e.regime === 'recession' ? ' (banking crisis)' : ''}
              </td>
            </tr>
            <tr>
              <td>Fed funds</td>
              <td className="num">{pct(e.fedFunds)}</td>
            </tr>
            <tr>
              <td>10 year Treasury</td>
              <td className="num">{pct(e.curve.y10)}</td>
            </tr>
            <tr>
              <td>Unemployment</td>
              <td className="num">{pct(e.unemployment, 1)}</td>
            </tr>
            <tr>
              <td>Inflation</td>
              <td className="num">{pct(e.inflation, 1)}</td>
            </tr>
            <tr>
              <td>Home prices, 12 months</td>
              <td className={'num' + (e.hpiGrowth < 0 ? ' alert' : '')}>{pct(e.hpiGrowth, 1)}</td>
            </tr>
            <tr>
              <td>Oil</td>
              <td className="num">${e.oil.toFixed(0)}</td>
            </tr>
          </tbody>
        </table>
      </aside>
    </div>
  );
}

function DecisionBody({ p, onDecide }: { p: Pending; onDecide: (p: Pending, key: string) => void }) {
  return (
    <>
      <div className="when">{formatDate(p.day)}</div>
      <h2>{p.title}</h2>
      <div className="lines">
        {p.lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
      <div className="options">
        {p.options.map((o) => (
          <button key={o.key} className="btn option" onClick={() => onDecide(p, o.key)}>
            <kbd>{o.key}</kbd>
            {o.label}
          </button>
        ))}
      </div>
    </>
  );
}

export function DecisionCard({ p, onDecide }: { p: Pending; onDecide: (p: Pending, key: string) => void }) {
  return (
    <div className="decision">
      <DecisionBody p={p} onDecide={onDecide} />
    </div>
  );
}

// A decision that stops the clock docks under the tabs on every screen, so
// the player can look at the book or the balance sheet before answering.
export function DecisionDock({ p, more, onDecide }: { p: Pending; more: number; onDecide: (p: Pending, key: string) => void }) {
  return (
    <div className="dock" role="dialog" aria-label={p.title}>
      <div className="dock-inner">
        <div className="dock-label">
          Decision{more > 0 ? ` (${more} more waiting)` : ''}
          <span className="dim"> The clock is stopped until you answer. The other tabs still work.</span>
        </div>
        <DecisionBody p={p} onDecide={onDecide} />
      </div>
    </div>
  );
}

function Line({ label, value, unit, bold, indent, onClick, open }: { label: string; value: number; unit: Unit; bold?: boolean; indent?: boolean; onClick?: () => void; open?: boolean }) {
  return (
    <tr className={(bold ? 'total' : '') + (onClick ? ' row' : '')} onClick={onClick}>
      <td className={indent ? 'indent' : ''}>
        {onClick && <span className="chev">{open ? '▾' : '▸'}</span>}
        {label}
      </td>
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
    <div>
      <p className="hint">What the bank owns and owes, and how the regulators score its capital. Click a line with a triangle to open it.</p>
      <div className="cols">
        <table>
          <thead>
            <tr>
              <th>Assets</th>
              <th className="num">{unitLabel(unit)}</th>
            </tr>
          </thead>
          <tbody>
            <Line label="Cash and due from banks" value={a.cash} unit={unit} />
            <Line label="Securities" value={a.securitiesAFS + a.securitiesHTM + a.afsValuation} unit={unit} onClick={() => toggle('securities')} open={open.securities} />
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
              <th>Liabilities and equity</th>
              <th className="num">{unitLabel(unit)}</th>
            </tr>
          </thead>
          <tbody>
            <Line label="Deposits" value={totalDeposits(a)} unit={unit} onClick={() => toggle('deposits')} open={open.deposits} />
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
      <RegulationTables bank={bank} unit={unit} />
    </div>
  );
}

function RegulationTables({ bank, unit }: { bank: Bank; unit: Unit }) {
  const stack = capitalStack(bank);
  const c = bank.camels;
  const conc = creConcentration(bank);
  const assets = totalAssets(bank.acct);
  const lcr = assets >= THRESHOLD_SIFI ? liquidityCoverage(bank) : null;
  return (
    <div className="cols">
      <table>
        <thead>
          <tr>
            <th>Capital stack {unitLabel(unit)}</th>
            <th className="num">amount</th>
            <th className="num">ratio</th>
            <th className="num">minimum</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Risk weighted assets</td>
            <td className="num">{dollars(stack.rwa, unit)}</td>
            <td></td>
            <td></td>
          </tr>
          <tr className={stack.cet1Ratio < 0.07 ? 'alert' : ''}>
            <td>Common equity tier 1</td>
            <td className="num">{dollars(stack.cet1, unit)}</td>
            <td className="num">{pct(stack.cet1Ratio, 1)}</td>
            <td className="num">4.5% + 2.5% buffer</td>
          </tr>
          <tr>
            <td>Tier 1</td>
            <td className="num">{dollars(stack.tier1, unit)}</td>
            <td className="num">{pct(stack.tier1Ratio, 1)}</td>
            <td className="num">6.0%</td>
          </tr>
          <tr>
            <td>Tier 2 (allowance, sub debt)</td>
            <td className="num">{dollars(stack.tier2, unit)}</td>
            <td className="num">{pct(stack.totalRatio - stack.tier1Ratio, 1)}</td>
            <td></td>
          </tr>
          <tr>
            <td>Total capital</td>
            <td className="num">{dollars(stack.total, unit)}</td>
            <td className="num">{pct(stack.totalRatio, 1)}</td>
            <td className="num">8.0%</td>
          </tr>
          <tr className={stack.leverage < 0.05 ? 'alert' : ''}>
            <td>Leverage{stack.cblr ? ' (community bank leverage ratio elected)' : ''}</td>
            <td></td>
            <td className="num">{pct(stack.leverage, 1)}</td>
            <td className="num">{stack.cblr ? '9.0%' : '4.0%'}</td>
          </tr>
          <tr className="total">
            <td>
              <span className={'pill ' + (stack.category === 'well' ? 'good' : stack.category === 'adequate' ? 'warn' : 'bad')}>{PCA_LABEL[stack.category]}</span>
            </td>
            <td colSpan={3} className="num">
              payout limit {pct(stack.maxPayout, 0)} of earnings{stack.bufferShortfall > 0 ? `, buffer short by ${pct(stack.bufferShortfall, 1)}` : ''}
            </td>
          </tr>
          <tr className={conc.construction > 1 || conc.cre > 3 ? 'alert' : 'memo-row'}>
            <td>CRE concentration: construction / non owner occupied</td>
            <td colSpan={3} className="num">
              {pct(conc.construction, 0)} / {pct(conc.cre, 0)} of capital (guidance 100% / 300%)
            </td>
          </tr>
          {bank.stressTest && (
            <tr className={bank.stressTest.passed ? 'memo-row' : 'alert'}>
              <td>Stress test {formatDate(bank.stressTest.day)}</td>
              <td className="num">{dollars(bank.stressTest.losses, unit)} losses</td>
              <td colSpan={2} className="num">
                {bank.stressTest.passed ? 'passed' : 'failed: no dividends for a year'}, buffer {pct(bank.stressTest.buffer, 1)}
              </td>
            </tr>
          )}
          {assets >= THRESHOLD_STRESS && !bank.stressTest && (
            <tr className="memo-row">
              <td>Stress test</td>
              <td colSpan={3} className="num">
                due at year end
              </td>
            </tr>
          )}
          {lcr && (
            <tr className={lcr.ratio < 1 ? 'alert' : 'memo-row'}>
              <td>Liquidity coverage (SIFI)</td>
              <td className="num">{dollars(lcr.hqla, unit)} liquid</td>
              <td colSpan={2} className="num">
                {pct(lcr.ratio, 0)} of a month of stressed outflows
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th>Supervision</th>
            <th className="num">rating</th>
          </tr>
        </thead>
        <tbody>
          <tr className={c.composite >= 3 ? 'alert' : ''}>
            <td>CAMELS composite{c.lastExam !== null ? `, exam ${formatDate(c.lastExam)}` : ', not yet examined'}</td>
            <td className="num">{c.lastExam !== null ? c.composite : ''}</td>
          </tr>
          <tr>
            <td className="indent">Capital / Assets / Management</td>
            <td className="num">
              {c.capital} / {c.assets} / {c.management}
            </td>
          </tr>
          <tr>
            <td className="indent">Earnings / Liquidity / Sensitivity</td>
            <td className="num">
              {c.earnings} / {c.liquidity} / {c.sensitivity}
            </td>
          </tr>
          <tr className={bank.enforcement !== 'none' ? 'alert' : ''}>
            <td>Enforcement</td>
            <td className="num">
              {LADDER_LABEL[bank.enforcement]}
              {bank.enforcementSince !== null ? ` since ${formatDate(bank.enforcementSince)}` : ''}
            </td>
          </tr>
          <tr>
            <td>Next exam</td>
            <td className="num">{formatDate(c.nextExam)}</td>
          </tr>
          {c.findings
            .filter((f) => !f.resolved)
            .map((f) => (
              <tr key={f.id} className="alert">
                <td className="indent">
                  {f.component}: {f.text}
                </td>
                <td className="num">{formatDate(f.day)}</td>
              </tr>
            ))}
          {c.findings.filter((f) => !f.resolved).length === 0 && c.lastExam !== null && (
            <tr>
              <td className="indent dim">no open findings</td>
              <td></td>
            </tr>
          )}
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
      <p className="hint">Where the money comes from and where it goes: this month, this quarter, this year. The call report below is the quarterly record.</p>
      <table>
        <thead>
          <tr>
            <th>Income {unitLabel(unit)}</th>
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
          <th>Call report</th>
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
            <td className={'num' + (r.netIncome < 0 ? ' alert' : '')}>{dollars(r.netIncome, unit)}</td>
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
    <div>
      <p className="hint">Your own money: salary, dividends, your stake in the bank, and the capital actions that change it. Net worth is the score.</p>
      <div className="cols">
        <div>
          <table>
            <thead>
              <tr>
                <th>Personal</th>
                <th className="num">($)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Cash</td>
                <td className="num">{num(p.cash)}</td>
                <td></td>
              </tr>
              <tr>
                <td>Shares held</td>
                <td className="num">{num(p.shares)}</td>
                <td></td>
              </tr>
              <tr>
                <td>Stake</td>
                <td className="num">{pct(stake, 1)}</td>
                <td></td>
              </tr>
              <tr>
                <td>{bank?.isPublic ? 'Market value per share' : 'Book value per share'}</td>
                <td className="num">{perShare.toFixed(2)}</td>
                <td></td>
              </tr>
              <tr>
                <td>Stake value</td>
                <td className="num">{num(stakeValue)}</td>
                <td></td>
              </tr>
              <tr className="total">
                <td>Net worth</td>
                <td className="num">{num(playerNetWorth(world))}</td>
                <td></td>
              </tr>
              <tr>
                <td>Salary, annual</td>
                <td className="num">{num(p.salary)}</td>
                <td>
                  <div className="seg">
                    <button onClick={() => onSalary(-10_000)}>- 10K</button>
                    <button onClick={() => onSalary(10_000)}>+ 10K</button>
                  </div>
                </td>
              </tr>
              <tr>
                <td>Dividend payout, share of quarterly earnings</td>
                <td className="num">{bank ? pct(bank.dividendPayout, 0) : ''}</td>
                <td>
                  <div className="seg">
                    <button onClick={() => onPayout(-0.1)}>- 10%</button>
                    <button onClick={() => onPayout(0.1)}>+ 10%</button>
                  </div>
                </td>
              </tr>
              <tr>
                <td>Tax rate, flat</td>
                <td className="num">{pct(p.taxRate, 0)}</td>
                <td></td>
              </tr>
              <tr>
                <td>Invested in banks</td>
                <td className="num">{num(p.invested)}</td>
                <td></td>
              </tr>
              <tr>
                <td>Salary received after tax</td>
                <td className="num">{num(p.salaryReceived)}</td>
                <td></td>
              </tr>
              <tr>
                <td>Dividends received after tax</td>
                <td className="num">{num(p.dividendsReceived)}</td>
                <td></td>
              </tr>
              <tr>
                <td>Stock sale proceeds</td>
                <td className="num">{num(p.stockSaleProceeds)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th>Net worth</th>
                <th className="num">last 10 years</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={2}>
                  <Sparkline values={p.netWorthHistory.slice(-120).map((h) => h.value)} width={480} height={48} />
                </td>
              </tr>
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th>Record</th>
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
                <th>Milestones</th>
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
              {world.milestones.length === 0 && (
                <tr>
                  <td colSpan={2} className="empty">
                    No milestones yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div>{capital}</div>
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

export function HelpModal({ onClose, onNewWorld }: { onClose: () => void; onNewWorld: () => void }) {
  const rows: [string, string][] = [
    ['Tabs at the top', 'every screen; the letter beside a tab is its key'],
    ['Play and Pause, or space', 'start and stop the clock'],
    ['Slow to Max, or keys 1 to 5', 'half a day, one, two, three or six days per second (Faster is a year in two minutes)'],
    ['Decision buttons, or the key shown on them', 'answer a loan, an exam, an offer, an auction'],
    ['Save, or s', 'save in this browser; the game also saves every year end'],
    ['Click a row', 'open a loan, a pool, a rival, a total'],
    ['Map', 'hover a county for its numbers, click Open a branch'],
    ['You screen', 'salary and payout with the buttons, or + - [ ]'],
    ['Advisor', 'dismiss a card for 90 days; hide or show them all'],
    ['Escape', 'close this'],
  ];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Help" onClick={(e) => e.stopPropagation()}>
        <h2>How to play</h2>
        <p className="hint">You are the CEO and controlling shareholder. Grow the bank, keep it capitalized, keep the depositors calm, and outlast the cycle. Everything is a click; the keys are shortcuts.</p>
        <table className="help-rows wrap">
          <thead>
            <tr>
              <th>Control</th>
              <th>does</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="modal-foot">
          <button className="btn danger" onClick={onNewWorld}>
            Start a new world
          </button>
          <button className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function DebugScreen({ world, tickMs, manifest, dataOk, onExport, onImport, onNewWorld }: { world: World; tickMs: number; manifest: Record<string, unknown> | null; dataOk: boolean; onExport?: () => void; onImport?: (file: File) => void; onNewWorld?: () => void }) {
  const unverified = unverifiedBands();
  const banks = Object.values(world.banks);
  return (
    <div>
      <p className="hint">Under the hood: the seed, the clock, the economy, saves, and which calibration constants are still hand-entered rather than computed from FDIC data.</p>
      <div className="cols">
        <table>
          <thead>
            <tr>
              <th>World</th>
              <th className="num"></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>seed</td>
              <td className="num">{world.seed}</td>
            </tr>
            <tr>
              <td>day</td>
              <td className="num">
                {world.day} ({formatDate(world.day)})
              </td>
            </tr>
            <tr>
              <td>last batch, ms</td>
              <td className="num">{tickMs.toFixed(1)}</td>
            </tr>
            <tr>
              <td>banks open / failed</td>
              <td className="num">
                {banks.filter((b) => b.status === 'open').length} / {banks.filter((b) => b.status === 'failed').length}
              </td>
            </tr>
            <tr>
              <td>counties / metros / states</td>
              <td className="num">
                {Object.keys(world.geo.counties).length} / {Object.keys(world.geo.metros).length} / {Object.keys(world.geo.states).length}
              </td>
            </tr>
            <tr>
              <td>data vintage</td>
              <td className="num">{world.dataVintage ?? 'none'}</td>
            </tr>
            <tr>
              <td>data files</td>
              <td className="num">{dataOk ? 'loaded' : 'missing'}</td>
            </tr>
            <tr>
              <td>feed items / pending</td>
              <td className="num">
                {world.feed.length} / {world.pending.length}
              </td>
            </tr>
            <tr>
              <td>regime</td>
              <td className="num">
                {world.economy.regime}
                {world.economy.crisis ? ' (crisis)' : ''}, month {world.economy.month}
              </td>
            </tr>
            <tr>
              <td>fed funds / 2y / 10y</td>
              <td className="num">
                {pct(world.economy.fedFunds)} / {pct(world.economy.curve.y2)} / {pct(world.economy.curve.y10)}
              </td>
            </tr>
            <tr>
              <td>unemployment / inflation / gdp</td>
              <td className="num">
                {pct(world.economy.unemployment, 1)} / {pct(world.economy.inflation, 1)} / {pct(world.economy.gdpGrowth, 1)}
              </td>
            </tr>
            <tr>
              <td>oil / hpi / sp500</td>
              <td className="num">
                {world.economy.oil.toFixed(0)} / {world.economy.hpi.toFixed(1)} / {world.economy.sp500.toFixed(0)}
              </td>
            </tr>
            <tr>
              <td>milestones</td>
              <td className="num">{world.milestones.length}, on You</td>
            </tr>
            <tr>
              <td>deals / failures</td>
              <td className="num">
                {world.deals.length} / {world.failures.length}
              </td>
            </tr>
            {manifest && (
              <tr>
                <td>manifest</td>
                <td className="num">{String((manifest as { builtOn?: string }).builtOn ?? 'present')}</td>
              </tr>
            )}
          </tbody>
        </table>
        <div>
          <table>
            <thead>
              <tr>
                <th>Saves</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Export the world to a file</td>
                <td>{onExport && <button className="btn" onClick={onExport}>Export save</button>}</td>
              </tr>
              <tr>
                <td>Load a world from a file</td>
                <td>{onImport && <input type="file" accept="application/json,.json" onChange={(e) => e.target.files && e.target.files[0] && onImport(e.target.files[0])} />}</td>
              </tr>
              <tr>
                <td>Throw this world away</td>
                <td>{onNewWorld && <button className="btn danger" onClick={onNewWorld}>Start a new world</button>}</td>
              </tr>
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th>Sector indices</th>
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
      </div>
      <table>
        <thead>
          <tr>
            <th>Calibration, unverified ({unverified.length})</th>
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
    </div>
  );
}
