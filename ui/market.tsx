// Market: the other banks, the business lines, and the world abroad,
// under one tab.

import { useState } from 'react';
import type { Ctx } from '../engine/ctx';
import type { Bank, World } from '../engine/state';
import type { Unit } from './format';
import { LinesScreen } from './lines';
import { RivalsScreen } from './rivals';

export function MarketScreen({ world, bank, unit, act }: { world: World; bank: Bank; unit: Unit; act: (fn: (ctx: Ctx) => void, note?: string) => void }) {
  const [tab, setTab] = useState<'rivals' | 'lines' | 'abroad'>('rivals');
  return (
    <div>
      <div className="toolbar">
        <div className="seg">
          <button className={tab === 'rivals' ? 'on' : ''} onClick={() => setTab('rivals')}>
            Rivals and deals
          </button>
          <button className={tab === 'lines' ? 'on' : ''} onClick={() => setTab('lines')}>
            Business lines
          </button>
          <button className={tab === 'abroad' ? 'on' : ''} onClick={() => setTab('abroad')}>
            Abroad
          </button>
        </div>
      </div>
      {tab === 'rivals' && <RivalsScreen world={world} unit={unit} act={act} />}
      {tab === 'lines' && <LinesScreen world={world} bank={bank} unit={unit} act={act} part="lines" />}
      {tab === 'abroad' && <LinesScreen world={world} bank={bank} unit={unit} act={act} part="abroad" />}
    </div>
  );
}
