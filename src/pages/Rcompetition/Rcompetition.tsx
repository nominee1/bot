import { useCallback, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { getDenaraCompetitionUsername } from '@/components/shared/utils/competition/denara-competition-profile';
import { useStore } from '@/hooks/useStore';
import Iframe from '../aaaCompleted/ CompletedChallenges';
import BotIframe from '../aaaalivetrading/liveCompetition'; // 👈 ensure default export
import Multiple from '../aaaongoing/onGoingChallenges';
import './Rcompetition.scss';

type ViewType = 'botiframe' | 'multiple' | 'iframe';

const ViewToggle = observer(() => {
  const [activeView, setActiveView] = useState<ViewType>('botiframe');
  const { client } = useStore();

  const validateJoinerForChallenge = useCallback(
    async (username: string) => {
      const expected = getDenaraCompetitionUsername();
      if (!expected?.trim()) {
        throw new Error(
          'Register your Denara username first: tap the floating Denara ID button, then open the Challenge tab.'
        );
      }
      if (username.trim().toLowerCase() !== expected.trim().toLowerCase()) {
        throw new Error(`Join using your saved Denara username: "${expected}"`);
      }
      if (!client?.is_logged_in) {
        throw new Error('Log in with Deriv so we can verify your balance.');
      }
      const balance = parseFloat(String(client.balance ?? '0'));
      return {
        balance: Number.isFinite(balance) ? balance : 0,
        currency: client.currency || 'USD',
        is_virtual: client.is_virtual ? 1 : 0,
        loginid: client.loginid || '',
      };
    },
    [client]
  );

  const savedDenaraName = getDenaraCompetitionUsername() ?? '';

  return (
    <div className="view-tt">
      <div className="toggle-controls">
        <button
          type="button"
          className={`toggle-btn ${activeView === 'botiframe' ? 'active' : ''}`}
          onClick={() => setActiveView('botiframe')}
        >
          Register
        </button>

        <button
          type="button"
          className={`toggle-btn ${activeView === 'multiple' ? 'active' : ''}`}
          onClick={() => setActiveView('multiple')}
        >
          Ongoing
        </button>

        <button
          type="button"
          className={`toggle-btn ${activeView === 'iframe' ? 'active' : ''}`}
          onClick={() => setActiveView('iframe')}
        >
          Completed
        </button>
      </div>

      <div className="view-content">
        {activeView === 'botiframe' && <BotIframe />}
        {activeView === 'multiple' && (
          <Multiple onValidateJoiner={validateJoinerForChallenge} defaultJoinUsername={savedDenaraName} />
        )}
        {activeView === 'iframe' && <Iframe />}
      </div>
    </div>
  );
});

export default ViewToggle;