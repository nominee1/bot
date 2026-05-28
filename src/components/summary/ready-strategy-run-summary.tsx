import classnames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useDevice } from '@deriv-com/ui';
import ReadyPositionsList from '@/pages/aaaReadyStrategy/ready-positions-list';
import ThemedScrollbars from '../shared_ui/themed-scrollbars';
import './ready-strategy-run-summary.scss';

type TReadyStrategyRunSummary = {
    is_drawer_open: boolean;
};

const ReadyStrategyRunSummary = observer(({ is_drawer_open }: TReadyStrategyRunSummary) => {
    const { dashboard, ready_strategy_panel } = useStore();
    const { isDesktop } = useDevice();
    const { active_tour } = dashboard;
    const { trades } = ready_strategy_panel;

    return (
        <div
            className={classnames({
                'run-panel-tab__content': isDesktop,
                'run-panel-tab__content--mobile': !isDesktop && is_drawer_open,
                'run-panel-tab__content--summary-tab': (isDesktop && is_drawer_open) || active_tour,
            })}
            data-testid='ready-strategy-summary'
        >
            <ThemedScrollbars className='ready-strategy-panel-summary'>
                <ReadyPositionsList trades={trades} />
            </ThemedScrollbars>
        </div>
    );
});

export default ReadyStrategyRunSummary;
