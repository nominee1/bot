import { useCallback,useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useApiBase } from '@/hooks/useApiBase';
import { useDerivVisualTickApi } from '@/hooks/useDerivVisualTickApi';
import { useStore } from '@/hooks/useStore';
import { playTradeResultSound } from '@/pages/aap2psafe/tradeSounds';
import type ClientStore from '@/stores/client-store';
import { generateChanceDbReferenceId, scheduleCrChanceLedgerRoundTrip } from '@/utils/chanceVirtualStatements';
import {
  botIframeFormatQuoteForDigitContract,
  botIframeLastDigitFromQuote,
} from './botIframeTickDigitFormat';
import {
  buildDerivSessionProposalPayload,
  coerceProposalOpenContractEntrySpot,
  coerceProposalOpenContractEntryTimeSec,
  sendDerivSessionContractPurchase,
} from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import { isCrVirtualShadowLogin } from '@/utils/crVirtualBalanceShadow';
import {
  forgetDerivSubscription,
  isAlreadySubscribedTickError,
  recoverDerivLiveTickStream,
} from '@/utils/derivTickStream';
import type { Balance } from '@deriv/api-types';
import {
  MarketDerivedVolatility10Icon,
  MarketDerivedVolatility25Icon,
  MarketDerivedVolatility50Icon,
  MarketDerivedVolatility75Icon,
  MarketDerivedVolatility100Icon,
  MarketDerivedVolatility101sIcon,
  MarketDerivedVolatility151sIcon,
  MarketDerivedVolatility251sIcon,
  MarketDerivedVolatility301sIcon,
  MarketDerivedVolatility501sIcon,
  MarketDerivedVolatility751sIcon,
  MarketDerivedVolatility901sIcon,
  MarketDerivedVolatility1001sIcon,
  TradeTypesDigitsDiffersIcon,
  TradeTypesDigitsEvenIcon,
  TradeTypesDigitsMatchesIcon,
  TradeTypesDigitsOddIcon,
  TradeTypesDigitsOverIcon,
  TradeTypesDigitsUnderIcon,
  TradeTypesUpsAndDownsFallIcon,
  TradeTypesUpsAndDownsRiseIcon,
} from '@deriv/quill-icons';
import './BotIframe.scss';

/** Vol 10 (1s) — default market (parity with Flipaa & Auto Bot). */
const BOT_IFRAME_DEFAULT_MARKET = '1HZ10V';

/** Analysis chamber history depth (Deriv `ticks_history` — newest ticks, oldest→newest in `history.prices`). */
const ANALYSIS_HISTORY_TICK_COUNT = 1000;
const BOT_TICK_STALL_RECOVER_MS = 25_000;
const BOT_TICK_WATCH_INTERVAL_MS = 5_000;

/** Vol 10 (1s) tick-stream debug — filter DevTools console by `BotIframe 1HZ10V`. */
const BOT_IFRAME_DEBUG_10_1S = '1HZ10V';

function logBotIframe10_1s(label: string, detail?: Record<string, unknown>) {
  if (detail !== undefined) {
    console.log(`[BotIframe 1HZ10V] ${label}`, detail);
  } else {
    console.log(`[BotIframe 1HZ10V] ${label}`);
  }
}

function logBotIframe10_1sIf(symbol: string, label: string, detail?: Record<string, unknown>) {
  if (symbol !== BOT_IFRAME_DEBUG_10_1S) return;
  logBotIframe10_1s(label, detail);
}

/* ───── Virtual balance bus (same pipeline as marketing BotIframe) ───── */
type VirtualTick = { epoch: number; quote: number };

type VBus = {
  get(loginid?: string): number;
  add(loginid: string | undefined, delta: number): void;
  set(loginid: string | undefined, value: number): void;
  subscribe(fn: () => void): () => void;
};

declare global {
  interface Window {
    __VIRT_BAL__?: { map: Record<string, number>; subs: Set<() => void> };
  }
}

function getBus(): VBus {
  if (!window.__VIRT_BAL__) window.__VIRT_BAL__ = { map: {}, subs: new Set() };
  const bag = window.__VIRT_BAL__;
  const notify = () => bag.subs.forEach(fn => fn());

  return {
    get(loginid) {
      return loginid ? Number(bag.map[loginid] ?? 0) : 0;
    },
    add(loginid, delta) {
      if (loginid && delta) {
        bag.map[loginid] = (bag.map[loginid] ?? 0) + Number(delta);
        notify();
      }
    },
    set(loginid, value) {
      if (loginid) {
        bag.map[loginid] = Number(value ?? 0);
        notify();
      }
    },
    subscribe(fn) {
      bag.subs.add(fn);
      return () => bag.subs.delete(fn);
    },
  };
}

const VBAL_KEY = 'virtual_balance_map';
type VBalMsg = { type: 'vbal'; loginid: string; value: number };

let vbalChannel: BroadcastChannel | null = null;
try {
  vbalChannel = new BroadcastChannel('denara_virtual_balance');
} catch {
  /* Safari Private / old browsers */
}

function readVbalMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(VBAL_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeVbal(loginid: string, value: number) {
  const map = readVbalMap();
  map[loginid] = value;
  localStorage.setItem(VBAL_KEY, JSON.stringify(map));
  try {
    vbalChannel?.postMessage({ type: 'vbal', loginid, value } as VBalMsg);
  } catch {
    /* ignore */
  }
}

function getPersisted(loginid?: string): number | undefined {
  if (!loginid) return undefined;
  const map = readVbalMap();
  return typeof map[loginid] === 'number' ? map[loginid] : undefined;
}

/** Real-money / non-VRT wallets: local shadow only (Deriv server balance unchanged). */
const VBAL_SHADOW_KEY = 'virtual_cr_shadow_map';
type CrShadowMsg = { type: 'cr_shadow'; loginid: string; value: number };

let crShadowChannel: BroadcastChannel | null = null;
try {
  crShadowChannel = new BroadcastChannel('denara_cr_virtual_shadow');
} catch {
  /* ignore */
}

function readCrShadowMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(VBAL_SHADOW_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeCrShadow(loginid: string, value: number) {
  const map = readCrShadowMap();
  map[loginid] = value;
  localStorage.setItem(VBAL_SHADOW_KEY, JSON.stringify(map));
  try {
    crShadowChannel?.postMessage({ type: 'cr_shadow', loginid, value } as CrShadowMsg);
  } catch {
    /* ignore */
  }
}

function getCrShadow(loginid?: string): number | undefined {
  if (!loginid) return undefined;
  const map = readCrShadowMap();
  return typeof map[loginid] === 'number' ? map[loginid] : undefined;
}

function clearCrShadowLoginid(loginid: string) {
  const map = readCrShadowMap();
  delete map[loginid];
  localStorage.setItem(VBAL_SHADOW_KEY, JSON.stringify(map));
}

function readDisplayedRealBalance(client: ClientStore, loginid: string): number {
  const fromAccounts = client.all_accounts_balance?.accounts?.[loginid]?.balance;
  if (typeof fromAccounts === 'number' && Number.isFinite(fromAccounts)) return fromAccounts;
  const b = parseFloat(String(client.balance ?? '0'));
  return Number.isFinite(b) ? b : 0;
}

function patchOneAccountBalance(client: ClientStore, loginKey: string, amount: number, currency: string) {
  const existingRoot = client.all_accounts_balance;
  const existingAccounts = existingRoot?.accounts ? { ...existingRoot.accounts } : {};
  const prevEntry = existingAccounts[loginKey] ?? { loginid: loginKey, currency };
  const cur = currency || (prevEntry as { currency?: string }).currency || 'USD';
  existingAccounts[loginKey] = {
    ...prevEntry,
    balance: amount,
    currency: cur,
  };
  client.setAllAccountsBalance({
    ...(existingRoot ?? {}),
    accounts: existingAccounts,
  } as Balance);
}

/** Wallet that uses shadow balance + virtual fills in this iframe (others use real Deriv `buy`). */
const ALLOWED_BOT_IFRAME_LOGINID = 'CR7557018';

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

const parseRetryAfterMs = (message: string): number | null => {
  if (!message) return null;
  let m = message.match(/retry(?:ing)?\s+in\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s)\b/i);
  if (m) return Math.round(Number(m[1]) * 1000);
  m = message.match(/retry\s+after\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s)\b/i);
  if (m) return Math.round(Number(m[1]) * 1000);
  return null;
};

const isRateLimitError = (e: unknown) => {
  const errObj = (e as { error?: { code?: string; message?: string } })?.error ?? e;
  const code = (errObj as { code?: string })?.code?.toString() ?? '';
  const msg = (errObj as { message?: string })?.message?.toString() ?? '';
  return code === 'RateLimit' || /rate\s*limit|too\s*many\s*requests|throttl/i.test(msg);
};

const CADENCE_WAIT_MS = 25;
const MATCH_WAIT_MS_SINGLE = 900;
const MATCH_WAIT_MS_BULK = 4000;
const FALLBACK_PAYOUT_RATIO = 1.95;

type ProposalQuote = { ask: number; payout: number };

type TradeStatus = 'pending' | 'open' | 'active' | 'won' | 'lost' | 'completed' | 'error';

interface TTrade {
  id: string;
  buyReferenceId?: string;
  sellReferenceId?: string;
  contractType: string;
  stake: number;
  market: string;
  duration: number;
  status: TradeStatus;
  timestamp: Date;
  startTime?: Date;
  closeTime?: Date;
  profit?: number;
  entryValue?: number;
  exitValue?: number;
  currentValue?: number;
  ticksRemaining?: number;
  barrier?: number;
  isBulkTrade?: boolean;
  bulkTradeId?: string;
  counted?: boolean;
  marketFormat?: string;
  temp?: boolean;
  errorReason?: string;
  errorDetails?: string;
}

type TTransaction = {
  contract_id: string;
  amount: number;
  transaction_time: number;
};

const marketIcons: Record<string, JSX.Element> = {
  '1HZ100V': <MarketDerivedVolatility1001sIcon width={16} height={16} />,
  R_100: <MarketDerivedVolatility100Icon width={16} height={16} />,
  R_10: <MarketDerivedVolatility10Icon width={16} height={16} />,
  R_25: <MarketDerivedVolatility25Icon width={16} height={16} />,
  R_50: <MarketDerivedVolatility50Icon width={16} height={16} />,
  R_75: <MarketDerivedVolatility75Icon width={16} height={16} />,
  '1HZ10V': <MarketDerivedVolatility101sIcon width={16} height={16} />,
  '1HZ25V': <MarketDerivedVolatility251sIcon width={16} height={16} />,
  '1HZ50V': <MarketDerivedVolatility501sIcon width={16} height={16} />,
  '1HZ15V': <MarketDerivedVolatility151sIcon width={16} height={16} />,
  '1HZ30V': <MarketDerivedVolatility301sIcon width={16} height={16} />,
  '1HZ90V': <MarketDerivedVolatility901sIcon width={16} height={16} />,
  '1HZ75V': <MarketDerivedVolatility751sIcon width={16} height={16} />,
};

const contractIcons: Record<string, JSX.Element> = {
  DIGITEVEN: <TradeTypesDigitsEvenIcon width={16} height={16} />,
  DIGITODD: <TradeTypesDigitsOddIcon width={16} height={16} />,
  DIGITMATCH: <TradeTypesDigitsMatchesIcon width={16} height={16} />,
  DIGITDIFF: <TradeTypesDigitsDiffersIcon width={16} height={16} />,
  DIGITOVER: <TradeTypesDigitsOverIcon width={16} height={16} />,
  DIGITUNDER: <TradeTypesDigitsUnderIcon width={16} height={16} />,

  // existing Rise/Fall (kept as-is)
  CALL: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
  PUT: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />,

  // ✅ NEW: Rise Equals / Fall Equals
  PUTE: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
  CALLE: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />,

  // ✅ NEW: Only Ups / Only Downs
  RUNHIGH: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
  RUNLOW: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />,
};

// ✅ Pending action types (single / both / bulk)
type PendingAuto =
  | null
  | { mode: 'single'; ct: string }
  | { mode: 'both'; left: string; right: string }
  | { mode: 'bulk'; ct: string };

const BotIframe = observer(() => {
  const { ui, client } = useStore();
  const { activeLoginid, tradingSocketGeneration, connectionStatus } = useApiBase();
  const { visualTickApi, visualTickReady, visualTickApiRef } = useDerivVisualTickApi();
  const bus = getBus();

  const [trades, setTrades] = useState<TTrade[]>([]);
  const [profitLoss, setPL] = useState(0);
  const [bulk, setBulk] = useState({ on: false, done: 0, fail: 0, tot: 0 });

  const [turbo, setTurbo] = useState(false);

  // ✅ TURBO live ref (must update immediately on click, not only via effect)
  const turboRef = useRef(false);
  const setTurboMode = (v: boolean) => {
    turboRef.current = v;
    setTurbo(v);
  };
  useEffect(() => {
    turboRef.current = turbo;
  }, [turbo]);

  // ✅ Selected digit highlight (user focus)
  const [selectedDigit, setSelectedDigit] = useState<number | null>(null);

  const [strategy, setStrat] = useState('even');
  const prevStrategyRef = useRef(strategy);
  const [ctypes, setCT] = useState<{ left: string; right: string }>({ left: 'DIGITEVEN', right: 'DIGITODD' });
  const [currentSymbol, setCurrentSymbol] = useState(BOT_IFRAME_DEFAULT_MARKET);
  const [bothMode, setBothMode] = useState<boolean>(false);

  /** Seeds CR shadow balance once when the allowed account is selected; clears when switching away. */
  const virtualAccountSeededRef = useRef<string | null>(null);

  /** Serializes CR shadow debits/credits so turbo concurrent buys cannot overdraw. */
  const crBalanceMutexRef = useRef(Promise.resolve());
  const runWithCrBalanceLock = useCallback(<T,>(fn: () => T): Promise<T> => {
    const prev = crBalanceMutexRef.current;
    let release!: () => void;
    const tail = new Promise<void>(r => {
      release = r;
    });
    crBalanceMutexRef.current = tail;
    return prev.then(() => {
      try {
        return fn();
      } finally {
        release();
      }
    });
  }, []);

  const rateLimitRef = useRef<{ until: number; attempt: number; lastMsg: string }>({
    until: 0,
    attempt: 0,
    lastMsg: '',
  });

  const ensureApiReady = useCallback(async () => {
    const OPEN = 1 as const;
    if (!api_base.api || api_base.api.connection.readyState !== OPEN) {
      await api_base.init(true);
    }
    const liveApi = api_base.api;
    if (!liveApi || liveApi.connection.readyState !== OPEN) {
      throw new Error('Trading connection is still initializing. Please try again.');
    }
    return liveApi;
  }, []);

  const waitForRateLimitBackoff = useCallback(async () => {
    const now = Date.now();
    if (now < rateLimitRef.current.until) {
      await sleep(rateLimitRef.current.until - now);
    }
  }, []);

  const clearRateLimitBackoff = useCallback(() => {
    rateLimitRef.current.attempt = 0;
    rateLimitRef.current.until = 0;
    rateLimitRef.current.lastMsg = '';
  }, []);

  const applyRateLimitBackoff = useCallback(async (err: unknown) => {
    const errObj = (err as { error?: { message?: string } })?.error ?? err;
    const msgText = ((errObj as { message?: string })?.message ?? 'Rate limit').toString();
    const hinted = parseRetryAfterMs(msgText);
    const attempt = Math.min(10, (rateLimitRef.current.attempt ?? 0) + 1);
    const base = 900;
    const cap = 25000;
    const exp = Math.min(cap, base * Math.pow(2, attempt - 1));
    const waitMs = Math.max(700, hinted ?? exp);
    const jitter = Math.floor(Math.random() * 250);

    rateLimitRef.current.attempt = attempt;
    rateLimitRef.current.lastMsg = msgText;
    rateLimitRef.current.until = Date.now() + waitMs + jitter;

    await sleep(waitMs + jitter);
  }, []);

  const getBalanceError = useCallback((e: unknown) => {
    const errorObj = (e as { error?: { message?: string; code?: string } })?.error ?? e;
    const message = ((errorObj as { message?: string })?.message || 'Unknown error').toString();
    const code = (errorObj as { code?: string })?.code || '';
    const isBalanceError =
      code === 'InsufficientBalance' ||
      /insufficient|balance|fund|not enough|no enough|low balance/i.test(message);
    return { isBalanceError, message };
  }, []);

  // ✅ Entry switch stays as-is, but Entry Point is now MANUAL (normal entry point)
  const [autoOn, setAutoOn] = useState(false);
  const [autoEntryDigit, setAutoEntryDigit] = useState<string>('2');

  // ✅ Prediction (controlled)
  const [predictionDigit, setPredictionDigit] = useState<string>('1');
  const predictionRef = useRef<number>(1);
  useEffect(() => {
    const s = predictionDigit.trim();
    if (s === '') {
      predictionRef.current = Number.NaN;
      return;
    }
    const n = Number(s);
    predictionRef.current = Number.isFinite(n) ? Math.min(9, Math.max(0, Math.trunc(n))) : Number.NaN;
  }, [predictionDigit]);

  // keep live refs so WS/timeout always sees latest values
  const autoOnRef = useRef(false);
  const autoEntryRef = useRef<number>(2);
  const pendingAutoRef = useRef<PendingAuto>(null);
  const autoBusyRef = useRef(false);
  const isLiveTickRef = useRef(false);
  /** Gate live tick stats until bulk history is applied (avoids per-digit 0% until each becomes latest). */
  const historyReadyRef = useRef(false);
  const subscribedTickSymbolRef = useRef<string | null>(null);
  /** Bumped on each market / socket change so stale async subscribe + WS messages are ignored. */
  const tickStreamOpRef = useRef(0);
  const tickSubscriptionIdRef = useRef<string | null>(null);
  const tickSubscribeInFlightRef = useRef(false);

  useEffect(() => {
    autoOnRef.current = autoOn;
  }, [autoOn]);

  // keep autoEntryRef always synced (allow blank => disables trigger)
  useEffect(() => {
    const s = autoEntryDigit.trim();
    if (s === '') {
      autoEntryRef.current = Number.NaN;
      return;
    }
    const n = Number(s);
    autoEntryRef.current = Number.isFinite(n) ? Math.min(9, Math.max(0, Math.trunc(n))) : Number.NaN;
  }, [autoEntryDigit]);

  const [activeMode, setActiveMode] = useState<'evenOdd' | 'overUnder' | 'riseFall'>('evenOdd');
  /** True once last-1000-tick bulk history is applied for `digitStatsMarket`. */
  const [digitStatsReady, setDigitStatsReady] = useState(false);
  const [digitStatsMarket, setDigitStatsMarket] = useState<string | null>(null);

  const [analysisData, setAnalysisData] = useState({
    evenCount: 0,
    oddCount: 0,
    riseCount: 0,
    fallCount: 0,
    totalCount: 0,
    lastResults: [] as Array<{
      digit: number;
      isEven: boolean;
      isRise: boolean | null;
      price: number;
      timestamp: Date;
    }>,
    lastDigit: null as number | null,
    lastPrice: null as number | null,
    digitCounts: Array(10).fill(0) as number[],
    overDigit: 1,
    underDigit: 1,
    tickRange: 300,
    currentMarket: BOT_IFRAME_DEFAULT_MARKET,
  });

  // ✅ Purchased RESULT digit blink state (digits SVG container)
  const [purchasedTickDigit, setPurchasedTickDigit] = useState<number | null>(null);
  const purchasedBlinkTimerRef = useRef<number | null>(null);
  const lastBlinkKeyRef = useRef<string>('');

  const marketSelectionRef = useRef<HTMLSelectElement>(null);
  const marketRef = useRef<HTMLSelectElement>(null);
  const strategyRef = useRef<HTMLSelectElement>(null);
  const stakeRef = useRef<HTMLInputElement>(null);
  const durRef = useRef<HTMLInputElement>(null);
  const digitRef = useRef<HTMLInputElement>(null);
  const bulkCntRef = useRef<HTMLInputElement>(null);

  const tickBufferRef = useRef<VirtualTick[]>([]);
  const lastEpochRef = useRef<number | null>(null);
  const singleMatchTokenRef = useRef(0);
  const cancelSingleMatchWaits = useCallback(() => {
    singleMatchTokenRef.current += 1;
  }, []);

  const pushTick = (t: VirtualTick) => {
    const buf = tickBufferRef.current;
    buf.push(t);
    if (buf.length > 600) buf.splice(0, buf.length - 600);
  };

  const bulkQ = useRef<{
    active: boolean;
    processing: boolean;
    queue: {
      id: string;
      contractType: string;
      stake: number;
      market: string;
      duration: number;
      status: 'pending' | 'processing' | 'executed' | 'failed';
      attempts: number;
      maxAttempts: number;
    }[];
    completed: number;
    failed: number;
    total: number;
  } | null>(null);

  const prevTickRef = useRef<number | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();

  const playSound = (ok: boolean) => playTradeResultSound(ok);

  const blinkPurchasedTickDigit = useCallback((key: string, digit: number) => {
    if (!Number.isFinite(digit)) return;
    if (lastBlinkKeyRef.current === key) return;
    lastBlinkKeyRef.current = key;

    if (purchasedBlinkTimerRef.current) {
      window.clearTimeout(purchasedBlinkTimerRef.current);
      purchasedBlinkTimerRef.current = null;
    }

    setPurchasedTickDigit(digit);

    purchasedBlinkTimerRef.current = window.setTimeout(() => {
      setPurchasedTickDigit(null);
    }, 900);
  }, []);

  useEffect(() => {
    if (!client || !activeLoginid?.startsWith('VRT')) return;

    const persisted = getPersisted(activeLoginid);
    const storeBal = client.all_accounts_balance?.accounts?.[activeLoginid]?.balance;
    const currency = client.currency || client?.all_accounts_balance?.accounts?.[activeLoginid]?.currency || 'USD';
    const dec = ({ USD: 2, EUR: 2, GBP: 2, BTC: 8, ETH: 8, USDT: 6 } as Record<string, number>)[currency] ?? 2;

    if (typeof persisted === 'number' && persisted !== storeBal) {
      try {
        client.setBalance(persisted.toFixed(dec));
        client.setCurrency(currency);
        const prev = client.all_accounts_balance;
        if (prev?.accounts) {
          client.setAllAccountsBalance({
            ...prev,
            accounts: {
              ...prev.accounts,
              [activeLoginid]: {
                ...prev.accounts[activeLoginid],
                balance: persisted,
                currency,
              },
            },
          });
        }
      } catch {
        /* ignore */
      }
    }

    const onChan = (ev: MessageEvent<VBalMsg>) => {
      const msg = ev?.data;
      if (!msg || msg.type !== 'vbal') return;
      if (msg.loginid !== activeLoginid) return;
      const val = Number(msg.value);
      if (!Number.isFinite(val)) return;

      try {
        client.setBalance(val.toFixed(dec));
        const prev = client.all_accounts_balance;
        if (prev?.accounts) {
          client.setAllAccountsBalance({
            ...prev,
            accounts: {
              ...prev.accounts,
              [activeLoginid]: { ...prev.accounts[activeLoginid], balance: val, currency },
            },
          });
        }
      } catch {
        /* ignore */
      }
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key !== VBAL_KEY) return;
      const map = readVbalMap();
      const val = map[activeLoginid];
      if (typeof val !== 'number') return;

      try {
        client.setBalance(val.toFixed(dec));
        const prev = client.all_accounts_balance;
        if (prev?.accounts) {
          client.setAllAccountsBalance({
            ...prev,
            accounts: {
              ...prev.accounts,
              [activeLoginid]: { ...prev.accounts[activeLoginid], balance: val, currency },
            },
          });
        }
      } catch {
        /* ignore */
      }
    };

    vbalChannel?.addEventListener?.('message', onChan as any);
    window.addEventListener('storage', onStorage);
    return () => {
      vbalChannel?.removeEventListener?.('message', onChan as any);
      window.removeEventListener('storage', onStorage);
    };
  }, [activeLoginid, client]);

  useEffect(() => {
    if (!client || activeLoginid !== ALLOWED_BOT_IFRAME_LOGINID) return;

    const onCrChan = (ev: MessageEvent<CrShadowMsg>) => {
      const msg = ev?.data;
      if (!msg || msg.type !== 'cr_shadow') return;
      if (msg.loginid !== activeLoginid) return;
      const val = Number(msg.value);
      if (!Number.isFinite(val)) return;
      const currency = client.currency || client.all_accounts_balance?.accounts?.[activeLoginid]?.currency || 'USD';
      const dec = ({ USD: 2, EUR: 2, GBP: 2, BTC: 8, ETH: 8, USDT: 6 } as Record<string, number>)[currency] ?? 2;
      try {
        patchOneAccountBalance(client, activeLoginid, val, currency);
        client.setBalance(val.toFixed(dec));
        client.setCurrency(currency);
      } catch {
        /* ignore */
      }
    };

    const onCrStorage = (e: StorageEvent) => {
      if (e.key !== VBAL_SHADOW_KEY) return;
      const map = readCrShadowMap();
      const val = map[activeLoginid];
      if (typeof val !== 'number') return;
      const currency = client.currency || client.all_accounts_balance?.accounts?.[activeLoginid]?.currency || 'USD';
      const dec = ({ USD: 2, EUR: 2, GBP: 2, BTC: 8, ETH: 8, USDT: 6 } as Record<string, number>)[currency] ?? 2;
      try {
        patchOneAccountBalance(client, activeLoginid, val, currency);
        client.setBalance(val.toFixed(dec));
        client.setCurrency(currency);
      } catch {
        /* ignore */
      }
    };

    crShadowChannel?.addEventListener?.('message', onCrChan as any);
    window.addEventListener('storage', onCrStorage);
    return () => {
      crShadowChannel?.removeEventListener?.('message', onCrChan as any);
      window.removeEventListener('storage', onCrStorage);
    };
  }, [activeLoginid, client]);

  const restoreDerivBalanceFromApi = useCallback(async () => {
    if (!client || !activeLoginid || activeLoginid.startsWith('VRT')) return;
    try {
      const liveApi = await ensureApiReady();
      const res = await liveApi.send({ balance: 1 });
      const payload = res?.balance as { balance?: number; currency?: string } | undefined;
      if (!payload || typeof payload.balance !== 'number' || !Number.isFinite(payload.balance)) return;
      const currency =
        payload.currency ||
        client.currency ||
        client.all_accounts_balance?.accounts?.[activeLoginid]?.currency ||
        'USD';
      const dec = ({ USD: 2, EUR: 2, GBP: 2, BTC: 8, ETH: 8, USDT: 6 } as Record<string, number>)[currency] ?? 2;
      patchOneAccountBalance(client, activeLoginid, payload.balance, currency);
      client.setBalance(payload.balance.toFixed(dec));
      client.setCurrency(currency);
    } catch (err) {
      console.error('restoreDerivBalanceFromApi', err);
    }
  }, [activeLoginid, client, ensureApiReady]);

  useEffect(() => {
    if (!client || !activeLoginid) {
      virtualAccountSeededRef.current = null;
      return;
    }

    if (activeLoginid !== ALLOWED_BOT_IFRAME_LOGINID) {
      if (virtualAccountSeededRef.current === ALLOWED_BOT_IFRAME_LOGINID) {
        clearCrShadowLoginid(ALLOWED_BOT_IFRAME_LOGINID);
        void restoreDerivBalanceFromApi();
      }
      virtualAccountSeededRef.current = null;
      return;
    }

    if (virtualAccountSeededRef.current === activeLoginid) return;

    virtualAccountSeededRef.current = activeLoginid;
    const real = readDisplayedRealBalance(client, activeLoginid);
    const persistedShadow = getCrShadow(activeLoginid);
    const seedBal =
      typeof persistedShadow === 'number' && Number.isFinite(persistedShadow) ? persistedShadow : real;
    const currency = client.currency || client.all_accounts_balance?.accounts?.[activeLoginid]?.currency || 'USD';
    const dec = ({ USD: 2, EUR: 2, GBP: 2, BTC: 8, ETH: 8, USDT: 6 } as Record<string, number>)[currency] ?? 2;
    writeCrShadow(activeLoginid, seedBal);
    patchOneAccountBalance(client, activeLoginid, seedBal, currency);
    client.setBalance(seedBal.toFixed(dec));
    client.setCurrency(currency);
    bus.set(activeLoginid, seedBal);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed only on login/client mount; avoid re-running when restore callback identity changes
  }, [activeLoginid, client]);

  const applyPnLToVirtualDemo = useCallback(
    (delta: number) => {
      if (
        !activeLoginid ||
        activeLoginid !== ALLOWED_BOT_IFRAME_LOGINID ||
        !activeLoginid.startsWith('VRT') ||
        !client
      )
        return;

      const persisted = getPersisted(activeLoginid);
      const storeBal = client.all_accounts_balance?.accounts?.[activeLoginid]?.balance;
      const seed = typeof persisted === 'number' ? persisted : typeof storeBal === 'number' ? storeBal : 0;

      const currency = client.currency || client?.all_accounts_balance?.accounts?.[activeLoginid]?.currency || 'USD';
      const dec = ({ USD: 2, EUR: 2, GBP: 2, BTC: 8, ETH: 8, USDT: 6 } as Record<string, number>)[currency] ?? 2;
      const next = Number((seed + delta).toFixed(dec));

      writeVbal(activeLoginid, next);

      try {
        client.setBalance(next.toFixed(dec));
        client.setCurrency(currency);
        const prev = client.all_accounts_balance;
        if (prev?.accounts) {
          client.setAllAccountsBalance({
            ...prev,
            accounts: {
              ...prev.accounts,
              [activeLoginid]: { ...prev.accounts[activeLoginid], balance: next, currency },
            },
          });
        }
      } catch {
        /* ignore */
      }
    },
    [activeLoginid, client]
  );

  /** Sync debit against CR shadow; returns false without mutating balance if funds insufficient. */
  const tryDebitCrShadowSync = useCallback(
    (loginKey: string, ask: number): boolean => {
      if (!client || loginKey !== ALLOWED_BOT_IFRAME_LOGINID || loginKey.startsWith('VRT')) return false;
      const currency = client.currency || client.all_accounts_balance?.accounts?.[loginKey]?.currency || 'USD';
      const dec = ({ USD: 2, EUR: 2, GBP: 2, BTC: 8, ETH: 8, USDT: 6 } as Record<string, number>)[currency] ?? 2;
      let cur = getCrShadow(loginKey);
      if (typeof cur !== 'number' || !Number.isFinite(cur)) cur = readDisplayedRealBalance(client, loginKey);
      if (!Number.isFinite(ask) || ask < 0) return false;
      if (cur + 1e-9 < ask) return false;
      const next = Number((Math.max(0, cur - ask)).toFixed(dec));
      writeCrShadow(loginKey, next);
      try {
        client.setBalance(next.toFixed(dec));
        client.setCurrency(currency);
        patchOneAccountBalance(client, loginKey, next, currency);
        bus.add(loginKey, -ask);
      } catch {
        /* ignore */
      }
      return true;
    },
    [client, bus]
  );

  const computeLastDigit = useCallback((price: number, mkt: string) => botIframeLastDigitFromQuote(price, mkt), []);

  const tickWinsFor = useCallback(
    (ct: string, barrier: number | undefined, prev: VirtualTick, curr: VirtualTick, mktFmt: string) => {
      switch (ct) {
        case 'DIGITEVEN':
          return computeLastDigit(curr.quote, mktFmt) % 2 === 0;
        case 'DIGITODD':
          return computeLastDigit(curr.quote, mktFmt) % 2 !== 0;
        case 'DIGITOVER':
          return typeof barrier === 'number' ? computeLastDigit(curr.quote, mktFmt) > barrier : false;
        case 'DIGITUNDER':
          return typeof barrier === 'number' ? computeLastDigit(curr.quote, mktFmt) < barrier : false;
        case 'DIGITMATCH':
          return typeof barrier === 'number' ? computeLastDigit(curr.quote, mktFmt) === barrier : false;
        case 'DIGITDIFF':
          return typeof barrier === 'number' ? computeLastDigit(curr.quote, mktFmt) !== barrier : false;
        case 'CALL':
          return curr.quote > prev.quote;
        case 'PUT':
          return curr.quote < prev.quote;
        default:
          return false;
      }
    },
    [computeLastDigit]
  );

  const tryPickVirtualWindow = useCallback(
    (
      ct: string,
      barrier: number | undefined,
      mktFmt: string,
      dur: number,
      buf: VirtualTick[]
    ): { ok: true; entry: VirtualTick; exit: VirtualTick } | null => {
      if (buf.length < 2) return null;

      if (ct === 'RUNHIGH') {
        const need = dur + 1;
        if (buf.length < need) return null;
        const slice = buf.slice(-need);
        for (let i = 0; i < dur; i++) {
          if (!(slice[i + 1].quote > slice[i].quote)) return null;
        }
        return { ok: true, entry: slice[0], exit: slice[dur] };
      }
      if (ct === 'RUNLOW') {
        const need = dur + 1;
        if (buf.length < need) return null;
        const slice = buf.slice(-need);
        for (let i = 0; i < dur; i++) {
          if (!(slice[i + 1].quote < slice[i].quote)) return null;
        }
        return { ok: true, entry: slice[0], exit: slice[dur] };
      }
      if (ct === 'CALL' && dur > 1) {
        const need = dur + 1;
        if (buf.length < need) return null;
        const slice = buf.slice(-need);
        for (let i = 0; i < dur; i++) {
          if (!(slice[i + 1].quote > slice[i].quote)) return null;
        }
        return { ok: true, entry: slice[0], exit: slice[dur] };
      }
      if (ct === 'PUT' && dur > 1) {
        const need = dur + 1;
        if (buf.length < need) return null;
        const slice = buf.slice(-need);
        for (let i = 0; i < dur; i++) {
          if (!(slice[i + 1].quote < slice[i].quote)) return null;
        }
        return { ok: true, entry: slice[0], exit: slice[dur] };
      }
      if (ct === 'PUTE' || ct === 'CALLE') {
        const prev = buf[buf.length - 2];
        const curr = buf[buf.length - 1];
        if (prev.quote !== curr.quote) return null;
        return { ok: true, entry: prev, exit: curr };
      }

      const prev = buf[buf.length - 2];
      const curr = buf[buf.length - 1];
      if (!tickWinsFor(ct, barrier, prev, curr, mktFmt)) return null;
      return { ok: true, entry: prev, exit: curr };
    },
    [tickWinsFor]
  );

  const waitForFavorableWindow = useCallback(
    async (ct: string, barrier: number | undefined, mktFmt: string, dur: number, waitMs: number) => {
      const t0 = Date.now();
      while (Date.now() - t0 < waitMs) {
        const picked = tryPickVirtualWindow(ct, barrier, mktFmt, dur, tickBufferRef.current);
        if (picked?.ok) return { ok: true as const, entry: picked.entry, exit: picked.exit };
        await new Promise(r => setTimeout(r, CADENCE_WAIT_MS));
      }
      return { ok: false as const };
    },
    [tryPickVirtualWindow]
  );

  /** Entry-trigger / Strategy-style: use trigger tick + next tick (no favorable-window polling). */
  const waitForNextBufferTick = useCallback(async (afterEpoch: number, maxMs: number): Promise<VirtualTick | null> => {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const buf = tickBufferRef.current;
      const last = buf[buf.length - 1];
      if (last && last.epoch > afterEpoch) return last;
      await new Promise(r => setTimeout(r, CADENCE_WAIT_MS));
    }
    return null;
  }, []);

  const pickImmediateVirtualWindow = useCallback(
    async (
      ct: string,
      dur: number
    ): Promise<{ ok: true; entry: VirtualTick; exit: VirtualTick } | { ok: false }> => {
      let buf = tickBufferRef.current;
      if (!buf.length) return { ok: false };

      const minDur = ct === 'RUNHIGH' || ct === 'RUNLOW' ? 2 : 1;
      const effectiveDur = Math.max(dur, minDur);

      if (effectiveDur <= 1) {
        const entry = buf[buf.length - 1];
        const exit = await waitForNextBufferTick(entry.epoch, 3500);
        if (!exit) return { ok: false };
        return { ok: true, entry, exit };
      }

      const need = effectiveDur + 1;
      const t0 = Date.now();
      while (buf.length < need && Date.now() - t0 < 3500) {
        await new Promise(r => setTimeout(r, CADENCE_WAIT_MS));
        buf = tickBufferRef.current;
      }
      if (buf.length < need) return { ok: false };
      const slice = buf.slice(-need);
      return { ok: true, entry: slice[0], exit: slice[effectiveDur] };
    },
    [waitForNextBufferTick]
  );

  const getProposal = useCallback(async (ct: string, mkt: string, dur: number, stake: number, barrier?: number): Promise<ProposalQuote> => {
    try {
      const liveApi = await ensureApiReady();
      const resp = await liveApi.send(
        buildDerivSessionProposalPayload({
          contract_type: ct,
          market: mkt,
          duration: dur,
          stake,
          barrier,
        })
      );
      if (resp?.error) throw resp.error;
      const p = resp.proposal;
      const ask = Number(p.ask_price ?? stake);
      const payout = Number(p.payout ?? stake * FALLBACK_PAYOUT_RATIO);
      return { ask, payout };
    } catch {
      return { ask: stake, payout: stake * FALLBACK_PAYOUT_RATIO };
    }
  }, [ensureApiReady]);

  const isForcedLossContract = (ct: string) => ct === 'DIGITDIFF';

  const createVirtualTrade = (
    ct: string,
    stake: number,
    market: string,
    dur: number,
    barrier?: number,
    isBulk?: boolean,
    bulkId?: string
  ) => {
    const id = `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const buyReferenceId = generateChanceDbReferenceId();
    const sellReferenceId = generateChanceDbReferenceId();

    const t: TTrade = {
      id,
      buyReferenceId,
      sellReferenceId,
      contractType: ct,
      stake,
      market,
      duration: dur,
      status: 'open',
      timestamp: new Date(),
      barrier,
      isBulkTrade: isBulk,
      bulkTradeId: bulkId,
      marketFormat: market,
      temp: false,
    };

    setTrades(prev => [t, ...prev]);
    return { id, buyReferenceId, sellReferenceId };
  };

  const appendInsufficientTrade = (
    ct: string,
    stake: number,
    market: string,
    dur: number,
    barrier: number | undefined,
    isBulk?: boolean,
    bulkId?: string
  ) => {
    const id = `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const t: TTrade = {
      id,
      contractType: ct,
      stake,
      market,
      duration: dur,
      status: 'error',
      timestamp: new Date(),
      barrier,
      isBulkTrade: isBulk,
      bulkTradeId: bulkId,
      marketFormat: market,
      errorReason: 'Trade failed — insufficient balance',
      errorDetails: 'Not enough virtual balance for this stake.',
    };
    setTrades(prev => [t, ...prev]);
  };

  const patchTmpTradeError = (tmpId: string, reason: string, details?: string) => {
    setTrades(prev =>
      prev.map(tr =>
        tr.id === tmpId
          ? {
              ...tr,
              status: 'error',
              temp: false,
              errorReason: reason,
              errorDetails: details,
              closeTime: new Date(),
            }
          : tr
      )
    );
  };

  const createPendingTradeRow = (
    ct: string,
    stake: number,
    market: string,
    dur: number,
    barrier: number | undefined,
    isBulk?: boolean,
    bulkId?: string
  ) => {
    const id = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const t: TTrade = {
      id,
      contractType: ct,
      stake,
      market,
      duration: dur,
      status: 'pending',
      timestamp: new Date(),
      barrier,
      isBulkTrade: isBulk,
      bulkTradeId: bulkId,
      marketFormat: market,
      temp: true,
    };
    setTrades(prev => [t, ...prev]);
    return id;
  };

  /** Live Deriv contract purchase (non–CR7557018 shadow accounts). */
  const realDerivBuy = async (
    ct: string,
    isBulk = false,
    bulkId?: string,
    stakeOv?: number,
    marketOv?: string,
    durOv?: number,
    immediate = false
  ) => {
    if (!activeLoginid || !client) throw new Error('restricted');

    const stake = stakeOv ?? parseFloat(stakeRef.current?.value || '0');
    let dur = durOv ?? parseInt(durRef.current?.value || '1', 10);
    const market = marketOv ?? marketRef.current?.value ?? currentSymbol;

    const minDur = minTicksForContract(ct);
    if (!Number.isFinite(dur) || dur <= 0) dur = minDur;
    if (dur < minDur) {
      dur = minDur;
      if (!durOv && durRef.current) durRef.current.value = String(minDur);
    }

    let barrierNum: number | undefined;
    if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(ct)) {
      const d = digitRef.current ? parseInt(digitRef.current.value, 10) : NaN;
      if (isNaN(d)) {
        throw new Error('digit');
      }
      barrierNum = d;
    }

    const apiOpen = api_base.api?.connection.readyState === 1;
    if (!immediate || !apiOpen) {
      await ensureApiReady();
    }
    await waitForRateLimitBackoff();

    const tmpId = createPendingTradeRow(ct, stake, market, dur, barrierNum, isBulk, bulkId);

    const MAX_RL_RETRIES = 8;

    for (let attempt = 0; attempt <= MAX_RL_RETRIES; attempt++) {
      try {
        const resp = (await sendDerivSessionContractPurchase((d: Record<string, unknown>) => api_base.api!.send(d), {
          contract_type: ct,
          market,
          duration: dur,
          stake,
          ...(typeof barrierNum === 'number' ? { barrier: barrierNum } : {}),
        })) as Record<string, unknown> & { buy?: { contract_id?: unknown }; error?: unknown };

        if (resp?.error) throw resp;

        clearRateLimitBackoff();

        const contractIdRaw = resp.buy?.contract_id;
        if (contractIdRaw == null || contractIdRaw === '') {
          throw new Error('No contract_id in buy response');
        }
        const realID = String(contractIdRaw);

        setTrades(prev =>
          prev.map(tr =>
            tr.id === tmpId
              ? {
                  ...tr,
                  id: realID,
                  temp: false,
                  status: 'open',
                  marketFormat: market,
                }
              : tr
          )
        );

        try {
          await api_base.api!.send({
            proposal_open_contract: 1,
            contract_id: realID,
            subscribe: 1,
          });
        } catch {
          void 0;
        }

        return;
      } catch (e: unknown) {
        if (isRateLimitError(e) && attempt < MAX_RL_RETRIES) {
          await applyRateLimitBackoff(e);
          await waitForRateLimitBackoff();
          continue;
        }

        const { isBalanceError, message } = getBalanceError(e);
        patchTmpTradeError(tmpId, isBalanceError ? 'Insufficient balance' : 'Trade failed', message);
        throw e;
      }
    }

    patchTmpTradeError(tmpId, 'Rate limit', 'Too many rate limit retries');
    throw new Error('Rate limit retries exhausted');
  };

  const settleVirtualRow = (id: string, entryTick: VirtualTick, exitTick: VirtualTick, net: number) => {
    setTrades(prev =>
      prev.map(tr => {
        if (tr.id !== id) return tr;
        const isOneTick = Number(tr.duration || 1) === 1;
        const shownTick = exitTick;
        const entryShown = isOneTick ? shownTick : entryTick;
        const exitShown = shownTick;
        return {
          ...tr,
          entryValue: entryShown.quote,
          exitValue: exitShown.quote,
          startTime: new Date((isOneTick ? shownTick.epoch : entryTick.epoch) * 1000),
          closeTime: new Date(exitShown.epoch * 1000),
          status: net >= 0 ? 'won' : 'lost',
          profit: Number(net.toFixed(2)),
        };
      })
    );

    const mktFmt = marketRef.current?.value || currentSymbol;
    const exitDigit = computeLastDigit(exitTick.quote, mktFmt);
    blinkPurchasedTickDigit(`${id}:${exitDigit}`, exitDigit);

    playSound(net >= 0);
  };

  const needsDigit = (s: string) => ['matches', 'differs', 'over', 'under'].includes(s);

  // ✅ min ticks guard (Only Ups/Downs commonly min=2 ticks)
  const minTicksForContract = (ct: string) => {
    if (ct === 'RUNHIGH' || ct === 'RUNLOW') return 2;
    return 1;
  };

  const mapContracts = (s: string): [string, string] => {
    const pairs: Record<string, [string, string]> = {
      even: ['DIGITEVEN', 'DIGITODD'],
      odd: ['DIGITODD', 'DIGITEVEN'],
      matches: ['DIGITMATCH', 'DIGITDIFF'],
      differs: ['DIGITDIFF', 'DIGITMATCH'],
      over: ['DIGITOVER', 'DIGITUNDER'],
      under: ['DIGITUNDER', 'DIGITOVER'],
      rise: ['CALL', 'PUT'],
      fall: ['PUT', 'CALL'],
      onlyups: ['RUNHIGH', 'RUNLOW'],
      onlydowns: ['RUNLOW', 'RUNHIGH'],
      rise_equals: ['PUTE', 'CALLE'],
      fall_equals: ['CALLE', 'PUTE'],
    };
    return pairs[s] ?? ['DIGITEVEN', 'DIGITODD'];
  };

  const label = (ct: string) =>
    ({
      DIGITEVEN: 'Even',
      DIGITODD: 'Odd',
      DIGITMATCH: 'Matches',
      DIGITDIFF: 'Differs',
      DIGITOVER: 'Over',
      DIGITUNDER: 'Under',

      // existing Rise/Fall (kept as-is)
      CALL: 'Rise',
      PUT: 'Fall',

      // ✅ NEW labels
      RUNHIGH: 'Only Ups',
      RUNLOW: 'Only Downs',
      PUTE: 'Rise Equals',
      CALLE: 'Fall Equals',
    } as Record<string, string>)[ct] ?? ct;

  const virtualBuy = async (
    ct: string,
    isBulk = false,
    bulkId?: string,
    stakeOv?: number,
    marketOv?: string,
    durOv?: number,
    immediate = false
  ) => {
    const stake = stakeOv ?? parseFloat(stakeRef.current?.value || '0');
    let dur = durOv ?? parseInt(durRef.current?.value || '1', 10);
    const market = marketOv ?? marketRef.current?.value ?? currentSymbol;

    const minDur = minTicksForContract(ct);
    if (!Number.isFinite(dur) || dur <= 0) dur = minDur;
    if (dur < minDur) {
      dur = minDur;
      if (!durOv && durRef.current) durRef.current.value = String(minDur);
    }

    let barrierNum: number | undefined;
    if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(ct)) {
      const d = digitRef.current ? parseInt(digitRef.current.value, 10) : NaN;
      if (isNaN(d)) {
        throw new Error('digit');
      }
      barrierNum = d;
    }

    const quote = await getProposal(ct, market, dur, stake, barrierNum);
    const ask = Number(quote.ask);
    const payout = Number(quote.payout);

    const tokenAtStart = singleMatchTokenRef.current;
    let pick: { ok: true; entry: VirtualTick; exit: VirtualTick } | { ok: false };

    if (immediate) {
      pick = await pickImmediateVirtualWindow(ct, dur);
      if (!pick.ok) {
        if (isBulk) throw new Error('virtual-timeout');
        return;
      }
    } else if (ct === 'DIGITMATCH' && !isBulk) {
      pick = await waitForFavorableWindow(ct, barrierNum, market, dur, MATCH_WAIT_MS_BULK);
      while (singleMatchTokenRef.current === tokenAtStart && !pick.ok) {
        pick = await waitForFavorableWindow(ct, barrierNum, market, dur, MATCH_WAIT_MS_BULK);
      }
      if (singleMatchTokenRef.current !== tokenAtStart) return;
      if (!pick.ok) {
        if (isBulk) throw new Error('virtual-timeout');
        return;
      }
    } else {
      pick = await waitForFavorableWindow(ct, barrierNum, market, dur, isBulk ? MATCH_WAIT_MS_BULK : MATCH_WAIT_MS_SINGLE);
      if (!pick.ok) {
        if (isBulk) throw new Error('virtual-timeout');
        return;
      }
    }

    const snapshotLoginid = activeLoginid;
    const snapshotVirtualOn = snapshotLoginid === ALLOWED_BOT_IFRAME_LOGINID;
    const snapshotPipeVrt = snapshotVirtualOn && !!snapshotLoginid.startsWith('VRT');
    const snapshotPipeCr = snapshotVirtualOn && !snapshotLoginid.startsWith('VRT');

    if (snapshotPipeCr && snapshotLoginid) {
      const debitOk = await runWithCrBalanceLock(() => tryDebitCrShadowSync(snapshotLoginid, ask));
      if (!debitOk) {
        appendInsufficientTrade(ct, stake, market, dur, barrierNum, isBulk, bulkId);
        throw new Error('insufficient-balance');
      }
    } else if (snapshotPipeVrt && snapshotLoginid && client) {
      const persisted = getPersisted(snapshotLoginid);
      const storeBal = client.all_accounts_balance?.accounts?.[snapshotLoginid]?.balance;
      const cur =
        typeof persisted === 'number'
          ? persisted
          : typeof storeBal === 'number'
            ? storeBal
            : 0;
      if (cur + 1e-9 < ask) {
        appendInsufficientTrade(ct, stake, market, dur, barrierNum, isBulk, bulkId);
        throw new Error('insufficient-balance');
      }
      applyPnLToVirtualDemo(-ask);
      bus.add(snapshotLoginid, -ask);
    }

    const { id } = createVirtualTrade(ct, stake, market, dur, barrierNum, isBulk, bulkId);

    const forcedLoss = isForcedLossContract(ct);
    const settledPayout = forcedLoss ? 0 : payout;
    const net = settledPayout - ask;

    if (snapshotPipeCr && snapshotLoginid && client) {
      scheduleCrChanceLedgerRoundTrip({
        client,
        walletLoginId: snapshotLoginid,
        ask,
        settlementCredit: settledPayout,
        entryEpochSec: pick.entry.epoch,
        exitEpochSec: pick.exit.epoch,
      });
    }

    settleVirtualRow(id, pick.entry, pick.exit, net);

    if (isBulk && bulkQ.current) {
      if (net >= 0) bulkQ.current.completed++;
      else bulkQ.current.failed++;
      setBulk({
        on: true,
        done: bulkQ.current.completed,
        fail: bulkQ.current.failed,
        tot: bulkQ.current.total,
      });
      if (bulkQ.current.completed + bulkQ.current.failed === bulkQ.current.total) {
        setBulk(b => ({ ...b, on: false }));
        bulkQ.current.active = false;
      }
    }
  };

  const buy = async (
    ct: string,
    isBulk = false,
    bulkId?: string,
    stakeOv?: number,
    marketOv?: string,
    durOv?: number,
    immediate = false
  ) => {
    if (!activeLoginid) {
      throw new Error('login');
    }
    if (!client) {
      throw new Error('restricted');
    }

    if (isCrVirtualShadowLogin(activeLoginid)) {
      await virtualBuy(ct, isBulk, bulkId, stakeOv, marketOv, durOv, immediate);
      return `virtual-${Date.now()}`;
    }

    await realDerivBuy(ct, isBulk, bulkId, stakeOv, marketOv, durOv, immediate);
    return `deriv-${Date.now()}`;
  };

  const buyBoth = async () => {
    try {
      await Promise.all([buy(ctypes.left), buy(ctypes.right)]);
    } catch {
      // handled individually
    }
  };

  const assertAllowedIframeTrader = () => {
    if (!activeLoginid || !client) return false;
    return true;
  };

  // ✅ top buttons: if Entry ON => arm (manual Entry Point), else buy immediately
  const armOrBuy = (side: 'left' | 'right') => {
    if (!assertAllowedIframeTrader()) return;

    if (!autoOnRef.current) {
      return bothMode ? buyBoth() : buy(side === 'left' ? ctypes.left : ctypes.right);
    }

    const ep = autoEntryRef.current;
    if (!Number.isFinite(ep) || ep < 0 || ep > 9) {
      return;
    }

    pendingAutoRef.current = bothMode
      ? { mode: 'both', left: ctypes.left, right: ctypes.right }
      : { mode: 'single', ct: side === 'left' ? ctypes.left : ctypes.right };

    autoBusyRef.current = false;
  };

  // ✅ bulk buttons: if Entry ON => arm (manual Entry Point), else start bulk immediately
  const armOrStartBulk = (ct: string) => {
    if (!assertAllowedIframeTrader()) return;
    if (!autoOnRef.current) return startBulk(ct);

    const ep = autoEntryRef.current;
    if (!Number.isFinite(ep) || ep < 0 || ep > 9) {
      return;
    }

    pendingAutoRef.current = { mode: 'bulk', ct };
    autoBusyRef.current = false;
  };

  const startBulk = (ct: string) => {
    if (!assertAllowedIframeTrader()) return;

    const count = parseInt(bulkCntRef.current?.value || '0', 10);
    const stake = parseFloat(stakeRef.current?.value || '10');
    let duration = parseInt(durRef.current?.value || '1', 10);
    const market = marketRef.current?.value || BOT_IFRAME_DEFAULT_MARKET;

    const minDur = minTicksForContract(ct);
    if (!Number.isFinite(duration) || duration <= 0) duration = minDur;
    if (duration < minDur) {
      duration = minDur;
      if (durRef.current) durRef.current.value = String(minDur);
    }

    if (!count || !stake) {
      return;
    }

    bulkQ.current = {
      active: true,
      processing: false,
      queue: Array(count)
        .fill(null)
        .map((_, i) => ({
          id: `bulk-${Date.now()}-${i}`,
          contractType: ct,
          stake,
          market,
          duration,
          status: 'pending' as const,
          attempts: 0,
          maxAttempts: 3,
        })),
      completed: 0,
      failed: 0,
      total: count,
    };

    setBulk({ on: true, done: 0, fail: 0, tot: count });

    processBulk();
  };

  const updateBulkProgress = () => {
    if (!bulkQ.current) return;
    setBulk({
      on: true,
      done: bulkQ.current.completed,
      fail: bulkQ.current.failed,
      tot: bulkQ.current.total,
    });
    if (bulkQ.current.completed + bulkQ.current.failed === bulkQ.current.total) {
      setBulk(b => ({ ...b, on: false }));
      bulkQ.current.active = false;
    }
  };

  const processBulk = async () => {
    if (!bulkQ.current || !bulkQ.current.active) return;

    // ✅ TURBO = fire all pending at once (concurrently)
    if (turboRef.current) {
      const pendings = bulkQ.current.queue.filter(q => q.status === 'pending');
      if (pendings.length === 0) return;

      bulkQ.current.processing = true;

      await Promise.all(
        pendings.map(async job => {
          job.status = 'processing';
          job.attempts++;
          try {
            await buy(job.contractType, true, job.id, job.stake, job.market, job.duration);
            job.status = 'executed';
          } catch (e) {
            const insuf = e instanceof Error && e.message === 'insufficient-balance';
            if (insuf || job.attempts >= job.maxAttempts) {
              job.status = 'failed';
              bulkQ.current!.failed++;
            } else {
              job.status = 'pending';
            }
          }
        })
      );

      bulkQ.current.processing = false;
      updateBulkProgress();

      if (bulkQ.current.active && bulkQ.current.queue.some(q => q.status === 'pending')) {
        setTimeout(processBulk, 150);
      }
      return;
    }

    // SAFE sequential mode
    if (bulkQ.current.processing) return;
    const next = bulkQ.current.queue.find(q => q.status === 'pending');
    if (!next) return;

    bulkQ.current.processing = true;
    next.status = 'processing';
    next.attempts++;

    try {
      await buy(next.contractType, true, next.id, next.stake, next.market, next.duration);
      next.status = 'executed';
    } catch (e) {
      const insuf = e instanceof Error && e.message === 'insufficient-balance';
      if (insuf || next.attempts >= next.maxAttempts) {
        next.status = 'failed';
        bulkQ.current.failed++;
      } else {
        next.status = 'pending';
      }
    } finally {
      bulkQ.current.processing = false;
      updateBulkProgress();
      if (bulkQ.current.active) processBulk();
    }
  };

  const stopBulk = () => {
    if (bulkQ.current) bulkQ.current.active = false;
    setBulk(b => ({ ...b, on: false }));
  };

  const handleReset = () => {
    if (bulkQ.current) bulkQ.current.active = false;

    cancelSingleMatchWaits();
    pendingAutoRef.current = null;
    autoBusyRef.current = false;

    setTrades([]);
    setPL(0);
    setBulk({ on: false, done: 0, fail: 0, tot: 0 });
  };

  const handleWS = (d: any) => {
    if (d.error?.message?.includes('proposal_open_contract')) return;

    if (d.error) {
      if (isAlreadySubscribedTickError(d.error) && d.echo_req?.ticks_history) return;
      console.error('WebSocket error:', d.error);
      return;
    }

    switch (d.msg_type) {
      case 'proposal_open_contract':
        handlePOC(d.proposal_open_contract);
        break;
      case 'transaction':
        if (d.transaction.action === 'sell') handleTX(d.transaction);
        break;
    }
  };

  const extractSettlementDigit = (c: any, marketFormat?: string) => {
    const v = c?.exit_tick ?? c?.exit_spot ?? c?.current_spot;
    if (v === undefined || v === null) return null;

    const num = Number(v);
    if (!Number.isFinite(num)) return null;

    const mf = marketFormat || currentSymbol;
    const tickString = botIframeFormatQuoteForDigitContract(num, mf);

    const d = parseInt(tickString.slice(-1), 10);
    return Number.isFinite(d) ? d : null;
  };

  const handlePOC = (c: any) => {
    const cid = String(c.contract_id ?? '');
    const poc = c as Record<string, unknown>;
    setTrades(prev =>
      prev.map(tr => {
        if (String(tr.id) !== cid) return tr;

        const marketFmt = tr.marketFormat || currentSymbol;

        const entryTs = coerceProposalOpenContractEntryTimeSec(poc);
        const entrySpot = coerceProposalOpenContractEntrySpot(poc);

        if (entryTs || entrySpot != null) {
          if (entryTs && !tr.startTime) {
            tr.startTime = new Date(entryTs * 1000);
          }
          if (entrySpot != null) {
            tr.entryValue = entrySpot;
          }
          tr.marketFormat = marketFmt;
        }

        if (c.tick_count && c.current_tick) tr.ticksRemaining = c.tick_count - c.current_tick;
        tr.currentValue = c.current_spot ? Number(c.current_spot) : tr.currentValue;

        const finished = c.is_sold || c.is_expired || c.is_settleable || c.status === 'sold';
        if (finished) {
          const alreadySettled = tr.status === 'won' || tr.status === 'lost';
          const net = Number(c.profit ?? 0);
          tr.status = net >= 0 ? 'won' : 'lost';
          tr.profit = net;
          tr.closeTime = new Date();
          tr.exitValue = c.exit_tick ? Number(c.exit_tick) : c.exit_spot ? Number(c.exit_spot) : undefined;
          const durN = Number(tr.duration || 1);
          if (tr.entryValue == null && tr.exitValue != null && durN === 1) {
            tr.entryValue = tr.exitValue;
          }
          if (tr.entryValue == null && tr.exitValue != null) {
            const again = coerceProposalOpenContractEntrySpot(poc);
            if (again != null) tr.entryValue = again;
          }
          if (!alreadySettled) playSound(net >= 0);

          const settlementDigit = extractSettlementDigit(c, marketFmt);
          if (settlementDigit !== null) blinkPurchasedTickDigit(`${cid}:${settlementDigit}`, settlementDigit);

          if (tr.isBulkTrade && bulkQ.current && !tr.counted) {
            tr.counted = true;
            if (net >= 0) bulkQ.current.completed++;
            else bulkQ.current.failed++;
            updateBulkProgress();
          }
        } else {
          tr.status = (c.status as TradeStatus) || 'active';
        }
        return { ...tr };
      })
    );
  };

  const handleTX = (tx: TTransaction) => {
    const txid = String(tx.contract_id ?? '');
    setTrades(prev =>
      prev.map(tr => {
        if (String(tr.id) !== txid) return tr;
        const alreadySettled = tr.status === 'won' || tr.status === 'lost';
        const net = Number(tx.amount) - tr.stake;
        tr.status = net >= 0 ? 'won' : 'lost';
        tr.profit = net;
        tr.closeTime = new Date(tx.transaction_time * 1000);
        if (!alreadySettled) playSound(net >= 0);

        if (tr.isBulkTrade && bulkQ.current && !tr.counted) {
          tr.counted = true;
          if (net >= 0) bulkQ.current.completed++;
          else bulkQ.current.failed++;
          updateBulkProgress();
        }
        return { ...tr };
      })
    );
  };

  const getTradeStats = () => {
    const completedTrades = trades.filter(t => t.status === 'won' || t.status === 'lost');
    return {
      total: completedTrades.length,
      won: completedTrades.filter(t => t.status === 'won').length,
      lost: completedTrades.filter(t => t.status === 'lost').length,
    };
  };

  const toggleMode = (mode: 'evenOdd' | 'overUnder' | 'riseFall') => setActiveMode(mode);

  /** Single barrier for Over/Under analysis: same digit for both (Over = red, Under = green in UI). */
  const handleOuBarrierDigitSelect = (digit: number) =>
    setAnalysisData(prev => ({ ...prev, overDigit: digit, underDigit: digit }));

  const refreshData = () => {
    const newMarket = marketSelectionRef.current?.value || currentSymbol;
    setCurrentSymbol(newMarket);
    if (marketRef.current) marketRef.current.value = newMarket;
    cancelSingleMatchWaits();
    pendingAutoRef.current = null;
    autoBusyRef.current = false;
  };

  const applyHistoryPrices = useCallback((symbol: string, prices: number[]) => {
    if (!prices.length) return;

    // Deriv returns oldest → newest; chamber wants newest first (see multiple.tsx).
    const recent = prices.slice(-ANALYSIS_HISTORY_TICK_COUNT);
    type TRow = {
      digit: number;
      isEven: boolean;
      isRise: null;
      price: number;
      timestamp: Date;
    };
    const results: TRow[] = [];
    const digitCounts = Array(10).fill(0);
    let evenCount = 0;
    let oddCount = 0;

    for (let i = recent.length - 1; i >= 0; i--) {
      const price = Number(recent[i]);
      if (!Number.isFinite(price)) continue;
      const lastDigit = botIframeLastDigitFromQuote(price, symbol);
      const isEven = lastDigit % 2 === 0;
      digitCounts[lastDigit]++;
      if (isEven) evenCount++;
      else oddCount++;
      results.push({ digit: lastDigit, isEven, isRise: null, price, timestamp: new Date() });
    }

    prevTickRef.current = Number(recent[recent.length - 1]);
    lastEpochRef.current = null;

    setAnalysisData(prev => ({
      ...prev,
      evenCount,
      oddCount,
      riseCount: 0,
      fallCount: 0,
      totalCount: results.length,
      lastResults: results,
      lastDigit: results[0]?.digit ?? null,
      lastPrice: results[0]?.price ?? null,
      digitCounts,
      currentMarket: symbol,
    }));
    setDigitStatsMarket(symbol);
    setDigitStatsReady(true);
  }, []);

  const forgetTickSubscription = useCallback(async (subscriptionId: string | null) => {
    await forgetDerivSubscription(visualTickApiRef.current, subscriptionId);
  }, [visualTickApiRef]);

  const updateDistribution = (lastDigit: number, val: number, isRise: boolean | null) => {
    const isEven = lastDigit % 2 === 0;
    setAnalysisData(prev => {
      const digitCounts = [...prev.digitCounts];
      digitCounts[lastDigit]++;

      const newLastResults = [{ digit: lastDigit, isEven, isRise, price: val, timestamp: new Date() }, ...prev.lastResults].slice(
        0,
        1000
      );

      return {
        ...prev,
        evenCount: isEven ? prev.evenCount + 1 : prev.evenCount,
        oddCount: !isEven ? prev.oddCount + 1 : prev.oddCount,
        riseCount: isRise === true ? prev.riseCount + 1 : prev.riseCount,
        fallCount: isRise === false ? prev.fallCount + 1 : prev.fallCount,
        totalCount: prev.totalCount + 1,
        lastResults: newLastResults,
        lastDigit,
        lastPrice: val,
        digitCounts,
        currentMarket: marketSelectionRef.current?.value || prev.currentMarket,
      };
    });
  };

  // ✅ Entry trigger on LIVE ticks — immediate (Strategy-style), no debounce
  const tryExecuteEntryTrigger = useCallback(
    (val: number) => {
      if (
        !isLiveTickRef.current ||
        !autoOnRef.current ||
        !pendingAutoRef.current ||
        autoBusyRef.current ||
        !activeLoginid
      ) {
        return;
      }

      const currentMarket =
        subscribedTickSymbolRef.current || marketSelectionRef.current?.value || BOT_IFRAME_DEFAULT_MARKET;
      const lastDigit = botIframeLastDigitFromQuote(val, currentMarket);

      if (!Number.isFinite(autoEntryRef.current) || autoEntryRef.current !== lastDigit) {
        return;
      }

      autoBusyRef.current = true;
      const action = pendingAutoRef.current;
      pendingAutoRef.current = null;

      (async () => {
        try {
          if (action.mode === 'both') {
            await Promise.all([buy(action.left, false, undefined, undefined, undefined, undefined, true), buy(action.right, false, undefined, undefined, undefined, undefined, true)]);
          } else if (action.mode === 'single') {
            await buy(action.ct, false, undefined, undefined, undefined, undefined, true);
          } else if (action.mode === 'bulk') {
            startBulk(action.ct);
          }
        } catch {
          // buy() already sets status
        } finally {
          autoBusyRef.current = false;
        }
      })();
    },
    [activeLoginid, buy, startBulk]
  );

  // ✅ LIVE tick handler: debounced UI stats only; entry fires synchronously
  const handleTick = (val: number) => {
    tryExecuteEntryTrigger(val);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(() => {
      const prev = prevTickRef.current;
      if (prev === null) {
        prevTickRef.current = val;
        return;
      }

      const currentMarket =
        subscribedTickSymbolRef.current || marketSelectionRef.current?.value || BOT_IFRAME_DEFAULT_MARKET;
      const lastDigit = botIframeLastDigitFromQuote(val, currentMarket);

      let isRise: boolean | null = null;
      if (prevTickRef.current !== null) {
        if (val > prevTickRef.current) isRise = true;
        else if (val < prevTickRef.current) isRise = false;
      }

      if (historyReadyRef.current) {
        updateDistribution(lastDigit, val, isRise);
      }
      prevTickRef.current = val;
    }, 50);
  };

  // Market ticks: single effect (listener + subscribe) avoids races when switching markets or remounting.
  useEffect(() => {
    const tickApi = visualTickApi;
    if (!tickApi || !visualTickReady || tickApi.connection.readyState !== 1) {
      logBotIframe10_1sIf(currentSymbol, 'tick effect skipped — visual tick API not ready', {
        visualTickReady,
        hasApi: !!tickApi,
        readyState: tickApi?.connection?.readyState,
      });
      return;
    }

    const streamOpId = ++tickStreamOpRef.current;
    const symbol = currentSymbol;
    const isActiveStream = () => tickStreamOpRef.current === streamOpId;

    logBotIframe10_1sIf(symbol, 'tick effect started', {
      streamOpId,
      connectionStatus,
      historyTickCount: ANALYSIS_HISTORY_TICK_COUNT,
    });

    subscribedTickSymbolRef.current = symbol;
    isLiveTickRef.current = false;
    historyReadyRef.current = false;
    setDigitStatsReady(false);
    setDigitStatsMarket(null);
    lastEpochRef.current = null;
    prevTickRef.current = null;
    tickBufferRef.current = [];
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = undefined;
    }

    // Chamber clears immediately; digit rings show "…" until bulk last-1000 history lands.
    setAnalysisData(prev => ({
      ...prev,
      evenCount: 0,
      oddCount: 0,
      riseCount: 0,
      fallCount: 0,
      totalCount: 0,
      lastResults: [],
      lastDigit: null,
      lastPrice: null,
      digitCounts: Array(10).fill(0),
      currentMarket: symbol,
    }));

    let historyApplied = false;
    let lastLiveTickAt = Date.now();
    let recoverInFlight = false;

    const attachLiveTickStream = async (source: string) => {
      if (!tickApi || !isActiveStream() || recoverInFlight) return;
      recoverInFlight = true;
      logBotIframe10_1sIf(symbol, 'attachLiveTickStream', { source, streamOpId });
      try {
        const { subscriptionId, error } = await recoverDerivLiveTickStream(tickApi, symbol);
        if (!isActiveStream()) return;
        if (subscriptionId) {
          tickSubscriptionIdRef.current = subscriptionId;
          historyReadyRef.current = true;
          lastLiveTickAt = Date.now();
          logBotIframe10_1sIf(symbol, 'attachLiveTickStream OK', { source, subscriptionId });
        } else if (error) {
          logBotIframe10_1sIf(symbol, 'attachLiveTickStream failed', { source, error });
        }
      } finally {
        recoverInFlight = false;
      }
    };

    const applyHistoryOnce = (prices: number[], times: number[], source: string) => {
      if (historyApplied) {
        logBotIframe10_1sIf(symbol, 'applyHistoryOnce skipped — already applied', { source });
        return;
      }
      if (!isActiveStream()) {
        logBotIframe10_1sIf(symbol, 'applyHistoryOnce skipped — stale stream', { source, streamOpId });
        return;
      }
      if (!prices.length) {
        logBotIframe10_1sIf(symbol, 'applyHistoryOnce skipped — empty prices', { source });
        return;
      }
      historyApplied = true;
      isLiveTickRef.current = false;
      if (times.length === prices.length) {
        const seedFrom = Math.max(0, prices.length - 600);
        for (let i = seedFrom; i < prices.length; i++) {
          pushTick({ epoch: times[i], quote: prices[i] });
        }
      }
      applyHistoryPrices(symbol, prices);
      historyReadyRef.current = true;
      logBotIframe10_1sIf(symbol, 'applyHistoryOnce OK', {
        source,
        priceCount: prices.length,
        timeCount: times.length,
        lastPrice: prices[prices.length - 1],
      });
    };

    const fetchTickHistoryOnly = async (source: string) => {
      if (!tickApi || !isActiveStream()) return false;
      try {
        const hist = await tickApi.send({
          ticks_history: symbol,
          style: 'ticks',
          count: ANALYSIS_HISTORY_TICK_COUNT,
          end: 'latest',
          subscribe: 0,
        });
        if (!isActiveStream()) return false;
        if (hist?.error) {
          logBotIframe10_1sIf(symbol, 'history-only request error', { source, error: hist.error });
          return false;
        }
        const prices = (hist?.history?.prices ?? []).map(Number).filter((n: number) => Number.isFinite(n));
        const times = (hist?.history?.times ?? []).map(Number);
        if (prices.length) {
          applyHistoryOnce(prices, times, source);
          return true;
        }
        return false;
      } catch (err) {
        logBotIframe10_1sIf(symbol, 'history-only request failed', {
          source,
          error: err instanceof Error ? { message: err.message, name: err.name } : err,
        });
        return false;
      }
    };

    const subscribeMarketTicks = async () => {
      if (tickSubscribeInFlightRef.current) {
        logBotIframe10_1sIf(symbol, 'subscribeMarketTicks skipped — in flight', { streamOpId });
        return;
      }
      if (!tickApi || tickApi.connection.readyState !== 1 || !isActiveStream()) {
        logBotIframe10_1sIf(symbol, 'subscribeMarketTicks aborted', {
          readyState: tickApi?.connection?.readyState,
          isActiveStream: isActiveStream(),
          streamOpId,
        });
        return;
      }

      tickSubscribeInFlightRef.current = true;
      logBotIframe10_1sIf(symbol, 'subscribeMarketTicks sending ticks_history', { streamOpId });

      try {
        const priorSubId = tickSubscriptionIdRef.current;
        tickSubscriptionIdRef.current = null;
        if (priorSubId) {
          await forgetTickSubscription(priorSubId);
        }
        if (!isActiveStream()) return;

        const resp = await tickApi.send({
          ticks_history: symbol,
          style: 'ticks',
          count: ANALYSIS_HISTORY_TICK_COUNT,
          end: 'latest',
          subscribe: 1,
        });

        if (!isActiveStream()) return;

        if (resp?.error && isAlreadySubscribedTickError(resp.error)) {
          logBotIframe10_1sIf(symbol, 'ticks_history AlreadySubscribed — using history-only + live stream', {
            streamOpId,
          });
          const ok = await fetchTickHistoryOnly('already-subscribed-response');
          if (ok || historyApplied) {
            historyReadyRef.current = true;
          }
          await attachLiveTickStream('already-subscribed-response');
          return;
        }

        if (resp?.error) {
          logBotIframe10_1sIf(symbol, 'ticks_history response error', { streamOpId, error: resp.error });
          return;
        }

        const newSubId = resp?.subscription?.id ? String(resp.subscription.id) : null;
        tickSubscriptionIdRef.current = newSubId;

        logBotIframe10_1sIf(symbol, 'ticks_history response', {
          streamOpId,
          subscriptionId: newSubId,
          msgType: resp?.msg_type,
          priceCount: resp?.history?.prices?.length ?? 0,
        });

        if (resp?.history?.prices?.length) {
          const prices = resp.history.prices.map(Number).filter((n: number) => Number.isFinite(n));
          const times = (resp.history.times ?? []).map(Number);
          applyHistoryOnce(prices, times, 'send-response');
        } else {
          logBotIframe10_1sIf(symbol, 'ticks_history response had no history.prices', {
            streamOpId,
            respKeys: resp ? Object.keys(resp) : [],
          });
        }
      } catch (err) {
        if (isAlreadySubscribedTickError(err)) {
          logBotIframe10_1sIf(symbol, 'ticks_history AlreadySubscribed (catch) — history-only', { streamOpId });
          const ok = await fetchTickHistoryOnly('already-subscribed-catch');
          if (ok || historyApplied) {
            historyReadyRef.current = true;
          }
          await attachLiveTickStream('already-subscribed-catch');
        } else {
          logBotIframe10_1sIf(symbol, 'ticks_history send failed', {
            streamOpId,
            error: err instanceof Error ? { message: err.message, name: err.name } : err,
          });
        }
      } finally {
        tickSubscribeInFlightRef.current = false;
      }
    };

    const historyRetryTimers = [2000, 4500].map(delay =>
      window.setTimeout(() => {
        if (!historyApplied && isActiveStream() && !tickSubscribeInFlightRef.current) {
          logBotIframe10_1sIf(symbol, 'history retry subscribe', { delayMs: delay, streamOpId });
          void subscribeMarketTicks();
        }
      }, delay)
    );

    const sub = tickApi.onMessage().subscribe(({ data }: any) => {
      if (!data || !isActiveStream()) return;
      if (subscribedTickSymbolRef.current !== symbol) return;

      if (data.error) {
        if (isAlreadySubscribedTickError(data.error) && data.echo_req?.ticks_history === symbol) {
          logBotIframe10_1sIf(symbol, 'onMessage AlreadySubscribed — history-only', {
            echoReq: data.echo_req,
          });
          if (!historyApplied) {
            void fetchTickHistoryOnly('onMessage-already-subscribed').then(async ok => {
              if (ok || historyApplied) historyReadyRef.current = true;
              await attachLiveTickStream('onMessage-already-subscribed');
            });
          } else {
            historyReadyRef.current = true;
            void attachLiveTickStream('onMessage-already-subscribed-live');
          }
          return;
        }
        logBotIframe10_1sIf(symbol, 'onMessage error', {
          msgType: data.msg_type,
          error: data.error,
          echoReq: data.echo_req,
        });
        return;
      }

      if (data.msg_type === 'history') {
        const reqSym = data.echo_req?.ticks_history;
        if (reqSym && reqSym !== symbol) {
          logBotIframe10_1sIf(symbol, 'history ignored — symbol mismatch', {
            expected: symbol,
            reqSym,
          });
          return;
        }

        const prices = (data.history?.prices ?? []).map(Number).filter((n: number) => Number.isFinite(n));
        const times = (data.history?.times ?? []).map(Number);
        logBotIframe10_1sIf(symbol, 'onMessage history', { priceCount: prices.length, reqSym });
        applyHistoryOnce(prices, times, 'onMessage-history');
        return;
      }

      if (data.msg_type === 'tick' && data.tick) {
        const tickSym = data.tick.symbol ?? data.echo_req?.ticks;
        if (tickSym && tickSym !== symbol) {
          logBotIframe10_1sIf(symbol, 'tick ignored — symbol mismatch', {
            expected: symbol,
            tickSym,
            echoTicks: data.echo_req?.ticks,
          });
          return;
        }

        isLiveTickRef.current = true;
        lastLiveTickAt = Date.now();
        const q = Number(data.tick.quote);
        const ep = Number(data.tick.epoch);
        if (!Number.isFinite(q)) return;
        if (lastEpochRef.current !== ep) {
          lastEpochRef.current = ep;
          pushTick({ epoch: ep, quote: q });
        }
        handleTick(q);
      }
    });

    void subscribeMarketTicks();

    const tickWatchTimer = window.setInterval(() => {
      if (!isActiveStream() || !historyApplied || tickSubscribeInFlightRef.current || recoverInFlight) {
        return;
      }
      if (Date.now() - lastLiveTickAt < BOT_TICK_STALL_RECOVER_MS) return;
      logBotIframe10_1sIf(symbol, 'tick stall — recovering live stream', {
        streamOpId,
        msSinceTick: Date.now() - lastLiveTickAt,
      });
      void attachLiveTickStream('tick-stall-watchdog');
    }, BOT_TICK_WATCH_INTERVAL_MS);

    return () => {
      logBotIframe10_1sIf(symbol, 'tick effect cleanup', { streamOpId });
      window.clearInterval(tickWatchTimer);
      historyRetryTimers.forEach(id => window.clearTimeout(id));
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = undefined;
      }
      sub.unsubscribe();
      subscribedTickSymbolRef.current = null;
      historyReadyRef.current = false;
      setDigitStatsReady(false);
      setDigitStatsMarket(null);
      tickSubscribeInFlightRef.current = false;
      const subId = tickSubscriptionIdRef.current;
      tickSubscriptionIdRef.current = null;
      if (subId) void forgetTickSubscription(subId);
    };
  }, [currentSymbol, visualTickApi, visualTickReady, applyHistoryPrices, forgetTickSubscription]);

  // O/U barrier digit — must not restart the tick stream (was causing AlreadySubscribed on 1HZ10V).
  useEffect(() => {
    const ouBar =
      (strategy === 'over' || strategy === 'under') && /^\d$/.test(predictionDigit.trim())
        ? parseInt(predictionDigit.trim(), 10)
        : 1;
    setAnalysisData(prev => ({ ...prev, overDigit: ouBar, underDigit: ouBar }));
  }, [strategy, predictionDigit]);

  const renderEvenOddHistory = () =>
    analysisData.lastResults.slice(0, 300).map((result, index) => (
      <div key={index} className="history-item" style={{ color: result.isEven ? '#2ecc71' : '#e74c3c' }}>
        {result.isEven ? 'E' : 'O'}
      </div>
    ));

  const renderOverUnderHistory = () =>
    analysisData.lastResults.slice(0, 300).map((result, index) => {
      const bOver = analysisData.overDigit;
      const bUnder = analysisData.underDigit;
      const isOver = bOver === 0 ? result.digit > 0 : result.digit > bOver;
      const isUnder = result.digit < bUnder;

      let color: string | undefined;
      if (isOver) color = '#e74c3c';
      else if (isUnder) color = '#2ecc71';
      else color = '#95a5a6';

      return (
        <div
          key={index}
          className="history-item"
          style={{
            color,
            fontWeight: 700,
          }}
          title={`Price: ${result.price}`}
        >
          {result.digit}
        </div>
      );
    });

  const renderRiseFallHistory = () => {
    const filteredResults = analysisData.lastResults.filter(result => result.isRise !== null).slice(0, 300);
    if (filteredResults.length === 0) {
      return (
        <div className="no-results-message">
          {analysisData.lastResults.length === 0 ? 'Waiting for first price data...' : 'No price changes detected'}
        </div>
      );
    }

    const riseGreen = '#2ecc71';
    const fallRed = '#e74c3c';

    return filteredResults.map((result, index) => (
      <div
        key={index}
        className="history-item"
        style={{
          color: result.isRise === true ? riseGreen : result.isRise === false ? fallRed : '#3498db',
        }}
        title={`Price: ${result.price}`}
      >
        {result.isRise ? 'R' : result.isRise === false ? 'F' : '='}
      </div>
    ));
  };

  /** Matches / Differs: last-digit tiles — green when digit equals prediction, red otherwise. */
  const renderMatchDiffChamberHistory = () => {
    const s = predictionDigit.trim();
    const pred = /^\d$/.test(s) ? parseInt(s, 10) : null;
    return analysisData.lastResults.slice(0, 300).map((result, index) => {
      const match = pred !== null && result.digit === pred;
      const color = pred === null ? '#95a5a6' : match ? '#2ecc71' : '#e74c3c';
      return (
        <div
          key={index}
          className="history-item"
          style={{ color, fontWeight: 700 }}
          title={`Price: ${result.price}`}
        >
          {result.digit}
        </div>
      );
    });
  };

  const digitsData = useMemo(() => {
    // Counts from the same sliding window as the analysis chamber (not cumulative digitCounts).
    const filtered = analysisData.lastResults.slice(0, ANALYSIS_HISTORY_TICK_COUNT);
    const total = filtered.length;
    const counts = Array(10).fill(0);
    filtered.forEach(r => {
      counts[r.digit]++;
    });

    const raw = Array.from({ length: 10 }).map((_, d) => ({
      digit: d,
      count: counts[d] || 0,
      pct: total > 0 ? (counts[d] / total) * 100 : 0,
    }));

    if (!total) {
      return raw.map(x => ({ ...x, rank: null as 1 | 2 | 3 | 4 | null }));
    }

    const sorted = [...raw].sort((a, b) => b.count - a.count || a.digit - b.digit);
    const top1 = sorted[0]?.digit ?? null;
    const top2 = sorted[1]?.digit ?? null;
    const top3 = sorted[2]?.digit ?? null;

    const minCount = Math.min(...raw.map(x => x.count));
    const leastCandidates = raw.filter(x => x.count === minCount);
    const least = leastCandidates.length
      ? [...leastCandidates].sort((a, b) => b.digit - a.digit)[0].digit
      : null;

    const withRank = raw.map(x => {
      let rank: 1 | 2 | 3 | 4 | null = null;
      if (x.digit === top1) rank = 1;
      else if (x.digit === top2) rank = 2;
      else if (x.digit === top3) rank = 3;
      else if (x.digit === least) rank = 4;
      return { ...x, rank };
    });

    return withRank.sort((a, b) => a.digit - b.digit);
  }, [analysisData.lastResults]);

  const latestDigit = analysisData.lastDigit;
  const showDigitPcts = digitStatsReady && digitStatsMarket === currentSymbol;

  const R = 22;
  const C = 2 * Math.PI * R;

  useEffect(() => {
    let sub: { unsubscribe: () => void } | null = null;
    let cancelled = false;
    const start = async () => {
      try {
        const liveApi = await ensureApiReady();
        if (cancelled) return;
        sub = liveApi.onMessage().subscribe(({ data }: any) => handleWS(data));
      } catch {
        /* ignore transient socket setup failures */
      }
    };
    void start();
    return () => {
      cancelled = true;
      sub?.unsubscribe();
    };
    // Re-bind when Deriv swaps the Options OTP WebSocket (account switch uses a different instance).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradingSocketGeneration, activeLoginid, ensureApiReady]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (purchasedBlinkTimerRef.current) window.clearTimeout(purchasedBlinkTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setTrades(prev =>
        prev.map(tr => {
          if (tr.status === 'pending') {
            const age = Date.now() - tr.timestamp.getTime();
            if (age > 8000) return { ...tr, status: 'error', temp: false };
          }
          return tr;
        })
      );
    }, 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setPL(trades.reduce((s, t) => s + (t.profit ?? 0), 0));
  }, [trades]);

  useEffect(() => {
    setCT({ left: mapContracts(strategy)[0], right: mapContracts(strategy)[1] });

    if (digitRef.current) {
      const need = needsDigit(strategy);
      digitRef.current.disabled = !need;
      digitRef.current.style.backgroundColor = need ? '' : 'gray';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy]);

  /** Over/Under strategy: open O/U analysis once, keep barrier digits aligned with Prediction. */
  useEffect(() => {
    const prev = prevStrategyRef.current;
    const isOu = strategy === 'over' || strategy === 'under';
    if (isOu) {
      const wasOu = prev === 'over' || prev === 'under';
      if (!wasOu) setActiveMode('overUnder');
      const s = predictionDigit.trim();
      if (/^\d$/.test(s)) {
        const b = parseInt(s, 10);
        setAnalysisData(p => {
          if (p.overDigit === b && p.underDigit === b) return p;
          return { ...p, overDigit: b, underDigit: b };
        });
      }
    }
    prevStrategyRef.current = strategy;
  }, [strategy, predictionDigit]);

  useEffect(() => {
    if (strategy === 'matches' || strategy === 'differs') setSelectedDigit(null);
  }, [strategy]);

  const posClass = (st: TradeStatus) =>
    st === 'won' ? 'position-win' : st === 'lost' || st === 'error' ? 'position-loss' : 'position-open';

  const formatTickValue = (value?: number, marketFormat?: string) => {
    if (value === undefined) return '—';
    return botIframeFormatQuoteForDigitContract(value, marketFormat || '');
  };

  const tradeStats = getTradeStats();

  const mdBarrierDigit: number | null =
    strategy === 'matches' || strategy === 'differs'
      ? (() => {
          const s = predictionDigit.trim();
          return /^\d$/.test(s) ? parseInt(s, 10) : null;
        })()
      : null;
  const mdBarrierFocus = mdBarrierDigit !== null;

  return (
    <div className="bot-app" style={{ background: ui.is_dark_mode_on ? 'var(--general-main-1)' : 'transparent' }}>
      {/* Analysis Mode Selector */}
      <div className="analysis-mode-selector">
        <ul className="mode-list">
          <li>
            <button
              className={`mode-btn ${activeMode === 'evenOdd' ? 'active' : ''}`}
              onClick={() => toggleMode('evenOdd')}
              style={{ padding: '10px' }}
            >
              Even/Odd
            </button>
          </li>
          <li>
            <button
              className={`mode-btn ${activeMode === 'overUnder' ? 'active' : ''}`}
              onClick={() => toggleMode('overUnder')}
              style={{ padding: '10px' }}
            >
              Over/Under
            </button>
          </li>
          <li>
            <button
              className={`mode-btn ${activeMode === 'riseFall' ? 'active' : ''}`}
              onClick={() => toggleMode('riseFall')}
              style={{ padding: '10px' }}
            >
              Rise/Fall
            </button>
          </li>
        </ul>
      </div>

      {/* Market Selector (top) */}
      <div className="market-selector one">
        <i className="fas fa-chart-line market-icon"></i>
        <select
          className="marketSelection"
          id="marketSelection"
          ref={marketSelectionRef}
          onChange={e => {
            const newMarket = e.target.value;
            if (newMarket === BOT_IFRAME_DEBUG_10_1S) {
              logBotIframe10_1s('market selected (analysis selector)', {
                from: currentSymbol,
                connectionStatus,
                hasApi: !!api_base.api,
                wsReadyState: api_base.api?.connection?.readyState,
              });
            }
            setCurrentSymbol(newMarket);
            if (marketRef.current) marketRef.current.value = newMarket;
            cancelSingleMatchWaits();
            pendingAutoRef.current = null;
            autoBusyRef.current = false;
          }}
          value={currentSymbol}
        >
          <option value="R_10">Volatility 10 index</option>
          <option value="1HZ10V">Volatility 10(1s) index</option>
          <option value="1HZ15V">Volatility 15(1s) index</option>
          <option value="R_25">Volatility 25 index</option>
          <option value="1HZ25V">Volatility 25(1s) index</option>
          <option value="1HZ30V">Volatility 30(1s) index</option>
          <option value="R_50">Volatility 50 index</option>
          <option value="1HZ50V">Volatility 50(1s) index</option>
          <option value="R_75">Volatility 75 index</option>
          <option value="1HZ75V">Volatility 75(1s) index</option>
          <option value="1HZ90V">Volatility 90(1s) index</option>
          <option value="R_100">Volatility 100 index</option>
          <option value="1HZ100V">Volatility 100(1s) index</option>
          <option value="JD10">Jump 10 Index</option>
          <option value="JD25">Jump 25 Index</option>
          <option value="JD50">Jump 50 Index</option>
          <option value="JD75">Jump 75 Index</option>
          <option value="JD100">Jump 100 Index</option>
        </select>
      </div>

      {/* ✅ FULL SVG DIGITS CONTAINER */}
      <div
        className={[
          'digits-container',
          !showDigitPcts ? 'digits-container--loading' : '',
          activeMode === 'overUnder' ? 'digits-container--ou-barrier' : '',
          mdBarrierFocus ? 'digits-container--match-diff' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="digits">
          {digitsData.map(({ digit, pct, count, rank }) => {
            const isLatest = latestDigit === digit;
            const isLatestShown = isLatest && !mdBarrierFocus;
            const isPurchased = purchasedTickDigit === digit;
            const isSelected = selectedDigit === digit;

            const ouB = analysisData.overDigit;
            const isOuOver =
              !mdBarrierFocus && activeMode === 'overUnder' && (ouB === 0 ? digit > 0 : digit > ouB);
            const isOuUnder = !mdBarrierFocus && activeMode === 'overUnder' && digit < analysisData.underDigit;

            const rankClass =
              rank === 1
                ? 'progress__value--rank-1'
                : rank === 2
                ? 'progress__value--rank-2'
                : rank === 3
                ? 'progress__value--rank-3'
                : rank === 4
                ? 'progress__value--rank-last'
                : '';

            return (
              <div
                key={digit}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedDigit(prev => (prev === digit ? null : digit))}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedDigit(prev => (prev === digit ? null : digit));
                  }
                }}
                className={[
                  'digits__digit',
                  isLatestShown ? 'digits__digit--latest' : '',
                  isPurchased ? 'digits__digit--purchased' : '',
                  isSelected ? 'digits__digit--selected' : '',
                  isOuOver ? 'digits__digit--ou-over' : '',
                  isOuUnder ? 'digits__digit--ou-under' : '',
                  mdBarrierFocus && mdBarrierDigit === digit ? 'digits__digit--barrier-target' : '',
                ].join(' ')}
                title={
                  showDigitPcts
                    ? `${digit}: ${count} (${pct.toFixed(4)}%)`
                    : `${digit}: loading last ${ANALYSIS_HISTORY_TICK_COUNT} ticks…`
                }
              >
                <div className="digits__pie-container" aria-hidden>
                  <svg className="digits__pie-progress" viewBox="0 0 56 56">
                    <circle className="progress__bg" cx="28" cy="28" r={22} />
                    <circle
                      className={['progress__value', rankClass].join(' ')}
                      cx="28"
                      cy="28"
                      r={22}
                      strokeDasharray={`${C} ${C}`}
                      strokeDashoffset="0"
                    />
                  </svg>
                </div>

                <div className="digits__digit-value">
                  <div className="digits__digit-display-value">{digit}</div>
                  <div className="digits__digit-display-percentage">
                    {showDigitPcts ? `${pct.toFixed(2)}%` : '…'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ✅ SINGLE PURCHASE BUTTONS (TOP) */}
      <div className="trade-buttons trade-buttons--single-top">
        <button
          className="trade-btn even-btn"
          onClick={() => armOrBuy('left')}
          title={bothMode ? 'Both mode: TWO trades will be placed' : ''}
        >
          <span className="button-icon">{contractIcons[ctypes.left] || null}</span>
          {label(ctypes.left)}
          {bothMode ? ' (Both)' : ''}
        </button>

        <button
          className="trade-btn odd-btn"
          onClick={() => armOrBuy('right')}
          title={bothMode ? 'Both mode: TWO trades will be placed' : ''}
        >
          <span className="button-icon">{contractIcons[ctypes.right] || null}</span>
          {label(ctypes.right)}
          {bothMode ? ' (Both)' : ''}
        </button>
      </div>

      {/* Analysis Sections */}
      <div id="evenOddSection" className="analysis-section" style={{ display: activeMode === 'evenOdd' ? 'block' : 'none' }} />

      <div
        id="overUnderSection"
        className="analysis-section"
        style={{ display: activeMode === 'overUnder' ? 'block' : 'none', minWidth: '100%' }}
      >
        <div className="control-panel">
          <div className="selector-container selector-container--ou-merged">
            <div className="digit-selector" id="overUnderBarrierSelector">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(digit => (
                <button
                  key={`ou-barrier-${digit}`}
                  type="button"
                  className={`digit-btn ou-barrier-btn ${
                    analysisData.overDigit === digit && analysisData.underDigit === digit ? 'active' : ''
                  }`}
                  onClick={() => handleOuBarrierDigitSelect(digit)}
                >
                  {digit}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div
        id="riseFallSection"
        className="analysis-section"
        style={{ display: activeMode === 'riseFall' ? 'block' : 'none', minWidth: '100%' }}
      />

      {/* Panel + stats strip + bulk bar: stats above trading-actions-bar */}
      <div className="trading-container">
        <div className="history-title">Panel</div>

        <div className="trading-panel-layout">
          <div className="trading-panel-layout__contract-settings">
            <div className="trade-control-group execution">
              <label>Execution Mode</label>
              <div className="execution-mode-toggle">
                <button
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: turbo ? 'green' : 'red',
                    borderColor: turbo ? 'green' : 'red',
                    color: '#fff',
                  }}
                  onClick={() => setTurboMode(true)}
                >
                  Turbo
                </button>
                <button
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: !turbo ? 'green' : 'red',
                    borderColor: !turbo ? 'green' : 'red',
                    color: '#fff',
                  }}
                  onClick={() => setTurboMode(false)}
                >
                  Safe
                </button>
              </div>
              {turbo && <div className="execution-mode-warning">⚡ Faster execution: all bulk trades fire at once.</div>}
            </div>

            <div className="trade-controls">
              <div className="trade-control-group market-selector">
                <label>Market</label>
                <select
                  id="tradeMarket"
                  className="trade-input"
                  ref={marketRef}
                  value={currentSymbol}
                  onChange={e => {
                    const newMarket = e.target.value;
                    if (newMarket === BOT_IFRAME_DEBUG_10_1S) {
                      logBotIframe10_1s('market selected (trade panel)', {
                        from: currentSymbol,
                        connectionStatus,
                        hasApi: !!api_base.api,
                        wsReadyState: api_base.api?.connection?.readyState,
                      });
                    }
                    setCurrentSymbol(newMarket);
                    if (marketSelectionRef.current) marketSelectionRef.current.value = newMarket;
                    cancelSingleMatchWaits();
                    pendingAutoRef.current = null;
                    autoBusyRef.current = false;
                  }}
                >
                  <option value="R_10">Vol 10</option>
                  <option value="1HZ10V">Vol 10 (1s)</option>
                  <option value="1HZ15V">Vol 15 (1s)</option>
                  <option value="R_25">Vol 25</option>
                  <option value="1HZ25V">Vol 25 (1s)</option>
                  <option value="1HZ30V">Vol 30 (1s)</option>
                  <option value="R_50">Vol 50</option>
                  <option value="1HZ50V">Vol 50 (1s)</option>
                  <option value="R_75">Vol 75</option>
                  <option value="1HZ75V">Vol 75 (1s)</option>
                  <option value="1HZ90V">Vol 90 (1s)</option>
                  <option value="R_100">Vol 100</option>
                  <option value="1HZ100V">Vol 100 (1s)</option>
                  <option value="JD10">Jump 10</option>
                  <option value="JD25">Jump 25</option>
                  <option value="JD50">Jump 50</option>
                  <option value="JD75">Jump 75</option>
                  <option value="JD100">Jump 100</option>
                </select>
              </div>

              <div className="trade-control-group">
                <label>Strategy</label>
                <select className="trade-input" ref={strategyRef} value={strategy} onChange={e => setStrat(e.target.value)}>
                  <option value="even">Even</option>
                  <option value="odd">Odd</option>
                  <option value="matches">Matches</option>
                  <option value="differs">Differs</option>
                  <option value="over">Over</option>
                  <option value="under">Under</option>

                  <option value="rise">Rise</option>
                  <option value="fall">Fall</option>

                  {/* ✅ NEW */}
                  <option value="onlyups">Only Ups</option>
                  <option value="onlydowns">Only Downs</option>
                  <option value="rise_equals">Rise Equals</option>
                  <option value="fall_equals">Fall Equals</option>
                </select>
              </div>

              <div className="trade-control-group">
                <label>Stake (USD)</label>
                <input type="number" className="trade-input" defaultValue="10" min="1" step="1" ref={stakeRef} />
              </div>

              <div className="trade-control-group">
                <label>Duration (ticks)</label>
                <input type="number" className="trade-input" defaultValue="1" min="1" step="1" ref={durRef} />
              </div>

              <div className="trade-control-group">
                <label>Prediction</label>
                <input
                  type="number"
                  className="trade-input"
                  value={predictionDigit}
                  min="0"
                  max="9"
                  step="1"
                  ref={digitRef}
                  disabled={!needsDigit(strategy)}
                  style={{ backgroundColor: needsDigit(strategy) ? '' : 'gray' }}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === '') {
                      setPredictionDigit('');
                      if (digitRef.current) digitRef.current.value = '';
                      return;
                    }
                    if (/^\d$/.test(v)) {
                      setPredictionDigit(v);
                      if (digitRef.current) digitRef.current.value = v;
                    }
                  }}
                />
              </div>

              <div className="trade-control-group">
                <label>Both</label>
                <button
                  className={`both-toggle ${bothMode ? 'on' : 'off'}`}
                  onClick={() => setBothMode(b => !b)}
                  style={{
                    padding: '.4rem .8rem',
                    background: bothMode ? 'linear-gradient(90deg,#0f9d58,#34a853)' : '#555',
                    color: '#fff',
                    border: '1px solid #222',
                    borderRadius: '4px',
                    fontWeight: 'bold',
                  }}
                  title="When ON, single trade buttons buy both sides simultaneously"
                >
                  {bothMode ? 'ON' : 'OFF'}
                </button>
              </div>

              {/* ✅ Entry switch stays as-is */}
              <div className="trade-control-group">
                <label>Entry</label>
                <button
                  onClick={() => {
                    setAutoOn(v => !v);
                    pendingAutoRef.current = null;
                    autoBusyRef.current = false;
                  }}
                  style={{
                    padding: '.4rem .8rem',
                    background: autoOn ? 'linear-gradient(90deg,#1565c0,#42a5f5)' : '#555',
                    color: '#fff',
                    border: '1px solid #222',
                    borderRadius: '4px',
                    fontWeight: 'bold',
                  }}
                  title="When ON, waits for LIVE tick last digit to match Entry Point then executes armed trade(s)"
                >
                  {autoOn ? 'ON' : 'OFF'}
                </button>
              </div>

              {autoOn && (
                <div className="trade-control-group">
                  <label>Entry Point</label>
                  <input
                    type="text"
                    className="trade-input"
                    value={autoEntryDigit}
                    onChange={e => {
                      const v = e.target.value.trim();

                      // allow clearing
                      if (v === '') {
                        setAutoEntryDigit('');
                        return;
                      }

                      // keep ONLY single digit 0-9
                      if (/^\d$/.test(v)) setAutoEntryDigit(v);
                    }}
                    title="Set a digit (0-9). When armed, trade triggers only when LIVE tick last digit matches."
                  />
                </div>
              )}
            </div>
          </div>

          <div className="trading-panel-layout__results">
            <div className="title">
              <small>Type</small>
              <small>Entry/Exit spot</small>
              <small>Buy price and P/L</small>
            </div>

            <div className="open-positions">
              {trades.length === 0 ? (
                <div className="no-positions">
                  <small>No positions</small>
                </div>
              ) : (
                trades.map(tr => (
                  <div key={tr.id} className={`position-item ${posClass(tr.status)}`}>
                    <div className="position-header">
                      <div className="position-market-contract">
                        {marketIcons[tr.market] || <span>{tr.market}</span>}
                        {contractIcons[tr.contractType] || <span>{label(tr.contractType)}</span>}
                      </div>

                      {tr.status === 'error' && (
                        <div className="error-display">
                          <span className="error-badge" title={tr.errorDetails || 'Trade failed'}>
                            ! {tr.errorReason?.toLowerCase().includes('insufficient') && '💰'}
                          </span>
                          <span className="error-text">{tr.errorReason}</span>
                        </div>
                      )}
                    </div>

                    <div className="position-spots">
                      <div className="spot-entry">
                        <svg width={16} height={16} viewBox="0 0 16 16">
                          <circle cx={8} cy={8} r={6} stroke="#FF4444" strokeWidth={1.5} fill="white" />
                          <circle cx={8} cy={8} r={3} fill="#FF4444" />
                        </svg>
                        {formatTickValue(tr.entryValue, tr.marketFormat)}
                      </div>

                      <div className="spot-exit">
                        <svg width={16} height={16} viewBox="0 0 16 16">
                          <circle cx={8} cy={8} r={6} stroke="#999999" strokeWidth={1.5} fill="white" />
                        </svg>
                        {formatTickValue(tr.exitValue, tr.marketFormat)}
                      </div>
                    </div>

                    <div className="position-footer">
                      <div className="position-stake">{tr.stake.toFixed(2)} USD</div>
                      <div
                        className={`position-result ${
                          tr.status === 'pending'
                            ? 'pending'
                            : tr.status === 'error'
                            ? 'loss'
                            : tr.profit !== undefined
                            ? tr.profit >= 0
                              ? 'profit'
                              : 'loss'
                            : ''
                        }`}
                      >
                        {tr.status === 'pending'
                          ? '...'
                          : tr.status === 'error'
                          ? 'Failed'
                          : tr.profit !== undefined
                          ? `${tr.profit >= 0 ? '+' : ''}${tr.profit.toFixed(2)}`
                          : '—'}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="trading-performance-strip">
        <div className="performance-stats">
          <div className="stat-item">
            <div className="stat-title">Total P/L</div>
            <div className={`stat-value ${profitLoss >= 0 ? 'profit' : 'loss'}`}>
              {profitLoss >= 0 ? '+' : ''}${Math.abs(profitLoss).toFixed(2)} USD
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-title">No. of runs</div>
            <div className="stat-value">{tradeStats.total}</div>
          </div>
          <div className="stat-item">
            <div className="stat-title">Won</div>
            <div className="stat-value profit">{tradeStats.won}</div>
          </div>
          <div className="stat-item">
            <div className="stat-title">Lost</div>
            <div className="stat-value loss">{tradeStats.lost}</div>
          </div>
        </div>
      </div>

      <div className="trading-actions-bar">
        <div className="trading-actions-bar__controls">
          <div className="trade-buttons">
            <button className="trade-btn reset-btn" onClick={handleReset}>
              Reset
            </button>
          </div>

          <div className="trade-control-group">
            <label>Bulk Count</label>
            <input type="number" className="trade-input" defaultValue="1" min="1" step="1" ref={bulkCntRef} />
          </div>

          <div className="trade-buttons">
            <button className="trade-btn even-btn" onClick={() => armOrStartBulk(ctypes.left)}>
              <span className="button-icon">{contractIcons[ctypes.left] || null}</span>
              Bulk {label(ctypes.left)}
            </button>
            <button className="trade-btn odd-btn" onClick={() => armOrStartBulk(ctypes.right)}>
              <span className="button-icon">{contractIcons[ctypes.right] || null}</span>
              Bulk {label(ctypes.right)}
            </button>
            <button className="trade-btn stop-btn" onClick={() => stopBulk()} disabled={!bulk.on}>
              Stop Bulk
            </button>
          </div>
        </div>
      </div>

      {/* History */}
      <div className="history-container">
        <div className="history-title">
          <div className="history-title__main">
            <span className="history-title__label">Analysis Chamber</span>
            {strategy === 'matches' || strategy === 'differs' ? (
              <div className="history-title__legend" aria-label="Match and differ chamber key">
                <span className="history-title__legend-under">green — digit matches prediction</span>
                <span className="history-title__sep"> · </span>
                <span className="history-title__legend-over">red — other digit</span>
              </div>
            ) : activeMode === 'overUnder' ? (
              <div className="history-title__legend" aria-label="Over and under colour key">
                <span className="history-title__legend-under">green - under {analysisData.overDigit}</span>
                <span className="history-title__sep"> · </span>
                <span className="history-title__legend-over">red - over {analysisData.overDigit}</span>
              </div>
            ) : null}
          </div>
          <button className="refresh-btn" id="refreshBtn" onClick={refreshData}>
            <i className="fas fa-sync-alt"></i> Refresh
          </button>
        </div>

        <div
          className="history-items"
          id="lastResults"
          style={{
            display: strategy !== 'matches' && strategy !== 'differs' && activeMode === 'evenOdd' ? 'grid' : 'none',
          }}
        >
          {renderEvenOddHistory()}
        </div>

        <div
          className="history-items"
          id="lastResultsOverUnder"
          style={{
            display: strategy !== 'matches' && strategy !== 'differs' && activeMode === 'overUnder' ? 'grid' : 'none',
          }}
        >
          {renderOverUnderHistory()}
        </div>

        <div
          className="history-items"
          id="lastResultsRiseFall"
          style={{
            display: strategy !== 'matches' && strategy !== 'differs' && activeMode === 'riseFall' ? 'grid' : 'none',
          }}
        >
          {renderRiseFallHistory()}
        </div>

        <div
          className="history-items"
          id="lastResultsMatchDiff"
          style={{ display: strategy === 'matches' || strategy === 'differs' ? 'grid' : 'none' }}
        >
          {renderMatchDiffChamberHistory()}
        </div>
      </div>
    </div>
  );
});

export default BotIframe;
