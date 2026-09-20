// The desk. A viewer over the engine (D9): holds the world, runs the
// ticker, routes clicks and keys to screens and decisions, saves to
// localStorage. Mouse first (DESIGN.md Part 3); keys are shortcuts.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ctx } from '../engine/ctx';
import { totalAssets } from '../engine/ledger';
import { type Decision, type Pending, type World, createWorld } from '../engine/state';
import { newPlayer, startCharter, startTakeover, type TakeoverCandidate } from '../engine/start';
import { applyDecisions, tick } from '../engine/tick';
import { isYearEnd } from '../engine/time';
import { setDividendPayout, setSalary } from '../engine/wealth';
import { type Loaded, loadData } from './data';
import { type Unit, short, unitFor } from './format';
import { MapView, type Shade } from './map';
import { DebugScreen, DecisionDock, HelpModal, MeScreen, SPEEDS, TopBar } from './screens';
import { adviceFor } from './advisor';
import { StartPanel } from './start';
import { LoansScreen } from './loans';
import { FundScreen } from './fund';
import { OfficersScreen } from './off';
import { OverviewScreen } from './overview';
import { EarningsScreen } from './earnings';
import { EconomyScreen } from './economy';
import { MarketScreen } from './market';
import { openBranch } from '../engine/deposits';

type Screen = 'OVERVIEW' | 'LENDING' | 'ECONOMY' | 'MONEY' | 'EARNINGS' | 'PEOPLE' | 'MARKET' | 'MAP' | 'YOU' | 'DEBUG';
const SCREENS: { id: Screen; label: string; key: string }[] = [
  { id: 'OVERVIEW', label: 'Overview', key: 'o' },
  { id: 'LENDING', label: 'Lending', key: 'l' },
  { id: 'ECONOMY', label: 'Economy', key: 'c' },
  { id: 'MONEY', label: 'Money', key: 'f' },
  { id: 'EARNINGS', label: 'Earnings', key: 'e' },
  { id: 'PEOPLE', label: 'People', key: 'p' },
  { id: 'MARKET', label: 'Market', key: 'r' },
  { id: 'MAP', label: 'Map', key: 'm' },
  { id: 'YOU', label: 'You', key: 'w' },
];
const SCREEN_KEYS: Record<string, Screen> = { ...Object.fromEntries(SCREENS.map((s) => [s.key, s.id])), d: 'DEBUG' };
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
  const [screen, setScreen] = useState<Screen>('OVERVIEW');
  const [speed, setSpeedState] = useState(0);
  const speedRef = useRef(0);
  const resumeRef = useRef(2);
  const [version, setVersion] = useState(0);
  const [tickMs, setTickMs] = useState(0);
  const [shade, setShade] = useState<Shade>('none');
  const [selectedMetro, setSelectedMetro] = useState<string | null>(null);
  const [hasSave, setHasSave] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [advisorOn, setAdvisorOn] = useState(true);
  const [dismissed, setDismissed] = useState<Record<string, number>>({});
  const [savedFlash, setSavedFlash] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const toastId = useRef(0);

  const dismissedRef = useRef<Record<string, number>>({});
  dismissedRef.current = dismissed;

  // A short confirmation after every action, bottom right, gone in a moment.
  const toast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

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
  const importSave = useCallback(
    (file: File) => {
      file.text().then(loadSaveText);
    },
    [loadSaveText],
  );
  // A playtest world shipped inside or next to the page: a small bank with
  // no home county, so lending runs through pools and no applications arrive.
  const [bundledNote, setBundledNote] = useState('');
  const loadBundled = useCallback(() => {
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
  const togglePlay = useCallback(() => setSpeed(speedRef.current === 0 ? resumeRef.current : 0), [setSpeed]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const saveNow = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    writeSave(world);
    setHasSave(true);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }, []);

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
      if (ctx.events[0]) toast(ctx.events[0].text);
      if (p.kind === 'failure') {
        setPhase('start');
        setSelectedMetro(null);
      } else if (!world.pending.some((x) => x.blocking)) {
        setSpeed(resumeRef.current);
      }
      refresh();
    },
    [setSpeed, refresh, toast],
  );

  const begin = useCallback(
    (fn: (ctx: Ctx) => void) => {
      const world = worldRef.current;
      if (!world) return;
      const ctx: Ctx = { world, events: [] };
      fn(ctx);
      world.feed.push(...ctx.events);
      setPhase('play');
      setScreen('OVERVIEW');
      setSpeed(1);
      writeSave(world);
      refresh();
    },
    [setSpeed, refresh],
  );

  // Runs a desk action against the engine between ticks. The note, or the
  // first event the action produced, shows as a toast.
  const act = useCallback(
    (fn: (ctx: Ctx) => void, note?: string) => {
      const world = worldRef.current;
      if (!world) return;
      const ctx: Ctx = { world, events: [] };
      fn(ctx);
      world.feed.push(...ctx.events);
      const text = note ?? ctx.events[0]?.text;
      if (text) toast(text);
      refresh();
    },
    [refresh, toast],
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

  const newWorld = useCallback(() => {
    if (!confirm('Start a new world? The current save is replaced when you next save.')) return;
    const loaded = loadedRef.current;
    if (!loaded && document.getElementById('playtest-save')) {
      setShowKeys(false);
      loadBundled();
      return;
    }
    worldRef.current = createWorld(Date.now() % 2_147_483_647, loaded ? loaded.data : null);
    newPlayer(worldRef.current);
    setSelectedMetro(null);
    setShowKeys(false);
    setPhase('start');
    setSpeed(0);
    refresh();
  }, [loadBundled, setSpeed, refresh]);

  // Keys are shortcuts for what the mouse can do: tabs, the clock,
  // decisions, save, help.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      const world = worldRef.current;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        setShowKeys(false);
        return;
      }
      if (phase === 'play' && world) {
        const blocking = world.pending.find((p) => p.blocking);
        if (blocking) {
          const opt = blocking.options.find((o) => o.key === k);
          if (opt) {
            decide(blocking, opt.key);
            e.preventDefault();
            return;
          }
        }
        if (k === ' ') {
          togglePlay();
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
          saveNow();
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
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase, decide, setSpeed, togglePlay, saveNow]);

  if (phase === 'loading') {
    return (
      <div className="desk">
        <main className="content narrow">
          <div className="brand big">CHARTER</div>
          <p className="lede">Loading the world.</p>
        </main>
      </div>
    );
  }
  if (phase === 'nodata') {
    const packed = document.getElementById('playtest-save') !== null;
    return (
      <div className="desk">
        <main className="content narrow">
          <div className="hero">
            <div className="brand big">CHARTER</div>
            <p className="lede">Run a bank. Start small, lend well, survive the cycle, and grow past everyone.</p>
          </div>
          {packed ? (
            <p className="hint">This build has no county map yet, so it runs the playtest bank: an $80M bank with no home town. Lending runs through pools, no applications reach the desk, and the map stays empty. Everything else runs.</p>
          ) : (
            <>
              <p className="hint">The world is built from real public data and these files are missing:</p>
              <pre className="memo">{missing.join('\n')}</pre>
              <p className="hint">A note for Claude Code, not for the player: the files come from</p>
              <pre className="memo">{'npm run fetch-data\nnpm run build-data'}</pre>
              <p className="hint">A saved world carries its own geography, so a save still loads without the files. The map stays empty until they exist.</p>
            </>
          )}
          <div className="toolbar">
            {hasSave && (
              <button className="btn primary" onClick={onContinue}>
                Continue saved game
              </button>
            )}
            <button className={'btn' + (hasSave ? '' : ' primary')} onClick={loadBundled}>
              {hasSave ? 'Start a new playtest bank' : 'Start with the playtest bank'}
            </button>
            {bundledNote && <span className="dim">{bundledNote}</span>}
          </div>
          <p className="hint">Once inside, press Play in the top bar. Every screen is a tab, every decision is a button, and Help explains the rest.</p>
          <p className="hint">
            Or load a save file: <input type="file" accept="application/json,.json" onChange={(e) => e.target.files && e.target.files[0] && importSave(e.target.files[0])} />
          </p>
        </main>
      </div>
    );
  }
  const world = worldRef.current as World;
  const loaded: Loaded = loadedRef.current ?? { data: { counties: [], metros: [], states: [], banksByState: {}, national: { asOf: '', fedFunds: 0, dgs3mo: 0, dgs2: 0, dgs10: 0, dgs30: 0, cpiYoY: 0, unemploymentRate: 0, wti: 0, caseShillerYoY: 0, sp500: 0 } }, geo: { type: 'FeatureCollection', features: [] }, manifest: null };
  const bank = world.playerBankId ? world.banks[world.playerBankId] : null;
  const unit: Unit = bank ? unitFor(totalAssets(bank.acct)) : 1;
  void version;

  if (phase === 'start') {
    return (
      <div className="desk">
        <div className="chrome">
          <header className="topbar">
            <div className="brand">CHARTER</div>
            <div className="bankname">
              New game
              <small>founder cash {short(world.player.cash)}</small>
            </div>
            <div className="topbar-actions" style={{ marginLeft: 'auto' }}>
              {hasSave && (
                <button className="btn primary" onClick={onContinue}>
                  Continue saved game
                </button>
              )}
            </div>
          </header>
        </div>
        <main className="content">
          <div className="cols start-cols">
            <MapView world={world} geo={loaded.geo} mode="start" shade={shade} onShade={setShade} selectedMetro={selectedMetro} onSelectMetro={(c) => setSelectedMetro(c || null)} />
            <StartPanel world={world} data={loaded.data} selectedMetro={selectedMetro} onSelectMetro={(c) => setSelectedMetro(c || null)} onCharter={onCharter} onTakeover={onTakeover} />
          </div>
        </main>
        {world.pending
          .filter((p) => p.blocking)
          .slice(0, 1)
          .map((p) => (
            <DecisionDock key={p.id} world={world} p={p} more={world.pending.filter((x) => x.blocking).length - 1} onDecide={decide} />
          ))}
      </div>
    );
  }

  const blocking = world.pending.find((p) => p.blocking);
  const waiting = world.pending.length;
  const cards = advisorOn ? adviceFor(world).filter((c) => (dismissed[c.key] ?? -1) < world.day - 90) : [];
  return (
    <div className="desk">
      <div className="chrome">
        <TopBar world={world} speed={speed} onSpeed={setSpeed} onToggle={togglePlay} onSave={saveNow} saved={savedFlash} onHelp={() => setShowKeys((v) => !v)} alerts={cards.length} onAlerts={() => setScreen('OVERVIEW')} />
        <nav className="tabs" aria-label="Screens">
          {SCREENS.map((s) => (
            <button key={s.id} className={'tab' + (screen === s.id ? ' on' : '')} onClick={() => setScreen(s.id)}>
              {s.label}
              {s.id === 'OVERVIEW' && waiting > 0 && <span className="badge">{waiting}</span>}
              <span className="k">{s.key}</span>
            </button>
          ))}
          {screen === 'DEBUG' && <button className="tab on">Debug</button>}
        </nav>
        {blocking && <DecisionDock world={world} p={blocking} more={world.pending.filter((x) => x.blocking).length - 1} onDecide={decide} />}
      </div>
      <main className="content">
        {screen === 'OVERVIEW' && bank && (
          <OverviewScreen
            world={world}
            bank={bank}
            cards={cards}
            advisorOn={advisorOn}
            onToggleAdvisor={() => setAdvisorOn((v) => !v)}
            onDismiss={(key) => setDismissed((d) => ({ ...d, [key]: world.day }))}
            onGo={(tab) => setScreen(tab as Screen)}
            onDecide={decide}
            speed={speed}
            onPlay={togglePlay}
          />
        )}
        {screen === 'LENDING' && bank && <LoansScreen world={world} bank={bank} unit={unit} refresh={refresh} />}
        {screen === 'ECONOMY' && bank && <EconomyScreen world={world} bank={bank} onGo={(tab) => setScreen(tab as Screen)} />}
        {screen === 'MONEY' && bank && <FundScreen world={world} bank={bank} unit={unit} act={act} />}
        {screen === 'EARNINGS' && bank && <EarningsScreen bank={bank} unit={unit} />}
        {screen === 'PEOPLE' && bank && <OfficersScreen world={world} bank={bank} act={act} />}
        {screen === 'MARKET' && bank && <MarketScreen world={world} bank={bank} unit={unit} act={act} />}
        {screen === 'MAP' && (
          <MapView
            world={world}
            geo={loaded.geo}
            mode="play"
            shade={shade}
            onShade={setShade}
            selectedMetro={null}
            onSelectMetro={() => undefined}
            onOpenBranch={(fips) => {
              const county = world.geo.counties[fips];
              if (county) act((ctx) => openBranch(ctx, county));
            }}
          />
        )}
        {screen === 'YOU' && (
          <MeScreen
            world={world}
            onSalary={(v) => {
              setSalary(world, v);
              refresh();
            }}
            onPayout={(v) => {
              setDividendPayout(world, Math.round(v * 100) / 100);
              refresh();
            }}
          />
        )}
        {screen === 'DEBUG' && <DebugScreen world={world} tickMs={tickMs} manifest={loaded.manifest} dataOk={loadedRef.current !== null} onExport={exportSave} onImport={importSave} onNewWorld={newWorld} />}
      </main>
      {showKeys && (
        <HelpModal
          onClose={() => setShowKeys(false)}
          onNewWorld={newWorld}
          onDebug={() => {
            setScreen('DEBUG');
            setShowKeys(false);
          }}
        />
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
