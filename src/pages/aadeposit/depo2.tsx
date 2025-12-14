import React, { useEffect, useMemo, useState } from 'react';
import './Deposit.scss';

const API_BASE = 'https://dtraderhub.com/api';
const FEATURED_USERNAME = 'unchained'; // ← only show this trader

/** ================= Types (match backend) ================= */
type TraderKpi =
  | {
      currency: string;
      baseline_time: number; // epoch ms
      start_balance: number | null;
      end_balance: number | null;
      net_pl: number;
      trades: number;
      wins: number;
      win_rate: number; // %
      growth_pct: number | null; // %
      period_start: number; // epoch sec
      period_end: number; // epoch sec
      error?: undefined;
    }
  | {
      error: string;
      period_start: number;
      period_end: number;
      currency?: undefined;
      baseline_time?: undefined;
      start_balance?: undefined;
      end_balance?: undefined;
      net_pl?: undefined;
      trades?: undefined;
      wins?: undefined;
      win_rate?: undefined;
      growth_pct?: undefined;
    };

type TraderRow = {
  id: number;
  username: string;
  min_balance: number | string;
  price_usd: number | string | null;
  created_at: string;
  active_copiers: number | string | null;
};

type Trader = {
  id: string;
  username: string;
  min_balance: number;
  price_usd: number | null;
  active_copiers: number;
  created_at: number;
  kpi?: TraderKpi; // kept for compatibility (not used in UI)
};

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

type Relationship = {
  id: number;
  trader_id: number;
  copier_username: string;
  active: 0 | 1 | boolean;
  created_at: string;
};

/** ================= Helpers & formatters ================= */
const currencyFmt = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const pctFmt = (p?: number | null) =>
  typeof p === 'number' && Number.isFinite(p) ? `${p.toFixed(2)}%` : '—';

const priceWithinLimit = (val: string): boolean => {
  if (!val.trim()) return true;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 && n <= 5;
};
const isPositiveNum = (val: string): boolean => {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0;
};
const norm = (s?: string) => (s ? String(s).replace(/_/g, ' ').toLowerCase() : '');
const txEpochMs = (t: StatementTx) =>
  typeof t.transaction_time === 'number'
    ? t.transaction_time * 1000
    : typeof t.time === 'number'
    ? t.time * 1000
    : 0;
const txKey = (t: StatementTx) =>
  `${String(t.transaction_id ?? t.contract_id ?? '')}::${txEpochMs(t)}`;

/** Nairobi "today from 3:00 AM" window (epoch sec): today 03:00 EAT → now */
function getNairobiTodayFrom3amWindow(): [number, number] {
  // Nairobi is UTC+3 (no DST)
  const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
  const nowUtcMs = Date.now();

  // Convert current UTC time to EAT
  const nowEatMs = nowUtcMs + EAT_OFFSET_MS;

  // Start-of-day (00:00) in EAT
  const startOfDayEatMs = Math.floor(nowEatMs / 86_400_000) * 86_400_000;

  // 03:00 EAT = startOfDay + 3h
  const start3amEatMs = startOfDayEatMs + 3 * 60 * 60 * 1000;

  // Convert that EAT timestamp back to UTC for server (epoch sec)
  const start3amUtcMs = start3amEatMs - EAT_OFFSET_MS;

  const fromSec = Math.floor(start3amUtcMs / 1000);
  const toSec = Math.floor(nowUtcMs / 1000);
  return [fromSec, toSec];
}

/** Mask an email for UI */
const maskEmail = (email: string) => {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const u =
    user.length <= 2 ? user[0] + '*' : user[0] + '*'.repeat(Math.max(0, user.length - 2)) + user.slice(-1);
  const [d1, d2] = domain.split('.');
  const d1m =
    d1 && d1.length <= 2 ? d1[0] + '*' : d1 ? d1[0] + '*'.repeat(Math.max(0, d1.length - 2)) + d1.slice(-1) : d1;
  return `${u}@${d1m}.${d2 || ''}`;
};

/** 🔒 Mask copier username: keep first & last char, middle → asterisks */
function maskUsername(name: string) {
  if (!name) return '';
  const s = name.trim();
  if (s.length <= 1) return s;
  if (s.length === 2) return s[0] + '*';
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1];
}

/** ================= Minimal Toast system ================= */
type Toast = { id: string; text: string; type?: 'info' | 'success' | 'error' };
const Toasts: React.FC<{ items: Toast[]; onDismiss: (id: string) => void }> = ({ items, onDismiss }) => {
  useEffect(() => {
    const timers = items.map((t) => setTimeout(() => onDismiss(t.id), 3500));
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [items, onDismiss]);

  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.type || 'info'}`}>
          <div className="toast__dot" />
          <div className="toast__text">{t.text}</div>
          <button className="toast__x" onClick={() => onDismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

/** ================= Main Component ================= */
const CopyTradingHub: React.FC = () => {
  /** Theme (scoped) */
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('denara.theme') as any) || 'light');
  useEffect(() => {
    localStorage.setItem('denara.theme', theme);
  }, [theme]);

  /** Toasts */
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = (text: string, type?: Toast['type']) =>
    setToasts((prev) => [...prev, { id: Math.random().toString(36).slice(2), text, type }]);
  const removeToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  /** Collections */
  const [traders, setTraders] = useState<Trader[]>([]);
  const [loadingList, setLoadingList] = useState<boolean>(false);
  const [listErr, setListErr] = useState<string | null>(null);

  /** Forms */
  const [tUser, setTUser] = useState('');
  const [tMinBal, setTMinBal] = useState('');
  const [tToken, setTToken] = useState('');
  const [tPrice, setTPrice] = useState('');
  const [submittingTrader, setSubmittingTrader] = useState(false);

  const [cUser, setCUser] = useState('');
  const [cToken, setCToken] = useState('');
  const [submittingCopier, setSubmittingCopier] = useState(false);

  /** UI helpers */
  const [statementModalFor, setStatementModalFor] = useState<Trader | null>(null);

  /** Copy start/stop inline state per trader */
  const [copyUsernameByTrader, setCopyUsernameByTrader] = useState<Record<string, string>>({});
  const [copyBusyByTrader, setCopyBusyByTrader] = useState<Record<string, boolean>>({});
  const [stopBusyByTrader, setStopBusyByTrader] = useState<Record<string, boolean>>({});
  const [activeListByTrader, setActiveListByTrader] = useState<Record<string, Relationship[] | null>>({});
  const [activeBusyByTrader, setActiveBusyByTrader] = useState<Record<string, boolean>>({});

  /** Statements modal state */
  const [stmItems, setStmItems] = useState<StatementTx[]>([]);
  const [stmOffset, setStmOffset] = useState(0);
  const [stmHasMore, setStmHasMore] = useState(true);
  const [stmLoading, setStmLoading] = useState(false);
  const [stmErr, setStmErr] = useState<string | null>(null);

  // Use "today from 3:00 AM (Nairobi) → now" everywhere for statements
  const [fromSec, toSec] = getNairobiTodayFrom3amWindow();

  /** ======== Payment (fee + OTP) modal state ======== */
  const [payOpen, setPayOpen] = useState(false);
  const [payTrader, setPayTrader] = useState<Trader | null>(null);
  const [payCopierName, setPayCopierName] = useState('');
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [invoiceAmt, setInvoiceAmt] = useState<number>(0);
  const [invoiceCur, setInvoiceCur] = useState<string>('USD');
  const [otpEmailMasked, setOtpEmailMasked] = useState<string>('');
  const [otpCode, setOtpCode] = useState('');
  const [otpConfirming, setOtpConfirming] = useState(false);

  /** Load list (FAST, no KPI calls at all) */
  const loadTraders = async () => {
    setLoadingList(true);
    setListErr(null);
    try {
      const res = await fetch(`${API_BASE}/traders`, { credentials: 'omit' });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 150)}`);
      }
      const data: TraderRow[] = await res.json();
      const mapped: Trader[] = data.map((r) => ({
        id: String(r.id),
        username: r.username,
        min_balance: Number(r.min_balance ?? 0),
        price_usd: r.price_usd === null ? null : Number(r.price_usd),
        active_copiers: Number(r.active_copiers ?? 0),
        created_at: Date.parse(r.created_at || new Date().toISOString()),
      }));

      setTraders(mapped);
      setLoadingList(false);
    } catch (e: any) {
      setListErr(e?.message || 'Failed to load traders.');
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadTraders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Featured only */
  const featuredTrader: Trader | null = useMemo(() => {
    const t = traders.find((tr) => tr.username?.toLowerCase() === FEATURED_USERNAME);
    return t || null;
  }, [traders]);

  /** ======== Payments (fee + OTP) ======== */
  const paymentsPrepare = async (tr: Trader, copierUsername: string) => {
    const res = await fetch(`${API_BASE}/payments/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trader_id: Number(tr.id), copier_username: copierUsername }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data as any)?.error) throw new Error((data as any)?.error || `HTTP ${res.status}`);

    const inv = (data as any).invoice;
    const email = (data as any)?.otp?.to || '';
    setInvoiceId(inv.id);
    setInvoiceAmt(inv.amount);
    setInvoiceCur(inv.currency || 'USD');
    setOtpEmailMasked(email ? maskEmail(email) : '');
    setOtpCode('');
    setPayTrader(tr);
    setPayCopierName(copierUsername);
    setPayOpen(true);
  };

  const paymentsConfirm = async () => {
    if (!invoiceId || !payTrader) return;
    setOtpConfirming(true);
    try {
      const res = await fetch(`${API_BASE}/payments/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: invoiceId, verification_code: otpCode.trim() || '000000' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || (data as any)?.error) throw new Error((data as any)?.error || `HTTP ${res.status}`);

      setTraders((prev) =>
        prev.map((t) => (t.id === payTrader.id ? { ...t, active_copiers: (t.active_copiers || 0) + 1 } : t))
      );
      setCopyUsernameByTrader((prev) => ({ ...prev, [payTrader.id]: '' }));
      setPayOpen(false);
      setPayTrader(null);
      pushToast(
        `Payment ${currencyFmt.format(invoiceAmt)} and copy started: ${payCopierName} → ${FEATURED_USERNAME}`,
        'success'
      );

      if (activeListByTrader[payTrader.id]) await loadActiveRelations(payTrader);
    } catch (e: any) {
      pushToast(e?.message || 'Payment/Copy failed', 'error');
    } finally {
      setOtpConfirming(false);
    }
  };

  /** ========== COPY START / STOP ========== */
  const rawCopyStart = async (tr: Trader, copierUsername: string) => {
    const res = await fetch(`${API_BASE}/copy/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trader_id: Number(tr.id), copier_username: copierUsername }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data as any)?.error) throw new Error((data as any)?.error || `HTTP ${res.status}`);
  };

  const startCopy = async (tr: Trader) => {
    const name = (copyUsernameByTrader[tr.id] || '').trim();
    if (!name) return;
    setCopyBusyByTrader((prev) => ({ ...prev, [tr.id]: true }));
    try {
      if (tr.price_usd == null) {
        await rawCopyStart(tr, name);
        setTraders((prev) =>
          prev.map((t) => (t.id === tr.id ? { ...t, active_copiers: (t.active_copiers || 0) + 1 } : t))
        );
        setCopyUsernameByTrader((prev) => ({ ...prev, [tr.id]: '' }));
        pushToast(`Copy started: ${name} → ${FEATURED_USERNAME}`, 'success');
        if (activeListByTrader[tr.id]) await loadActiveRelations(tr);
        return;
      }
      await paymentsPrepare(tr, name);
      pushToast('Verification code sent to your Deriv email', 'info');
    } catch (e: any) {
      pushToast(e?.message || 'Failed to start copy', 'error');
    } finally {
      setCopyBusyByTrader((prev) => ({ ...prev, [tr.id]: false }));
    }
  };

  const stopCopy = async (tr: Trader) => {
    const name = (copyUsernameByTrader[tr.id] || '').trim();
    if (!name) {
      pushToast('Enter copier username to stop', 'info');
      return;
    }
    setStopBusyByTrader((prev) => ({ ...prev, [tr.id]: true }));
    try {
      const res = await fetch(`${API_BASE}/copy/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trader_id: Number(tr.id), copier_username: name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || (data as any)?.error) throw new Error((data as any)?.error || `HTTP ${res.status}`);

      setTraders((prev) =>
        prev.map((t) => (t.id === tr.id ? { ...t, active_copiers: Math.max(0, (t.active_copiers || 0) - 1) } : t))
      );
      pushToast(`Copy stopped: ${name} ↛ ${FEATURED_USERNAME}`, 'success');
      if (activeListByTrader[tr.id]) await loadActiveRelations(tr);
    } catch (e: any) {
      pushToast(e?.message || 'Failed to stop copy', 'error');
    } finally {
      setStopBusyByTrader((prev) => ({ ...prev, [tr.id]: false }));
    }
  };

  const loadActiveRelations = async (tr: Trader) => {
    setActiveBusyByTrader((prev) => ({ ...prev, [tr.id]: true }));
    try {
      const res = await fetch(`${API_BASE}/relationships?trader_id=${encodeURIComponent(tr.id)}`);
      const data = await res.json();
      if (!res.ok || (data as any)?.error) throw new Error((data as any)?.error || `HTTP ${res.status}`);
      const list = Array.isArray(data) ? (data as Relationship[]) : (data as any)?.results ?? [];
      setActiveListByTrader((prev) => ({ ...prev, [tr.id]: list }));
    } catch (e: any) {
      pushToast(e?.message || 'Failed to load active copiers', 'error');
      setActiveListByTrader((prev) => ({ ...prev, [tr.id]: null }));
    } finally {
      setActiveBusyByTrader((prev) => ({ ...prev, [tr.id]: false }));
    }
  };

  /** Statements modal */
  const openStatements = async (trader: Trader) => {
    setStatementModalFor(trader);
    setStmItems([]);
    setStmOffset(0);
    setStmHasMore(true);
    setStmErr(null);
    await loadMoreStatements(trader, 0);
  };

  const loadMoreStatements = async (trader: Trader, offset: number) => {
    if (!trader) return;
    setStmLoading(true);
    setStmErr(null);
    try {
      const url = new URL(`${API_BASE}/traders/${trader.id}/statements`);
      // ⬇️ Always "today from 03:00 EAT → now"
      const [from, to] = getNairobiTodayFrom3amWindow();
      url.searchParams.set('from', String(from));
      url.searchParams.set('to', String(to));
      url.searchParams.set('limit', '100');
      url.searchParams.set('offset', String(offset));

      const res = await fetch(url.toString());
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 160)}`);
      }
      const data = await res.json();
      const page: StatementTx[] = data?.statement?.transactions ?? [];
      setStmItems((prev) => [...prev, ...page]);
      setStmOffset(offset + (Array.isArray(page) ? page.length : 0));
      setStmHasMore(Array.isArray(page) && page.length === 100);
    } catch (e: any) {
      setStmErr(e?.message || 'Failed to load statements');
      setStmHasMore(false);
    } finally {
      setStmLoading(false);
    }
  };

  /** ====== Client-side summary for CURRENTLY VISIBLE stmItems ====== */
  type VisibleSummary = {
    start_balance?: number | null;
    end_balance?: number | null;
    net_pl?: number | null;
    trades?: number;
    wins?: number;
    win_rate?: number | null;
    growth_pct?: number | null;
    visible_start_time?: number | null; // ms
    visible_end_time?: number | null;   // ms
  };

  const visibleSummary: VisibleSummary = useMemo(() => {
    const empty: VisibleSummary = {
      start_balance: null,
      end_balance: null,
      net_pl: null,
      trades: 0,
      wins: 0,
      win_rate: null,
      growth_pct: null,
      visible_start_time: null,
      visible_end_time: null,
    };

    if (!stmItems.length) return empty;

    // Oldest → newest within the VISIBLE list
    const ordered = [...stmItems].sort((a, b) => txEpochMs(a) - txEpochMs(b));

    const isCashFlow = (raw?: string) => {
      const a = norm(raw);
      return a === 'deposit' || a === 'withdrawal' || a === 'transfer';
    };

    const balAfter = (t: StatementTx) =>
      typeof t.balance_after === 'number'
        ? t.balance_after
        : typeof t.balance === 'number'
        ? t.balance
        : undefined;

    const amt = (t: StatementTx) => (typeof t.amount === 'number' ? t.amount : 0);

    // 1) Find the LATEST cash-flow in the visible window
    let baselineTimeMs: number | null = null;
    let baselineBalance: number | null = null;

    for (let i = 0; i < ordered.length; i++) {
      const t = ordered[i];
      if (isCashFlow(t.action_type)) {
        const tms = txEpochMs(t);
        baselineTimeMs = tms || null;
        const b = balAfter(t);
        baselineBalance = typeof b === 'number' ? Number(b.toFixed(2)) : null;
      }
    }

    // 2) If none visible, baseline = balance BEFORE the first visible row
    if (baselineTimeMs === null) {
      const first = ordered[0];
      const b = balAfter(first);
      if (typeof b === 'number' && typeof first.amount === 'number') {
        baselineBalance = Number((b - first.amount).toFixed(2));
      } else if (typeof b === 'number') {
        baselineBalance = Number(b.toFixed(2));
      } else {
        baselineBalance = null;
      }
      baselineTimeMs = txEpochMs(first) || null;
    }

    // 3) End balance = newest visible row's balance_after
    const last = ordered[ordered.length - 1];
    const endB = balAfter(last);
    const endBalance = typeof endB === 'number' ? Number(endB.toFixed(2)) : null;

    // 4) Net P/L: prefer (end - start) if both known; else sum amounts AFTER baseline
    let netPL: number | null = null;
    if (typeof baselineBalance === 'number' && typeof endBalance === 'number') {
      netPL = Number((endBalance - baselineBalance).toFixed(2));
    } else {
      const sum = ordered
        .filter((t) => (txEpochMs(t) || 0) > (baselineTimeMs || -Infinity))
        .reduce((s, t) => s + amt(t), 0);
      netPL = Number(sum.toFixed(2));
    }

    // 5) Trades & wins only AFTER baseline
    let trades = 0;
    let wins = 0;
    for (const t of ordered) {
      const tms = txEpochMs(t) || 0;
      if (baselineTimeMs !== null && tms <= baselineTimeMs) continue;
      if (norm(t.action_type) === 'sell' && typeof t.amount === 'number') {
        trades += 1;
        if (t.amount > 0) wins += 1;
      }
    }
    const winRate = trades > 0 ? (wins / trades) * 100 : null;

    const growth =
      typeof baselineBalance === 'number' && baselineBalance > 0 && typeof netPL === 'number'
        ? (netPL / baselineBalance) * 100
        : null;

    return {
      start_balance: baselineBalance,
      end_balance: endBalance,
      net_pl: netPL,
      trades,
      wins,
      win_rate: winRate,
      growth_pct: growth,
      visible_start_time: txEpochMs(ordered[0]) || null,
      visible_end_time: txEpochMs(ordered[ordered.length - 1]) || null,
    };
  }, [stmItems]);

  /** Render */
  const card = featuredTrader;

  return (
    <div className="cth-root" data-theme={theme}>
      {/* Top bar */}
      <header className="topbar glass">
        <div className="brand">Denara Copytrading Hub</div>
        <div className="topbar__actions">
          <button className="btn ghost" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button className="btn" onClick={() => loadTraders()}>Refresh</button>
        </div>
      </header>

      {/* Grid */}
      <div className="ct-hub__grid">
        {/* Left column: Trader Registration (KEPT but HIDDEN) */}
        <section className="card card--form glass is-hidden-for-now">
          <h2>Create Trader Username</h2>
          <p className="muted small">
            Requires Deriv token with <strong>Read</strong>, <strong>Trade</strong>, and <strong>Trading information</strong> scopes.
          </p>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!tUser.trim() || !tToken.trim()) return;
              if (!isPositiveNum(tMinBal)) return;
              if (!priceWithinLimit(tPrice)) return;

              setSubmittingTrader(true);
              try {
                const res = await fetch(`${API_BASE}/traders`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    username: tUser.trim(),
                    min_balance: Number(tMinBal || 0),
                    token: tToken.trim(),
                    price_usd: tPrice.trim() ? Number(tPrice) : null,
                  }),
                });
                if (!res.ok) {
                  const err = await res.json().catch(() => ({}));
                  throw new Error(err.error || `HTTP ${res.status}`);
                }
                const row = (await res.json()) as TraderRow;
                const newTrader: Trader = {
                  id: String(row.id),
                  username: row.username,
                  min_balance: Number(row.min_balance ?? 0),
                  price_usd: row.price_usd === null ? null : Number(row.price_usd),
                  active_copiers: Number(row.active_copiers ?? 0),
                  created_at: Date.parse(row.created_at || new Date().toISOString()),
                };
                setTraders((prev) => [newTrader, ...prev]);
                setTUser('');
                setTMinBal('');
                setTToken('');
                setTPrice('');
                pushToast('Trader registered', 'success');
              } catch (err: any) {
                pushToast(err?.message || 'Failed to register trader', 'error');
              } finally {
                setSubmittingTrader(false);
              }
            }}
            className="form-grid"
          >
            <label>
              <span>Username</span>
              <input type="text" placeholder="trader" value={tUser} onChange={(e) => setTUser(e.target.value)} required />
            </label>
            <label>
              <span>Minimum Required Balance (USD)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={tMinBal}
                onChange={(e) => setTMinBal(e.target.value)}
              />
              {!isPositiveNum(tMinBal) && <em className="err">Enter a valid amount ≥ 0</em>}
            </label>
            <label className="span-2">
              <span>Deriv Token</span>
              <input
                type="text"
                placeholder="Paste trader's Deriv token"
                value={tToken}
                onChange={(e) => setTToken(e.target.value)}
                required
              />
            </label>
            <label>
              <span>Price (USD)</span>
              <input
                type="number"
                min={0}
                max={5}
                step="0.01"
                placeholder="Leave blank for free"
                value={tPrice}
                onChange={(e) => setTPrice(e.target.value)}
              />
              {!priceWithinLimit(tPrice) && <em className="err">Max allowed is $5.00</em>}
            </label>
            <div className="actions span-2">
              <button
                className="btn primary"
                type="submit"
                disabled={
                  submittingTrader || !tUser.trim() || !tToken.trim() || !isPositiveNum(tMinBal) || !priceWithinLimit(tPrice)
                }
              >
                {submittingTrader ? 'Registering…' : 'Register Trader'}
              </button>
            </div>
          </form>
        </section>

        {/* Copier Registration */}
        <section className="card card--form glass">
          <h2>Register Copier</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!cUser.trim() || !cToken.trim()) return;

              setSubmittingCopier(true);
              try {
                const res = await fetch(`${API_BASE}/copiers`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ username: cUser.trim(), token: cToken.trim() }),
                });
                if (!res.ok) {
                  const err = await res.json().catch(() => ({}));
                  throw new Error(err.error || `HTTP ${res.status}`);
                }
                setCUser('');
                setCToken('');
                pushToast('Copier registered', 'success');
              } catch (err: any) {
                pushToast(err?.message || 'Failed to register copier', 'error');
              } finally {
                setSubmittingCopier(false);
              }
            }}
            className="form-grid"
          >
            <label>
              <span>Username</span>
              <input
                type="text"
                placeholder="e.g. denara_fan01"
                value={cUser}
                onChange={(e) => setCUser(e.target.value)}
                required
              />
            </label>
            <label className="span-2">
              <span>Deriv Token (copier)</span>
              <input
                type="text"
                placeholder="Paste copier's Deriv token"
                value={cToken}
                onChange={(e) => setCToken(e.target.value)}
                required
              />
            </label>
            <div className="actions span-2">
              <button className="btn primary" type="submit" disabled={submittingCopier || !cUser.trim() || !cToken.trim()}>
                {submittingCopier ? 'Registering…' : 'Register Copier'}
              </button>
            </div>
          </form>
        </section>

        {/* Right column: ONLY the featured trader */}
        <section className="card card--list glass">
          <div className="list-head">
            <h2>Featured Trader</h2>
          </div>

          {loadingList ? (
            <div className="skeleton-list">
              <div className="skeleton-card">
                <div className="sk-row" />
                <div className="sk-kpis" />
              </div>
            </div>
          ) : listErr ? (
            <div className="empty err">{listErr}</div>
          ) : !card ? (
            <div className="empty">
              <div className="winner-badge muted">Denara Season (S1) Tournament Winner</div>
              <div className="muted">
                “{FEATURED_USERNAME}” is not registered yet. <strong>Admin:</strong> register the trader to enable copytrading.
              </div>
              <button className="btn ghost" onClick={() => loadTraders()}>Retry</button>
            </div>
          ) : (
            <ul className="trader-list">
              <li key={card.id} className="trader-card">
                <div className="trader-card__main">
                  <div className="badge-row">
                    <span className="badge">{card.username}</span>
                    <span className="chip chip--gold" title="Tournament Winner">
                      Denara Season (S1) Tournament Winner
                    </span>
                    {card.price_usd == null ? (
                      <span className="chip chip--free">Free</span>
                    ) : (
                      <span className="chip"><small>Fee</small>{currencyFmt.format(card.price_usd)}</span>
                    )}
                    <span className="chip chip--ghost">Copiers: {card.active_copiers}</span>
                  </div>

                  <div className="meta-grid">
                    <div>
                      <strong>Min Copy Balance:</strong> ${card.min_balance.toFixed(2)}
                    </div>
                    <div className="muted small">ID: {card.id}</div>
                    <div className="muted small">Joined: {new Date(card.created_at).toLocaleDateString()}</div>
                  </div>

                  {/* Copy relationship controls */}
                  <div className="copy-inline">
                    <input
                      type="text"
                      placeholder="Enter Copier username | If trader reregister as copier before starting"
                      value={copyUsernameByTrader[card.id] || ''}
                      onChange={(e) => setCopyUsernameByTrader((prev) => ({ ...prev, [card.id]: e.target.value }))}
                    />
                    <button
                      className="btn"
                      disabled={!card?.id || !(copyUsernameByTrader[card.id] || '').trim() || !!copyBusyByTrader[card.id]}
                      onClick={() => startCopy(card)}
                      title="Start copy (fee flow runs if trader has price)"
                    >
                      {copyBusyByTrader[card.id] ? 'Starting…' : 'Copy Start'}
                    </button>
                    <button
                      className="btn ghost"
                      disabled={!card?.id || !(copyUsernameByTrader[card.id] || '').trim() || !!stopBusyByTrader[card.id]}
                      onClick={() => stopCopy(card)}
                      title="Stop server-side copy for this trader→copier"
                    >
                      {stopBusyByTrader[card.id] ? 'Stopping…' : 'Copy Stop'}
                    </button>
                    <button
                      className="btn ghost"
                      onClick={() => loadActiveRelations(card)}
                      disabled={!card?.id || !!activeBusyByTrader[card.id]}
                      title="Show active copiers for this trader"
                    >
                      {activeBusyByTrader[card.id] ? 'Loading…' : 'Active Copiers'}
                    </button>
                  </div>

                  {/* Small explainer below copy controls */}
                  <div className="muted xsmall pay-explainer">
                    This <strong>trader</strong> charges <strong>USD 5</strong> for services and a minimum balance of Usd 10. To copy trader copier token Must have Payment ans Admin Permissions.
                  </div>

                  {/* Active copiers (🔒 usernames masked here) */}
                  {Array.isArray(activeListByTrader[card.id]) && (
                    <div className="active-copiers">
                      {activeListByTrader[card.id]!.length === 0 ? (
                        <div className="muted small">No active copiers.</div>
                      ) : (
                        <ul>
                          {activeListByTrader[card.id]!.map((rel) => (
                            <li key={rel.id}>
                              <span className="tag">{maskUsername(rel.copier_username)}</span>
                              <span className={`dot ${rel.active ? 'on' : 'off'}`} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>

                <div className="trader-card__actions">
                  <button className="btn ghost" disabled={!card?.id} onClick={() => openStatements(card)}>
                    View Statements 
                  </button>
                </div>
              </li>
            </ul>
          )}
        </section>
      </div>

      {/* Statements Modal */}
      {statementModalFor && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Trader statements">
          <div className="modal">
            <div className="modal__head">
              <h3>{statementModalFor.username} — Statements MTD</h3>
              <button className="icon-btn" onClick={() => setStatementModalFor(null)} aria-label="Close">
                ×
              </button>
            </div>

            <div className="modal__body">
              {stmErr && <div className="statements__status error">{stmErr}</div>}

              {/* ======== VISIBLE SUMMARY BAR (computed from visible rows) ======== */}
              {!stmErr && (
                <div className="visible-summary glass">
                  <div className="vs__row">
                    <div className="vs__item">
                      <div className="vs__label">Starting Balance (visible)</div>
                      <div className="vs__value">
                        {typeof visibleSummary.start_balance === 'number'
                          ? currencyFmt.format(visibleSummary.start_balance)
                          : '—'}
                      </div>
                    </div>
                    <div className="vs__item">
                      <div className="vs__label">Current Balance (visible)</div>
                      <div className="vs__value">
                        {typeof visibleSummary.end_balance === 'number'
                          ? currencyFmt.format(visibleSummary.end_balance)
                          : '—'}
                      </div>
                    </div>
                    <div className="vs__item">
                      <div className="vs__label">Net P/L</div>
                      <div
                        className={`vs__value ${
                          typeof visibleSummary.net_pl === 'number' && visibleSummary.net_pl >= 0 ? 'pos' : 'neg'
                        }`}
                      >
                        {typeof visibleSummary.net_pl === 'number'
                          ? currencyFmt.format(visibleSummary.net_pl)
                          : '—'}
                      </div>
                    </div>
                    <div className="vs__item">
                      <div className="vs__label">Growth</div>
                      <div
                        className={`vs__value ${
                          typeof visibleSummary.growth_pct === 'number' && visibleSummary.growth_pct >= 0 ? 'pos' : 'neg'
                        }`}
                      >
                        {pctFmt(visibleSummary.growth_pct)}
                      </div>
                    </div>
                    <div className="vs__item">
                      <div className="vs__label">Win rate</div>
                      <div className="vs__value">{pctFmt(visibleSummary.win_rate)}</div>
                    </div>
                    <div className="vs__item">
                      <div className="vs__label">Trades</div>
                      <div className="vs__value">{visibleSummary.trades ?? 0}</div>
                    </div>
                  </div>

                  <div className="vs__range muted xsmall">
                    Visible range:{' '}
                    {visibleSummary.visible_start_time
                      ? new Date(visibleSummary.visible_start_time).toLocaleString()
                      : '—'}{' '}
                    →{' '}
                    {visibleSummary.visible_end_time
                      ? new Date(visibleSummary.visible_end_time).toLocaleString()
                      : '—'}
                  </div>
                </div>
              )}

              {/* ======== STATEMENTS TABLE (renders immediately) ======== */}
              {!stmErr && (
                <>
                  <div className="statements__head">
                    <div className="col col--time">Time</div>
                    <div className="col col--action">Action</div>
                    <div className="col col--refid">Reference ID</div>
                    <div className="col col--app">App ID</div>
                    <div className="col col--reftype">Type</div>
                    <div className="col col--amt">Amount</div>
                    <div className="col col--bal">Balance</div>
                  </div>

                  <ul className="statements__list">
                    {stmItems.map((t) => {
                      const tms = txEpochMs(t);
                      const action = norm(t.action_type);
                      const amt = typeof t.amount === 'number' ? t.amount : undefined;
                      const bal =
                        typeof t.balance_after === 'number'
                          ? t.balance_after
                          : typeof t.balance === 'number'
                          ? t.balance
                          : undefined;

                      return (
                        <li key={txKey(t)} className="statements__row">
                          <div className="col col--time">{tms ? new Date(tms).toLocaleString() : '—'}</div>
                          <div className={`col col--action ${action || ''}`}>{action || '—'}</div>
                          <div className="col col--refid">{t.reference_id ?? '—'}</div>
                          <div className="col col--app">{t.app_id ?? '—'}</div>
                          <div className="col col--reftype">
                            {norm(t.reference_type) ||
                              norm(t.transaction_type) ||
                              norm(t.category) ||
                              norm(t.type) ||
                              norm(t.contract_type) ||
                              '—'}
                          </div>
                          <div className={`col col--amt ${(amt ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                            {typeof amt === 'number' ? `${amt >= 0 ? '+' : ''}${amt.toFixed(2)} USD` : '—'}
                          </div>
                          <div className="col col--bal">
                            {typeof bal === 'number' ? `${bal.toFixed(2)} USD` : '—'}
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="modal__foot modal__foot--spread">
                    <div className="muted small">
                      Window: {new Date(fromSec * 1000).toLocaleString()} → {new Date(toSec * 1000).toLocaleString()}
                    </div>
                    <div className="actions">
                      <button
                        className="btn"
                        disabled={stmLoading || !stmHasMore}
                        onClick={() => loadMoreStatements(statementModalFor!, stmOffset)}
                      >
                        {stmLoading ? 'Loading…' : stmHasMore ? 'Load more' : 'End'}
                      </button>
                      <button className="btn ghost" onClick={() => setStatementModalFor(null)}>
                        Close
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======== Payment OTP Modal ======== */}
      {payOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Payment verification">
          <div className="modal otp-modal">
            <div className="modal__head">
              <h3>Confirm Payment</h3>
              <button className="icon-btn" onClick={() => setPayOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            <div className="modal__body">
              <div className="pay-summary">
                <div className="row">
                  <span>Trader</span>
                  <strong>{payTrader?.username}</strong>
                </div>
                <div className="row">
                  <span>Amount</span>
                  <strong>
                    {currencyFmt.format(invoiceAmt)} {invoiceCur}
                  </strong>
                </div>
                <div className="row">
                  <span>Verification Email</span>
                  <strong>{otpEmailMasked || 'your Deriv email'}</strong>
                </div>
              </div>

              <label className="otp-field">
                <span>Enter the verification code</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 12345"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                />
              </label>

              <div className="muted xsmall">
                A code was sent to your Deriv email after you initiated payment. Paste it here to complete the withdrawal to our Payment Agent.
              </div>
            </div>

            <div className="modal__foot modal__foot--spread">
              <div className="muted small">Invoice #{invoiceId ?? '—'}</div>
              <div className="actions">
                <button className="btn" disabled={otpConfirming || !otpCode.trim()} onClick={paymentsConfirm}>
                  {otpConfirming ? 'Confirming…' : 'Confirm & Start Copy'}
                </button>
                <button className="btn ghost" onClick={() => setPayOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <Toasts items={toasts} onDismiss={removeToast} />
    </div>
  );
};

export default CopyTradingHub;
 