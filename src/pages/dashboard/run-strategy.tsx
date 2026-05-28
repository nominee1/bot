import { observer } from 'mobx-react-lite';
import ReadyStrategyFloatingStop from '@/components/ready-strategy/ready-strategy-floating-stop';
import { MAIN_APP_TAB_INDEX, READY_STRATEGY_RUN_PANEL_MAIN_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import TradeAnimation from '@/components/trade-animation';
import './run-strategy.scss';

const RunStrategy = observer(() => {
    const { dashboard, ready_strategy_panel } = useStore();
    const { active_tab } = dashboard;
    const is_ready_style_tab = READY_STRATEGY_RUN_PANEL_MAIN_TABS.includes(active_tab);
    const show_strategy_stop =
        ready_strategy_panel.is_strategy_running && is_ready_style_tab;
    const hide_trade_animation_on_ready_idle =
        (active_tab === MAIN_APP_TAB_INDEX.READY_STRATEGIES ||
            active_tab === MAIN_APP_TAB_INDEX.AUTO_STRATEGY) &&
        !ready_strategy_panel.is_strategy_running;

    return (
        <div className='run-strategy-detached' data-testid='dt_run_strategy'>
            {show_strategy_stop ? (
                <ReadyStrategyFloatingStop className='run-strategy-detached__animation' />
            ) : (
                !hide_trade_animation_on_ready_idle && <TradeAnimation className='run-strategy-detached__animation' />
            )}
        </div>
    );
});

export default RunStrategy;
