import React, { useState } from 'react';
import BotIframe from '../accumulators/BotIframe';
import Multiple from '../aaaStrategies/MultiplePredictions/multiple'; // 👈 ensure default export
import Iframe from '../accumtwo/Iframe';
import Flipa from '../aaflipaa/flipaa';
import './ViewToggle.scss';

type ViewType = 'botiframe' | 'multiple' | 'iframe' | 'flipa';

const ViewToggle = () => {
  const [activeView, setActiveView] = useState<ViewType>('botiframe');

  return (
    <div className="view-toggle-container">
      <div className="toggle-controls">
        <button
          className={`toggle-btn ${activeView === 'botiframe' ? 'active' : ''}`}
          onClick={() => setActiveView('botiframe')}
        >
          Instant Fill
        </button>

        <button
          className={`toggle-btn ${activeView === 'multiple' ? 'active' : ''}`}
          onClick={() => setActiveView('multiple')}
        >
          Multiple Stakes
        </button>

        <button
          className={`toggle-btn ${activeView === 'flipa' ? 'active' : ''}`}
          onClick={() => setActiveView('flipa')}
        >
          Flipa Switcher
        </button>

        <button
          className={`toggle-btn ${activeView === 'iframe' ? 'active' : ''}`}
          onClick={() => setActiveView('iframe')}
        >
          Instant Matches
        </button>
      </div>

      <div className="view-content">
        {activeView === 'botiframe' && <BotIframe />}
        {activeView === 'multiple' && <Multiple />}
        {activeView === 'flipa' && <Flipa />}
        {activeView === 'iframe' && <Iframe />}
      </div>
    </div>
  );
};

export default ViewToggle;
