// Earnings: the income statement ("this period") and the quarterly review
// ("where it came from") under one tab.

import { useState } from 'react';
import type { Bank } from '../engine/state';
import type { Unit } from './format';
import { GrowthScreen } from './growth';
import { QtrScreen } from './qtr';
import { IncomeScreen } from './screens';
import { Sparks } from './overview';
import { YearsTable } from './years';
import { Intro } from './parts';

export function EarningsScreen({ bank, unit }: { bank: Bank; unit: Unit }) {
  const [tab, setTab] = useState<'period' | 'why' | 'qoq' | 'yoy' | 'years'>('period');
  return (
    <div>
      <Intro>Where the money comes from and where it goes. This period shows the statement; where it came from names every dollar earned and lost in the last quarter, and the decisions behind the losses. The two growth views show what is rising and what is falling.</Intro>
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
          <button className={tab === 'years' ? 'on' : ''} onClick={() => setTab('years')}>
            Your years
          </button>
        </div>
      </div>
      {tab === 'period' && <Sparks bank={bank} />}
      {tab === 'period' && <IncomeScreen bank={bank} unit={unit} />}
      {tab === 'why' && <QtrScreen bank={bank} unit={unit} />}
      {(tab === 'qoq' || tab === 'yoy') && <GrowthScreen bank={bank} mode={tab} />}
      {tab === 'years' && <YearsTable bank={bank} />}
    </div>
  );
}
