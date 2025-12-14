import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import './ParticipantsLeaderboard.scss';

// ===== Types =====
type StatementTx = {
  transaction_id?: number | string;
  action_type?: string;
  amount?: number;
  balance?: number;
  balance_after?: number;
  transaction_time?: number;
  time?: number;
  contract_id?: string | number;
  reference_id?: string | number;
  app_id?: number | null;
  reference_type?: string;
  transaction_type?: string;
  category?: string;
  type?: string;
  contract_type?: string;
};

type Participant = {
  id: number;
  username: string;
  created_at?: string;
  updated_at?: string;
};

type Props = {
  apiBaseUrl?: string;          // e.g. 'https://ttt.binaryke.com/api'
  appId?: number;               // Deriv app_id if your ws layer needs it
  defaultWindowMs?: number;     // default 48h
  usersPageSize?: number;       // default 50
};

type UserStat = {
  status: 'ok' | 'skip' | 'error' | 'computing';
  reason?: string;
  returnPct?: number | null;
  netPL?: number;
  trades?: number;
  startBal?: number | null;
  endBal?: number | null;
  baselineTime?: number; // epoch ms
};

// ===== Constants & helpers =====
const PAGE_SIZE = 100;
const DEFAULT_USERS_LIMIT = 50;
const TRADE_ACTIONS = new Set(['buy', 'sell']);
const CASH_FLOW = new Set(['deposit', 'withdrawal', 'transfer']);

const normalize = (s?: string) => (s ? String(s).replace(/_/g, ' ').toLowerCase() : '');
const epochMs = (t?: number) => (typeof t === 'number' ? t * 1000 : 0);
const ms = (tx: StatementTx) => epochMs(tx.transaction_time ?? tx.time ?? 0);
const txId = (tx: StatementTx) => String(tx.transaction_id ?? tx.contract_id ?? '');

const pad2 = (n: number) => String(n).padStart(2, '0');
const toDatetimeLocal = (v: number) => {
  const d = new Date(v);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const fromDatetimeLocal = (s: string) => new Date(s).getTime();

// --- API helpers ---
async function getTokenFromDB(apiBaseUrl: string, username: string) {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const url = new URL(`${base}/get_token.php`);
  if (username && username.trim()) url.searchParams.set('username', username.trim());
  else url.searchParams.set('latest', '1');

  const res = await fetch(url.toString(), { method: 'GET' });
  const txt = await res.text();
  let data: any;
  try { data = JSON.parse(txt); } catch { throw new Error(`Bad JSON: ${txt?.slice(0, 180) || 'empty'}`); }
  if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}: ${txt?.slice(0, 180)}`);
  return data as { ok: true; id: number; username: string; token: string; updated?: string | null };
}

async function listParticipants(apiBaseUrl: string, q = '', limit = DEFAULT_USERS_LIMIT, offset = 0) {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const url = new URL(`${base}/list_participants.php`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  if (q.trim()) url.searchParams.set('q', q.trim());
  const res = await fetch(url.toString(), { method: 'GET' });
  const data = await res.json();
  if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load participants');
  return { results: (data.results || []) as Participant[], total: data.total || 0 };
}

// Verify viewer is a participant using Competition PIN (server check)
async function verifyParticipantPin(apiBaseUrl: string, pin: string) {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/verify_pin.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.error || 'Invalid PIN');
  // returns { ok:true, participant:{ id, username } }
  return data.participant as { id: number; username: string };
}

// Retry + timeout helpers for WS calls
async function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  return await Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function wsSendWithRetry<T = any>(
  payload: any,
  opts: { retries?: number; baseDelayMs?: number; timeoutMs?: number } = {}
): Promise<T> {
  const retries = opts.retries ?? 1;
  const baseDelayMs = opts.baseDelayMs ?? 400;
  const timeoutMs = opts.timeoutMs ?? 12000;

  let attempt = 0;
  // @ts-ignore
  if (!api_base?.api) throw new Error('API not ready');
  while (true) {
    try {
      // @ts-ignore
      return await withTimeout(api_base.api.send(payload), timeoutMs, 'wsSend');
    } catch (e: any) {
      if (attempt >= retries) throw e;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
      attempt++;
    }
  }
}

// ===== Shared baseline+metrics computation =====
async function computeWindowMetrics(
  username: string,
  apiBaseUrl: string,
  appId: number | undefined,
  startMs: number,
  endMs: number,
): Promise<{
  baselineTime: number;
  baselineBal: number | null;
  netPL: number;
  trades: number;
  endBal: number | null;
  currency: string;
}> {
  const { token } = await getTokenFromDB(apiBaseUrl, username);
  const authPayload = { authorize: token, ...(appId ? { app_id: appId } : {}) } as any;
  const auth = await wsSendWithRetry(authPayload, { retries: 1, baseDelayMs: 400, timeoutMs: 12000 });
  const acct = (auth as any)?.authorize;
  if (!acct?.loginid) throw new Error('Authorization failed');
  const currency = acct.currency || 'USD';
  if (currency !== 'USD') throw new Error(`Non-USD (${currency})`);

  const fetchBalanceAfterAtOrBefore = async (epochSec: number): Promise<number | null> => {
    const res = await wsSendWithRetry(
      { statement: 1, description: 0, limit: 1, offset: 0, date_to: Math.floor(epochSec) },
      { retries: 1, baseDelayMs: 300, timeoutMs: 8000 }
    );
    const tx: StatementTx | undefined = (res as any)?.statement?.transactions?.[0];
    if (typeof tx?.balance_after === 'number') return tx.balance_after!;
    return null;
  };

  let baselineTime: number | null = null;
  let baselineBal: number | null = null;
  let closedTrades = 0;

  let off = 0;
  let hasMorePage = true;
  while (hasMorePage && baselineTime === null) {
    const res = await wsSendWithRetry(
      {
        statement: 1,
        description: 0,
        limit: PAGE_SIZE,
        offset: off,
        date_from: Math.floor(startMs / 1000),
        date_to: Math.floor(endMs / 1000),
      },
      { retries: 1, baseDelayMs: 300, timeoutMs: 10000 }
    );
    const list: StatementTx[] = (res as any)?.statement?.transactions ?? [];
    const count = list.length || 0;
    hasMorePage = count === PAGE_SIZE;
    off += count;

    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const action = normalize(t.action_type);
      const tms = ms(t);
      if (CASH_FLOW.has(action)) {
        baselineTime = tms;
        if (typeof t.balance_after === 'number') baselineBal = t.balance_after;
        else baselineBal = await fetchBalanceAfterAtOrBefore(Math.floor(tms / 1000) + 1);
        break;
      }
    }
  }

  if (baselineTime === null) {
    const rs = await wsSendWithRetry(
      { statement: 1, description: 0, limit: 1, offset: 0, date_to: Math.floor(startMs / 1000) },
      { retries: 1, baseDelayMs: 300, timeoutMs: 8000 }
    );
    const t0: StatementTx | undefined = (rs as any)?.statement?.transactions?.[0];
    baselineBal = (typeof t0?.balance_after === 'number' ? t0.balance_after : null);
    baselineTime = startMs;
  }

  let endBal: number | null = null;
  try {
    const resEnd = await wsSendWithRetry(
      { statement: 1, description: 0, limit: 1, offset: 0, date_to: Math.floor(endMs / 1000) },
      { retries: 1, baseDelayMs: 300, timeoutMs: 8000 }
    );
    const txE: StatementTx | undefined = (resEnd as any)?.statement?.transactions?.[0];
    endBal = (typeof txE?.balance_after === 'number' ? txE.balance_after : null);
  } catch { }

  if (baselineTime !== null) {
    const resCheck = await wsSendWithRetry(
      {
        statement: 1,
        description: 0,
        limit: PAGE_SIZE,
        offset: 0,
        date_from: Math.floor(baselineTime / 1000),
        date_to: Math.floor(endMs / 1000),
      },
      { retries: 1, baseDelayMs: 300, timeoutMs: 8000 }
    );
    const newerList: StatementTx[] = (resCheck as any)?.statement?.transactions ?? [];
    for (const t of newerList) {
      const tms = ms(t);
      if (tms <= (baselineTime as number)) continue;
      if (CASH_FLOW.has(normalize(t.action_type))) {
        baselineTime = tms;
        if (typeof t.balance_after === 'number') baselineBal = t.balance_after;
        else baselineBal = await fetchBalanceAfterAtOrBefore(Math.floor(tms / 1000) + 1);
      } else if (normalize(t.action_type) === 'sell') {
        closedTrades += 1;
      }
    }
  }

  const netPL = (typeof endBal === 'number' && typeof baselineBal === 'number')
    ? (endBal - baselineBal)
    : 0;

  return {
    baselineTime: baselineTime!,
    baselineBal,
    netPL,
    trades: closedTrades,
    endBal,
    currency,
  };
}

// ===== Component =====
const UsersStatementsMasterDetail = ({
  apiBaseUrl = 'https://ttt.binaryke.com/api',
  appId,
  defaultWindowMs = 48 * 60 * 60 * 1000,
  usersPageSize = DEFAULT_USERS_LIMIT,
}: Props) => {
  // ---- Users list (left rail) ----
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<Participant[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersErr, setUsersErr] = useState<string | null>(null);
  const [usersOffset, setUsersOffset] = useState(0);
  const usersPage = Math.floor(usersOffset / usersPageSize) + 1;
  const usersPages = Math.max(1, Math.ceil(usersTotal / usersPageSize));

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersErr(null);
    try {
      const { results, total } = await listParticipants(apiBaseUrl, q, usersPageSize, usersOffset);
      setUsers(results);
      setUsersTotal(total);
    } catch (e: any) {
      setUsersErr(e?.message || 'Failed to load participants');
    } finally {
      setUsersLoading(false);
    }
  }, [apiBaseUrl, q, usersPageSize, usersOffset]);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  const canPrev = usersOffset > 0;
  const canNext = usersOffset + usersPageSize < usersTotal;

  // ---- Viewer PIN gate (participants-only statements) ----
  const [viewerPin, setViewerPin] = useState<string>(() => localStorage.getItem('denara.viewer_pin') || '');
  const [viewerInfo, setViewerInfo] = useState<{ id: number; username: string } | null>(null);
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const viewerIsParticipant = !!viewerInfo;

  const submitPin = useCallback(async () => {
    if (!viewerPin.trim()) { setPinErr('Enter your Competition PIN'); return; }
    setPinBusy(true);
    setPinErr(null);
    try {
      const info = await verifyParticipantPin(apiBaseUrl, viewerPin.trim());
      setViewerInfo(info);
      localStorage.setItem('denara.viewer_pin', viewerPin.trim());
    } catch (e: any) {
      setViewerInfo(null);
      setPinErr(e?.message || 'Invalid PIN');
    } finally {
      setPinBusy(false);
    }
  }, [apiBaseUrl, viewerPin]);

  const clearPin = () => {
    localStorage.removeItem('denara.viewer_pin');
    setViewerInfo(null);
    setViewerPin('');
    setPinErr(null);
  };

  // ---- Selection / detail (right pane) ----
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [displayUser, setDisplayUser] = useState<string>('');
  const [currency, setCurrency] = useState<string>('USD');
  const [authorized, setAuthorized] = useState(false);
  const [authErr, setAuthErr] = useState<string | null>(null);

  const [endMs, setEndMs] = useState<number>(() => Date.now());
  const [startMs, setStartMs] = useState<number>(() => Date.now() - defaultWindowMs);

  const [items, setItems] = useState<StatementTx[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const seenKeysRef = useRef<Set<string>>(new Set());

  const [stats, setStats] = useState<Record<string, UserStat>>({});
  const updateStat = (u: string, patch: Partial<UserStat>) =>
    setStats(prev => ({ ...prev, [u]: { ...prev[u], ...patch } }));

  const isCollapsed = !selectedUser;

  const resetDetail = useCallback(() => {
    setItems([]);
    setOffset(0);
    setHasMore(true);
    setErr(null);
    setLoading(false);
    seenKeysRef.current.clear();
    setAuthorized(false);
    setAuthErr(null);
    setCurrency('USD');
    setDetailSummary(null);
  }, []);

  const onSelectUser = (u: string) => {
    if (selectedUser === u) {
      setSelectedUser(null);
      resetDetail();
      return;
    }
    setSelectedUser(u);
  };

  // Deriv authorize for selected user (only if viewer is participant)
  const ensureAuthorized = useCallback(async (u: string) => {
    if (!viewerIsParticipant) throw new Error('Participants only. Enter your Competition PIN.');
    if (!api_base?.api) throw new Error('API not ready');

    const data = await getTokenFromDB(apiBaseUrl, u);
    setDisplayUser(data.username || u);
    const token: string = data.token;

    const payload = { authorize: token, ...(appId ? { app_id: appId } : {}) } as any;
    const auth = await wsSendWithRetry(payload, { retries: 1, baseDelayMs: 400, timeoutMs: 12000 });
    const acct = (auth as any)?.authorize;
    if (!acct?.loginid) throw new Error('Authorization failed');

    const cur = acct.currency || 'USD';
    setCurrency(cur);
    if (cur !== 'USD') throw new Error(`This token is for ${cur}, but USD is required.`);
    setAuthorized(true);
  }, [apiBaseUrl, appId, viewerIsParticipant]);

  // ===== Leaderboard computation controls =====
  const cacheRef = useRef<Map<string, { ts: number; stat: UserStat }>>(new Map());
  const CACHE_TTL_MS = 60_000;

  const [rankBusy, setRankBusy] = useState(false);
  const [rankProgress, setRankProgress] = useState({ done: 0, total: 0 });
  const cancelRef = useRef({ cancelled: false });

  const computeUserStat = useCallback(async (u: string): Promise<UserStat> => {
    const cached = cacheRef.current.get(u);
    const now = Date.now();
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      updateStat(u, cached.stat);
      return cached.stat;
    }

    try {
      if (!api_base?.api) throw new Error('API not ready');
      updateStat(u, { status: 'computing', reason: undefined });

      const metrics = await computeWindowMetrics(u, apiBaseUrl, appId, startMs, endMs);

      const returnPct = (typeof metrics.baselineBal === 'number' && metrics.baselineBal > 0 && metrics.trades > 0)
        ? (metrics.netPL / metrics.baselineBal) * 100
        : null;

      const stat: UserStat = {
        status: 'ok',
        returnPct,
        netPL: metrics.netPL,
        trades: metrics.trades,
        startBal: metrics.baselineBal ?? null,
        endBal: metrics.endBal ?? null,
        baselineTime: metrics.baselineTime,
      };
      updateStat(u, stat);
      cacheRef.current.set(u, { ts: now, stat });
      return stat;
    } catch (e: any) {
      const msg = (e?.message || 'Failed');
      const stat: UserStat = msg.startsWith('Non-USD')
        ? { status: 'skip', reason: msg }
        : { status: 'error', reason: msg };
      updateStat(u, stat);
      cacheRef.current.set(u, { ts: Date.now(), stat });
      return stat;
    }
  }, [apiBaseUrl, appId, startMs, endMs]);

  // Serialized leaderboard pass (PUBLIC – no PIN needed)
  useEffect(() => {
    let mounted = true;
    cancelRef.current.cancelled = false;

    (async () => {
      setRankBusy(true);
      setStats({});
      setRankProgress({ done: 0, total: users.length });

      for (let i = 0; i < users.length; i++) {
        if (!mounted || cancelRef.current.cancelled) break;
        const u = users[i].username;
        try {
          await withTimeout(computeUserStat(u), 14_000, `computeUserStat(${u})`);
        } catch (e: any) {
          updateStat(u, { status: 'error', reason: e?.message || 'Timed out' });
        }
        if (!mounted) break;
        setRankProgress(prev => ({ ...prev, done: Math.min(prev.done + 1, prev.total) }));
      }

      if (mounted) setRankBusy(false);
    })();

    return () => { mounted = false; cancelRef.current.cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, startMs, endMs]);

  // Detail page fetch (requires PIN + Deriv auth)
  const fetchPage = useCallback(async () => {
    if (!api_base?.api || loading || !hasMore || !authorized || !selectedUser) return;
    setLoading(true);
    setErr(null);

    try {
      const res = await wsSendWithRetry(
        {
          statement: 1,
          description: 0,
          limit: PAGE_SIZE,
          offset,
          date_from: Math.floor(startMs / 1000),
          date_to: Math.floor(endMs / 1000),
        },
        { retries: 1, baseDelayMs: 300, timeoutMs: 10000 }
      );

      const list: StatementTx[] = (res as any)?.statement?.transactions ?? [];
      const newItems: StatementTx[] = [];
      for (const t of list) {
        const key = `${txId(t)}::${ms(t)}`;
        if (!seenKeysRef.current.has(key)) {
          seenKeysRef.current.add(key);
          newItems.push(t);
        }
      }
      setItems(prev => [...prev, ...newItems]);
      const fetchedCount = Array.isArray(list) ? list.length : 0;
      setOffset(prev => prev + fetchedCount);
      setHasMore(fetchedCount === PAGE_SIZE);
    } catch (e: any) {
      setErr(e?.error?.message || e?.message || 'Failed to load statements');
    } finally {
      setLoading(false);
    }
  }, [authorized, selectedUser, loading, hasMore, offset, startMs, endMs]);

  // ===== Detail summary via shared metrics =====
  type DetailSummary = { startBal: number | null; endBal: number | null; netPL: number; trades: number; returnPct: number | null; baselineTime: number } | null;
  const [detailSummary, setDetailSummary] = useState<DetailSummary>(null);

  const refreshDetailSummary = useCallback(async (u: string) => {
    if (!viewerIsParticipant) throw new Error('Participants only. Enter your Competition PIN.');
    const m = await computeWindowMetrics(u, apiBaseUrl, appId, startMs, endMs);
    const returnPct = (typeof m.baselineBal === 'number' && m.baselineBal > 0 && m.trades > 0)
      ? (m.netPL / m.baselineBal) * 100
      : null;
    setCurrency(m.currency);
    setDetailSummary({
      startBal: m.baselineBal ?? null,
      endBal: m.endBal ?? null,
      netPL: m.netPL,
      trades: m.trades,
      returnPct,
      baselineTime: m.baselineTime,
    });
  }, [apiBaseUrl, appId, startMs, endMs, viewerIsParticipant]);

  // Attach infinite scroll to statements (detail)
  useEffect(() => {
    const rootEl = scrollerRef.current ?? null;
    const sentinelEl = sentinelRef.current ?? null;
    if (!sentinelEl) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const last = entries[0];
        if (last?.isIntersecting) void fetchPage();
      },
      { root: rootEl, rootMargin: '0px 0px 400px 0px', threshold: 0.01 }
    );

    obs.observe(sentinelEl);
    return () => obs.disconnect();
  }, [fetchPage, scrollerRef.current, sentinelRef.current]);

  // Selection + date changes (detail)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedUser) return;

      // Gate: participants only
      if (!viewerIsParticipant) {
        setAuthorized(false);
        setAuthErr('Participants only — enter your Competition PIN to view statements.');
        setDetailSummary(null);
        setItems([]);
        setOffset(0);
        setHasMore(false);
        return;
      }

      try {
        setAuthErr(null);
        setErr(null);
        setAuthorized(false);
        setItems([]);
        setOffset(0);
        setHasMore(true);
        seenKeysRef.current.clear();

        await ensureAuthorized(selectedUser);
        if (cancelled) return;

        await refreshDetailSummary(selectedUser);
        if (cancelled) return;

        await fetchPage();
      } catch (e: any) {
        setAuthErr(e?.message || 'Authorization error');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUser, startMs, endMs, viewerIsParticipant]);

  const formatAmt = useCallback((n?: number | null) => {
    if (typeof n !== 'number') return '—';
    const s = n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
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
    setItems([]); setOffset(0); setHasMore(true); seenKeysRef.current.clear();
    (async () => {
      try {
        if (selectedUser && viewerIsParticipant) await refreshDetailSummary(selectedUser);
        if (viewerIsParticipant) await fetchPage();
      } catch { }
    })();
  };

  const deriveRefType = (tx: Partial<StatementTx>): string =>
    normalize(tx.reference_type) ||
    normalize(tx.transaction_type) ||
    normalize(tx.category) ||
    normalize(tx.action_type) ||
    normalize(tx.type) ||
    normalize(tx.contract_type) ||
    '';

  const fmtUpdated = (iso?: string) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  const sortedUsers: Participant[] = useMemo(() => {
    const arr = [...users];
    arr.sort((a, b) => {
      const sa = stats[a.username], sb = stats[b.username];
      const ra = typeof sa?.returnPct === 'number' ? sa.returnPct : Number.NEGATIVE_INFINITY;
      const rb = typeof sb?.returnPct === 'number' ? sb.returnPct : Number.NEGATIVE_INFINITY;
      if (rb !== ra) return rb - ra;
      const npa = typeof sa?.netPL === 'number' ? sa.netPL! : -Infinity;
      const npb = typeof sb?.netPL === 'number' ? sb.netPL! : -Infinity;
      if (npb !== npa) return npb - npa;
      const ta = sa?.trades ?? -Infinity, tb = sb?.trades ?? -Infinity;
      if (tb !== ta) return tb - ta;
      return a.username.localeCompare(b.username);
    });
    return arr;
  }, [users, stats]);

  const getRankBadge = (idx: number) => {
    const rank = idx + 1;
    const medal =
      rank === 1 ? 'gold' :
        rank === 2 ? 'silver' :
          rank === 3 ? 'bronze' : '';
    return { rank, medal };
  };

  const pctChipClass = (p?: number | null) =>
    typeof p === 'number' ? (p >= 0 ? 'pos' : 'neg') : 'muted';

  const progressPct = rankProgress.total > 0
    ? Math.round((rankProgress.done / rankProgress.total) * 100)
    : 0;

  return (
    <div className="participants">

      <div className="stm-shell">
        {/* Left rail: Users (ranked, PUBLIC) */}
        <aside className="users-rail">
          <div className="users-toolbar">
            <form
              className="users-search"
              onSubmit={(e) => { e.preventDefault(); setUsersOffset(0); void fetchUsers(); }}
            >
              <input
                type="text"
                placeholder="Search username…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <button className="btn" type="submit">Search</button>
            </form>

            <div className="users-pager">
              <button className="btn btn--ghost" disabled={usersLoading || rankBusy || !canPrev}
                onClick={() => setUsersOffset(Math.max(0, usersOffset - usersPageSize))}>‹</button>
              <div className="pageinfo">{usersPage} / {usersPages}</div>
              <button className="btn btn--ghost" disabled={usersLoading || rankBusy || !canNext}
                onClick={() => setUsersOffset(usersOffset + usersPageSize)}>›</button>
            </div>
          </div>

          {/* Progress bar + cancel */}
          {rankBusy && (
            <div className="users-progress">
              <div className="users-progress__top">
                <span>Ranking {rankProgress.done}/{rankProgress.total}</span>
                <button
                  className="btn btn--ghost"
                  onClick={() => { cancelRef.current.cancelled = true; }}
                >
                  Cancel
                </button>
              </div>
              <div className="users-progress__bar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct}>
                <div className="users-progress__fill" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          )}

          <div className="users-list" role="list">
            {usersLoading && <div className="users-status">Loading users…</div>}
            {usersErr && <div className="users-status err">{usersErr}</div>}
            {!usersLoading && sortedUsers.length === 0 && !usersErr && (
              <div className="users-status">No users found.</div>
            )}

            {sortedUsers.map((u, idx) => {
              const selected = selectedUser === u.username;
              const s = stats[u.username];
              const { rank, medal } = getRankBadge(idx);
              const ret = s?.returnPct;

              return (
                <button
                  key={u.id}
                  className={`users-row ${selected ? 'is-selected' : ''}`}
                  role="button"
                  aria-expanded={selected}
                  onClick={() => onSelectUser(u.username)}
                  title={u.username}
                  disabled={rankBusy && !selected}
                >
                  <div className="row-left">
                    <div className={`rank-badge ${medal}`} aria-label={`Rank ${rank}`}>
                      {typeof ret === 'number' ? `#${rank}` : '—'}
                    </div>

                    <div className="avatar" aria-hidden="true">{u.username.slice(0, 1).toUpperCase()}</div>
                    <div className="meta">
                      <div className="uname">{u.username}</div>
                      <div className="updated">
                        {s?.status === 'computing' ? 'computing…' :
                          s?.status === 'error' ? 'error' :
                            s?.status === 'skip' ? s.reason :
                              fmtUpdated(u.updated_at || u.created_at)}
                      </div>
                    </div>
                  </div>

                  <div className="row-right">
                    <span className="chip currency">USD</span>
                    <span className={`chip ret ${pctChipClass(ret)}`}>
                      {typeof ret === 'number' ? `${ret.toFixed(2)}%` : '—'}
                    </span>
                    <span className={`chev ${selected ? 'down' : 'right'}`} aria-hidden>▸</span>
                  </div>
                </button>
              );
            })}

          </div>
        </aside>

        {/* Right pane: Detail (Participants-only) */}
        <main className="stm-only">
          {/* PIN gate panel */}
          <div className="pin-gate">
            <div className="pin-gate__left">
              <div className="label">Participants-only statements</div>
              <div className="sub">
                Enter your <strong>Competition PIN</strong> (your <em>username+id</em>, e.g. <code>oracle4</code>) to unlock statements.
              </div>
            </div>
            <div className="pin-gate__right">
              {viewerIsParticipant ? (
                <>
                  <div className="ok">Verified as <strong>{viewerInfo!.username}</strong> (id {viewerInfo!.id})</div>
                  <button className="btn btn--ghost" onClick={clearPin}>Sign out</button>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Enter Competition PIN (e.g. oracle4)"
                    value={viewerPin}
                    onChange={(e) => setViewerPin(e.target.value)}
                    disabled={pinBusy}
                  />
                  <button className="btn" onClick={submitPin} disabled={pinBusy}>
                    {pinBusy ? 'Verifying…' : 'Unlock'}
                  </button>
                </>
              )}
            </div>
          </div>
          {pinErr && <div className="pin-error">{pinErr}</div>}

          {/* Summary Header */}
          <div className="stm-summary">
            <div className="stm-summary__left">
              <div className="stm-summary__user">
                <div className="label">User</div>
                <div className="value">{selectedUser ? (displayUser || selectedUser) : '—'}</div>
              </div>
              <div className="stm-summary__acct">
                <div className="label">Currency</div>
                <div className="value">{selectedUser ? currency : '—'}</div>
              </div>
            </div>

            <div className="stm-summary__metrics">
              <div className="metric">
                <div className="m-label">Starting Capital</div>
                <div className="m-value">{selectedUser ? formatAmt(detailSummary?.startBal ?? null) : '—'}</div>
              </div>
              <div className="metric">
                <div className="m-label">Current Balance</div>
                <div className="m-value">{selectedUser ? formatAmt(detailSummary?.endBal ?? null) : '—'}</div>
              </div>
              <div className="metric">
                <div className="m-label">Net P/L (after baseline)</div>
                <div className={`m-value ${(detailSummary?.netPL ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                  {selectedUser ? formatAmt(detailSummary?.netPL ?? null) : '—'}
                </div>
              </div>
              <div className="metric">
                <div className="m-label">Return %</div>
                <div className={`m-value ${detailSummary?.returnPct !== null && (detailSummary?.returnPct ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                  {selectedUser ? formatPct(detailSummary?.returnPct ?? null) : '—'}
                </div>
              </div>
              <div className="metric">
                <div className="m-label">Trades (after baseline)</div>
                <div className="m-value">{selectedUser ? (detailSummary?.trades ?? 0) : '—'}</div>
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
                    value={toDatetimeLocal(startMs)}
                    onChange={(e) => setStartMs(fromDatetimeLocal(e.target.value))}
                  />
                </label>
                <label>
                  <span>End</span>
                  <input
                    type="datetime-local"
                    value={toDatetimeLocal(endMs)}
                    onChange={(e) => setEndMs(fromDatetimeLocal(e.target.value))}
                  />
                </label>
                <button className="btn" onClick={onApplyRange}>Apply</button>
              </div>
            </div>

            {detailSummary?.baselineTime && (
              <div className="baseline-note">
                Starting capital set at: {new Date(detailSummary.baselineTime).toLocaleString()}
              </div>
            )}
          </div>

          {/* Statements (collapsible) */}
          <div className={`statements stm-collapsible ${isCollapsed ? 'is-collapsed' : 'is-expanded'}`}>
            <div className="statements__head" aria-hidden={isCollapsed}>
              <div className="col col--time">Time</div>
              <div className="col col--action">Action</div>
              <div className="col col--refid">Reference ID</div>
              <div className="col col--app">App ID</div>
              <div className="col col--reftype">Type</div>
              <div className="col col--amt">Amount</div>
              <div className="col col--bal">Balance</div>
            </div>

            <div className="stm-collapsible__inner statements__scroller" ref={scrollerRef}>
              {!selectedUser && <div className="statements__status">Select a user to view statements.</div>}
              {authErr && <div className="statements__status error">{authErr}</div>}

              {selectedUser && viewerIsParticipant && (
                <>
                  <ul className="statements__list">
                    {items.map((t) => {
                      const timeVal = ms(t);
                      const action = normalize(t.action_type);
                      const amt = typeof t.amount === 'number' ? t.amount : undefined;
                      const balance = typeof t.balance_after === 'number'
                        ? t.balance_after
                        : (typeof t.balance === 'number' ? t.balance : undefined);
                      const positive = (amt ?? 0) >= 0;

                      return (
                        <li className="statements__row" key={`${txId(t)}::${timeVal}`}>
                          <div className="col col--time" data-label="Time">
                            {timeVal ? new Date(timeVal).toLocaleString() : '—'}
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

                  {err && <div className="statements__status error">{err}</div>}
                  {loading && <div className="statements__status loading">Loading…</div>}
                  {!loading && !hasMore && items.length > 0 && (
                    <div className="statements__status end">End of statements</div>
                  )}

                  <div ref={sentinelRef} className="statements__sentinel" />
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default UsersStatementsMasterDetail;
