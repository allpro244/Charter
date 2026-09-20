// Start flow (D4, D39): pick a metro, then charter or take over.

import { useMemo, useState } from 'react';
import type { WorldData } from '../data/types';
import type { World } from '../engine/state';
import { charterTerms, describeCandidate, seedsForMetro, startableMetros, takeoverCandidates, type TakeoverCandidate } from '../engine/start';
import { num, short } from './format';

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
                <th className="num">charter raise</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.cbsa} className="row" onClick={() => onSelectMetro(m.cbsa)}>
                  <td className="num">{m.rank}</td>
                  <td>{m.name}</td>
                  <td className="num">{num(m.population)}</td>
                  <td className="num">{short(charterTerms(world, m).raise)}</td>
                </tr>
              ))}
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
                <td className="dim">buy a control stake in one of {candidates.length} banks for sale here</td>
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
