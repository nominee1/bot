import React, { useState } from 'react';
import Deposit from '../aadeposit/Deposit';
import DepositTwo from '../aadeposittwo/DepositTwo';
import './ViewTrader.scss';

type ViewType = 'deposit' | 'depositTwo';

const ViewTrader: React.FC = () => {
  const [activeView, setActiveView] = useState<ViewType>('deposit');

  return (
    <div className="view-toggle-container">
      <div className="toggle-controls">
        <button
          className={`toggle-btn ${activeView === 'deposit' ? 'active' : ''}`}
          onClick={() => setActiveView('deposit')}
        >
          Traders Dashboard
        </button>

        <button
          className={`toggle-btn ${activeView === 'depositTwo' ? 'active' : ''}`}
          onClick={() => setActiveView('depositTwo')}
        >
          Copier Dashboard
        </button>
      </div>

      <div className="view-content">
        {activeView === 'deposit' && <Deposit />}
        {activeView === 'depositTwo' && <DepositTwo />}
      </div>
    </div>
  );
};

export default ViewTrader;
