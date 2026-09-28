// Start flow (D4, D39): pick a metro, then charter or take over.

import { useMemo, useState } from 'react';
import type { WorldData } from '../data/types';
import type { World } from '../engine/state';
import { charterTerms, metroProfile, describeCandidate, seedsForMetro, startableMetros, takeoverCandidates, type TakeoverCandidate } from '../engine/start';
import { num, pct, short, usd } from './format';

interface Props {
  world: World;
  data: WorldData;
  selectedMetro: string | null;
  onSelectMetro: (cbsa: string) => void;
  onCharter: (cbsa: string, name: string, invest: number) => void;
  onTakeover: (cbsa: string, c: TakeoverCandidate) => void;
}

export function StartPanel({ world, data, selectedMetro, onSelectMetro, onCharter, onTakeover }: Props) {
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<'pick' | 'charter' | 'takeover'>('pick');
  const [name, setName] = useState('');
  const [invest, setInvest] = useState<number | null>(null);
  const metros = useMemo(() => startableMetros(world), [world]);
  const shown = metros.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase())).slice(0, 40);
  const metro = selectedMetro ? world.geo.metros[selectedMetro] : undefined;
  const terms = metro ? charterTerms(world, metro) : null;
  const candidates = useMemo(
    () => (metro ? takeoverCandidates(world, metro, seedsForMetro(world, metro)) : []),
    [world, metro, data],
  );
  const cash = world.player.cash;
  // Profiles for the rows shown and the metro picked (D75).
  const profiles = useMemo(() => new Map(shown.map((m) => [m.cbsa, metroProfile(world, m)])), [world, filter]);
  const profile = useMemo(() => (metro ? metroProfile(world, metro) : null), [world, metro]);
  return (
    <div className="start">
      {!metro && (
        <div>
          <h2 style={{ margin: '0 0 6px' }}>Where will you start?</h2>
          <p className="hint">Start with a small bank in any major American city. Click a green metro on the map or pick one below. You have {short(cash)} of your own money to put in.</p>
          {world.geo.bankData === 'generated' && <p className="hint">Every county's people, incomes, jobs and home prices are real. The rival banks are generated from national bands until the FDIC list can be downloaded; their sizes and counts are plausible, not the real ones.</p>}
          <input className="filter" placeholder="filter metros" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
          <table>
            <thead>
              <tr>
                <th>rank</th>
                <th>metro</th>
                <th className="num">population</th>
                <th className="num">median income</th>
                <th>rides on</th>
                <th className="num">charter raise</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const pr = profiles.get(m.cbsa);
                const top = pr?.leaning[0];
                return (
                  <tr key={m.cbsa} className="row" onClick={() => onSelectMetro(m.cbsa)}>
                    <td className="num">{m.rank}</td>
                    <td>{m.name}</td>
                    <td className="num">{num(m.population)}</td>
                    <td className="num">{pr ? usd(pr.income) : ''}</td>
                    <td className="dim">{top ? `${top.sector}, ${pct(top.share, 0)} of jobs` : 'a mixed economy'}</td>
                    <td className="num">{usd(charterTerms(world, m).raise)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {metro && terms && mode === 'pick' && (
        <div>
          <h2 style={{ margin: '0 0 6px' }}>{metro.name}</h2>
          <p className="hint">
            Population {num(metro.population)}, rank {metro.rank} among American metros.{' '}
            <button className="btn small" onClick={() => onSelectMetro('')}>
              Change metro
            </button>
          </p>
          {profile && (
            <table className="wrap">
              <thead>
                <tr>
                  <th>{metro.principalCity} as a place to start a bank</th>
                  <th className="num"></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Median household income</td>
                  <td className="num">{usd(profile.income)}</td>
                  <td className="dim">average weekly wage {usd(profile.wage)}; your branches' running cost follows it</td>
                </tr>
                <tr>
                  <td>Median home value</td>
                  <td className="num">{profile.homeValue ? usd(profile.homeValue) : 'n/a'}</td>
                  <td className="dim">sets mortgage sizes and the collateral behind them</td>
                </tr>
                <tr>
                  <td>Unemployment</td>
                  <td className="num">{profile.unemployment !== null ? pct(profile.unemployment, 1) : 'n/a'}</td>
                  <td className="dim">consumer and household loans follow it</td>
                </tr>
                {profile.leaning.length === 0 && (
                  <tr>
                    <td>Rides on</td>
                    <td className="num">a mixed economy</td>
                    <td className="dim">no industry holds much more of the jobs here than of the nation's: no single shock hits the whole book</td>
                  </tr>
                )}
                {profile.leaning.map((l) => (
                  <tr key={l.sector}>
                    <td>Rides on {l.sector}</td>
                    <td className="num">{pct(l.share, 0)} of jobs</td>
                    <td className="dim">{`${l.times.toFixed(1)} times the nation's share: when ${l.sector} turns, your borrowers turn with it`}</td>
                  </tr>
                ))}
                <tr>
                  <td>Deposits in the market</td>
                  <td className="num">{usd(profile.depositPool)}</td>
                  <td className="dim">what the metro's bank offices gathered locally</td>
                </tr>
                <tr>
                  <td>Banks based here</td>
                  <td className="num">{num(profile.banks)}</td>
                  <td className="dim">{profile.smallest !== null ? `the smallest has ${usd(profile.smallest)} of assets` : 'none; the market is served from elsewhere'}</td>
                </tr>
              </tbody>
            </table>
          )}
          <table>
            <thead>
              <tr>
                <th>How will you start?</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr className="row" onClick={() => setMode('charter')}>
                <td>
                  <button className="btn primary">Charter a new bank</button>
                  <div className="dim">Start from nothing with your investors' money. A slow first year: deposits come in as the town gets to know you, and every loan is yours to make.</div>
                </td>
                <td className="dim">raise {short(terms.raise)}; you put in {short(terms.minInvest)} to {short(terms.maxInvest)} and run it from day one</td>
              </tr>
              <tr className="row" onClick={() => setMode('takeover')}>
                <td>
                  <button className="btn">Take over an existing bank</button>
                  <div className="dim">Buy control of a running bank: a book of loans, deposits, officers and someone else's problems from day one. The busier start.</div>
                </td>
                <td className="dim">buy a control stake in one of {candidates.length} banks for sale here; {candidates.filter((c) => c.price <= world.player.cash).length === 0 ? 'none within reach of your cash' : `${candidates.filter((c) => c.price <= world.player.cash).length} within reach of your cash`}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {metro && terms && mode === 'charter' && (
        <div>
          <p className="hint">
            Charter in {metro.name}. Total raise {short(terms.raise)} at ${terms.sharePrice} a share. Outside organizers take the rest and stay passive.
          </p>
          <table>
            <tbody>
              <tr>
                <td>bank name</td>
                <td>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${metro.principalCity} Bank`} />
                </td>
              </tr>
              <tr>
                <td>your investment</td>
                <td>
                  <input
                    type="number"
                    min={terms.minInvest}
                    max={terms.maxInvest}
                    step={100_000}
                    value={invest ?? terms.maxInvest}
                    onChange={(e) => setInvest(Number(e.target.value))}
                  />{' '}
                  = {(((invest ?? terms.maxInvest) / terms.raise) * 100).toFixed(0)}% of the shares
                </td>
              </tr>
            </tbody>
          </table>
          <p>
            <button className="btn primary" onClick={() => onCharter(metro.cbsa, name || `${metro.principalCity} Bank`, invest ?? terms.maxInvest)}>
              Open the doors
            </button>{' '}
            <button className="btn" onClick={() => setMode('pick')}>
              Back
            </button>
          </p>
        </div>
      )}
      {metro && mode === 'takeover' && (
        <div>
          <p className="hint">Banks for sale in {metro.name}. A control stake is 30% of the shares. You have {short(cash)}. Click a bank you can afford to buy it.</p>
          <table>
            <thead>
              <tr>
                <th>Banks for sale</th>
                <th>bank</th>
                <th>home</th>
                <th className="num">assets</th>
                <th className="num">deposits</th>
                <th className="num">equity</th>
                <th className="num">leverage</th>
                <th className="num">criticized</th>
                <th className="num">price</th>
                <th className="num">to book</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.key} className={'row' + (c.price > cash ? ' dim' : '')} onClick={() => c.price <= cash && onTakeover(metro.cbsa, c)}>
                  <td>{c.key}</td>
                  <td>{c.name}</td>
                  <td>{world.geo.counties[c.county]?.name ?? c.county}{metro.counties.includes(c.county) ? '' : ', near the city'}</td>
                  <td className="num">{short(c.assets)}</td>
                  <td className="num">{short(c.deposits)}</td>
                  <td className="num">{short(c.equity)}</td>
                  <td className="num">{(c.leverage * 100).toFixed(1)}%</td>
                  <td className="num">{(c.criticizedShare * 100).toFixed(1)}%</td>
                  <td className="num">{short(c.price)}</td>
                  <td className="num">{(c.premiumToBook * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {candidates.length > 0 && candidates.every((c) => c.price > cash) && (
            <p className="hint alert">
              No bank in or near {metro.name} is small enough for your {short(cash)}: the cheapest control stake here costs {short(Math.min(...candidates.map((c) => c.price)))}. Charter a new bank here, or pick a smaller city where small banks still trade.
            </p>
          )}
          {candidates.map((c) => (
            <pre key={c.key} className="memo">
              {describeCandidate(c).join('\n')}
            </pre>
          ))}
          <p>
            <button className="btn" onClick={() => setMode('pick')}>
              Back
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
