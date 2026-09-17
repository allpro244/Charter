// Earnings: the income statement ("this period") and the quarterly review
// ("where it came from") under one tab.

import { useState } from 'react';
import type { Bank } from '../engine/state';
import type { Unit } from './format';
import { GrowthScreen } from './growth';
import { QtrScreen } from './qtr';
import { IncomeScreen } from './screens';

export function EarningsScreen({ bank, unit }: { bank: Bank; unit: Unit }) {
  const [tab, setTab] = useState<'period' | 'why' | 'qoq' | 'yoy'>('period');
  return (
    <div>
      <p className="hint">Where the money comes from and where it goes. This period shows the statement; where it came from names every dollar earned and lost in the last quarter, and the decisions behind the losses. The two growth views show what is rising and what is falling.</p>
      <div className="toolbar">
        <div className="seg">
          <button className={tab === 'period' ? 'on' : ''} onClick={() => setTab('period')}>
            This period
          </button>
          <button className={tab === 'why' ? 'on' : ''} onClick={() => setTab('why')}>
            Where it came from
          </button>
          <button className={tab === 'qoq' ? 'on' : ''} onClick={() => setTab('qoq')}>
            Quarter over quarter
          </button>
          <button className={tab === 'yoy' ? 'on' : ''} onClick={() => setTab('yoy')}>
            Year over year
          </button>
        </div>
      </div>
      {tab === 'period' && <IncomeScreen bank={bank} unit={unit} />}
      {tab === 'why' && <QtrScreen bank={bank} unit={unit} />}
      {(tab === 'qoq' || tab === 'yoy') && <GrowthScreen bank={bank} mode={tab} />}
    </div>
  );
}
