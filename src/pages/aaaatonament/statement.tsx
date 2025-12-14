import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import './Tournament.scss';

type StatementTx = {
  id?: number | string;
  transaction_id?: number | string;
  action_type?: string;
  action?: string;
  amount?: number;
  currency?: string;
  balance?: number;
  balance_after?: number;
  time?: number;
  timestamp?: number;
  date?: number;
  purchase_time?: number;
  transaction_time?: number;
  contract_id?: string | number;
  reference_id?: string | number;
  app_id?: number | null;
  reference_type?: string;
  transaction_type?: string;
  category?: string;
  type?: string;
  contract_type?: string;
  symbol?: string;
};

const PAGE_SIZE = 50;

const getLoginId = (): string =>
  api_base?.account_info?.loginid ? String(api_base.account_info.loginid) : '';

const epochMs = (tx: StatementTx) =>
  Number(tx.transaction_time ?? tx.time ?? tx.timestamp ?? tx.date ?? tx.purchase_time ?? 0) * 1000;

const txId = (tx: StatementTx) =>
  String(tx.transaction_id ?? tx.id ?? tx.contract_id ?? '');

const txAction = (tx: StatementTx) =>
  String(tx.action_type ?? tx.action ?? '').toLowerCase();

const normalize = (s?: string) => (s ? String(s).replace(/_/g, ' ').toLowerCase() : '');

const deriveRefType = (tx: Partial<StatementTx>): string =>
  normalize(tx.reference_type) ||
  normalize(tx.transaction_type) ||
  normalize(tx.category) ||
  normalize(tx.action_type) ||
  normalize(tx.action) ||
  normalize(tx.type) ||
  normalize(tx.contract_type) ||
  '';

const StatementsOnly = () => {
  const [loginid, setLoginid] = useState<string>(getLoginId() || 'unknown');
  const lastLoginRef = useRef<string>(loginid);

  const [items, setItems] = useState<StatementTx[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(true);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const currency = useMemo(
    () => api_base?.account_info?.currency || 'USD',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loginid]
  );

  const resetStatements = useCallback(() => {
    setItems([]);
    setLoading(false);
    setError(null);
    setOffset(0);
    setHasMore(true);
  }, []);

  const fetchPage = useCallback(async () => {
    if (!api_base?.api || loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api_base.api.send({
        statement: 1,
        description: 1,
        limit: PAGE_SIZE,
        offset,
      });
      console.log('[statement] raw response', res);
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
  }, [api_base?.api, offset, loading, hasMore]);

  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    const rootEl = scrollerRef.current || undefined;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const last = entries[0];
        if (last && last.isIntersecting) void fetchPage();
      },
      { root: rootEl ?? null, rootMargin: '0px 0px 400px 0px', threshold: 0.01 }
    );
    if (sentinelRef.current) observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [fetchPage]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      if (!api_base?.api) return;
      try {
        const { subscription } = await api_base.api.subscribe({ transactions: 1 });
        const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
          console.log('[transactions] raw', data);
          if (data?.msg_type === 'transaction' && data?.transaction) {
            const t: StatementTx = {
              ...data.transaction,
              amount: data.transaction?.amount,
              balance_after: data.transaction?.balance_after,
              reference_id: data.transaction?.reference_id,
              app_id: data.transaction?.app_id,
              reference_type: data.transaction?.reference_type,
              transaction_type: data.transaction?.transaction_type,
              category: data.transaction?.category,
              type: data.transaction?.type,
              contract_type: data.transaction?.contract_type,
              transaction_time: data.transaction?.transaction_time,
            };
            const id = txId(t);
            setItems(prev => (id && prev.some(p => txId(p) === id) ? prev : [t, ...prev]));
          }
        });
        cleanup = () => {
          try { subscription?.unsubscribe?.(); } catch {}
          try { sub?.unsubscribe?.(); } catch {}
        };
      } catch {}
    })();
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    const remountFor = (nextLogin: string) => {
      lastLoginRef.current = nextLogin || 'unknown';
      setLoginid(lastLoginRef.current);
      resetStatements();
      void fetchPage();
    };
    const iv = setInterval(() => {
      const live = getLoginId();
      if (live && live !== lastLoginRef.current) remountFor(live);
    }, 800);
    const sub = api_base?.api?.onMessage().subscribe(({ data }: any) => {
      if (data?.msg_type === 'authorize' && data?.authorize?.loginid) {
        const live = String(data.authorize.loginid);
        if (live !== lastLoginRef.current) remountFor(live);
      }
    });
    void fetchPage();
    return () => { clearInterval(iv); sub?.unsubscribe?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatAmt = useCallback((n?: number) => {
    if (typeof n !== 'number') return '';
    return `${n >= 0 ? '+' : ''}${n.toFixed(2)} ${currency}`;
  }, [currency]);

  const formatTime = useCallback((ms: number) => {
    if (!ms) return '';
    try { return new Date(ms).toLocaleString(); } catch { return ''; }
  }, []);

  return (
    <div className="stm-only">
      <div className="stm-only__toolbar">
        <div className="stm-only__acct">Active account: <span>{loginid}</span></div>
        <div className="stm-only__actions">
          <button
            className="btn"
            onClick={() => {
              resetStatements();
              void fetchPage();
              scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            Refresh
          </button>
          {!loading && hasMore && (
            <button className="btn btn--ghost" onClick={() => void fetchPage()}>
              Load more
            </button>
          )}
        </div>
      </div>

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

        <div className="statements__scroller" ref={scrollerRef}>
          <ul className="statements__list">
            {items.map((t) => {
              const ms = epochMs(t);
              const action = txAction(t);
              const amt = typeof t.amount === 'number' ? t.amount : undefined;
              const balance = t.balance_after ?? t.balance;
              const positive = (amt ?? 0) >= 0;

              return (
                <li className="statements__row" key={`${txId(t)}::${ms}`}>
                  <div className="col col--time" data-label="Time">{formatTime(ms)}</div>
                  <div className={`col col--action ${action}`} data-label="Action">{action || '-'}</div>
                  <div className="col col--refid" data-label="Reference ID">{t.reference_id ?? '-'}</div>
                  <div className="col col--app" data-label="App ID">{t.app_id ?? '-'}</div>
                  <div className="col col--reftype" data-label="Type">{deriveRefType(t) || '-'}</div>
                  <div className={`col col--amt ${positive ? 'pos' : 'neg'}`} data-label="Amount">
                    {formatAmt(amt)}
                  </div>
                  <div className="col col--bal" data-label="Balance">
                    {typeof balance === 'number' ? `${balance.toFixed(2)} ${currency}` : ''}
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
