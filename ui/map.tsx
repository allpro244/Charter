// The map: the one graphical surface (D38). US county outlines from the
// built GeoJSON, metro dots sized by real population, branch markers,
// county shading by sector exposure or condition. Hover shows real stats.

import { useEffect, useMemo, useState } from 'react';
import type { Sector } from '../data/types';
import { calibration } from '../data/calibration';
import { km } from '../engine/deposits';
import { branchFixedCost } from '../engine/state';
import { SECTORS } from '../data/types';
import type { Bank, CountyState, MetroState, World } from '../engine/state';
import type { GeoCollection } from './data';
import { HEIGHT, WIDTH, pathFor, projectPoint } from './projection';
import { num, pct, short, usd } from './format';

export type Shade = 'none' | 'share' | 'condition' | Sector;
export const SHADES: Shade[] = ['none', 'share', 'condition', ...SECTORS];

interface Props {
  world: World;
  geo: GeoCollection;
  mode: 'start' | 'play';
  shade: Shade;
  onShade?: (s: Shade) => void;
  selectedMetro: string | null;
  onSelectMetro: (cbsa: string) => void;
  onOpenBranch?: (fips: string) => void;
}

interface CountyPath {
  fips: string;
  name: string;
  state: string;
  d: string;
}

const SHADE_LABEL: Record<string, string> = { none: 'Plain', share: 'Your share', condition: 'Condition' };

export function MapView({ world, geo, mode, shade, onShade, selectedMetro, onSelectMetro, onOpenBranch }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  // A click pins a county so the mouse can leave the map for the button.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (!onOpenBranch || mode !== 'play') return;
    const h = (e: KeyboardEvent) => {
      const target = picked ?? hover;
      if (e.key.toLowerCase() === 'o' && target) onOpenBranch(target);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [hover, picked, onOpenBranch, mode]);
  const paths = useMemo<CountyPath[]>(
    () => geo.features.map((f) => ({ fips: f.properties.fips, name: f.properties.name, state: f.properties.state, d: pathFor(f.geometry, f.properties.state) })),
    [geo],
  );
  const metros = useMemo(() => Object.values(world.geo.metros).filter((m) => m.startable), [world.geo.metros]);
  const bank = world.playerBankId ? world.banks[world.playerBankId] : null;
  const shadeOf = (fips: string): string | undefined => {
    const c = world.geo.counties[fips];
    if (!c || shade === 'none') return undefined;
    let t: number;
    if (shade === 'share') {
      // Your deposits in the county against its pool, on a log scale: a
      // tenth of a percent shows, a tenth of the county is a full shade.
      const held = bank ? bank.branches.filter((br) => br.county === fips).reduce((s, br) => s + br.deposits, 0) : 0;
      const share = c.depositPool > 0 ? held / c.depositPool : 0;
      if (share <= 0) return undefined;
      const t = Math.min(1, Math.log10(1 + share * 1000) / 2);
      return `rgba(76,201,138,${(0.3 + 0.55 * t).toFixed(2)})`;
    }
    if (shade === 'condition') t = Math.max(-1, Math.min(1, (c.condition - 100) / 15));
    else t = Math.min(1, (c.sectors[shade] ?? 0) / 0.3);
    if (shade === 'condition') return t >= 0 ? `rgba(58,208,122,${(t * 0.7).toFixed(2)})` : `rgba(255,92,58,${(-t * 0.7).toFixed(2)})`;
    return `rgba(213,216,220,${(t * 0.6).toFixed(2)})`;
  };
  const hovered = hover ? world.geo.counties[hover] : undefined;
  const pinned = picked ? world.geo.counties[picked] : undefined;
  const mine = new Set((bank?.branches ?? []).map((br) => br.county));
  const shown = pinned ?? hovered;
  const empty = paths.length === 0;
  return (
    <div className="mapwrap">
      {mode === 'play' && <p className="hint">Real counties. Hover one for its numbers, click it to pin it, then open a branch there to gather its deposits and meet its borrowers. Shade the map by your share of each county's deposits, by a sector's share of jobs, or by how each county is doing.</p>}
      {empty && <p className="hint">This build has no county map: the playtest bank has no home town. The map fills in once the county data is built.</p>}
      {onShade && !empty && (
        <div className="toolbar">
          <span className="seg-label">Shade by</span>
          <div className="seg">
            {SHADES.map((s) => (
              <button key={s} className={shade === s ? 'on' : ''} onClick={() => onShade(s)}>
                {SHADE_LABEL[s] ?? s}
              </button>
            ))}
          </div>
        </div>
      )}
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="map" role="img" aria-label="United States counties">
        <g>
          {paths.map((p) => (
            <path
              key={p.fips}
              d={p.d}
              className={'county' + (hover === p.fips || picked === p.fips ? ' hover' : '') + (mine.has(p.fips) ? ' mine' : '')}
              style={shade !== 'none' ? { fill: shadeOf(p.fips) } : undefined}
              onMouseEnter={() => setHover(p.fips)}
              onMouseLeave={() => setHover((h) => (h === p.fips ? null : h))}
              onClick={() => {
                const c = world.geo.counties[p.fips];
                if (mode === 'play') setPicked((cur) => (cur === p.fips ? null : p.fips));
                else if (c?.cbsa && world.geo.metros[c.cbsa]?.startable) onSelectMetro(c.cbsa);
              }}
            />
          ))}
        </g>
        <g>
          {metros.map((m) => {
            const c = principal(world, m);
            if (!c) return null;
            const [x, y] = projectPoint(c.centroid[0], c.centroid[1], c.state);
            const r = Math.max(1.5, Math.sqrt(m.population / 1e6) * 4);
            const sel = selectedMetro === m.cbsa;
            return (
              <circle
                key={m.cbsa}
                cx={x}
                cy={y}
                r={r}
                className={'metro' + (sel ? ' selected' : '') + (mode === 'start' ? ' startable' : '')}
                onClick={() => onSelectMetro(m.cbsa)}
              >
                <title>{`${m.name}: ${num(m.population)}`}</title>
              </circle>
            );
          })}
        </g>
        {bank && <BranchMarkers world={world} bank={bank} />}
        {Object.values(world.banks)
          .filter((b) => b.kind === 'rival' && b.status === 'open' && b.homeCounty)
          .map((b) => {
            const c = world.geo.counties[b.homeCounty as string];
            if (!c) return null;
            const [x, y] = projectPoint(c.centroid[0], c.centroid[1], c.state);
            return <rect key={b.id} x={x - 1.5} y={y - 1.5} width={3} height={3} className="rival"><title>{b.name}</title></rect>;
          })}
      </svg>
      <div className="maphover">
        {shown ? <CountyStats c={shown} world={world} /> : !empty && <span className="dim">hover a county for its real statistics{mode === 'start' ? '; click a green metro to start there' : '; click one to pin it'}</span>}
        {shown && mode === 'play' && onOpenBranch && (
          <span>
            <button className="btn primary" onClick={() => onOpenBranch(shown.fips)}>
              Open a branch in {shown.name}
            </button>{' '}
            {pinned && (
              <button className="btn small" onClick={() => setPicked(null)}>
                Unpin
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function principal(world: World, m: MetroState): CountyState | null {
  let best: CountyState | null = null;
  for (const f of m.counties) {
    const c = world.geo.counties[f];
    if (c && (!best || c.population > best.population)) best = c;
  }
  return best;
}

function BranchMarkers({ world, bank }: { world: World; bank: Bank }) {
  return (
    <g>
      {bank.branches.map((br) => {
        const c = world.geo.counties[br.county];
        if (!c) return null;
        const [x, y] = projectPoint(c.centroid[0], c.centroid[1], c.state);
        return (
          <g key={br.id} className="branch">
            <line x1={x - 4} y1={y} x2={x + 4} y2={y} />
            <line x1={x} y1={y - 4} x2={x} y2={y + 4} />
            <title>{`${bank.name} branch, ${c.name}: ${short(br.deposits)} deposits`}</title>
          </g>
        );
      })}
    </g>
  );
}

// What a branch in this county would be worth: the de novo ceiling of the
// county's pool, faded by distance from home and capped by what one branch
// can gather, against the real local cost of running it.
function branchCase(c: CountyState, world: World): { deposits: number; cost: number; distanceKm: number; existing: number } | null {
  const bank = world.playerBankId ? world.banks[world.playerBankId] : null;
  if (!bank) return null;
  const home = bank.homeCounty ? world.geo.counties[bank.homeCounty] : null;
  const distanceKm = home ? km(home.centroid, c.centroid) : 0;
  const ceiling = calibration.deNovoShareCeiling.typical / 100;
  const wageIndex = Math.max(0.5, Math.min(2, c.wage / 1300));
  const perBranch = calibration.depositsPerBranch.typical * 1e6 * wageIndex;
  const deposits = Math.round(Math.min(c.depositPool * ceiling * Math.exp(-distanceKm / 1500), perBranch));
  return { deposits, cost: branchFixedCost(c), distanceKm, existing: bank.branches.filter((br) => br.county === c.fips).length };
}

function CountyStats({ c, world }: { c: CountyState; world: World }) {
  const top = SECTORS.map((s) => [s, c.sectors[s] ?? 0] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  const metro = c.cbsa ? world.geo.metros[c.cbsa] : undefined;
  const branch = branchCase(c, world);
  return (
    <table className="stats">
      <tbody>
        <tr>
          <th colSpan={2}>
            {c.name}, {c.state}
            {metro ? ` (${metro.name}${metro.startable ? ', startable' : ''})` : ''}
            {c.imputed ? ' [imputed cells]' : ''}
          </th>
        </tr>
        {branch && (
          <tr className="total">
            <td>{branch.existing > 0 ? `your branch here (${branch.existing})` : 'a branch here'}</td>
            <td className="num">
              about {usd(branch.deposits)} of deposits in 3 years, {usd(branch.cost)} a year to run{branch.distanceKm > 0 ? `, ${Math.round(branch.distanceKm)} km from home` : ''}
            </td>
          </tr>
        )}
        <tr><td>population</td><td className="num">{num(c.population)}</td></tr>
        <tr><td>median household income</td><td className="num">{num(c.income)}</td></tr>
        <tr><td>average weekly wage</td><td className="num">{num(c.wage)}</td></tr>
        <tr><td>employment</td><td className="num">{num(c.employment)}</td></tr>
        <tr><td>unemployment</td><td className="num">{c.unemployment === null ? 'n/a' : pct(c.unemployment, 1)}</td></tr>
        <tr><td>median home value</td><td className="num">{c.homeValue === null ? 'n/a' : num(c.homeValue)}</td></tr>
        <tr><td>deposit pool</td><td className="num">{short(c.depositPool)}</td></tr>
        <tr><td>condition</td><td className="num">{c.condition.toFixed(1)}</td></tr>
        <tr><td>local home prices</td><td className="num">{c.localHpi.toFixed(1)}</td></tr>
        {top.map(([s, v]) => (
          <tr key={s}><td>{s}</td><td className="num">{pct(v, 1)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
