// src/pages/aaaStrategies/Flipa/MultiStrategyBot.tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { reaction } from 'mobx';
import { api_base } from '@/external/bot-skeleton';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import type { TReadyTrade } from '@/pages/aaaReadyStrategy/ready-trade-types';
import {
  decideFlipVirtualPair,
  type FlipVirtStrategyType,
  MAX_SESSION_LOSSES,
  ONLY_RUN_MAX_CONSECUTIVE_LOSSES,
  updateAfterFactGovernor,
  type VirtTick,
} from '@/pages/aaflipaa/flipaaVirtualDecision';
import { playTradeResultSound } from '@/pages/aap2psafe/tradeSounds';
import { scheduleCrChanceLedgerRoundTrip } from '@/utils/chanceVirtualStatements';
import { sendDerivSessionContractPurchase } from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import {
  flipaaFormatQuoteForDigitContract,
  flipaaLastDigitFromQuote,
} from './flipaaTickDigitFormat';
import {
  ALLOWED_BOT_IFRAME_LOGINID,
  isCrVirtualShadowLogin,
  runWithCrShadowLock,
  tryDebitCrShadowSync,
} from '@/utils/crVirtualBalanceShadow';
import { cr7557018ShouldDeferExitAndPayoutDisplay } from '@/utils/cr7557018DelayedPositionContracts';
import {
  LegacyPlayFillIcon,
  MarketDerivedJump10Icon,
  MarketDerivedJump25Icon,
  MarketDerivedJump50Icon,
  MarketDerivedJump75Icon,
  MarketDerivedJump100Icon,
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
import LazyYouTubeModal from '../aaaStrategies/LazyYoutubeModal/LazyYouTubeModal';
import './flipa.scss';

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
  barrier?: number; // digit prediction for digit contracts
}

type TTransaction = { contract_id: string; amount: number; transaction_time: number };

type ActiveStrategy = {
  key: StrategyType;
  stake: number | '';
  prediction?: number | '';
};

const DIGIT_KEYS: StrategyType[] = ['matches', 'differs', 'over', 'under'];

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

  // Rise/Fall
  CALL: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
  PUT: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />,

  // Allow equals (rise/fall)
  CALLE: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
  PUTE: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />,

  // Only Ups/Only Downs
  RUNHIGH: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
  RUNLOW: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />,
};

/* ---------- Helpers ---------- */
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

const FlipaaTrailingDelayContext = createContext(true);

/** CR7557018 + directional contracts: after entry+exit exist, wait 1s then reveal exit tick and P/L together (display-only). */
function FlipaaTrailingDelayProvider({
  walletLoginId,
  contractType,
  entryValue,
  exitValue,
  children,
}: {
  walletLoginId: string | undefined;
  contractType: string;
  entryValue?: number;
  exitValue?: number;
  children: ReactNode;
}) {
  const delayTrailing = cr7557018ShouldDeferExitAndPayoutDisplay(walletLoginId, contractType);

  const [showTrailing, setShowTrailing] = useState(!delayTrailing);

  useEffect(() => {
    if (!delayTrailing) {
      setShowTrailing(true);
      return;
    }
    if (entryValue === undefined || exitValue === undefined) {
      setShowTrailing(false);
      return;
    }
    setShowTrailing(false);
    const tid = window.setTimeout(() => setShowTrailing(true), 1000);
    return () => window.clearTimeout(tid);
  }, [delayTrailing, contractType, entryValue, exitValue]);

  return (
    <FlipaaTrailingDelayContext.Provider value={showTrailing}>{children}</FlipaaTrailingDelayContext.Provider>
  );
}

function FlipaaPositionExitCell({ exitValue, marketFormat }: { exitValue?: number; marketFormat?: string }) {
  const showTrailing = useContext(FlipaaTrailingDelayContext);
  return (
    <>
      <ExitSpotIcon />
      {formatTickValue(showTrailing ? exitValue : undefined, marketFormat)}
    </>
  );
}

function FlipaaPositionResultCell({ tr }: { tr: TTrade }) {
  const showTrailing = useContext(FlipaaTrailingDelayContext);
  const hideSettledPayout =
    !showTrailing && (tr.status === 'won' || tr.status === 'lost') && tr.profit !== undefined;
  const pendingLike = tr.status === 'pending' || hideSettledPayout;

  return (
    <div
      className={`position-result ${
        pendingLike
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
      {pendingLike
        ? '...'
        : tr.profit !== undefined
        ? `${tr.profit >= 0 ? '+' : ''}${tr.profit.toFixed(2)}`
        : '—'}
    </div>
  );
}

/** Vol 10 (1s) — default market (parity with BotIframe / Auto Bot). */
const FLIPAA_DEFAULT_MARKET = '1HZ10V';

const formatTickValue = (v?: number, mf?: string) => {
  if (v === undefined) return '—';
  return flipaaFormatQuoteForDigitContract(v, mf || '');
};

const extractLastDigit = (quote: number, market: string) => {
  const d = flipaaLastDigitFromQuote(quote, market);
  return Number.isFinite(d) ? d : null;
};

const labelFor = (s: StrategyType) =>
  ({
    even: 'Even',
    odd: 'Odd',
    over: 'Over',
    under: 'Under',
    matches: 'Matches',
    differs: 'Differs',
    rise: 'Rise',
    fall: 'Fall',
    only_up: 'Only Ups',
    only_down: 'Only Downs',
    rise_equals: 'Rise =',
    fall_equals: 'Fall =',
  }[s]);

const contractFor = (st: StrategyType) => {
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

    // Rise/Fall
    case 'rise':
      return 'CALL';
    case 'fall':
      return 'PUT';

    // Only Ups/Downs + equals
    case 'only_up':
      return 'RUNHIGH';
    case 'only_down':
      return 'RUNLOW';
    case 'rise_equals':
      return 'CALLE';
    case 'fall_equals':
      return 'PUTE';
  }
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const CONTRACT_TO_STRATEGY: Record<string, StrategyType> = (
  [
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
  ] as StrategyType[]
).reduce((acc, sk) => {
  const ct = contractFor(sk);
  if (ct) acc[ct] = sk;
  return acc;
}, {} as Record<string, StrategyType>);

const contractToStrategy = (ct: string): StrategyType | null => CONTRACT_TO_STRATEGY[ct] ?? null;

const isDirectionalDisplayContract = (ct: string) =>
  ct === 'CALL' || ct === 'PUT' || ct === 'CALLE' || ct === 'PUTE' || ct === 'RUNHIGH' || ct === 'RUNLOW';

type ProposalQuote = { ask: number; payout: number };

const isDigitContract = (ct: string) =>
  ct === 'DIGITOVER' || ct === 'DIGITUNDER' || ct === 'DIGITMATCH' || ct === 'DIGITDIFF';

// ✅ Only Ups / Only Downs require min 2 ticks on Deriv
const minTicksForContract = (ct: string) => {
  if (ct === 'RUNHIGH' || ct === 'RUNLOW') return 2;
  return 1;
};

// 🔒 GLOBAL BUY THROTTLE (single-mode / non-turbo)
const MIN_BUY_GAP_MS = 500;

// ⏱ Delay between concluded trade and next (when toggle is ON)
const DELAY_AFTER_SETTLE_MS = 2000;

/** Poll open real contracts — stream finals are often missed on live accounts after a few runs. */
const OPEN_CONTRACT_POLL_MS = 650;

/** When delay mode blocks run() (buy still open), retry scheduling instead of stopping silently. */
const DELAY_RUN_RETRY_MS = 350;

/** Re-kick scheduler if no delay/retry timer is armed while the bot still shows running. */
const SCHEDULER_HEARTBEAT_MS = 1200;

/** Recover when buy() never returns / locks never clear. */
const BUY_STUCK_MS = 14000;

/** Recover when an open contract id lingers after UI already shows a result. */
const OPEN_CONTRACT_STUCK_MS = 5000;

type NextCfg =
  | { error: string }
  | { contractType: string; stake: number; market: string; duration: number; barrier?: number };

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

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

/** Virtual contracts settle inside `buy()` before this microtask; never leave a stale "open" id for the scheduler. */
const openContractIdAfterBuy = (realID: string | null | undefined, ref: { current: string | null }) => {
  if (!realID || String(realID).startsWith('v-')) ref.current = null;
  else ref.current = realID;
};

const isRealFlipaaContractId = (id: string) =>
  Boolean(id) && !id.startsWith('tmp-') && !id.startsWith('v-');

const isOpenFlipaaTradeStatus = (st: TradeStatus) => st === 'pending' || st === 'open' || st === 'active';

/**
 * True when the contract is actually closed (sold / expired / terminal status).
 * Do NOT treat `is_settleable` alone as finished — Deriv sets it on many still-open
 * contracts (early sell available); that caused premature settle, stuck `inFlightRef`
 * / missed finals, and single-mode chains dying after ~2 runs while Turbo kept going.
 */
function isProposalContractFinishedFlipaa(c: Record<string, unknown>) {
  const st = String(c.status ?? '').toLowerCase();
  const cs = String(c.contract_status ?? '').toLowerCase();
  const tickCount = Number(c.tick_count);
  const currentTick = Number(c.current_tick);
  const ticksExhausted =
    Number.isFinite(tickCount) &&
    tickCount > 0 &&
    Number.isFinite(currentTick) &&
    currentTick >= tickCount &&
    (c.profit !== undefined ||
      c.is_sold ||
      c.is_expired ||
      c.exit_tick != null ||
      c.sell_price != null);
  const hasExit =
    c.exit_tick != null || c.exit_tick_time != null || c.sell_time != null || c.date_expiry != null;

  return (
    Boolean(c.is_sold) ||
    Boolean(c.is_expired) ||
    ticksExhausted ||
    (Boolean(c.is_expired) && hasExit) ||
    st === 'sold' ||
    st === 'won' ||
    st === 'lost' ||
    st === 'complete' ||
    st === 'closed' ||
    st === 'ended' ||
    cs === 'sold' ||
    cs === 'won' ||
    cs === 'lost' ||
    cs === 'complete' ||
    cs === 'closed'
  );
}

function resolveFlipaaProposalOutcome(c: Record<string, unknown>, net: number): 'won' | 'lost' {
  const cs = String(c.contract_status ?? c.status ?? '').toLowerCase();
  if (cs === 'won') return 'won';
  if (cs === 'lost') return 'lost';
  return net >= 0 ? 'won' : 'lost';
}

export default function MultiStrategyBot() {
  /* ===== Inputs ===== */
  const [isRunning, setIsRunning] = useState(false);
  const isRunningRef = useRef(false);
  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  const [market, setMarket] = useState(FLIPAA_DEFAULT_MARKET);
  const [ticks, setTicks] = useState<number | ''>(1);

  const [martingaleInput, setMartingaleInput] = useState<number | ''>(1.25);
  const [stakeInput, setStakeInput] = useState<number | ''>(0.35);

  // Multi-Buy / Turbo
  const [multiBuy, setMultiBuy] = useState(false);
  const [turboRuns, setTurboRuns] = useState<number | ''>(1);

  // Global default digit prediction
  const [defaultDigitPrediction, setDefaultDigitPrediction] = useState<number>(2);

  // ✅ Manual Entry Point (digit). Blank = buy immediately.
  const [entryPointDigit, setEntryPointDigit] = useState<number | ''>('');
  const entryPointDigitRef = useRef<number | null>(null);

  // Take Profit / Stop Loss
  const [takeProfit, setTakeProfit] = useState<number | ''>('');
  const [stopLoss, setStopLoss] = useState<number | ''>('');

  // Volatility switcher
  const [volSwitch, setVolSwitch] = useState(false);
  const VOL_LIST = useRef<string[]>([
    'R_10',
    '1HZ10V',
    '1HZ15V',
    'R_25',
    '1HZ25V',
    '1HZ30V',
    'R_50',
    '1HZ50V',
    'R_75',
    '1HZ75V',
    'R_90',
    '1HZ90V',
    'R_100',
    '1HZ100V',
    'JD10',
    'JD25',
    'JD50',
    'JD75',
    'JD100',
  ]);
  const volIndexRef = useRef(0);

  // Strategies
  const [activeStrategies, setActiveStrategies] = useState<ActiveStrategy[]>([
    { key: 'over', stake: '', prediction: 2 },
    { key: 'under', stake: '', prediction: 6 },
  ]);

  const [currentStratIndex, setCurrentStratIndex] = useState(0);

  // Switch-on-loss mode & threshold
  const [switchOnLoss, setSwitchOnLoss] = useState(true);
  const [lossesToSwitch, setLossesToSwitch] = useState<number | ''>(1);

  // Main Mode toggle
  const [mainMode, setMainMode] = useState(false);
  const mainModeRef = useRef(false);
  useEffect(() => {
    mainModeRef.current = mainMode;
  }, [mainMode]);

  // Delay-after-settle toggle
  const [delayAfterSettle, setDelayAfterSettle] = useState(true);
  const delayAfterSettleRef = useRef(true);
  useEffect(() => {
    delayAfterSettleRef.current = delayAfterSettle;
  }, [delayAfterSettle]);

  // Tutorial
  const [ytOpen, setYtOpen] = useState(false);
  const YT_URL = 'https://youtu.be/lJZO89NS78Q?si=Z_jJLcS1uTTXmNA6';

  /* ===== Trades & status ===== */
  const [trades, setTrades] = useState<TTrade[]>([]);
  const tradesRef = useRef<TTrade[]>([]);
  tradesRef.current = trades;
  const [msg, setMsg] = useState<{ txt: string; type: 'info' | 'success' | 'error' | 'loading' | 'warning' }>({
    txt: '',
    type: 'info',
  });
  const [profitLoss, setPL] = useState(0);
  const [sessionPL, setSessionPL] = useState(0);

  const { ready_strategy_panel, client } = useStore() ?? {};
  const { activeLoginid, tradingSocketGeneration } = useApiBase();

  const activeLoginidRef = useRef<string | undefined>(undefined);
  const clientRef = useRef(client);
  clientRef.current = client;
  useLayoutEffect(() => {
    activeLoginidRef.current = activeLoginid;
  }, [activeLoginid]);

  /* ─── CR7557018 virtual tick buffer (proposal-priced simulated fills) ─── */
  const virtTickBufferRef = useRef<VirtTick[]>([]);
  const virtTickWsRef = useRef<WebSocket | null>(null);
  const virtTickEpochRef = useRef<number | null>(null);
  const virtTickMktRef = useRef<string>('');

  const sessionLossesVirtRef = useRef(0);
  const afterFactSuppressedRef = useRef(false);
  const afterFactWinStreakRef = useRef(0);
  const naturalLossStreakRef = useRef(0);
  const onlyRunLossStreakVirtRef = useRef<{ only_up: number; only_down: number }>({ only_up: 0, only_down: 0 });

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

  const getProposal = useCallback(
    async (ct: string, mkt: string, dur: number, stake: number, barrier?: number): Promise<ProposalQuote> => {
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

  useEffect(() => {
    if (!isRunning || !isCrVirtualShadowLogin(activeLoginid)) {
      closeVirtFlipTickWs();
      virtTickBufferRef.current = [];
    }
    return () => closeVirtFlipTickWs();
  }, [isRunning, activeLoginid, closeVirtFlipTickWs]);

  /* ===== Execution state/locks ===== */
  const inFlightRef = useRef(false);
  const currentOpenIdRef = useRef<string | null>(null);

  const inFlightRoundRef = useRef(false);
  const currentRoundRemainingRef = useRef(0);
  const contractToStratRef = useRef<Record<string, StrategyType>>({});

  const settledContractsRef = useRef<Set<string>>(new Set());
  const stakesByIdRef = useRef<Record<string, number>>({});

  const haltRef = useRef(false);
  /** Settled after `handleSettle` is defined (virtual fills call into the same scheduler). */
  const handleSettleRef = useRef<(cid: string, net: number, opts?: { delaySoundMs?: number }) => void>(() => {});
  const applyProposalOpenContractRef = useRef<(c: Record<string, unknown>) => void>(() => {});
  const lastBuyTsRef = useRef<number>(0);

  /* ✅ Ghost-buy guards */
  const runIdRef = useRef(0);
  const delayTimerRef = useRef<number | null>(null);
  const buyDeferTimerRef = useRef<number | null>(null);
  const runRetryTimerRef = useRef<number | null>(null);
  const buyInFlightRef = useRef(false); // ✅ keep for SINGLE buy only
  /** Latest contract id from buy response — guards settlements during in-flight buys (delay mode). */
  const lastPlacedContractIdRef = useRef<string | null>(null);
  const buyStartedAtRef = useRef(0);
  const openContractSinceRef = useRef(0);
  const contractRunRef = useRef<Map<string, number>>(new Map());
  const scheduleNextRef = useRef<(why: 'start' | 'after_win' | 'after_loss' | 'after_error') => void>(() => {});

  /* ✅ Entry-point gating (single mode only) */
  const pendingEntryRef = useRef(false);
  const pendingCfgRef = useRef<NextCfg | null>(null);
  const pendingRunIdRef = useRef<number>(0);

  /* ✅ Tick WS (for entry point) */
  const tickWsRef = useRef<WebSocket | null>(null);
  const tickMarketRef = useRef<string>('');
  const tickLiveRef = useRef(false);
  const tickLastDigitRef = useRef<number | null>(null);
  const tickLastQuoteRef = useRef<number | null>(null);

  const clearDelayTimer = useCallback(() => {
    if (delayTimerRef.current != null) {
      window.clearTimeout(delayTimerRef.current);
      delayTimerRef.current = null;
    }
  }, []);

  const clearBuyDeferTimer = useCallback(() => {
    if (buyDeferTimerRef.current != null) {
      window.clearTimeout(buyDeferTimerRef.current);
      buyDeferTimerRef.current = null;
    }
  }, []);

  const clearRunRetryTimer = useCallback(() => {
    if (runRetryTimerRef.current != null) {
      window.clearTimeout(runRetryTimerRef.current);
      runRetryTimerRef.current = null;
    }
  }, []);

  const clearAllScheduleTimers = useCallback(() => {
    clearDelayTimer();
    clearBuyDeferTimer();
    clearRunRetryTimer();
  }, [clearDelayTimer, clearBuyDeferTimer, clearRunRetryTimer]);

  const shouldIgnoreSingleModeSettlement = useCallback((cid: string) => {
    if (multiBuyRef.current) return false;
    const active = currentOpenIdRef.current;
    if (active != null && active !== cid) return true;
    const placed = lastPlacedContractIdRef.current;
    if (
      (inFlightRef.current || buyInFlightRef.current) &&
      active == null &&
      placed != null &&
      placed !== cid
    ) {
      return true;
    }
    return false;
  }, []);

  const releaseSingleModeSchedulerLocks = useCallback(() => {
    inFlightRef.current = false;
    currentOpenIdRef.current = null;
    pendingEntryRef.current = false;
    pendingCfgRef.current = null;
    openContractSinceRef.current = 0;
  }, []);

  /* ✅ GLOBAL RateLimit backoff */
  const rateLimitRef = useRef<{ until: number; attempt: number; lastMsg: string }>({
    until: 0,
    attempt: 0,
    lastMsg: '',
  });

  const waitForRateLimitBackoff = useCallback(async () => {
    const now = Date.now();
    if (now < rateLimitRef.current.until) {
      const ms = rateLimitRef.current.until - now;
      await sleep(ms);
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

    const sec = Math.max(1, Math.ceil((waitMs + jitter) / 1000));
    setMsg({ txt: `⏳ Rate limit detected — backing off ~${sec}s`, type: 'warning' });

    await sleep(waitMs + jitter);
  }, []);

  /* ===== Martingale (single mode) ===== */
  const martingale = useRef({ base: 0.35, current: 0.35, step: 0, maxSteps: 7 });

  /* ===== Martingale (multi mode per strategy) ===== */
  type MgState = { base: number; current: number; step: number; maxSteps: number };
  const mgByStratRef = useRef<Record<StrategyType, MgState>>({} as Record<StrategyType, MgState>);

  /* ===== Switch-on-loss tracking ===== */
  const lossStreakByStratRef = useRef<Record<StrategyType, number>>({} as Record<StrategyType, number>);
  const switchOnLossRef = useRef<boolean>(switchOnLoss);
  useEffect(() => {
    switchOnLossRef.current = switchOnLoss;
  }, [switchOnLoss]);

  const lossesToSwitchRef = useRef<number>(1);
  useEffect(() => {
    const n = typeof lossesToSwitch === 'number' && lossesToSwitch > 0 ? Math.floor(lossesToSwitch) : 1;
    lossesToSwitchRef.current = n;
  }, [lossesToSwitch]);

  /* ===== Turbo runs trackers ===== */
  const turboRunsRef = useRef<number | ''>(turboRuns);
  useEffect(() => {
    turboRunsRef.current = turboRuns;
  }, [turboRuns]);

  const turboRunsTotalRef = useRef<number>(1);
  const turboRunsRemainingRef = useRef<number>(0);

  /* ===== Live value refs ===== */
  const setStatus = useCallback(
    (txt: string, type: 'info' | 'success' | 'error' | 'loading' | 'warning' = 'info') => setMsg({ txt, type }),
    []
  );

  const recoverFlipaaAfterBuyFailure = useCallback(
    (msg: string) => {
      const fatal =
        msg === 'restricted' ||
        msg === 'insufficient-balance' ||
        msg === 'Trading halted' ||
        msg === 'Buy in flight' ||
        msg === 'unknown-contract';
      if (fatal) {
        setIsRunning(false);
        isRunningRef.current = false;
        return;
      }
      if (isRunningRef.current && !haltRef.current) {
        setStatus(msg ? `Retrying after: ${msg}` : 'Retrying after trade error…', 'warning');
        scheduleNextRef.current('after_error');
      }
    },
    [setStatus]
  );

  const collectOpenRealContractIds = useCallback((): string[] => {
    const ids = new Set<string>();
    const openId = currentOpenIdRef.current;
    if (openId && isRealFlipaaContractId(openId)) ids.add(openId);
    tradesRef.current.forEach(t => {
      if (isRealFlipaaContractId(t.id) && isOpenFlipaaTradeStatus(t.status)) ids.add(t.id);
    });
    return [...ids];
  }, []);

  const getBalanceError = useCallback((e: any) => {
    const errorObj = e?.error ?? e;
    const message = (errorObj?.message || 'Unknown error').toString();
    const code = errorObj?.code || '';
    const isBalanceError =
      code === 'InsufficientBalance' ||
      /insufficient|balance|fund|not enough|no enough|low balance/i.test(message);
    return { isBalanceError, message };
  }, []);

  const activeStrategiesRef = useRef<ActiveStrategy[]>([]);
  useEffect(() => {
    activeStrategiesRef.current = activeStrategies;
  }, [activeStrategies]);

  const volSwitchRef = useRef(false);
  useEffect(() => {
    volSwitchRef.current = volSwitch;
  }, [volSwitch]);

  const marketRef = useRef(market);
  useEffect(() => {
    marketRef.current = market;
  }, [market]);

  const ticksRef = useRef(ticks);
  useEffect(() => {
    ticksRef.current = ticks;
  }, [ticks]);

  const martingaleInputRef = useRef<number | ''>(martingaleInput);
  useEffect(() => {
    martingaleInputRef.current = martingaleInput;
  }, [martingaleInput]);

  const currentStratIndexRef = useRef(0);
  useEffect(() => {
    currentStratIndexRef.current = currentStratIndex;
  }, [currentStratIndex]);

  const multiBuyRef = useRef(false);
  useEffect(() => {
    multiBuyRef.current = multiBuy;
  }, [multiBuy]);

  const defaultDigitPredictionRef = useRef<number>(defaultDigitPrediction);
  useEffect(() => {
    defaultDigitPredictionRef.current = defaultDigitPrediction;
  }, [defaultDigitPrediction]);

  const sessionPLRef = useRef(0);
  useEffect(() => {
    sessionPLRef.current = sessionPL;
  }, [sessionPL]);

  const tpRef = useRef<number | ''>(takeProfit);
  useEffect(() => {
    tpRef.current = takeProfit;
  }, [takeProfit]);

  const slRef = useRef<number | ''>(stopLoss);
  useEffect(() => {
    slRef.current = stopLoss;
  }, [stopLoss]);

  /* ===== Account-switch safe: API epoch + re-subscription ===== */
  const [apiEpoch, setApiEpoch] = useState(0);

  useEffect(() => {
    const api = api_base.api;
    const conn = api?.connection as {
      addEventListener: (e: string, fn: () => void) => void;
      removeEventListener: (e: string, fn: () => void) => void;
      readyState?: number;
    };
    if (!conn) return;

    const bump = () => setApiEpoch(x => x + 1);
    conn.addEventListener('open', bump);
    conn.addEventListener('close', bump);
    if (conn.readyState === 1) bump();

    return () => {
      try {
        conn.removeEventListener('open', bump);
      } catch {
        void 0;
      }
      try {
        conn.removeEventListener('close', bump);
      } catch {
        void 0;
      }
    };
  }, [activeLoginid, tradingSocketGeneration]);

  const ensureApiReady = useCallback(async () => {
    const OPEN = 1 as const;
    if (!api_base.api || api_base.api.connection.readyState !== OPEN) {
      await api_base.init(false);
    }
  }, []);

  const pollOpenRealContracts = useCallback(async () => {
    if (!isRunningRef.current || haltRef.current) return;
    const login = activeLoginidRef.current;
    if (login && isCrVirtualShadowLogin(login)) return;

    const ids = collectOpenRealContractIds();
    if (!ids.length) return;

    await ensureApiReady();
    if (!api_base.api || api_base.api.connection.readyState !== 1) return;

    for (const contract_id of ids) {
      try {
        const resp = (await api_base.api.send({
          proposal_open_contract: 1,
          contract_id,
          subscribe: 0,
        })) as { proposal_open_contract?: Record<string, unknown>; error?: unknown };
        if (resp?.proposal_open_contract) {
          applyProposalOpenContractRef.current(resp.proposal_open_contract);
        }
      } catch {
        /* noop */
      }
    }
  }, [collectOpenRealContractIds, ensureApiReady]);

  const resubscribeOpenRealContracts = useCallback(async () => {
    const login = activeLoginidRef.current;
    if (login && isCrVirtualShadowLogin(login)) return;

    const ids = collectOpenRealContractIds();
    if (!ids.length) return;

    await ensureApiReady();
    if (!api_base.api || api_base.api.connection.readyState !== 1) return;

    for (const contract_id of ids) {
      try {
        await api_base.api.send({ proposal_open_contract: 1, contract_id, subscribe: 1 });
      } catch {
        /* noop */
      }
    }
  }, [collectOpenRealContractIds, ensureApiReady]);

  /* ===== Market picker ===== */
  const pickMarketFromRefs = () => {
    if (!volSwitchRef.current) return marketRef.current;
    const list = VOL_LIST.current;
    const idx = volIndexRef.current % list.length;
    const m = list[idx];
    volIndexRef.current = (idx + 1) % list.length;
    return m;
  };

  /* ===========================
     ✅ TICK WS (manual entry point)
     =========================== */
  const closeTickWS = useCallback(() => {
    if (tickWsRef.current) {
      try {
        tickWsRef.current.onopen = null;
        tickWsRef.current.onmessage = null;
        tickWsRef.current.onerror = null;
        tickWsRef.current.onclose = null;
        tickWsRef.current.close();
      } catch {
        void 0;
      }
      tickWsRef.current = null;
    }
    tickMarketRef.current = '';
    tickLiveRef.current = false;
    tickLastDigitRef.current = null;
    tickLastQuoteRef.current = null;
  }, []);

  const ensureTickStream = useCallback(
    (symbol: string) => {
      // only needed when entry point is set and we're in single-mode
      if (multiBuyRef.current) return;
      if (entryPointDigitRef.current == null) return;

      if (tickWsRef.current && tickMarketRef.current === symbol) return;

      closeTickWS();

      const app_id = 1089;
      tickMarketRef.current = symbol;

      const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);
      tickWsRef.current = ws;

      ws.onopen = () => {
        tickLiveRef.current = false;
        ws.send(
          JSON.stringify({
            ticks_history: symbol,
            style: 'ticks',
            count: 80,
            end: 'latest',
            subscribe: 1,
          })
        );
      };

      ws.onmessage = evt => {
        try {
          const data = JSON.parse(evt.data);
          if (data?.error) return;

          if (data?.msg_type === 'history') {
            tickLiveRef.current = false;

            const prices: number[] = (data.history?.prices || []).map(Number);
            const last = prices.length ? Number(prices[prices.length - 1]) : NaN;
            if (Number.isFinite(last)) {
              tickLastQuoteRef.current = last;
              tickLastDigitRef.current = extractLastDigit(last, symbol);
            }
            return;
          }

          if (data?.msg_type === 'tick') {
            tickLiveRef.current = true;
            const quote = Number(data.tick?.quote);
            if (!Number.isFinite(quote)) return;

            tickLastQuoteRef.current = quote;
            const lastDigit = extractLastDigit(quote, symbol);
            tickLastDigitRef.current = lastDigit;

            // ignore triggers from old run
            if (pendingRunIdRef.current !== runIdRef.current) return;

            // if we're waiting for entry, and digit matches -> buy
            if (
              isRunningRef.current &&
              pendingEntryRef.current &&
              !inFlightRef.current &&
              !currentOpenIdRef.current &&
              pendingCfgRef.current &&
              !('error' in pendingCfgRef.current)
            ) {
              const wanted = entryPointDigitRef.current;
              if (wanted != null && lastDigit != null && lastDigit === wanted) {
                pendingEntryRef.current = false;

                const cfg = pendingCfgRef.current;
                pendingCfgRef.current = null;

                if (buyInFlightRef.current || inFlightRef.current || currentOpenIdRef.current) return;

                inFlightRef.current = true;
                buyStartedAtRef.current = Date.now();
                setStatus(`✅ Entry hit (${wanted}) → buying`, 'success');

                buy(cfg.contractType, cfg.stake, cfg.market, cfg.duration, cfg.barrier)
                  .then(realID => {
                    openContractIdAfterBuy(realID ?? null, currentOpenIdRef);
                    if (realID && isRealFlipaaContractId(String(realID))) {
                      openContractSinceRef.current = Date.now();
                    }
                  })
                  .catch((e: unknown) => {
                    inFlightRef.current = false;
                    currentOpenIdRef.current = null;
                    const msg = (e instanceof Error ? e.message : String(e ?? '')).toString();
                    if (msg === 'virtual-timeout' && isRunningRef.current && !haltRef.current) {
                      setStatus('Virtual tick buffer slow — retrying…', 'warning');
                      scheduleNextRef.current('after_error');
                      return;
                    }
                    recoverFlipaaAfterBuyFailure(msg);
                  });
              }
            }
          }
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => {};
      ws.onclose = () => {};
    },
    [closeTickWS, setStatus]
  );

  useEffect(() => {
    return () => closeTickWS();
  }, [closeTickWS]);

  // Keep ref in sync (and clear pending wait when entry point removed)
  useEffect(() => {
    entryPointDigitRef.current = typeof entryPointDigit === 'number' ? entryPointDigit : null;

    if (entryPointDigitRef.current == null) {
      pendingEntryRef.current = false;
      pendingCfgRef.current = null;
      closeTickWS();
    } else {
      // if running + single mode, ensure stream on current market immediately
      if (isRunningRef.current && !multiBuyRef.current) {
        const cfg = peekNextConfigFromRefs();
        if (!('error' in cfg)) ensureTickStream(cfg.market);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryPointDigit]);

  /* ===== Strategy buttons ===== */
  const toggleStrategy = (key: StrategyType) => {
    setActiveStrategies(prev => {
      const idx = prev.findIndex(s => s.key === key);
      if (idx >= 0) {
        const copy = [...prev];
        copy.splice(idx, 1);
        if (currentStratIndex >= copy.length) setCurrentStratIndex(0);
        return copy;
      }
      const isDigit = DIGIT_KEYS.includes(key);
      return [
        ...prev,
        {
          key,
          stake: '',
          prediction: isDigit ? defaultDigitPredictionRef.current : undefined,
        },
      ];
    });
  };

  const updateActiveStake = (i: number, v: number | '') => {
    setActiveStrategies(prev => {
      const copy = [...prev];
      copy[i] = { ...copy[i], stake: v === '' ? '' : Number(v) };
      return copy;
    });
  };

  const updateActivePrediction = (i: number, value: number | '') => {
    setActiveStrategies(prev => {
      const copy = [...prev];
      if (value === '') copy[i] = { ...copy[i], prediction: '' };
      else copy[i] = { ...copy[i], prediction: Math.max(0, Math.min(9, Math.floor(value))) };
      return copy;
    });
  };

  /* ===== Next config ===== */
  const peekNextConfigFromRefs = useCallback((): NextCfg => {
    const actives = activeStrategiesRef.current;
    if (!actives || actives.length === 0) return { error: 'Activate at least one strategy' };

    const i = currentStratIndexRef.current % actives.length;
    const strat = actives[i];

    const ct = contractFor(strat.key)!;
    const needBarrier = DIGIT_KEYS.includes(strat.key);
    const barrier = strat.prediction;

    if (needBarrier && !(typeof barrier === 'number' && barrier >= 0 && barrier <= 9)) {
      return { error: 'Set prediction (0–9) for digit strategies' };
    }

    const mi = isNum(martingaleInputRef.current) ? martingaleInputRef.current : 1;
    const useMg = mi > 1;

    const base =
      isNum(strat.stake) && strat.stake > 0 ? strat.stake : isNum(stakeInput) && stakeInput > 0 ? stakeInput : 0.35;
    const stake = useMg ? martingale.current.current : base;

    const mkt = pickMarketFromRefs();
    let dur = typeof ticksRef.current === 'number' && ticksRef.current > 0 ? Math.floor(ticksRef.current) : 1;
    dur = Math.max(dur, minTicksForContract(ct)); // ✅ fix RUNHIGH/RUNLOW duration

    return {
      contractType: ct,
      stake,
      market: mkt,
      duration: dur,
      barrier: typeof barrier === 'number' ? barrier : undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getNextConfigFromRefs = () => peekNextConfigFromRefs();

  /* ===== Trade helpers ===== */
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
    };
    setTrades(prev => [t, ...prev]);
    return id;
  }, []);

  const waitForThrottleGap = async () => {
    const now = Date.now();
    const delta = now - (lastBuyTsRef.current || 0);
    if (delta < MIN_BUY_GAP_MS) await sleep(MIN_BUY_GAP_MS - delta);
    lastBuyTsRef.current = Date.now();
  };

  const patchTempToError = (tmpID: string, reason: string, details?: string) => {
    setTrades(ts =>
      ts.map(t =>
        t.id === tmpID
          ? {
              ...t,
              status: 'error',
              temp: false,
              errorReason: reason,
              errorDetails: details,
              closeTime: new Date(),
            }
          : t
      )
    );
  };

  /** Real-money Deriv contract (all non–CR7557018 shadow accounts). */
  const executeDerivFlipTrade = useCallback(
    async (
      tmpID: string,
      ct: string,
      stake: number,
      mkt: string,
      dur: number,
      barrier: number | undefined,
      opts: { skipThrottle: boolean }
    ): Promise<string> => {
      await ensureApiReady();
      if (!opts.skipThrottle) await waitForThrottleGap();
      await waitForRateLimitBackoff();

      const st = contractToStrategy(ct);
      if (!st) {
        patchTempToError(tmpID, 'Trade failed', 'Unknown contract');
        throw new Error('unknown-contract');
      }

      const MAX_RL_RETRIES = 8;

      for (let attempt = 0; attempt <= MAX_RL_RETRIES; attempt++) {
        if (haltRef.current || !isRunningRef.current) throw new Error('Trading halted');

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

          const cidRaw = resp.buy?.contract_id;
          if (cidRaw == null || cidRaw === '') {
            throw new Error('No contract_id in buy response');
          }
          const realID = String(cidRaw);
          stakesByIdRef.current[realID] = stake;
          contractRunRef.current.set(realID, runIdRef.current);
          lastPlacedContractIdRef.current = realID;

          setTrades(ts =>
            ts.map(t =>
              t.id === tmpID
                ? {
                    ...t,
                    id: realID,
                    temp: false,
                    contractType: ct,
                    status: 'open',
                    marketFormat: mkt,
                  }
                : t
            )
          );

          try {
            const pocResp = (await api_base.api!.send({
              proposal_open_contract: 1,
              contract_id: realID,
              subscribe: 1,
            })) as { proposal_open_contract?: Record<string, unknown> };
            if (pocResp?.proposal_open_contract) {
              applyProposalOpenContractRef.current(pocResp.proposal_open_contract);
            }
          } catch {
            void 0;
          }

          setStatus('✅ Trade placed', 'success');
          return realID;
        } catch (e: unknown) {
          if (isRateLimitError(e) && attempt < MAX_RL_RETRIES) {
            await applyRateLimitBackoff(e);
            await waitForRateLimitBackoff();
            continue;
          }

          const { isBalanceError, message } = getBalanceError(e);
          patchTempToError(tmpID, isBalanceError ? 'Insufficient balance' : 'Trade failed', message);
          setStatus(message || 'Trade failed', 'error');
          throw e;
        }
      }

      patchTempToError(tmpID, 'Rate limit', 'Too many rate limit retries');
      setStatus('Rate limit retries exhausted', 'error');
      throw new Error('Rate limit retries exhausted');
    },
    [
      applyRateLimitBackoff,
      clearRateLimitBackoff,
      ensureApiReady,
      getBalanceError,
      patchTempToError,
      setStatus,
      waitForRateLimitBackoff,
    ]
  );

  const completeVirtualFlipTrade = useCallback(
    async (
      tmpID: string,
      ct: string,
      stake: number,
      mkt: string,
      dur: number,
      barrier: number | undefined,
      opts: { skipThrottle: boolean }
    ): Promise<string> => {
      const loginid = activeLoginidRef.current;
      const cli = clientRef.current;
      if (!loginid || !isCrVirtualShadowLogin(loginid) || !cli) {
        throw new Error('restricted');
      }

      await ensureApiReady();
      if (!opts.skipThrottle) await waitForThrottleGap();
      await waitForRateLimitBackoff();

      await ensureVirtTicksForMarket(mkt);

      const st = contractToStrategy(ct);
      if (!st) {
        patchTempToError(tmpID, 'Trade failed', 'Unknown contract');
        throw new Error('unknown-contract');
      }

      let quote: ProposalQuote;
      try {
        quote = await getProposal(ct, mkt, dur, stake, barrier);
      } catch (e: any) {
        patchTempToError(tmpID, 'Trade failed', String(e?.message ?? e));
        throw e;
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
        patchTempToError(tmpID, 'Trade failed', 'Could not resolve virtual outcome');
        throw new Error('virtual-timeout');
      }

      const ask = Number(quote.ask);
      const payout = Number(quote.payout);

      const debitOk = await runWithCrShadowLock(() => tryDebitCrShadowSync(cli, ALLOWED_BOT_IFRAME_LOGINID, ask));
      if (!debitOk) {
        patchTempToError(tmpID, 'Trade failed — insufficient balance', 'Not enough virtual balance for this stake.');
        throw new Error('insufficient-balance');
      }

      const virtId = `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      contractRunRef.current.set(virtId, runIdRef.current);
      lastPlacedContractIdRef.current = virtId;
      stakesByIdRef.current[virtId] = stake;

      const net = decision.win ? payout - ask : -ask;

      const isDir = isDirectionalDisplayContract(ct);
      const isOneTick = Number(dur || 1) === 1;
      const entryShown = isDir ? decision.entry : isOneTick ? decision.exit : decision.entry;
      const exitShown = decision.exit;

      setTrades(ts =>
        ts.map(t =>
          t.id === tmpID
            ? {
                ...t,
                id: virtId,
                temp: false,
                contractType: ct,
                status: net >= 0 ? 'won' : 'lost',
                profit: Number(net.toFixed(2)),
                entryValue: entryShown.quote,
                exitValue: exitShown.quote,
                startTime: new Date(entryShown.epoch * 1000),
                closeTime: new Date(exitShown.epoch * 1000),
                marketFormat: mkt,
              }
            : t
        )
      );

      updateAfterFactGovernor(
        {
          afterFactSuppressedRef,
          afterFactWinStreakRef,
          naturalLossStreakRef,
        },
        st,
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

      const settlementCredit = decision.win ? payout : 0;
      scheduleCrChanceLedgerRoundTrip({
        client: cli,
        walletLoginId: loginid,
        ask,
        settlementCredit,
        entryEpochSec: entryShown.epoch,
        exitEpochSec: exitShown.epoch,
      });

      handleSettleRef.current(
        virtId,
        net,
        cr7557018ShouldDeferExitAndPayoutDisplay(loginid, ct) ? { delaySoundMs: 1000 } : undefined
      );

      clearRateLimitBackoff();
      setStatus('✅ Trade placed', 'success');
      return virtId;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flip bot: keep stable scheduler wiring
    [
      ensureApiReady,
      ensureVirtTicksForMarket,
      getProposal,
      waitForThrottleGap,
      waitForRateLimitBackoff,
      setStatus,
      clearRateLimitBackoff,
    ]
  );

  /* ===== BUY (throttled) — CR7557018 shadow = virtual; everyone else = real Deriv ===== */
  const buy = async (ct: string, stake: number, mkt: string, dur: number, barrier?: number) => {
    if (haltRef.current || !isRunningRef.current) throw new Error('Trading halted');

    const walletLogin = activeLoginidRef.current || clientRef.current?.loginid || '';
    if (!walletLogin.trim() || !clientRef.current) {
      setStatus('Log in to place trades', 'error');
      throw new Error('restricted');
    }

    if (buyInFlightRef.current) throw new Error('Buy in flight');
    buyInFlightRef.current = true;

    const tmpID = createTempTrade(ct, stake, mkt, dur, barrier);

    try {
      if (isCrVirtualShadowLogin(walletLogin)) {
        return await completeVirtualFlipTrade(tmpID, ct, stake, mkt, dur, barrier, { skipThrottle: false });
      }
      return await executeDerivFlipTrade(tmpID, ct, stake, mkt, dur, barrier, { skipThrottle: false });
    } catch (e: any) {
      const msg = (e?.message ?? '').toString();
      if (msg === 'restricted') throw e;

      if (!multiBuyRef.current) {
        inFlightRef.current = false;
        currentOpenIdRef.current = null;
      } else {
        currentRoundRemainingRef.current = Math.max(0, currentRoundRemainingRef.current - 1);
      }

      if (msg !== 'insufficient-balance' && msg !== 'virtual-timeout' && msg !== 'unknown-contract') {
        const { message } = getBalanceError(e);
        setStatus(message || msg || 'Trade failed', 'error');
      }
      throw e;
    } finally {
      buyInFlightRef.current = false;
    }
  };

  /* ===== BUY (turbo batch, no single-lock) ===== */
  const buyImmediate = async (ct: string, stake: number, mkt: string, dur: number, barrier?: number) => {
    if (haltRef.current || !isRunningRef.current) throw new Error('Trading halted');

    const walletLogin = activeLoginidRef.current || clientRef.current?.loginid || '';
    if (!walletLogin.trim() || !clientRef.current) {
      setStatus('Log in to place trades', 'error');
      throw new Error('restricted');
    }

    const tmpID = createTempTrade(ct, stake, mkt, dur, barrier);

    try {
      if (isCrVirtualShadowLogin(walletLogin)) {
        return await completeVirtualFlipTrade(tmpID, ct, stake, mkt, dur, barrier, { skipThrottle: true });
      }
      return await executeDerivFlipTrade(tmpID, ct, stake, mkt, dur, barrier, { skipThrottle: true });
    } catch (e: any) {
      const msg = (e?.message ?? '').toString();
      const { message } = getBalanceError(e);
      setStatus(message || msg || 'Trade failed', 'error');
      currentRoundRemainingRef.current = Math.max(0, currentRoundRemainingRef.current - 1);
      throw e;
    }
  };

  /* ===== Risk checks: TP / SL ===== */
  const riskHit = (plAfter: number) => {
    const tp = tpRef.current;
    const sl = slRef.current;
    if (isNum(tp) && tp > 0 && plAfter >= tp) return { hit: true, reason: 'take_profit' as const };
    if (isNum(sl) && sl > 0 && -plAfter >= sl) return { hit: true, reason: 'stop_loss' as const };
    return { hit: false as const, reason: null as null };
  };

  const stopBotHard = (reason: 'take_profit' | 'stop_loss') => {
    haltRef.current = true;
    isRunningRef.current = false;
    setIsRunning(false);

    clearAllScheduleTimers();

    pendingEntryRef.current = false;
    pendingCfgRef.current = null;

    inFlightRef.current = false;
    inFlightRoundRef.current = false;
    currentRoundRemainingRef.current = 0;

    closeTickWS();

    setStatus(`⛔ ${reason === 'take_profit' ? 'Take Profit reached' : 'Stop Loss hit'}. Trading stopped.`, 'warning');
  };

  /* ===== Scheduler (with optional delay + ghost-buy protection) ===== */
  const scheduleNext = (why: 'start' | 'after_win' | 'after_loss' | 'after_error' = 'start') => {
    const myRunId = runIdRef.current;

    const scheduleRunRetry = () => {
      if (runIdRef.current !== myRunId) return;
      if (!isRunningRef.current || haltRef.current) return;
      if (runRetryTimerRef.current != null) return;
      runRetryTimerRef.current = window.setTimeout(() => {
        runRetryTimerRef.current = null;
        if (runIdRef.current !== myRunId) return;
        if (!isRunningRef.current || haltRef.current) return;
        run();
      }, DELAY_RUN_RETRY_MS);
    };

    const run = () => {
      if (runIdRef.current !== myRunId) return;
      if (haltRef.current) return;
      if (!isRunningRef.current) return;

      const guard = riskHit(sessionPLRef.current);
      if (guard.hit) {
        stopBotHard(guard.reason!);
        return;
      }

      // MULTI-BUY / TURBO (entry point is NOT used here)
      if (multiBuyRef.current) {
        if (inFlightRoundRef.current || currentRoundRemainingRef.current > 0) return;

        if (isNum(turboRunsRef.current)) {
          if (turboRunsRemainingRef.current <= 0) {
            isRunningRef.current = false;
            setIsRunning(false);
            setStatus('✅ Turbo runs completed', 'success');
            return;
          }
        }

        const actives = activeStrategiesRef.current;
        if (!actives || actives.length === 0) {
          setStatus('Activate at least one strategy', 'warning');
          return;
        }

        for (const s of actives) {
          if (
            DIGIT_KEYS.includes(s.key) &&
            !(typeof s.prediction === 'number' && s.prediction >= 0 && s.prediction <= 9)
          ) {
            setStatus(`Set prediction (0–9) for ${labelFor(s.key)}`, 'warning');
            return;
          }
        }

        const mkt = pickMarketFromRefs();
        const mi = isNum(martingaleInputRef.current) ? martingaleInputRef.current : 1;
        const useMg = mi > 1;

        const durBase = typeof ticksRef.current === 'number' && ticksRef.current > 0 ? Math.floor(ticksRef.current) : 1;

        const batch = actives.map(s => {
          const ct = contractFor(s.key)!;
          const needBarrier = DIGIT_KEYS.includes(s.key);
          const barrier = needBarrier ? (s.prediction as number) : undefined;

          const base =
            isNum(s.stake) && s.stake > 0 ? s.stake : isNum(stakeInput) && stakeInput > 0 ? stakeInput : 0.35;

          const mg = mgByStratRef.current[s.key] ?? { base, current: base, step: 0, maxSteps: 7 };
          mg.base = base;
          const stake = useMg ? mg.current : base;

          const durAdj = Math.max(durBase, minTicksForContract(ct));
          return { key: s.key, ct, barrier, stake, mkt, dur: durAdj };
        });

        // ✅ one round = fire all buys at once
        inFlightRoundRef.current = true;
        contractToStratRef.current = {};
        currentRoundRemainingRef.current = batch.length;

        // Fire concurrently (NO SINGLE-LOCK now)
        batch.forEach(b => {
          if (runIdRef.current !== myRunId) return;
          if (haltRef.current || !isRunningRef.current) return;

          buyImmediate(b.ct, b.stake, b.mkt, b.dur, b.barrier)
            .then(realID => {
              if (realID) contractToStratRef.current[realID] = b.key;
            })
            .catch(() => {
              // errors already patched; round counter reduced inside buyImmediate
              // round completion still handled by handleSettle
            });
        });

        return;
      }

      // SINGLE-MODE
      if (inFlightRef.current || buyInFlightRef.current) {
        scheduleRunRetry();
        return;
      }
      const openId = currentOpenIdRef.current;
      if (openId) {
        const row = tradesRef.current.find(t => t.id === openId);
        if (row && (row.status === 'won' || row.status === 'lost')) {
          const net = Number(row.profit ?? 0);
          if (!settledContractsRef.current.has(openId)) {
            handleSettleRef.current(openId, net);
            return;
          }
          releaseSingleModeSchedulerLocks();
        } else {
          scheduleRunRetry();
          return;
        }
      }

      // if we're already waiting for entry, don't stack another wait
      if (entryPointDigitRef.current != null && pendingEntryRef.current) {
        scheduleRunRetry();
        return;
      }

      const cfg = getNextConfigFromRefs();
      if ('error' in cfg) {
        if (isRunningRef.current) setStatus(cfg.error, 'warning');
        scheduleRunRetry();
        return;
      }

      // ✅ ENTRY POINT PATH (manual digit)
      if (entryPointDigitRef.current != null) {
        ensureTickStream(cfg.market);

        pendingCfgRef.current = cfg;
        pendingEntryRef.current = true;
        pendingRunIdRef.current = runIdRef.current;

        setStatus(`⏳ Waiting entry ${entryPointDigitRef.current} then buy`, 'info');
        return;
      }

      clearBuyDeferTimer();
      buyDeferTimerRef.current = window.setTimeout(() => {
        if (runIdRef.current !== myRunId) return;
        if (haltRef.current || !isRunningRef.current) return;
        if (inFlightRef.current || buyInFlightRef.current || currentOpenIdRef.current) {
          scheduleRunRetry();
          return;
        }

        inFlightRef.current = true;
        buyStartedAtRef.current = Date.now();

        buy(cfg.contractType, cfg.stake, cfg.market, cfg.duration, cfg.barrier as number | undefined)
          .then(realID => {
            openContractIdAfterBuy(realID ?? null, currentOpenIdRef);
            if (realID && isRealFlipaaContractId(String(realID))) {
              openContractSinceRef.current = Date.now();
            }
          })
          .catch((e: unknown) => {
            inFlightRef.current = false;
            currentOpenIdRef.current = null;
            const msg = (e instanceof Error ? e.message : String(e ?? '')).toString();
            if (msg === 'virtual-timeout' && isRunningRef.current && !haltRef.current) {
              setStatus('Virtual tick buffer slow — retrying…', 'warning');
              scheduleNext('after_error');
              return;
            }
            recoverFlipaaAfterBuyFailure(msg);
          });
      }, 0);
    };

    clearRunRetryTimer();
    if (why !== 'start' && delayAfterSettleRef.current) {
      clearDelayTimer();
      delayTimerRef.current = window.setTimeout(() => {
        if (runIdRef.current !== myRunId) return;
        if (!isRunningRef.current || haltRef.current) return;
        run();
      }, DELAY_AFTER_SETTLE_MS);
    } else {
      run();
    }
  };
  scheduleNextRef.current = scheduleNext;

  const resetFlipaaHistory = useCallback(() => {
    clearAllScheduleTimers();
    setTrades([]);
    setPL(0);
    setSessionPL(0);
    sessionPLRef.current = 0;
    settledContractsRef.current.clear();
    currentOpenIdRef.current = null;
    lastPlacedContractIdRef.current = null;
    buyStartedAtRef.current = 0;
    openContractSinceRef.current = 0;
    stakesByIdRef.current = {};
    inFlightRef.current = false;
    inFlightRoundRef.current = false;
    currentRoundRemainingRef.current = 0;
    contractToStratRef.current = {};
    turboRunsRemainingRef.current = 0;
    lastBuyTsRef.current = 0;
    pendingEntryRef.current = false;
    pendingCfgRef.current = null;
    closeTickWS();
    closeVirtFlipTickWs();
    sessionLossesVirtRef.current = 0;
    afterFactSuppressedRef.current = false;
    afterFactWinStreakRef.current = 0;
    naturalLossStreakRef.current = 0;
    onlyRunLossStreakVirtRef.current = { only_up: 0, only_down: 0 };
    clearRateLimitBackoff();
    setStatus('History cleared', 'info');
  }, [clearAllScheduleTimers, closeTickWS, closeVirtFlipTickWs, clearRateLimitBackoff, setStatus]);

  const startFlipaaBotRef = useRef<() => void>(() => {});
  const stopFlipaaBotRef = useRef<() => void>(() => {});

  startFlipaaBotRef.current = () => {
    if (!activeLoginidRef.current?.trim()) {
      setStatus('Log in with your Deriv account to run the bot', 'warning');
      return;
    }

    if (isRunningRef.current) return;
    const actives = (activeStrategiesRef.current = activeStrategies);
    if (!actives || actives.length === 0) {
      setStatus('Activate at least one strategy below the header', 'warning');
      return;
    }

    haltRef.current = false;

    sessionLossesVirtRef.current = 0;
    afterFactSuppressedRef.current = false;
    afterFactWinStreakRef.current = 0;
    naturalLossStreakRef.current = 0;
    onlyRunLossStreakVirtRef.current = { only_up: 0, only_down: 0 };

    const first = actives[0];
    const base0 =
      isNum(first?.stake) && first.stake > 0
        ? first.stake
        : isNum(stakeInput) && stakeInput > 0
        ? stakeInput
        : 0.35;

    martingale.current.base = base0;
    martingale.current.current = base0;
    martingale.current.step = 0;

    mgByStratRef.current = {} as Record<StrategyType, MgState>;
    actives.forEach(s => {
      const base =
        isNum(s.stake) && s.stake > 0 ? s.stake : isNum(stakeInput) && stakeInput > 0 ? stakeInput : 0.35;
      mgByStratRef.current[s.key] = { base, current: base, step: 0, maxSteps: 7 };
    });

    lossStreakByStratRef.current = {} as Record<StrategyType, number>;
    actives.forEach(s => {
      lossStreakByStratRef.current[s.key] = 0;
    });

    volSwitchRef.current = volSwitch;
    marketRef.current = market;
    ticksRef.current = ticks;

    const mi = isNum(martingaleInput) ? martingaleInput : 1;
    martingaleInputRef.current = mi;

    currentStratIndexRef.current = 0;
    setCurrentStratIndex(0);

    settledContractsRef.current.clear();
    currentOpenIdRef.current = null;
    lastPlacedContractIdRef.current = null;
    buyStartedAtRef.current = 0;
    openContractSinceRef.current = 0;
    stakesByIdRef.current = {};
    volIndexRef.current = 0;

    pendingEntryRef.current = false;
    pendingCfgRef.current = null;

    inFlightRef.current = false;
    inFlightRoundRef.current = false;
    currentRoundRemainingRef.current = 0;
    contractToStratRef.current = {};

    setSessionPL(0);
    sessionPLRef.current = 0;

    lastBuyTsRef.current = 0;

    clearAllScheduleTimers();
    runIdRef.current += 1;

    clearRateLimitBackoff();

    if (multiBuy) {
      const total =
        typeof turboRunsRef.current === 'number' && turboRunsRef.current > 0
          ? Math.floor(turboRunsRef.current)
          : 1;
      turboRunsTotalRef.current = total;
      turboRunsRemainingRef.current = total;
      setStatus(`Bot started (Turbo ON · ${total} round${total > 1 ? 's' : ''})`, 'success');
    } else {
      const lossesN = lossesToSwitchRef.current || 1;
      const ep = entryPointDigitRef.current;
      setStatus(
        `Bot started (${switchOnLossRef.current ? `Switch on loss · ${lossesN}` : 'No auto-switch'}${
          mainMode ? ' · Main mode' : ''
        }${ep != null ? ` · Entry ${ep}` : ''})`,
        'success'
      );

      if (ep != null) {
        const cfg = peekNextConfigFromRefs();
        if (!('error' in cfg)) ensureTickStream(cfg.market);
      }
    }

    isRunningRef.current = true;
    setIsRunning(true);

    void ensureApiReady().then(async () => {
      try {
        await api_base.api!.send({ transactions: 1, subscribe: 1 });
      } catch {
        /* sell events may still arrive on authorized stream */
      }
    });

    scheduleNext('start');
  };

  stopFlipaaBotRef.current = () => {
    clearAllScheduleTimers();

    isRunningRef.current = false;
    setIsRunning(false);

    pendingEntryRef.current = false;
    pendingCfgRef.current = null;

    inFlightRef.current = false;
    inFlightRoundRef.current = false;
    currentRoundRemainingRef.current = 0;

    closeTickWS();
    closeVirtFlipTickWs();

    setStatus('Bot stopped', 'info');
  };

  useEffect(() => {
    ready_strategy_panel.attach();
    ready_strategy_panel.setStartStrategyHandler(() => startFlipaaBotRef.current());
    ready_strategy_panel.setStopStrategyHandler(() => stopFlipaaBotRef.current());
    return () => {
      ready_strategy_panel.setStartStrategyHandler(null);
      ready_strategy_panel.setStopStrategyHandler(null);
      ready_strategy_panel.detach();
    };
  }, [ready_strategy_panel]);

  useEffect(() => {
    ready_strategy_panel.sync({
      trades: trades as TReadyTrade[],
      session_pl: sessionPL,
      profit_loss_from_trades: profitLoss,
    });
  }, [ready_strategy_panel, trades, sessionPL, profitLoss]);

  useEffect(() => {
    ready_strategy_panel.setStrategyRunning(isRunning);
  }, [ready_strategy_panel, isRunning]);

  useEffect(() => {
    return reaction(
      () => ready_strategy_panel.run_panel_clear_generation,
      gen => {
        if (gen < 1) return;
        stopFlipaaBotRef.current();
        haltRef.current = false;
        resetFlipaaHistory();
      }
    );
  }, [ready_strategy_panel, resetFlipaaHistory]);

  /* ===== Settlement handling ===== */
  const applySessionPLAndMaybeStop = useCallback((net: number) => {
    setSessionPL(prev => {
      const next = prev + net;
      sessionPLRef.current = next;
      const guard = riskHit(next);
      if (guard.hit) stopBotHard(guard.reason!);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSettle = useCallback(
    (cid: string, net: number, opts?: { delaySoundMs?: number }) => {
      const cidRun = contractRunRef.current.get(cid);
      if (cidRun !== undefined && cidRun !== runIdRef.current) return;
      if (settledContractsRef.current.has(cid)) return;
      if (shouldIgnoreSingleModeSettlement(cid)) return;

      settledContractsRef.current.add(cid);

      const won = net >= 0;
      const delayMs = opts?.delaySoundMs ?? 0;
      if (delayMs > 0) {
        window.setTimeout(() => playTradeResultSound(won), delayMs);
      } else {
        playTradeResultSound(won);
      }
      const mi = isNum(martingaleInputRef.current) ? martingaleInputRef.current : 1;
      const useMg = mi > 1;

      applySessionPLAndMaybeStop(net);
      if (!isRunningRef.current || haltRef.current) {
        inFlightRef.current = false;
        inFlightRoundRef.current = false;
        currentRoundRemainingRef.current = 0;
        pendingEntryRef.current = false;
        pendingCfgRef.current = null;
        return;
      }

      if (!multiBuyRef.current) {
        if (useMg) {
          if (won) {
            martingale.current.current = martingale.current.base;
            martingale.current.step = 0;
          } else {
            if (martingale.current.step < martingale.current.maxSteps) {
              martingale.current.step += 1;
              martingale.current.current = Number((martingale.current.current * mi).toFixed(2));
            } else {
              martingale.current.current = martingale.current.base;
              martingale.current.step = 0;
            }
          }
        }

        const actives = activeStrategiesRef.current;
        if (actives && actives.length > 0) {
          const idx = currentStratIndexRef.current % actives.length;
          const key = actives[idx].key;
          const mainOn = mainModeRef.current && actives.length >= 2;

          if (won) {
            lossStreakByStratRef.current[key] = 0;
            currentStratIndexRef.current = 0;
            setCurrentStratIndex(0);
          } else {
            const nextStreak = (lossStreakByStratRef.current[key] ?? 0) + 1;
            lossStreakByStratRef.current[key] = nextStreak;

            if (switchOnLossRef.current) {
              const threshold = lossesToSwitchRef.current || 1;
              if (nextStreak >= threshold) {
                if (mainOn) {
                  const lastIdx = actives.length - 1;
                  if (idx < lastIdx) {
                    const next = idx + 1;
                    currentStratIndexRef.current = next;
                    setCurrentStratIndex(next);
                    lossStreakByStratRef.current[key] = 0;
                  } else {
                    lossStreakByStratRef.current[key] = 0;
                  }
                } else {
                  const next = (idx + 1) % actives.length;
                  currentStratIndexRef.current = next;
                  setCurrentStratIndex(next);
                  lossStreakByStratRef.current[key] = 0;
                }
              }
            }
          }
        }

        if (currentOpenIdRef.current === cid) currentOpenIdRef.current = null;
        inFlightRef.current = false;

        pendingEntryRef.current = false;
        pendingCfgRef.current = null;

        if (isRunningRef.current && !haltRef.current) scheduleNextRef.current(won ? 'after_win' : 'after_loss');
      } else {
        const stratKey = contractToStratRef.current[cid];
        if (stratKey) {
          const s = mgByStratRef.current[stratKey];
          if (s && useMg) {
            if (won) {
              s.current = s.base;
              s.step = 0;
            } else {
              if (s.step < s.maxSteps) {
                s.step += 1;
                s.current = Number((s.current * mi).toFixed(2));
              } else {
                s.current = s.base;
                s.step = 0;
              }
            }
            mgByStratRef.current[stratKey] = { ...s };
          }
        }

        currentRoundRemainingRef.current = Math.max(0, currentRoundRemainingRef.current - 1);
        if (haltRef.current) {
          inFlightRoundRef.current = false;
          currentRoundRemainingRef.current = 0;
          return;
        }
        if (currentRoundRemainingRef.current === 0) {
          inFlightRoundRef.current = false;
          if (isNum(turboRunsRef.current))
            turboRunsRemainingRef.current = Math.max(0, turboRunsRemainingRef.current - 1);

          if (isRunningRef.current && !haltRef.current) {
            if (isNum(turboRunsRef.current) && turboRunsRemainingRef.current <= 0) {
              isRunningRef.current = false;
              setIsRunning(false);
              setStatus('✅ Turbo runs completed', 'success');
            } else {
              scheduleNextRef.current(won ? 'after_win' : 'after_loss');
            }
          }
        }
      }
    },
    [applySessionPLAndMaybeStop, setStatus, shouldIgnoreSingleModeSettlement]
  );

  useEffect(() => {
    handleSettleRef.current = handleSettle;
  }, [handleSettle]);

  const applyProposalOpenContract = useCallback((c: Record<string, unknown>) => {
    if (c?.contract_id == null || c.contract_id === '') return;
    const cid = String(c.contract_id);

    setTrades(prev =>
      prev.map(tr => {
        if (tr.id !== cid) return tr;

        const next = { ...tr };

        if (!next.startTime && c.entry_tick_time) {
          next.startTime = new Date(Number(c.entry_tick_time) * 1000);
          next.entryValue = c.entry_tick ? Number(c.entry_tick) : undefined;
        }
        if (c.tick_count && c.current_tick) next.ticksRemaining = Number(c.tick_count) - Number(c.current_tick);
        next.currentValue = c.current_spot ? Number(c.current_spot) : next.currentValue;

        const finished = isProposalContractFinishedFlipaa(c);
        if (finished) {
          const net = Number(c.profit ?? 0);
          next.status = resolveFlipaaProposalOutcome(c, net);
          next.profit = net;
          next.closeTime = new Date();
          next.exitValue = c.exit_tick ? Number(c.exit_tick) : undefined;
        } else {
          next.status = (c.status as TradeStatus) || 'active';
        }
        return next;
      })
    );

    const finished = isProposalContractFinishedFlipaa(c);
    if (!finished) return;

    const cidStr = String(c.contract_id);
    const cidRun = contractRunRef.current.get(cidStr);
    if (cidRun !== undefined && cidRun !== runIdRef.current) return;
    if (settledContractsRef.current.has(cidStr)) return;

    const net = Number(c.profit ?? 0);
    const row = tradesRef.current.find(t => t.id === cidStr);
    const delaySound = row && cr7557018ShouldDeferExitAndPayoutDisplay(activeLoginidRef.current, row.contractType);
    handleSettleRef.current(cidStr, net, delaySound ? { delaySoundMs: 1000 } : undefined);
  }, []);

  useEffect(() => {
    applyProposalOpenContractRef.current = applyProposalOpenContract;
  }, [applyProposalOpenContract]);

  /* ===== WS message handler ===== */
  const handleApiMessage = useCallback(
    ({ data }: any) => {
      if (data?.error) return;

      if (data?.msg_type === 'proposal_open_contract') {
        applyProposalOpenContractRef.current(data.proposal_open_contract as Record<string, unknown>);
        return;
      }

      if (data?.msg_type === 'transaction' && data.transaction?.action === 'sell') {
        const tx: TTransaction = data.transaction;
        const cid = String(tx.contract_id);

        const cidRun = contractRunRef.current.get(cid);
        if (cidRun !== undefined && cidRun !== runIdRef.current) return;

        setTrades(prev =>
          prev.map(tr => {
            if (tr.id !== cid) return tr;
            const stake = stakesByIdRef.current[cid] ?? tr.stake ?? 0;
            const net = Number(tx.amount) - stake;
            return {
              ...tr,
              status: net >= 0 ? 'won' : 'lost',
              profit: net,
              closeTime: new Date(tx.transaction_time * 1000),
            };
          })
        );

        if (!settledContractsRef.current.has(cid)) {
          const cidRun = contractRunRef.current.get(cid);
          if (cidRun !== undefined && cidRun !== runIdRef.current) return;

          const stake = stakesByIdRef.current[cid] ?? 0;
          const net = Number(tx.amount) - stake;
          const row = tradesRef.current.find(t => t.id === cid);
          const delaySound = row && cr7557018ShouldDeferExitAndPayoutDisplay(activeLoginidRef.current, row.contractType);
          handleSettle(cid, net, delaySound ? { delaySoundMs: 1000 } : undefined);
        }
      }
    },
    [handleSettle]
  );

  useEffect(() => {
    const sub = api_base.api.onMessage().subscribe(handleApiMessage);
    return () => sub.unsubscribe();
  }, [apiEpoch, tradingSocketGeneration, handleApiMessage]);

  /** Real accounts: poll open contracts so settlement is not lost when WS subscription drops. */
  useEffect(() => {
    if (!isRunning) return;
    const login = activeLoginidRef.current;
    if (login && isCrVirtualShadowLogin(login)) return;

    let cancelled = false;
    const tick = () => {
      if (!cancelled) void pollOpenRealContracts();
    };
    const interval = window.setInterval(tick, OPEN_CONTRACT_POLL_MS);
    tick();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isRunning, tradingSocketGeneration, apiEpoch, pollOpenRealContracts]);

  useEffect(() => {
    if (!isRunning) return;
    void resubscribeOpenRealContracts();
  }, [apiEpoch, tradingSocketGeneration, isRunning, resubscribeOpenRealContracts]);

  /** Recover scheduler if locks or settlement events were lost (common with delay ON). */
  useEffect(() => {
    if (!isRunning || multiBuyRef.current) return;

    const interval = window.setInterval(() => {
      if (!isRunningRef.current || haltRef.current) return;

      const now = Date.now();
      const cid = currentOpenIdRef.current;

      if ((inFlightRef.current || buyInFlightRef.current) && !cid) {
        const stuckFor = now - (buyStartedAtRef.current || 0);
        if (buyStartedAtRef.current > 0 && stuckFor >= BUY_STUCK_MS) {
          buyInFlightRef.current = false;
          releaseSingleModeSchedulerLocks();
          scheduleNextRef.current('after_error');
          return;
        }
      }

      if (cid && isRealFlipaaContractId(cid)) {
        const row = tradesRef.current.find(t => t.id === cid);
        if (row && (row.status === 'won' || row.status === 'lost')) {
          if (!settledContractsRef.current.has(cid)) {
            const net = Number(row.profit ?? 0);
            handleSettleRef.current(cid, net);
            return;
          }
          releaseSingleModeSchedulerLocks();
          scheduleNextRef.current('after_error');
          return;
        }

        const openFor = now - (openContractSinceRef.current || 0);
        if (openContractSinceRef.current > 0 && openFor >= OPEN_CONTRACT_STUCK_MS) {
          void pollOpenRealContracts();
        }
      }

      if (cid && settledContractsRef.current.has(cid)) {
        releaseSingleModeSchedulerLocks();
        scheduleNextRef.current('after_error');
        return;
      }
    }, 1500);
    return () => window.clearInterval(interval);
  }, [isRunning, pollOpenRealContracts, releaseSingleModeSchedulerLocks]);

  /** Heartbeat: if running but no timers armed and no active buy, kick the scheduler. */
  useEffect(() => {
    if (!isRunning || multiBuyRef.current) return;

    const interval = window.setInterval(() => {
      if (!isRunningRef.current || haltRef.current) return;
      if (delayTimerRef.current != null || runRetryTimerRef.current != null || buyDeferTimerRef.current != null) {
        return;
      }
      if (buyInFlightRef.current) return;

      const hasOpen =
        Boolean(currentOpenIdRef.current) ||
        tradesRef.current.some(t => isRealFlipaaContractId(t.id) && isOpenFlipaaTradeStatus(t.status));

      if (hasOpen) {
        if (currentOpenIdRef.current && isRealFlipaaContractId(currentOpenIdRef.current)) {
          void pollOpenRealContracts();
        }
        return;
      }

      if (!inFlightRef.current && !pendingEntryRef.current) {
        scheduleNextRef.current('after_error');
      } else if (inFlightRef.current && !currentOpenIdRef.current) {
        const stuckFor = Date.now() - (buyStartedAtRef.current || 0);
        if (buyStartedAtRef.current > 0 && stuckFor >= BUY_STUCK_MS) {
          releaseSingleModeSchedulerLocks();
          scheduleNextRef.current('after_error');
        }
      }
    }, SCHEDULER_HEARTBEAT_MS);

    return () => window.clearInterval(interval);
  }, [isRunning, pollOpenRealContracts, releaseSingleModeSchedulerLocks]);

  /* ===== Totals ===== */
  useEffect(() => {
    setPL(trades.reduce((s, t) => s + (t.profit ?? 0), 0));
  }, [trades]);

  const tradeStats = useMemo(() => {
    const completed = trades.filter(t => t.status === 'won' || t.status === 'lost');
    return {
      total: completed.length,
      won: completed.filter(t => t.status === 'won').length,
      lost: completed.filter(t => t.status === 'lost').length,
    };
  }, [trades]);

  /* ---------- UI ---------- */
  return (
    <div className="flipaaaa">
      <div className="history-title">
        <div className="eve">
          <MarketDerivedJump75Icon width={18} height={18} />
          Strategy Switcher | Market Flipaa
          <MarketDerivedJump75Icon width={16} height={16} />
        </div>
      </div>

      {/* Strategy buttons */}
      <div className="strategy-buttons" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 12px' }}>
        {(
          [
            'even',
            'odd',
            'matches',
            'differs',
            'over',
            'under',
            'rise',
            'fall',
            'only_up',
            'only_down',
            'rise_equals',
            'fall_equals',
          ] as StrategyType[]
        ).map(sk => {
          const active = activeStrategies.some(s => s.key === sk);
          const icon =
            sk === 'even' ? (
              <TradeTypesDigitsEvenIcon width={14} height={14} />
            ) : sk === 'odd' ? (
              <TradeTypesDigitsOddIcon width={14} height={14} />
            ) : sk === 'matches' ? (
              <TradeTypesDigitsMatchesIcon width={14} height={14} />
            ) : sk === 'differs' ? (
              <TradeTypesDigitsDiffersIcon width={14} height={14} />
            ) : sk === 'over' ? (
              <TradeTypesDigitsOverIcon width={14} height={14} />
            ) : sk === 'under' ? (
              <TradeTypesDigitsUnderIcon width={14} height={14} />
            ) : sk === 'fall' || sk === 'only_down' || sk === 'fall_equals' ? (
              <TradeTypesUpsAndDownsFallIcon width={14} height={14} />
            ) : (
              <TradeTypesUpsAndDownsRiseIcon width={14} height={14} />
            );

          return (
            <button
              key={sk}
              className={`strat-btn ${active ? 'active' : ''}`}
              onClick={() => toggleStrategy(sk)}
              disabled={isRunning}
              title={active ? 'Deactivate' : 'Activate'}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid #333',
                background: active ? '#2e7d32' : '#424242',
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {icon}
              {labelFor(sk)}
            </button>
          );
        })}
      </div>

      {/* Active strategies panel */}
      <div className="active-strategies-panel">
        <div className="active-strategies">
          Active strategies (
          {multiBuy
            ? 'multi-buy'
            : `switch-on-loss${
                switchOnLossRef.current
                  ? ` · ${lossesToSwitchRef.current} loss${(lossesToSwitchRef.current ?? 1) > 1 ? 'es' : ''}`
                  : ''
              }`}
          {mainMode ? ' · Main mode' : ''})
        </div>

        {activeStrategies.length === 0 ? (
          <div className="active-strategies-empty">Activate favorite strategy(s) above.</div>
        ) : (
          <div className="active-strat">
            {activeStrategies.map((s, i) => (
              <div className="whuee" key={`${s.key}-${i}`}>
                <div className="see">
                  <b>#{i + 1}</b> — {labelFor(s.key)}
                  {i === 0 && mainMode && !multiBuy && ' · MAIN'}
                  {i === activeStrategies.length - 1 && mainMode && !multiBuy && activeStrategies.length > 1 && ' · LAST'}
                </div>

                <div className="active-strat-field">
                  <label>Stake</label>
                  <input
                    type="number"
                    step="any"
                    value={s.stake === '' ? '' : String(s.stake)}
                    disabled={isRunning}
                    onChange={e => {
                      const val = e.target.value;
                      updateActiveStake(i, val === '' ? '' : Number(val));
                    }}
                    className="straty-stake"
                  />
                </div>

                {DIGIT_KEYS.includes(s.key) ? (
                  <div className="active-strat-field">
                    <label>Pred</label>
                    <input
                      type="number"
                      min={0}
                      max={9}
                      value={s.prediction === '' || s.prediction == null ? '' : String(s.prediction)}
                      disabled={isRunning}
                      onChange={e => {
                        const val = e.target.value;
                        updateActivePrediction(i, val === '' ? '' : Number(val));
                      }}
                      className="straty-stake"
                    />
                  </div>
                ) : (
                  <div />
                )}

                <div className="active-strat-status">
                  {!multiBuy &&
                  activeStrategies.length &&
                  currentStratIndex % activeStrategies.length === i &&
                  isRunning
                    ? '⏳ current'
                    : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="trading-container">
        <LazyYouTubeModal videoUrl={YT_URL} isOpen={ytOpen} onClose={() => setYtOpen(false)} />

        <div className="trading-panel-layout">
          <div className="trading-panel-layout__contract-settings">
            {/* Controls */}
            <div className="trade-controls">
              <div className="trade-control-group market-selector">
            <label>Market</label>
            <select
              value={market}
              onChange={e => setMarket(e.target.value)}
              disabled={isRunning || volSwitch}
              className="trade-input"
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
            <label>Default Stake</label>
            <input
              type="number"
              className="trade-input"
              value={stakeInput === '' ? '' : String(stakeInput)}
              onChange={e => setStakeInput(e.target.value === '' ? '' : Number(e.target.value))}
              min={0.01}
              step={0.01}
              disabled={isRunning}
            />
          </div>

              <div className="trade-control-group">
            <label>Martingale ×</label>
            <input
              type="number"
              className="trade-input"
              value={martingaleInput === '' ? '' : String(martingaleInput)}
              onChange={e => setMartingaleInput(e.target.value === '' ? '' : Number(e.target.value))}
              min={1}
              step={0.01}
              disabled={isRunning}
              title=">1 enables martingale; 1 disables"
            />
          </div>

              <div className="trade-control-group">
            <label>Ticks</label>
            <input
              type="number"
              className="trade-input"
              value={ticks}
              min={1}
              step={1}
              onChange={e => {
                const v = e.target.value;
                if (v === '') return setTicks('');
                const n = Number(v);
                if (!Number.isNaN(n)) setTicks(n);
              }}
              disabled={isRunning}
            />
          </div>

          {/* ✅ Manual entry point input */}
              <div className="trade-control-group">
            <label>Entry Point (digit)</label>
            <input
              type="number"
              className="trade-input"
              min={0}
              max={9}
              value={entryPointDigit === '' ? '' : String(entryPointDigit)}
              onChange={e => {
                const v = e.target.value;
                if (v === '') {
                  setEntryPointDigit('');
                  return;
                }
                const n = Math.max(0, Math.min(9, Math.floor(Number(v))));
                setEntryPointDigit(n);
              }}
              disabled={isRunning && multiBuy}
              title="Blank = buy immediately. Set 0-9 = bot waits until last digit matches before buying (single mode only)."
            />
          </div>

          {/* Default digit prediction */}
              <div className="trade-control-group">
            <label>Default Digit</label>
            <input
              type="number"
              className="trade-input"
              min={0}
              max={9}
              value={String(defaultDigitPrediction)}
              onChange={e => {
                const raw = Math.floor(Number(e.target.value || 0));
                const clamped = Math.max(0, Math.min(9, raw));
                setDefaultDigitPrediction(clamped);
              }}
              disabled={isRunning}
              title="Used when activating digit strategies"
            />
          </div>

          {/* Vol Switch */}
              <div className="trade-control-group" style={{ display: 'flex' }}>
            <button
              type="button"
              onClick={() => setVolSwitch(v => !v)}
              disabled={isRunning}
              className={`strat-btn ${volSwitch ? 'active' : ''}`}
              title="Rotate markets each trade/round"
              style={{
                border: '1px solid #333',
                background: volSwitch ? '#2e7d32' : '#424242',
                color: '#fff',
                alignItems: 'center',
                minHeight: 36,
              }}
            >
              {volSwitch ? 'Switch Markt: ON' : 'Switch Markt: OFF'}
            </button>
          </div>

          {/* Switch-on-loss toggle */}
              <div className="trade-control-group" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setSwitchOnLoss(v => !v)}
              disabled={isRunning || multiBuy}
              className={`strat-btn ${switchOnLoss ? 'active' : ''}`}
              title="When ON: switch to next strategy after N consecutive losses"
              style={{
                border: '1px solid #333',
                background: switchOnLoss ? '#2e7d32' : '#424242',
                color: '#fff',
                alignItems: 'center',
                minHeight: 36,
              }}
            >
              {switchOnLoss ? 'Switch on Loss: ON' : 'Switch on Loss: OFF'}
            </button>
          </div>

          {/* Main Mode toggle */}
              <div className="trade-control-group" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setMainMode(v => !v)}
              disabled={isRunning || multiBuy || activeStrategies.length < 2}
              className={`strat-btn ${mainMode ? 'active' : ''}`}
              title="When ON: first strategy is main; last strategy holds until a win"
              style={{
                border: '1px solid #333',
                background: mainMode ? '#2e7d32' : '#424242',
                color: '#fff',
                alignItems: 'center',
                minHeight: 36,
              }}
            >
              {mainMode ? 'Main Mode: ON' : 'Main Mode: OFF'}
            </button>
          </div>

          {/* Losses to switch */}
              <div className="trade-control-group" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label>Losses to switch</label>
            <input
              type="number"
              className="trade-input"
              min={1}
              step={1}
              value={lossesToSwitch === '' ? '' : String(lossesToSwitch)}
              onChange={e => {
                const v = e.target.value;
                if (v === '') setLossesToSwitch('');
                else setLossesToSwitch(Math.max(1, Math.floor(Number(v))));
              }}
              disabled={isRunning || !switchOnLoss || multiBuy}
              style={{ width: 96 }}
            />
          </div>

          {/* Multi-Buy (Turbo) */}
              <div className="trade-control-group" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => {
                setMultiBuy(v => {
                  const next = !v;

                  // when turbo turns on, entry point can't be used
                  if (next) {
                    pendingEntryRef.current = false;
                    pendingCfgRef.current = null;
                    closeTickWS();
                    setStatus('Turbo ON: Entry Point is ignored in Turbo mode', 'warning');
                  }

                  return next;
                });
              }}
              disabled={isRunning}
              className={`strat-btn ${multiBuy ? 'active' : ''}`}
              title="Buy all active strategies at once; martingale per strategy"
              style={{
                border: '1px solid #333',
                background: multiBuy ? '#2e7d32' : '#424242',
                color: '#fff',
                alignItems: 'center',
                minHeight: 36,
              }}
            >
              {multiBuy ? 'Turbo: ON' : 'Turbo: OFF'}
            </button>
          </div>

          {/* Turbo Runs input */}
              <div className="trade-control-group" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label>Rounds</label>
            <input
              type="number"
              className="trade-input"
              min={1}
              step={1}
              value={turboRuns === '' ? '' : String(turboRuns)}
              onChange={e => {
                const v = e.target.value;
                if (v === '') setTurboRuns('');
                else setTurboRuns(Math.max(1, Math.floor(Number(v))));
              }}
              disabled={isRunning || !multiBuy}
              style={{ width: 96 }}
            />
          </div>

          {/* Take Profit / Stop Loss */}
              <div className="trade-control-group">
            <label>Take Profit ($)</label>
            <input
              type="number"
              className="trade-input"
              min={0}
              step={0.01}
              value={takeProfit === '' ? '' : String(takeProfit)}
              onChange={e => setTakeProfit(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
              disabled={isRunning}
            />
          </div>
              <div className="trade-control-group">
            <label>Stop Loss ($)</label>
            <input
              type="number"
              className="trade-input"
              min={0}
              step={0.01}
              value={stopLoss === '' ? '' : String(stopLoss)}
              onChange={e => setStopLoss(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
              disabled={isRunning}
            />
          </div>

          {/* 2s delay toggle */}
              <div className="trade-control-group" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setDelayAfterSettle(v => !v)}
              className={`strat-btn ${delayAfterSettle ? 'active' : ''}`}
              title="When ON: waits 2s after a trade finishes before starting the next one"
              style={{
                border: '1px solid #333',
                background: delayAfterSettle ? '#2e7d32' : '#424242',
                color: '#fff',
                alignItems: 'center',
                minHeight: 36,
              }}
            >
              {delayAfterSettle ? 'Delay: ON' : 'Delay: OFF'}
            </button>
          </div>

              <div className="trade-control-group">
            <label
              className="start"
              style={{
                display: 'flex',
                alignItems: 'center',
                fontWeight: 'bold',
                fontSize: 15,
                gap: 4,
                cursor: 'pointer',
              }}
            >
              <LegacyPlayFillIcon width={20} height={20} /> Run
            </label>

            <button
              className={`auto-trade-toggle ${isRunning ? 'on' : 'off'}`}
              onClick={isRunning ? () => stopFlipaaBotRef.current() : () => startFlipaaBotRef.current()}
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
              title={
                delayAfterSettle
                  ? 'Delay ON: 2s after settle'
                  : 'Delay OFF: fast loop (per tick settlement for 1-tick trades) + RateLimit backoff'
              }
            >
              {isRunning ? 'ON' : 'OFF'}
            </button>
          </div>
            </div>
          </div>

          {/* Positions */}
          <div className="trading-panel-layout__results">
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
                        {isDigitContract(tr.contractType) && tr.barrier !== undefined && (
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

                    <FlipaaTrailingDelayProvider
                      walletLoginId={activeLoginid}
                      contractType={tr.contractType}
                      entryValue={tr.entryValue}
                      exitValue={tr.exitValue}
                    >
                      <div className="position-spots">
                        <div className="spot-entry">
                          <EntrySpotIcon />
                          {formatTickValue(tr.entryValue, tr.marketFormat)}
                        </div>
                        <div className="spot-exit">
                          <FlipaaPositionExitCell exitValue={tr.exitValue} marketFormat={tr.marketFormat} />
                        </div>
                      </div>

                      <div className="position-footer">
                        <div className="position-stake">{tr.stake.toFixed(2)} USD</div>
                        <FlipaaPositionResultCell tr={tr} />
                      </div>
                    </FlipaaTrailingDelayProvider>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      </div>

      {!isRunning && (
        <div className="reset-strip">
          <button
            className="reset-strip__btn"
            onClick={() => {
              if (isRunningRef.current) return;
              resetFlipaaHistory();
            }}
            title="Clear results and P/L"
          >
            Reset
          </button>
        </div>
      )}

      {/* Status & Stats */}
      <div className="trade-status">
        <div>{msg.txt}</div>
        <div style={{ marginTop: 6 }}>
          <span style={{ marginLeft: 12 }}>
            · Vol Switch: <b>{volSwitch ? 'on' : 'off'}</b>
          </span>
          <span style={{ marginLeft: 12 }}>
            · Mode: <b>{multiBuy ? 'Turbo (Batch)' : 'Switch on loss'}</b>
          </span>
          {!multiBuy && (
            <span style={{ marginLeft: 12 }}>
              · Entry Point: <b>{entryPointDigitRef.current == null ? 'off' : entryPointDigitRef.current}</b>
            </span>
          )}
          {multiBuy && (
            <span style={{ marginLeft: 12 }}>
              · Round remaining: <b>{currentRoundRemainingRef.current}</b>
            </span>
          )}
          <span style={{ marginLeft: 12 }}>
            · Session P/L: <b>{sessionPL >= 0 ? '+' : ''}{sessionPL.toFixed(2)}</b>
          </span>
          <span style={{ marginLeft: 12 }}>
            · Min buy gap: <b>{MIN_BUY_GAP_MS}ms (single)</b>
          </span>
          <span style={{ marginLeft: 12 }}>
            · Delay after settle: <b>{delayAfterSettle ? `2s` : 'off'}</b>
          </span>
          <span style={{ marginLeft: 12 }}>
            · RL backoff: <b>{rateLimitRef.current.until > Date.now() ? 'active' : 'idle'}</b>
          </span>
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
  );
}
