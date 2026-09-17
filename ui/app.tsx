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
import { BalanceSheetScreen, DebugScreen, FeedScreen, IncomeScreen, KeyMap, MeScreen, PendingPanel, StatusBar } from './screens';
import { adviceFor } from './advisor';
import { StartPanel } from './start';
import { LoansScreen } from './loans';
import { QtrScreen } from './qtr';
import { FundScreen } from './fund';
import { RivalsScreen } from './rivals';
import { LinesScreen } from './lines';
import { CapitalPanel } from './capital';
import { OfficersScreen } from './off';
import { openBranch } from '../engine/deposits';

type Screen = 'FEED' | 'BS' | 'IS' | 'LOANS' | 'FUND' | 'OFF' | 'RIVALS' | 'ME' | 'QTR' | 'LINES' | 'MAP' | 'DEBUG';
const SCREEN_KEYS: Record<string, Screen> = { f: 'FEED', b: 'BS', i: 'IS', l: 'LOANS', u: 'FUND', o: 'OFF', r: 'RIVALS', w: 'ME', q: 'QTR', n: 'LINES', m: 'MAP', d: 'DEBUG' };
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
  const [showKeys, setShowKeys] = useState(false);
  const [advisorOn, setAdvisorOn] = useState(true);
  const [dismissed, setDismissed] = useState<Record<string, number>>({});

  const dismissedRef = useRef<Record<string, number>>({});
  dismissedRef.current = dismissed;

  const exportSave = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const blob = new Blob([JSON.stringify(world)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `charter-${world.seed}-${world.day}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const loadSaveText = useCallback((text: string): boolean => {
    try {
      const w = JSON.parse(text) as World;
      if (!w || w.version !== 1) return false;
      worldRef.current = w;
      setPhase(w.playerBankId || !loadedRef.current ? 'play' : 'start');
      setSpeedState(0);
      speedRef.current = 0;
      setVersion((v) => v + 1);
      return true;
    } catch {
      return false;
    }
  }, []);
  const importSave = useCallback((file: File) => {
    file.text().then(loadSaveText);
  }, [loadSaveText]);
  // A playtest world shipped next to the page: a small bank with no home
  // county, so lending runs through pools and no applications arrive.
  const [bundledNote, setBundledNote] = useState('');
  const loadBundled = useCallback(() => {
    // The single-file build carries the save inside the page, so it runs
    // from a double-clicked file with nothing to fetch.
    const inline = document.getElementById('playtest-save');
    if (inline && inline.textContent) {
      if (!loadSaveText(inline.textContent)) setBundledNote('the playtest save inside this page is not a save file');
      return;
    }
    fetch('./playtest-save.json')
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((text) => {
        if (!loadSaveText(text)) setBundledNote('the playtest save next to this page is not a save file');
      })
      .catch(() => setBundledNote('no playtest save next to this page'));
  }, [loadSaveText]);

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
        const saved = readSave() !== null;
        setHasSave(saved);
        // A packed build carries a world inside the page: open straight
        // into it unless the browser already holds a saved game.
        const inline = document.getElementById('playtest-save');
        if (inline && inline.textContent && !saved && loadSaveText(inline.textContent)) return;
        setPhase('nodata');
      }
    });
  }, [loadSaveText]);

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
        if (r.pending.some((p) => p.blocking) || world.playerBankId === null) {
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
      } else if (!world.pending.some((x) => x.blocking)) {
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

  // Runs a desk action against the engine between ticks.
  const act = useCallback(
    (fn: (ctx: Ctx) => void) => {
      const world = worldRef.current;
      if (!world) return;
      const ctx: Ctx = { world, events: [] };
      fn(ctx);
      world.feed.push(...ctx.events);
      refresh();
    },
    [refresh],
  );

  const onCharter = useCallback((cbsa: string, name: string, invest: number) => begin((ctx) => startCharter(ctx, { mode: 'charter', cbsa, name, invest })), [begin]);
  const onTakeover = useCallback((cbsa: string, candidate: TakeoverCandidate) => begin((ctx) => startTakeover(ctx, { mode: 'takeover', cbsa, candidate })), [begin]);
  const onContinue = useCallback(() => {
    const save = readSave();
    if (!save) return;
    worldRef.current = save;
    // Without data files there is no start screen; a save with no bank shows the feed.
    setPhase(save.playerBankId || !loadedRef.current ? 'play' : 'start');
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
        const blocking = world.pending.find((p) => p.blocking);
        if (blocking) {
          const p = blocking;
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
        if (k === '?') {
          setShowKeys((v) => !v);
          return;
        }
        if (k === 'x') {
          const first = adviceFor(world).find((c) => (dismissedRef.current[c.key] ?? -1) < world.day - 90);
          if (first) setDismissed((d) => ({ ...d, [first.key]: world.day }));
          return;
        }
        if (e.key === 'A') {
          setAdvisorOn((v) => !v);
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
    const packed = document.getElementById('playtest-save') !== null;
    return (
      <main className="desk">
        <header className="bar">
          <span className="title">CHARTER</span>
          <span className="status">{packed ? 'playtest build' : 'no data'}</span>
        </header>
        {packed ? (
          <p>This build has no county map yet, so it runs the playtest bank: an $80M bank with no home town. Lending runs through pools, no applications reach the desk, and the map stays empty. Everything else runs.</p>
        ) : (
          <>
            <p>The world is built from real public data and these files are missing:</p>
            <pre className="memo">{missing.join('\n')}</pre>
            <p>A note for Claude Code, not for the player: the files come from</p>
            <pre className="memo">{'npm run fetch-data\nnpm run build-data'}</pre>
            <p>A saved world carries its own geography, so a save still loads without the files. The map stays empty until they exist.</p>
          </>
        )}
        <p>
          {hasSave && (
            <button className="key" onClick={onContinue}>
              continue saved game
            </button>
          )}
          <button className="key" onClick={loadBundled}>
            {hasSave ? 'start a new playtest bank' : 'start with the playtest bank'}
          </button>
          {bundledNote && <span className="dim"> {bundledNote}</span>}
        </p>
        <p className="dim">Space starts the clock, 1 to 5 set the speed, s saves, and ? shows the keys.</p>
        <p className="dim">
          or load a save file: <input type="file" accept="application/json,.json" onChange={(e) => e.target.files && e.target.files[0] && importSave(e.target.files[0])} />
        </p>
      </main>
    );
  }
  const world = worldRef.current as World;
  const loaded: Loaded = loadedRef.current ?? { data: { counties: [], metros: [], states: [], banksByState: {}, national: { asOf: '', fedFunds: 0, dgs3mo: 0, dgs2: 0, dgs10: 0, dgs30: 0, cpiYoY: 0, unemploymentRate: 0, wti: 0, caseShillerYoY: 0, sp500: 0 } }, geo: { type: 'FeatureCollection', features: [] }, manifest: null };
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
      {showKeys && <KeyMap />}
      {screen === 'FEED' && (
        <FeedScreen
          world={world}
          onDecide={decide}
          cards={advisorOn ? adviceFor(world).filter((c) => (dismissed[c.key] ?? -1) < world.day - 90) : []}
          onDismiss={(key) => setDismissed((d) => ({ ...d, [key]: world.day }))}
        />
      )}
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
          capital={bank ? <CapitalPanel world={world} bank={bank} act={act} /> : undefined}
        />
      )}
      {screen === 'LINES' && bank && <LinesScreen world={world} bank={bank} unit={unit} act={act} />}
      {screen === 'LOANS' && bank && <LoansScreen world={world} bank={bank} unit={unit} refresh={refresh} />}
      {screen === 'FUND' && bank && <FundScreen world={world} bank={bank} unit={unit} act={act} />}
      {screen === 'OFF' && bank && <OfficersScreen world={world} bank={bank} act={act} />}
      {screen === 'QTR' && bank && <QtrScreen bank={bank} unit={unit} />}
      {screen === 'MAP' && (
        <MapView
          world={world}
          geo={loaded.geo}
          mode="play"
          shade={shade}
          selectedMetro={null}
          onSelectMetro={() => undefined}
          onOpenBranch={(fips) => {
            const county = world.geo.counties[fips];
            if (county) act((ctx) => openBranch(ctx, county));
          }}
        />
      )}
      {screen === 'DEBUG' && <DebugScreen world={world} tickMs={tickMs} manifest={loaded.manifest} dataOk={loadedRef.current !== null} onExport={exportSave} onImport={importSave} />}
      {screen === 'RIVALS' && <RivalsScreen world={world} unit={unit} act={act} />}
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
        <span>n lines</span>
        <span>m map{screen === 'MAP' ? ` (c shade: ${shade})` : ''}</span>
        <span>d debug</span>
        <span>space pause</span>
        <span>0-5 speed</span>
        <span>s save</span>
        <span>? keys</span>
      </footer>
    </main>
  );
}
