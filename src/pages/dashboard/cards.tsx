// Cards.tsx — dashboard tiles (mobile-first, no "recent bots"), adds TOURNAMENT card
// kept some things commented because of mobx to integrate popup functionality here
import React, { lazy, Suspense, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import GoogleDrive from '@/components/load-modal/google-drive';
import Dialog from '@/components/shared_ui/dialog';
import MobileFullPageModal from '@/components/shared_ui/mobile-full-page-modal';
import Text from '@/components/shared_ui/text';
import { DBOT_TABS, MAIN_APP_TAB_INDEX } from '@/constants/bot-contents';
import { QUICK_ACCESS_EVENTS, QUICK_ACCESS_SESSION } from '@/constants/quick-access-session';
import { useStore } from '@/hooks/useStore';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import { rudderStackSendOpenEvent } from '../../analytics/rudderstack-common-events';
import { rudderStackSendDashboardClickEvent } from '../../analytics/rudderstack-dashboard';
import './cards-signal-hub.scss';
// import DashboardBotList from './bot-list/dashboard-bot-list'; // removed "recent bots" section

const BrickTowerLazy = lazy(() => import('@/pages/abrick/BrickTower'));
const P2PSafeTraderLazy = lazy(() => import('@/pages/aap2psafe/P2PSafeTrader'));
const SpeedLazy = lazy(() => import('@/pages/aaaspeed/Speed'));
const AviatorLazy = lazy(() => import('@/pages/aaviator/Aviator'));
const StrategyLazy = lazy(() => import('@/pages/autotrade/Strategy'));
const IframeEvenOddLazy = lazy(() => import('@/pages/abbrick/IframeEvenOdd'));
const ManualTraderLazy = lazy(() => import('@/pages/manualtrader/ManualTrader'));
const FlipaaLazy = lazy(() => import('@/pages/aaflipaa/flipaa'));
const MultiLazy = lazy(() => import('@/pages/aaabc/multi'));

type TSignalHubCard =
  | null
  | 'brick'
  | 'p2p'
  | 'speed'
  | 'aviator'
  | 'strategy'
  | 'evenodd'
  | 'manual'
  | 'flipaa'
  | 'multi';

const HUB_DETAIL_TITLES: Record<Exclude<TSignalHubCard, null>, string> = {
  brick: 'Over|Under Signals',
  p2p: 'Denara Defender',
  speed: 'Speed Bot',
  aviator: 'Aviator',
  strategy: 'Auto Trade',
  evenodd: 'Even / Odd',
  manual: 'Manual Trader',
  flipaa: 'Flipaa',
  multi: 'Double Strategy',
};

type TCardProps = {
  has_dashboard_strategies: boolean;
  is_mobile: boolean;
};

type TCardItem = {
  id: string;
  icon: React.ReactElement;
  label: React.ReactElement | string;
  onPress: () => void;
};

type TCommodityNavItem = {
  id: string;
  /** Ticker-style abbreviation shown on the pill */
  abbr: string;
  /** Full component name (tooltip / a11y) */
  code: string;
  price: string;
  change: string;
  isUp: boolean;
  onPress: () => void;
};

// Simple emoji component for consistent a11y/sizing
const Emoji: React.FC<{ symbol: string; label?: string; size?: number }> = ({ symbol, label, size = 48 }) => (
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

const Cards = observer(({ is_mobile, has_dashboard_strategies }: TCardProps) => {
  const { dashboard, load_modal, quick_strategy } = useStore();
  const { toggleLoadModal, setActiveTabIndex } = load_modal;
  const { isDesktop } = useDevice();
  const { onCloseDialog, dialog_options, is_dialog_open, setActiveTab, setPreviewOnPopup } = dashboard;
  const { setFormVisibility } = quick_strategy;

  const [signalHubOpen, setSignalHubOpen] = useState(false);
  const [signalHubCard, setSignalHubCard] = useState<TSignalHubCard>(null);
  const [brickTowerRunPanel, setBrickTowerRunPanel] = useState(false);
  const [hubEmbedMountId, setHubEmbedMountId] = useState(0);
  const [signalHubSheetExpanded, setSignalHubSheetExpanded] = useState(false);
  const hubSwipeRef = useRef<{ y0: number } | null>(null);

  const closeSignalHub = () => {
    setSignalHubOpen(false);
    setSignalHubCard(null);
    setBrickTowerRunPanel(false);
    setSignalHubSheetExpanded(false);
  };

  const openHubEmbed = (card: Exclude<TSignalHubCard, null>) => {
    setSignalHubCard(card);
    setBrickTowerRunPanel(false);
    setSignalHubSheetExpanded(false);
    setHubEmbedMountId(n => n + 1);
  };

  const toggleSignalHub = () => {
    setSignalHubOpen(prev => {
      const next = !prev;
      if (next) {
        setSignalHubCard(null);
        setBrickTowerRunPanel(false);
        setSignalHubSheetExpanded(false);
      } else {
        setSignalHubCard(null);
        setBrickTowerRunPanel(false);
        setSignalHubSheetExpanded(false);
      }
      return next;
    });
  };

  const handleHubEdgeTouchStart = (e: React.TouchEvent) => {
    if (!signalHubCard || e.touches.length !== 1) return;
    hubSwipeRef.current = { y0: e.touches[0].clientY };
  };

  const handleHubEdgeTouchEnd = (e: React.TouchEvent) => {
    if (!signalHubCard || !hubSwipeRef.current) {
      hubSwipeRef.current = null;
      return;
    }
    const y1 = e.changedTouches[0]?.clientY;
    if (typeof y1 !== 'number') {
      hubSwipeRef.current = null;
      return;
    }
    const delta = hubSwipeRef.current.y0 - y1;
    hubSwipeRef.current = null;
    if (delta > 52) setSignalHubSheetExpanded(true);
    else if (delta < -56) setSignalHubSheetExpanded(false);
  };

  const hubDetailTitle = signalHubCard ? HUB_DETAIL_TITLES[signalHubCard] : 'Battle hub';

  // Helpers
  const openGoogleDriveDialog = () => {
    toggleLoadModal();
    setActiveTabIndex(is_mobile ? 1 : 2);
    setActiveTab(DBOT_TABS.BOT_BUILDER);
  };

  const openFileLoader = () => {
    toggleLoadModal();
    setActiveTabIndex(is_mobile ? 0 : 1);
    setActiveTab(DBOT_TABS.BOT_BUILDER);
  };

  // Actions (tiles)
  const actions: TCardItem[] = [
    {
      id: 'my-computer',
      icon: is_mobile ? (
        <Emoji symbol="📱" label="Local" />
      ) : (
        <Emoji symbol="📥" label="Import" />
      ),
      label: is_mobile ? <Localize i18n_default_text='Local' /> : <Localize i18n_default_text='Import' />,
      onPress: () => {
        openFileLoader();
        rudderStackSendOpenEvent({
          subpage_name: 'bot_builder',
          subform_source: 'dashboard',
          subform_name: 'load_strategy',
          load_strategy_tab: 'local',
        });
      },
    },
    // {
    //   id: 'tournament',
    //   icon: <Emoji symbol="🏆" label="Tournament" />,
    //   label: <Localize i18n_default_text='Tournament' />,
    //   onPress: () => {
    //     setActiveTab(DBOT_TABS.AVIATOR);
    //     rudderStackSendDashboardClickEvent({
    //       dashboard_click_name: 'Tournament',
    //       subpage_name: 'bot_builder',
    //     });
    //   },
    // },
    {
      id: 'instant-fill',
      icon: <Emoji symbol="⏱️" label="Instant Fill" />,
      label: <Localize i18n_default_text='Instant Fill' />,
      onPress: () => {
        setActiveTab(DBOT_TABS.CHART);
        rudderStackSendDashboardClickEvent({
          dashboard_click_name: 'INSTANT_FILL',
          subpage_name: 'bot_builder',
        });
      },
    },
    {
      id: 'withdraw',
      icon: <Emoji symbol="📊" label="Withdraw" />,
      label: <Localize i18n_default_text='Dtrader' />,
      onPress: () => {
        window.open('https://app.denaratool.com/dtrader', '_blank', 'noopener,noreferrer');
      },
    },
    // {
    //   id: 'smart-trader',
    //   icon: <Emoji symbol="🧠" label="Smart Trader" />,
    //   label: <Localize i18n_default_text='Smart Trader' />,
    //   onPress: () => {
    //     setActiveTab(DBOT_TABS.DENARA_PRO);
    //     rudderStackSendDashboardClickEvent({
    //       dashboard_click_name: 'Smart Trader',
    //       subpage_name: 'bot_builder',
    //     });
    //   },
    // },
    {
      id: 'manual-trader',
      icon: <Emoji symbol="🏈" label="Manual Trader" />,
      label: <Localize i18n_default_text='Manual Trader' />,
      onPress: () => {
        setActiveTab(MAIN_APP_TAB_INDEX.MANUAL_TRADER);
        rudderStackSendDashboardClickEvent({
          dashboard_click_name: 'MANUAL_TRADER',
          subpage_name: 'bot_builder',
        });
      },
    },
    // {
    //   id: 'quick-strategy',
    //   icon: <Emoji symbol="🤖" label="Denara Bots" />,
    //   label: <Localize i18n_default_text='Quick Strategies' />,
    //   onPress: () => {
    //     setActiveTab(DBOT_TABS.BOT_BUILDER);
    //     setFormVisibility(true);
    //     rudderStackSendOpenEvent({
    //       subpage_name: 'bot_builder',
    //       subform_source: 'dashboard',
    //       subform_name: 'quick_strategy',
    //     });
    //   },
    // },
    // {
    //   id: 'challenge-tab',
    //   icon: <Emoji symbol='🌍' label='Challenge' />,
    //   label: <Localize i18n_default_text='Challenge' />,
    //   onPress: () => {
    //     setActiveTab(DBOT_TABS.AVIATOR);
    //     rudderStackSendDashboardClickEvent({
    //       dashboard_click_name: 'Strategies',
    //       subpage_name: 'bot_builder',
    //     });
    //   },
    // },
    {
      id: 'auto-strategy',
      icon: <Emoji symbol="⏳" label="Auto Strategy" />,
      label: <Localize i18n_default_text='Auto Strategy' />,
      onPress: () => {
        setActiveTab(MAIN_APP_TAB_INDEX.AUTO_STRATEGY);
        rudderStackSendDashboardClickEvent({
          dashboard_click_name: 'AUTO_STRATEGY',
          subpage_name: 'bot_builder',
        });
      },
    },
    {
      id: 'tournament',
      icon: <Emoji symbol="🧠" label="Tournament" />,
      label: <Localize i18n_default_text='Smart Trader' />,
      onPress: () => {
        setActiveTab(DBOT_TABS.DENARA_PRO);
        rudderStackSendDashboardClickEvent({
          dashboard_click_name: 'Tournament',
          subpage_name: 'bot_builder',
        });
      },
    },
  ];

  const openSmartTraderSub = (
    view: 'viewstrategy' | 'evenodd' | 'reloadauto' | 'bricktower',
    dashboard_click_name: string
  ) => {
    try {
      sessionStorage.setItem(QUICK_ACCESS_SESSION.smartTraderView, view);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(
      new CustomEvent(QUICK_ACCESS_EVENTS.smartTraderView, { detail: { view } })
    );
    setActiveTab(DBOT_TABS.DENARA_PRO);
    rudderStackSendDashboardClickEvent({
      dashboard_click_name,
      subpage_name: 'bot_builder',
    });
  };

  /** Strip order: Flipaa → Multi → Pro Aviator → Manual Trader → Smart Trader sub-views (ViewPercentage) */
  const commodity_nav_actions: TCommodityNavItem[] = [
    {
      id: 'quick-flipaa',
      abbr: 'FLP',
      code: 'flipaa',
      price: '$1.024',
      change: '+1.24%',
      isUp: true,
      onPress: () => {
        try {
          sessionStorage.setItem(QUICK_ACCESS_SESSION.viewToggle, 'flipa');
        } catch {
          /* ignore */
        }
        window.dispatchEvent(
          new CustomEvent(QUICK_ACCESS_EVENTS.viewToggle, { detail: { view: 'flipa' } })
        );
        setActiveTab(DBOT_TABS.CHART);
        rudderStackSendDashboardClickEvent({
          dashboard_click_name: 'flipaa',
          subpage_name: 'bot_builder',
        });
      },
    },
    {
      id: 'quick-double-execution',
      abbr: 'DBX',
      code: 'Double execution',
      price: '€98.42',
      change: '+3.21%',
      isUp: true,
      onPress: () => {
        setActiveTab(MAIN_APP_TAB_INDEX.DOUBLE_DOUBLE);
        rudderStackSendDashboardClickEvent({
          dashboard_click_name: 'DOUBLE_EXECUTION',
          subpage_name: 'bot_builder',
        });
      },
    },
    {
      id: 'quick-pro-aviator',
      abbr: 'PAV',
      code: 'Pro Aviator',
      price: '$2.041',
      change: '+0.89%',
      isUp: true,
      onPress: () => {
        setActiveTab(DBOT_TABS.INSTANT_FILL);
        rudderStackSendDashboardClickEvent({
          dashboard_click_name: 'PRO_AVIATOR',
          subpage_name: 'bot_builder',
        });
      },
    },
    {
      id: 'quick-manual-trader',
      abbr: 'RDY',
      code: 'Manual Trader',
      price: '$43.18',
      change: '+2.11%',
      isUp: true,
      onPress: () => {
        setActiveTab(MAIN_APP_TAB_INDEX.MANUAL_TRADER);
        rudderStackSendDashboardClickEvent({
          dashboard_click_name: 'MANUAL_TRADER',
          subpage_name: 'bot_builder',
        });
      },
    },
    {
      id: 'quick-speed-bot',
      abbr: 'SPD',
      code: 'Speed Bot',
      price: '$88.90',
      change: '+0.45%',
      isUp: true,
      onPress: () => openSmartTraderSub('viewstrategy', 'SMART_TRADER_SPEED_BOT'),
    },
    {
      id: 'quick-even-odd',
      abbr: 'E/O',
      code: 'Even Odd',
      price: '£1.089',
      change: '+0.08%',
      isUp: true,
      onPress: () => openSmartTraderSub('evenodd', 'SMART_TRADER_EVEN_ODD'),
    },
    {
      id: 'quick-auto-bot',
      abbr: 'AUT',
      code: 'Auto Bot',
      price: '$156.20',
      change: '-0.34%',
      isUp: false,
      onPress: () => openSmartTraderSub('reloadauto', 'SMART_TRADER_AUTO_BOT'),
    },
    {
      id: 'quick-over-under',
      abbr: 'O/U',
      code: 'Over Under',
      price: '$72.55',
      change: '+1.87%',
      isUp: true,
      onPress: () => openSmartTraderSub('bricktower', 'SMART_TRADER_OVER_UNDER'),
    },
  ];

  return (
    <div
      className={classNames('tab__dashboard__table', 'dashboard-cards-with-inline-hub', {
        'tab__dashboard__table--minimized': has_dashboard_strategies && is_mobile,
      })}
    >
      <div className='dashboard-cards-scroll'>
        <div
          className={classNames('tab__dashboard__table__tiles', {
            'tab__dashboard__table__tiles--minimized': has_dashboard_strategies && is_mobile,
          })}
          id='tab__dashboard__table__tiles'
          // Mobile-first: CSS grid friendly; ensure tiles wrap on small screens
          // Add these utility styles in your stylesheet:
          // .tab__dashboard__table__tiles { display:grid; grid-template-columns:repeat( auto-fill, minmax(110px,1fr) ); gap:12px; }
          // @media (min-width: 768px) { .tab__dashboard__table__tiles { grid-template-columns: repeat(6, minmax(0,1fr)); gap:16px; } }
        >
          {actions.map(({ id, icon, label, onPress }) => (
            <div
              key={id}
              className={classNames('tab__dashboard__table__block', {
                'tab__dashboard__table__block--minimized': has_dashboard_strategies && is_mobile,
              })}
            >
              <button
                type='button'
                aria-label={typeof label === 'string' ? label : undefined}
                className={classNames('tab__dashboard__table__images', {
                  'tab__dashboard__table__images--minimized': has_dashboard_strategies,
                })}
                onClick={onPress}
                id={id}
                // Mobile-friendly hit area
                style={{
                  width: '100%',
                  minHeight: '88px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '16px',
                  border: '1px solid var(--general-section-1, rgba(0,0,0,0.08))',
                  background: 'var(--general-section-2, #fff)',
                  cursor: 'pointer',
                }}
                title={typeof label === 'string' ? label : undefined}
              >
                {icon}
              </button>
              <Text
                color='prominent'
                size={is_mobile ? 'xxs' : 'xs'}
                align='center'
                as='div'
                // clamp to one line on mobile
                style={{
                  marginTop: '6px',
                  width: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </Text>
            </div>
          ))}
        </div>

        <div className='tab__dashboard__commodity-strip-wrap'>
          <div className='tab__dashboard__commodity-strip' id='tab__dashboard__commodity-strip'>
            {commodity_nav_actions.map(({ id, abbr, code, price, change, isUp, onPress }) => (
              <div key={id} className='tab__dashboard__commodity-item'>
                <button
                  type='button'
                  aria-label={`${abbr} ${code}: ${price}, ${change}`}
                  className='tab__dashboard__commodity-button tab__dashboard__commodity-button--rich'
                  onClick={onPress}
                  id={id}
                  title={`${abbr} · ${code} · ${price} · ${change}`}
                >
                  <span className='tab__dashboard__commodity-abbr'>{abbr}</span>
                  <span className='tab__dashboard__commodity-name'>{code}</span>
                  <span className='tab__dashboard__commodity-meta'>
                    <span className='tab__dashboard__commodity-price'>{price}</span>
                    <span
                      className={classNames('tab__dashboard__commodity-change', {
                        'tab__dashboard__commodity-change--up': isUp,
                        'tab__dashboard__commodity-change--down': !isUp,
                      })}
                    >
                      {change}
                    </span>
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className={classNames('dashboard-signal-hub-dock', {
          'dashboard-signal-hub-dock--mobile-floating': is_mobile,
        })}
      >
        <button
          type='button'
          className={classNames('dashboard-signal-hub-dock__btn', { 'is-open': signalHubOpen })}
          onClick={toggleSignalHub}
          aria-expanded={signalHubOpen}
          aria-controls='dashboard-signal-hub-heading'
        >
          <span className='dashboard-signal-hub-dock__chevron' aria-hidden>
            ▲
          </span>
          <span>Hub</span>
        </button>
      </div>

        {/* Modals: desktop = Dialog, mobile = FullPage */}
        {isDesktop ? (
          <Dialog
            title={dialog_options.title}
            is_visible={is_dialog_open}
            onCancel={onCloseDialog}
            onConfirm={onCloseDialog}
            className='dc-dialog__wrapper--google-drive'
            has_close_icon
          >
            <GoogleDrive />
          </Dialog>
        ) : (
          <MobileFullPageModal
            is_modal_open={is_dialog_open}
            className='load-strategy__wrapper'
            header={localize('Load strategy')}
            onClickClose={() => {
              setPreviewOnPopup(false);
              onCloseDialog();
            }}
            height_offset='80px'
          >
            <div label='Google Drive' className='google-drive-label'>
              <GoogleDrive />
            </div>
          </MobileFullPageModal>
        )}

      {/* Removed the recent bots list */}
      {/* <DashboardBotList /> */}

      {signalHubOpen && (
        <div className='dashboard-signal-hub' role='presentation'>
          <button
            type='button'
            className='dashboard-signal-hub__backdrop'
            aria-label='Close quick hub'
            onClick={closeSignalHub}
          />
          <div
            className={classNames('dashboard-signal-hub__sheet', {
              'dashboard-signal-hub__sheet--expanded': signalHubSheetExpanded && !!signalHubCard,
            })}
            role='dialog'
            aria-modal='true'
            aria-labelledby='dashboard-signal-hub-heading'
          >
            {signalHubCard ? (
              <div
                className='dashboard-signal-hub__sheet-edge'
                onTouchStart={handleHubEdgeTouchStart}
                onTouchEnd={handleHubEdgeTouchEnd}
              >
                <div className='dashboard-signal-hub__grab' aria-hidden />
                <p className='dashboard-signal-hub__edge-hint'>
                  {signalHubSheetExpanded
                    ? 'Swipe down on the handle to shrink'
                    : 'Swipe up for full screen'}
                </p>
              </div>
            ) : (
              <div className='dashboard-signal-hub__grab' aria-hidden />
            )}
            <div className='dashboard-signal-hub__header'>
              {!signalHubCard ? (
                <h2 id='dashboard-signal-hub-heading' className='dashboard-signal-hub__title'>
                  Traders hub
                </h2>
              ) : (
                <div className='dashboard-signal-hub__header-row'>
                  <button
                    type='button'
                    className='dashboard-signal-hub__back'
                    onClick={() => {
                      setSignalHubCard(null);
                      setBrickTowerRunPanel(false);
                      setSignalHubSheetExpanded(false);
                    }}
                  >
                    ← Back
                  </button>
                  <span id='dashboard-signal-hub-heading' className='dashboard-signal-hub__title'>
                    {hubDetailTitle}
                  </span>
                  <button
                    type='button'
                    className='dashboard-signal-hub__expand'
                    onClick={() => setSignalHubSheetExpanded(v => !v)}
                    aria-expanded={signalHubSheetExpanded}
                    aria-label={signalHubSheetExpanded ? 'Shrink sheet' : 'Expand sheet to full screen'}
                    title={signalHubSheetExpanded ? 'Shrink' : 'Full screen'}
                  >
                    {signalHubSheetExpanded ? '⤓' : '⤢'}
                  </button>
                  <button type='button' className='dashboard-signal-hub__close-x' onClick={closeSignalHub}>
                    ×
                  </button>
                </div>
              )}
            </div>
            <div className='dashboard-signal-hub__body'>
              {!signalHubCard ? (
                <div className='dashboard-signal-hub__cards'>
                  <button
                    type='button'
                    className='dashboard-signal-hub__game-card dashboard-signal-hub__game-card--brick'
                    onClick={() => openHubEmbed('brick')}
                  >
                    <span className='dashboard-signal-hub__game-card-icon' aria-hidden>
                      🎯
                    </span>
                    <span className='dashboard-signal-hub__game-card-title'>Over Under Percentage Signals</span>
                    <span className='dashboard-signal-hub__game-card-sub'>
                      Over / under % signals — arm a set, then Execute.
                    </span>
                  </button>
                  <button
                    type='button'
                    className='dashboard-signal-hub__game-card dashboard-signal-hub__game-card--p2p'
                    onClick={() => openHubEmbed('p2p')}
                  >
                    <span className='dashboard-signal-hub__game-card-icon' aria-hidden>
                      🛡️
                    </span>
                    <span className='dashboard-signal-hub__game-card-title'>Defender</span>
                    <span className='dashboard-signal-hub__game-card-sub'>
                      Pattern-based entries, risk modes, and order log — run inside the hub.
                    </span>
                  </button>
                  <button
                    type='button'
                    className='dashboard-signal-hub__game-card dashboard-signal-hub__game-card--speed'
                    onClick={() => openHubEmbed('speed')}
                  >
                    <span className='dashboard-signal-hub__game-card-icon' aria-hidden>
                      ⚡
                    </span>
                    <span className='dashboard-signal-hub__game-card-title'>Speed</span>
                    <span className='dashboard-signal-hub__game-card-sub'>
                      Speed bot with virtual hooks. 
                    </span>
                  </button>
                  <button
                    type='button'
                    className='dashboard-signal-hub__game-card dashboard-signal-hub__game-card--aviator'
                    onClick={() => openHubEmbed('aviator')}
                  >
                    <span className='dashboard-signal-hub__game-card-icon' aria-hidden>
                      ✈️
                    </span>
                    <span className='dashboard-signal-hub__game-card-title'>Aviator</span>
                    <span className='dashboard-signal-hub__game-card-sub'>Tick analysis and Aviator tooling.</span>
                  </button>
                  <button
                    type='button'
                    className='dashboard-signal-hub__game-card dashboard-signal-hub__game-card--strategy'
                    onClick={() => openHubEmbed('strategy')}
                  >
                    <span className='dashboard-signal-hub__game-card-icon' aria-hidden>
                      🤖
                    </span>
                    <span className='dashboard-signal-hub__game-card-title'>Auto Trade</span>
                    <span className='dashboard-signal-hub__game-card-sub'>Reverse and Continuation auto Strategies.</span>
                  </button>
                  <button
                    type='button'
                    className='dashboard-signal-hub__game-card dashboard-signal-hub__game-card--evenodd'
                    onClick={() => openHubEmbed('evenodd')}
                  >
                    <span className='dashboard-signal-hub__game-card-icon' aria-hidden>
                      🔢
                    </span>
                    <span className='dashboard-signal-hub__game-card-title'>Even / Odd</span>
                    <span className='dashboard-signal-hub__game-card-sub'>Iframe even–odd brick flow.</span>
                  </button>
                  <button
                    type='button'
                    className='dashboard-signal-hub__game-card dashboard-signal-hub__game-card--manual'
                    onClick={() => {
                      closeSignalHub();
                      setActiveTab(MAIN_APP_TAB_INDEX.MANUAL_TRADER);
                      rudderStackSendDashboardClickEvent({
                        dashboard_click_name: 'MANUAL_TRADER',
                        subpage_name: 'bot_builder',
                      });
                    }}
                  >
                    <span className='dashboard-signal-hub__game-card-icon' aria-hidden>
                      📈
                    </span>
                    <span className='dashboard-signal-hub__game-card-title'>Manual Trader</span>
                    <span className='dashboard-signal-hub__game-card-sub'>Hands-on trade controls.</span>
                  </button>
                  <button
                    type='button'
                    className='dashboard-signal-hub__game-card dashboard-signal-hub__game-card--flipaa'
                    onClick={() => openHubEmbed('flipaa')}
                  >
                    <span className='dashboard-signal-hub__game-card-icon' aria-hidden>
                      🎲
                    </span>
                    <span className='dashboard-signal-hub__game-card-title'>Flipaa</span>
                    <span className='dashboard-signal-hub__game-card-sub'>Multi-strategy flip bot.</span>
                  </button>
                  <button
                    type='button'
                    className='dashboard-signal-hub__game-card dashboard-signal-hub__game-card--multi'
                    onClick={() => openHubEmbed('multi')}
                  >
                    <span className='dashboard-signal-hub__game-card-icon' aria-hidden>
                      🧩
                    </span>
                    <span className='dashboard-signal-hub__game-card-title'>Multi ABC</span>
                    <span className='dashboard-signal-hub__game-card-sub'>Multi entry modules.</span>
                  </button>
                </div>
              ) : signalHubCard === 'brick' ? (
                <Suspense fallback={<div className='dashboard-signal-hub__loading'>Loading trader…</div>}>
                  <BrickTowerLazy
                    key={hubEmbedMountId}
                    dashboardEmbed
                    deferRunPanel
                    showRunPanel={brickTowerRunPanel}
                    onRunStarted={() => setBrickTowerRunPanel(true)}
                  />
                </Suspense>
              ) : signalHubCard === 'p2p' ? (
                <Suspense fallback={<div className='dashboard-signal-hub__loading'>Loading P2P Safe…</div>}>
                  <div className='dashboard-signal-hub__p2p-wrap'>
                    <P2PSafeTraderLazy key={hubEmbedMountId} />
                  </div>
                </Suspense>
              ) : signalHubCard === 'speed' ? (
                <Suspense fallback={<div className='dashboard-signal-hub__loading'>Loading Speed…</div>}>
                  <div className='dashboard-signal-hub__embed-wrap'>
                    <SpeedLazy key={hubEmbedMountId} />
                  </div>
                </Suspense>
              ) : signalHubCard === 'aviator' ? (
                <Suspense fallback={<div className='dashboard-signal-hub__loading'>Loading Aviator…</div>}>
                  <div className='dashboard-signal-hub__embed-wrap'>
                    <AviatorLazy key={hubEmbedMountId} />
                  </div>
                </Suspense>
              ) : signalHubCard === 'strategy' ? (
                <Suspense fallback={<div className='dashboard-signal-hub__loading'>Loading Auto Trade…</div>}>
                  <div className='dashboard-signal-hub__embed-wrap'>
                    <StrategyLazy key={hubEmbedMountId} />
                  </div>
                </Suspense>
              ) : signalHubCard === 'evenodd' ? (
                <Suspense fallback={<div className='dashboard-signal-hub__loading'>Loading Even/Odd…</div>}>
                  <div className='dashboard-signal-hub__embed-wrap'>
                    <IframeEvenOddLazy key={hubEmbedMountId} />
                  </div>
                </Suspense>
              ) : signalHubCard === 'manual' ? (
                <Suspense fallback={<div className='dashboard-signal-hub__loading'>Loading Manual Trader…</div>}>
                  <div className='dashboard-signal-hub__embed-wrap'>
                    <ManualTraderLazy key={hubEmbedMountId} />
                  </div>
                </Suspense>
              ) : signalHubCard === 'flipaa' ? (
                <Suspense fallback={<div className='dashboard-signal-hub__loading'>Loading Flipaa…</div>}>
                  <div className='dashboard-signal-hub__embed-wrap'>
                    <FlipaaLazy key={hubEmbedMountId} />
                  </div>
                </Suspense>
              ) : signalHubCard === 'multi' ? (
                <Suspense fallback={<div className='dashboard-signal-hub__loading'>Loading Multi ABC…</div>}>
                  <div className='dashboard-signal-hub__embed-wrap'>
                    <MultiLazy key={hubEmbedMountId} />
                  </div>
                </Suspense>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default Cards;
