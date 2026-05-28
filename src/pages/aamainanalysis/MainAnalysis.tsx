import React, { useState } from 'react';
import OverAnalysis from '../aaaStrategies/marketAnalysis/analysis';
import Chart from '../chart/chart';
import './MainAnalysis.scss';

type ViewType = 'over' | 'chart';

const MainAnalysis = () => {
  const [activeView, setActiveView] = useState<ViewType>('over');

  return (
    <div className="view-toggle-two">
      <div className="toggle-controls">
        <button
          className={`toggle-btn ${activeView === 'over' ? 'active' : ''}`}
          onClick={() => setActiveView('over')}
        >
          Digit Monitor
        </button>

        <button
          className={`toggle-btn ${activeView === 'chart' ? 'active' : ''}`}
          onClick={() => setActiveView('chart')}
        >
          Chart
        </button>
      </div>

      <div className="view-content">
        {activeView === 'over' && <OverAnalysis />}
        {activeView === 'chart' && <Chart />}
      </div>
    </div>
  );
};

export default MainAnalysis;