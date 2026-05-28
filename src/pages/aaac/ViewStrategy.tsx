import React, { useState } from 'react';
import Speed from '../aaaStrategies/RecoverSameSR/Recover';
import EvenOddSwitcher from '../aaaStrategies/EvenOddSwitcher/EvenOddSwitcher';
import OverUnderSwitcher from '../aaaStrategies/OverUnderSwitcher/OverUnderSwitcher';
import RecoverSameStake from '../aaaStrategies/RecoverSameStake/RecoverSameStake';

import {
  TradeTypesDigitsEvenIcon,
  TradeTypesDigitsOddIcon,
  TradeTypesDigitsOverIcon,
  TradeTypesDigitsUnderIcon,
} from '@deriv/quill-icons';

import './ViewStrategy.scss';

type ViewType = 'speed' | 'evenOdd' | 'overUnder' | 'recoverSameStake';

const ViewStrategy: React.FC = () => {
  const [activeView, setActiveView] = useState<ViewType>('speed');

  return (
    <div className="view-toggle">
      <div className="toggle-controls">
        <button
          className={`toggle-btn ${activeView === 'speed' ? 'active' : ''}`}
          onClick={() => setActiveView('speed')}
        >
          Speed
        </button>

        {/* ✅ moved here: second after Speed */}
        <button
          className={`toggle-btn ${activeView === 'recoverSameStake' ? 'active' : ''}`}
          onClick={() => setActiveView('recoverSameStake')}
        >
          Same $ Recovery🔄
        </button>

        <button
          className={`toggle-btn ${activeView === 'evenOdd' ? 'active' : ''}`}
          style={{ display: 'flex', alignItems: 'center' }}
          onClick={() => setActiveView('evenOdd')}
        >
          <TradeTypesDigitsEvenIcon width={16} height={16} />
          Switcher
          <TradeTypesDigitsOddIcon width={16} height={16} />
        </button>

        <button
          className={`toggle-btn ${activeView === 'overUnder' ? 'active' : ''}`}
          style={{ display: 'flex', alignItems: 'center' }}
          onClick={() => setActiveView('overUnder')}
        >
          <TradeTypesDigitsOverIcon width={16} height={16} />
          Switcher
          <TradeTypesDigitsUnderIcon width={16} height={16} />
        </button>
      </div>

      <div className="view-content">
        {activeView === 'speed' && <Speed />}
        {activeView === 'evenOdd' && <EvenOddSwitcher />}
        {activeView === 'overUnder' && <OverUnderSwitcher />}
        {activeView === 'recoverSameStake' && <RecoverSameStake />}
      </div>
    </div>
  );
};

export default ViewStrategy;
