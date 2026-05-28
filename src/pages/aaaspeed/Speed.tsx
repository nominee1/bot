// src/pages/aaaStrategies/speed/Speed.tsx
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { sendDerivSessionContractPurchase } from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import { api_base } from '@/external/bot-skeleton';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import {
  decideFlipVirtualPair,
  MAX_SESSION_LOSSES,
  ONLY_RUN_MAX_CONSECUTIVE_LOSSES,
  updateAfterFactGovernor,
  type FlipVirtStrategyType,
  type VirtTick,
} from '@/pages/aaflipaa/flipaaVirtualDecision';
import { scheduleCrChanceLedgerRoundTrip } from '@/utils/chanceVirtualStatements';
import {
  ALLOWED_BOT_IFRAME_LOGINID,
  isCrVirtualShadowLogin,
  runWithCrShadowLock,
  tryDebitCrShadowSync,
} from '@/utils/crVirtualBalanceShadow';
import {
  TradeTypesDigitsEvenIcon,
  TradeTypesDigitsOddIcon,
  TradeTypesDigitsMatchesIcon,
  TradeTypesDigitsOverIcon,
  TradeTypesDigitsDiffersIcon,
  SocialYoutubeBlackIcon,
  TradeTypesDigitsUnderIcon,
  LegacyPlayFillIcon,
  TradeTypesUpsAndDownsFallIcon,
  MarketDerivedVolatility1001sIcon,
  MarketDerivedVolatility100Icon,
  MarketDerivedVolatility10Icon,
  MarketDerivedJump100Icon,
  MarketDerivedJump10Icon,
  MarketDerivedJump25Icon,
  MarketDerivedJump50Icon,
  MarketDerivedJump75Icon,
  MarketDerivedVolatility25Icon,
  MarketDerivedVolatility50Icon,
  MarketDerivedVolatility75Icon,
  MarketDerivedVolatility751sIcon,
  MarketDerivedVolatility101sIcon,
  MarketDerivedVolatility251sIcon,
  MarketDerivedVolatility501sIcon,
  MarketDerivedVolatility151sIcon,
  MarketDerivedVolatility301sIcon,
  MarketDerivedVolatility901sIcon,
  TradeTypesUpsAndDownsRiseIcon,
} from '@deriv/quill-icons';

import LazyYouTubeModal from '../aaaStrategies/LazyYoutubeModal/LazyYouTubeModal';
import { flipaaFormatQuoteForDigitContract, flipaaLastDigitFromQuote } from '@/pages/aaflipaa/flipaaTickDigitFormat';
import './Speed.scss';

/** Volatility 10 (1s) — default Speed market. */
const SPEED_DEFAULT_MARKET = '1HZ10V';

type StrategyType =
  | 'even'
  | 'odd'
  | 'over'
  | 'under'
  | 'matches'
  | 'differs'
  | 'rise'
  | 'fall'
  | 'only_up'
  | 'only_down'
  | 'rise_equals'
  | 'fall_equals';

type TradeStatus = 'pending' | 'open' | 'active' | 'won' | 'lost' | 'completed' | 'error';

interface TTrade {
  id: string;
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
  marketFormat?: string;
  temp?: boolean;
  errorReason?: string;
  errorDetails?: string;
  barrier?: number;

  // ✅ virtual hooks
  virtual?: boolean;
  virtualLabel?: string;
}

type TTransaction = { contract_id: string; amount: number; transaction_time: number };

/* ---------- Market/Contract Icons ---------- */
const marketIcons: Record<string, JSX.Element> = {
  '1HZ100V': <MarketDerivedVolatility1001sIcon width={16} height={16} />,
  R_100: <MarketDerivedVolatility100Icon width={16} height={16} />,
  R_10: <MarketDerivedVolatility10Icon width={16} height={16} />,
  R_25: <MarketDerivedVolatility25Icon width={16} height={16} />,
  R_50: <MarketDerivedVolatility50Icon width={16} height={16} />,
  R_75: <MarketDerivedVolatility75Icon width={16} height={16} />,
  JD10: <MarketDerivedJump10Icon width={16} height={16} />,
  JD25: <MarketDerivedJump25Icon width={16} height={16} />,
  JD50: <MarketDerivedJump50Icon width={16} height={16} />,
  JD75: <MarketDerivedJump75Icon width={16} height={16} />,
  JD100: <MarketDerivedJump100Icon width={16} height={16} />,
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

  CALL: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
  PUT: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />,

  CALLE: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
  PUTE: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />,

  RUNHIGH: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
  RUNLOW: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />,
};

/* ---------- Custom Entry/Exit Spot Icons ---------- */
const EntrySpotIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <circle cx={8} cy={8} r={6} stroke="#FF4444" strokeWidth={1.5} fill="white" />
    <circle cx={8} cy={8} r={3} fill="#FF4444" />
  </svg>
);
const ExitSpotIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <circle cx={8} cy={8} r={6} stroke="#999999" strokeWidth={1.5} fill="white" />
  </svg>
);

/* ----- BUY THROTTLE ----- */
const MIN_BUY_GAP_MS = 500;

/* ---------- Helpers ---------- */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const toNum = (v: string) => {
  if (v.trim() === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const clampInt = (v: string, min: number, max: number) => {
  if (v.trim() === '') return 0;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, n));
};

const clampNonNegInt = (v: string, max: number) => {
  if (v.trim() === '') return 0;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(max, n);
};

const formatTickValue = (v?: number, mf?: string) => {
  if (v === undefined) return '—';
  return flipaaFormatQuoteForDigitContract(v, mf || '');
};

const isDigitContract = (ct: string) =>
  ct === 'DIGITOVER' || ct === 'DIGITUNDER' || ct === 'DIGITMATCH' || ct === 'DIGITDIFF';

const minTicksForContract = (ct: string) => {
  if (ct === 'RUNHIGH' || ct === 'RUNLOW') return 2;
  return 1;
};

const ALL_STRATEGIES: StrategyType[] = [
  'even',
  'odd',
  'over',
  'under',
  'matches',
  'differs',
  'rise',
  'fall',
  'only_up',
  'only_down',
  'rise_equals',
  'fall_equals',
];

function contractTypeForStrategyStatic(st: StrategyType): string {
  switch (st) {
    case 'even':
      return 'DIGITEVEN';
    case 'odd':
      return 'DIGITODD';
    case 'over':
      return 'DIGITOVER';
    case 'under':
      return 'DIGITUNDER';
    case 'matches':
      return 'DIGITMATCH';
    case 'differs':
      return 'DIGITDIFF';
    case 'rise':
      return 'CALL';
    case 'fall':
      return 'PUT';
    case 'rise_equals':
      return 'CALLE';
    case 'fall_equals':
      return 'PUTE';
    case 'only_up':
      return 'RUNHIGH';
    case 'only_down':
      return 'RUNLOW';
    default: {
      const _x: never = st;
      return _x;
    }
  }
}

const CONTRACT_TO_STRATEGY: Record<string, StrategyType> = ALL_STRATEGIES.reduce(
  (acc, sk) => {
    acc[contractTypeForStrategyStatic(sk)] = sk;
    return acc;
  },
  {} as Record<string, StrategyType>
);

function contractToStrategyFromCt(ct: string): StrategyType | null {
  return CONTRACT_TO_STRATEGY[ct] ?? null;
}

const isDirectionalDisplayContract = (ct: string) =>
  ct === 'CALL' || ct === 'PUT' || ct === 'CALLE' || ct === 'PUTE' || ct === 'RUNHIGH' || ct === 'RUNLOW';

/* ===== RateLimit backoff helpers ===== */
const parseRetryAfterMs = (message: string): number | null => {
  if (!message) return null;
  let m = message.match(/retry(?:ing)?\s+in\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s)\b/i);
  if (m) return Math.round(Number(m[1]) * 1000);
  m = message.match(/retry\s+after\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s)\b/i);
  if (m) return Math.round(Number(m[1]) * 1000);
  return null;
};

const isRateLimitError = (e: any) => {
  const errObj = e?.error ?? e;
  const code = (errObj?.code ?? '').toString();
  const msg = (errObj?.message ?? '').toString();
  return code === 'RateLimit' || /rate\s*limit|too\s*many\s*requests|throttl/i.test(msg);
};

/* ===== Virtual hook config ===== */
type VirtualMode = 'wins' | 'losses';

/* ===== Entry pattern helpers ===== */
const normalizePattern = (s: string) => (s || '').replace(/\D/g, '').slice(0, 12);
const patternDigits = (s: string) => normalizePattern(s).split('').map(d => Number(d)).filter(n => Number.isFinite(n));

const endsWithPattern = (windowDigits: number[], patt: number[]) => {
  if (!patt.length) return true;
  if (windowDigits.length < patt.length) return false;
  for (let i = 0; i < patt.length; i++) {
    if (windowDigits[windowDigits.length - patt.length + i] !== patt[i]) return false;
  }
  return true;
};

export default function MultiStrategyBot() {
  const { client } = useStore() ?? {};
  const { activeLoginid, tradingSocketGeneration } = useApiBase();
  const activeLoginidRef = useRef<string | undefined>(undefined);
  const clientRef = useRef(client);
  clientRef.current = client;
  useEffect(() => {
    activeLoginidRef.current = activeLoginid;
  }, [activeLoginid]);
  /* ===== Inputs ===== */
  const [isRunning, setIsRunning] = useState(false);
  const [market, setMarket] = useState(SPEED_DEFAULT_MARKET);

  const [stakeStr, setStakeStr] = useState('10');
  const [martingaleStr, setMartingaleStr] = useState('1.25');
  const [paramStr, setParamStr] = useState('2');
  const [tpStr, setTpStr] = useState('10');
  const [slStr, setSlStr] = useState('40');

  const [strategy, setStrategy] = useState<StrategyType>('over');
  const [ticks, setTicks] = useState(1);

  // ✅ Virtual hooks (DEFAULT = virtual wins)
  const [virtualMode, setVirtualMode] = useState<VirtualMode>('wins');
  const [virtualCountStr, setVirtualCountStr] = useState('3');
  const [martingaleDelayStr, setMartingaleDelayStr] = useState('0');
  const [entryPatternStr, setEntryPatternStr] = useState('');

  // ✅ one input: return-to-virtual threshold
  const [returnToVirtualStr, setReturnToVirtualStr] = useState('1');

  // Derived
  const stakeInput = toNum(stakeStr);
  const martingaleInput = toNum(martingaleStr);
  const param = clampInt(paramStr, 0, 9);
  const tpInput = toNum(tpStr);
  const slInput = toNum(slStr);

  const virtualTarget = clampNonNegInt(virtualCountStr, 999);
  const martingaleDelay = clampNonNegInt(martingaleDelayStr, 999);
  const entryPatternClean = normalizePattern(entryPatternStr);

  const returnToVirtual = clampNonNegInt(returnToVirtualStr, 999);

  const [ytOpen, setYtOpen] = useState(false);
  const YT_URL = 'https://youtu.be/lJZO89NS78Q?si=Z_jJLcS1uTTXmNA6';

  /* ===== Trades & status ===== */
  const [trades, setTrades] = useState<TTrade[]>([]);
  const [msg, setMsg] = useState<{ txt: string; type: 'info' | 'success' | 'error' | 'loading' | 'warning' }>({
    txt: '',
    type: 'info',
  });
  const [profitLoss, setPL] = useState(0);
  const [sessionPL, setSessionPL] = useState(0);
  const sessionPLRef = useRef(0);

  // ✅ latest trades ref (fixes TP miscalc caused by stale closure in transaction handler)
  const tradesRef = useRef<TTrade[]>([]);
  useEffect(() => {
    tradesRef.current = trades;
  }, [trades]);

  // ✅ virtual counters UI
  const [vWinsUI, setVWinsUI] = useState(0);
  const [vLossesUI, setVLossesUI] = useState(0);
  const [readyForRealUI, setReadyForRealUI] = useState(false);

  // ✅ recovery UI
  const [recoveryUI, setRecoveryUI] = useState<{ on: boolean; wins: number; losses: number }>({
    on: false,
    wins: 0,
    losses: 0,
  });

  /* ===== Tick stream refs ===== */
  const wsRef = useRef<WebSocket | null>(null);
  const lastEpochRef = useRef<number | null>(null);
  const digitWindowRef = useRef<number[]>([]);

  /* ===== Sequential anti-slip ref ===== */
  const buyPendingRef = useRef(false);

  /* ===== Martingale refs (REAL ONLY) ===== */
  const ladderRef = useRef<number[]>([]);
  const consecutiveRealLossesRef = useRef(0);
  const stakeIndexRef = useRef(0);
  const nextStakeRef = useRef(2);

  /* ===== Virtual readiness refs ===== */
  const vWinsRef = useRef(0);
  const vLossesRef = useRef(0);
  const readyForRealRef = useRef(false);

  /* ===== Recovery mode refs ===== */
  const recoveryRef = useRef<{ on: boolean; wins: number; losses: number }>({ on: false, wins: 0, losses: 0 });

  /* ===== Virtual settlement waiting ===== */
  const awaitingVirtualRef = useRef<null | { tradeId: string; entryPrice: number; remaining: number; dur: number }>(
    null
  );

  /* ─── CR7557018 shadow: Flipaa-style virtual tick buffer + after-fact decision (post-hook only) ─── */
  const virtTickBufferRef = useRef<VirtTick[]>([]);
  const virtTickWsRef = useRef<WebSocket | null>(null);
  const virtTickEpochRef = useRef<number | null>(null);
  const virtTickMktRef = useRef<string>('');

  const sessionLossesVirtRef = useRef(0);
  const afterFactSuppressedRef = useRef(false);
  const afterFactWinStreakRef = useRef(0);
  const naturalLossStreakRef = useRef(0);
  const onlyRunLossStreakVirtRef = useRef<{ only_up: number; only_down: number }>({ only_up: 0, only_down: 0 });

  /* ===== Real settle gating (sequential) ===== */
  const inFlightRealRef = useRef<string | null>(null);

  const settleRequiredForStrategy = useCallback((st: StrategyType) => {
    return (
      st === 'rise' ||
      st === 'fall' ||
      st === 'rise_equals' ||
      st === 'fall_equals' ||
      st === 'only_up' ||
      st === 'only_down'
    );
  }, []);

  /* ===== Running/Stop guards ===== */
  const isRunningRef = useRef(false);
  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  const stopRequestedRef = useRef(false);
  const settledContractsRef = useRef<Set<string>>(new Set());

  /* ===== Locked runtime config ===== */
  const locked = useRef({
    S: 2,
    M: 2,
    strat: 'even' as StrategyType,
    param: 4,
    market: SPEED_DEFAULT_MARKET,
    ticks: 1,
    tp: 0,
    sl: 0,

    // ✅ default virtual wins
    vMode: 'wins' as VirtualMode,
    vTarget: 0,
    mDelay: 0,
    entryPatternDigits: [] as number[],
    entryPatternStr: '',

    returnToVirtual: 1,
  });

  /* 🔒 Buy throttle clock */
  const lastBuyTsRef = useRef<number>(0);

  /* ✅ GLOBAL RateLimit backoff */
  const rateLimitRef = useRef<{ until: number; attempt: number; lastMsg: string }>({
    until: 0,
    attempt: 0,
    lastMsg: '',
  });

  const waitForRateLimitBackoff = useCallback(async () => {
    const now = Date.now();
    if (now < rateLimitRef.current.until) {
      await sleep(rateLimitRef.current.until - now);
    }
  }, []);

  const applyRateLimitBackoff = useCallback(async (err: any) => {
    const errObj = err?.error ?? err;
    const msgText = (errObj?.message ?? 'Rate limit').toString();

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

    const sec = Math.max(1, Math.ceil((waitMs + jitter) / 1000));
    setMsg({ txt: `⏳ Rate limit detected — backing off ~${sec}s`, type: 'warning' });

    await sleep(waitMs + jitter);
  }, []);

  const clearRateLimitBackoff = useCallback(() => {
    rateLimitRef.current.attempt = 0;
    rateLimitRef.current.until = 0;
    rateLimitRef.current.lastMsg = '';
  }, []);

  /* ─── Flipaa-aligned virtual tick stream for CR7557018 shadow fills ─── */
  const closeVirtFlipTickWs = useCallback(() => {
    if (virtTickWsRef.current) {
      try {
        virtTickWsRef.current.onopen = null;
        virtTickWsRef.current.onmessage = null;
        virtTickWsRef.current.onerror = null;
        virtTickWsRef.current.onclose = null;
        virtTickWsRef.current.close();
      } catch {
        /* ignore */
      }
      virtTickWsRef.current = null;
    }
    virtTickEpochRef.current = null;
    virtTickMktRef.current = '';
  }, []);

  const openVirtFlipTickWs = useCallback(
    (symbol: string) => {
      closeVirtFlipTickWs();
      virtTickBufferRef.current = [];
      virtTickMktRef.current = symbol;

      const app_id = 1089;
      const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);
      virtTickWsRef.current = ws;

      ws.onopen = async () => {
        try {
          const seed = await api_base.api.send({
            ticks_history: symbol,
            count: 2,
            end: 'latest',
            start: 1,
            adjust_start_time: 1,
          });
          if (seed?.history?.prices?.length && seed?.history?.times?.length) {
            const prices = seed.history.prices.map(Number);
            const times = seed.history.times.map(Number);
            for (let i = 0; i < prices.length; i++) {
              virtTickBufferRef.current.push({ epoch: times[i], quote: prices[i] });
            }
            virtTickEpochRef.current = times[times.length - 1] ?? null;
          }
        } catch {
          /* ignore */
        }
        try {
          ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        } catch {
          /* ignore */
        }
      };

      ws.onmessage = (evt: MessageEvent) => {
        if (!isRunningRef.current) return;
        try {
          const d = JSON.parse(evt.data);
          if (d?.error || !d?.tick?.quote || !d?.tick?.epoch) return;
          const q = Number(d.tick.quote);
          const ep = Number(d.tick.epoch);
          if (virtTickEpochRef.current === ep) return;
          virtTickEpochRef.current = ep;
          virtTickBufferRef.current.push({ epoch: ep, quote: q });
          const buf = virtTickBufferRef.current;
          if (buf.length > 600) buf.splice(0, buf.length - 600);
        } catch {
          /* ignore */
        }
      };
      ws.onerror = () => {};
      ws.onclose = () => {};
    },
    [closeVirtFlipTickWs]
  );

  const ensureVirtTicksForMarket = useCallback(
    async (symbol: string) => {
      if (virtTickMktRef.current !== symbol || !virtTickWsRef.current) {
        openVirtFlipTickWs(symbol);
      }
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        if (virtTickBufferRef.current.length >= 2) return;
        await sleep(25);
      }
      throw new Error('virtual-tick-timeout');
    },
    [openVirtFlipTickWs]
  );

  useEffect(() => {
    if (!isRunning || !isCrVirtualShadowLogin(activeLoginid)) {
      closeVirtFlipTickWs();
      virtTickBufferRef.current = [];
    }
    return () => closeVirtFlipTickWs();
  }, [isRunning, activeLoginid, closeVirtFlipTickWs]);

  /* ===== Account-switch safe ===== */
  const [apiEpoch, setApiEpoch] = useState(0);
  useEffect(() => {
    const api = api_base.api;
    const conn = (api as any)?.connection;
    if (!conn) return;

    const bump = () => setApiEpoch(x => x + 1);
    conn.addEventListener('open', bump);
    conn.addEventListener('close', bump);

    return () => {
      try {
        conn.removeEventListener('open', bump);
      } catch {}
      try {
        conn.removeEventListener('close', bump);
      } catch {}
    };
  }, [tradingSocketGeneration]);

  /* ===== API readiness + throttle ===== */
  const ensureApiReady = useCallback(async () => {
    const OPEN = 1 as const;
    const conn = (api_base.api as any)?.connection;
    if (!conn || conn.readyState !== OPEN) {
      await api_base.init(true);
    }
  }, []);

  const waitForThrottleGap = useCallback(async () => {
    const now = Date.now();
    const delta = now - (lastBuyTsRef.current || 0);
    if (delta < MIN_BUY_GAP_MS) await sleep(MIN_BUY_GAP_MS - delta);
    lastBuyTsRef.current = Date.now();
  }, []);

  const getProposal = useCallback(
    async (ct: string, mkt: string, dur: number, stake: number, barrier?: number) => {
      const resp = await api_base.api.send({
        proposal: 1,
        amount: stake,
        basis: 'stake',
        currency: 'USD',
        contract_type: ct,
        duration: dur,
        duration_unit: 't',
        symbol: mkt,
        ...(typeof barrier === 'number' ? { barrier: String(barrier) } : {}),
      });
      if (resp?.error) throw resp.error;
      const p = resp.proposal;
      const ask = Number(p.ask_price ?? stake);
      const payout = Number(p.payout ?? stake * 1.95);
      return { ask, payout };
    },
    []
  );

  const setStatus = useCallback(
    (txt: string, type: 'info' | 'success' | 'error' | 'loading' | 'warning' = 'info') => setMsg({ txt, type }),
    []
  );

  const buildLadder = useCallback((S: number, M: number) => {
    const arr: number[] = [];
    for (let k = 0; k <= 7; k++) arr.push(Number((S * Math.pow(M, k)).toFixed(2)));
    return arr;
  }, []);

  const createTempTrade = useCallback((ct: string, stake: number, mkt: string, dur: number, barrier?: number) => {
    const id = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const t: TTrade = {
      id,
      contractType: ct,
      stake,
      market: mkt,
      duration: dur,
      status: 'pending',
      timestamp: new Date(),
      marketFormat: mkt,
      temp: true,
      barrier,
      virtual: false,
    };
    setTrades(prev => [t, ...prev]);
    return id;
  }, []);

  const createVirtualTrade = useCallback((ct: string, stake: number, mkt: string, dur: number, barrier?: number) => {
    const id = `vtmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const t: TTrade = {
      id,
      contractType: ct,
      stake,
      market: mkt,
      duration: dur,
      status: 'open',
      timestamp: new Date(),
      marketFormat: mkt,
      temp: false,
      barrier,
      virtual: true,
      virtualLabel: 'Virtual Hook',
    };
    setTrades(prev => [t, ...prev]);
    return id;
  }, []);

  const getBalanceError = useCallback((e: any) => {
    const errorObj = e?.error ?? e;
    const message = (errorObj?.message || 'Unknown error').toString();
    const code = errorObj?.code || '';
    const isBalanceError =
      code === 'InsufficientBalance' || /insufficient|balance|fund|not enough|no enough|low balance/i.test(message);
    return { isBalanceError, message };
  }, []);

  const contractFor = useCallback((st: StrategyType) => {
    switch (st) {
      case 'even':
        return 'DIGITEVEN';
      case 'odd':
        return 'DIGITODD';
      case 'over':
        return 'DIGITOVER';
      case 'under':
        return 'DIGITUNDER';
      case 'matches':
        return 'DIGITMATCH';
      case 'differs':
        return 'DIGITDIFF';
      case 'rise':
        return 'CALL';
      case 'fall':
        return 'PUT';
      case 'rise_equals':
        return 'CALLE';
      case 'fall_equals':
        return 'PUTE';
      case 'only_up':
        return 'RUNHIGH';
      case 'only_down':
        return 'RUNLOW';
      default: {
        const _x: never = st;
        return _x;
      }
    }
  }, []);

  /* ===== HARD STOP ===== */
  const hardStop = useCallback(
    (reason: 'tp' | 'sl' | 'manual') => {
      stopRequestedRef.current = true;
      isRunningRef.current = false;
      setIsRunning(false);

      awaitingVirtualRef.current = null;
      closeVirtFlipTickWs();
      inFlightRealRef.current = null;
      buyPendingRef.current = false;

      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }

      if (reason === 'manual') setStatus('Bot stopped', 'info');
    },
    [closeVirtFlipTickWs, setStatus]
  );

  /* ===== Session P/L apply + TP/SL enforce ===== */
  const applyPnLAndMaybeStop = useCallback(
    (delta: number) => {
      const next = Number((sessionPLRef.current + delta).toFixed(2));
      sessionPLRef.current = next;
      setSessionPL(next);

      const { tp, sl } = locked.current;

      if (!stopRequestedRef.current && isRunningRef.current) {
        if (tp > 0 && next >= tp) {
          stopRequestedRef.current = true;
          setStatus(`🎉 Take Profit hit: +$${next.toFixed(2)} (session)`, 'success');
          hardStop('tp');
          return;
        }
        if (sl > 0 && -next >= sl) {
          stopRequestedRef.current = true;
          setStatus(`🛑 Stop Loss hit: -$${Math.abs(next).toFixed(2)} (session)`, 'error');
          hardStop('sl');
          return;
        }
      }
    },
    [hardStop, setStatus]
  );

  /* ===== Martingale apply (REAL ONLY) ===== */
  const applyRealStakeProgression = useCallback((realLoss: boolean) => {
    if (realLoss) consecutiveRealLossesRef.current += 1;
    else consecutiveRealLossesRef.current = 0;

    const delay = locked.current.mDelay || 0;
    const effective = Math.max(0, consecutiveRealLossesRef.current - delay);

    stakeIndexRef.current = Math.min(7, effective);
    nextStakeRef.current = ladderRef.current[stakeIndexRef.current] ?? ladderRef.current[0] ?? 0;
  }, []);

  /* ===== Virtual streak + readiness (NO martingale changes here) ===== */
  const applyVirtualStreak = useCallback((virtualLoss: boolean) => {
    const mode = locked.current.vMode;
    const target = locked.current.vTarget;

    if (mode === 'wins') {
      if (!virtualLoss) vWinsRef.current += 1;
      else vWinsRef.current = 0;
    } else {
      if (virtualLoss) vLossesRef.current += 1;
      else vLossesRef.current = 0;
    }

    const ready = target > 0 && (mode === 'wins' ? vWinsRef.current >= target : vLossesRef.current >= target);
    readyForRealRef.current = ready;

    setVWinsUI(vWinsRef.current);
    setVLossesUI(vLossesRef.current);
    setReadyForRealUI(ready);
  }, []);

  const resetVirtualCycle = useCallback(() => {
    vWinsRef.current = 0;
    vLossesRef.current = 0;
    readyForRealRef.current = locked.current.vTarget <= 0;
    setVWinsUI(0);
    setVLossesUI(0);
    setReadyForRealUI(readyForRealRef.current);
  }, []);

  /* ===== Recovery mode (REAL outcomes only) ===== */
  const updateRecoveryOnRealOutcome = useCallback(
    (isWin: boolean) => {
      if (locked.current.vTarget <= 0) return;

      // Enter recovery ONLY on a real loss
      if (!recoveryRef.current.on && !isWin) {
        recoveryRef.current.on = true;
        recoveryRef.current.wins = 0;
        recoveryRef.current.losses = 0;
        setRecoveryUI({ ...recoveryRef.current });
        return;
      }

      // If not in recovery and it's a win => return to virtual immediately
      if (!recoveryRef.current.on && isWin) {
        resetVirtualCycle();
        setRecoveryUI({ ...recoveryRef.current });
        return;
      }

      // If in recovery, count outcomes
      if (recoveryRef.current.on) {
        if (isWin) recoveryRef.current.wins += 1;
        else recoveryRef.current.losses += 1;

        const r = locked.current.returnToVirtual || 0;

        if (r > 0) {
          const exit = recoveryRef.current.wins >= r; // ✅ always REAL wins
          if (exit) {
            recoveryRef.current.on = false;
            recoveryRef.current.wins = 0;
            recoveryRef.current.losses = 0;
            resetVirtualCycle();
          }
        }

        setRecoveryUI({ ...recoveryRef.current });
      }
    },
    [resetVirtualCycle]
  );

  /* ===== BUY (REAL) ===== */
  const buyContract = useCallback(
    async (stake: number) => {
      if (!isRunningRef.current || stopRequestedRef.current) return null;
      if (isCrVirtualShadowLogin(activeLoginidRef.current)) return null;

      const ct = contractFor(locked.current.strat);
      const mkt = locked.current.market;

      let dur = locked.current.ticks;
      dur = Math.max(dur, minTicksForContract(ct));

      const needsBarrier = isDigitContract(ct);
      const barrier =
        needsBarrier &&
        (locked.current.strat === 'over' ||
          locked.current.strat === 'under' ||
          locked.current.strat === 'matches' ||
          locked.current.strat === 'differs')
          ? Number(locked.current.param)
          : undefined;

      try {
        await ensureApiReady();
        if (!isRunningRef.current || stopRequestedRef.current) return null;

        await waitForThrottleGap();
        if (!isRunningRef.current || stopRequestedRef.current) return null;

        await waitForRateLimitBackoff();
        if (!isRunningRef.current || stopRequestedRef.current) return null;

        const MAX_RL_RETRIES = 8;
        let tmpID: string | null = null;

        for (let attempt = 0; attempt <= MAX_RL_RETRIES; attempt++) {
          if (!isRunningRef.current || stopRequestedRef.current) {
            if (tmpID) setTrades(ts => ts.filter(t => t.id !== tmpID));
            return null;
          }

          if (!tmpID) tmpID = createTempTrade(ct, stake, mkt, dur, barrier);

          try {
            const resp = (await sendDerivSessionContractPurchase(d => api_base.api!.send(d) as Promise<unknown>, {
              contract_type: ct,
              market: mkt,
              duration: dur,
              stake,
              ...(typeof barrier === 'number' ? { barrier: String(barrier) } : {}),
            })) as { error?: unknown; buy?: { contract_id?: unknown } };

            if (resp?.error) throw resp;

            clearRateLimitBackoff();
            if (stopRequestedRef.current) return null;

            const cidRaw = resp.buy?.contract_id;
            if (cidRaw == null || cidRaw === '') throw new Error('No contract_id in buy response');
            const realID = String(cidRaw);

            setTrades(ts =>
              ts.map(t => (t.id === tmpID ? { ...t, id: realID, temp: false, status: 'open', barrier } : t))
            );

            setStatus('✅ Trade placed', 'success');
            return realID;
          } catch (e: any) {
            if (isRateLimitError(e) && attempt < MAX_RL_RETRIES) {
              await applyRateLimitBackoff(e);
              if (!isRunningRef.current || stopRequestedRef.current) {
                if (tmpID) setTrades(ts => ts.filter(t => t.id !== tmpID));
                return null;
              }
              await waitForRateLimitBackoff();
              continue;
            }

            const { isBalanceError, message } = getBalanceError(e);

            if (tmpID) {
              setTrades(ts =>
                ts.map(t =>
                  t.id === tmpID
                    ? {
                        ...t,
                        status: 'error',
                        temp: false,
                        errorReason: isBalanceError ? 'Insufficient balance' : 'Trade failed',
                        errorDetails: message,
                        closeTime: new Date(),
                      }
                    : t
                )
              );
            }

            setStatus(message || 'Trade failed', 'error');
            return null;
          }
        }

        setStatus('Rate limit retries exhausted', 'error');
        return null;
      } catch {
        return null;
      }
    },
    [
      applyRateLimitBackoff,
      contractFor,
      createTempTrade,
      ensureApiReady,
      getBalanceError,
      setStatus,
      waitForRateLimitBackoff,
      waitForThrottleGap,
      clearRateLimitBackoff,
    ]
  );

  /* ===== Real settlement handler: outcome drives martingale + recovery ===== */
  const onRealSettled = useCallback(
    (cid: string, net: number) => {
      const isWin = net >= 0;
      const isLoss = !isWin;

      applyRealStakeProgression(isLoss);
      updateRecoveryOnRealOutcome(isWin);

      if (inFlightRealRef.current === cid) inFlightRealRef.current = null;
    },
    [applyRealStakeProgression, updateRecoveryOnRealOutcome]
  );

  /** CR7557018 post-hook: same pipeline as Flipaa `completeVirtualFlipTrade` (virtual ticks + after-fact). */
  const completeSpeedCrShadowTrade = useCallback(
    async (args: {
      ct: string;
      stake: number;
      mkt: string;
      dur: number;
      barrier: number | undefined;
    }): Promise<boolean> => {
      const { ct, stake, mkt, dur, barrier } = args;
      const loginid = activeLoginidRef.current;
      const cli = clientRef.current;
      if (!loginid || !isCrVirtualShadowLogin(loginid) || !cli) return false;

      const settleRequired = settleRequiredForStrategy(locked.current.strat);

      await ensureApiReady();
      if (!isRunningRef.current || stopRequestedRef.current) return false;
      await waitForThrottleGap();
      if (!isRunningRef.current || stopRequestedRef.current) return false;
      await waitForRateLimitBackoff();
      if (!isRunningRef.current || stopRequestedRef.current) return false;

      try {
        await ensureVirtTicksForMarket(mkt);
      } catch {
        setStatus('Shadow trade failed — virtual tick stream timeout', 'error');
        return false;
      }

      const st = contractToStrategyFromCt(ct);
      if (!st) {
        setStatus('Shadow trade failed — unknown contract', 'error');
        return false;
      }

      let quote: { ask: number; payout: number };
      try {
        quote = await getProposal(ct, mkt, dur, stake, barrier);
      } catch (e: any) {
        if (isRateLimitError(e)) await applyRateLimitBackoff(e);
        setStatus(String(e?.message ?? e ?? 'Proposal failed'), 'error');
        return false;
      }

      const decision = await decideFlipVirtualPair(
        {
          isRunningRef,
          tickBufferRef: virtTickBufferRef,
          sessionLossesRef: sessionLossesVirtRef,
          afterFactSuppressedRef,
          afterFactWinStreakRef,
          naturalLossStreakRef,
          onlyRunLossStreakRef: onlyRunLossStreakVirtRef,
        },
        st as FlipVirtStrategyType,
        typeof barrier === 'number' ? barrier : undefined,
        dur,
        mkt
      );

      if (!decision.decided) {
        setStatus('Shadow trade failed — could not resolve virtual outcome', 'error');
        return false;
      }

      const ask = Number(quote.ask);
      const payout = Number(quote.payout);

      const debitOk = await runWithCrShadowLock(() => tryDebitCrShadowSync(cli, ALLOWED_BOT_IFRAME_LOGINID, ask));
      if (!debitOk) {
        setStatus('Insufficient shadow balance for this stake.', 'error');
        return false;
      }

      const scrId = `scr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const net = decision.win ? payout - ask : -ask;

      const isDir = isDirectionalDisplayContract(ct);
      const isOneTick = Number(dur || 1) === 1;
      const entryShown = isDir ? decision.entry : isOneTick ? decision.exit : decision.entry;
      const exitShown = decision.exit;

      setTrades(prev => [
        {
          id: scrId,
          contractType: ct,
          stake,
          market: mkt,
          duration: dur,
          status: net >= 0 ? 'won' : 'lost',
          timestamp: new Date(),
          marketFormat: mkt,
          temp: false,
          virtual: false,
          barrier,
          profit: Number(net.toFixed(2)),
          entryValue: entryShown.quote,
          exitValue: exitShown.quote,
          startTime: new Date(entryShown.epoch * 1000),
          closeTime: new Date(exitShown.epoch * 1000),
          currentValue: exitShown.quote,
        },
        ...prev,
      ]);

      updateAfterFactGovernor(
        {
          afterFactSuppressedRef,
          afterFactWinStreakRef,
          naturalLossStreakRef,
        },
        st as FlipVirtStrategyType,
        decision.sourceMode ?? 'natural',
        net
      );

      if (net < 0) {
        sessionLossesVirtRef.current = Math.min(MAX_SESSION_LOSSES, sessionLossesVirtRef.current + 1);
      }

      if (st === 'only_up' || st === 'only_down') {
        if (net >= 0) onlyRunLossStreakVirtRef.current[st] = 0;
        else {
          onlyRunLossStreakVirtRef.current[st] = Math.min(
            ONLY_RUN_MAX_CONSECUTIVE_LOSSES,
            onlyRunLossStreakVirtRef.current[st] + 1
          );
        }
      }

      scheduleCrChanceLedgerRoundTrip({
        client: cli,
        walletLoginId: loginid,
        ask,
        settlementCredit: decision.win ? payout : 0,
        entryEpochSec: entryShown.epoch,
        exitEpochSec: exitShown.epoch,
      });

      applyPnLAndMaybeStop(net);

      if (locked.current.vTarget > 0 || settleRequired) inFlightRealRef.current = scrId;
      onRealSettled(scrId, net);

      clearRateLimitBackoff();
      setStatus('✅ Trade placed', 'success');
      return true;
    },
    [
      applyPnLAndMaybeStop,
      applyRateLimitBackoff,
      clearRateLimitBackoff,
      ensureApiReady,
      ensureVirtTicksForMarket,
      getProposal,
      onRealSettled,
      settleRequiredForStrategy,
      setStatus,
      waitForRateLimitBackoff,
      waitForThrottleGap,
    ]
  );

  /* ===== POC / TX settlement ===== */
  useEffect(() => {
    const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
      if (data?.error) return;

      if (data?.msg_type === 'proposal_open_contract') {
        const c = data.proposal_open_contract;
        const cid = String(c.contract_id);

        setTrades(prev =>
          prev.map(tr => {
            if (tr.id !== cid) return tr;

            const next: TTrade = { ...tr };

            if (!next.startTime && c.entry_tick_time) {
              next.startTime = new Date(c.entry_tick_time * 1000);
              next.entryValue = c.entry_tick ? Number(c.entry_tick) : next.entryValue;
            }

            if (c.tick_count && c.current_tick) next.ticksRemaining = c.tick_count - c.current_tick;
            next.currentValue = c.current_spot ? Number(c.current_spot) : next.currentValue;

            const finished = c.is_sold || c.is_expired || c.is_settleable || c.status === 'sold';
            if (finished) {
              const net = Number(c.profit ?? 0);
              next.status = net >= 0 ? 'won' : 'lost';
              next.profit = net;
              next.closeTime = new Date();
              next.exitValue = c.exit_tick ? Number(c.exit_tick) : next.exitValue;
            } else {
              next.status = (c.status as TradeStatus) || 'active';
            }

            return next;
          })
        );

        const finished = c.is_sold || c.is_expired || c.is_settleable || c.status === 'sold';
        if (finished && !settledContractsRef.current.has(cid)) {
          settledContractsRef.current.add(cid);
          const net = Number(c.profit ?? 0);
          applyPnLAndMaybeStop(net);
          onRealSettled(cid, net);
        }
      }

      if (data?.msg_type === 'transaction' && data.transaction?.action === 'sell') {
        const tx: TTransaction = data.transaction;
        const cid = String(tx.contract_id);

        setTrades(prev =>
          prev.map(tr => {
            if (tr.id !== cid) return tr;
            if (tr.profit !== undefined) return tr;

            const net = Number(tx.amount) - tr.stake;
            return {
              ...tr,
              status: net >= 0 ? 'won' : 'lost',
              profit: net,
              closeTime: new Date(tx.transaction_time * 1000),
            };
          })
        );

        if (!settledContractsRef.current.has(cid)) {
          settledContractsRef.current.add(cid);

          // ✅ use latest trades ref to avoid stake=0 (stale closure)
          const tr = tradesRef.current.find(t => String(t.id) === cid);
          const stake = tr?.stake ?? 0;
          const net = Number(tx.amount) - stake;

          applyPnLAndMaybeStop(net);
          onRealSettled(cid, net);
        }
      }
    });

    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiEpoch, tradingSocketGeneration, applyPnLAndMaybeStop, onRealSettled]);

  /* ===== Aggregate P/L ===== */
  useEffect(() => {
    setPL(trades.reduce((s, t) => s + (t.profit ?? 0), 0));
  }, [trades]);

  /* ===== Last digit ===== */
  const getLastDigit = useCallback((price: number, mkt: string) => flipaaLastDigitFromQuote(price, mkt), []);

  /* ===== Virtual loss eval ===== */
  const evalVirtualIsLoss = useCallback((lastDigit: number, price: number, entryPrice: number) => {
    const st = locked.current.strat;
    switch (st) {
      case 'even':
        return lastDigit % 2 !== 0;
      case 'odd':
        return lastDigit % 2 === 0;
      case 'over':
        return lastDigit <= locked.current.param;
      case 'under':
        return lastDigit >= locked.current.param;
      case 'matches':
        return lastDigit !== locked.current.param;
      case 'differs':
        return lastDigit === locked.current.param;

      case 'rise':
      case 'only_up':
        return price <= entryPrice;

      case 'fall':
      case 'only_down':
        return price >= entryPrice;

      case 'rise_equals':
        return price < entryPrice;

      case 'fall_equals':
        return price > entryPrice;
    }
  }, []);

  /* ===== Main tick loop ===== */
  useEffect(() => {
    if (!isRunning) {
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
      return;
    }

    stopRequestedRef.current = false;

    const app_id = 36300;
    const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isRunningRef.current) return;
      ws.send(JSON.stringify({ ticks: locked.current.market, subscribe: 1 }));
    };

    ws.onmessage = async ev => {
      if (!isRunningRef.current || stopRequestedRef.current) return;

      const d = JSON.parse(ev.data);
      if (d?.error) return;
      if (!d?.tick?.quote || !d?.tick?.epoch) return;

      const price = Number(d.tick.quote);
      const epoch = Number(d.tick.epoch);
      if (lastEpochRef.current === epoch) return;
      lastEpochRef.current = epoch;

      const lastDigit = getLastDigit(price, locked.current.market);

      // ✅ update digit window
      digitWindowRef.current.push(lastDigit);
      const keep = Math.max(locked.current.entryPatternDigits.length || 0, 12);
      if (digitWindowRef.current.length > keep) {
        digitWindowRef.current.splice(0, digitWindowRef.current.length - keep);
      }

      // ✅ score virtual outcome (duration-aware)
      if (awaitingVirtualRef.current) {
        const a = awaitingVirtualRef.current;
        a.remaining -= 1;

        if (a.remaining <= 0) {
          const loss = evalVirtualIsLoss(lastDigit, price, a.entryPrice);

          const deciding = price;
          const entryShown = a.dur === 1 ? deciding : a.entryPrice;
          const exitShown = deciding;

          setTrades(prev =>
            prev.map(tr =>
              tr.id === a.tradeId
                ? {
                    ...tr,
                    status: loss ? 'lost' : 'won',
                    profit: 0,
                    closeTime: new Date(),
                    entryValue: entryShown,
                    exitValue: exitShown,
                    currentValue: deciding,
                  }
                : tr
            )
          );

          applyVirtualStreak(loss);
          awaitingVirtualRef.current = null;
        } else {
          setTrades(prev => prev.map(tr => (tr.id === a.tradeId ? { ...tr, currentValue: price } : tr)));
        }
      }

      if (!isRunningRef.current || stopRequestedRef.current) return;

      // ✅ entry trigger
      const patt = locked.current.entryPatternDigits;
      const triggered = endsWithPattern(digitWindowRef.current, patt);
      if (!triggered) return;

      // ✅ SEQUENTIAL MODE to eliminate slips when Virtual Hooks enabled
      const sequentialMode = locked.current.vTarget > 0;
      if (sequentialMode) {
        if (awaitingVirtualRef.current) return;
        if (inFlightRealRef.current) return;
        if (buyPendingRef.current) return;
      }

      // settle-required: (still needed for "no virtual hooks" mode)
      const settleRequired = settleRequiredForStrategy(locked.current.strat);

      // ✅ Virtual vs Real decision
      const wantVirtualHooks = locked.current.vTarget > 0;
      const inRecovery = recoveryRef.current.on;

      const canPlaceVirtual = wantVirtualHooks && !inRecovery && !readyForRealRef.current;

      const ct = contractFor(locked.current.strat);
      let dur = locked.current.ticks;
      dur = Math.max(dur, minTicksForContract(ct));

      const needsBarrier = isDigitContract(ct);
      const barrier =
        needsBarrier &&
        (locked.current.strat === 'over' ||
          locked.current.strat === 'under' ||
          locked.current.strat === 'matches' ||
          locked.current.strat === 'differs')
          ? Number(locked.current.param)
          : undefined;

      const walletLogin = activeLoginidRef.current;
      const crPostHookShadow = Boolean(clientRef.current && isCrVirtualShadowLogin(walletLogin));

      // ✅ VIRTUAL (hooks: same for all logins — no shadow / no session P/L)
      if (canPlaceVirtual) {
        const vId = createVirtualTrade(ct, nextStakeRef.current, locked.current.market, dur, barrier);

        // Digit strategies with dur=1 settle SAME tick => entry=exit
        if (!settleRequired && dur === 1) {
          const loss = evalVirtualIsLoss(lastDigit, price, price);

          setTrades(prev =>
            prev.map(tr =>
              tr.id === vId
                ? {
                    ...tr,
                    entryValue: price,
                    exitValue: price,
                    currentValue: price,
                    status: loss ? 'lost' : 'won',
                    profit: 0,
                    closeTime: new Date(),
                  }
                : tr
            )
          );

          applyVirtualStreak(loss);
          return;
        }

        // dur>1 OR settle-required strategies wait to expiry/next tick
        setTrades(prev => prev.map(tr => (tr.id === vId ? { ...tr, entryValue: price, currentValue: price } : tr)));
        awaitingVirtualRef.current = { tradeId: vId, entryPrice: price, remaining: dur, dur };
        return;
      }

      // ✅ REAL — CR7557018: Flipaa-style shadow fill; others: Deriv `buy`
      buyPendingRef.current = true;

      if (crPostHookShadow) {
        try {
          await completeSpeedCrShadowTrade({
            ct,
            stake: nextStakeRef.current,
            mkt: locked.current.market,
            dur,
            barrier,
          });
        } catch (e: any) {
          setStatus(String(e?.message ?? e ?? 'Trade failed'), 'error');
        } finally {
          buyPendingRef.current = false;
        }

        if (!isRunningRef.current || stopRequestedRef.current) return;
        return;
      }

      const realId = await buyContract(nextStakeRef.current);
      buyPendingRef.current = false;

      if (!isRunningRef.current || stopRequestedRef.current) return;

      // ✅ When Virtual Hooks enabled, ALWAYS wait for settlement of real trade to avoid slips
      if (realId && locked.current.vTarget > 0) {
        inFlightRealRef.current = realId;
        return;
      }

      // Normal mode: only block on settle-required
      if (realId && settleRequired) {
        inFlightRealRef.current = realId;
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => {};

    return () => {
      try {
        ws.close();
      } catch {}
    };
  }, [
    isRunning,
    buyContract,
    contractFor,
    createVirtualTrade,
    evalVirtualIsLoss,
    getLastDigit,
    applyVirtualStreak,
    settleRequiredForStrategy,
    completeSpeedCrShadowTrade,
  ]);

  /* ===== Start / Stop ===== */
  const startBot = useCallback(() => {
    if (strategy === 'over' && param === 9) {
      setStatus('Over 9 never resets (unwinnable). Choose ≤ 8.', 'warning');
      return;
    }
    if (strategy === 'under' && param === 0) {
      setStatus('Under 0 never resets (unwinnable). Choose ≥ 1.', 'warning');
      return;
    }

    const patt = patternDigits(entryPatternStr);

    locked.current = {
      S: stakeInput,
      M: martingaleInput,
      strat: strategy,
      param,
      market,
      ticks,
      tp: Math.max(0, Number(tpInput || 0)),
      sl: Math.max(0, Number(slInput || 0)),

      vMode: virtualMode,
      vTarget: Math.max(0, virtualTarget),
      mDelay: Math.max(0, martingaleDelay),
      entryPatternDigits: patt,
      entryPatternStr: normalizePattern(entryPatternStr),

      returnToVirtual: Math.max(0, returnToVirtual || 0),
    };

    ladderRef.current = buildLadder(locked.current.S, locked.current.M);

    consecutiveRealLossesRef.current = 0;
    stakeIndexRef.current = 0;
    nextStakeRef.current = ladderRef.current[0] ?? 0;

    awaitingVirtualRef.current = null;
    closeVirtFlipTickWs();
    inFlightRealRef.current = null;
    buyPendingRef.current = false;

    sessionLossesVirtRef.current = 0;
    afterFactSuppressedRef.current = false;
    afterFactWinStreakRef.current = 0;
    naturalLossStreakRef.current = 0;
    onlyRunLossStreakVirtRef.current = { only_up: 0, only_down: 0 };
    virtTickBufferRef.current = [];
    digitWindowRef.current = [];
    lastEpochRef.current = null;

    stopRequestedRef.current = false;
    sessionPLRef.current = 0;
    setSessionPL(0);

    settledContractsRef.current.clear();
    lastBuyTsRef.current = 0;
    clearRateLimitBackoff();

    vWinsRef.current = 0;
    vLossesRef.current = 0;
    readyForRealRef.current = locked.current.vTarget <= 0;
    setVWinsUI(0);
    setVLossesUI(0);
    setReadyForRealUI(readyForRealRef.current);

    recoveryRef.current = { on: false, wins: 0, losses: 0 };
    setRecoveryUI({ on: false, wins: 0, losses: 0 });

    isRunningRef.current = true;
    setIsRunning(true);

    const entryTxt = locked.current.entryPatternStr || 'every tick';
    const virtTxt = locked.current.vTarget > 0 ? `${locked.current.vMode}×${locked.current.vTarget}` : 'OFF';
    const rtnTxt = locked.current.vTarget > 0 ? `Return to Virtual After: ${locked.current.returnToVirtual} REAL win(s)` : 'n/a';

    setStatus(`Bot started | Entry: ${entryTxt} | Virtual: ${virtTxt} | ${rtnTxt}`, 'success');
  }, [
    buildLadder,
    clearRateLimitBackoff,
    market,
    martingaleInput,
    param,
    setStatus,
    slInput,
    stakeInput,
    strategy,
    ticks,
    tpInput,
    entryPatternStr,
    virtualMode,
    virtualTarget,
    martingaleDelay,
    returnToVirtual,
    closeVirtFlipTickWs,
  ]);

  const stopBot = useCallback(() => hardStop('manual'), [hardStop]);

  /* ===== Reset (only when stopped) ===== */
  const handleReset = useCallback(() => {
    if (isRunningRef.current) return;

    setTrades([]);
    setPL(0);

    sessionPLRef.current = 0;
    setSessionPL(0);

    consecutiveRealLossesRef.current = 0;
    stakeIndexRef.current = 0;
    ladderRef.current = buildLadder(stakeInput, martingaleInput);
    nextStakeRef.current = ladderRef.current[0] ?? 0;

    stopRequestedRef.current = false;
    settledContractsRef.current.clear();
    clearRateLimitBackoff();

    vWinsRef.current = 0;
    vLossesRef.current = 0;
    readyForRealRef.current = false;
    setVWinsUI(0);
    setVLossesUI(0);
    setReadyForRealUI(false);

    recoveryRef.current = { on: false, wins: 0, losses: 0 };
    setRecoveryUI({ on: false, wins: 0, losses: 0 });

    sessionLossesVirtRef.current = 0;
    afterFactSuppressedRef.current = false;
    afterFactWinStreakRef.current = 0;
    naturalLossStreakRef.current = 0;
    onlyRunLossStreakVirtRef.current = { only_up: 0, only_down: 0 };
    virtTickBufferRef.current = [];
    closeVirtFlipTickWs();

    setStatus('History cleared', 'info');
  }, [buildLadder, stakeInput, martingaleInput, setStatus, clearRateLimitBackoff, closeVirtFlipTickWs]);

  /* ===== Derived stats (REAL only) ===== */
  const tradeStats = useMemo(() => {
    const realCompleted = trades.filter(t => !t.virtual && (t.status === 'won' || t.status === 'lost'));
    return {
      total: realCompleted.length,
      won: realCompleted.filter(t => t.status === 'won').length,
      lost: realCompleted.filter(t => t.status === 'lost').length,
    };
  }, [trades]);

  return (
    <div className="speed-apppt">
      <div className="history-title">
        <div className="eve">
          <TradeTypesDigitsEvenIcon width={18} height={18} />
          Speed Bot V6 | Virtual Hooks + Sequential Anti-Slip
          <TradeTypesDigitsOddIcon width={16} height={16} />
        </div>
        <div
          className="youtube"
          role="button"
          tabIndex={0}
          aria-label="Play tutorial video"
          onClick={() => setYtOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setYtOpen(true);
            }
          }}
        >
          <SocialYoutubeBlackIcon width={16} height={16} />
        </div>
      </div>

      <div className="trading-container">
        <LazyYouTubeModal videoUrl={YT_URL} isOpen={ytOpen} onClose={() => setYtOpen(false)} />

        <div className="trade-controls">
          <div className="trade-control-group market-selector">
            <label>Market</label>
            <select value={market} onChange={e => setMarket(e.target.value)} disabled={isRunning} className="trade-input">
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
            <label>Stake</label>
            <input
              type="number"
              className="trade-input"
              value={stakeStr}
              onChange={e => setStakeStr(e.target.value)}
              min={0}
              step="any"
              disabled={isRunning}
            />
          </div>

          <div className="trade-control-group">
            <label>Martingale</label>
            <input
              type="number"
              className="trade-input"
              value={martingaleStr}
              onChange={e => setMartingaleStr(e.target.value)}
              min={0}
              step="any"
              disabled={isRunning}
            />
          </div>

          <div className="trade-control-group">
            <label>Martingale Delay (REAL)</label>
            <input
              type="number"
              className="trade-input"
              value={martingaleDelayStr}
              onChange={e => setMartingaleDelayStr(e.target.value)}
              min={0}
              step={1}
              disabled={isRunning}
            />
          </div>

          <div className="trade-control-group">
            <label>Strategy</label>
            <select className="trade-input" value={strategy} onChange={e => setStrategy(e.target.value as StrategyType)} disabled={isRunning}>
              <option value="even">Even</option>
              <option value="odd">Odd</option>
              <option value="over">Over</option>
              <option value="under">Under</option>
              <option value="matches">Matches</option>
              <option value="differs">Differs</option>
              <option value="rise">Rise</option>
              <option value="fall">Fall</option>
              <option value="rise_equals">Rise =</option>
              <option value="fall_equals">Fall =</option>
              <option value="only_up">Only Ups</option>
              <option value="only_down">Only Downs</option>
            </select>
          </div>

          {(strategy === 'over' || strategy === 'under' || strategy === 'matches' || strategy === 'differs') && (
            <div className="trade-control-group">
              <label>{strategy === 'over' || strategy === 'under' ? 'Prediction' : 'Digit'}</label>
              <input
                type="number"
                className="trade-input"
                value={paramStr}
                onChange={e => setParamStr(e.target.value)}
                min={0}
                max={9}
                disabled={isRunning}
              />
            </div>
          )}

          <div className="trade-control-group">
            <label>Entry Pattern</label>
            <input
              type="text"
              className="trade-input"
              value={entryPatternStr}
              onChange={e => setEntryPatternStr(e.target.value)}
              disabled={isRunning}
              placeholder="e.g. 999 or 34 (blank = every tick)"
            />
            {entryPatternClean !== '' && (
              <small style={{ opacity: 0.75 }}>
                Using: <b>{entryPatternClean}</b>
              </small>
            )}
          </div>

          <div className="trade-control-group">
            <label>Virtual Mode</label>
            <select className="trade-input" value={virtualMode} onChange={e => setVirtualMode(e.target.value as VirtualMode)} disabled={isRunning}>
              <option value="wins">Virtual Wins</option>
              <option value="losses">Virtual Losses</option>
            </select>
          </div>

          <div className="trade-control-group">
            <label>Virtual Count</label>
            <input
              type="number"
              className="trade-input"
              value={virtualCountStr}
              onChange={e => setVirtualCountStr(e.target.value)}
              min={0}
              step={1}
              disabled={isRunning}
              placeholder="0 = OFF"
            />
          </div>

          <div className="trade-control-group">
            <label>Return to Virtual After</label>
            <input
              type="number"
              className="trade-input"
              value={returnToVirtualStr}
              onChange={e => setReturnToVirtualStr(e.target.value)}
              min={0}
              step={1}
              disabled={isRunning}
            />
            <small style={{ opacity: 0.75 }}>
              Counts: <b>REAL wins</b>
            </small>
          </div>

          <div className="trade-control-group">
            <label>Take Profit</label>
            <input
              type="number"
              className="trade-input"
              value={tpStr}
              onChange={e => setTpStr(e.target.value)}
              min={0}
              step="any"
              disabled={isRunning}
              placeholder="0 to disable"
            />
          </div>

          <div className="trade-control-group">
            <label>Stop Loss</label>
            <input
              type="number"
              className="trade-input"
              value={slStr}
              onChange={e => setSlStr(e.target.value)}
              min={0}
              step="any"
              disabled={isRunning}
              placeholder="0 to disable"
            />
          </div>

          <div className="trade-control-group">
            <label>Ticks</label>
            <select className="trade-input" value={ticks} onChange={e => setTicks(parseInt(e.target.value, 10))} disabled={isRunning}>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </div>

          <div className="trade-control-group">
            <label className="start" style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold', fontSize: '15px', gap: '4px', cursor: 'pointer' }}>
              <LegacyPlayFillIcon width={20} height={20} /> Run
            </label>

            <button
              className={`auto-trade-toggle ${isRunning ? 'on' : 'off'}`}
              onClick={isRunning ? () => stopBot() : () => startBot()}
              style={{
                padding: '.8rem .12rem',
                background: isRunning ? 'linear-gradient(90deg,#4285F4,#34a853)' : '#E6A85C',
                color: '#fff',
                border: '1px solid #222',
                justifyContent: 'center',
                display: 'flex',
                borderRadius: '4px',
                fontWeight: 'bold',
              }}
            >
              {isRunning ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        <div className="title">
          <small>Type|Market</small>
          <small>Entry|Exit spot</small>
          <small>Buy price & P/L</small>
        </div>

        <div className="open-positions">
          {trades.length === 0 ? (
            <div className="no-positions">
              <small>No positions</small>
            </div>
          ) : (
            trades.map(tr => (
              <div
                key={tr.id}
                className={`position-item ${
                  tr.status === 'won'
                    ? 'position-win'
                    : tr.status === 'lost' || tr.status === 'error'
                    ? 'position-loss'
                    : 'position-open'
                }`}
              >
                <div className="position-header">
                  <div className="position-market-contract">
                    {marketIcons[tr.market] || <span>{tr.market}</span>}
                    {contractIcons[tr.contractType] || <span>{tr.contractType}</span>}

                    {tr.virtual && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 10,
                          padding: '2px 8px',
                          borderRadius: 999,
                          border: '1px solid rgba(255,255,255,0.25)',
                          opacity: 0.95,
                          fontWeight: 800,
                          color:
                            tr.status === 'won'
                              ? '#20d26a'
                              : tr.status === 'lost'
                              ? '#ff4d4f'
                              : 'rgba(255,255,255,0.85)',
                        }}
                      >
                        Virtual Hook
                      </span>
                    )}

                    {isDigitContract(tr.contractType) && typeof tr.barrier === 'number' && (
                      <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.8 }}>d{tr.barrier}</span>
                    )}
                  </div>

                  {tr.status === 'error' && (
                    <div className="error-display">
                      <span className="error-badge" title={tr.errorDetails || 'Trade failed'}>
                        !
                      </span>
                      <span className="error-text">{tr.errorReason}</span>
                    </div>
                  )}
                </div>

                <div className="position-spots">
                  <div className="spot-entry">
                    <EntrySpotIcon />
                    {formatTickValue(tr.entryValue, tr.marketFormat)}
                  </div>
                  <div className="spot-exit">
                    <ExitSpotIcon />
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
                      : tr.profit !== undefined
                      ? `${tr.profit >= 0 ? '+' : ''}${tr.profit.toFixed(2)}`
                      : '—'}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {!isRunning && (
          <div className="trade-control-group">
            <label>&nbsp;</label>
            <button className="trade-btn reset-btn" onClick={handleReset} title="Clear results and P/L">
              Reset
            </button>
          </div>
        )}
      </div>

      <div className="trade-status">
        <div>
          {msg.txt}
          {isRunning && (
            <span style={{ marginLeft: 10 }}>
              🎯 Entry: <b>{locked.current.entryPatternStr || 'every tick'}</b> · Virtual:{' '}
              <b>{locked.current.vTarget > 0 ? `${locked.current.vMode}×${locked.current.vTarget}` : 'OFF'}</b> · Ready:{' '}
              <b>{locked.current.vTarget > 0 ? (readyForRealUI ? 'YES ✅' : 'no') : 'YES ✅'}</b> · Recovery:{' '}
              <b>{recoveryUI.on ? `ON (${recoveryUI.wins}W / ${recoveryUI.losses}L)` : 'OFF'}</b> · Pending:{' '}
              <b>{buyPendingRef.current ? 'YES' : 'no'}</b>
            </span>
          )}
        </div>

        <div style={{ marginTop: 6 }}>
          REAL loss row: <b>{consecutiveRealLossesRef.current}</b> · Delay: <b>{locked.current.mDelay}</b> · Stake idx:{' '}
          <b>{stakeIndexRef.current}</b>/7 · Next stake: <b>${nextStakeRef.current.toFixed(2)}</b> · Virtual W/L:{' '}
          <b>{vWinsUI}</b>/<b>{vLossesUI}</b> · Session P/L:{' '}
          <b style={{ marginLeft: 6 }}>
            {sessionPL >= 0 ? '+' : '-'}${Math.abs(sessionPL).toFixed(2)}
          </b>
        </div>
      </div>

      <div className="performance-stats">
        <div className="stat-item">
          <div className="stat-title">Total P/L</div>
          <div className={`stat-value ${profitLoss >= 0 ? 'profit' : 'loss'}`}>
            {profitLoss >= 0 ? '+' : ''}${Math.abs(profitLoss).toFixed(2)} USD
          </div>
        </div>
        <div className="stat-item">
          <div className="stat-title">No. of runs (REAL)</div>
          <div className="stat-value">{tradeStats.total}</div>
        </div>
        <div className="stat-item">
          <div className="stat-title">Won (REAL)</div>
          <div className="stat-value profit">{tradeStats.won}</div>
        </div>
        <div className="stat-item">
          <div className="stat-title">Lost (REAL)</div>
          <div className="stat-value loss">{tradeStats.lost}</div>
        </div>
      </div>
    </div>
  );
}
