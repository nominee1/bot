import React, { useState } from 'react';
import AccountKeyedIframeEvenOdd from '../aabrickk/AccountKeyedIframeEvenOdd';
import BrickTower from '../abrick/BrickTower';
import ReloadAuto from '../autotradeR/ReloadAuto';
import ViewStrategy from '../aaac/ViewStrategy';
import './ViewPercentage.scss';

type ViewType = 'viewstrategy' | 'evenodd' | 'reloadauto' | 'bricktower';

const ViewPercentage = () => {
  // Default to Speed Bot
  const [activeView, setActiveView] = useState<ViewType>('viewstrategy');

  return (
    <div className="view-percentage">
      <div className="toggle-controls">
        {/* 1) Speed Bot */}
        <button
          className={`toggle-btn ${activeView === 'viewstrategy' ? 'active' : ''}`}
          onClick={() => setActiveView('viewstrategy')}
        >
          Speed Bot
        </button>

        {/* 2) Even Odd */}
        <button
          className={`toggle-btn ${activeView === 'evenodd' ? 'active' : ''}`}
          onClick={() => setActiveView('evenodd')}
        >
          Even Odd
        </button>

        {/* 3) Auto Bot */}
        <button
          className={`toggle-btn ${activeView === 'reloadauto' ? 'active' : ''}`}
          onClick={() => setActiveView('reloadauto')}
        >
          Auto Bot
        </button>

        {/* 4) Over Under */}
        <button
          className={`toggle-btn ${activeView === 'bricktower' ? 'active' : ''}`}
          onClick={() => setActiveView('bricktower')}
        >
          Over Under
        </button>
      </div>

      <div className="view-content">
        {activeView === 'viewstrategy' && <ViewStrategy />}
        {activeView === 'evenodd' && <AccountKeyedIframeEvenOdd />}
        {activeView === 'reloadauto' && <ReloadAuto />}
        {activeView === 'bricktower' && <BrickTower />}
      </div>
    </div>
  );
};

export default ViewPercentage;
