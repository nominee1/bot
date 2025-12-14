import React, { lazy, Suspense, useEffect, useRef, useState, useCallback } from 'react';
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

import RunPanel from '../../components/run-panel';
import ChartModal from '../chart/chart-modal';
import Dashboard from '../dashboard';
import RunStrategy from '../dashboard/run-strategy';
import ParticipantsLeaderboard from '../aaaaleaderboard';
import Deposit from '../aadeposit';
import DenaraAccount from '../aaaDenaraAccount/DenaraAccount';
import SignupTournament from '../aaaasignup';
import Copier from '../aaacopier/CopiersBalances';
import CopiersBalances from '../aaacopier/CopiersBalances';
import Tournament from '../aaaatonament';
import BinaryTetris from '../aaaaTetris/BinaryTetris';

// Lazy modules
const ViewTrader = lazy(() => import('../aaab/ViewTrader'));
const Risk = lazy(() => import('../Risk/Risk'));
const ViewStrategy = lazy(() => import('../aaac/ViewStrategy'));
const AviatorR = lazy(() => import('../aaviatorR/AviatorR'));
const ViewToggle = lazy(() => import('../aaa/ViewToggle'));
const ViewPercentage = lazy(() => import('../aaad/ViewPercentage'));
const FundTrader = lazy(() => import('../aaaFund/FundTrader'));
const MainAnalysis = lazy(() => import('../aamainanalysis/MainAnalysis'));
const Bots = lazy(() => import('../aaabots/Bots'));

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
  } = run_panel;
  const { is_open } = quick_strategy;
  const { cancel_button_text, ok_button_text, title, message } = dialog_options as { [key: string]: string };
  const { clear } = summary_card;
  const { DASHBOARD, BOT_BUILDER } = DBOT_TABS;

  // Floating Risk modal state
  const [is_risk_open, setIsRiskOpen] = useState(false);
  const openRisk = useCallback(() => setIsRiskOpen(true), []);
  const closeRisk = useCallback(() => setIsRiskOpen(false), []);

  const init_render = useRef(true);
  const hash = ['dashboard', 'bot_builder', 'Instant Fill', 'Smart Trader', 'Pro Aviator', 'Analysis', 'CopyTrading', 'Bots', 'Tournament'];
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
      if (is_bot_running) {
        clear();
        stopBot();
        api_base.setIsRunning(false);
        setWebSocketState(false);
      }
    }
  }, [clear, connectionStatus, setWebSocketState, stopBot]);

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
          {/* Floating Risk Button */}
          <div
            className="risk-fab"
            role="button"
            aria-label="Open Risk controls"
            onClick={openRisk}
            title={localize('Risk Disclaimer')}
          >
            <Emoji symbol="⚠️" size={18} />
            <span>{localize('Risk')}</span>
          </div>

          <Tabs
            active_index={active_tab}
            className='main__tabs'
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
              <div className='tutorials-wrapper'>
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
                  <Emoji symbol="🔍" size={16} />
                  <Localize i18n_default_text='Analysis' />
                </>
              }
              id='id-tutorials'
            >
              <div className='tutorials-wrapper'>
                <Suspense
                  fallback={<ChunkLoader message={localize('Please wait, loading Analysis...')} />}
                >
                  <MainAnalysis />
                </Suspense>
              </div>
            </div>

            <div
              label={
                <>
                  <Emoji symbol="👥" size={18} />
                  <Localize i18n_default_text='CopyTrading' />
                </>
              }
              id='id-tutorials'
            >
              <div className='tutorials-wrapper'>
                <Suspense
                  fallback={<ChunkLoader message={localize('Please wait, loading Copytrading...')} />}
                >
                  <Deposit />
                </Suspense>
              </div>
            </div>
            <div
              label={
                <>
                  <Emoji symbol="🦾" size={18} />
                  <Localize i18n_default_text='Bots' />
                </>
              }
              id='id-tutorials'
            >
              <div className='tutorials-wrapper'>
                <Suspense
                  fallback={<ChunkLoader message={localize('Please wait, loading Bots...')} />}
                >
                  <BinaryTetris />
                </Suspense>
              </div>
            </div>
            {/* <div
              label={
                <>
                  <Emoji symbol="🏆" size={18} />
                  <Localize i18n_default_text='Tournament' />
                </>
              }
              id='id-tutorials'
            >
              <div className='tutorials-wrapper'>
                <Suspense
                  fallback={<ChunkLoader message={localize('Please wait, loading Tournament...')} />}
                >
                  <ParticipantsLeaderboard />
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

      {/* Risk Modal */}
      <Dialog
        className="risk-modal"
        has_close_icon
        is_mobile_full_width={true}
        is_visible={is_risk_open}
        onCancel={closeRisk}
        onClose={closeRisk}
        onConfirm={closeRisk}
        cancel_button_text={localize('Close')}
        confirm_button_text={localize('Done')}
        portal_element_id="modal_root"
        title={localize('Risk Controls')}
      >
        <Suspense fallback={<ChunkLoader message={localize('Loading Risk controls…')} />}>
          <Risk />
        </Suspense>
      </Dialog>
    </React.Fragment>
  );
});

export default AppWrapper;
