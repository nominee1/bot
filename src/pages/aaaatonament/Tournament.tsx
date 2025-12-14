import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import './StatementsOnly.scss';

type StatementTx = {
  transaction_id?: number | string;
  action_type?: string;         // buy|sell|deposit|withdrawal|hold|release|adjustment|virtual_credit|transfer
  amount?: number;
  balance?: number;
  balance_after?: number;
  transaction_time?: number;    // epoch secs
  time?: number;                // sometimes present
  contract_id?: string | number;
  reference_id?: string | number;
  app_id?: number | null;
  // optional alternates for "type":
  reference_type?: string;
  transaction_type?: string;
  category?: string;
  type?: string;
  contract_type?: string;
};

const PAGE_SIZE = 100; // larger page = quicker summary fills

// ---- Helpers ----
const getLoginId = (): string =>
  api_base?.account_info?.loginid ? String(api_base.account_info.loginid) : '';

const epochMs = (t?: number) => (typeof t === 'number' ? t * 1000 : 0);
const ms = (tx: StatementTx) => epochMs(tx.transaction_time ?? tx.time ?? 0);

const txId = (tx: StatementTx) => String(tx.transaction_id ?? tx.contract_id ?? '');

const normalize = (s?: string) => (s ? String(s).replace(/_/g, ' ').toLowerCase() : '');
const deriveRefType = (tx: Partial<StatementTx>): string =>
  normalize(tx.reference_type) ||
  normalize(tx.transaction_type) ||
  normalize(tx.category) ||
  normalize(tx.action_type) ||
  normalize(tx.type) ||
  normalize(tx.contract_type) ||
  '';

const COUNTED_ACTIONS = new Set(['buy','sell','adjustment','hold','release','virtual_credit']);
const EXCLUDED_ACTIONS = new Set(['deposit','withdrawal','transfer']);

// ---- Component ----
type Props = {
  // Optional display name if you have it from your DB. If not provided, we’ll show the loginid.
  username?: string;
  // Optional: default window (ms). If not given, we use last 48h (2 days).
  defaultWindowMs?: number;
};

const StatementsOnly = ({ username, defaultWindowMs = 48 * 60 * 60 * 1000 }: Props) => {
  // Account identity
  const [loginid, setLoginid] = useState<string>(getLoginId() || 'unknown');
  const lastLoginRef = useRef<string>(loginid);

  // Window (epoch ms)
  const [endMs, setEndMs] = useState<number>(() => Date.now());
  const [startMs, setStartMs] = useState<number>(() => Date.now() - defaultWindowMs);

  // Statements state (within window)
  const [items, setItems] = useState<StatementTx[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(true);

  // Balances at edges
  const [startBalance, setStartBalance] = useState<number | null>(null);
  const [endBalance, setEndBalance] = useState<number | null>(null);

  // Infra for infinite scroll
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Currency label from active account
  const currency = useMemo(
    () => api_base?.account_info?.currency || 'USD',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loginid]
  );

  const displayName = username || loginid || '—';

  // Reset list
  const resetList = useCallback(() => {
    setItems([]);
    setOffset(0);
    setHasMore(true);
    setError(null);
    setLoading(false);
  }, []);

  // Fetch page inside [start,end]
  const fetchPage = useCallback(async () => {
    if (!api_base?.api || loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      // Deriv statement accepts date_from/date_to as epoch seconds (ints)
      const res = await api_base.api.send({
        statement: 1,
        description: 0,
        limit: PAGE_SIZE,
        offset,
        date_from: Math.floor(startMs / 1000),
        date_to: Math.floor(endMs / 1000),
      });

      // DEBUG:
      // console.log('[statement window] response', res);

      const list: StatementTx[] = res?.statement?.transactions ?? [];
      const newCount = Array.isArray(list) ? list.length : 0;

      setItems(prev => [...prev, ...(list || [])]);
      setOffset(prev => prev + newCount);
      setHasMore(newCount === PAGE_SIZE);
    } catch (e: any) {
      setError(e?.error?.message || 'Failed to load statements');
    } finally {
      setLoading(false);
    }
  }, [api_base?.api, offset, hasMore, loading, startMs, endMs]);

  // Get balances at edges:
  // - startBalance = last balance_before (<= startMs)
  // - endBalance   = last balance at/<= endMs (or latest inside window)
  const fetchEdgeBalances = useCallback(async () => {
    if (!api_base?.api) return;
    try {
      // A) start balance: get last tx <= startMs
      // We’ll query a short window ending at startMs to capture the last tx
      const resStart = await api_base.api.send({
        statement: 1,
        description: 0,
        limit: 1,
        offset: 0,
        date_to: Math.floor(startMs / 1000),
        // No date_from → try to get the last one before/at start
      });
      const txS: StatementTx | undefined = resStart?.statement?.transactions?.[0];
      const sBal = (txS?.balance_after ?? txS?.balance) as number | undefined;
      setStartBalance(typeof sBal === 'number' ? sBal : null);

      // B) end balance: last tx <= endMs
      const resEnd = await api_base.api.send({
        statement: 1,
        description: 0,
        limit: 1,
        offset: 0,
        date_to: Math.floor(endMs / 1000),
      });
      const txE: StatementTx | undefined = resEnd?.statement?.transactions?.[0];
      const eBal = (txE?.balance_after ?? txE?.balance) as number | undefined;
      setEndBalance(typeof eBal === 'number' ? eBal : null);
    } catch {
      // ignore; leave balances as null
    }
  }, [api_base?.api, startMs, endMs]);

  // Observer inside the scroller
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const last = entries[0];
        if (last && last.isIntersecting) {
          void fetchPage();
        }
      },
      {
        root: scrollerRef.current ?? null,
        rootMargin: '0px 0px 400px 0px',
        threshold: 0.01,
      }
    );

    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }
    return () => observerRef.current?.disconnect();
  }, [fetchPage]);

  // Account switch: re-run for the new account
  useEffect(() => {
    const remountFor = (nextLogin: string) => {
      lastLoginRef.current = nextLogin || 'unknown';
      setLoginid(lastLoginRef.current);
      resetList();
      void fetchEdgeBalances();
      void fetchPage();
    };

    // Poll loginid
    const iv = setInterval(() => {
      const live = getLoginId();
      if (live && live !== lastLoginRef.current) {
        remountFor(live);
      }
    }, 800);

    // WS authorize echo
    const sub = api_base?.api?.onMessage().subscribe(({ data }: any) => {
      if (data?.msg_type === 'authorize' && data?.authorize?.loginid) {
        const live = String(data.authorize.loginid);
        if (live !== lastLoginRef.current) {
          remountFor(live);
        }
      }
    });

    // initial load
    resetList();
    void fetchEdgeBalances();
    void fetchPage();

    return () => {
      clearInterval(iv);
      sub?.unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startMs, endMs]);

  // Summary metrics derived from items (inside window)
  const summary = useMemo(() => {
    let netPL = 0;
    let trades = 0;
    let deposits = 0;
    let withdrawals = 0;

    for (const t of items) {
      const action = String(t.action_type || '').toLowerCase();
      const amt = typeof t.amount === 'number' ? t.amount : 0;

      if (COUNTED_ACTIONS.has(action)) {
        netPL += amt;
        if (action === 'buy' || action === 'sell') trades += 1;
      } else if (action === 'deposit') {
        deposits += amt;
      } else if (action === 'withdrawal') {
        withdrawals += amt;
      }
    }

    const start = startBalance ?? null;
    const end = endBalance ?? null;
    const returnPct =
      start && start !== 0
        ? (netPL / start) * 100
        : null;

    return {
      netPL,
      trades,
      deposits,
      withdrawals,
      startBal: start,
      endBal: end,
      returnPct,
    };
  }, [items, startBalance, endBalance]);

  const formatAmt = useCallback((n?: number | null) => {
    if (typeof n !== 'number') return '—';
    const s = n >= 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
    return `${s} ${currency}`;
  }, [currency]);

  const formatPct = (p?: number | null) =>
    typeof p === 'number' ? `${p.toFixed(2)}%` : '—';

  const onPreset = (hours: number) => {
    const now = Date.now();
    setEndMs(now);
    setStartMs(now - hours * 60 * 60 * 1000);
  };

  const onApplyRange = () => {
    resetList();
    void fetchEdgeBalances();
    void fetchPage();
  };

  return (
    <div className="stm-only">
      {/* Header / Summary */}
      <div className="stm-summary">
        <div className="stm-summary__left">
          <div className="stm-summary__user">
            <div className="label">User</div>
            <div className="value">{displayName}</div>
          </div>
          <div className="stm-summary__acct">
            <div className="label">Login ID</div>
            <div className="value">{loginid}</div>
          </div>
        </div>

        <div className="stm-summary__metrics">
          <div className="metric">
            <div className="m-label">Starting Balance</div>
            <div className="m-value">{formatAmt(summary.startBal)}</div>
          </div>
          <div className="metric">
            <div className="m-label">Current Balance</div>
            <div className="m-value">{formatAmt(summary.endBal)}</div>
          </div>
          <div className="metric">
            <div className="m-label">Net P/L</div>
            <div className={`m-value ${summary.netPL >= 0 ? 'pos' : 'neg'}`}>{formatAmt(summary.netPL)}</div>
          </div>
          <div className="metric">
            <div className="m-label">Return %</div>
            <div className={`m-value ${summary.returnPct !== null && summary.returnPct >= 0 ? 'pos' : 'neg'}`}>
              {formatPct(summary.returnPct)}
            </div>
          </div>
          <div className="metric">
            <div className="m-label">Trades</div>
            <div className="m-value">{summary.trades}</div>
          </div>
        </div>

        {/* Date controls */}
        <div className="stm-summary__controls">
          <div className="preset-group">
            <button className="btn btn--ghost" onClick={() => onPreset(24)}>Last 24h</button>
            <button className="btn btn--ghost" onClick={() => onPreset(48)}>Last 48h</button>
            <button className="btn btn--ghost" onClick={() => onPreset(72)}>Last 72h</button>
          </div>
          <div className="range">
            <label>
              <span>Start</span>
              <input
                type="datetime-local"
                value={new Date(startMs).toISOString().slice(0,16)}
                onChange={(e) => setStartMs(new Date(e.target.value).getTime())}
              />
            </label>
            <label>
              <span>End</span>
              <input
                type="datetime-local"
                value={new Date(endMs).toISOString().slice(0,16)}
                onChange={(e) => setEndMs(new Date(e.target.value).getTime())}
              />
            </label>
            <button className="btn" onClick={onApplyRange}>Apply</button>
          </div>
        </div>
      </div>

      {/* Table header */}
      <div className="statements">
        <div className="statements__head" aria-hidden="true">
          <div className="col col--time">Time</div>
          <div className="col col--action">Action</div>
          <div className="col col--refid">Reference ID</div>
          <div className="col col--app">App ID</div>
          <div className="col col--reftype">Type</div>
          <div className="col col--amt">Amount</div>
          <div className="col col--bal">Balance</div>
        </div>

        {/* SCROLL AREA */}
        <div className="statements__scroller" ref={scrollerRef}>
          <ul className="statements__list">
            {items.map((t) => {
              const time = ms(t);
              const action = normalize(t.action_type);
              const amt = typeof t.amount === 'number' ? t.amount : undefined;
              const balance = typeof t.balance_after === 'number'
                ? t.balance_after
                : (typeof t.balance === 'number' ? t.balance : undefined);
              const positive = (amt ?? 0) >= 0;

              return (
                <li className="statements__row" key={`${txId(t)}::${time}`}>
                  <div className="col col--time" data-label="Time">
                    {time ? new Date(time).toLocaleString() : '—'}
                  </div>
                  <div className={`col col--action ${action}`} data-label="Action">{action || '-'}</div>
                  <div className="col col--refid" data-label="Reference ID">{t.reference_id ?? '-'}</div>
                  <div className="col col--app" data-label="App ID">{t.app_id ?? '-'}</div>
                  <div className="col col--reftype" data-label="Type">{deriveRefType(t) || '-'}</div>
                  <div className={`col col--amt ${positive ? 'pos' : 'neg'}`} data-label="Amount">
                    {typeof amt === 'number' ? `${amt >= 0 ? '+' : ''}${amt.toFixed(2)} ${currency}` : '—'}
                  </div>
                  <div className="col col--bal" data-label="Balance">
                    {typeof balance === 'number' ? `${balance.toFixed(2)} ${currency}` : '—'}
                  </div>
                </li>
              );
            })}
          </ul>

          {error && <div className="statements__status error">{error}</div>}
          {loading && <div className="statements__status loading">Loading…</div>}
          {!loading && !hasMore && items.length > 0 && (
            <div className="statements__status end">End of statements</div>
          )}

          <div ref={sentinelRef} className="statements__sentinel" />
        </div>
      </div>
    </div>
  );
};

export default StatementsOnly;
