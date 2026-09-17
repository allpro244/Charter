// Earnings: the income statement ("this period") and the quarterly review
// ("where it came from") under one tab.

import { useState } from 'react';
import type { Bank } from '../engine/state';
import type { Unit } from './format';
import { QtrScreen } from './qtr';
import { IncomeScreen } from './screens';

export function EarningsScreen({ bank, unit }: { bank: Bank; unit: Unit }) {
  const [tab, setTab] = useState<'period' | 'why'>('period');
  return (
    <div>
      <p className="hint">Where the money comes from and where it goes. This period shows the statement; where it came from names every dollar earned and lost in the last quarter, and the decisions behind the losses.</p>
      <div className="toolbar">
        <div className="seg">
          <button className={tab === 'period' ? 'on' : ''} onClick={() => setTab('period')}>
            This period
          </button>
          <button className={tab === 'why' ? 'on' : ''} onClick={() => setTab('why')}>
            Where it came from
          </button>
        </div>
      </div>
      {tab === 'period' ? <IncomeScreen bank={bank} unit={unit} /> : <QtrScreen bank={bank} unit={unit} />}
    </div>
  );
}
