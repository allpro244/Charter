// Small shared pieces of the desk: a glossary term with its hover
// explanation, a stepper with a fine and a coarse step, an amount field
// with presets, a status pill. Plain functions over plain props.

import { useState } from 'react';
import type React from 'react';
import { TERMS } from './glossary';
import { usd } from './format';

// A word with a plain-language explanation on hover. `k` is the glossary
// key; the children are what the screen shows (default: the key itself).
export function Term({ k, children }: { k: string; children?: React.ReactNode }) {
  const tip = TERMS[k];
  if (!tip) return <>{children ?? k}</>;
  return (
    <span className="term" data-tip={tip} tabIndex={0}>
      {children ?? k}
    </span>
  );
}

export interface Step {
  d: number;
  label: string;
}

// Two steps down, the value, two steps up. The small step is the fine
// control (one basis point, one cent of coverage); the large one is the
// old jump. Values are clamped to [min, max].
export function Stepper({ value, steps, fmt, onChange, min = -Infinity, max = Infinity, title }: { value: number; steps: [Step, Step]; fmt: (v: number) => string; onChange: (v: number) => void; min?: number; max?: number; title?: string }) {
  const [fine, coarse] = steps;
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <span className="stepper" title={title}>
      <button onClick={() => set(value - coarse.d)} title={`down ${coarse.label}`}>
        -{coarse.label}
      </button>
      <button onClick={() => set(value - fine.d)} title={`down ${fine.label}`}>
        -{fine.label}
      </button>
      <span className="val">{fmt(value)}</span>
      <button onClick={() => set(value + fine.d)} title={`up ${fine.label}`}>
        +{fine.label}
      </button>
      <button onClick={() => set(value + coarse.d)} title={`up ${coarse.label}`}>
        +{coarse.label}
      </button>
    </span>
  );
}

// A dollar amount the player types, with a few presets. The field holds
// whole dollars; the presets are shown short ($5.0M).
export function AmountField({ value, onChange, presets, label = 'Amount' }: { value: number; onChange: (v: number) => void; presets?: number[]; label?: string }) {
  const [text, setText] = useState(String(value));
  const commit = (s: string) => {
    setText(s);
    const n = parseAmount(s);
    if (n !== null) onChange(n);
  };
  return (
    <span className="amountfield">
      <span className="seg-label">{label}</span>
      <input className="amount" value={text} onChange={(e) => commit(e.target.value)} onBlur={() => setText(String(value))} />
      {presets && (
        <span className="seg">
          {presets.map((p) => (
            <button key={p} className={p === value ? 'on' : ''} onClick={() => commit(String(p))}>
              {usd(p)}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

// "5m", "250k", "1.2b" or plain digits with commas, in dollars.
export function parseAmount(s: string): number | null {
  const m = s.trim().toLowerCase().replace(/[$,\s]/g, '').match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : 1;
  return Math.round(n * mult);
}

export function Pill({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'neutral'; children: React.ReactNode }) {
  return <span className={'pill ' + tone}>{children}</span>;
}
