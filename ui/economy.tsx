// Economy: where to lend, the cycle, and the sectors. Everything here is
// computed from state the player can already see and from the engine's
// own rules for who walks in and what goes bad. Nothing hidden is shown.

import { useState } from 'react';
import { SECTORS, type Sector } from '../data/types';
import { demandMix } from '../engine/borrowers';
import { TYPE, baseRate, expectedLossRate, macroStressFor } from '../engine/credit';
import { bankDepositRate } from '../engine/deposits';
import { sectorReturn12 } from '../engine/economy';
import { isActive } from '../engine/loans';
import { LOAN_TYPES, type LoanType, emptyByType } from '../engine/loantypes';
import { type Bank, type CountyState, type Regime, type World } from '../engine/state';
import { REGIME_DEMAND, arrivalRate } from '../engine/underwriting';
import { num, pct, usd } from './format';
import { Term } from './parts';
import { Sparkline } from './screens';

type Tab = 'lend' | 'cycle' | 'sectors';

export function EconomyScreen({ world, bank, onGo }: { world: World; bank: Bank; onGo: (tab: string) => void }) {
  const [tab, setTab] = useState<Tab>('lend');
  return (
    <div>
      <p className="hint">The market you lend into. Where to lend ranks every loan type by what it pays after the losses you should expect today; the cycle says what stage the economy is in and what that usually means for a bank; sectors show which industries are rising and falling, and how much of your market depends on each.</p>
      <div className="toolbar">
        <div className="seg">
          <button className={tab === 'lend' ? 'on' : ''} onClick={() => setTab('lend')}>
            Where to lend
          </button>
          <button className={tab === 'cycle' ? 'on' : ''} onClick={() => setTab('cycle')}>
            The cycle
          </button>
          <button className={tab === 'sectors' ? 'on' : ''} onClick={() => setTab('sectors')}>
            Sectors and your market
          </button>
        </div>
      </div>
      {tab === 'lend' && <WhereToLend world={world} bank={bank} onGo={onGo} />}
      {tab === 'cycle' && <Cycle world={world} />}
      {tab === 'sectors' && <Sectors world={world} bank={bank} />}
    </div>
  );
}

// The counties borrowers walk in from: every branch equally, or the home
// county alone.
function marketCounties(world: World, b: Bank): CountyState[] {
  const ids = b.branches.length > 0 ? b.branches.map((x) => x.county) : b.homeCounty ? [b.homeCounty] : [];
  return ids.map((id) => world.geo.counties[id]).filter((c): c is CountyState => !!c);
}

const READ: Record<LoanType, string> = {
  ci: 'Follows the national economy. Short, floating, the bread and butter of a business bank.',
  cre_oo: 'A business borrowing on its own building. Safer than investor property; follows local conditions.',
  cre_inv: 'Landlords. Follows home prices and the local economy; the second worst type in a bust.',
  construction: 'The most cyclical type: follows home prices one for one and loses the most when they fall.',
  resi: 'Home mortgages. The safest type and the longest; rate risk, not credit risk, is the danger.',
  consumer: 'Auto and personal loans. Follows unemployment; high rate, high loss when it defaults.',
  ag: 'Follows crop and land prices, not the national cycle. Only where farming is.',
  energy: 'Follows oil. Booms and busts on its own clock. Only where the oil is.',
  cards: 'Never walks in; comes from the card line on the Market tab. The highest rate and the highest loss.',
};

function WhereToLend({ world, bank, onGo }: { world: World; bank: Bank; onGo: (tab: string) => void }) {
  const e = world.economy;
  const counties = marketCounties(world, bank);
  const perDay = bank.homeCounty ? arrivalRate(world, bank) : 0;
  const mix = emptyByType(0);
  for (const c of counties) {
    const m = demandMix(c, bank);
    for (const t of LOAN_TYPES) mix[t] += m[t] / counties.length;
  }
  const cost = bankDepositRate(bank);
  // Your book by type: pools plus the relationship loans.
  const book = emptyByType(0);
  let bookTotal = 0;
  for (const p of bank.pools) {
    book[p.type] += p.balance;
    bookTotal += p.balance;
  }
  for (const l of bank.loans) {
    if (!isActive(l)) continue;
    book[l.type] += l.balance;
    bookTotal += l.balance;
  }
  // Everyone else's book, from their pools.
  const market = emptyByType(0);
  let marketTotal = 0;
  for (const id of world.bankOrder) {
    if (id === bank.id) continue;
    const r = world.banks[id];
    if (!r || r.status !== 'open') continue;
    for (const p of r.pools) {
      market[p.type] += p.balance;
      marketTotal += p.balance;
    }
  }
  const rows = LOAN_TYPES.map((t) => {
    const rate = baseRate(world, t);
    const macro = macroStressFor(world, bank, t);
    const loss = expectedLossRate(world, bank, t);
    const margin = rate - cost - loss;
    const n = perDay * 365 * mix[t];
    return { t, rate, macro, loss, margin, n, dollars: n * TYPE[t].avgSize, share: bookTotal > 0 ? book[t] / bookTotal : 0, mkt: marketTotal > 0 ? market[t] / marketTotal : 0 };
  }).sort((a, b) => b.margin - a.margin);
  const regimeWord = e.regime === 'late' ? 'late in the cycle' : e.regime === 'expansion' ? 'an expansion' : e.regime === 'recession' ? 'a recession' : 'a recovery';
  const demandNote = REGIME_DEMAND[e.regime];
  return (
    <div>
      {counties.length === 0 && (
        <p className="hint">
          No home market yet: nobody walks in, and the book grows only through the pooled book. Choose a market on the Map tab to see who would borrow there. The rates, loss environment and margins below still apply.
        </p>
      )}
      <table className="wrap">
        <thead>
          <tr>
            <th>Where to lend</th>
            <th className="num">borrowers a year</th>
            <th className="num">asking for</th>
            <th className="num">market rate</th>
            <th className="num">
              <Term k="loss environment">loss environment</Term>
            </th>
            <th className="num">
              <Term k="expected loss">expected loss</Term>
            </th>
            <th className="num">
              <Term k="margin after losses">margin after losses</Term>
            </th>
            <th className="num">your book</th>
            <th className="num">everyone else</th>
            <th>policy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.t} className={bank.policy.allowed[r.t] ? '' : 'dim'}>
              <td>
                <Term k={TYPE[r.t].label}>{TYPE[r.t].label}</Term>
              </td>
              <td className="num">{counties.length === 0 || r.t === 'cards' ? '' : num(r.n)}</td>
              <td className="num">{counties.length === 0 || r.t === 'cards' ? '' : usd(r.dollars)}</td>
              <td className="num">{pct(r.rate)}</td>
              <td className={'num ' + (r.macro < 1.25 ? 'positive' : r.macro < 2.5 ? '' : 'alert')}>{r.macro.toFixed(1)}x normal</td>
              <td className="num">{pct(r.loss)}</td>
              <td className={'num ' + (r.margin > 0.015 ? 'positive' : r.margin < 0 ? 'alert' : '')}>{pct(r.margin)}</td>
              <td className="num">{pct(r.share, 0)}</td>
              <td className="num">{pct(r.mkt, 0)}</td>
              <td>{bank.policy.allowed[r.t] ? 'on' : 'off'}</td>
            </tr>
          ))}
          <tr className="memo-row">
            <td colSpan={10}>
              Market rate is what a new loan of the type prices at today before the borrower's own premium. Expected loss is the default rate of your book in that type at today's stress, times what a default costs. Margin after losses takes off your cost of deposits ({pct(cost)}) and that loss; running costs come after. The bank pays more attention to the margin than to the rate.
              {counties.length > 0 && ` About ${num(perDay * 365)} borrowers a year walk into your ${counties.length === 1 ? 'branch' : `${counties.length} branches`}: ${demandNote > 1 ? `${pct(demandNote - 1, 0)} more than usual` : demandNote < 1 ? `${pct(1 - demandNote, 0)} fewer than usual` : 'the usual number'} because the economy is in ${regimeWord}. More branches, a bigger bank and a hungrier lending officer bring more.`}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="cols">
        <table className="wrap">
          <thead>
            <tr>
              <th>What each type follows</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {LOAN_TYPES.map((t) => (
              <tr key={t}>
                <td>{TYPE[t].label}</td>
                <td>{READ[t]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="wrap">
          <thead>
            <tr>
              <th>Playing the market</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Lend where the margin after losses is widest, not where the rate is highest. A 9% consumer loan that loses 3% a year earns less than a 6% owner occupied loan that loses nothing.</td>
            </tr>
            <tr>
              <td>The loss environment is the number to watch. It rises with unemployment, falling home prices and a falling sector, and it moves before charge-offs do. When it climbs past 2x in construction and investor CRE, the loans booked next are the ones that go bad.</td>
            </tr>
            <tr>
              <td>Everyone else's book tells you where the herd is. A type that everyone piles into late in the cycle is priced thin and underwritten loose. The types they leave in a recession are priced wide.</td>
            </tr>
            <tr>
              <td>
                Rates, loan to value and coverage are set on the{' '}
                <button className="btn small" onClick={() => onGo('LENDING')}>
                  Lending tab
                </button>{' '}
                under Policy and dial and the rate sheet.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const STAGE: Record<Regime, { name: string; means: string; next: string; play: string[] }> = {
  expansion: {
    name: 'Expansion',
    means: 'Growth near 2.5%, unemployment near 4%, home prices rising 4 to 5% a year, the Fed near 3%. Losses are low and borrowers plentiful.',
    next: 'Expansions run for years, then turn late: the Fed rises, the curve inverts, standards loosen.',
    play: [
      'Build the book in the types with the widest margin after losses.',
      'Keep the bond book short. Rates rise late in the cycle and long bonds bought now lose value.',
      'Do not follow rivals into construction and investor CRE. They hurt most when the turn comes.',
    ],
  },
  late: {
    name: 'Late cycle',
    means: 'The Fed near 4.75% and the curve inverted, unemployment at its lowest, home prices running 6% a year, inflation 3.5%. Standards loosen everywhere. The loans made now are the ones that go bad in the recession.',
    next: 'A recession follows within one to three years, sometimes a banking crisis with it. Occasionally the economy slips back into expansion instead.',
    play: [
      'Tighten policy: coverage, loan to value, guarantors. Turn the dial down so more crosses your desk.',
      'Keep cash and capital above the comfortable lines. The recession is when they are needed.',
      'Lock in certificates now, before rates fall. Long bonds bought now gain when the Fed cuts.',
    ],
  },
  recession: {
    name: 'Recession',
    means: 'Growth negative, unemployment toward 7%, home prices falling, the Fed cutting toward 0.75%. Losses peak now and for a year after. About a third fewer borrowers walk in.',
    next: 'Six months to two years, longer in a banking crisis. Then a recovery with losses fading over three years.',
    play: [
      'Provision early. The examiner is watching capital, and a thin allowance is a finding.',
      'Deposit rates can come down with the market; hold the gap small.',
      'Failed banks sell cheap. A strong bank buys its next decade of growth here.',
      'Keep lending to the survivors: recession vintages are the best loans a bank ever makes.',
    ],
  },
  recovery: {
    name: 'Recovery',
    means: 'Growth back near 2.5% but unemployment still high, the Fed low, the curve steep with long rates well above short. Losses fade over about three years.',
    next: 'One to three years, then expansion.',
    play: [
      'Carry is wide: long bonds and long loans funded by cheap deposits.',
      'Rebuild the book. Recovery loans season into the next expansion.',
      'Deals are still cheap, and weak rivals are still for sale.',
    ],
  },
};

function monthLabel(m: number): string {
  const y = 2024 + Math.floor(m / 12);
  const mo = (m % 12) + 1;
  return `${y}-${mo < 10 ? '0' : ''}${mo}`;
}

function Cycle({ world }: { world: World }) {
  const e = world.economy;
  const stage = STAGE[e.regime];
  const slope = e.curve.y10 - e.curve.y2;
  const u = e.hist.map((h) => h.unemployment);
  const hpi = e.hist.map((h) => h.hpi);
  const oil = e.hist.map((h) => h.oil);
  return (
    <div>
      <div className="cols">
        <table className="wrap">
          <thead>
            <tr>
              <th>
                The <Term k="cycle">cycle</Term>
              </th>
              <th className="num">now</th>
            </tr>
          </thead>
          <tbody>
            <tr className="total">
              <td>Stage</td>
              <td className="num">
                {stage.name}
                {e.crisis && e.regime === 'recession' ? ', banking crisis' : ''}, {e.regimeMonths} {e.regimeMonths === 1 ? 'month' : 'months'} in
              </td>
            </tr>
            <tr>
              <td>What it means</td>
              <td>{stage.means}</td>
            </tr>
            <tr>
              <td>What usually comes next</td>
              <td>{stage.next}</td>
            </tr>
            {stage.play.map((p, i) => (
              <tr key={i}>
                <td>{i === 0 ? 'What a bank does now' : ''}</td>
                <td>{p}</td>
              </tr>
            ))}
            <tr>
              <td>Recessions so far</td>
              <td>
                {e.recessions.length === 0
                  ? 'None yet.'
                  : e.recessions.map((r) => `${monthLabel(r.startMonth)} to ${r.endMonth === null ? 'now' : monthLabel(r.endMonth)}${r.crisis ? ' (banking crisis)' : ''}`).join('; ')}
              </td>
            </tr>
          </tbody>
        </table>
        <div>
          <table className="wrap">
            <thead>
              <tr>
                <th>Rates</th>
                <th className="num">now</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Term k="fed funds rate">Fed funds</Term>
                </td>
                <td className="num">{pct(e.fedFunds)}</td>
                <td className="dim">What overnight money costs. Cash earns about this; floating loans and deposits follow it.</td>
              </tr>
              <tr>
                <td>3 month</td>
                <td className="num">{pct(e.curve.m3)}</td>
                <td></td>
              </tr>
              <tr>
                <td>2 year</td>
                <td className="num">{pct(e.curve.y2)}</td>
                <td></td>
              </tr>
              <tr>
                <td>10 year</td>
                <td className="num">{pct(e.curve.y10)}</td>
                <td className="dim">Mortgages and commercial real estate price off this.</td>
              </tr>
              <tr>
                <td>30 year</td>
                <td className="num">{pct(e.curve.y30)}</td>
                <td></td>
              </tr>
              <tr className="total">
                <td>
                  <Term k="inverted curve">Curve</Term>
                </td>
                <td className={'num' + (slope < 0 ? ' alert' : '')}>{slope < 0 ? 'inverted' : slope < 0.005 ? 'flat' : 'steep'}</td>
                <td className="dim">
                  10 year less 2 year: {slope >= 0 ? '+' : ''}
                  {(slope * 100).toFixed(2)} pts. {slope < 0 ? 'Short money costs more than long. A recession has followed every inversion within two years.' : slope < 0.005 ? 'Little reward for lending long.' : 'Long loans and bonds pay well over short deposits.'}
                </td>
              </tr>
              <tr>
                <td>Fed funds, two years</td>
                <td colSpan={2}>
                  <Sparkline values={e.fedPath} width={260} height={28} />
                </td>
              </tr>
            </tbody>
          </table>
          <table className="wrap">
            <thead>
              <tr>
                <th>Jobs, prices, housing</th>
                <th className="num">now</th>
                <th>twelve months</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Unemployment</td>
                <td className={'num' + (e.unemployment > 0.06 ? ' alert' : '')}>{pct(e.unemployment, 1)}</td>
                <td>
                  <Sparkline values={u} width={200} height={24} /> <span className="dim">Above 4.5% every point adds stress to every loan type.</span>
                </td>
              </tr>
              <tr>
                <td>Growth</td>
                <td className={'num' + (e.gdpGrowth < 0 ? ' alert' : '')}>{pct(e.gdpGrowth, 1)}</td>
                <td className="dim">Real growth, annual rate. Business loans follow it.</td>
              </tr>
              <tr>
                <td>Inflation</td>
                <td className="num">{pct(e.inflation, 1)}</td>
                <td className="dim">Above 3% the Fed leans higher.</td>
              </tr>
              <tr>
                <td>Home prices, 12 months</td>
                <td className={'num' + (e.hpiGrowth < 0 ? ' alert' : '')}>{pct(e.hpiGrowth, 1)}</td>
                <td>
                  <Sparkline values={hpi} width={200} height={24} /> <span className="dim">Construction, investor CRE and mortgages follow this.</span>
                </td>
              </tr>
              <tr>
                <td>Oil</td>
                <td className="num">${e.oil.toFixed(0)}</td>
                <td>
                  <Sparkline values={oil} width={200} height={24} /> <span className="dim">Energy loans follow it. Busts come every seven years or so.</span>
                </td>
              </tr>
              <tr>
                <td>Stocks</td>
                <td className="num">{num(e.sp500)}</td>
                <td className="dim">Public bank shares move with it; so does the price of a deal.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const SECTOR_LABEL: Record<Sector, string> = {
  energy: 'Oil and gas',
  agriculture: 'Farming',
  manufacturing: 'Manufacturing',
  tech: 'Technology',
  finance: 'Finance',
  healthcare: 'Health care',
  government: 'Government',
  tourism: 'Tourism and leisure',
  construction: 'Construction and real estate',
  logistics: 'Transport and logistics',
  other: 'Everything else',
};

const SECTOR_MOVES: Record<Sector, string> = {
  energy: 'Oil first, the economy second. Feeds oil and gas loans.',
  agriculture: 'Its own weather and prices; barely follows the cycle. Feeds farm loans.',
  manufacturing: 'Swings hard with the economy. Feeds C&I.',
  tech: 'Swings hardest of all, with a strong long run drift. Feeds C&I.',
  finance: 'Follows the economy and home prices. Feeds C&I and office CRE.',
  healthcare: 'Steady growth through every cycle. Feeds C&I and owner occupied CRE.',
  government: 'Barely moves. Steady deposits, few loans.',
  tourism: 'Swings with the economy. Feeds C&I and hotels.',
  construction: 'Follows home prices more than one for one. Feeds construction and investor CRE.',
  logistics: 'Follows the economy. Feeds C&I.',
  other: 'Moves with the average.',
};

function Sectors({ world, bank }: { world: World; bank: Bank }) {
  const e = world.economy;
  const home = bank.homeCounty ? world.geo.counties[bank.homeCounty] : undefined;
  const local = home ? home.sectors : null;
  const national = world.geo.nationalShares;
  const rows = SECTORS.map((s) => ({ s, ret: sectorReturn12(e, s), mo: e.sectorMomentum[s], local: local ? (local[s] ?? 0) : null, nat: national ? (national[s] ?? 0) : null })).sort((a, b) => b.ret - a.ret);
  return (
    <div>
      <div className="cols">
        <table className="wrap">
          <thead>
            <tr>
              <th>Sectors</th>
              <th className="num">12 months</th>
              <th className="num">last month</th>
              <th className="num">{home ? 'your market' : 'your market'}</th>
              <th className="num">nation</th>
              <th>what moves it</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.s}>
                <td>{SECTOR_LABEL[r.s]}</td>
                <td className={'num ' + (r.ret > 0.02 ? 'positive' : r.ret < -0.02 ? 'alert' : '')}>{signedPct(r.ret)}</td>
                <td className={'num ' + (r.mo > 0.005 ? 'positive' : r.mo < -0.005 ? 'alert' : '')}>{signedPct(r.mo)}</td>
                <td className="num">{r.local === null ? '' : pct(r.local, 0)}</td>
                <td className="num">{r.nat === null ? '' : pct(r.nat, 0)}</td>
                <td className="dim">{SECTOR_MOVES[r.s]}</td>
              </tr>
            ))}
            <tr className="memo-row">
              <td colSpan={6}>A sector's move is its index of activity, 100 when the game began. Your market's share is the county's jobs in that sector from the real employment data; the nation's is the same across every county. A market heavy in a falling sector sees its loans go bad first and its deposits leave first.</td>
            </tr>
          </tbody>
        </table>
        {home ? (
          <table className="wrap">
            <thead>
              <tr>
                <th>Your home market</th>
                <th className="num">now</th>
              </tr>
            </thead>
            <tbody>
              <tr className="total">
                <td>County</td>
                <td className="num">
                  {home.name}, {home.state}
                </td>
              </tr>
              <tr>
                <td>People</td>
                <td className="num">{num(home.population)}</td>
              </tr>
              <tr>
                <td>Median household income</td>
                <td className="num">{usd(home.income)}</td>
              </tr>
              <tr>
                <td>Average wage</td>
                <td className="num">{usd(home.wage * 52)} a year</td>
              </tr>
              <tr>
                <td>Jobs</td>
                <td className="num">{num(home.employment)}</td>
              </tr>
              <tr>
                <td>Unemployment at the start</td>
                <td className="num">{home.unemployment === null ? 'not reported' : pct(home.unemployment / 100, 1)}</td>
              </tr>
              <tr>
                <td>Typical home</td>
                <td className="num">{home.homeValue === null ? 'not reported' : usd(home.homeValue)}</td>
              </tr>
              <tr>
                <td>Local conditions against the nation</td>
                <td className={'num ' + (home.condition > 101 ? 'positive' : home.condition < 99 ? 'alert' : '')}>{signedPct(Math.log(home.condition / 100))} since the start</td>
              </tr>
              <tr>
                <td>Local home prices against the nation</td>
                <td className={'num ' + (home.localHpi > e.hpi ? 'positive' : home.localHpi < e.hpi ? 'alert' : '')}>{signedPct(Math.log(home.localHpi / e.hpi))}</td>
              </tr>
              <tr>
                <td>Deposits the county supports</td>
                <td className="num">{usd(home.depositPool)}</td>
              </tr>
              {home.imputed && (
                <tr className="memo-row">
                  <td colSpan={2}>Some of this county's figures were filled in from its state because the source suppressed them.</td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="wrap">
            <thead>
              <tr>
                <th>Your home market</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="empty">No home county yet. Choose a market on the Map tab and this panel fills with its people, incomes, jobs and home prices.</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function signedPct(x: number): string {
  const s = `${(Math.abs(x) * 100).toFixed(1)}%`;
  return x < 0 ? `(${s})` : `+${s}`;
}
