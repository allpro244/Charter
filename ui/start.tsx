// Start flow (D4, D39): pick a metro, then charter or take over.

import { useMemo, useState } from 'react';
import type { WorldData } from '../data/types';
import type { World } from '../engine/state';
import { charterTerms, describeCandidate, startableMetros, takeoverCandidates, type TakeoverCandidate } from '../engine/start';
import { num, short } from './format';

interface Props {
  world: World;
  data: WorldData;
  selectedMetro: string | null;
  onSelectMetro: (cbsa: string) => void;
  onCharter: (cbsa: string, name: string, invest: number) => void;
  onTakeover: (cbsa: string, c: TakeoverCandidate) => void;
  hasSave: boolean;
  onContinue: () => void;
}

export function StartPanel({ world, data, selectedMetro, onSelectMetro, onCharter, onTakeover, hasSave, onContinue }: Props) {
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<'pick' | 'charter' | 'takeover'>('pick');
  const [name, setName] = useState('');
  const [invest, setInvest] = useState<number | null>(null);
  const metros = useMemo(() => startableMetros(world), [world]);
  const shown = metros.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase())).slice(0, 40);
  const metro = selectedMetro ? world.geo.metros[selectedMetro] : undefined;
  const terms = metro ? charterTerms(world, metro) : null;
  const candidates = useMemo(
    () => (metro ? takeoverCandidates(world, metro, data.banksByState[metro.state] ?? []) : []),
    [world, metro, data],
  );
  const cash = world.player.cash;
  return (
    <div className="start">
      <header className="bar">
        <span className="title">CHARTER</span>
        <span className="status">
          {hasSave && (
            <button className="key" onClick={onContinue}>
              continue saved game
            </button>
          )}
          founder cash {short(cash)}
        </span>
      </header>
      {!metro && (
        <div>
          <p>Start with a small bank in any major American city. Click a metro on the map or pick one below.</p>
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
          <p>
            {metro.name}: population {num(metro.population)}, rank {metro.rank}.{' '}
            <button className="key" onClick={() => onSelectMetro('')}>
              change
            </button>
          </p>
          <table>
            <tbody>
              <tr className="row" onClick={() => setMode('charter')}>
                <td>c</td>
                <td>Charter a new bank</td>
                <td>raise {short(terms.raise)}, you put in {short(terms.minInvest)} to {short(terms.maxInvest)}</td>
              </tr>
              <tr className="row" onClick={() => setMode('takeover')}>
                <td>t</td>
                <td>Take over an existing bank</td>
                <td>buy a control stake in one of {candidates.length} banks for sale</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {metro && terms && mode === 'charter' && (
        <div>
          <p>
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
            <button className="key" onClick={() => onCharter(metro.cbsa, name || `${metro.principalCity} Bank`, invest ?? terms.maxInvest)}>
              enter: open the doors
            </button>{' '}
            <button className="key" onClick={() => setMode('pick')}>
              esc: back
            </button>
          </p>
        </div>
      )}
      {metro && mode === 'takeover' && (
        <div>
          <p>Banks for sale in {metro.name}. A control stake is 30% of the shares. You have {short(cash)}.</p>
          <table>
            <thead>
              <tr>
                <th>key</th>
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
            <button className="key" onClick={() => setMode('pick')}>
              esc: back
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
