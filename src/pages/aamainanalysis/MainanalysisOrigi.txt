import React, { useState } from 'react';
import EvenAnalysis from '../even/EvenAnalysis';
import OverAnalysis from '../aaaStrategies/marketAnalysis/analysis';
import Rise from '../arisefall/Rise';
import Chart from '../chart/chart';
import TradingViewComponent from '@/components/trading-view-chart/trading-view';
import './MainAnalysis.scss';

type ViewType = 'even' | 'over' | 'rise' | 'chart' | 'tradingview';

const MainAnalysis = () => {
  // Default to 'chart'
  const [activeView, setActiveView] = useState<ViewType>('chart');

  return (
    <div className="view-toggle-two">
      <div className="toggle-controls">
        <button
          className={`toggle-btn ${activeView === 'chart' ? 'active' : ''}`}
          onClick={() => setActiveView('chart')}
        >
          Chart
        </button>

        <button
          className={`toggle-btn ${activeView === 'over' ? 'active' : ''}`}
          onClick={() => setActiveView('over')}
        >
          Digit Monitor
        </button>

        <button
          className={`toggle-btn ${activeView === 'even' ? 'active' : ''}`}
          onClick={() => setActiveView('even')}
        >
          Even | Odd
        </button>

        <button
          className={`toggle-btn ${activeView === 'rise' ? 'active' : ''}`}
          onClick={() => setActiveView('rise')}
        >
          Rise | Fall
        </button>

        {/* New: TradingView toggle (last) */}
        <button
          className={`toggle-btn ${activeView === 'tradingview' ? 'active' : ''}`}
          onClick={() => setActiveView('tradingview')}
        >
          TradingView
        </button>
      </div>

      <div className="view-content">
        {activeView === 'chart' && <Chart />}
        {activeView === 'even' && <EvenAnalysis />}
        {activeView === 'over' && <OverAnalysis />}
        {activeView === 'rise' && <Rise />}
        {activeView === 'tradingview' && <TradingViewComponent />}
      </div>
    </div>
  );
};

export default MainAnalysis;
