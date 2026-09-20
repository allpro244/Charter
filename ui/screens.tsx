// The shell's pieces and the core screens: the top bar with the clock,
// the feed list, decisions as cards or a dock with their plain-words
// preview, the balance sheet in three questions, the income statement,
// You, help, debug. Panels are titled tables; every number is drillable
// where there is something beneath it.

import { useState } from 'react';
import type React from 'react';
import { calibration, unverifiedBands, type Band } from '../data/calibration';
import { type IncomeStatement, interestExpense, interestIncome, netIncome, netInterestIncome, noninterestExpense, pretaxIncome, totalAssets, totalDeposits, totalEquity, totalLiabilities, leverageRatio, tier1Capital } from '../engine/ledger';
import { LADDER_LABEL, PCA_LABEL, capitalStack, creConcentration, liquidityCoverage, pcaCategory, THRESHOLD_SIFI, THRESHOLD_STRESS } from '../engine/regulation';
import { type Bank, type FeedItem, type Pending, type World, bookValuePerShare, playerBank, playerNetWorth } from '../engine/state';
import { formatDate } from '../engine/time';
import { playerStake } from '../engine/wealth';
import { type Unit, dollars, num, pct, short, unitLabel, usd } from './format';
import { Pill, Stepper, Term } from './parts';
import { previewFor } from './preview';
import { healthTone, loanHealth } from '../engine/health';
import type { Application } from '../engine/borrowers';
import { TYPE } from '../engine/credit';
import { counterTerms, fundable, policyCheck, termsFrom } from '../engine/underwriting';
import { lendingLimit } from '../engine/regulation';
import { ladder } from '../engine/ladder';

// Days per real second by speed. Speed 4 is D3's top speed: a year in
// two minutes. Speed 5 is for skipping ahead.
export const SPEEDS = [0, 0.5, 1, 2, 3, 6];
const SPEED_LABELS = ['', 'Slow', 'Normal', 'Fast', 'Faster', 'Max'];

export function TopBar({ world, speed, onSpeed, onToggle, onSave, saved, onHelp, alerts = 0, onAlerts }: { world: World; speed: number; onSpeed: (n: number) => void; onToggle: () => void; onSave: () => void; saved: boolean; onHelp: () => void; alerts?: number; onAlerts?: () => void }) {
  const bank = world.playerBankId ? world.banks[world.playerBankId] : null;
  const rank = world.ladder?.rank ?? 0;
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
            <span className="v">{usd(assets)}</span>
          </div>
          <div className="stat">
            <span className="k">Capital</span>
            <span className={'v' + (lev < 0.05 ? ' bad' : '')}>
              {pct(lev, 1)} <span className={'pill ' + pill}>{cat === 'well' ? 'well capitalized' : cat ? PCA_LABEL[cat] : ''}</span>
            </span>
          </div>
          <div className="stat">
            <span className="k">Cash</span>
            <span className="v">{pct(assets > 0 ? bank.acct.cash / assets : 0, 1)}</span>
          </div>
          <div className="stat" title="Your place among America's banks by assets. The You tab has the ladder.">
            <span className="k">Rank</span>
            <span className="v">{rank > 0 ? `#${num(rank)}` : 'soon'}</span>
          </div>
          {alerts > 0 && (
            <button className="btn small alertpill" onClick={onAlerts} title="Things to look at, on the Overview">
              {alerts} {alerts === 1 ? 'alert' : 'alerts'}
            </button>
          )}
          <div className="stat">
            <span className="k">Net worth</span>
            <span className="v">{usd(playerNetWorth(world))}</span>
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

export function FeedList({ items, speed, onPlay }: { items: FeedItem[]; speed: number; onPlay: () => void }) {
  return (
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
  );
}

function DecisionBody({ world, p, onDecide }: { world: World; p: Pending; onDecide: (p: Pending, key: string) => void }) {
  const preview = previewFor(world, p);
  const bank = playerBank(world);
  const app = p.kind === 'loan_application' ? (p.data.app as Application | undefined) : undefined;
  const apps = p.kind === 'loan_batch' ? ((p.data.apps as Application[] | undefined) ?? []) : [];
  return (
    <>
      <div className="when">{formatDate(p.day)}</div>
      <h2>{p.title}</h2>
      {app && bank ? <HealthMeter world={world} bank={bank} app={app} /> : null}
      {apps.length > 0 && bank ? (
        <BatchHealth world={world} bank={bank} apps={apps} />
      ) : (
        <div className="lines">
          {p.lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      )}
      {preview.length > 0 && (
        <div className="preview">
          <div className="preview-title">What this means</div>
          {preview.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      )}
      {app && bank && (() => {
        const limit = lendingLimit(bank);
        const room = fundable(bank);
        const need = app.memo.amount;
        if (need > limit) return <p className="alert">Cannot be made: {usd(need)} is over the legal lending limit of {usd(limit)} to one borrower. A counter offer cuts the loan to {usd(counterTerms(app).amount)}{counterTerms(app).amount > limit ? ', still over the limit' : ''}.</p>;
        if (need > room) return <p className="alert">Cannot be funded: it needs {usd(need)} and the bank can lend {usd(room)} today from cash above the cushion and half the Home Loan Bank line (the other half is kept for withdrawals). Gather deposits or sell bonds first.</p>;
        return <p className="dim">Funding: {usd(need)} of {usd(room)} the bank can lend today{need > Math.max(0, bank.acct.cash - 0.03 * totalAssets(bank.acct)) ? ', part of it drawn from the Home Loan Bank line' : ''}.</p>;
      })()}
      <div className="options">
        {p.options.map((o) => {
          const blocked = app && bank ? (o.key === 'a' && (app.memo.amount > lendingLimit(bank) || app.memo.amount > fundable(bank))) || (o.key === 'c' && (counterTerms(app).amount > lendingLimit(bank) || counterTerms(app).amount > fundable(bank))) : false;
          return (
            <button key={o.key} className="btn option" disabled={blocked} title={blocked ? 'Over the legal limit or beyond what the bank can fund today' : undefined} onClick={() => onDecide(p, o.key)}>
              <kbd>{o.key}</kbd>
              {o.label}
            </button>
          );
        })}
      </div>
    </>
  );
}

// The loan health meter: the five Cs and concentration from the memo,
// an overall word, the CCO's grade beside it, and whether the rate pays.
function HealthMeter({ world, bank, app }: { world: World; bank: Bank; app: Application }) {
  const h = loanHealth(world, bank, app);
  const m = app.memo;
  return (
    <div className="health">
      <div className="health-head">
        <span className="gauge-label">
          <Term k="loan health">Loan health</Term>
        </span>
        <span className={'health-score ' + h.tone}>
          {h.score} <span className="health-word">{h.label}</span>
        </span>
        <span className="bar health-bar">
          <span className={'fill ' + h.tone} style={{ width: `${h.score}%` }} />
        </span>
        <span className="dim">
          CCO grade {h.ccoGrade}. {h.strengths.length ? `Strong on ${h.strengths.join(', ')}.` : ''} {h.concerns.length ? `Weak on ${h.concerns.join(', ')}.` : ''}
        </span>
      </div>
      <table className="wrap health-table">
        <thead>
          <tr>
            <th>
              What a banker looks at (<Term k="five Cs">the five Cs</Term>)
            </th>
            <th>reading</th>
            <th className="num">score</th>
            <th>what it means</th>
          </tr>
        </thead>
        <tbody>
          {h.factors.map((f) => (
            <tr key={f.key}>
              <td>{f.label}</td>
              <td className="nowrap">{f.reading}</td>
              <td className="num">
                <span className="bar">
                  <span className={'fill ' + healthTone(f.score)} style={{ width: `${f.score}%` }} />
                </span>{' '}
                {f.score}
              </td>
              <td>{f.note}</td>
            </tr>
          ))}
          <tr className="total">
            <td>Does the rate pay for it</td>
            <td className="nowrap">{pct(m.rate)} asked</td>
            <td className={'num ' + (h.pricing.tone === 'good' ? 'positive' : h.pricing.tone === 'bad' ? 'alert' : '')}>{h.pricing.margin >= 0 ? '+' : ''}{(h.pricing.margin * 100).toFixed(2)}%</td>
            <td>{h.pricing.note}</td>
          </tr>
        </tbody>
      </table>
      <div className="lines">
        <p>{m.summary}</p>
        {m.redFlags.map((f, i) => (
          <p key={i} className="alert">
            Flag: {f}
          </p>
        ))}
      </div>
    </div>
  );
}

function BatchHealth({ world, bank, apps }: { world: World; bank: Bank; apps: Application[] }) {
  return (
    <table className="wrap">
      <thead>
        <tr>
          <th>Applications above the dial</th>
          <th>type</th>
          <th className="num">amount</th>
          <th className="num">rate</th>
          <th className="num">grade</th>
          <th className="num">
            <Term k="loan health">health</Term>
          </th>
          <th>policy</th>
          <th>weak on</th>
        </tr>
      </thead>
      <tbody>
        {apps.map((a, i) => {
          const h = loanHealth(world, bank, a);
          const check = policyCheck(bank, a, termsFrom(a));
          return (
            <tr key={i}>
              <td>{a.borrower}</td>
              <td>{TYPE[a.type].label}</td>
              <td className="num">{usd(a.memo.amount)}</td>
              <td className="num">{pct(a.memo.rate)}</td>
              <td className="num">{a.memo.suggestedGrade}</td>
              <td className="num">
                <span className="bar">
                  <span className={'fill ' + h.tone} style={{ width: `${h.score}%` }} />
                </span>{' '}
                {h.score} {h.label}
              </td>
              <td className={check.pass ? 'positive' : 'alert'}>{check.pass ? 'within' : 'exception'}</td>
              <td className="dim">{h.concerns.join(', ') || 'nothing'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function DecisionCard({ world, p, onDecide }: { world: World; p: Pending; onDecide: (p: Pending, key: string) => void }) {
  return (
    <div className="decision">
      <DecisionBody world={world} p={p} onDecide={onDecide} />
    </div>
  );
}

// A decision that stops the clock docks under the tabs on every screen, so
// the player can look at the book or the balance sheet before answering.
export function DecisionDock({ world, p, more, onDecide }: { world: World; p: Pending; more: number; onDecide: (p: Pending, key: string) => void }) {
  return (
    <div className="dock" role="dialog" aria-label={p.title}>
      <div className="dock-inner">
        <div className="dock-label">
          Decision{more > 0 ? ` (${more} more waiting)` : ''}
          <span className="dim"> The clock is stopped until you answer. The other tabs still work.</span>
        </div>
        <DecisionBody world={world} p={p} onDecide={onDecide} />
      </div>
    </div>
  );
}

function Line({ label, value, unit, bold, indent, dim }: { label: React.ReactNode; value: number; unit: Unit; bold?: boolean; indent?: boolean; dim?: boolean }) {
  return (
    <tr className={(bold ? 'total' : '') + (dim ? ' memo-row' : '')}>
      <td className={indent ? 'indent' : ''}>{label}</td>
      <td className="num">{dollars(value, unit)}</td>
    </tr>
  );
}

export function BalanceSheetScreen({ bank, unit }: { bank: Bank; unit: Unit }) {
  const a = bank.acct;
  const [all, setAll] = useState(false);
  const [regs, setRegs] = useState(false);
  const lev = leverageRatio(a);
  const cat = pcaCategory(lev);
  const borrowings = a.fhlb + a.fedFundsPurchased + a.subDebt;
  return (
    <div>
      <p className="hint">
        What the bank owns, what it owes, and what is left for shareholders.{' '}
        <button className="btn small" onClick={() => setAll((v) => !v)}>
          {all ? 'Fewer lines' : 'Show every line'}
        </button>
      </p>
      <div className="cols">
        <table className="wrap">
          <thead>
            <tr>
              <th>What you own</th>
              <th className="num">{unitLabel(unit)}</th>
            </tr>
          </thead>
          <tbody>
            <Line label="Cash" value={a.cash} unit={unit} />
            <Line label={<Term k="available for sale">Bonds</Term>} value={a.securitiesAFS + a.securitiesHTM + a.afsValuation} unit={unit} />
            {all && (
              <>
                <Line label={<Term k="available for sale">Available for sale, at cost</Term>} value={a.securitiesAFS} unit={unit} indent />
                <Line label={<Term k="unrealized loss">Market value adjustment</Term>} value={a.afsValuation} unit={unit} indent />
                <Line label={<Term k="held to maturity">Held to maturity, at cost</Term>} value={a.securitiesHTM} unit={unit} indent />
              </>
            )}
            <Line label="Loans, after the cushion for losses" value={a.loans - a.allowance} unit={unit} />
            {all && (
              <>
                <Line label="Loans, gross" value={a.loans} unit={unit} indent />
                <Line label={<Term k="allowance">Cushion for losses (allowance)</Term>} value={-a.allowance} unit={unit} indent />
                <Line label="Interest owed to you" value={a.interestReceivable} unit={unit} />
                <Line label="Foreclosed property" value={a.reo} unit={unit} />
                <Line label="Buildings and equipment" value={a.premises} unit={unit} />
                <Line label={<Term k="goodwill">Goodwill from acquisitions</Term>} value={a.goodwill} unit={unit} />
                <Line label="Other" value={a.otherAssets} unit={unit} />
              </>
            )}
            {!all && a.interestReceivable + a.reo + a.premises + a.goodwill + a.otherAssets !== 0 && <Line label="Everything else" value={a.interestReceivable + a.reo + a.premises + a.goodwill + a.otherAssets} unit={unit} />}
            <Line label={<Term k="assets">Total assets</Term>} value={totalAssets(a)} unit={unit} bold />
          </tbody>
        </table>
        <table className="wrap">
          <thead>
            <tr>
              <th>What you owe</th>
              <th className="num">{unitLabel(unit)}</th>
            </tr>
          </thead>
          <tbody>
            <Line label="Deposits" value={totalDeposits(a)} unit={unit} />
            {all && (
              <>
                <Line label={<Term k="Checking">Checking</Term>} value={a.checking} unit={unit} indent />
                <Line label={<Term k="Savings">Savings</Term>} value={a.savings} unit={unit} indent />
                <Line label={<Term k="Money market">Money market</Term>} value={a.mmda} unit={unit} indent />
                <Line label={<Term k="Certificates">Certificates of deposit</Term>} value={a.cd} unit={unit} indent />
                <Line label={<Term k="Brokered">Brokered</Term>} value={a.brokered} unit={unit} indent />
              </>
            )}
            <Line label="Borrowings" value={borrowings} unit={unit} />
            {all && (
              <>
                <Line label={<Term k="FHLB advances">Home Loan Bank advances</Term>} value={a.fhlb} unit={unit} indent />
                <Line label={<Term k="fed funds purchased">Overnight borrowing</Term>} value={a.fedFundsPurchased} unit={unit} indent />
                <Line label={<Term k="subordinated debt">Subordinated debt</Term>} value={a.subDebt} unit={unit} indent />
                <Line label="Interest you owe" value={a.interestPayable} unit={unit} />
                <Line label="Other" value={a.otherLiabilities} unit={unit} />
              </>
            )}
            {!all && a.interestPayable + a.otherLiabilities !== 0 && <Line label="Everything else" value={a.interestPayable + a.otherLiabilities} unit={unit} />}
            <Line label={<Term k="liabilities">Total owed</Term>} value={totalLiabilities(a)} unit={unit} bold />
            <tr>
              <th colSpan={2} className="subhead">
                What is left for shareholders
              </th>
            </tr>
            <Line label="Money shareholders put in" value={a.commonStock} unit={unit} />
            <Line label="Profits kept in the bank" value={a.retainedEarnings} unit={unit} />
            {(all || a.aoci !== 0) && <Line label={<Term k="AOCI">Unrealized swings on bonds (AOCI)</Term>} value={a.aoci} unit={unit} />}
            <Line label={<Term k="equity">Capital (total equity)</Term>} value={totalEquity(a)} unit={unit} bold />
            <tr className="memo-row">
              <td>
                <Term k="leverage ratio">Leverage ratio</Term>
              </td>
              <td className="num">
                {pct(lev)} <Pill tone={cat === 'well' ? 'good' : cat === 'adequate' ? 'warn' : 'bad'}>{cat === 'well' ? 'well capitalized' : PCA_LABEL[cat]}</Pill>
              </td>
            </tr>
            <tr className="memo-row">
              <td>
                <Term k="tier 1 capital">Tier 1 capital</Term>
              </td>
              <td className="num">{dollars(tier1Capital(a), unit)}</td>
            </tr>
            <tr className="memo-row">
              <td>
                Shares outstanding and <Term k="book value">book value per share</Term>
              </td>
              <td className="num">
                {num(bank.shares)} at {bookValuePerShare(bank).toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="hint">
        <button className="btn small" onClick={() => setRegs((v) => !v)}>
          {regs ? 'Hide' : 'Show'} the regulators&apos; view
        </button>{' '}
        the capital ratios the examiners measure, the CAMELS rating, and any open findings.
      </p>
      {regs && <RegulationTables bank={bank} unit={unit} />}
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
      <table className="wrap">
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
            <td>
              <Term k="risk-weighted assets">Risk weighted assets</Term>
            </td>
            <td className="num">{dollars(stack.rwa, unit)}</td>
            <td></td>
            <td></td>
          </tr>
          <tr className={stack.cet1Ratio < 0.07 ? 'alert' : ''}>
            <td>
              <Term k="CET1">Common equity tier 1</Term>
            </td>
            <td className="num">{dollars(stack.cet1, unit)}</td>
            <td className="num">{pct(stack.cet1Ratio, 1)}</td>
            <td className="num">4.5% + 2.5% buffer</td>
          </tr>
          <tr>
            <td>
              <Term k="tier 1 capital">Tier 1</Term>
            </td>
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
            <td>
              <Term k="leverage ratio">Leverage</Term>
              {stack.cblr ? ' (community bank leverage ratio elected)' : ''}
            </td>
            <td></td>
            <td className="num">{pct(stack.leverage, 1)}</td>
            <td className="num">{stack.cblr ? '9.0%' : '4.0%'}</td>
          </tr>
          <tr className="total">
            <td>
              <Pill tone={stack.category === 'well' ? 'good' : stack.category === 'adequate' ? 'warn' : 'bad'}>{PCA_LABEL[stack.category]}</Pill>
            </td>
            <td colSpan={3} className="num">
              payout limit {pct(stack.maxPayout, 0)} of earnings{stack.bufferShortfall > 0 ? `, buffer short by ${pct(stack.bufferShortfall, 1)}` : ''}
            </td>
          </tr>
          <tr className={conc.construction > 1 || conc.cre > 3 ? 'alert' : 'memo-row'}>
            <td>
              <Term k="CRE concentration">Real estate concentration</Term>: construction / investor
            </td>
            <td colSpan={3} className="num">
              {pct(conc.construction, 0)} / {pct(conc.cre, 0)} of capital (guidance 100% / 300%)
            </td>
          </tr>
          {bank.stressTest && (
            <tr className={bank.stressTest.passed ? 'memo-row' : 'alert'}>
              <td>
                <Term k="stress test">Stress test</Term> {formatDate(bank.stressTest.day)}
              </td>
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
      <table className="wrap">
        <thead>
          <tr>
            <th>Supervision</th>
            <th className="num">rating</th>
          </tr>
        </thead>
        <tbody>
          <tr className={c.composite >= 3 ? 'alert' : ''}>
            <td>
              <Term k="CAMELS">CAMELS</Term> composite{c.lastExam !== null ? `, exam ${formatDate(c.lastExam)}` : ', not yet examined'}
            </td>
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

const IS_LINES: { label: React.ReactNode; get: (s: IncomeStatement) => number; bold?: boolean; indent?: boolean }[] = [
  { label: 'Interest on loans', get: (s) => s.interestLoans, indent: true },
  { label: 'Interest on bonds', get: (s) => s.interestSecurities, indent: true },
  { label: 'Interest on cash', get: (s) => s.interestCash, indent: true },
  { label: 'Total interest earned', get: interestIncome, bold: true },
  { label: 'Paid on checking', get: (s) => s.interestChecking, indent: true },
  { label: 'Paid on savings', get: (s) => s.interestSavings, indent: true },
  { label: 'Paid on money market', get: (s) => s.interestMmda, indent: true },
  { label: 'Paid on certificates', get: (s) => s.interestCd, indent: true },
  { label: 'Paid on brokered', get: (s) => s.interestBrokered, indent: true },
  { label: 'Paid on borrowings', get: (s) => s.interestBorrowings, indent: true },
  { label: 'Total interest paid', get: interestExpense, bold: true },
  { label: <Term k="net interest margin">Net interest income</Term>, get: netInterestIncome, bold: true },
  { label: <Term k="provision">Set aside for loans going bad (provision)</Term>, get: (s) => s.provision },
  { label: 'Fees', get: (s) => s.feeIncome },
  { label: 'Gains and losses on bonds sold', get: (s) => s.securitiesGains },
  { label: 'Salaries and benefits', get: (s) => s.salaries, indent: true },
  { label: 'Buildings', get: (s) => s.occupancy, indent: true },
  { label: 'Other costs', get: (s) => s.otherExpense, indent: true },
  { label: <Term k="FDIC assessment">Deposit insurance</Term>, get: (s) => s.assessment, indent: true },
  { label: 'Total running costs', get: noninterestExpense, bold: true },
  { label: 'Profit before tax', get: pretaxIncome, bold: true },
  { label: 'Income tax', get: (s) => s.tax },
  { label: 'Profit', get: netIncome, bold: true },
  { label: <Term k="charge-off">Memo: loans written off, net</Term>, get: (s) => s.chargeOffs - s.recoveries },
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
      <table className="wrap">
        <thead>
          <tr>
            <th>Income statement {unitLabel(unit)}</th>
            {cols.map((c) => (
              <th key={c.label} className="num">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {IS_LINES.map((l, i) => (
            <tr key={i} className={l.bold ? 'total' : ''}>
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
          <th>
            <Term k="call report">Call report</Term>
          </th>
          <th className="num">assets</th>
          <th className="num">loans</th>
          <th className="num">deposits</th>
          <th className="num">equity</th>
          <th className="num">leverage</th>
          <th className="num">profit</th>
          <th className="num">
            <Term k="return on assets">ROA</Term>
          </th>
          <th className="num">
            <Term k="net interest margin">NIM</Term>
          </th>
          <th className="num">
            <Term k="net charge-offs">NCO</Term>
          </th>
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

export function MeScreen({ world, onSalary, onPayout }: { world: World; onSalary: (annual: number) => void; onPayout: (ratio: number) => void }) {
  const p = world.player;
  const bank = world.playerBankId ? world.banks[world.playerBankId] : null;
  const stake = playerStake(world);
  const perShare = bank ? (bank.isPublic && bank.price !== null ? bank.price : bookValuePerShare(bank)) : 0;
  const stakeValue = bank ? Math.round(p.shares * perShare) : 0;
  const l = bank ? ladder(world) : null;
  const myAssets = bank ? totalAssets(bank.acct) : 0;
  return (
    <div>
      <p className="hint">
        Your own money: salary, dividends and your stake in the bank. <Term k="net worth">Net worth</Term> is the score; the ladder is the goal. Raising capital, selling shares and going public live under Money, balance sheet and capital.
      </p>
      {l && (
        <table className="wrap">
          <thead>
            <tr>
              <th>The ladder: America's banks by assets</th>
              <th className="num">assets</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>The largest bank in America</td>
              <td className="num">{l.largest ? usd(l.largest.assets) : ''}</td>
              <td className="dim">{l.largest && myAssets > 0 ? `${num(Math.round(l.largest.assets / myAssets))} times your size` : ''}</td>
            </tr>
            <tr>
              <td>The top 100</td>
              <td className="num">{usd(l.top100)}</td>
              <td className="dim">{l.rank <= 100 ? 'You are in it.' : `${usd(Math.max(0, l.top100 - myAssets))} to go`}</td>
            </tr>
            <tr>
              <td>Next to pass</td>
              <td className="num">{l.ahead ? usd(l.ahead.assets) : ''}</td>
              <td className="dim">{l.ahead ? `${l.ahead.name ?? 'a bank'} in ${l.ahead.state}: ${usd(Math.max(0, l.ahead.assets - myAssets))} to go` : 'Nobody. You are the largest.'}</td>
            </tr>
            <tr className="total">
              <td>You, {bank!.name}</td>
              <td className="num">{usd(myAssets)}</td>
              <td className="positive">#{num(l.rank)} of {num(l.total)} banks</td>
            </tr>
            <tr>
              <td>Just passed</td>
              <td className="num">{l.behind ? usd(l.behind.assets) : ''}</td>
              <td className="dim">{l.behind ? `${l.behind.name ?? 'a bank'} in ${l.behind.state}` : 'Nobody yet.'}</td>
            </tr>
            <tr className="memo-row">
              <td colSpan={3}>Other banks grow with the economy. Milestones fire at the top 1,000, 500, 250, 100, 50, 25, 10 and 5, and once more at the top.</td>
            </tr>
          </tbody>
        </table>
      )}
      <div className="cols">
        <div>
          <table className="wrap">
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
                <td>{bank?.isPublic ? 'Market value per share' : <Term k="book value">Book value per share</Term>}</td>
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
                  <Stepper value={p.salary} steps={[{ d: 1_000, label: '1K' }, { d: 10_000, label: '10K' }]} fmt={(v) => usd(v)} onChange={onSalary} min={0} max={1e8} />
                </td>
              </tr>
              <tr>
                <td>
                  <Term k="dividends">Dividend payout</Term>, share of quarterly profit
                </td>
                <td className="num">{bank ? pct(bank.dividendPayout, 0) : ''}</td>
                <td>{bank && <Stepper value={bank.dividendPayout} steps={[{ d: 0.01, label: '1%' }, { d: 0.1, label: '10%' }]} fmt={(v) => pct(v, 0)} onChange={onPayout} min={0} max={1} />}</td>
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
        </div>
        <div>
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
          <table className="wrap">
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
    <svg width={width} height={height} className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={pts.join(' ')} />
    </svg>
  );
}

export function HelpModal({ onClose, onNewWorld, onDebug }: { onClose: () => void; onNewWorld: () => void; onDebug: () => void }) {
  const rows: [string, string][] = [
    ['Overview', 'five gauges: capital, cash, loans, profit, growth; profit in plain words; what to do next'],
    ['Lending', 'your book with a health bar per loan type; the written policy and the dial; the pools'],
    ['Money', 'deposit rates a basis point at a time, cash and borrowing, bonds, the balance sheet and capital actions'],
    ['Earnings', 'the income statement, and where every dollar of the last quarter came from'],
    ['People', 'your three officers and this month’s candidates'],
    ['Market', 'every other bank, offers to buy them, business lines, and the world abroad'],
    ['Map', 'real counties; hover for numbers, open branches'],
    ['You', 'salary, dividends, your stake, your record'],
    ['Play and Pause, or space', 'start and stop the clock; Slow to Max, or keys 1 to 5, set the speed'],
    ['Decision buttons, or the key shown on them', 'answer a loan, an exam, an offer. Every decision says what it means first'],
    ['Underlined words', 'hover for a plain explanation'],
    ['Save, or s', 'save in this browser; the game also saves every year end'],
    ['Letters beside the tabs', 'keyboard shortcuts; Escape closes this'],
  ];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Help" onClick={(e) => e.stopPropagation()}>
        <h2>How to play</h2>
        <p className="hint">You are the CEO and controlling shareholder. Take deposits, make good loans, keep enough capital, keep depositors calm, and outlast the cycle. Everything is a click; the keys are shortcuts.</p>
        <table className="help-rows wrap">
          <thead>
            <tr>
              <th>Where</th>
              <th>what</th>
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
          <button className="btn" onClick={onDebug}>
            Debug screen
          </button>
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
                <td>
                  {onExport && (
                    <button className="btn" onClick={onExport}>
                      Export save
                    </button>
                  )}
                </td>
              </tr>
              <tr>
                <td>Load a world from a file</td>
                <td>{onImport && <input type="file" accept="application/json,.json" onChange={(e) => e.target.files && e.target.files[0] && onImport(e.target.files[0])} />}</td>
              </tr>
              <tr>
                <td>Throw this world away</td>
                <td>
                  {onNewWorld && (
                    <button className="btn danger" onClick={onNewWorld}>
                      Start a new world
                    </button>
                  )}
                </td>
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

export { short };
