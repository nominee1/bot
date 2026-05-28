import React, { lazy, Suspense, useEffect, useRef, useCallback } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useLocation, useNavigate } from 'react-router-dom';
import ChunkLoader from '@/components/loader/chunk-loader';
import DesktopWrapper from '@/components/shared_ui/desktop-wrapper';
import Dialog from '@/components/shared_ui/dialog';
import MobileWrapper from '@/components/shared_ui/mobile-wrapper';
import Tabs from '@/components/shared_ui/tabs/tabs';
import TradingViewModal from '@/components/trading-view-chart/trading-view-modal';
import { DBOT_TABS, TAB_IDS } from '@/constants/bot-contents';
import { api_base, updateWorkspaceName } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { isDbotRTL } from '@/external/bot-skeleton/utils/workspace';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';

import FloatingRiskDisclaimer from '@/components/floating-risk-disclaimer/floating-risk-disclaimer';
import RunPanel from '../../components/run-panel';
import ChartModal from '../chart/chart-modal';
import Dashboard from '../dashboard';
import RunStrategy from '../dashboard/run-strategy';
import Strategy from '../autotrade';
import DepositTwo from '../aadeposittwo';



// Lazy modules
const AviatorR = lazy(() => import('../aaviatorR/AviatorR'));
const ViewToggle = lazy(() => import('../aaa/ViewToggle'));
// Rise Fall tab hidden until feature is complete — component kept in src/pages/rise-fall-manual/
const ViewPercentage = lazy(() => import('../aaad/ViewPercentage'));
const RiskCalculator = lazy(() => import('../risk-calculator/RiskCalculator'));
const ParallelCopyTrading = lazy(() => import('../parallel-copy-trading/ParallelCopyTrading'));
// DTrader tab — re-enable when /dtrader deploy is ready
// const DTrader = lazy(() => import('../dtrader/DTrader'));
const Ready = lazy(() => import('../aaaReadyStrategy/ready'));
const DigitBarReady = lazy(() => import('../aaaDigitBarReady/DigitBarReady'));
const Multi = lazy(() => import('../aaabc/multi'));
const Deposit = lazy(() => import('../Rcompetition/Rcompetition'));
const ManualTrader = lazy(() => import('../manualtrader/ManualTrader'));

// Simple emoji component for consistent a11y/sizing
const Emoji: React.FC<{ symbol: string; label?: string; size?: number }> = ({ symbol, label, size = 24 }) => (
  <span
    className="emoji"
    role="img"
    aria-label={label || ''}
    aria-hidden={label ? 'false' : 'true'}
    style={{ fontSize: `${size}px`, lineHeight: 1, display: 'inline-block' }}
  >
    {symbol}
  </span>
);

const AppWrapper = observer(() => {
  const { connectionStatus } = useApiBase();
  const { dashboard, load_modal, run_panel, quick_strategy, summary_card, ready_strategy_panel } = useStore();
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
    'Smart Trader',
    'Pro Aviator',
    'Manual Trader',
    'Ready Strategies',
    'Double Double',
    'Auto Strategy',
    'Risk Calculator',
    'Parallel Copy',
    'Challenge',
    // 'DTrader', // re-enable with DTrader tab below
    'Oracle Live Trades',
];
  const { isDesktop } = useDevice();
  const location = useLocation();
  const navigate = useNavigate();

  let tab_value: number | string = active_tab;
  const GetHashedValue = (tab: number) => {
    tab_value = location.hash?.split('#')[1];
    if (!tab_value) return tab;
    return Number(hash.indexOf(String(tab_value)));
  };
  const active_hash_tab = GetHashedValue(active_tab);

  // Connection guard: stop bot when WS drops
  useEffect(() => {
    if (connectionStatus !== CONNECTION_STATUS.OPENED) {
      const is_bot_running = document.getElementById('db-animation__stop-button') !== null;
      const is_ready_running =
        document.getElementById('db-ready-strategy__stop-button') !== null ||
        ready_strategy_panel.is_strategy_running;
      if (is_ready_running) {
        ready_strategy_panel.invokeStopStrategy();
      }
      if (is_bot_running || is_ready_running) {
        clear();
        stopBot();
        api_base.setIsRunning(false);
        setWebSocketState(false);
      }
    }
  }, [clear, connectionStatus, ready_strategy_panel, setWebSocketState, stopBot]);

  // Hash/tab sync
  useEffect(() => {
    if (is_open) {
      setTourDialogVisibility(false);
    }

    if (init_render.current) {
      setActiveTab(Number(active_hash_tab));
      if (!isDesktop) handleTabChange(Number(active_hash_tab));
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
      if ((active_tab === BOT_BUILDER) && (window as any)?.Blockly?.derivWorkspace?.trashcan) {
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
      const el_id = TAB_IDS[tab_index];
      if (el_id) {
        const el_tab = document.getElementById(el_id);
        setTimeout(() => {
          el_tab?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }, 10);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active_tab]
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
                  <Emoji symbol="🛖" size={24} />
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
                  <Emoji symbol="🤖 " size={24} />
                  <Localize i18n_default_text='Bot Settings' />
                </>
              }
              id='id-bot-builder'
            />

            <div
              label={
                <span className="tab-label tab-label--instant-fill">
                  <Emoji symbol="⏱️" size={24} />
                  <Localize i18n_default_text="Instant Fill" />
                </span>
              }
              id={
                is_chart_modal_visible || is_trading_view_modal_visible
                  ? 'id-charts--disabled'
                  : 'id-charts'
              }
            >
              <Suspense fallback={<ChunkLoader message={localize('Please wait, loading Instant Fill...')} />}>
                <ViewToggle />
              </Suspense>
            </div>

            <div
              label={
                <span className="tab-label tab-label--smart-trader">
                  <Emoji symbol="🧠" size={19} />
                  <Localize i18n_default_text="Smart Trader" />
                </span>
              }
              id={
                is_chart_modal_visible || is_trading_view_modal_visible
                  ? 'id-charts--disabled'
                  : 'id-charts'
              }
            >
              <Suspense fallback={<ChunkLoader message={localize('Please wait, loading Smart Trader...')} />}>
                <ViewPercentage />
              </Suspense>
            </div>


            <div
              label={
                <>
                  <Emoji symbol="📡" size={16} />
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
                  <Emoji symbol="✍️ " size={16} />
                  <Localize i18n_default_text='Manual Trader' />
                </>
              }
              id='id-tutorials'
            >
              <div className='tutorials-wrapper tutorials-wrapper--manual-trader'>
                <Suspense
                  fallback={<ChunkLoader message={localize('Please wait, loading Manual Trader...')} />}
                >
                  <ManualTrader />
                </Suspense>
              </div>
            </div>

            <div
              label={
                <>
                  <Emoji symbol="🎯" size={18} />
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
                  <Emoji symbol="2️⃣2️⃣" size={16} />
                  <Localize i18n_default_text='Double Double' />
                </>
              }
              id='id-tutorials'
            >
              <div className='tutorials-wrapper'>
                <Suspense
                  fallback={<ChunkLoader message={localize('Please wait, loading Double Double...')} />}
                >
                  <Multi />
                </Suspense>
              </div>
            </div>
            {/* <div
              label={
                <>
                  <Emoji symbol="🪖" size={16} />
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
                <>
                  <Emoji symbol="💚" size={18} />
                  <Localize i18n_default_text='Auto Strategy' />
                </>
              }
              id='id-digit-bar-ready'
            >
              <div className='tutorials-wrapper'>
                <Suspense
                  fallback={<ChunkLoader message={localize('Please wait, loading Auto Strategy...')} />}
                >
                  <DigitBarReady />
                </Suspense>
              </div>
            </div>
            <div
              label={
                <>
                  <Emoji symbol="📐" size={18} />
                  <Localize i18n_default_text='Risk Calculator' />
                </>
              }
              id='id-risk-calculator'
            >
              <div className='tutorials-wrapper tutorials-wrapper--risk-calculator'>
                <Suspense
                  fallback={<ChunkLoader message={localize('Please wait, loading Risk Calculator...')} />}
                >
                  <RiskCalculator />
                </Suspense>
              </div>
            </div>
            <div
              label={
                <>
                  <Emoji symbol="📝" size={16} />
                  <Localize i18n_default_text='Copytrading' />
                </>
              }
              id='id-parallel-copy'
            >
              <div className='tutorials-wrapper tutorials-wrapper--parallel-copy'>
                <Suspense
                  fallback={<ChunkLoader message={localize('Please wait, loading Parallel Copy...')} />}
                >
                  <ParallelCopyTrading />
                </Suspense>
              </div>
            </div>

            <div
              label={
                <>
                  <Emoji symbol="🌍" size={16} />
                  <Localize i18n_default_text='Challenge' />
                </>
              }
              id='id-tutorials'
            >
              <div className='tutorials-wrapper tutorials-wrapper--manual-trader'>
                <Suspense
                  fallback={<ChunkLoader message={localize('Please wait, loading Challenge...')} />}
                >
                  <Deposit />
                </Suspense>
              </div>
            </div>

            {/* DTrader tab — re-enable when /dtrader deploy is ready (see lazy import above) */}

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
