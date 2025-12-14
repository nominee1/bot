import React, { useCallback, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import { load, save_types } from '@/external/bot-skeleton';
import './Bots.scss';

// XML imports must end with ?raw so they are strings
import overUnderPro from './../../xml/oracleV2.xml?raw';
import proAviatorAi from './../../xml/proAviatorAi.xml?raw';
import lastDigit from './../../xml/lastdigit.xml?raw';
import candlecolor from '../../../src/external/bot-skeleton/examples/xml-examples/random/3 same candle colors.xml?raw';
import alternating from '../../../src/external/bot-skeleton/examples/xml-examples/misc/alternate call put on loss.xml?raw';
import martingale_alternate from '../../../src/external/bot-skeleton/examples/xml-examples/misc/martingale_alternate_even_odd.xml?raw';
import oscars_grind from '../../../src/external/bot-skeleton/examples/xml-examples/risk-management/oscars_grind.xml?raw';
import derivkiller from '../../../src/xml/Deriv Killer 🐍 4.0.xml?raw';

type PinnedBot = {
  id: string;
  name: string;
  xml: string;
  description?: string;
  accent?: string;
  tag?: 'AI' | 'Pro' | 'Risk' | 'Digits' | 'Misc';
};

const PINNED: PinnedBot[] = [
  { id: 'oracle-v1', name: 'OverUnderPro AI', xml: overUnderPro, description: 'Multi-strategy over/under with adaptive risk.', accent: '#4cc9f0', tag: 'AI' },
  { id: 'derivkiller', name: 'Deriv Killer 4.0', xml: derivkiller, description: 'Aggressive multi-phase executor. Use with care.', accent: '#ff4d6d', tag: 'Pro' },
  { id: 'pro-aviator-ai', name: 'Pro Aviator AI', xml: proAviatorAi, description: 'Crash-rounds with dynamic cash-out logic.', accent: '#22b07d', tag: 'AI' },
  { id: 'last-digit', name: 'Last Digit Switcher', xml: lastDigit, description: 'Digit edge rotation with cooldowns.', accent: '#a78bfa', tag: 'Digits' },
  { id: 'candle-color', name: 'Candle Color (x3)', xml: candlecolor, description: 'Same-color streak detection & entry.', accent: '#00f5d4', tag: 'Misc' },
  { id: 'alternating', name: 'Alternating', xml: alternating, description: 'Alternate CALL/PUT on loss cycle.', accent: '#f59e0b', tag: 'Misc' },
];

/** Small XML sanity check to avoid passing empty/invalid strings to loader */
function isLikelyXml(s: string) {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  return t.startsWith('<xml') || t.includes('<block') || t.includes('<variables');
}

/** Wait for Blockly workspace after switching tabs */
async function waitForWorkspace(maxMs = 4000, stepMs = 80): Promise<any | null> {
  const started = performance.now();
  while (performance.now() - started < maxMs) {
    const ws = (window as any).Blockly?.derivWorkspace;
    if (ws) return ws;
    await new Promise(r => setTimeout(r, stepMs));
  }
  return null;
}

const Bots = observer(() => {
  const { dashboard } = useStore();
  const { setActiveTab } = dashboard;

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const pendingRef = useRef<Set<string>>(new Set()); // debounce per-card

  const openBot = useCallback(
    async (bot: PinnedBot) => {
      if (pendingRef.current.has(bot.id) || loadingId === bot.id) return;
      pendingRef.current.add(bot.id);
      setLoadingId(bot.id);
      try {
        // 1) Basic validation
        if (!isLikelyXml(bot.xml)) {
          throw new Error(`Invalid or empty XML for "${bot.name}". Make sure the import has ?raw.`);
        }

        // 2) Ensure the builder tab is active (mounts workspace)
        setActiveTab(DBOT_TABS.BOT_BUILDER);

        // 3) Wait for workspace to exist (handles first-load race)
        const ws = await waitForWorkspace();
        if (!ws) throw new Error('Blockly workspace not ready. (Timeout)');

        // 4) Clear previous content
        try {
          ws.clear?.();
          ws.strategy_to_load = undefined;
        } catch {
          /* no-op */
        }

        // 5) Load with a small retry in case of transient parse issues
        const tryLoad = async (attempt: number) => {
          await load({
            block_string: bot.xml,
            file_name: bot.name,
            strategy_id: bot.id,
            workspace: ws,
            from: save_types.LOCAL,
            drop_event: {},
            showIncompatibleStrategyDialog: false,
          });
        };

        try {
          await tryLoad(1);
        } catch (e) {
          // tiny backoff + second attempt
          await new Promise(r => setTimeout(r, 120));
          await tryLoad(2);
        }

        // 6) Mark last loaded (mimic "recent")
        ws.strategy_to_load = bot.xml;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to load pinned bot:', bot.id, e);
        // Optional: surface a toast if you have one in your app
        // toast.error((e as Error).message || 'Failed to load bot');
      } finally {
        setLoadingId(prev => (prev === bot.id ? null : prev));
        pendingRef.current.delete(bot.id);
      }
    },
    [loadingId, setActiveTab]
  );

  const keyHandler = useCallback(
    (e: React.KeyboardEvent, bot: PinnedBot) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openBot(bot);
      }
    },
    [openBot]
  );

  const cards = useMemo(
    () =>
      PINNED.map(b => {
        const isLoading = loadingId === b.id;
        return (
          <article
            role="listitem"
            key={b.id}
            className={`bot-card${isLoading ? ' is-loading' : ''}`}
            data-bot-id={b.id}
            style={{ ['--accent' as any]: b.accent || 'var(--brand-secondary)' }}
            tabIndex={0}
            onKeyDown={e => keyHandler(e, b)}
          >
            <header className="bot-card__header">
              <div className="bot-card__chip" data-chip={b.tag || 'Bot'}>
                <svg className="chip__icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 3h10a2 2 0 0 1 2 2v3h-2V5H7v3H5V5a2 2 0 0 1 2-2zm-2 8h14v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6zm4 2v2h2v-2H9zm4 0v2h2v-2h-2z" />
                </svg>
                <span className="chip__label">{b.tag || 'Bot'}</span>
              </div>
              <h3 className="bot-card__title">
                <span className="bot-card__title-glow" />
                {b.name}
              </h3>
            </header>

            <div className="bot-card__body">
              <p className="bot-description">{b.description || 'Strategy bot'}</p>
              <div className="bot-meta">
                <span className="meta__item">
                  <span className="meta__dot" />
                  XML ready
                </span>
                <span className="meta__item">
                  <span className="meta__dot" />
                  1-click load
                </span>
              </div>
            </div>

            <footer className="bot-card__footer">
              <button
                className="load-btn"
                aria-label={`Load ${b.name}`}
                onClick={() => openBot(b)}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <span className="btn__spinner" aria-hidden />
                    Loading…
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" className="btn__icon" aria-hidden="true">
                      <path d="M12 3v10.17l3.59-3.58L17 11l-5 5-5-5 1.41-1.41L11 13.17V3h1zM5 19h14v2H5z" />
                    </svg>
                    Load Bot
                  </>
                )}
              </button>
            </footer>
          </article>
        );
      }),
    [keyHandler, loadingId, openBot]
  );

  return (
    <div className="bot-container">
      <div className="bots-banner" aria-hidden="true">
        <span className="bots-banner__dot" />
        <span className="bots-banner__line" />
        <span className="bots-banner__pulse" />
        <h2 className="bots-banner__title">Free Pro Bots</h2>
        <p className="bots-banner__subtitle">curated strategies • one-click load</p>
      </div>

      <div className="pinned-loader" role="list">
        {cards}
      </div>
    </div>
  );
});

export default Bots;
