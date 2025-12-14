import React, { useState } from 'react';
import SignUp from '../aaaasignup/SignupTournament';
import Participants from '../aaaaleaderboard/ParticipantsLeaderboard';
import './Competition.scss';

type ViewType = 'signup' | 'participants';

const Competition = () => {
  const [activeView, setActiveView] = useState<ViewType>('signup');

  return (
    <div className="competition">
      <div className="toggle-controls">
        <button
          className={`toggle-btn ${activeView === 'signup' ? 'active' : ''}`}
          onClick={() => setActiveView('signup')}
        >
          Register
        </button>

        <button
          className={`toggle-btn ${activeView === 'participants' ? 'active' : ''}`}
          onClick={() => setActiveView('participants')}
        >
          Leader Board
        </button>
      </div>

      <div className="view-content">
        {activeView === 'signup' && <SignUp />}
        {activeView === 'participants' && <Participants />}
      </div>
    </div>
  );
};

export default Competition;
