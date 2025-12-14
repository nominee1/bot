// Cards.tsx — dashboard tiles (mobile-first, no "recent bots"), adds TOURNAMENT card
// kept some things commented because of mobx to integrate popup functionality here
import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import GoogleDrive from '@/components/load-modal/google-drive';
import Dialog from '@/components/shared_ui/dialog';
import MobileFullPageModal from '@/components/shared_ui/mobile-full-page-modal';
import Text from '@/components/shared_ui/text';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import { rudderStackSendOpenEvent } from '../../analytics/rudderstack-common-events';
import { rudderStackSendDashboardClickEvent } from '../../analytics/rudderstack-dashboard';
// import DashboardBotList from './bot-list/dashboard-bot-list'; // removed "recent bots" section

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
      icon: <Emoji symbol="⚡" label="Instant Fill" />,
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
      id: 'smart-trader',
      icon: <Emoji symbol="🧠" label="Smart Trader" />,
      label: <Localize i18n_default_text='Smart Trader' />,
      onPress: () => {
        setActiveTab(DBOT_TABS.DENARA_PRO);
        rudderStackSendDashboardClickEvent({
          dashboard_click_name: 'Smart Trader',
          subpage_name: 'bot_builder',
        });
      },
    },
    {
      id: 'quick-strategy',
      icon: <Emoji symbol="🤖" label="Denara Bots" />,
      label: <Localize i18n_default_text='Denara Bots' />,
      onPress: () => {
        setActiveTab(DBOT_TABS.BOT_BUILDER);
        setFormVisibility(true);
        rudderStackSendOpenEvent({
          subpage_name: 'bot_builder',
          subform_source: 'dashboard',
          subform_name: 'quick_strategy',
        });
      },
    },
    {
      id: 'withdraw',
      icon: <Emoji symbol="🎢" label="Withdraw" />,
      label: <Localize i18n_default_text='Dtrader' />,
      onPress: () => {
        window.open('https://app.denaratool.com/', '_blank', 'noopener,noreferrer');
      },
    },
    {
      id: 'withdraw',
      icon: <Emoji symbol="💳" label="Withdraw" />,
      label: <Localize i18n_default_text='Withdraw' />,
      onPress: () => {
        window.open('https://otascash.com/', '_blank', 'noopener,noreferrer');
      },
    },
    // {
    //   id: 'copytrading',
    //   icon: <Emoji symbol="🏆" label="CopyTrading" />,
    //   label: <Localize i18n_default_text='Tournament' />,
    //   onPress: () => {
    //     setActiveTab(DBOT_TABS.AVIATOR);
    //     rudderStackSendDashboardClickEvent({
    //       dashboard_click_name: 'CopyTrading',
    //       subpage_name: 'bot_builder',
    //     });
    //   },
    // },
  ];

  // Render
  return React.useMemo(
    () => (
      <div
        className={classNames('tab__dashboard__table', {
          'tab__dashboard__table--minimized': has_dashboard_strategies && is_mobile,
        })}
      >
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

          {/* Modals: desktop = Dialog, mobile = FullPage */}
          {isDesktop ? (
            <Dialog
              title={dialog_options.title}
              is_visible={is_dialog_open}
              onCancel={onCloseDialog}
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
              page_overlay
            >
              <div label='Google Drive' className='google-drive-label'>
                <GoogleDrive />
              </div>
            </MobileFullPageModal>
          )}
        </div>

        {/* Removed the recent bots list */}
        {/* <DashboardBotList /> */}
      </div>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [is_dialog_open, has_dashboard_strategies, isDesktop, is_mobile]
  );
});

export default Cards;
