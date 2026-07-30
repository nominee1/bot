import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import ContractResultOverlay from '@/components/contract-result-overlay';
import { contract_stages } from '@/constants/contract-stage';
import { useStore } from '@/hooks/useStore';
import { LabelPairedPlayLgFillIcon, LabelPairedSquareLgFillIcon } from '@deriv/quill-icons/LabelPaired';
import { Localize, localize } from '@deriv-com/translations';
import { rudderStackSendRunBotEvent } from '../../analytics/rudderstack-common-events';
import Button from '../shared_ui/button';
import CircularWrapper from './circular-wrapper';
import ContractStageText from './contract-stage-text';

type TTradeAnimation = {
    className?: string;
    should_show_overlay?: boolean;
};

const TradeAnimation = observer(({ className, should_show_overlay }: TTradeAnimation) => {
    const { dashboard, run_panel, summary_card, ready_strategy_panel, ui } = useStore();
    const { client } = useStore();
    const { active_tab } = dashboard;
    const { is_contract_completed, profit } = summary_card;
    const {
        contract_stage,
        is_stop_button_visible,
        is_stop_button_disabled,
        onRunButtonClick,
        onStopBotClick,
        performSelfExclusionCheck,
    } = run_panel;
    const { account_status } = client;
    const cashier_validation = account_status?.cashier_validation;
    const [shouldDisable, setShouldDisable] = React.useState(false);
    const is_unavailable_for_payment_agent = cashier_validation?.includes('WithdrawServiceUnavailableForPA');
    // Read from store instance during render so MobX tracks the observable reliably.
    const is_fast = ui.trade_execution_mode === 'fast';

    // perform self-exclusion checks which will be stored under the self-exclusion-store
    React.useEffect(() => {
        performSelfExclusionCheck();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    React.useEffect(() => {
        if (shouldDisable) {
            setTimeout(() => {
                setShouldDisable(false);
            }, 1000);
        }
    }, [shouldDisable]);

    const status_classes = ['', '', ''];
    const is_purchase_sent = contract_stage === (contract_stages.PURCHASE_SENT as unknown);
    const is_purchase_received = contract_stage === (contract_stages.PURCHASE_RECEIVED as unknown);

    let progress_status = contract_stage - (is_purchase_sent || is_purchase_received ? 2 : 3);

    if (progress_status >= 0) {
        if (progress_status < status_classes.length) {
            status_classes[progress_status] = 'active';
        }

        if (is_contract_completed) {
            progress_status += 1;
        }

        for (let i = 0; i < progress_status - 1; i++) {
            status_classes[i] = 'completed';
        }
    }

    const is_disabled = is_stop_button_disabled || shouldDisable;

    const button_props = React.useMemo(() => {
        if (is_stop_button_visible) {
            return {
                id: 'db-animation__stop-button',
                class: 'animation__stop-button',
                text: <Localize i18n_default_text='Stop' />,
                icon: <LabelPairedSquareLgFillIcon fill='#fff' />,
            };
        }
        return {
            id: 'db-animation__run-button',
            class: 'animation__run-button',
            text: <Localize i18n_default_text='Run' />,
            icon: <LabelPairedPlayLgFillIcon fill='#fff' />,
        };
    }, [is_stop_button_visible]);
    const show_overlay = should_show_overlay && is_contract_completed;
    // Only swap to progress while the bot is actually running / has an open contract.
    // Using contract_stage > 0 hid the toggle after runs when stage stayed stale.
    const show_progress = is_stop_button_visible;

    const TAB_NAMES = ['dashboard', 'bot_builder', 'charts', 'dtrader'] as const;
    const getTabName = (index: number) => TAB_NAMES[index];

    const onToggleExecutionMode = (event: React.MouseEvent | React.KeyboardEvent) => {
        event.preventDefault();
        event.stopPropagation();
        ui.toggleTradeExecutionMode();
    };

    return (
        <div className={classNames('animation__wrapper', className)}>
            <Button
                is_disabled={is_disabled && !is_unavailable_for_payment_agent}
                className={button_props.class}
                id={button_props.id}
                icon={button_props.icon}
                onClick={() => {
                    setShouldDisable(true);
                    if (is_stop_button_visible) {
                        if (ready_strategy_panel.is_strategy_running && ready_strategy_panel.stop_strategy_fn) {
                            ready_strategy_panel.invokeStopStrategy();
                        } else {
                            onStopBotClick();
                        }
                        return;
                    }
                    if (ready_strategy_panel.start_strategy_fn) {
                        ready_strategy_panel.invokeStartStrategy();
                        rudderStackSendRunBotEvent({ subpage_name: getTabName(active_tab) });
                        return;
                    }
                    onRunButtonClick();
                    rudderStackSendRunBotEvent({ subpage_name: getTabName(active_tab) });
                }}
                has_effect
                {...(is_stop_button_visible || !is_unavailable_for_payment_agent ? { primary: true } : { green: true })}
            >
                {button_props.text}
            </Button>
            {show_progress ? (
                <div
                    className={classNames('animation__container', className, {
                        'animation--running': contract_stage > 0,
                        'animation--completed': show_overlay,
                    })}
                >
                    {show_overlay && <ContractResultOverlay profit={profit} />}
                    <span className='animation__text'>
                        <ContractStageText contract_stage={contract_stage} />
                    </span>
                    <div className='animation__progress'>
                        <div className='animation__progress-line'>
                            <div className={`animation__progress-bar animation__progress-${contract_stage}`} />
                        </div>
                        {status_classes.map((status_class, i) => (
                            <CircularWrapper key={`status_class-${status_class}-${i}`} className={status_class} />
                        ))}
                    </div>
                </div>
            ) : (
                <button
                    type='button'
                    className={classNames('animation__execution', {
                        'animation__execution--fast': is_fast,
                        'animation__execution--normal': !is_fast,
                    })}
                    onClick={onToggleExecutionMode}
                    aria-pressed={is_fast}
                    aria-label={localize('Toggle fast execution mode')}
                    title={
                        is_fast
                            ? localize('Fast: minimal delays between bot actions')
                            : localize('Normal: paced execution with short delays')
                    }
                >
                    <div className='animation__execution-copy'>
                        <span className='animation__execution-label'>
                            <Localize i18n_default_text='Execution' />
                        </span>
                        <span className='animation__execution-mode'>
                            {is_fast ? localize('FAST') : localize('NORMAL')}
                        </span>
                    </div>
                    <span
                        className={classNames('animation__execution-toggle', {
                            'animation__execution-toggle--on': is_fast,
                        })}
                        aria-hidden
                    >
                        <span className='animation__execution-toggle-thumb' />
                    </span>
                </button>
            )}
        </div>
    );
});

export default TradeAnimation;
