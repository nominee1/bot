import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import ReactJoyrideWrapper from '../common/react-joyride-wrapper';
import TourStartDialog from '../common/tour-start-dialog';
import { DBOT_ONBOARDING } from '../tour-content';
import { useTourHandler } from '../useTourHandler';

const OnboardingTourDesktop = observer(() => {
    const { dashboard } = useStore();
    const { active_tour, setActiveTour } = dashboard;
    const { is_close_tour, is_finished, handleJoyrideCallback, setIsCloseTour } = useTourHandler();
    React.useEffect(() => {
        if (is_close_tour || is_finished) {
            setIsCloseTour(false);
            setActiveTour('');
        }
    }, [is_close_tour, is_finished, setActiveTour, setIsCloseTour]);

    // Onboarding tour no longer opens automatically on dashboard load (user can start from Tutorials if needed).

    return (
        <>
            <TourStartDialog />
            {active_tour && (
                <ReactJoyrideWrapper handleCallback={handleJoyrideCallback} steps={DBOT_ONBOARDING} spotlightClicks />
            )}
        </>
    );
});

export default OnboardingTourDesktop;
