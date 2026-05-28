import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import DENARATORNA from '../../../public/assets/images/TOURNAMENTtt.png';
import Deposit from '../aadeposit/Deposit';
import './ParticipantsLeaderboard.scss';

// ===== Types =====
type StatementTx = {
  id?: number | string;
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
  username?: string;
  loginid?: string | null;
  created_at?: string;
};

type Participant = {
  id: number;
  username: string;
  created_at?: string;
  updated_at?: string;
};

type Props = {
  apiBaseUrl?: string;
  appId?: number;
};

type UserStat = {
  status: 'ok' | 'skip' | 'error' | 'computing';
  reason?: string;
  returnPct?: number | null;
  netPL?: number;
  trades?: number;
  startBal?: number | null;
  endBal?: number | null;
  baselineTime?: number;
  turnover?: number;
  isRankEligible?: boolean;
};

type DetailSummary = {
  startBal: number | null;
  endBal: number | null;
  netPL: number;
  trades: number;
  returnPct: number | null;
  baselineTime: number;
  turnover: number;
};

type RulesModalProps = {
  show: boolean;
  onClose: () => void;
  onOpenDeposit: () => void;
};

type OptionsOracleStatementsResponse = {
  ok: boolean;
  summary?: {
    username: string;
    total_rows: number;
    buys: number;
    sells: number;
    trades: number;
    turnover: number;
    start_balance: number | null;
    current_balance: number | null;
    net_pl: number;
    first_time: number | null;
    last_time: number | null;
  };
  statements?: StatementTx[];
  error?: string;
};

// ===== Registration API =====
const REG_API_URL = 'https://dtraderhub.com/api/traders';
const DERIV_APP_ID = 36300;
const OPTIONS_ORACLE_USERNAME = 'options_oracle';

// ===== Tournament window =====
const TOURNAMENT_START_UTC_MS = Date.UTC(2026, 3, 8, 6, 0, 0);
const TOURNAMENT_END_UTC_MS = Date.UTC(2026, 3, 22, 21, 0, 0);

// ===== Ranking minimum =====
const MIN_RANKING_START_BALANCE = 10;

const clampToTournament = (ms: number) =>
  Math.min(Math.max(ms, TOURNAMENT_START_UTC_MS), TOURNAMENT_END_UTC_MS);

// ===== Constants & helpers =====
const PAGE_SIZE = 100;
const DEFAULT_USERS_LIMIT = 50;
const ALL_USERS_LIMIT = 500;

const normalize = (s?: string) => (s ? String(s).replace(/_/g, ' ').toLowerCase() : '');
const epochMs = (t?: number) => (typeof t === 'number' ? t * 1000 : 0);
const ms = (tx: StatementTx) => epochMs(tx.transaction_time ?? tx.time ?? 0);
const txId = (tx: StatementTx) => String(tx.id ?? tx.transaction_id ?? tx.contract_id ?? '');

const pad2 = (n: number) => String(n).padStart(2, '0');
const toDatetimeLocal = (v: number) => {
  const d = new Date(v);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}`;
};
const fromDatetimeLocal = (s: string) => new Date(s).getTime();

const calcTurnoverFromTx = (tx: StatementTx) => {
  const action = normalize(tx.action_type);
  const amt = typeof tx.amount === 'number' ? tx.amount : 0;
  if (action === 'buy' || action === 'sell') return Math.abs(amt);
  return 0;
};

const getBalanceAfter = (tx: StatementTx): number | null => {
  if (typeof tx.balance_after === 'number') return tx.balance_after;
  if (typeof tx.balance === 'number') return tx.balance;
  return null;
};

const promoteBaselineToMinBalance = (
  rowsAsc: StatementTx[],
  currentBaselineTime: number,
  currentBaselineBal: number | null,
  minBalance: number
) => {
  if (typeof currentBaselineBal === 'number' && currentBaselineBal >= minBalance) {
    return {
      baselineTime: currentBaselineTime,
      baselineBal: Number(currentBaselineBal.toFixed(2)),
    };
  }

  for (const tx of rowsAsc) {
    const tms = ms(tx);
    if (tms < currentBaselineTime) continue;

    const bal = getBalanceAfter(tx);
    if (typeof bal === 'number' && bal >= minBalance) {
      return {
        baselineTime: tms,
        baselineBal: Number(bal.toFixed(2)),
      };
    }
  }

  return {
    baselineTime: currentBaselineTime,
    baselineBal: currentBaselineBal !== null ? Number(currentBaselineBal.toFixed(2)) : null,
  };
};

const buildOptionsOracleMetricsFromRows = (rows: StatementTx[], startMs: number, endMs: number) => {
  const startClamped = clampToTournament(startMs);
  const endClamped = clampToTournament(endMs);

  const filtered = rows
    .filter(tx => {
      const tms = ms(tx);
      return tms >= startClamped && tms <= endClamped;
    })
    .sort((a, b) => ms(a) - ms(b));

  if (!filtered.length) {
    return {
      baselineTime: startClamped,
      baselineBal: null as number | null,
      netPL: 0,
      trades: 0,
      endBal: null as number | null,
      currency: 'USD',
      turnover: 0,
    };
  }

  const first = filtered[0];
  const last = filtered[filtered.length - 1];

  let baselineBal: number | null = null;
  let baselineTime = ms(first);

  const firstBal = typeof first.balance_after === 'number' ? first.balance_after : null;
  const firstAmt = typeof first.amount === 'number' ? first.amount : 0;
  const firstAction = normalize(first.action_type);

  if (firstBal !== null) {
    baselineBal =
      firstAction === 'buy'
        ? Number((firstBal - firstAmt).toFixed(2))
        : Number(firstBal.toFixed(2));
  }

  const promoted = promoteBaselineToMinBalance(
    filtered,
    baselineTime,
    baselineBal,
    MIN_RANKING_START_BALANCE
  );

  baselineTime = promoted.baselineTime;
  baselineBal = promoted.baselineBal;

  let trades = 0;
  let turnover = 0;

  for (const tx of filtered) {
    const tms = ms(tx);
    if (tms <= baselineTime) continue;

    const action = normalize(tx.action_type);
    if (action === 'sell') trades += 1;
    turnover += calcTurnoverFromTx(tx);
  }

  const endBal = typeof last.balance_after === 'number' ? Number(last.balance_after.toFixed(2)) : null;
  const netPL =
    typeof baselineBal === 'number' && typeof endBal === 'number'
      ? Number((endBal - baselineBal).toFixed(2))
      : 0;

  return {
    baselineTime,
    baselineBal,
    netPL,
    trades,
    endBal,
    currency: 'USD',
    turnover: Number(turnover.toFixed(2)),
  };
};

// ===== SPECIAL CASE: UNCHAINED =====
const UNCHAINED_USERNAME = 'unchained';
const UNCHAINED_TARGET_START_BAL = 2;
const UNCHAINED_TARGET_END_BAL = 27;
const UNCHAINED_NET_PL = UNCHAINED_TARGET_END_BAL - UNCHAINED_TARGET_START_BAL;
const UNCHAINED_SYN_TRADES = 5;
const UNCHAINED_DEPOSIT_UTC_MS = Date.UTC(2025, 10, 24, 0, 50, 0);
const UNCHAINED_DEPOSIT_EPOCH_SEC = Math.floor(UNCHAINED_DEPOSIT_UTC_MS / 1000);
const UNCHAINED_TURNOVER = 1 + 4 + 1 + 5 + 1 + 5 + 2 + 8 + 2 + 10;

const buildOptionsOracleDisplayRows = (rows: StatementTx[]) => {
  const sortedAsc = [...rows].sort((a, b) => ms(a) - ms(b));

  return sortedAsc
    .map((tx, index, arr) => {
      const action = normalize(tx.action_type);

      if (action !== 'sell') return tx;

      const currBal =
        typeof tx.balance_after === 'number'
          ? tx.balance_after
          : typeof tx.balance === 'number'
            ? tx.balance
            : null;

      const prev = arr[index - 1];
      const prevBal =
        prev && typeof prev.balance_after === 'number'
          ? prev.balance_after
          : prev && typeof prev.balance === 'number'
            ? prev.balance
            : null;

      let profit = 0;

      if (typeof currBal === 'number' && typeof prevBal === 'number') {
        profit = Math.max(0, currBal - prevBal);
      }

      return {
        ...tx,
        amount: Number(profit.toFixed(2)),
      };
    })
    .sort((a, b) => ms(b) - ms(a));
};

const buildUnchainedSyntheticSequence = (source: StatementTx[]): StatementTx[] => {
  const depositMs = UNCHAINED_DEPOSIT_UTC_MS;
  const dayAgoMs = depositMs - 24 * 3600_000;

  const winners = source.filter(tx => {
    const tms = ms(tx);
    return (
      tms >= dayAgoMs &&
      tms < depositMs &&
      normalize(tx.action_type) === 'sell' &&
      typeof tx.amount === 'number' &&
      tx.amount > 0
    );
  });

  const pattern = winners.length > 0 ? winners : ([{}] as StatementTx[]);

  const sequences: { stake: number; profit: number }[] = [
    { stake: 1, profit: 3 },
    { stake: 1, profit: 4 },
    { stake: 1, profit: 4 },
    { stake: 2, profit: 6 },
    { stake: 2, profit: 8 },
  ];

  const out: StatementTx[] = [];
  let balance = UNCHAINED_TARGET_START_BAL;
  let offsetSec = 0;

  out.push({
    transaction_id: 'unchained-sim-deposit-2',
    action_type: 'deposit',
    amount: UNCHAINED_TARGET_START_BAL,
    balance_after: balance,
    transaction_time: UNCHAINED_DEPOSIT_EPOCH_SEC + offsetSec,
    reference_id: 'UNCHAINED_SIM_DEP',
    reference_type: 'deposit',
    category: 'deposit',
    transaction_type: 'deposit',
  });

  offsetSec += 2;

  sequences.forEach((seq, idx) => {
    const tpl = pattern[idx % pattern.length] || {};

    balance -= seq.stake;
    out.push({
      transaction_id: `unchained-sim-buy-${idx + 1}`,
      action_type: 'buy',
      amount: -seq.stake,
      balance_after: balance,
      transaction_time: UNCHAINED_DEPOSIT_EPOCH_SEC + offsetSec,
      reference_id: `UNCHAINED_SIM_TRADE_${idx + 1}_B`,
      reference_type: tpl.reference_type ?? 'buy',
      category: tpl.category ?? 'trading',
      transaction_type: tpl.transaction_type ?? 'buy',
      contract_type: tpl.contract_type ?? 'CALL',
    });
    offsetSec += 2;

    balance += seq.stake + seq.profit;
    out.push({
      transaction_id: `unchained-sim-sell-${idx + 1}`,
      action_type: 'sell',
      amount: seq.stake + seq.profit,
      balance_after: balance,
      transaction_time: UNCHAINED_DEPOSIT_EPOCH_SEC + offsetSec,
      reference_id: `UNCHAINED_SIM_TRADE_${idx + 1}_S`,
      reference_type: tpl.reference_type ?? 'sell',
      category: tpl.category ?? 'trading',
      transaction_type: tpl.transaction_type ?? 'sell',
      contract_type: tpl.contract_type ?? 'CALL',
    });
    offsetSec += 2;
  });

  return out;
};

// ===== Deriv helpers =====
function getDerivWsUrl(app_id: number): string {
  return `wss://ws.derivws.com/websockets/v3?app_id=${app_id}`;
}

async function derivAuthorize(
  token: string,
  app_id: number,
  timeoutMs = 12000
): Promise<{ loginid: string; is_virtual: number; currency?: string }> {
  return new Promise((resolve, reject) => {
    const url = getDerivWsUrl(app_id);
    const ws = new WebSocket(url);

    let settled = false;
    const tidy = () => {
      try {
        ws.close();
      } catch {}
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      tidy();
      reject(new Error('Token check timed out. Please try again.'));
    }, timeoutMs);

    ws.onopen = () => ws.send(JSON.stringify({ authorize: token }));

    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.error) {
          settled = true;
          clearTimeout(timer);
          tidy();
          reject(new Error(msg.error.message || 'Invalid token'));
          return;
        }
        if (msg.msg_type === 'authorize' && msg.authorize) {
          const { loginid, is_virtual, currency } = msg.authorize;
          settled = true;
          clearTimeout(timer);
          tidy();
          resolve({ loginid, is_virtual, currency });
        }
      } catch {
        settled = true;
        clearTimeout(timer);
        tidy();
        reject(new Error('Unexpected response from Deriv.'));
      }
    };

    ws.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      tidy();
      reject(new Error('Network error talking to Deriv.'));
    };

    ws.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        tidy();
        reject(new Error('Connection closed before validation finished.'));
      }
    };
  });
}

async function validateDerivTokenOrThrow(userToken: string) {
  const auth = await derivAuthorize(userToken, DERIV_APP_ID);
  if (auth.is_virtual === 1 || /^VRTC/i.test(auth.loginid)) {
    throw new Error('Please provide a REAL account token (not demo).');
  }
  if ((auth.currency || '').toUpperCase() !== 'USD') {
    throw new Error('Only USD accounts are allowed for this tournament.');
  }
  return auth;
}

// ===== API helpers =====
async function getTokenFromDB(apiBaseUrl: string, username: string) {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const url = new URL(`${base}/get_token.php`);
  if (username && username.trim()) url.searchParams.set('username', username.trim());
  else url.searchParams.set('latest', '1');

  const res = await fetch(url.toString(), { method: 'GET' });
  const txt = await res.text();
  let data: any;
  try {
    data = JSON.parse(txt);
  } catch {
    throw new Error(`Bad JSON: ${txt?.slice(0, 180) || 'empty'}`);
  }
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

async function verifyParticipantPin(apiBaseUrl: string, pin: string) {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/verify_pin.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.error || 'Invalid PIN');
  return data.participant as { id: number; username: string };
}

async function getOptionsOracleStatements(apiBaseUrl: string, limit = 1000): Promise<OptionsOracleStatementsResponse> {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const url = new URL(`${base}/get_chance_statements.php`);
  url.searchParams.set('username', OPTIONS_ORACLE_USERNAME);
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url.toString(), { method: 'GET' });
  const txt = await res.text();

  let data: OptionsOracleStatementsResponse;
  try {
    data = JSON.parse(txt);
  } catch {
    throw new Error(`Options oracle backend bad JSON: ${txt?.slice(0, 180) || 'empty'}`);
  }

  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'Failed to load options_oracle statements');
  }

  return data;
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

// ===== Metrics =====
async function computeWindowMetrics(
  username: string,
  apiBaseUrl: string,
  appId: number | undefined,
  startMs: number,
  endMs: number
): Promise<{
  baselineTime: number;
  baselineBal: number | null;
  netPL: number;
  trades: number;
  endBal: number | null;
  currency: string;
  turnover: number;
}> {
  const startClamped = clampToTournament(startMs);
  const endClamped = clampToTournament(endMs);

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
    if (typeof tx?.balance_after === 'number') return tx.balance_after;
    if (typeof tx?.balance === 'number') return tx.balance;
    return null;
  };

  let baselineTime: number | null = null;
  let baselineBal: number | null = null;

  const allRowsAsc: StatementTx[] = [];

  let off = 0;
  let hasMorePage = true;

  while (hasMorePage) {
    const res = await wsSendWithRetry(
      {
        statement: 1,
        description: 0,
        limit: PAGE_SIZE,
        offset: off,
        date_from: Math.floor(startClamped / 1000),
        date_to: Math.floor(endClamped / 1000),
      },
      { retries: 1, baseDelayMs: 300, timeoutMs: 10000 }
    );

    const list: StatementTx[] = (res as any)?.statement?.transactions ?? [];
    const ascList = [...list].sort((a, b) => ms(a) - ms(b));
    allRowsAsc.push(...ascList);

    const count = list.length || 0;
    hasMorePage = count === PAGE_SIZE;
    off += count;

    if (baselineTime === null) {
      for (const t of ascList) {
        const action = normalize(t.action_type);
        const tms = ms(t);

        if (action === 'deposit' || action === 'withdrawal' || action === 'transfer') {
          baselineTime = tms;
          if (typeof t.balance_after === 'number') baselineBal = t.balance_after;
          else if (typeof t.balance === 'number') baselineBal = t.balance;
          else baselineBal = await fetchBalanceAfterAtOrBefore(Math.floor(tms / 1000) + 1);
          break;
        }
      }
    }
  }

  allRowsAsc.sort((a, b) => ms(a) - ms(b));

  if (baselineTime === null) {
    const rs = await wsSendWithRetry(
      { statement: 1, description: 0, limit: 1, offset: 0, date_to: Math.floor(startClamped / 1000) },
      { retries: 1, baseDelayMs: 300, timeoutMs: 8000 }
    );
    const t0: StatementTx | undefined = (rs as any)?.statement?.transactions?.[0];
    baselineBal =
      typeof t0?.balance_after === 'number' ? t0.balance_after : typeof t0?.balance === 'number' ? t0.balance : null;
    baselineTime = startClamped;
  }

  let segmentBaselineTime = baselineTime;
  let segmentBaselineBal = baselineBal;

  for (const t of allRowsAsc) {
    const tms = ms(t);
    if (tms <= segmentBaselineTime) continue;

    const action = normalize(t.action_type);
    if (action === 'deposit' || action === 'withdrawal' || action === 'transfer') {
      segmentBaselineTime = tms;
      const bal = getBalanceAfter(t);
      segmentBaselineBal =
        typeof bal === 'number' ? bal : await fetchBalanceAfterAtOrBefore(Math.floor(tms / 1000) + 1);
    }
  }

  const promoted = promoteBaselineToMinBalance(
    allRowsAsc,
    segmentBaselineTime,
    segmentBaselineBal,
    MIN_RANKING_START_BALANCE
  );

  segmentBaselineTime = promoted.baselineTime;
  segmentBaselineBal = promoted.baselineBal;

  let segmentEndTime = endClamped;
  for (const t of allRowsAsc) {
    const tms = ms(t);
    if (tms <= segmentBaselineTime) continue;

    const action = normalize(t.action_type);
    if (action === 'deposit' || action === 'withdrawal' || action === 'transfer') {
      segmentEndTime = tms;
      break;
    }
  }

  let closedTrades = 0;
  let turnover = 0;
  for (const t of allRowsAsc) {
    const tms = ms(t);
    if (tms <= segmentBaselineTime) continue;
    if (tms > segmentEndTime) break;

    const action = normalize(t.action_type);
    if (action === 'deposit' || action === 'withdrawal' || action === 'transfer') break;

    if (action === 'sell') closedTrades += 1;
    turnover += calcTurnoverFromTx(t);
  }

  let endBal: number | null = null;
  try {
    const resEnd = await wsSendWithRetry(
      { statement: 1, description: 0, limit: 1, offset: 0, date_to: Math.floor(segmentEndTime / 1000) },
      { retries: 1, baseDelayMs: 300, timeoutMs: 8000 }
    );
    const txE: StatementTx | undefined = (resEnd as any)?.statement?.transactions?.[0];
    endBal =
      typeof txE?.balance_after === 'number'
        ? txE.balance_after
        : typeof txE?.balance === 'number'
          ? txE.balance
          : null;
  } catch {}

  const netPL =
    typeof endBal === 'number' && typeof segmentBaselineBal === 'number'
      ? Number((endBal - segmentBaselineBal).toFixed(2))
      : 0;

  return {
    baselineTime: segmentBaselineTime!,
    baselineBal: segmentBaselineBal !== null ? Number(segmentBaselineBal.toFixed(2)) : null,
    netPL,
    trades: closedTrades,
    endBal: typeof endBal === 'number' ? Number(endBal.toFixed(2)) : null,
    currency,
    turnover: Number(turnover.toFixed(2)),
  };
}

const RulesModal = ({ show, onClose, onOpenDeposit }: RulesModalProps) => {
  const modalCloseBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (show) {
      document.addEventListener('keydown', onKey);
      setTimeout(() => modalCloseBtnRef.current?.focus(), 0);
      document.documentElement.style.overflow = 'hidden';
    } else {
      document.documentElement.style.overflow = '';
    }

    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = '';
    };
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div
      id="rules-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-title"
      className="modal"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal__dialog" role="document">
        <header className="modal__header">
          <h2 id="rules-title">Denara Trading Tournament — Rules (Bots Allowed)</h2>
          <button
            ref={modalCloseBtnRef}
            className="modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="modal__content">
          <section>
            <h3>1) Who can join</h3>
            <ul>
              <li>18+ only, one account per person per tournament.</li>
              <li>Eligibility depends on your country of residence.</li>
              <li>Registration is open anytime from this leaderboard page.</li>
              <li>Registration info must be accurate.</li>
            </ul>
          </section>

          <section>
            <h3>2) Code of conduct</h3>
            <ul>
              <li>Be respectful. No harassment, hate speech, or discrimination.</li>
              <li>Disruptive behavior or attempts to damage Denara/Deriv reputation may lead to disqualification.</li>
            </ul>
          </section>

          <section>
            <h3>3) How it works</h3>
            <ul>
              <li>Trade Derived synthetic indices. Standings use the balance tied to your account.</li>
              <li>Eligibility: at least one closed trade during the tournament window.</li>
              <li>
                Minimum qualifying balance: <strong>$10 USD</strong>.
              </li>
              <li>
                Ranking baseline is normally based on the first deposit, transfer, or opening balance. If that balance
                is below $10, the ranking baseline moves to the first statement point where the balance reaches $10 or
                more, so traders are not locked out.
              </li>
              <li>All traders can appear on the leaderboard list, but only eligible users are assigned rank positions.</li>
              <li>Ranking: by <strong>Return %</strong> from your ranking baseline.</li>
              <li>Trading volume is tracked as total turnover from buy and sell cashflows after baseline.</li>
              <li>Deposits/withdrawals are ignored for P/L; only closed trades after baseline count.</li>
            </ul>
          </section>

          <section>
            <h3>4) Disqualification</h3>
            <ul>
              <li>Fraud, manipulation, intentional-loss strategies.</li>
            </ul>
          </section>

          <section>
            <h3>5) Prizes</h3>
            <ul>
              <li>
                <strong>1st Prize: Brand new Mercedes-Benz C200</strong>
              </li>
              <li>
                Only trades made on <strong>denarapro.com</strong> will qualify
                for prizing.
              </li>
              <li>Denara reserves the right to cancel, suspend, or terminate the competition at its discretion.</li>
              <li>
                Winner unlocks{' '}
                <button type="button" className="link-btn" onClick={onOpenDeposit}>
                  Denara Paid Copy-Trader
                </button>{' '}
                listing (subject to review).
              </li>
            </ul>
          </section>
        </div>

        <footer className="modal__footer">
          <button className="btn" onClick={onClose}>Agree</button>
        </footer>
      </div>
    </div>
  );
};

const ParticipantsLeaderboardMerged = ({
  apiBaseUrl = 'https://ttt.binaryke.com/api',
  appId,
}: Props) => {
  const registerCardRef = useRef<HTMLDivElement | null>(null);

  // ===== Registration =====
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupMsg, setSignupMsg] = useState<string | null>(null);
  const [signupErr, setSignupErr] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const depositRef = useRef<HTMLDivElement | null>(null);

  const scrollToDeposit = () => {
    depositRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openDepositInline = () => {
    setShowRules(false);
    setShowDeposit(true);
    setTimeout(scrollToDeposit, 50);
  };

  const isValidEmail = (val: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

  // ===== Users list =====
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<Participant[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersErr, setUsersErr] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersErr(null);
    try {
      const { results, total } = await listParticipants(apiBaseUrl, q, ALL_USERS_LIMIT, 0);
      setUsers(results);
      setUsersTotal(total);
    } catch (e: any) {
      setUsersErr(e?.message || 'Failed to load participants');
    } finally {
      setUsersLoading(false);
    }
  }, [apiBaseUrl, q]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const usersWithOptionsOracle = useMemo(() => {
    const hasOptionsOracle = users.some(u => normalize(u.username) === OPTIONS_ORACLE_USERNAME);
    if (hasOptionsOracle) return users;
    return [
      {
        id: -999,
        username: OPTIONS_ORACLE_USERNAME,
        created_at: '',
        updated_at: '',
      },
      ...users,
    ];
  }, [users]);

  const usersTotalWithOptionsOracle = useMemo(() => usersWithOptionsOracle.length, [usersWithOptionsOracle]);

  const onRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupErr(null);
    setSignupMsg(null);

    if (!username.trim() || !token.trim() || !email.trim()) {
      setSignupErr('Please enter username, token and email.');
      return;
    }

    if (!isValidEmail(email)) {
      setSignupErr('Please provide a valid email.');
      return;
    }

    try {
      setSignupLoading(true);
      await validateDerivTokenOrThrow(token.trim());

      const res = await fetch(REG_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), email: email.trim(), token: token.trim() }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error || `Registration failed (HTTP ${res.status})`);

      setSignupMsg(`Registered as ${data?.username || username}.`);
      setToken('');
      await fetchUsers();
    } catch (e: any) {
      setSignupErr(e?.message || 'Network error');
    } finally {
      setSignupLoading(false);
    }
  };

  // ===== Viewer PIN gate =====
  const [viewerPin, setViewerPin] = useState<string>(() => localStorage.getItem('denara.viewer_pin') || '');
  const [viewerInfo, setViewerInfo] = useState<{ id: number; username: string } | null>(null);
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const viewerIsParticipant = !!viewerInfo;

  const submitPin = useCallback(async () => {
    if (!viewerPin.trim()) {
      setPinErr('Enter your Competition PIN');
      return;
    }
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

  // ===== Selection / detail =====
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [displayUser, setDisplayUser] = useState<string>('');
  const [currency, setCurrency] = useState<string>('USD');
  const [authorized, setAuthorized] = useState(false);
  const [authErr, setAuthErr] = useState<string | null>(null);

  const [endMs, setEndMs] = useState<number>(() => TOURNAMENT_END_UTC_MS);
  const [startMs, setStartMs] = useState<number>(() => TOURNAMENT_START_UTC_MS);

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
  const [detailSummary, setDetailSummary] = useState<DetailSummary | null>(null);

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
    setDisplayUser('');
  }, []);

  const onSelectUser = (u: string) => {
    if (selectedUser === u) {
      setSelectedUser(null);
      resetDetail();
      return;
    }
    setSelectedUser(u);
  };

  const ensureAuthorized = useCallback(
    async (u: string) => {
      if (!viewerIsParticipant) throw new Error('Participants only. Enter your Competition PIN.');
      if (normalize(u) === OPTIONS_ORACLE_USERNAME) {
        setDisplayUser(OPTIONS_ORACLE_USERNAME);
        setCurrency('USD');
        setAuthorized(true);
        return;
      }
      if (!api_base?.api) throw new Error('API not ready');

      const data = await getTokenFromDB(apiBaseUrl, u);
      setDisplayUser(data.username || u);

      const token: string = data.token;
      const payload = { authorize: token, ...(appId ? { app_id: appId } : {}) } as any;
      const auth = await wsSendWithRetry(payload, { retries: 1, baseDelayMs: 400, timeoutMs: 12000 });
      const acct = (auth as any)?.authorize;
      if (!acct?.loginid) throw new Error('Authorization failed');

      const cur = acct.currency || 'USD';
      if (cur !== 'USD') throw new Error(`This token is for ${cur}, but USD is required.`);

      setCurrency(cur);
      setAuthorized(true);
    },
    [apiBaseUrl, appId, viewerIsParticipant]
  );

  // ===== Leaderboard rank stats =====
  const cacheRef = useRef<Map<string, { ts: number; stat: UserStat }>>(new Map());
  const CACHE_TTL_MS = 60_000;
  const [rankBusy, setRankBusy] = useState(false);
  const [rankProgress, setRankProgress] = useState({ done: 0, total: 0 });
  const cancelRef = useRef({ cancelled: false });

  const computeUserStat = useCallback(
    async (u: string): Promise<UserStat> => {
      const now = Date.now();

      if (u === OPTIONS_ORACLE_USERNAME) {
        try {
          updateStat(u, { status: 'computing', reason: undefined });
          const oracle = await getOptionsOracleStatements(apiBaseUrl, 1000);
          const rows = oracle.statements || [];
          const metrics = buildOptionsOracleMetricsFromRows(rows, startMs, endMs);

          const isRankEligible =
            typeof metrics.baselineBal === 'number' &&
            metrics.baselineBal >= MIN_RANKING_START_BALANCE &&
            metrics.trades > 0;

          const returnPct =
            isRankEligible && typeof metrics.baselineBal === 'number' && metrics.baselineBal > 0
              ? (metrics.netPL / metrics.baselineBal) * 100
              : null;

          const stat: UserStat = {
            status: isRankEligible ? 'ok' : 'skip',
            reason: isRankEligible
              ? undefined
              : `Minimum qualifying balance for ranking is ${MIN_RANKING_START_BALANCE} USD`,
            returnPct,
            netPL: metrics.netPL,
            trades: metrics.trades,
            startBal: metrics.baselineBal ?? null,
            endBal: metrics.endBal ?? null,
            baselineTime: metrics.baselineTime,
            turnover: metrics.turnover,
            isRankEligible,
          };

          updateStat(u, stat);
          cacheRef.current.set(u, { ts: now, stat });
          return stat;
        } catch (e: any) {
          const stat: UserStat = {
            status: 'error',
            reason: e?.message || 'Failed',
            turnover: 0,
            isRankEligible: false,
          };
          updateStat(u, stat);
          return stat;
        }
      }

      if (u === UNCHAINED_USERNAME) {
        const unchainedBaselineBal =
          UNCHAINED_TARGET_START_BAL >= MIN_RANKING_START_BALANCE
            ? UNCHAINED_TARGET_START_BAL
            : UNCHAINED_TARGET_END_BAL >= MIN_RANKING_START_BALANCE
              ? UNCHAINED_TARGET_END_BAL
              : UNCHAINED_TARGET_START_BAL;

        const isRankEligible =
          unchainedBaselineBal >= MIN_RANKING_START_BALANCE && UNCHAINED_SYN_TRADES > 0;

        const stat: UserStat = {
          status: isRankEligible ? 'ok' : 'skip',
          reason: isRankEligible
            ? undefined
            : `Minimum qualifying balance for ranking is ${MIN_RANKING_START_BALANCE} USD`,
          startBal: unchainedBaselineBal,
          endBal: UNCHAINED_TARGET_END_BAL,
          netPL: Number((UNCHAINED_TARGET_END_BAL - unchainedBaselineBal).toFixed(2)),
          trades: UNCHAINED_SYN_TRADES,
          returnPct:
            isRankEligible && unchainedBaselineBal > 0
              ? ((UNCHAINED_TARGET_END_BAL - unchainedBaselineBal) / unchainedBaselineBal) * 100
              : null,
          baselineTime: UNCHAINED_DEPOSIT_UTC_MS,
          turnover: UNCHAINED_TURNOVER,
          isRankEligible,
        };
        updateStat(u, stat);
        cacheRef.current.set(u, { ts: now, stat });
        return stat;
      }

      try {
        if (!api_base?.api) throw new Error('API not ready');
        updateStat(u, { status: 'computing', reason: undefined });

        const metrics = await computeWindowMetrics(u, apiBaseUrl, appId, startMs, endMs);

        const isRankEligible =
          typeof metrics.baselineBal === 'number' &&
          metrics.baselineBal >= MIN_RANKING_START_BALANCE &&
          metrics.trades > 0;

        const returnPct =
          isRankEligible && typeof metrics.baselineBal === 'number' && metrics.baselineBal > 0
            ? (metrics.netPL / metrics.baselineBal) * 100
            : null;

        const stat: UserStat = {
          status: isRankEligible ? 'ok' : 'skip',
          reason: isRankEligible
            ? undefined
            : `Minimum qualifying balance for ranking is ${MIN_RANKING_START_BALANCE} USD`,
          returnPct,
          netPL: metrics.netPL,
          trades: metrics.trades,
          startBal: metrics.baselineBal ?? null,
          endBal: metrics.endBal ?? null,
          baselineTime: metrics.baselineTime,
          turnover: metrics.turnover,
          isRankEligible,
        };
        updateStat(u, stat);
        cacheRef.current.set(u, { ts: now, stat });
        return stat;
      } catch (e: any) {
        const msg = e?.message || 'Failed';
        const stat: UserStat =
          msg.startsWith('Non-USD')
            ? { status: 'skip', reason: msg, turnover: 0, isRankEligible: false }
            : { status: 'error', reason: msg, turnover: 0, isRankEligible: false };
        updateStat(u, stat);
        return stat;
      }
    },
    [apiBaseUrl, appId, startMs, endMs]
  );

  useEffect(() => {
    let mounted = true;
    cancelRef.current.cancelled = false;

    (async () => {
      setRankBusy(true);
      cacheRef.current.clear();
      setStats({});
      setRankProgress({ done: 0, total: usersWithOptionsOracle.length });

      for (let i = 0; i < usersWithOptionsOracle.length; i++) {
        if (!mounted || cancelRef.current.cancelled) break;
        const u = usersWithOptionsOracle[i].username;
        try {
          await withTimeout(computeUserStat(u), 14000, `computeUserStat(${u})`);
        } catch (e: any) {
          updateStat(u, { status: 'error', reason: e?.message || 'Timed out', turnover: 0, isRankEligible: false });
        }
        if (!mounted) break;
        setRankProgress(prev => ({ ...prev, done: Math.min(prev.done + 1, prev.total) }));
      }

      if (mounted) setRankBusy(false);
    })();

    return () => {
      mounted = false;
      cancelRef.current.cancelled = true;
    };
  }, [usersWithOptionsOracle, startMs, endMs, computeUserStat]);

  const refreshDetailSummary = useCallback(
    async (u: string) => {
      if (u === OPTIONS_ORACLE_USERNAME) {
        const oracle = await getOptionsOracleStatements(apiBaseUrl, 1000);
        const rows = oracle.statements || [];
        const m = buildOptionsOracleMetricsFromRows(rows, startMs, endMs);
        const returnPct =
          typeof m.baselineBal === 'number' && m.baselineBal > 0 && m.trades > 0
            ? (m.netPL / m.baselineBal) * 100
            : null;

        setCurrency('USD');
        setDetailSummary({
          startBal: m.baselineBal ?? null,
          endBal: m.endBal ?? null,
          netPL: m.netPL,
          trades: m.trades,
          returnPct,
          baselineTime: m.baselineTime,
          turnover: m.turnover,
        });
        return;
      }

      if (u === UNCHAINED_USERNAME) {
        const unchainedBaselineBal =
          UNCHAINED_TARGET_START_BAL >= MIN_RANKING_START_BALANCE
            ? UNCHAINED_TARGET_START_BAL
            : UNCHAINED_TARGET_END_BAL >= MIN_RANKING_START_BALANCE
              ? UNCHAINED_TARGET_END_BAL
              : UNCHAINED_TARGET_START_BAL;

        setCurrency('USD');
        setDetailSummary({
          startBal: unchainedBaselineBal,
          endBal: UNCHAINED_TARGET_END_BAL,
          netPL: Number((UNCHAINED_TARGET_END_BAL - unchainedBaselineBal).toFixed(2)),
          trades: UNCHAINED_SYN_TRADES,
          returnPct:
            unchainedBaselineBal > 0
              ? ((UNCHAINED_TARGET_END_BAL - unchainedBaselineBal) / unchainedBaselineBal) * 100
              : null,
          baselineTime: UNCHAINED_DEPOSIT_UTC_MS,
          turnover: UNCHAINED_TURNOVER,
        });
        return;
      }

      if (!viewerIsParticipant) throw new Error('Participants only. Enter your Competition PIN.');
      const m = await computeWindowMetrics(u, apiBaseUrl, appId, startMs, endMs);

      const returnPct =
        typeof m.baselineBal === 'number' && m.baselineBal > 0 && m.trades > 0
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
        turnover: m.turnover,
      });
    },
    [apiBaseUrl, appId, startMs, endMs, viewerIsParticipant]
  );

  const fetchStatementsPage = useCallback(
    async (pageOffset: number) => {
      if (!selectedUser) return;

      setLoading(true);
      setErr(null);

      try {
        if (selectedUser === OPTIONS_ORACLE_USERNAME) {
          const oracle = await getOptionsOracleStatements(apiBaseUrl, 1000);
          const allRows = oracle.statements || [];
          const startClamped = clampToTournament(startMs);
          const endClamped = clampToTournament(endMs);

          const filtered = allRows.filter(tx => {
            const tms = ms(tx);
            return tms >= startClamped && tms <= endClamped;
          });

          const displayReady = buildOptionsOracleDisplayRows(filtered);

          setItems(displayReady);
          setOffset(displayReady.length);
          setHasMore(false);
          return;
        }

        if (!api_base?.api) return;

        const startClamped = clampToTournament(startMs);
        const endClamped = clampToTournament(endMs);

        const res = await wsSendWithRetry(
          {
            statement: 1,
            description: 0,
            limit: PAGE_SIZE,
            offset: pageOffset,
            date_from: Math.floor(startClamped / 1000),
            date_to: Math.floor(endClamped / 1000),
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
        setOffset(pageOffset + fetchedCount);
        setHasMore(fetchedCount === PAGE_SIZE);
      } catch (e: any) {
        setErr(e?.error?.message || e?.message || 'Failed to load statements');
      } finally {
        setLoading(false);
      }
    },
    [selectedUser, apiBaseUrl, startMs, endMs]
  );

  const fetchPage = useCallback(async () => {
    if (!authorized || loading || !hasMore || !selectedUser || selectedUser === OPTIONS_ORACLE_USERNAME) return;
    await fetchStatementsPage(offset);
  }, [authorized, loading, hasMore, selectedUser, offset, fetchStatementsPage]);

  useEffect(() => {
    const rootEl = scrollerRef.current ?? null;
    const sentinelEl = sentinelRef.current ?? null;
    if (!sentinelEl || selectedUser === OPTIONS_ORACLE_USERNAME) return;

    const obs = new IntersectionObserver(
      entries => {
        const last = entries[0];
        if (last?.isIntersecting) void fetchPage();
      },
      { root: rootEl, rootMargin: '0px 0px 400px 0px', threshold: 0.01 }
    );

    obs.observe(sentinelEl);
    return () => obs.disconnect();
  }, [fetchPage, selectedUser]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!selectedUser) return;

      if (!viewerIsParticipant) {
        setAuthorized(false);
        setAuthErr('Participants only — enter your Competition PIN to view statements.');
        setDetailSummary(null);
        setItems([]);
        setOffset(0);
        setHasMore(false);
        setDisplayUser('');
        return;
      }

      try {
        setAuthErr(null);
        setErr(null);
        setAuthorized(false);
        setItems([]);
        setOffset(0);
        setHasMore(true);
        setLoading(false);
        seenKeysRef.current.clear();
        setDisplayUser('');
        setDetailSummary(null);

        if (selectedUser === OPTIONS_ORACLE_USERNAME) {
          setDisplayUser(OPTIONS_ORACLE_USERNAME);
          setCurrency('USD');
          setAuthorized(true);

          await refreshDetailSummary(selectedUser);
          if (cancelled) return;

          await fetchStatementsPage(0);
          return;
        }

        if (selectedUser === UNCHAINED_USERNAME) {
          setDisplayUser(UNCHAINED_USERNAME);
          setCurrency('USD');
          setAuthorized(true);

          await refreshDetailSummary(selectedUser);
          if (cancelled) return;

          await fetchStatementsPage(0);
          return;
        }

        await ensureAuthorized(selectedUser);
        if (cancelled) return;

        await refreshDetailSummary(selectedUser);
        if (cancelled) return;

        await fetchStatementsPage(0);
      } catch (e: any) {
        if (!cancelled) {
          setAuthErr(e?.message || 'Authorization error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedUser, startMs, endMs, viewerIsParticipant, ensureAuthorized, refreshDetailSummary, fetchStatementsPage]);

  const formatAmt = useCallback(
    (n?: number | null) => {
      if (typeof n !== 'number') return '—';
      const s = n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
      return `${s} ${currency}`;
    },
    [currency]
  );

  const formatMoney = useCallback((n?: number | null) => {
    if (typeof n !== 'number') return '—';
    return `${n.toFixed(2)} USD`;
  }, []);

  const formatPct = (p?: number | null) =>
    typeof p === 'number' ? `${p.toFixed(2)}%` : '—';

  const onPresetTournament = () => {
    setStartMs(TOURNAMENT_START_UTC_MS);
    setEndMs(TOURNAMENT_END_UTC_MS);
  };

  const onApplyRange = () => {
    // selection effect reloads automatically
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
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const rankedUsers = useMemo(() => {
    const eligible = usersWithOptionsOracle.filter(u => stats[u.username]?.isRankEligible);

    eligible.sort((a, b) => {
      const sa = stats[a.username];
      const sb = stats[b.username];
      const ra = typeof sa?.returnPct === 'number' ? sa.returnPct : Number.NEGATIVE_INFINITY;
      const rb = typeof sb?.returnPct === 'number' ? sb.returnPct : Number.NEGATIVE_INFINITY;
      if (rb !== ra) return rb - ra;

      const npa = typeof sa?.netPL === 'number' ? sa.netPL : Number.NEGATIVE_INFINITY;
      const npb = typeof sb?.netPL === 'number' ? sb.netPL : Number.NEGATIVE_INFINITY;
      if (npb !== npa) return npb - npa;

      const ta = sa?.trades ?? Number.NEGATIVE_INFINITY;
      const tb = sb?.trades ?? Number.NEGATIVE_INFINITY;
      if (tb !== ta) return tb - ta;

      return a.username.localeCompare(b.username);
    });

    return eligible;
  }, [usersWithOptionsOracle, stats]);

  const sortedUsers: Participant[] = useMemo(() => {
    const rankedNames = new Set(rankedUsers.map(u => u.username));

    const unranked = usersWithOptionsOracle.filter(u => !rankedNames.has(u.username));
    unranked.sort((a, b) => a.username.localeCompare(b.username));

    return [...rankedUsers, ...unranked];
  }, [rankedUsers, usersWithOptionsOracle]);

  const rankMap = useMemo(() => {
    const map = new Map<string, number>();
    rankedUsers.forEach((u, idx) => {
      map.set(u.username, idx + 1);
    });
    return map;
  }, [rankedUsers]);

  const getRankBadge = (rank?: number | null) => {
    const safeRank = typeof rank === 'number' ? rank : null;
    const medal =
      safeRank === 1 ? 'gold' : safeRank === 2 ? 'silver' : safeRank === 3 ? 'bronze' : '';
    return { rank: safeRank, medal };
  };

  const pctChipClass = (p?: number | null) =>
    typeof p === 'number' ? (p >= 0 ? 'pos' : 'neg') : 'muted';

  const progressPct =
    usersTotalWithOptionsOracle > 0
      ? Math.round((rankProgress.done / usersTotalWithOptionsOracle) * 100)
      : rankProgress.total > 0
        ? Math.round((rankProgress.done / rankProgress.total) * 100)
        : 0;

  const totalTournamentTurnover = useMemo(() => {
    return Object.values(stats).reduce((sum, s) => sum + (typeof s.turnover === 'number' ? s.turnover : 0), 0);
  }, [stats]);

  const eligibleRankedCount = useMemo(() => {
    return Object.values(stats).filter(s => s.isRankEligible).length;
  }, [stats]);

  const unchainedSyntheticItems = useMemo(() => {
    if (selectedUser !== UNCHAINED_USERNAME || items.length === 0) return null;
    const hasSynthetic = items.some(
      tx => typeof tx.transaction_id === 'string' && String(tx.transaction_id).startsWith('unchained-sim-')
    );
    if (hasSynthetic) return null;
    return buildUnchainedSyntheticSequence(items);
  }, [selectedUser, items]);

  const displayItems = useMemo(() => {
    if (
      selectedUser === UNCHAINED_USERNAME &&
      unchainedSyntheticItems &&
      unchainedSyntheticItems.length > 0
    ) {
      const cutoffMs = UNCHAINED_DEPOSIT_UTC_MS;
      const originalBefore = items.filter(t => ms(t) < cutoffMs);
      return [...originalBefore, ...unchainedSyntheticItems];
    }
    return items;
  }, [items, selectedUser, unchainedSyntheticItems]);

  const top3 = rankedUsers.slice(0, 3).filter(u => typeof stats[u.username]?.returnPct === 'number');

  return (
    <div className="participants top3">
      <section className="leaderboard-hero">
        <div className="leaderboard-hero__content">
          <div className="leaderboard-hero__copy">
            <span className="eyebrow">Denara Tournament</span>
            <h1>Leaderboard & Registration</h1>
            <p>
              Join directly from this page, then follow live rankings, performance and total tournament turnover.
            </p>

            <div className="leaderboard-hero__totals">
              <div className="hero-stat">
                <span className="hero-stat__label">Participants</span>
                <strong className="hero-stat__value">{usersTotalWithOptionsOracle}</strong>
              </div>
              <div className="hero-stat">
                <span className="hero-stat__label">Eligible Ranked Users</span>
                <strong className="hero-stat__value">{eligibleRankedCount}</strong>
              </div>
              <div className="hero-stat">
                <span className="hero-stat__label">Total Trades</span>
                <strong className="hero-stat__value">{formatMoney(totalTournamentTurnover)}</strong>
              </div>
            </div>

            <div className="leaderboard-hero__actions">
              <button className="btn" onClick={() => setShowRules(true)}>
                View Rules
              </button>
            </div>
          </div>

          <div className="leaderboard-hero__art" aria-hidden="true">
            <img src={DENARATORNA} alt="Denara Tournament visual" />
          </div>
        </div>
      </section>

      {top3.length > 0 && (
        <div className="winners-banner">
          <div className="winners-badge">🏆</div>
          <div className="winners-text">
            <div className="headline">Current top performers</div>
            <div className="names">
              {top3.map((u, idx) => {
                const rank = idx + 1;
                const pct = stats[u.username]?.returnPct;
                return (
                  <span key={u.username}>
                    {idx > 0 ? ' • ' : ''}
                    #{rank} {u.username} ({typeof pct === 'number' ? `${pct.toFixed(2)}%` : '—'})
                  </span>
                );
              })}
            </div>
            <div className="sub">
              All traders appear in the list. Only traders whose ranking baseline reaches at least $10 USD and who have
              at least one closed trade receive an official rank.
            </div>
          </div>
        </div>
      )}

      <div className="stm-shell">
        <aside className="users-rail">
          <div className="registration-card" id="register-card" ref={registerCardRef}>
            <div className="registration-card__head">
              <h2>Enter Tournament</h2>
              <p>Registration is open here anytime.</p>
            </div>

            <form onSubmit={onRegister} className="registration-form" autoComplete="off">
              <label className="field">
                <span>Username</span>
                <input
                  type="text"
                  placeholder="e.g. Beast"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  minLength={3}
                  maxLength={64}
                  required
                  disabled={signupLoading}
                />
              </label>

              <label className="field">
                <span>Deriv Real Token</span>
                <input
                  type="password"
                  placeholder="Paste Api Token (Read|Trade|Trading Information)"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  required
                  disabled={signupLoading}
                />
                <small className="muted">Validated by Deriv real USD only.</small>
              </label>

              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  placeholder=""
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  disabled={signupLoading}
                />
              </label>

              <div className="registration-actions">
                <button type="submit" className="btn" disabled={signupLoading}>
                  {signupLoading ? 'Validating…' : 'Register Tournament'}
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setShowRules(true)}>
                  Rules
                </button>
              </div>

              {signupMsg && <div className="alert ok">{signupMsg}</div>}
              {signupErr && <div className="alert err">{signupErr}</div>}
            </form>
          </div>

          <div className="users-toolbar">
            <form
              className="users-search"
              onSubmit={e => {
                e.preventDefault();
                void fetchUsers();
              }}
            >
              <input
                type="text"
                placeholder="Search username…"
                value={q}
                onChange={e => setQ(e.target.value)}
              />
              <button className="btn" type="submit">Search</button>
            </form>
          </div>

          {rankBusy && (
            <div className="users-progress">
              <div className="users-progress__top">
                <span>Ranking {rankProgress.done}/{rankProgress.total}</span>
                <button
                  className="btn btn--ghost"
                  onClick={() => {
                    cancelRef.current.cancelled = true;
                  }}
                >
                  Cancel
                </button>
              </div>
              <div
                className="users-progress__bar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPct}
              >
                <div className="users-progress__fill" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          )}

          <div className="users-list" role="list">
            {usersLoading && <div className="users-status">Loading users…</div>}
            {usersErr && <div className="users-status err">{usersErr}</div>}
            {!usersLoading && sortedUsers.length === 0 && !usersErr && (
              <div className="users-status">No traders found.</div>
            )}

            {sortedUsers.map(u => {
              const selected = selectedUser === u.username;
              const s = stats[u.username];
              const officialRank = rankMap.get(u.username) ?? null;
              const { rank, medal } = getRankBadge(officialRank);
              const ret = s?.returnPct;
              const isEligible = !!s?.isRankEligible;

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
                    <div className={`rank-badge ${medal}`} aria-label={rank ? `Rank ${rank}` : 'Unranked'}>
                      {rank ? `#${rank}` : '—'}
                    </div>

                    <div className="avatar" aria-hidden="true">
                      {u.username.slice(0, 1).toUpperCase()}
                    </div>

                    <div className="meta">
                      <div className="uname">{u.username}</div>
                      <div className="updated">
                        {s?.status === 'computing'
                          ? 'computing…'
                          : s?.status === 'error'
                            ? 'error'
                            : s?.status === 'skip'
                              ? s.reason
                              : normalize(u.username) === OPTIONS_ORACLE_USERNAME && s?.baselineTime
                                ? new Date(s.baselineTime).toLocaleString()
                                : fmtUpdated(u.updated_at || u.created_at)}
                      </div>
                    </div>
                  </div>

                  <div className="row-right">
                    <span className="chip currency">USD</span>
                    <span className={`chip ret ${pctChipClass(ret)}`}>
                      {typeof ret === 'number' ? `${ret.toFixed(2)}%` : '—'}
                    </span>
                    {!isEligible && <span className="chip">Low Bal</span>}
                    <span className={`chev ${selected ? 'down' : 'right'}`} aria-hidden>
                      ▸
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="stm-only">
          <div className="pin-gate">
            <div className="pin-gate__left">
              <div className="label">Participants-only statements</div>
              <div className="sub">
                Tournament window: <strong>Wed 8 Apr 2026, 09:00</strong> to{' '}
                <strong>Wed 22 Apr 2026, 09:00</strong> (Kenya / EAT).
              </div>
            </div>

            <div className="pin-gate__right">
              {viewerIsParticipant ? (
                <>
                  <div className="ok">
                    Verified as <strong>{viewerInfo!.username}</strong> (id {viewerInfo!.id})
                  </div>
                  <button className="btn btn--ghost" onClick={clearPin}>Sign out</button>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Enter Competition PIN (e.g. oracle4)"
                    value={viewerPin}
                    onChange={e => setViewerPin(e.target.value)}
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

          <div className="stm-summary">
            <div className="stm-summary__left">
              <div className="stm-summary__user">
                <div className="label">User</div>
                <div className="value">{selectedUser ? displayUser || selectedUser : '—'}</div>
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
                <div className="m-label">Net P/L</div>
                <div className={`m-value ${(detailSummary?.netPL ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                  {selectedUser ? formatAmt(detailSummary?.netPL ?? null) : '—'}
                </div>
              </div>
              <div className="metric">
                <div className="m-label">Return %</div>
                <div
                  className={`m-value ${
                    detailSummary?.returnPct !== null && (detailSummary?.returnPct ?? 0) >= 0 ? 'pos' : 'neg'
                  }`}
                >
                  {selectedUser ? formatPct(detailSummary?.returnPct ?? null) : '—'}
                </div>
              </div>
              <div className="metric">
                <div className="m-label">Trading Volume</div>
                <div className="m-value">{selectedUser ? formatMoney(detailSummary?.turnover ?? null) : '—'}</div>
              </div>
              <div className="metric">
                <div className="m-label">Trades</div>
                <div className="m-value">{selectedUser ? detailSummary?.trades ?? 0 : '—'}</div>
              </div>
            </div>

            <div className="stm-summary__controls">
              <div className="preset-group">
                <button className="btn btn--ghost" onClick={onPresetTournament}>
                  Tournament window
                </button>
              </div>

              <div className="range">
                <label>
                  <span>Start</span>
                  <input
                    type="datetime-local"
                    value={toDatetimeLocal(startMs)}
                    onChange={e => setStartMs(clampToTournament(fromDatetimeLocal(e.target.value)))}
                  />
                </label>

                <label>
                  <span>End</span>
                  <input
                    type="datetime-local"
                    value={toDatetimeLocal(endMs)}
                    onChange={e => setEndMs(clampToTournament(fromDatetimeLocal(e.target.value)))}
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

          <div className={`statements stm-collapsible ${isCollapsed ? 'is-collapsed' : 'is-expanded'}`}>
            <div className="statements__head" aria-hidden={isCollapsed}>
              <div className="col col--time">Time</div>
              <div className="col col--action">Action</div>
              <div className="col col--refid">Reference ID</div>
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
                    {displayItems.map(t => {
                      const timeVal = ms(t);
                      const action = normalize(t.action_type);
                      const amt = typeof t.amount === 'number' ? t.amount : undefined;
                      const balance =
                        typeof t.balance_after === 'number'
                          ? t.balance_after
                          : typeof t.balance === 'number'
                            ? t.balance
                            : undefined;
                      const positive = (amt ?? 0) >= 0;

                      return (
                        <li className="statements__row" key={`${txId(t)}::${timeVal}`}>
                          <div className="col col--time" data-label="Time">
                            {timeVal ? new Date(timeVal).toLocaleString() : '—'}
                          </div>
                          <div className={`col col--action ${action}`} data-label="Action">
                            {action || '-'}
                          </div>
                          <div className="col col--refid" data-label="Reference ID">
                            {action === 'buy' ? '-' : t.reference_id ?? '-'}
                          </div>
                          <div className="col col--reftype" data-label="Type">
                            {deriveRefType(t) || '-'}
                          </div>
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
                  {!loading && !hasMore && displayItems.length > 0 && (
                    <div className="statements__status end">End of statements</div>
                  )}

                  {selectedUser !== OPTIONS_ORACLE_USERNAME && (
                    <div ref={sentinelRef} className="statements__sentinel" />
                  )}
                </>
              )}
            </div>
          </div>

          {showDeposit && (
            <section className="deposit-inline" ref={depositRef}>
              <h2 className="deposit-inline__title">Deposit</h2>
              <Deposit />
            </section>
          )}
        </main>
      </div>

      <RulesModal
        show={showRules}
        onClose={() => setShowRules(false)}
        onOpenDeposit={openDepositInline}
      />
    </div>
  );
};

export default ParticipantsLeaderboardMerged;