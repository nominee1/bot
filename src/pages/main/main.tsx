import React, { lazy, Suspense, useCallback, useEffect, useRef } from 'react';
import classNames from 'classnames';
import {
    Brain,
    Calculator,
    Copy,
    Hand,
    Heart,
    Layers,
    LayoutDashboard,
    LineChart,
    Package,
    Puzzle,
    Rocket,
    Target,
    Timer,
    Users,
    Wallet,
    Wand2,
    Zap,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useLocation, useNavigate } from 'react-router-dom';
import FloatingRiskDisclaimer from '@/components/floating-risk-disclaimer/floating-risk-disclaimer';
import ChunkLoader from '@/components/loader/chunk-loader';
import DesktopWrapper from '@/components/shared_ui/desktop-wrapper';
import Dialog from '@/components/shared_ui/dialog';
import MobileWrapper from '@/components/shared_ui/mobile-wrapper';
import Tabs from '@/components/shared_ui/tabs/tabs';
import TradingViewModal from '@/components/trading-view-chart/trading-view-modal';
import { DBOT_TABS, MAIN_APP_TAB_INDEX } from '@/constants/bot-contents';
import { api_base, updateWorkspaceName } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { isDbotRTL } from '@/external/bot-skeleton/utils/workspace';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import RunPanel from '../../components/run-panel';
import ChartModal from '../chart/chart-modal';
import Dashboard from '../dashboard';
import RunStrategy from '../dashboard/run-strategy';

/** Lucide tab icons — same bundle / sizing as dbtraders. */
const TAB_ICON_PROPS = {
    size: 24,
    strokeWidth: 2.35,
    'aria-hidden': true,
    color: 'currentColor',
} as const;

// Lazy modules
const AviatorR = lazy(() => import('../aaviatorR/AviatorR'));
const ViewToggle = lazy(() => import('../aaa/ViewToggle'));
const BulkTrader = lazy(() => import('../bulk-trader'));
// Rise Fall tab hidden until feature is complete — component kept in src/pages/rise-fall-manual/
const ViewPercentage = lazy(() => import('../aaad/ViewPercentage'));
const RiskCalculator = lazy(() => import('../risk-calculator/RiskCalculator'));
// Asians Path Lab tab hidden until feature is complete — page kept in src/pages/asians-analysis/
const ParallelCopyTrading = lazy(() => import('../parallel-copy-trading/ParallelCopyTrading'));
const DTrader = lazy(() => import('../dtrader/DTrader'));
const SmartTrader = lazy(() => import('../smarttrader/SmartTrader'));
const Ready = lazy(() => import('../aaaReadyStrategy/ready'));
const DigitBarReady = lazy(() => import('../aaaDigitBarReady/DigitBarReady'));
const Multi = lazy(() => import('../aaabc/multi'));
// const Copytraders = lazy(() => import('../copytraders'));
// ROT Tokens tab hidden until needed — page kept in src/pages/rot-token-audit/
// const RotTokenAudit = lazy(() => import('../rot-token-audit'));
const ManualTrader = lazy(() => import('../manualtrader/ManualTrader'));
const SpeedBot = lazy(() => import('../aaaspeed/Speed'));
const FreeBots = lazy(() => import('../aaabots'));
const Withdrawal = lazy(() => import('../withdrawal'));

const AppWrapper = observer(() => {
    const { connectionStatus } = useApiBase();
    const { dashboard, load_modal, run_panel, quick_strategy, summary_card } = useStore();
    const {
        active_tab,
        active_tour,
        is_chart_modal_visible,
        is_trading_view_modal_visible,
        setActiveTab,
        setWebSocketState,
        setActiveTour,
        setTourDialogVisibility,
    } = dashboard;
    const { onEntered, dashboard_strategies } = load_modal;
    const {
        is_dialog_open,
        is_drawer_open,
        dialog_options,
        onCancelButtonClick,
        onCloseDialog,
        onOkButtonClick,
        stopBot,
        toggleDrawer,
    } = run_panel;
    const { is_open } = quick_strategy;
    const { cancel_button_text, ok_button_text, title, message } = dialog_options as { [key: string]: string };
    const { clear } = summary_card;
    const { DASHBOARD, BOT_BUILDER } = DBOT_TABS;

    const init_render = useRef(true);
    const hash = [
        'dashboard',
        'bot_builder',
        'Instant Fill',
        'free_bots',
        'Asians',
        'Bulk Trader',
        'DTrader',
        'Auto Strategy',
        'Manual Trader',
        'Speed Bot',
        'Ready Strategies',
        'Double Double',
        'Smart Trader',
        'Pro Aviator',
        'Risk Calculator',
        'Deposit',
        'Parallel Copy',
    ];
    const { isDesktop } = useDevice();
    const location = useLocation();
    const navigate = useNavigate();

    let tab_value: number | string = active_tab;
    const GetHashedValue = (tab: number) => {
        tab_value = location.hash?.split('#')[1];
        if (!tab_value) return tab;
        if (tab_value === 'Bulk Buy') return hash.indexOf('Bulk Trader');
        if (tab_value === 'bot_hacker' || tab_value === 'Bot Hacker' || tab_value === 'Free Bots') {
            return hash.indexOf('free_bots');
        }
        return Number(hash.indexOf(String(tab_value)));
    };
    const active_hash_tab = GetHashedValue(active_tab);

    // Connection guard: Blockly / free bots / Bot Settings only.
    // Flipaa & other ready strategies keep isRunning across socket swaps and resubscribe —
    // they never call stopBot on CLOSED. Blockly used to hard-stop after 3s, but Options OTP
    // reconnect (close → init(true) → new OTP WS) routinely takes longer, which killed free-bot
    // runs and showed "You're back online". Match Flipaa: stay running while api_base reconnects;
    // only stop after a long outage.
    useEffect(() => {
        if (connectionStatus === CONNECTION_STATUS.OPENED) {
            setWebSocketState(true);
            return;
        }

        if (connectionStatus !== CONNECTION_STATUS.CLOSED) {
            return;
        }

        const is_bot_running = document.getElementById('db-animation__stop-button') !== null;
        if (!is_bot_running) {
            return;
        }

        // OTP reconnect + authorize often exceeds 3–15s; keep the run alive like Flipaa.
        const reconnect_grace_ms = 60_000;
        const stop_timer = window.setTimeout(() => {
            if (document.getElementById('db-animation__stop-button') === null) {
                return;
            }
            // Reconnected in the meantime (status may lag behind the live socket).
            if (api_base.api?.connection?.readyState === 1) {
                setWebSocketState(true);
                return;
            }
            clear();
            stopBot();
            api_base.setIsRunning(false);
            setWebSocketState(false);
        }, reconnect_grace_ms);

        return () => window.clearTimeout(stop_timer);
    }, [clear, connectionStatus, setWebSocketState, stopBot]);

    // Instant Fill / Auto Strategy / Smart Trader / Manual Trader / Home: minimize side run panel; opens on Run.
    useEffect(() => {
        if (!isDesktop) return;
        const minimize_run_panel = (
            [
                MAIN_APP_TAB_INDEX.DASHBOARD,
                MAIN_APP_TAB_INDEX.INSTANT_FILL,
                MAIN_APP_TAB_INDEX.BULK_TRADER,
                MAIN_APP_TAB_INDEX.AUTO_STRATEGY,
                MAIN_APP_TAB_INDEX.SMART_TRADER_WORKSPACE,
                MAIN_APP_TAB_INDEX.MANUAL_TRADER,
                MAIN_APP_TAB_INDEX.SPEED_BOT,
            ] as number[]
        ).includes(active_tab);
        if (minimize_run_panel) {
            toggleDrawer(false);
        }
    }, [active_tab, isDesktop, toggleDrawer]);

    // Hash/tab sync
    useEffect(() => {
        if (is_open) {
            setTourDialogVisibility(false);
        }

        if (init_render.current) {
            setActiveTab(Number(active_hash_tab));
            init_render.current = false;
        } else {
            navigate(`#${hash[active_tab] || hash[0]}`);
        }
        if (active_tour !== '') {
            setActiveTour('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active_tab]);

    // Blockly trashcan positioning
    useEffect(() => {
        const trashcan_init_id = setTimeout(() => {
            if (active_tab === BOT_BUILDER && (window as any)?.Blockly?.derivWorkspace?.trashcan) {
                const trashcanY = window.innerHeight - 250;
                let trashcanX;
                if (is_drawer_open) {
                    trashcanX = isDbotRTL() ? 380 : window.innerWidth - 460;
                } else {
                    trashcanX = isDbotRTL() ? 20 : window.innerWidth - 100;
                }
                (window as any)?.Blockly?.derivWorkspace?.trashcan?.setTrashcanPosition(trashcanX, trashcanY);
            }
        }, 100);

        return () => {
            clearTimeout(trashcan_init_id);
        };
        //eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active_tab, is_drawer_open]);

    // Update workspace name when strategies list changes
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        if (dashboard_strategies.length > 0) {
            timer = setTimeout(() => {
                updateWorkspaceName();
            });
        }
        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [dashboard_strategies, active_tab]);

    const handleTabChange = useCallback(
        (tab_index: number) => {
            setActiveTab(tab_index);
        },
        [setActiveTab]
    );

    return (
        <React.Fragment>
            <div className='main'>
                <div
                    className={classNames('main__container', {
                        'main__container--active': active_tour && active_tab === DASHBOARD && !isDesktop,
                    })}
                >
                    <FloatingRiskDisclaimer />

                    <Tabs
                        active_index={active_tab}
                        className='main__tabs'
                        is_scrollable
                        onTabItemChange={onEntered}
                        onTabItemClick={handleTabChange}
                        top
                    >
                        <div
                            label={
                                <>
                                    <LayoutDashboard {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='Home' />
                                </>
                            }
                            id='id-dbot-dashboard'
                        >
                            <Dashboard handleTabChange={handleTabChange} />
                        </div>

                        <div
                            label={
                                <>
                                    <Puzzle {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='Bot Settings' />
                                </>
                            }
                            id='id-bot-builder'
                        />

                        <div
                            label={
                                <span className='tab-label tab-label--instant-fill'>
                                    <Timer {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='Instant Fill' />
                                </span>
                            }
                            id={
                                is_chart_modal_visible || is_trading_view_modal_visible
                                    ? 'id-charts--disabled'
                                    : 'id-charts'
                            }
                        >
                            <Suspense
                                fallback={<ChunkLoader message={localize('Please wait, loading Instant Fill...')} />}
                            >
                                <ViewToggle />
                            </Suspense>
                        </div>

                        <div
                            label={
                                <>
                                    <Package {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='Free bots' />
                                </>
                            }
                            id='id-free-bots'
                        >
                            <div className='tutorials-wrapper tutorials-wrapper--free-bots'>
                                <Suspense
                                    fallback={<ChunkLoader message={localize('Please wait, loading Free bots...')} />}
                                >
                                    <FreeBots />
                                </Suspense>
                            </div>
                        </div>

                        <div
                            label={
                                <>
                                    <Target {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='Asians' />
                                </>
                            }
                            id='id-smarttrader'
                        >
                            <div className='tutorials-wrapper tutorials-wrapper--dtrader tutorials-wrapper--smarttrader'>
                                <Suspense
                                    fallback={<ChunkLoader message={localize('Please wait, loading Asians...')} />}
                                >
                                    <SmartTrader />
                                </Suspense>
                            </div>
                        </div>

                        <div
                            label={
                                <span className='tab-label tab-label--bulk-trader'>
                                    <Layers {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='Bulk Trader' />
                                </span>
                            }
                            id='id-bulk-trader'
                        >
                            <div className='tutorials-wrapper tutorials-wrapper--bulk-trader'>
                                <Suspense
                                    fallback={<ChunkLoader message={localize('Please wait, loading Bulk Trader...')} />}
                                >
                                    <BulkTrader />
                                </Suspense>
                            </div>
                        </div>

                        <div
                            label={
                                <>
                                    <LineChart {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='DTrader' />
                                </>
                            }
                            id='id-dtrader'
                        >
                            <div className='tutorials-wrapper tutorials-wrapper--dtrader'>
                                <Suspense
                                    fallback={<ChunkLoader message={localize('Please wait, loading DTrader...')} />}
                                >
                                    <DTrader />
                                </Suspense>
                            </div>
                        </div>

                        <div
                            label={
                                <span className='tab-label tab-label--auto-strategy'>
                                    <Heart {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='Auto Strategy' />
                                </span>
                            }
                            id='id-digit-bar-ready'
                        >
                            <div className='tutorials-wrapper'>
                                <Suspense
                                    fallback={
                                        <ChunkLoader message={localize('Please wait, loading Auto Strategy...')} />
                                    }
                                >
                                    <DigitBarReady />
                                </Suspense>
                            </div>
                        </div>

                        <div
                            label={
                                <>
                                    <Hand {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='Manual Trader' />
                                </>
                            }
                            id='id-tutorials'
                        >
                            <div className='tutorials-wrapper tutorials-wrapper--manual-trader'>
                                <Suspense
                                    fallback={
                                        <ChunkLoader message={localize('Please wait, loading Manual Trader...')} />
                                    }
                                >
                                    <ManualTrader />
                                </Suspense>
                            </div>
                        </div>

                        <div
                            label={
                                <span className='tab-label tab-label--speed-bot'>
                                    <Zap {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='Speed Bot' />
                                </span>
                            }
                            id='id-speed-bot'
                        >
                            <div className='tutorials-wrapper tutorials-wrapper--speed-bot'>
                                <Suspense
                                    fallback={<ChunkLoader message={localize('Please wait, loading Speed Bot...')} />}
                                >
                                    <SpeedBot sideRunPanel />
                                </Suspense>
                            </div>
                        </div>

                        <div
                            label={
                                <>
                                    <Wand2 {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='Strategies' />
                                </>
                            }
                            id='id-tutorials'
                        >
                            <div className='tutorials-wrapper'>
                                <Suspense
                                    fallback={<ChunkLoader message={localize('Please wait, loading Strategies...')} />}
                                >
                                    <Ready />
                                </Suspense>
                            </div>
                        </div>

                        <div
                            label={
                                <>
                                    <Copy {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='Double Double' />
                                </>
                            }
                            id='id-tutorials'
                        >
                            <div className='tutorials-wrapper'>
                                <Suspense
                                    fallback={
                                        <ChunkLoader message={localize('Please wait, loading Double Double...')} />
                                    }
                                >
                                    <Multi />
                                </Suspense>
                            </div>
                        </div>
                        {/* <div
              label={
                <>
                  <Localize i18n_default_text='Defender' />
                </>
              }
              id='id-tutorials'
            >
              <div className='tutorials-wrapper'>
                <Suspense
                  fallback={<ChunkLoader message={localize('Please wait, loading Analysis...')} />}
                >
                  <P2PSafeTrader />
                </Suspense>
              </div>
            </div>  */}
                        <div
                            label={
                                <span className='tab-label tab-label--smart-trader'>
                                    <Brain {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='Smart Trader' />
                                </span>
                            }
                            id={
                                is_chart_modal_visible || is_trading_view_modal_visible
                                    ? 'id-charts--disabled'
                                    : 'id-charts'
                            }
                        >
                            <Suspense
                                fallback={<ChunkLoader message={localize('Please wait, loading Smart Trader...')} />}
                            >
                                <ViewPercentage />
                            </Suspense>
                        </div>

                        <div
                            label={
                                <>
                                    <Rocket {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='Pro Aviator' />
                                </>
                            }
                            id='id-tutorials'
                        >
                            <div className='tutorials-wrapper tutorials-wrapper--aviator'>
                                <Suspense
                                    fallback={<ChunkLoader message={localize('Please wait, loading Pro Aviator...')} />}
                                >
                                    <AviatorR />
                                </Suspense>
                            </div>
                        </div>

                        <div
                            label={
                                <>
                                    <Calculator {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='Risk Calculator' />
                                </>
                            }
                            id='id-risk-calculator'
                        >
                            <div className='tutorials-wrapper tutorials-wrapper--risk-calculator'>
                                <Suspense
                                    fallback={
                                        <ChunkLoader message={localize('Please wait, loading Risk Calculator...')} />
                                    }
                                >
                                    <RiskCalculator />
                                </Suspense>
                            </div>
                        </div>

                        <div
                            label={
                                <>
                                    <Wallet {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='Deposit' />
                                </>
                            }
                            id='id-deposit'
                        >
                            <div className='tutorials-wrapper tutorials-wrapper--withdrawal'>
                                <Suspense
                                    fallback={<ChunkLoader message={localize('Please wait, loading Deposit...')} />}
                                >
                                    <Withdrawal />
                                </Suspense>
                            </div>
                        </div>
                        <div
                            label={
                                <>
                                    <Users {...TAB_ICON_PROPS} />
                                    <Localize i18n_default_text='Copytrading' />
                                </>
                            }
                            id='id-parallel-copy'
                        >
                            <div className='tutorials-wrapper tutorials-wrapper--parallel-copy'>
                                <Suspense
                                    fallback={
                                        <ChunkLoader message={localize('Please wait, loading Parallel Copy...')} />
                                    }
                                >
                                    <ParallelCopyTrading />
                                </Suspense>
                            </div>
                        </div>

                        {/* Copytraders — re-enable when Oracle arming is ready again */}
                        {/* <div
                            label={
                                <>
                                    <Localize i18n_default_text='Copytraders' />
                                </>
                            }
                            id='id-copytraders'
                        >
                            <div className='tutorials-wrapper tutorials-wrapper--copytraders'>
                                <Suspense
                                    fallback={
                                        <ChunkLoader message={localize('Please wait, loading Copytraders...')} />
                                    }
                                >
                                    <Copytraders />
                                </Suspense>
                            </div>
                        </div> */}

                        {/* ROT Tokens — re-enable when audit tooling is needed again */}
                        {/* <div
                            label={
                                <>
                                    <Localize i18n_default_text='ROT Tokens' />
                                </>
                            }
                            id='id-rot-token-audit'
                        >
                            <div className='tutorials-wrapper tutorials-wrapper--rot-token-audit'>
                                <Suspense
                                    fallback={
                                        <ChunkLoader message={localize('Please wait, loading ROT token audit...')} />
                                    }
                                >
                                    <RotTokenAudit />
                                </Suspense>
                            </div>
                        </div> */}
                    </Tabs>
                </div>
            </div>

            <DesktopWrapper>
                <div className='main__run-strategy-wrapper'>
                    <RunStrategy />
                    <RunPanel />
                </div>
                <ChartModal />
                <TradingViewModal />
            </DesktopWrapper>

            <MobileWrapper>{!is_open && <RunPanel />}</MobileWrapper>

            {/* Existing global dialog */}
            <Dialog
                cancel_button_text={cancel_button_text || localize('Cancel')}
                className='dc-dialog__wrapper--fixed'
                confirm_button_text={ok_button_text || localize('Ok')}
                has_close_icon
                is_mobile_full_width={false}
                is_visible={is_dialog_open}
                onCancel={onCancelButtonClick}
                onClose={onCloseDialog}
                onConfirm={onOkButtonClick || onCloseDialog}
                portal_element_id='modal_root'
                title={title}
            >
                {message}
            </Dialog>
        </React.Fragment>
    );
});

export default AppWrapper;
