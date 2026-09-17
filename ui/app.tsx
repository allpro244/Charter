// The desk. A viewer over the engine (D9): holds the world, runs the
// ticker, routes keys to screens and decisions, saves to localStorage.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ctx } from '../engine/ctx';
import { totalAssets } from '../engine/ledger';
import { type Decision, type Pending, type World, createWorld } from '../engine/state';
import { newPlayer, startCharter, startTakeover, type TakeoverCandidate } from '../engine/start';
import { applyDecisions, tick } from '../engine/tick';
import { isYearEnd } from '../engine/time';
import { setDividendPayout, setSalary } from '../engine/wealth';
import { type Loaded, loadData } from './data';
import { type Unit, unitFor } from './format';
import { MapView, SHADES, type Shade } from './map';
import { BalanceSheetScreen, DebugScreen, FeedScreen, IncomeScreen, MeScreen, PendingPanel, StatusBar } from './screens';
import { StartPanel } from './start';

type Screen = 'FEED' | 'BS' | 'IS' | 'LOANS' | 'FUND' | 'OFF' | 'RIVALS' | 'ME' | 'QTR' | 'MAP' | 'DEBUG';
const SCREEN_KEYS: Record<string, Screen> = { f: 'FEED', b: 'BS', i: 'IS', l: 'LOANS', u: 'FUND', o: 'OFF', r: 'RIVALS', w: 'ME', q: 'QTR', m: 'MAP', d: 'DEBUG' };
// Days per real second. Speed 4 is D3's top speed: a year in two minutes.
const SPEEDS = [0, 0.5, 1, 2, 3, 6];
const SAVE_KEY = 'charter.save';

type Phase = 'loading' | 'nodata' | 'start' | 'play';

function readSave(): World | null {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    if (!text) return null;
    const w = JSON.parse(text) as World;
    return w && w.version === 1 ? w : null;
  } catch {
    return null;
  }
}

function writeSave(world: World): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(world));
  } catch {
    // Storage full or blocked. The export on the DEBUG screen still works.
  }
}

export function App() {
  const worldRef = useRef<World | null>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [missing, setMissing] = useState<string[]>([]);
  const [screen, setScreen] = useState<Screen>('FEED');
  const [speed, setSpeedState] = useState(0);
  const speedRef = useRef(0);
  const resumeRef = useRef(1);
  const [version, setVersion] = useState(0);
  const [tickMs, setTickMs] = useState(0);
  const [shade, setShade] = useState<Shade>('none');
  const [selectedMetro, setSelectedMetro] = useState<string | null>(null);
  const [hasSave, setHasSave] = useState(false);

  const setSpeed = useCallback((s: number) => {
    speedRef.current = s;
    if (s > 0) resumeRef.current = s;
    setSpeedState(s);
  }, []);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    loadData().then((r) => {
      if (r.ok) {
        loadedRef.current = r.loaded;
        const save = readSave();
        setHasSave(save !== null);
        worldRef.current = createWorld(Date.now() % 2_147_483_647, r.loaded.data);
        newPlayer(worldRef.current);
        setPhase('start');
      } else {
        setMissing(r.missing);
        setPhase('nodata');
      }
    });
  }, []);

  // The ticker. Fractional days accumulate so slow speeds stay smooth.
  useEffect(() => {
    if (phase !== 'play') return;
    let acc = 0;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const world = worldRef.current;
      if (!world || speedRef.current === 0) return;
      acc += dt * (SPEEDS[speedRef.current] ?? 0);
      let n = Math.floor(acc);
      if (n === 0) return;
      acc -= n;
      const t0 = performance.now();
      let paused = false;
      while (n-- > 0) {
        const r = tick(world);
        if (isYearEnd(world.day)) writeSave(world);
        if (r.pending.length > 0 || world.playerBankId === null) {
          paused = true;
          break;
        }
      }
      setTickMs(performance.now() - t0);
      if (paused) setSpeed(0);
      refresh();
    }, 100);
    return () => clearInterval(id);
  }, [phase, setSpeed, refresh]);

  const decide = useCallback(
    (p: Pending, key: string) => {
      const world = worldRef.current;
      if (!world) return;
      const d: Decision = { pendingId: p.id, choice: key };
      const ctx: Ctx = { world, events: [] };
      applyDecisions(ctx, [d]);
      world.feed.push(...ctx.events);
      if (p.kind === 'failure') {
        setPhase('start');
        setSelectedMetro(null);
      } else if (world.pending.length === 0) {
        setSpeed(resumeRef.current);
      }
      refresh();
    },
    [setSpeed, refresh],
  );

  const begin = useCallback(
    (fn: (ctx: Ctx) => void) => {
      const world = worldRef.current;
      if (!world) return;
      const ctx: Ctx = { world, events: [] };
      fn(ctx);
      world.feed.push(...ctx.events);
      setPhase('play');
      setScreen('FEED');
      setSpeed(1);
      writeSave(world);
      refresh();
    },
    [setSpeed, refresh],
  );

  const onCharter = useCallback((cbsa: string, name: string, invest: number) => begin((ctx) => startCharter(ctx, { mode: 'charter', cbsa, name, invest })), [begin]);
  const onTakeover = useCallback((cbsa: string, candidate: TakeoverCandidate) => begin((ctx) => startTakeover(ctx, { mode: 'takeover', cbsa, candidate })), [begin]);
  const onContinue = useCallback(() => {
    const save = readSave();
    if (!save) return;
    worldRef.current = save;
    setPhase(save.playerBankId ? 'play' : 'start');
    setSpeed(0);
    refresh();
  }, [setSpeed, refresh]);

  // Keys. Every screen has a key; speed is the number keys; space pauses.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const world = worldRef.current;
      const k = e.key.toLowerCase();
      if (phase === 'play' && world) {
        if (world.pending.length > 0) {
          const p = world.pending[0] as Pending;
          const opt = p.options.find((o) => o.key === k);
          if (opt) {
            decide(p, opt.key);
            e.preventDefault();
            return;
          }
        }
        if (k === ' ') {
          setSpeed(speedRef.current === 0 ? resumeRef.current : 0);
          e.preventDefault();
          return;
        }
        if (/^[0-5]$/.test(k)) {
          setSpeed(Number(k));
          return;
        }
        if (SCREEN_KEYS[k]) {
          setScreen(SCREEN_KEYS[k] as Screen);
          return;
        }
        if (k === 's') {
          writeSave(world);
          setHasSave(true);
          return;
        }
        if (k === 'n') {
          if (confirm('Start a new world? The current save is replaced when you next save.')) {
            const loaded = loadedRef.current;
            worldRef.current = createWorld(Date.now() % 2_147_483_647, loaded ? loaded.data : null);
            newPlayer(worldRef.current);
            setSelectedMetro(null);
            setPhase('start');
            setSpeed(0);
            refresh();
          }
          return;
        }
        if (screen === 'ME') {
          if (k === '+' || k === '=') setSalary(world, world.player.salary + 10_000);
          if (k === '-') setSalary(world, world.player.salary - 10_000);
          if (k === '[') setDividendPayout(world, (world.banks[world.playerBankId ?? '']?.dividendPayout ?? 0) - 0.1);
          if (k === ']') setDividendPayout(world, (world.banks[world.playerBankId ?? '']?.dividendPayout ?? 0) + 0.1);
          refresh();
        }
        if (screen === 'MAP' && k === 'c') {
          setShade((s) => SHADES[(SHADES.indexOf(s) + 1) % SHADES.length] as Shade);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase, screen, decide, setSpeed, refresh]);

  if (phase === 'loading') return <main className="desk">loading data</main>;
  if (phase === 'nodata') {
    return (
      <main className="desk">
        <header className="bar">
          <span className="title">CHARTER</span>
          <span className="status">no data</span>
        </header>
        <p>The world is built from real public data and these files are missing:</p>
        <pre className="memo">{missing.join('\n')}</pre>
        <p>Claude Code builds them with:</p>
        <pre className="memo">{'npm run fetch-data\nnpm run build-data'}</pre>
      </main>
    );
  }
  const world = worldRef.current as World;
  const loaded = loadedRef.current as Loaded;
  const bank = world.playerBankId ? world.banks[world.playerBankId] : null;
  const unit: Unit = bank ? unitFor(totalAssets(bank.acct)) : 1;
  void version;

  if (phase === 'start') {
    return (
      <main className="desk">
        <div className="cols start-cols">
          <MapView world={world} geo={loaded.geo} mode="start" shade={shade} selectedMetro={selectedMetro} onSelectMetro={(c) => setSelectedMetro(c || null)} />
          <StartPanel
            world={world}
            data={loaded.data}
            selectedMetro={selectedMetro}
            onSelectMetro={(c) => setSelectedMetro(c || null)}
            onCharter={onCharter}
            onTakeover={onTakeover}
            hasSave={hasSave}
            onContinue={onContinue}
          />
        </div>
        {world.pending.map((p) => (
          <PendingPanel key={p.id} p={p} onDecide={decide} />
        ))}
      </main>
    );
  }

  return (
    <main className="desk">
      <StatusBar world={world} speed={speed} screen={screen} unit={unit} />
      {screen !== 'FEED' && world.pending.map((p) => <PendingPanel key={p.id} p={p} onDecide={decide} />)}
      {screen === 'FEED' && <FeedScreen world={world} onDecide={decide} />}
      {screen === 'BS' && bank && <BalanceSheetScreen bank={bank} unit={unit} />}
      {screen === 'IS' && bank && <IncomeScreen bank={bank} unit={unit} />}
      {screen === 'ME' && (
        <MeScreen
          world={world}
          onSalary={(d) => {
            setSalary(world, world.player.salary + d);
            refresh();
          }}
          onPayout={(d) => {
            setDividendPayout(world, (bank?.dividendPayout ?? 0) + d);
            refresh();
          }}
        />
      )}
      {screen === 'MAP' && <MapView world={world} geo={loaded.geo} mode="play" shade={shade} selectedMetro={null} onSelectMetro={() => undefined} />}
      {screen === 'DEBUG' && <DebugScreen world={world} tickMs={tickMs} manifest={loaded.manifest} dataOk />}
      {(screen === 'LOANS' || screen === 'FUND' || screen === 'OFF' || screen === 'RIVALS' || screen === 'QTR') && (
        <p className="dim">{screen}: not built yet. See BUILD_PLAN.md.</p>
      )}
      <footer className="keys">
        <span>f feed</span>
        <span>b balance sheet</span>
        <span>i income</span>
        <span>l loans</span>
        <span>u funding</span>
        <span>o officers</span>
        <span>r rivals</span>
        <span>w me</span>
        <span>q quarter</span>
        <span>m map{screen === 'MAP' ? ` (c shade: ${shade})` : ''}</span>
        <span>d debug</span>
        <span>space pause</span>
        <span>0-5 speed</span>
        <span>s save</span>
      </footer>
    </main>
  );
}
