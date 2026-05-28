// AviatorR.tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import TickAnalysis from '../aaviator/Aviator';
import { api_base } from '@/external/bot-skeleton';

/**
 * Remounts TickAnalysis whenever the active account (loginid) changes.
 * - Detects switches via polling + WS hints (authorize, open/close).
 * - Sends forget_all for server-side streams before remount to prevent dupes.
 * - Uses a changing React "key" tied to loginid to force a clean remount.
 */

const getLoginId = (): string =>
  api_base?.account_info?.loginid ? String(api_base.account_info.loginid) : '';

const ensureApiReady = async () => {
  const OPEN = 1 as const;
  if (!api_base.api || api_base.api.connection.readyState !== OPEN) {
    await api_base.init(true);
  }
  const liveApi = api_base.api;
  if (!liveApi || liveApi.connection.readyState !== OPEN) {
    return null;
  }
  return liveApi;
};

const forgetAllStreams = async () => {
  try {
    const liveApi = await ensureApiReady();
    if (!liveApi) return;
    // Be lenient: any of these may fail if not subscribed; that's fine.
    await liveApi.send({ forget_all: 'proposal_open_contract' });
    await liveApi.send({ forget_all: 'transactions' });
    await liveApi.send({ forget_all: 'ticks' });
  } catch {
    // swallow
  }
};

const AviatorR = observer(() => {
  // last known account + key used to force remount
  const [loginid, setLoginid] = useState<string>(getLoginId() || 'unknown');
  const [componentKey, setComponentKey] = useState<string>(() => `${loginid}::init`);
  const lastLoginRef = useRef<string>(loginid);

  const remountFor = useCallback(async (nextLogin: string) => {
    // 1) proactively clear server-side subs to avoid duplicate streams
    await forgetAllStreams();

    // 2) update local record
    lastLoginRef.current = nextLogin || 'unknown';
    setLoginid(lastLoginRef.current);

    // 3) bump key -> forces React to unmount old bot and mount a fresh one
    setComponentKey(`${lastLoginRef.current}::${Date.now()}`);
  }, []);

  // Polling detector (covers cases where no authorize echo is fired)
  useEffect(() => {
    const iv = setInterval(() => {
      const live = getLoginId();
      if (!live) return;
      if (live !== lastLoginRef.current) {
        void remountFor(live);
      }
    }, 800);
    return () => clearInterval(iv);
  }, [remountFor]);

  // WS-based hints: authorize echo + socket open/close -> re-check loginid
  useEffect(() => {
    let sub: { unsubscribe: () => void } | null = null;
    let conn: WebSocket | undefined;
    let cancelled = false;

    const start = async () => {
      const liveApi = await ensureApiReady();
      if (!liveApi || cancelled) return;
      sub = liveApi.onMessage().subscribe(({ data }: any) => {
        if (data?.msg_type === 'authorize' && data?.authorize?.loginid) {
          const live = String(data.authorize.loginid);
          if (live !== lastLoginRef.current) {
            void remountFor(live);
          }
        }
      });
      conn = liveApi.connection as WebSocket | undefined;
      try { conn?.addEventListener('open', recheck); } catch {}
      try { conn?.addEventListener('close', recheck); } catch {}
    };

    const recheck = () => {
      const live = getLoginId();
      if (live && live !== lastLoginRef.current) {
        void remountFor(live);
      }
    };
    void start();

    return () => {
      cancelled = true;
      sub?.unsubscribe?.();
      try { conn?.removeEventListener('open', recheck); } catch {}
      try { conn?.removeEventListener('close', recheck); } catch {}
    };
  }, [remountFor]);

  // Render the bot keyed by the current account identity
  return <TickAnalysis key={componentKey} />;
});

export default AviatorR;
