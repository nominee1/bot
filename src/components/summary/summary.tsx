import classnames from 'classnames';
import { observer } from 'mobx-react-lite';
import { READY_STRATEGY_RUN_PANEL_MAIN_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { useDevice } from '@deriv-com/ui';
import ThemedScrollbars from '../shared_ui/themed-scrollbars';
import ReadyStrategyRunSummary from './ready-strategy-run-summary';
import SummaryCard from './summary-card';

type TSummary = {
    is_drawer_open: boolean;
};

const Summary = observer(({ is_drawer_open }: TSummary) => {
    const { dashboard, summary_card, ready_strategy_panel } = useStore();
    const { is_contract_loading, contract_info, is_bot_running } = summary_card;
    const { active_tour, active_tab } = dashboard;
    const { isDesktop } = useDevice();

    if (ready_strategy_panel.is_attached && READY_STRATEGY_RUN_PANEL_MAIN_TABS.includes(active_tab)) {
        return <ReadyStrategyRunSummary is_drawer_open={is_drawer_open} />;
    }

    return (
        <div
            className={classnames({
                'run-panel-tab__content': isDesktop,
                'run-panel-tab__content--mobile': !isDesktop && is_drawer_open,
                'run-panel-tab__content--summary-tab': (isDesktop && is_drawer_open) || active_tour,
            })}
            data-testid='mock-summary'
        >
            <ThemedScrollbars
                className={classnames({
                    summary: (!is_contract_loading && !contract_info) || is_bot_running,
                    'summary--loading':
                        (!isDesktop && is_contract_loading) || (!isDesktop && !is_contract_loading && contract_info),
                })}
            >
                <SummaryCard
                    is_contract_loading={is_contract_loading}
                    contract_info={contract_info}
                    is_bot_running={is_bot_running}
                />
            </ThemedScrollbars>
        </div>
    );
});

export default Summary;
