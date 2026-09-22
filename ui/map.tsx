// The map: the one graphical surface (D38). US county outlines from the
// built GeoJSON, metro dots sized by real population, branch markers,
// county shading by sector exposure or condition. Hover shows real stats.

import { useMemo, useState } from 'react';
import type { Sector } from '../data/types';
import { type BranchCase, branchCandidates, branchCase, branchOpenCheck, rivalBranches } from '../engine/deposits';
import { SECTORS } from '../data/types';
import type { Bank, CountyState, MetroState, World } from '../engine/state';
import type { GeoCollection } from './data';
import { HEIGHT, WIDTH, bboxFor, pathFor, projectPoint } from './projection';
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
  box: [number, number, number, number];
}

const SHADE_LABEL: Record<string, string> = { none: 'Plain', share: 'Your share', condition: 'Condition' };

export function MapView({ world, geo, mode, shade, onShade, selectedMetro, onSelectMetro, onOpenBranch }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  // A click pins a county so the mouse can leave the map for the button.
  const [picked, setPicked] = useState<string | null>(null);
  const paths = useMemo<CountyPath[]>(
    () => geo.features.map((f) => ({ fips: f.properties.fips, name: f.properties.name, state: f.properties.state, d: pathFor(f.geometry, f.properties.state), box: bboxFor(f.geometry, f.properties.state) })),
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
  // Zoom: the whole country, or one state (the pinned county's, else home).
  const [zoom, setZoom] = useState<'us' | 'state'>('us');
  const focusState = pinned?.state ?? bank?.state ?? null;
  const stateBox = useMemo(() => {
    if (!focusState) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of paths) {
      if (p.state !== focusState) continue;
      if (p.box[0] < x0) x0 = p.box[0];
      if (p.box[1] < y0) y0 = p.box[1];
      if (p.box[2] > x1) x1 = p.box[2];
      if (p.box[3] > y1) y1 = p.box[3];
    }
    if (!Number.isFinite(x0)) return null;
    const padX = Math.max(4, (x1 - x0) * 0.06);
    const padY = Math.max(4, (y1 - y0) * 0.06);
    return { x: x0 - padX, y: y0 - padY, w: x1 - x0 + 2 * padX, h: y1 - y0 + 2 * padY };
  }, [paths, focusState]);
  const zoomed = zoom === 'state' && stateBox !== null && mode === 'play';
  const viewBox = zoomed && stateBox ? `${stateBox.x.toFixed(1)} ${stateBox.y.toFixed(1)} ${stateBox.w.toFixed(1)} ${stateBox.h.toFixed(1)}` : `0 0 ${WIDTH} ${HEIGHT}`;
  // Marks shrink with the zoom so they stay the size they are on the country map.
  const k = zoomed && stateBox ? Math.max(1, Math.min(WIDTH / stateBox.w, HEIGHT / stateBox.h)) : 1;
  return (
    <div className="mapwrap">
      {mode === 'play' && <p className="hint">Real counties. Hover one for its numbers and click it to pin it; a city dot stands for its metro, so hovering or clicking it shows the metro's main county and every county in the metro below. The list under the map ranks where a new branch would earn the most; open one there, from the metro's counties, or from a pinned county's card. Shade the map by your share of each county's deposits, by a sector's share of jobs, or by how each county is doing.</p>}
      {empty && <p className="hint">This build has no county map: the playtest bank has no home town. The map fills in once the county data is built.</p>}
      {mode === 'play' && !empty && focusState && (
        <div className="toolbar">
          <span className="seg-label">Zoom</span>
          <div className="seg">
            <button className={zoom === 'us' ? 'on' : ''} onClick={() => setZoom('us')}>
              Whole country
            </button>
            <button className={zoom === 'state' ? 'on' : ''} onClick={() => setZoom('state')}>
              {world.geo.states[focusState]?.name ?? focusState}
            </button>
          </div>
          <span className="dim">{zoomed ? 'Pin a county in another state to zoom there.' : 'Zoom in to pick a small county.'}</span>
        </div>
      )}
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
      <svg viewBox={viewBox} className="map" role="img" aria-label="United States counties">
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
            const r = Math.max(1.5, Math.sqrt(m.population / 1e6) * 4) / k;
            const sel = selectedMetro === m.cbsa;
            return (
              <circle
                key={m.cbsa}
                cx={x}
                cy={y}
                r={r}
                className={'metro' + (sel ? ' selected' : '') + (mode === 'start' ? ' startable' : '')}
                onMouseEnter={() => mode === 'play' && setHover(c.fips)}
                onMouseLeave={() => mode === 'play' && setHover((h) => (h === c.fips ? null : h))}
                onClick={() => (mode === 'play' ? setPicked((cur) => (cur === c.fips ? null : c.fips)) : onSelectMetro(m.cbsa))}
              >
                <title>{`${m.name}: ${num(m.population)}`}</title>
              </circle>
            );
          })}
        </g>
        {bank && <BranchMarkers world={world} bank={bank} k={k} onHover={(f) => mode === 'play' && setHover(f)} onLeave={(f) => mode === 'play' && setHover((h) => (h === f ? null : h))} onPick={(f) => mode === 'play' && setPicked((cur) => (cur === f ? null : f))} />}
        {Object.values(world.banks)
          .filter((b) => b.kind === 'rival' && b.status === 'open' && b.homeCounty)
          .map((b) => {
            const c = world.geo.counties[b.homeCounty as string];
            if (!c) return null;
            const [x, y] = projectPoint(c.centroid[0], c.centroid[1], c.state);
            return (
              <rect
                key={b.id}
                x={x - 1.5 / k}
                y={y - 1.5 / k}
                width={3 / k}
                height={3 / k}
                className="rival"
                onMouseEnter={() => mode === 'play' && setHover(c.fips)}
                onMouseLeave={() => mode === 'play' && setHover((h) => (h === c.fips ? null : h))}
                onClick={() => mode === 'play' && setPicked((cur) => (cur === c.fips ? null : c.fips))}
              >
                <title>{`${b.name}, ${c.name}`}</title>
              </rect>
            );
          })}
      </svg>
      <div className="maphover">
        {shown ? <CountyStats c={shown} world={world} /> : !empty && <span className="dim">hover a county for its real statistics{mode === 'start' ? '; click a green metro to start there' : '; click one to pin it'}</span>}
        {shown && mode === 'play' && onOpenBranch && <OpenButton world={world} c={shown} pinned={!!pinned} onOpenBranch={onOpenBranch} onUnpin={() => setPicked(null)} />}
      </div>
      {mode === 'play' && bank && !empty && onOpenBranch && shown?.cbsa && <MetroCounties world={world} bank={bank} cbsa={shown.cbsa} picked={picked} onPick={setPicked} onOpenBranch={onOpenBranch} />}
      {mode === 'play' && bank && !empty && onOpenBranch && <WhereToOpen world={world} bank={bank} picked={picked} onPick={setPicked} onOpenBranch={onOpenBranch} />}
    </div>
  );
}

function OpenButton({ world, c, pinned, onOpenBranch, onUnpin }: { world: World; c: CountyState; pinned: boolean; onOpenBranch: (fips: string) => void; onUnpin: () => void }) {
  const check = branchOpenCheck(world, c);
  return (
    <span>
      <button className="btn primary" disabled={!check.ok} title={check.reason ?? `${usd(check.premises)} of cash becomes premises today`} onClick={() => onOpenBranch(c.fips)}>
        Open a branch in {c.name} for {usd(check.premises)}
      </button>{' '}
      {!check.ok && <span className="dim">{check.reason}</span>}{' '}
      {pinned && (
        <button className="btn small" onClick={onUnpin}>
          Unpin
        </button>
      )}
    </span>
  );
}

// Where a new branch would earn the most (D55): the ten best counties by a
// mature year's margin on deposits less the cost of running the branch,
// recomputed monthly and when the branch list changes.
function WhereToOpen({ world, bank, picked, onPick, onOpenBranch }: { world: World; bank: Bank; picked: string | null; onPick: (fips: string | null) => void; onOpenBranch: (fips: string) => void }) {
  const month = Math.floor(world.day / 30);
  const branches = bank.branches.length;
  const cands = useMemo(() => branchCandidates(world, bank, 10), [world, bank, month, branches]);
  if (cands.length === 0) return null;
  return (
    <CandidateTable
      world={world}
      title="Where to open next"
      cands={cands}
      picked={picked}
      onPick={onPick}
      onOpenBranch={onOpenBranch}
      footer={`Ranked by a mature year's earnings against the banks already there: your margin (${pct(cands[0]?.margin ?? 0, 1)}) on the deposits the branch would hold, less its running cost. Alone is what one branch could gather with nobody contesting the county; against them is its share of the county contest after six years. Click a row to see the county on the map.`}
    />
  );
}

// Every county in the hovered or pinned county's metro, best first: a city
// dot is the way into its metro.
function MetroCounties({ world, bank, cbsa, picked, onPick, onOpenBranch }: { world: World; bank: Bank; cbsa: string; picked: string | null; onPick: (fips: string | null) => void; onOpenBranch: (fips: string) => void }) {
  const metro = world.geo.metros[cbsa];
  const month = Math.floor(world.day / 30);
  const branches = bank.branches.length;
  const cands = useMemo(() => {
    if (!metro) return [];
    const rivals = rivalBranches(world);
    const out: BranchCase[] = [];
    for (const f of metro.counties) {
      const c = world.geo.counties[f];
      if (c && c.depositPool > 0) out.push(branchCase(world, bank, c, rivals));
    }
    return out.sort((x, y) => y.profit - x.profit || x.distanceKm - y.distanceKm);
  }, [world, bank, metro, month, branches]);
  if (!metro || cands.length === 0) return null;
  const mine = cands.filter((k) => k.existing > 0).length;
  return (
    <CandidateTable
      world={world}
      title={`Counties in the ${metro.name} metro (${num(cands.length)})`}
      cands={cands}
      picked={picked}
      onPick={onPick}
      onOpenBranch={onOpenBranch}
      footer={`${mine > 0 ? `You have ${mine === 1 ? 'a branch' : `${mine} branches`} in this metro. ` : ''}Best first by a mature year's earnings. Click a row to see the county on the map.`}
    />
  );
}

function CandidateTable({ world, title, cands, picked, onPick, onOpenBranch, footer }: { world: World; title: string; cands: BranchCase[]; picked: string | null; onPick: (fips: string | null) => void; onOpenBranch: (fips: string) => void; footer: string }) {
  return (
    <table>
      <thead>
        <tr>
          <th>{title}</th>
          <th className="num">km from home</th>
          <th className="num">deposit pool</th>
          <th className="num">other banks' branches</th>
          <th className="num">when mature, alone</th>
          <th className="num">against them</th>
          <th className="num">cost a year</th>
          <th>pays for itself</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {cands.map((k) => {
          const check = branchOpenCheck(world, world.geo.counties[k.fips] as CountyState);
          return (
            <tr key={k.fips} className={'row' + (picked === k.fips ? ' hover' : '')} onClick={() => onPick(picked === k.fips ? null : k.fips)}>
              <td>
                {k.name}, {k.state}
                {k.existing > 0 ? ' (your branch)' : ''}
              </td>
              <td className="num">{num(k.distanceKm)}</td>
              <td className="num">{short(k.pool)}</td>
              <td className="num">{num(k.rivalBranches)}</td>
              <td className="num">{short(k.mature)}</td>
              <td className="num">{short(k.contested)}</td>
              <td className="num">{short(k.fixedCost)}</td>
              <td>{payback(k)}</td>
              <td>
                <button
                  className="btn small"
                  disabled={!check.ok}
                  title={check.reason ?? `${usd(check.premises)} of cash becomes premises today`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPick(k.fips);
                    onOpenBranch(k.fips);
                  }}
                >
                  Open for {usd(check.premises)}
                </button>
              </td>
            </tr>
          );
        })}
        <tr>
          <td colSpan={9} className="dim">
            {footer}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function payback(k: BranchCase): string {
  if (k.paybackYear === null) return `never: needs ${short(k.breakEven)} of deposits`;
  return `year ${k.paybackYear}, past ${short(k.breakEven)}`;
}

function principal(world: World, m: MetroState): CountyState | null {
  let best: CountyState | null = null;
  for (const f of m.counties) {
    const c = world.geo.counties[f];
    if (c && (!best || c.population > best.population)) best = c;
  }
  return best;
}

function BranchMarkers({ world, bank, k, onHover, onLeave, onPick }: { world: World; bank: Bank; k: number; onHover: (fips: string) => void; onLeave: (fips: string) => void; onPick: (fips: string) => void }) {
  return (
    <g>
      {bank.branches.map((br) => {
        const c = world.geo.counties[br.county];
        if (!c) return null;
        const [x, y] = projectPoint(c.centroid[0], c.centroid[1], c.state);
        return (
          <g key={br.id} className="branch" onMouseEnter={() => onHover(c.fips)} onMouseLeave={() => onLeave(c.fips)} onClick={() => onPick(c.fips)}>
            <line x1={x - 4 / k} y1={y} x2={x + 4 / k} y2={y} />
            <line x1={x} y1={y - 4 / k} x2={x} y2={y + 4 / k} />
            <title>{`${bank.name} branch, ${c.name}: ${short(br.deposits)} deposits`}</title>
          </g>
        );
      })}
    </g>
  );
}

function CountyStats({ c, world }: { c: CountyState; world: World }) {
  const top = SECTORS.map((s) => [s, c.sectors[s] ?? 0] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  const metro = c.cbsa ? world.geo.metros[c.cbsa] : undefined;
  const bank = world.playerBankId ? world.banks[world.playerBankId] : null;
  const branch = bank ? branchCase(world, bank, c) : null;
  const held = bank ? bank.branches.filter((br) => br.county === c.fips).reduce((s, br) => s + br.deposits, 0) : 0;
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
        {branch && branch.existing > 0 && (
          <tr className="total">
            <td colSpan={2} style={{ whiteSpace: 'normal' }}>
              Your branch here holds {usd(held)} of deposits and costs {usd(branch.fixedCost)} a year to run.
            </td>
          </tr>
        )}
        {branch && branch.existing === 0 && (
          <tr className="total">
            <td colSpan={2} style={{ whiteSpace: 'normal' }}>
              A branch here could gather up to {usd(branch.year3)} of deposits in three years and {usd(branch.mature)} when mature{branch.rivalBranches > 0 ? `, about ${usd(branch.contested)} against the ${num(branch.rivalBranches)} ${branch.rivalBranches === 1 ? 'bank' : 'banks'} already here` : ''}. It costs {usd(branch.fixedCost)} a year to run and pays for itself {payback(branch)}{branch.distanceKm > 0 ? `. ${num(branch.distanceKm)} km from home` : ''}.
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
