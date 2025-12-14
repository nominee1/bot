import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Button from '@/components/shared_ui/button';
import Drawer from '@/components/shared_ui/drawer';
import Tabs from '@/components/shared_ui/tabs';
import { Localize, localize } from '@deriv-com/translations';
import ThemedScrollbars from '../shared_ui/themed-scrollbars';
import { DBOT_TABS } from '@/constants/bot-contents';
import { popover_zindex } from '@/constants/z-indexes';
import { useStore } from '@/hooks/useStore';
import { useDevice } from '@deriv-com/ui';

type TDrawerHeader = {
  is_mobile: boolean;
  is_drawer_open: boolean;
  can_reset: boolean;
  onReset: () => void;
};

type TDrawerFooter = {
  can_reset: boolean;
  onReset: () => void;
};

type Message = {
  id: string;
  author: 'me' | 'other';
  text: string;
  ts: number;
};

const DrawerHeader = ({ is_mobile, is_drawer_open, can_reset, onReset }: TDrawerHeader) =>
  is_mobile &&
  is_drawer_open && (
    <Button
      id="db-run-panel__clear-button"
      className="run-panel__clear-button"
      disabled={!can_reset}
      text={localize('Reset')}
      onClick={onReset}
      secondary
    />
  );

const DrawerFooter = ({ can_reset, onReset }: TDrawerFooter) => (
  <div className="run-panel__footer">
    <Button
      id="db-run-panel__clear-button"
      className="run-panel__footer-button"
      disabled={!can_reset}
      onClick={onReset}
      has_effect
      secondary
    >
      <span>{localize('Reset')}</span>
    </Button>
  </div>
);

const ChatPannel = observer(() => {
  const { run_panel, dashboard } = useStore();
  const { isDesktop } = useDevice();

  const {
    active_index,
    is_drawer_open,
    onMount,
    onUnmount,
    setActiveTabIndex,
    toggleDrawer,
  } = run_panel;

  const { active_tour, active_tab } = dashboard;

  // ===== Chat state =====
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState('');
  const [asOther, setAsOther] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  const can_reset = messages.length > 0;

  const scrollToBottom = React.useCallback(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, []);

  React.useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = React.useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setMessages(prev => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        author: asOther ? 'other' : 'me',
        text,
        ts: Date.now(),
      },
    ]);
    setInput('');
  }, [input, asOther]);

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const onReset = React.useCallback(() => {
    setMessages([]);
  }, []);

  React.useEffect(() => {
    onMount();
    return () => onUnmount();
  }, [onMount, onUnmount]);

  React.useEffect(() => {
    if (!isDesktop) {
      toggleDrawer(false);
    }
  }, [isDesktop, toggleDrawer]);

  const chatTab = (
    <div className="run-panel-tab__content run-panel-tab__content--summary-tab">
      <div className="chat">
        {/* Messages list */}
        <div className="chat__list-wrapper">
          <ThemedScrollbars className="chat__scroll" autoHide={false}>
            <div className="chat__list" ref={listRef}>
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={classNames('chat__row', {
                    'chat__row--left': msg.author === 'me',
                    'chat__row--right': msg.author === 'other',
                  })}
                >
                  <div
                    className={classNames('chat__bubble', {
                      'chat__bubble--left': msg.author === 'me',
                      'chat__bubble--right': msg.author === 'other',
                    })}
                    title={new Date(msg.ts).toLocaleTimeString()}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              {messages.length === 0 && (
                <div className="chat__empty">
                  <Localize i18n_default_text="No messages yet. Start the conversation below." />
                </div>
              )}
            </div>
          </ThemedScrollbars>
        </div>

        {/* Composer */}
        <div className="chat__composer">
          <textarea
            className="chat__input"
            placeholder={localize('Type a message… (Enter to send, Shift+Enter for a new line)')}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
          />
          <div className="chat__actions">
            <label className="chat__toggle">
              <input
                type="checkbox"
                checked={asOther}
                onChange={e => setAsOther(e.target.checked)}
              />
              <span>{localize('Send as other')}</span>
            </label>
            <Button
              className="chat__send"
              onClick={sendMessage}
              disabled={!input.trim()}
              text={localize('Send')}
              primary
            />
          </div>
        </div>
      </div>
    </div>
  );

  const content = (
    <>
      <Tabs active_index={active_index} onTabItemClick={setActiveTabIndex} top>
        <div id="db-run-panel-tab__chat" label={<Localize i18n_default_text="Chat" />}>
          {chatTab}
        </div>
      </Tabs>
    </>
  );

  const header = (
    <DrawerHeader
      is_mobile={!isDesktop}
      is_drawer_open={is_drawer_open}
      can_reset={can_reset}
      onReset={onReset}
    />
  );
  const footer = <DrawerFooter can_reset={can_reset} onReset={onReset} />;

  const { BOT_BUILDER, CHART, DENARA_PRO, SMART_TRADER, RISE_FALL, OVER_UNDER } = DBOT_TABS;
  const show_run_panel =
    [BOT_BUILDER, CHART, DENARA_PRO, SMART_TRADER, RISE_FALL, OVER_UNDER].includes(active_tab) || active_tour;

  if ((!show_run_panel && isDesktop) || active_tour === 'bot_builder') return null;

  return (
    <div className={!isDesktop && is_drawer_open ? 'run-panel__container--mobile' : 'run-panel'}>
      <Drawer
        anchor="right"
        className={classNames('run-panel', {
          'run-panel__container': isDesktop,
          'run-panel__container--tour-active': isDesktop && active_tour,
        })}
        contentClassName="run-panel__content"
        header={header}
        footer={isDesktop && footer}
        is_open={is_drawer_open}
        toggleDrawer={toggleDrawer}
        width={366}
        zIndex={popover_zindex.RUN_PANEL}
      >
        {content}
      </Drawer>
    </div>
  );
});

export default ChatPannel;
