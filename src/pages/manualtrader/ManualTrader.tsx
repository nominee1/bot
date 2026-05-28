import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  CandlestickData,
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  IChartApi,
  LineSeries,
  LineStyle,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { api_base } from '@/external/bot-skeleton';
import { useApiBase } from '@/hooks/useApiBase';
import { useDerivVisualTickApi } from '@/hooks/useDerivVisualTickApi';
import { useStore } from '@/hooks/useStore';
import {
  decideFlipVirtualPair,
  type FlipVirtStrategyType,
  MAX_SESSION_LOSSES,
  ONLY_RUN_MAX_CONSECUTIVE_LOSSES,
  updateAfterFactGovernor,
  type VirtTick,
} from '@/pages/aaflipaa/flipaaVirtualDecision';
import {
  ALLOWED_BOT_IFRAME_LOGINID,
  isCrVirtualShadowLogin,
  runWithCrShadowLock,
  tryDebitCrShadowSync,
} from '@/utils/crVirtualBalanceShadow';
import { cr7557018ShouldDeferExitAndPayoutDisplay } from '@/utils/cr7557018DelayedPositionContracts';
import { scheduleCrChanceLedgerRoundTrip } from '@/utils/chanceVirtualStatements';
import {
  applyDerivSessionMarketField,
  sendDerivSessionContractPurchase,
} from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import {
  CHART_MA_DEFAULT_ENABLED,
  CHART_MA_SPECS,
  computeSmaFromCandles,
} from '@/pages/manualtrader/manualTraderChartIndicators';
import {
  buildForecastProjectionLine,
  buildPositionForecast,
  MA_FORECAST_FAST_PERIOD,
  MA_FORECAST_SLOW_PERIOD,
  type PositionForecastConfig,
  type PositionForecastResult,
} from '@/pages/manualtrader/manualTraderPositionForecast';
import {
  forgetDerivSubscription,
  isAlreadySubscribedTickError,
  recoverDerivLiveTickStream,
} from '@/utils/derivTickStream';
import {
  manualTraderFormatQuoteForDigitContract,
  manualTraderLastDigitFromQuote,
  manualTraderResolveDigitTickDecimals,
} from './manualTraderTickDigitFormat';
import {
  MarketDerivedVolatility10Icon,
  MarketDerivedVolatility25Icon,
  MarketDerivedVolatility50Icon,
  MarketDerivedVolatility75Icon,
  MarketDerivedVolatility100Icon,
  MarketDerivedVolatility101sIcon,
  MarketDerivedVolatility251sIcon,
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
import './ManualTrader.scss';

type ContractType =
  | 'CALL'
  | 'PUT'
  | 'DIGITEVEN'
  | 'DIGITODD'
  | 'DIGITMATCH'
  | 'DIGITDIFF'
  | 'DIGITOVER'
  | 'DIGITUNDER'
  | 'RUNHIGH'
  | 'RUNLOW'
  | 'PUTE'
  | 'CALLE';

/** Strategy keys — same as `BotIframe` `mapContracts` / proposal payloads */
type ManualStrategyKey =
  | 'even'
  | 'odd'
  | 'matches'
  | 'differs'
  | 'over'
  | 'under'
  | 'rise'
  | 'fall'
  | 'onlyups'
  | 'onlydowns'
  | 'rise_equals'
  | 'fall_equals';

function mapManualStrategyContracts(s: ManualStrategyKey): { left: ContractType; right: ContractType } {
  const pairs: Record<ManualStrategyKey, { left: ContractType; right: ContractType }> = {
    even: { left: 'DIGITEVEN', right: 'DIGITODD' },
    odd: { left: 'DIGITODD', right: 'DIGITEVEN' },
    matches: { left: 'DIGITMATCH', right: 'DIGITDIFF' },
    differs: { left: 'DIGITDIFF', right: 'DIGITMATCH' },
    over: { left: 'DIGITOVER', right: 'DIGITUNDER' },
    under: { left: 'DIGITUNDER', right: 'DIGITOVER' },
    rise: { left: 'CALL', right: 'PUT' },
    fall: { left: 'PUT', right: 'CALL' },
    onlyups: { left: 'RUNHIGH', right: 'RUNLOW' },
    onlydowns: { left: 'RUNLOW', right: 'RUNHIGH' },
    rise_equals: { left: 'PUTE', right: 'CALLE' },
    fall_equals: { left: 'CALLE', right: 'PUTE' },
  };
  return pairs[s];
}

function strategyNeedsDigit(s: ManualStrategyKey): boolean {
  return ['matches', 'differs', 'over', 'under'].includes(s);
}

function minTicksForContract(ct: ContractType): number {
  if (ct === 'RUNHIGH' || ct === 'RUNLOW') return 2;
  return 1;
}

/** Deriv minimum duration when `duration_unit` is ticks — matches BotIframe `minTicksForContract` usage */
function minDurationForStrategy(unit: DurationUnit, left: ContractType, right: ContractType): number {
  if (unit !== 't') return 1;
  return Math.max(minTicksForContract(left), minTicksForContract(right));
}

type TradeRow = {
  id: string;
  contractType: ContractType;
  stake: number;
  duration: number;
  durationUnit?: DurationUnit;
  source: 'manual' | 'auto';
  status: 'pending' | 'open' | 'won' | 'lost' | 'error';
  profit?: number;
  /** Live sell-back value from `proposal_open_contract` (`bid_price`). */
  contractValue?: number;
  /** Early close — Rise/Fall in minutes when Deriv allows sell. */
  isSellAllowed?: boolean;
  exitEpoch?: number;
  expiryEpoch?: number;
  /** Entry spot — matches BotIframe panel */
  entryPrice?: number;
  /** Entry candle time (epoch sec) — for chart markers at trade open (left on timeline) */
  entryEpoch?: number;
  /** Exit spot (tick) — anchors chart marker to exact Y on the series */
  exitPrice?: number;
  /** Digit barrier for Over/Under — aligned with BotIframe */
  barrier?: number;
};

const pickExitPriceFromContract = (c: any): number | undefined => {
  const v = Number(c.exit_tick ?? c.exit_spot ?? c.sell_price ?? c.bid_price ?? NaN);
  return Number.isFinite(v) ? v : undefined;
};

const pickEntryPriceFromContract = (c: any): number | undefined => {
  const v = Number(c.entry_tick ?? NaN);
  return Number.isFinite(v) ? v : undefined;
};

const pickEntryEpochFromContract = (c: any): number | undefined => {
  const v = Number(c.entry_tick_time ?? c.date_start ?? c.purchase_time ?? NaN);
  return Number.isFinite(v) ? Math.floor(v) : undefined;
};

const pickContractValueFromContract = (c: any): number | undefined => {
  const v = Number(c.bid_price ?? c.sell_price ?? NaN);
  return Number.isFinite(v) ? v : undefined;
};

function isDirectionalRiseFallContract(ct: ContractType): boolean {
  return ct === 'CALL' || ct === 'PUT' || ct === 'PUTE' || ct === 'CALLE';
}

function canSellManualTradeRow(t: TradeRow): boolean {
  return (
    !!t.isSellAllowed &&
    t.durationUnit === 'm' &&
    isDirectionalRiseFallContract(t.contractType) &&
    (t.status === 'open' || t.status === 'pending') &&
    !String(t.id).startsWith('tmp') &&
    !String(t.id).startsWith('v-')
  );
}

const formatTickValue = (value: number | undefined, marketFmt: string) => {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return manualTraderFormatQuoteForDigitContract(value, marketFmt);
};

const formatRemainingContractDuration = (secondsRemaining: number): string => {
  if (!Number.isFinite(secondsRemaining) || secondsRemaining <= 0) return '00:00';
  const totalSeconds = Math.max(0, Math.ceil(secondsRemaining));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const ManualTrailingDelayContext = createContext(true);

/** CR7557018 + directional contracts: defer exit spot + P/L display 1s after entry+exit exist (display-only). */
function ManualTrailingDelayProvider({
  walletLoginId,
  contractType,
  entryPrice,
  exitPrice,
  children,
}: {
  walletLoginId: string | undefined;
  contractType: ContractType;
  entryPrice?: number;
  exitPrice?: number;
  children: ReactNode;
}) {
  const delayTrailing = cr7557018ShouldDeferExitAndPayoutDisplay(walletLoginId, contractType);

  const [showTrailing, setShowTrailing] = useState(!delayTrailing);

  useEffect(() => {
    if (!delayTrailing) {
      setShowTrailing(true);
      return;
    }
    if (
      entryPrice === undefined ||
      !Number.isFinite(entryPrice) ||
      exitPrice === undefined ||
      !Number.isFinite(exitPrice)
    ) {
      setShowTrailing(false);
      return;
    }
    setShowTrailing(false);
    const tid = window.setTimeout(() => setShowTrailing(true), 1000);
    return () => window.clearTimeout(tid);
  }, [delayTrailing, contractType, entryPrice, exitPrice]);

  return (
    <ManualTrailingDelayContext.Provider value={showTrailing}>{children}</ManualTrailingDelayContext.Provider>
  );
}

function ManualPositionExitCell({ exitPrice, symbol }: { exitPrice?: number; symbol: string }) {
  const showTrailing = useContext(ManualTrailingDelayContext);
  const v = showTrailing ? exitPrice : undefined;
  return (
    <>
      <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
        <circle cx={8} cy={8} r={6} stroke="#999999" strokeWidth={1.5} fill="white" />
      </svg>
      {formatTickValue(v, symbol)}
    </>
  );
}

function ManualPositionResultCell({ trade }: { trade: TradeRow }) {
  const showTrailing = useContext(ManualTrailingDelayContext);
  const hideSettledPayout =
    !showTrailing && (trade.status === 'won' || trade.status === 'lost') && trade.profit !== undefined;
  const liveOpen =
    (trade.status === 'open' || trade.status === 'pending') && typeof trade.profit === 'number';
  const waitingPnl = !liveOpen && (trade.status === 'pending' || hideSettledPayout);

  return (
    <div
      className={`manual-trader__order-result ${
        waitingPnl
          ? 'manual-trader__order-result--pending'
          : trade.status === 'error'
            ? 'manual-trader__order-result--loss'
            : typeof trade.profit === 'number'
              ? trade.profit >= 0
                ? 'manual-trader__order-result--profit'
                : 'manual-trader__order-result--loss'
              : ''
      }`}
    >
      {waitingPnl
        ? '...'
        : trade.status === 'error'
          ? 'Failed'
          : typeof trade.profit === 'number'
            ? `${trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(2)}`
            : '—'}
    </div>
  );
}

/** Same as DBot: `toFixed(pipSize)` from `active_symbols`, then last decimal digit. */
const extractLastDigit = (val: number, market: string): number | null => {
  const d = manualTraderLastDigitFromQuote(val, market);
  return Number.isFinite(d) && d >= 0 && d <= 9 ? d : null;
};

/** Vol 100 (1s) — `1HZ100V`. */
const MANUAL_TRADER_DEFAULT_MARKET = '1HZ100V';
/** Rolling tick/candle window plotted on the chart (24 hours). */
const CHART_HISTORY_WINDOW_SEC = 24 * 60 * 60;
const CHART_LOAD_RETRY_MS = 10_000;
const CHART_LOAD_FAIL_MS = 22_000;
const CHART_SUBSCRIBE_MAX_ATTEMPTS = 2;
/** Empty space to the right of the latest candle (~2rem). */
const CHART_RIGHT_EDGE_GAP_REM = 2;

const chartHistoryStartEpochSec = () => Math.floor(Date.now() / 1000) - CHART_HISTORY_WINDOW_SEC;

const chartLoadingMessage = (marketLabel: string) =>
  `Loading Denara chart (${marketLabel})…`;

const chartRetryMessage = (marketLabel: string) => `Still loading (${marketLabel})…`;

const chartChooseAnotherMarketMessage = () =>
  "This market couldn't load. Please choose another market from the list above.";

const isOneSecondVolatilitySymbol = (symbol: string) => /^1HZ\d+V$/i.test(symbol);

/** 1-minute OHLC bars — 24 hr ≈ 1440 candles (Deriv `granularity` is seconds). */
const CHART_CANDLE_GRANULARITY_SEC = 60;
const CHART_CANDLES_PER_WINDOW = (24 * 60) as number;

/** Candle `count` fallbacks when `start`/`end` is rejected. */
const chartCandleCountFallbacks = (): number[] => [CHART_CANDLES_PER_WINDOW, 1200, 960, 720];

/** Digit dock appearance window — same as BotIframe `ANALYSIS_HISTORY_TICK_COUNT`. */
const DIGIT_DOCK_HISTORY_TICK_COUNT = 1000;

/** Tick `count` per page when back-filling chart tick history (API caps ~5000 ticks/request). */
const DIGIT_STATS_TICK_PAGE = 5000;

/** Max ticks per history request (Deriv playground: `count` + `start` + `adjust_start_time`). */
const CHART_TICK_HISTORY_COUNT = 50000;

/** Paginated digit back-fill pages (~1 tick/s × 24h ≈ 86k ticks). */
const CHART_DIGIT_STATS_MAX_PAGES = Math.ceil(CHART_HISTORY_WINDOW_SEC / DIGIT_STATS_TICK_PAGE) + 1;

const logManualTraderChart = (symbol: string, label: string, detail?: Record<string, unknown>) => {
  if (detail !== undefined) {
    console.log(`[ManualTrader chart ${symbol}] ${label}`, detail);
  } else {
    console.log(`[ManualTrader chart ${symbol}] ${label}`);
  }
};

const CHART_TICK_STALL_RECOVER_MS = 25_000;
const CHART_TICK_WATCH_INTERVAL_MS = 5_000;

const extractTickHistoryPayload = (data: unknown): { prices: number[]; times: number[] } | null => {
  if (!data || typeof data !== 'object') return null;
  const root = data as { error?: unknown; history?: { prices?: unknown; times?: unknown } };
  if (root.error) return null;
  const hist = root.history;
  if (!hist || !Array.isArray(hist.prices) || !hist.prices.length) return null;
  if (!Array.isArray(hist.times) || hist.times.length !== hist.prices.length) return null;

  const prices: number[] = [];
  const times: number[] = [];
  for (let i = 0; i < hist.prices.length; i++) {
    const p = Number(hist.prices[i]);
    const t = Number(hist.times[i]);
    if (Number.isFinite(p) && Number.isFinite(t)) {
      prices.push(p);
      times.push(t);
    }
  }
  return prices.length ? { prices, times } : null;
};

/** Deriv tick epochs are seconds; guard against ms values. */
const normalizeTickEpochSec = (epoch: number): number => {
  if (!Number.isFinite(epoch)) return NaN;
  if (epoch > 1e12) return Math.floor(epoch / 1000);
  return Math.floor(epoch);
};

const trimTicksToChartWindow = (prices: number[], times: number[]): { prices: number[]; times: number[] } => {
  const start = chartHistoryStartEpochSec();
  const outP: number[] = [];
  const outT: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    const ep = normalizeTickEpochSec(Number(times[i]));
    const q = Number(prices[i]);
    if (Number.isFinite(q) && Number.isFinite(ep) && ep >= start) {
      outP.push(q);
      outT.push(ep);
    }
  }
  if (outP.length) return { prices: outP, times: outT };
  return { prices, times };
};

const buildChartTicksHistoryReq = (
  symbol: string,
  subscribe: 0 | 1,
  opts?: { count?: number; end?: number | 'latest'; plotWindow?: boolean }
): Record<string, unknown> => {
  if (opts?.plotWindow) {
    const req: Record<string, unknown> = {
      ticks_history: symbol,
      style: 'ticks',
      start: chartHistoryStartEpochSec(),
      end: 'latest',
      count: opts.count ?? CHART_TICK_HISTORY_COUNT,
      subscribe,
    };
    if (!isOneSecondVolatilitySymbol(symbol)) {
      req.adjust_start_time = 1;
    }
    return req;
  }

  const req: Record<string, unknown> = {
    ticks_history: symbol,
    style: 'ticks',
    count: opts?.count ?? DIGIT_STATS_TICK_PAGE,
    end: opts?.end ?? 'latest',
    subscribe,
  };
  if (!isOneSecondVolatilitySymbol(symbol)) {
    req.adjust_start_time = 1;
  }
  return req;
};

const buildChartCandlesHistoryReq = (
  symbol: string,
  subscribe: 0 | 1,
  opts?: { count?: number }
): Record<string, unknown> => {
  if (opts?.count != null) {
    return {
      ticks_history: symbol,
      style: 'candles',
      granularity: CHART_CANDLE_GRANULARITY_SEC,
      count: opts.count,
      end: 'latest',
      subscribe,
    };
  }
  return {
    ticks_history: symbol,
    style: 'candles',
    granularity: CHART_CANDLE_GRANULARITY_SEC,
    start: chartHistoryStartEpochSec(),
    end: 'latest',
    subscribe,
  };
};

const extractCandleHistoryPayload = (data: unknown): CandlestickData[] | null => {
  if (!data || typeof data !== 'object') return null;
  const root = data as {
    error?: unknown;
    candles?: Array<Record<string, unknown>>;
    history?: { candles?: Array<Record<string, unknown>> };
  };
  if (root.error) return null;
  const raw = root.candles ?? root.history?.candles;
  if (!Array.isArray(raw) || !raw.length) return null;

  const out: CandlestickData[] = [];
  for (const c of raw) {
    const epoch = normalizeTickEpochSec(Number(c.open_time ?? c.epoch));
    const open = Number(c.open);
    const high = Number(c.high);
    const low = Number(c.low);
    const close = Number(c.close);
    if (![open, high, low, close, epoch].every(Number.isFinite)) continue;
    out.push({
      time: epoch as UTCTimestamp,
      open,
      high,
      low,
      close,
    });
  }
  return out.length ? out : null;
};

const trimCandlesToChartWindow = (candles: CandlestickData[]): CandlestickData[] => {
  const start = chartHistoryStartEpochSec();
  const trimmed = candles.filter(c => Number(c.time) >= start);
  return trimmed.length ? trimmed : candles;
};

/** Aggregate tick history into OHLC candles for lightweight-charts `setData`. */
const buildMinuteCandlesFromTicks = (
  prices: number[],
  times: number[],
  bucketSizeSec: number
): CandlestickData[] => {
  const candles: CandlestickData[] = [];
  let cur: CandlestickData | null = null;

  for (let i = 0; i < prices.length; i++) {
    const quote = Number(prices[i]);
    const epoch = normalizeTickEpochSec(Number(times[i]));
    if (!Number.isFinite(quote) || !Number.isFinite(epoch)) continue;

    const bucket = Math.floor(epoch / bucketSizeSec) * bucketSizeSec;
    if (!cur || Number(cur.time) !== bucket) {
      if (cur) candles.push(cur);
      cur = {
        time: bucket as UTCTimestamp,
        open: quote,
        high: quote,
        low: quote,
        close: quote,
      };
    } else {
      cur.high = Math.max(cur.high, quote);
      cur.low = Math.min(cur.low, quote);
      cur.close = quote;
    }
  }
  if (cur) candles.push(cur);
  return candles;
};

/** Gap before the next auto trade after settlement — CR7557018 virtual settles instantly otherwise chains too fast. */
const AUTO_CHAIN_GAP_MS_CR_VIRTUAL = 1200;

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

function contractTypeToFlipStrategy(ct: ContractType): FlipVirtStrategyType | null {
  switch (ct) {
    case 'CALL':
      return 'rise';
    case 'PUT':
      return 'fall';
    case 'DIGITEVEN':
      return 'even';
    case 'DIGITODD':
      return 'odd';
    case 'DIGITMATCH':
      return 'matches';
    case 'DIGITDIFF':
      return 'differs';
    case 'DIGITOVER':
      return 'over';
    case 'DIGITUNDER':
      return 'under';
    case 'RUNHIGH':
      return 'only_up';
    case 'RUNLOW':
      return 'only_down';
    case 'PUTE':
      return 'rise_equals';
    case 'CALLE':
      return 'fall_equals';
    default:
      return null;
  }
}

function contractNeedsBarrier(ct: ContractType): boolean {
  return ct === 'DIGITOVER' || ct === 'DIGITUNDER' || ct === 'DIGITMATCH' || ct === 'DIGITDIFF';
}

function isDirectionalDisplayContract(ct: ContractType): boolean {
  return ct === 'CALL' || ct === 'PUT' || ct === 'CALLE' || ct === 'PUTE' || ct === 'RUNHIGH' || ct === 'RUNLOW';
}

function isDigitContractType(ct: ContractType): boolean {
  return (
    ct === 'DIGITEVEN' ||
    ct === 'DIGITODD' ||
    ct === 'DIGITMATCH' ||
    ct === 'DIGITDIFF' ||
    ct === 'DIGITOVER' ||
    ct === 'DIGITUNDER'
  );
}

/** Mid-trade win tint for Rise/Fall and Rise=/Fall= vs entry spot */
function directionalMidFlightWin(ct: ContractType, entry: number, quote: number): boolean {
  switch (ct) {
    case 'CALL':
      return quote > entry;
    case 'PUT':
      return quote < entry;
    case 'PUTE':
      return quote >= entry;
    case 'CALLE':
      return quote <= entry;
    default:
      return false;
  }
}

/** Live P/L hint on digit dock vs latest tick last digit */
function digitLiveWinning(ct: ContractType, barrier: number | undefined, lastDigit: number): boolean | null {
  switch (ct) {
    case 'DIGITEVEN':
      return lastDigit % 2 === 0;
    case 'DIGITODD':
      return lastDigit % 2 !== 0;
    case 'DIGITMATCH':
      return barrier !== undefined ? lastDigit === barrier : null;
    case 'DIGITDIFF':
      return barrier !== undefined ? lastDigit !== barrier : null;
    case 'DIGITOVER':
      return barrier !== undefined ? lastDigit > barrier : null;
    case 'DIGITUNDER':
      return barrier !== undefined ? lastDigit < barrier : null;
    default:
      return null;
  }
}

const SYMBOLS = [
  'R_10',
  'R_25',
  'R_50',
  'R_75',
  'R_100',
  '1HZ10V',
  '1HZ25V',
  '1HZ50V',
  '1HZ75V',
  '1HZ90V',
  '1HZ100V',
];
const QUICK_STAKES = [1, 5, 10, 25, 50, 100];
const BARRIER_DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

type DurationUnit = 't' | 'm';

/** Tick-count window for virtual resolution (flipaa-style); minutes → rough tick count. */
function effectiveVirtDurationTicks(dur: number, durationUnit: DurationUnit): number {
  if (durationUnit === 't') return Math.max(1, Math.floor(dur));
  return Math.max(2, Math.round(dur * 60));
}

const CONTRACT_LABEL: Record<ContractType, string> = {
  CALL: 'Rise',
  PUT: 'Fall',
  DIGITEVEN: 'Even',
  DIGITODD: 'Odd',
  DIGITMATCH: 'Matches',
  DIGITDIFF: 'Differs',
  DIGITOVER: 'Over',
  DIGITUNDER: 'Under',
  RUNHIGH: 'Only Ups',
  RUNLOW: 'Only Downs',
  PUTE: 'Rise Equals',
  CALLE: 'Fall Equals',
};

function ContractTypeIcon({ ct, size = 16 }: { ct: ContractType; size?: number }) {
  switch (ct) {
    case 'CALL':
      return <TradeTypesUpsAndDownsRiseIcon width={size} height={size} />;
    case 'PUT':
      return <TradeTypesUpsAndDownsFallIcon width={size} height={size} />;
    case 'DIGITEVEN':
      return <TradeTypesDigitsEvenIcon width={size} height={size} />;
    case 'DIGITODD':
      return <TradeTypesDigitsOddIcon width={size} height={size} />;
    case 'DIGITMATCH':
      return <TradeTypesDigitsMatchesIcon width={size} height={size} />;
    case 'DIGITDIFF':
      return <TradeTypesDigitsDiffersIcon width={size} height={size} />;
    case 'DIGITOVER':
      return <TradeTypesDigitsOverIcon width={size} height={size} />;
    case 'DIGITUNDER':
      return <TradeTypesDigitsUnderIcon width={size} height={size} />;
    case 'PUTE':
      return <TradeTypesUpsAndDownsRiseIcon width={size} height={size} />;
    case 'CALLE':
      return <TradeTypesUpsAndDownsFallIcon width={size} height={size} />;
    case 'RUNHIGH':
      return <TradeTypesUpsAndDownsRiseIcon width={size} height={size} />;
    case 'RUNLOW':
      return <TradeTypesUpsAndDownsFallIcon width={size} height={size} />;
  }
}

const UI_THEME_STORAGE_KEY = 'manual-trader-ui-theme';
type UiTheme = 'light' | 'dark';

function IconSun({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function IconMoon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

const MARKET_META: Record<string, { label: string; icon: JSX.Element }> = {
  '1HZ10V': { label: 'Vol 10 (1s)', icon: <MarketDerivedVolatility101sIcon width={16} height={16} /> },
  '1HZ25V': { label: 'Vol 25 (1s)', icon: <MarketDerivedVolatility251sIcon width={16} height={16} /> },
  '1HZ50V': { label: 'Vol 50 (1s)', icon: <MarketDerivedVolatility501sIcon width={16} height={16} /> },
  '1HZ75V': { label: 'Vol 75 (1s)', icon: <MarketDerivedVolatility751sIcon width={16} height={16} /> },
  '1HZ90V': { label: 'Vol 90 (1s)', icon: <MarketDerivedVolatility901sIcon width={16} height={16} /> },
  '1HZ100V': { label: 'Vol 100 (1s)', icon: <MarketDerivedVolatility1001sIcon width={16} height={16} /> },
  R_10: { label: 'Vol 10', icon: <MarketDerivedVolatility10Icon width={16} height={16} /> },
  R_25: { label: 'Vol 25', icon: <MarketDerivedVolatility25Icon width={16} height={16} /> },
  R_50: { label: 'Vol 50', icon: <MarketDerivedVolatility50Icon width={16} height={16} /> },
  R_75: { label: 'Vol 75', icon: <MarketDerivedVolatility75Icon width={16} height={16} /> },
  R_100: { label: 'Vol 100', icon: <MarketDerivedVolatility100Icon width={16} height={16} /> },
};

export default function ManualTrader() {
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const maSeriesRef = useRef<Map<number, ISeriesApi<'Line'>>>(new Map());
  const forecastSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const seriesMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const subscribedChartSymbolRef = useRef<string | null>(null);
  /** Bumped on each market / socket change so stale async subscribe + WS messages are ignored. */
  const chartStreamOpRef = useRef(0);
  const chartSubscriptionIdRef = useRef<string | null>(null);
  const chartSubscribeInFlightRef = useRef(false);
  const currentCandleRef = useRef<CandlestickData | null>(null);

  const [symbol, setSymbol] = useState(MANUAL_TRADER_DEFAULT_MARKET);
  const [manualStrategy, setManualStrategy] = useState<ManualStrategyKey>('rise');
  const prevManualStrategyRef = useRef<ManualStrategyKey>('rise');
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('t');
  const [overUnderDigit, setOverUnderDigit] = useState(2);
  const [duration, setDuration] = useState<number | ''>(1);
  const [stake, setStake] = useState<number | ''>(1);
  const [, setStatus] = useState('Idle');
  const [isBuying, setIsBuying] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  /** Until first `history` fills candles after connect / symbol change */
  const [chartHistoryLoading, setChartHistoryLoading] = useState(true);
  const [chartLoadMessage, setChartLoadMessage] = useState('Loading Denara chart…');
  const [maEnabled, setMaEnabled] = useState<Record<number, boolean>>(() => ({ ...CHART_MA_DEFAULT_ENABLED }));
  const [chartIndicatorsExpanded, setChartIndicatorsExpanded] = useState(false);
  const [positionForecastEnabled, setPositionForecastEnabled] = useState(false);
  const [positionForecast, setPositionForecast] = useState<PositionForecastResult | null>(null);
  const [forecastConfig, setForecastConfig] = useState<PositionForecastConfig>({
    useRsiSignal: false,
    useStructureSignal: false,
  });
  const chartHistoryReadyRef = useRef(false);
  const [uiTheme, setUiTheme] = useState<UiTheme>(() => {
    if (typeof window === 'undefined') return 'light';
    try {
      const s = window.localStorage.getItem(UI_THEME_STORAGE_KEY);
      if (s === 'dark' || s === 'light') return s;
    } catch {
      /* private mode etc. */
    }
    return 'light';
  });
  const candleSizeMin = 1;
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const tradesRef = useRef<TradeRow[]>([]);
  tradesRef.current = trades;

  /** Latest quote from WS — drives live price line + mid-trade visuals */
  const [liveTick, setLiveTick] = useState<{ q: number; e: number } | null>(null);
  /** Tick-to-tick markers for Only Ups / Only Downs while position is open */
  const [runTrailMarkers, setRunTrailMarkers] = useState<SeriesMarker<Time>[]>([]);
  /** Brief pulse on prediction digit when a barrier-digit trade settles (BotIframe-style cue) */
  const [settlementBarrierPulse, setSettlementBarrierPulse] = useState<number | null>(null);

  const entryPriceLineRef = useRef<IPriceLine | null>(null);
  const forecastEntryLineRef = useRef<IPriceLine | null>(null);
  const liveQuotePriceLineRef = useRef<IPriceLine | null>(null);
  const [sellingContractId, setSellingContractId] = useState<string | null>(null);
  const runTrailTradeIdRef = useRef<string | null>(null);
  const prevRunQuoteRef = useRef<number | null>(null);
  const settledBarrierBlinkRef = useRef<Set<string>>(new Set());
  const barrierPulseClearTimerRef = useRef<number | null>(null);

  const [payouts, setPayouts] = useState<Partial<Record<ContractType, number>>>({});
  const [positionsView, setPositionsView] = useState<'transactions' | 'closed'>('transactions');
  const [modeView, setModeView] = useState<'auto' | 'manual'>('manual');
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoDirection, setAutoDirection] = useState<ContractType>('CALL');
  const [martingale, setMartingale] = useState<number | ''>(1.25);
  const [maxMartingaleSteps] = useState<number | ''>(7);
  const [targetProfit, setTargetProfit] = useState<number | ''>('');
  const [stopLoss, setStopLoss] = useState<number | ''>('');
  const [autoStake, setAutoStake] = useState<number>(1);
  const autoContractIdRef = useRef<string | null>(null);
  const autoStepRef = useRef(0);
  const autoBaseStakeRef = useRef(1);

  const { activeLoginid, tradingSocketGeneration } = useApiBase();
  const { visualTickApi, visualTickReady, visualTickApiRef } = useDerivVisualTickApi();
  const rootStore = useStore();
  const client = rootStore?.client;
  const activeLoginidRef = useRef<string | undefined>(undefined);
  const clientRef = useRef(client);
  clientRef.current = client;
  useEffect(() => {
    activeLoginidRef.current = activeLoginid;
  }, [activeLoginid]);

  /** CR7557018 virtual ticks — fed from chart WS; flipaa-style outcome resolution */
  const virtTickBufferRef = useRef<VirtTick[]>([]);
  const virtTickEpochRef = useRef<number | null>(null);
  const virtTickMktRef = useRef<string>('');
  const virtTradeInFlightRef = useRef(false);
  const sessionLossesVirtRef = useRef(0);
  const afterFactSuppressedRef = useRef(false);
  const afterFactWinStreakRef = useRef(0);
  const naturalLossStreakRef = useRef(0);
  const onlyRunLossStreakVirtRef = useRef<{ only_up: number; only_down: number }>({ only_up: 0, only_down: 0 });

  // Digit appearance (last 1000 ticks) dock — computed from tick quotes.
  // This mirrors BotIframe's "digitCounts" approach, but keeps only the 3 ranks we need.
  const tickDigitsRef = useRef<number[]>([]);
  const tickDigitEpochsRef = useRef<number[]>([]);
  const tickDigitCountsRef = useRef<number[]>(Array(10).fill(0));
  const chartRollingPricesRef = useRef<number[]>([]);
  const chartRollingTimesRef = useRef<number[]>([]);
  const chartRollingCandlesRef = useRef<CandlestickData[]>([]);
  const digitDockUpdateTimerRef = useRef<number | null>(null);

  const [digitDockRanks, setDigitDockRanks] = useState<{
    most: number | null;
    least: number | null;
    third: number | null;
  }>({ most: null, least: null, third: null });

  const [latestTickDigit, setLatestTickDigit] = useState<number | null>(null);

  const refreshChartMarkers = useCallback(() => {
    if (!candleSeriesRef.current) return;

    const winColor = uiTheme === 'dark' ? '#4ade80' : '#16a34a';
    const loseColor = uiTheme === 'dark' ? '#fb7185' : '#dc2626';

    /**
     * Won: marker at entry (left on time axis) below the bar — arrowUp points into the candle.
     * Lost: marker at exit above the bar — arrowDown points into the candle.
     */
    const toMarker = (t: TradeRow): SeriesMarker<Time> | null => {
      if ((t.status !== 'won' && t.status !== 'lost') || !Number.isFinite(t.exitEpoch)) return null;
      const exitTime = Math.floor(Number(t.exitEpoch)) as UTCTimestamp;
      const won = t.status === 'won';

      if (won) {
        const hasEntry =
          t.entryEpoch !== undefined &&
          Number.isFinite(t.entryEpoch) &&
          t.entryPrice !== undefined &&
          Number.isFinite(t.entryPrice);
        const time = hasEntry ? (Math.floor(Number(t.entryEpoch)) as UTCTimestamp) : exitTime;
        const ep = t.entryPrice;
        if (hasEntry && ep !== undefined && Number.isFinite(ep)) {
          return {
            id: t.id,
            time,
            position: 'belowBar',
            shape: 'arrowUp',
            color: winColor,
            price: ep,
            size: 0.42,
          };
        }
        return {
          id: t.id,
          time: exitTime,
          position: 'belowBar',
          shape: 'arrowUp',
          color: winColor,
          size: 0.4,
        };
      }

      const px = t.exitPrice;
      if (px !== undefined && Number.isFinite(px)) {
        return {
          id: t.id,
          time: exitTime,
          position: 'aboveBar',
          shape: 'arrowDown',
          color: loseColor,
          price: px,
          size: 0.42,
        };
      }
      return {
        id: t.id,
        time: exitTime,
        position: 'aboveBar',
        shape: 'arrowDown',
        color: loseColor,
        size: 0.4,
      };
    };

    const settledMarkers = trades.map(toMarker).filter((m): m is SeriesMarker<Time> => m !== null);

    const forecastMarkers: SeriesMarker<Time>[] = [];
    if (positionForecastEnabled && positionForecast?.slots.length) {
      const candles = chartRollingCandlesRef.current;
      const last = candles[candles.length - 1];
      const lastTime = last ? Number(last.time) : NaN;
      const bucketSec = candleSizeMin * 60;
      const upColor = uiTheme === 'dark' ? 'rgba(52, 211, 153, 0.72)' : 'rgba(22, 163, 74, 0.72)';
      const downColor = uiTheme === 'dark' ? 'rgba(248, 113, 113, 0.72)' : 'rgba(220, 38, 38, 0.72)';

      if (Number.isFinite(lastTime)) {
        for (const slot of positionForecast.slots) {
          const time = (lastTime + slot.minuteOffset * bucketSec) as UTCTimestamp;
          const bullish = slot.direction === 'up';
          forecastMarkers.push({
            id: `forecast-${slot.minuteOffset}`,
            time,
            position: bullish ? 'belowBar' : 'aboveBar',
            shape: bullish ? 'arrowUp' : 'arrowDown',
            color: bullish ? upColor : downColor,
            size: 0.34 + slot.strength * 0.12,
          });
        }
      }
    }

    seriesMarkersRef.current?.setMarkers([...runTrailMarkers, ...settledMarkers, ...forecastMarkers]);
  }, [trades, uiTheme, runTrailMarkers, positionForecastEnabled, positionForecast, candleSizeMin]);

  const contractPair = useMemo(() => mapManualStrategyContracts(manualStrategy), [manualStrategy]);

  const minDurationTicks = useMemo(
    () => minDurationForStrategy(durationUnit, contractPair.left, contractPair.right),
    [durationUnit, contractPair.left, contractPair.right]
  );

  useEffect(() => {
    if (typeof duration !== 'number' || !Number.isFinite(duration)) return;
    if (duration < minDurationTicks) setDuration(minDurationTicks);
  }, [minDurationTicks, duration]);

  const canBuy = useMemo(() => {
    const okStake = typeof stake === 'number' && Number.isFinite(stake) && stake >= 0.35;
    const okDuration =
      typeof duration === 'number' && Number.isFinite(duration) && duration >= minDurationTicks;
    const okDigit =
      !strategyNeedsDigit(manualStrategy) ||
      (Number.isFinite(overUnderDigit) && overUnderDigit >= 0 && overUnderDigit <= 9);
    return okStake && okDuration && okDigit && isConnected && !isBuying;
  }, [stake, duration, minDurationTicks, manualStrategy, overUnderDigit, isConnected, isBuying]);

  const closedTrades = useMemo(
    () => trades.filter(t => t.status === 'won' || t.status === 'lost' || t.status === 'error'),
    [trades]
  );
  const visibleTrades = useMemo(() => {
    if (positionsView === 'closed') return closedTrades;
    return trades;
  }, [positionsView, closedTrades, trades]);
  const autoNetProfit = useMemo(
    () =>
      trades
        .filter(t => t.source === 'auto' && (t.status === 'won' || t.status === 'lost' || t.status === 'error'))
        .reduce((acc, t) => acc + (typeof t.profit === 'number' ? t.profit : 0), 0),
    [trades]
  );
  const selectedMarketMeta = MARKET_META[symbol] ?? { label: symbol, icon: null };
  const [contractNowSec, setContractNowSec] = useState(() => Math.floor(Date.now() / 1000));

  const openDigitContract = useMemo(
    () =>
      trades.find(t => (t.status === 'open' || t.status === 'pending') && isDigitContractType(t.contractType)) ??
      null,
    [trades]
  );

  const digitLiveHint =
    openDigitContract && latestTickDigit !== null
      ? digitLiveWinning(openDigitContract.contractType, openDigitContract.barrier, latestTickDigit)
      : null;

  const activeMinuteTradeNotifications = useMemo(() => {
    const active = trades.filter(
      t =>
        (t.status === 'open' || t.status === 'pending') &&
        t.durationUnit === 'm' &&
        Number.isFinite(t.duration) &&
        t.duration > 0
    );

    return active
      .map(t => {
        const fallbackExpiry = Number.isFinite(t.entryEpoch) ? (t.entryEpoch as number) + t.duration * 60 : undefined;
        const expiryEpoch = Number.isFinite(t.expiryEpoch) ? t.expiryEpoch : fallbackExpiry;
        const secondsRemaining = Number.isFinite(expiryEpoch) ? Math.max(0, (expiryEpoch as number) - contractNowSec) : NaN;
        return {
          id: t.id,
          profit: t.profit,
          secondsRemaining,
          status: t.status,
          entryEpoch: t.entryEpoch ?? 0,
        };
      })
      .sort((a, b) => b.entryEpoch - a.entryEpoch);
  }, [trades, contractNowSec]);

  useEffect(() => {
    if (!activeMinuteTradeNotifications.length) return;
    const tid = window.setInterval(() => {
      setContractNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(tid);
  }, [activeMinuteTradeNotifications.length]);

  // Digit lineup (circles) at the bottom of the chart — same order as BotIframe digit selectors (1–9, then 0).
  const digitLineup = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

  /** Same ranking rules as BotIframe `digitsData` (top1 / top3 / least). */
  const computeDigitDockRanksFromCounts = (counts: number[]) => {
    const total = counts.reduce((acc, c) => acc + (typeof c === 'number' ? c : 0), 0);
    if (!Number.isFinite(total) || total <= 0) {
      return { most: null as number | null, least: null as number | null, third: null as number | null };
    }

    const raw = Array.from({ length: 10 }).map((_, d) => ({ digit: d, count: counts[d] || 0 }));
    const sorted = [...raw].sort((a, b) => b.count - a.count || a.digit - b.digit);

    const top1 = sorted[0]?.digit ?? null;
    const top3 = sorted[2]?.digit ?? null;

    const minCount = Math.min(...raw.map(x => x.count));
    const leastCandidates = raw.filter(x => x.count === minCount);
    const least = leastCandidates.length
      ? [...leastCandidates].sort((a, b) => b.digit - a.digit)[0].digit
      : null;

    return { most: top1, least, third: top3 };
  };

  const scheduleDigitDockUpdate = () => {
    if (digitDockUpdateTimerRef.current !== null) return;
    digitDockUpdateTimerRef.current = window.setTimeout(() => {
      digitDockUpdateTimerRef.current = null;
      setDigitDockRanks(computeDigitDockRanksFromCounts(tickDigitCountsRef.current));
    }, 120);
  };

  const syncPositionForecast = useCallback(
    (candles: CandlestickData[]) => {
      const forecast = buildPositionForecast(
        candles,
        MA_FORECAST_FAST_PERIOD,
        MA_FORECAST_SLOW_PERIOD,
        forecastConfig
      );
      setPositionForecast(forecast);

      const series = forecastSeriesRef.current;
      if (!series) return;

      if (!positionForecastEnabled || !forecast) {
        series.setData([]);
        return;
      }

      series.setData(buildForecastProjectionLine(candles, forecast, candleSizeMin * 60));
    },
    [positionForecastEnabled, candleSizeMin, forecastConfig]
  );

  const syncChartIndicators = useCallback(
    (candles: CandlestickData[]) => {
      for (const spec of CHART_MA_SPECS) {
        const series = maSeriesRef.current.get(spec.period);
        if (!series) continue;
        if (!maEnabled[spec.period]) {
          series.setData([]);
          continue;
        }
        series.setData(computeSmaFromCandles(candles, spec.period));
      }
      syncPositionForecast(candles);
    },
    [maEnabled, syncPositionForecast]
  );

  const syncChartIndicatorsRef = useRef(syncChartIndicators);
  syncChartIndicatorsRef.current = syncChartIndicators;

  const toggleMa = useCallback((period: number) => {
    setMaEnabled(prev => ({ ...prev, [period]: !prev[period] }));
  }, []);

  const renderMaToggleButton = (spec: (typeof CHART_MA_SPECS)[number]) => {
    const on = !!maEnabled[spec.period];
    return (
      <button
        key={spec.period}
        type="button"
        className={`manual-trader__chart-ma-btn${on ? ' is-on' : ''}`}
        style={{ '--ma-color': spec.color } as React.CSSProperties}
        aria-pressed={on}
        onClick={() => toggleMa(spec.period)}
      >
        <span className="manual-trader__chart-ma-swatch" aria-hidden />
        {spec.label}
      </button>
    );
  };

  useEffect(() => {
    if (!chartRollingCandlesRef.current.length) return;
    syncChartIndicators(chartRollingCandlesRef.current);
  }, [maEnabled, syncChartIndicators]);

  useEffect(() => {
    refreshChartMarkers();
  }, [positionForecastEnabled, positionForecast, refreshChartMarkers]);

  useEffect(() => {
    const candles = chartRollingCandlesRef.current;
    if (!candles.length) return;
    syncPositionForecast(candles);
  }, [positionForecastEnabled, syncPositionForecast, forecastConfig]);

  const applyChartRightGap = useCallback(() => {
    const chart = chartRef.current;
    const wrap = chartWrapRef.current;
    if (!chart || !wrap) return;
    const remPx = parseFloat(getComputedStyle(wrap).fontSize) || 16;
    const gapPx = CHART_RIGHT_EDGE_GAP_REM * remPx;
    const barSpacing = chart.timeScale().options().barSpacing ?? 6;
    const rightOffset = Math.max(2, Math.round(gapPx / barSpacing));
    chart.timeScale().applyOptions({ rightOffset });
  }, []);

  const resetCandles = useCallback(() => {
    currentCandleRef.current = null;
    if (candleSeriesRef.current) candleSeriesRef.current.setData([]);
    maSeriesRef.current.forEach(series => series.setData([]));
    forecastSeriesRef.current?.setData([]);
    setPositionForecast(null);

    if (digitDockUpdateTimerRef.current !== null) {
      window.clearTimeout(digitDockUpdateTimerRef.current);
      digitDockUpdateTimerRef.current = null;
    }

    tickDigitsRef.current = [];
    tickDigitEpochsRef.current = [];
    tickDigitCountsRef.current = Array(10).fill(0);
    chartRollingPricesRef.current = [];
    chartRollingTimesRef.current = [];
    chartRollingCandlesRef.current = [];
    setDigitDockRanks({ most: null, least: null, third: null });
    setLatestTickDigit(null);
    setLiveTick(null);
    runTrailTradeIdRef.current = null;
    prevRunQuoteRef.current = null;
    setRunTrailMarkers([]);
    virtTickBufferRef.current = [];
    virtTickEpochRef.current = null;
    virtTickMktRef.current = '';
  }, []);

  const updateCandle = useCallback(
    (epoch: number, quote: number) => {
      if (!candleSeriesRef.current) return;
      const epochSec = normalizeTickEpochSec(epoch);
      if (!Number.isFinite(epochSec)) return;
      const bucketSizeSec = candleSizeMin * 60;
      const bucket = Math.floor(epochSec / bucketSizeSec) * bucketSizeSec;
      const existing = currentCandleRef.current;

      if (!existing || Number(existing.time) !== bucket) {
        const next: CandlestickData = {
          time: bucket as any,
          open: quote,
          high: quote,
          low: quote,
          close: quote,
        };
        currentCandleRef.current = next;
        candleSeriesRef.current.update(next);
        chartRef.current?.timeScale().scrollToRealTime();
        return;
      }

      const next: CandlestickData = {
        ...existing,
        high: Math.max(existing.high, quote),
        low: Math.min(existing.low, quote),
        close: quote,
      };
      currentCandleRef.current = next;
      candleSeriesRef.current.update(next);
      chartRef.current?.timeScale().scrollToRealTime();
    },
    [candleSizeMin]
  );

  useEffect(() => {
    if (!chartWrapRef.current) return;

    const chart = createChart(chartWrapRef.current, {
      layout: {
        background: { color: '#ffffff' },
        textColor: '#334155',
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: { mode: CrosshairMode.Normal },
      width: chartWrapRef.current.clientWidth,
      height: 460,
      timeScale: {
        visible: false,
        timeVisible: false,
        secondsVisible: false,
        ticksVisible: false,
        borderVisible: false,
        rightOffset: 5,
        fixRightEdge: false,
        rightBarStaysOnScroll: true,
        shiftVisibleRangeOnNewBar: true,
      },
      rightPriceScale: {
        borderColor: '#cbd5e1',
        minimumWidth: 72,
        autoScale: true,
      },
    });
    chartRef.current = chart;
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#16a34a',
      downColor: '#dc2626',
      borderVisible: false,
      wickUpColor: '#16a34a',
      wickDownColor: '#dc2626',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    seriesMarkersRef.current = createSeriesMarkers(candleSeriesRef.current, []);

    applyChartRightGap();

    for (const spec of CHART_MA_SPECS) {
      const maSeries = chart.addSeries(LineSeries, {
        color: spec.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      maSeriesRef.current.set(spec.period, maSeries);
    }

    const forecastSeries = chart.addSeries(LineSeries, {
      color: '#6366f1',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    forecastSeriesRef.current = forecastSeries;

    const onResize = () => {
      if (chartWrapRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartWrapRef.current.clientWidth });
        applyChartRightGap();
      }
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      seriesMarkersRef.current?.detach();
      seriesMarkersRef.current = null;
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      maSeriesRef.current.clear();
      forecastSeriesRef.current = null;
    };
  }, []);

  /** Y-axis / crosshair price decimals — must match Deriv pip size (e.g. Vol 10 index → 3dp). */
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const prec = manualTraderResolveDigitTickDecimals(symbol);
    const minMove = prec <= 0 ? 1 : 10 ** -prec;
    const priceFormat = { type: 'price' as const, precision: prec, minMove };
    series.applyOptions({ priceFormat });
    maSeriesRef.current.forEach(maSeries => maSeries.applyOptions({ priceFormat }));
    forecastSeriesRef.current?.applyOptions({ priceFormat });
  }, [symbol]);

  useEffect(() => {
    try {
      window.localStorage.setItem(UI_THEME_STORAGE_KEY, uiTheme);
    } catch {
      /* ignore */
    }
  }, [uiTheme]);

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current) return;
    const dark = uiTheme === 'dark';
    chartRef.current.applyOptions({
      layout: {
        background: { color: dark ? '#14181f' : '#ffffff' },
        textColor: dark ? '#94a3b8' : '#334155',
        attributionLogo: false,
      },
      rightPriceScale: {
        borderColor: dark ? '#2d3545' : '#cbd5e1',
        minimumWidth: 72,
      },
    });
    applyChartRightGap();
    candleSeriesRef.current.applyOptions(
      dark
        ? {
            upColor: '#34d399',
            downColor: '#f87171',
            borderVisible: false,
            wickUpColor: '#34d399',
            wickDownColor: '#f87171',
          }
        : {
            upColor: '#16a34a',
            downColor: '#dc2626',
            borderVisible: false,
            wickUpColor: '#16a34a',
            wickDownColor: '#dc2626',
          }
    );
    for (const spec of CHART_MA_SPECS) {
      maSeriesRef.current.get(spec.period)?.applyOptions({ color: spec.color });
    }
    forecastSeriesRef.current?.applyOptions({
      color: dark ? '#818cf8' : '#6366f1',
    });
  }, [uiTheme]);

  useEffect(() => {
    refreshChartMarkers();
  }, [refreshChartMarkers]);

  const handleMarketChange = useCallback(
    (nextSymbol: string) => {
      if (nextSymbol === symbol) return;
      chartHistoryReadyRef.current = false;
      setChartHistoryLoading(true);
      setChartLoadMessage(chartLoadingMessage(MARKET_META[nextSymbol]?.label ?? nextSymbol));
      setSymbol(nextSymbol);
    },
    [symbol]
  );

  /** Live dotted price lines: neutral latest quote + entry tinted green/red for Rise/Fall / Rise=/Fall=. */
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const clearLines = () => {
      if (entryPriceLineRef.current) {
        series.removePriceLine(entryPriceLineRef.current);
        entryPriceLineRef.current = null;
      }
      if (liveQuotePriceLineRef.current) {
        series.removePriceLine(liveQuotePriceLineRef.current);
        liveQuotePriceLineRef.current = null;
      }
    };

    clearLines();

    const dark = uiTheme === 'dark';
    const good = dark ? '#4ade80' : '#16a34a';
    const bad = dark ? '#fb7185' : '#dc2626';
    const liveMuted = dark ? '#64748b' : '#94a3b8';

    const lt = liveTick;
    if (lt && Number.isFinite(lt.q)) {
      liveQuotePriceLineRef.current = series.createPriceLine({
        price: lt.q,
        color: liveMuted,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
        lineVisible: true,
      });
    }

    const dirTrade = trades.find(
      t =>
        (t.status === 'open' || t.status === 'pending') &&
        (t.contractType === 'CALL' ||
          t.contractType === 'PUT' ||
          t.contractType === 'PUTE' ||
          t.contractType === 'CALLE') &&
        t.entryPrice !== undefined &&
        Number.isFinite(t.entryPrice) &&
        lt &&
        Number.isFinite(lt.q)
    );

    if (dirTrade && dirTrade.entryPrice !== undefined && lt) {
      const win = directionalMidFlightWin(dirTrade.contractType, dirTrade.entryPrice, lt.q);
      entryPriceLineRef.current = series.createPriceLine({
        price: dirTrade.entryPrice,
        color: win ? good : bad,
        lineWidth: 2,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
        lineVisible: true,
      });
    }

    return clearLines;
  }, [trades, liveTick, uiTheme]);

  /** Suggested forecast entry — favourable spot vs current price for Rise/Fall. */
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const removeForecastEntryLine = () => {
      if (forecastEntryLineRef.current) {
        series.removePriceLine(forecastEntryLineRef.current);
        forecastEntryLineRef.current = null;
      }
    };

    removeForecastEntryLine();
    if (!positionForecastEnabled || !positionForecast?.entry) return removeForecastEntryLine;

    const dark = uiTheme === 'dark';
    const { entry } = positionForecast;
    forecastEntryLineRef.current = series.createPriceLine({
      price: entry.price,
      color: dark ? '#a78bfa' : '#7c3aed',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `Entry ${entry.label}`,
      lineVisible: true,
    });

    return removeForecastEntryLine;
  }, [positionForecastEnabled, positionForecast, uiTheme, symbol]);

  /** Clear Only Ups / Downs trail as soon as the run contract is no longer open */
  useEffect(() => {
    const hasOpenRun = trades.some(
      t =>
        (t.status === 'open' || t.status === 'pending') &&
        (t.contractType === 'RUNHIGH' || t.contractType === 'RUNLOW')
    );
    if (!hasOpenRun) {
      runTrailTradeIdRef.current = null;
      prevRunQuoteRef.current = null;
      setRunTrailMarkers(prev => (prev.length ? [] : prev));
    }
  }, [trades]);

  /** Only Ups / Downs: colored dots on each strict tick step while contract is open */
  useEffect(() => {
    if (!liveTick || !Number.isFinite(liveTick.q)) return;

    const list = tradesRef.current;
    const runTrade = list.find(
      t =>
        (t.status === 'open' || t.status === 'pending') &&
        (t.contractType === 'RUNHIGH' || t.contractType === 'RUNLOW')
    );

    const winDot = uiTheme === 'dark' ? '#4ade80' : '#16a34a';
    const loseDot = uiTheme === 'dark' ? '#fb7185' : '#dc2626';

    if (!runTrade) return;

    if (runTrailTradeIdRef.current !== runTrade.id) {
      runTrailTradeIdRef.current = runTrade.id;
      prevRunQuoteRef.current = null;
      setRunTrailMarkers([]);
    }

    const prevQ = prevRunQuoteRef.current;
    prevRunQuoteRef.current = liveTick.q;
    if (prevQ === null || !Number.isFinite(prevQ)) return;

    if (liveTick.q === prevQ) return;

    const up = liveTick.q > prevQ;
    const down = liveTick.q < prevQ;
    const isHigh = runTrade.contractType === 'RUNHIGH';
    const favorable = isHigh ? up : down;
    const color = favorable ? winDot : loseDot;

    const newMarker: SeriesMarker<Time> = {
      id: `run-step-${liveTick.e}`,
      time: Math.floor(liveTick.e) as UTCTimestamp,
      position: 'atPriceMiddle',
      shape: 'circle',
      color,
      price: liveTick.q,
      size: 0.42,
    };

    setRunTrailMarkers(prev => [...prev, newMarker].slice(-28));
  }, [liveTick, uiTheme]);

  /** Barrier-digit settlement pulse (prediction digit), akin to BotIframe purchased blink */
  useEffect(() => {
    let pulseBarrier: number | undefined;
    for (const t of trades) {
      if (t.status !== 'won' && t.status !== 'lost') continue;
      if (!contractNeedsBarrier(t.contractType)) continue;
      if (t.barrier === undefined) continue;
      if (settledBarrierBlinkRef.current.has(t.id)) continue;
      settledBarrierBlinkRef.current.add(t.id);
      pulseBarrier = t.barrier;
      break;
    }
    if (pulseBarrier === undefined) return;
    if (barrierPulseClearTimerRef.current !== null) {
      window.clearTimeout(barrierPulseClearTimerRef.current);
    }
    setSettlementBarrierPulse(pulseBarrier);
    barrierPulseClearTimerRef.current = window.setTimeout(() => {
      setSettlementBarrierPulse(null);
      barrierPulseClearTimerRef.current = null;
    }, 900);
  }, [trades]);

  const forgetChartSubscription = useCallback(async (subscriptionId: string | null) => {
    await forgetDerivSubscription(visualTickApiRef.current, subscriptionId);
  }, [visualTickApiRef]);

  useEffect(() => {
    const tickApi = visualTickApi;
    if (!tickApi || !visualTickReady || tickApi.connection.readyState !== 1) return;

    const streamOpId = ++chartStreamOpRef.current;
    const expected = symbol;
    const marketLabel = MARKET_META[expected]?.label ?? expected;
    const isActiveStream = () => chartStreamOpRef.current === streamOpId;

    subscribedChartSymbolRef.current = expected;
    chartHistoryReadyRef.current = false;
    resetCandles();
    setIsConnected(false);
    setChartHistoryLoading(true);
    setChartLoadMessage(chartLoadingMessage(marketLabel));
    setStatus(`Loading ${marketLabel}…`);

    let historyApplied = false;
    let subscribeAttempts = 0;
    let failTimer: number | null = null;
    let lastLiveTickAt = Date.now();
    let recoverInFlight = false;

    const clearFailTimer = () => {
      if (failTimer !== null) {
        window.clearTimeout(failTimer);
        failTimer = null;
      }
    };

    const scheduleFailTimer = () => {
      clearFailTimer();
      failTimer = window.setTimeout(() => {
        if (!historyApplied && !chartHistoryReadyRef.current && isActiveStream()) {
          logManualTraderChart(expected, 'fail timer — no history applied', {
            subscribeAttempts,
            subId: chartSubscriptionIdRef.current,
          });
          setChartHistoryLoading(true);
          setChartLoadMessage(chartChooseAnotherMarketMessage());
          setStatus('Choose another market');
          setIsConnected(false);
        }
      }, CHART_LOAD_FAIL_MS);
    };

    logManualTraderChart(expected, 'stream effect start', {
      streamOpId,
      windowSec: CHART_HISTORY_WINDOW_SEC,
    });
    scheduleFailTimer();

    const attachLiveTickStream = async (source: string) => {
      if (!tickApi || !isActiveStream() || recoverInFlight) return;
      recoverInFlight = true;
      logManualTraderChart(expected, 'attachLiveTickStream', { source });
      try {
        const { subscriptionId, error } = await recoverDerivLiveTickStream(tickApi, expected);
        if (!isActiveStream()) return;
        if (subscriptionId) {
          chartSubscriptionIdRef.current = subscriptionId;
          chartHistoryReadyRef.current = true;
          setIsConnected(true);
          lastLiveTickAt = Date.now();
          logManualTraderChart(expected, 'attachLiveTickStream OK', { source, subscriptionId });
        } else if (error) {
          logManualTraderChart(expected, 'attachLiveTickStream failed', { source, error });
        }
      } finally {
        recoverInFlight = false;
      }
    };

    const pushTickIntoChartWindow = (quote: number, epochSec: number) => {
      const start = chartHistoryStartEpochSec();
      if (!Number.isFinite(quote) || !Number.isFinite(epochSec) || epochSec < start) return;

      chartRollingPricesRef.current.push(quote);
      chartRollingTimesRef.current.push(epochSec);
      while (chartRollingTimesRef.current.length && chartRollingTimesRef.current[0] < start) {
        chartRollingTimesRef.current.shift();
        chartRollingPricesRef.current.shift();
      }
    };

    const renderChartFromRollingTicks = (): CandlestickData[] => {
      if (!candleSeriesRef.current) return [];
      const bucketSizeSec = candleSizeMin * 60;
      const candles = buildMinuteCandlesFromTicks(
        chartRollingPricesRef.current,
        chartRollingTimesRef.current,
        bucketSizeSec
      );
      if (!candles.length) return [];
      candleSeriesRef.current.setData(candles);
      currentCandleRef.current = candles[candles.length - 1];
      chartRollingCandlesRef.current = candles;
      syncChartIndicatorsRef.current(candles);
      return candles;
    };

    const applyDigitStatsFromTicks = (prices: number[], times?: number[]) => {
      const recentPrices = prices.slice(-DIGIT_DOCK_HISTORY_TICK_COUNT);
      const recentTimes = times?.slice(-DIGIT_DOCK_HISTORY_TICK_COUNT);
      const digits = recentPrices
        .map(p => extractLastDigit(p, expected))
        .filter((d): d is number => d !== null);
      tickDigitsRef.current = digits;
      tickDigitEpochsRef.current =
        recentTimes && recentTimes.length === digits.length
          ? recentTimes
          : tickDigitEpochsRef.current.slice(-digits.length);
      const counts = Array(10).fill(0);
      digits.forEach(d => {
        counts[d] += 1;
      });
      tickDigitCountsRef.current = counts;
      setDigitDockRanks(computeDigitDockRanksFromCounts(counts));
    };

    const loadDigitDockHistory = async () => {
      if (!tickApi || !isActiveStream()) return;
      try {
        const resp = await tickApi.send(
          buildChartTicksHistoryReq(expected, 0, { count: DIGIT_DOCK_HISTORY_TICK_COUNT, end: 'latest' })
        );
        if (!isActiveStream() || resp?.error) return;
        const payload = extractTickHistoryPayload(resp);
        if (!payload?.prices.length) return;
        const times = payload.times.map(t => normalizeTickEpochSec(t));
        applyDigitStatsFromTicks(payload.prices, times);
      } catch {
        /* noop */
      }
    };

    const fetchPaginatedTickHistory = async (): Promise<{ prices: number[]; times: number[] }> => {
      if (!tickApi) return { prices: [], times: [] };
      const startSec = chartHistoryStartEpochSec();
      let mergedP: number[] = [];
      let mergedT: number[] = [];
      let end: number | 'latest' = 'latest';

      for (let page = 0; page < CHART_DIGIT_STATS_MAX_PAGES; page++) {
        if (!isActiveStream()) break;
        try {
          const resp = await tickApi.send(
            buildChartTicksHistoryReq(expected, 0, { count: DIGIT_STATS_TICK_PAGE, end })
          );
          if (!isActiveStream()) break;
          if (resp?.error) break;
          const payload = extractTickHistoryPayload(resp);
          if (!payload?.prices.length) break;

          const batchT = payload.times.map(t => normalizeTickEpochSec(t));
          if (!mergedP.length) {
            mergedP = payload.prices.slice();
            mergedT = batchT;
          } else {
            mergedP = [...payload.prices, ...mergedP];
            mergedT = [...batchT, ...mergedT];
          }

          if (batchT[0] <= startSec || payload.prices.length < DIGIT_STATS_TICK_PAGE) break;
          end = batchT[0] - 1;
        } catch {
          break;
        }
      }

      chartRollingPricesRef.current = mergedP;
      chartRollingTimesRef.current = mergedT;
      return trimTicksToChartWindow(mergedP, mergedT);
    };

    const loadDigitStatsPaginated = () => {
      void loadDigitDockHistory();
    };

    const applyCandleHistoryOnce = (candles: CandlestickData[], chartRetry = 0): boolean => {
      if (historyApplied || !isActiveStream() || !candles.length) return false;
      if (!candleSeriesRef.current) {
        if (chartRetry < 40) {
          window.setTimeout(() => applyCandleHistoryOnce(candles, chartRetry + 1), 50);
        }
        return false;
      }

      const trimmed = trimCandlesToChartWindow(candles);
      if (!trimmed.length) return false;

      chartRollingCandlesRef.current = trimmed;
      candleSeriesRef.current.setData(trimmed);
      currentCandleRef.current = trimmed[trimmed.length - 1];
      syncChartIndicatorsRef.current(trimmed);

      historyApplied = true;
      chartHistoryReadyRef.current = true;
      clearFailTimer();

      const last = trimmed[trimmed.length - 1];
      const latestQuote = last.close;
      const latestEpoch = Number(last.time);
      if (Number.isFinite(latestQuote) && Number.isFinite(latestEpoch)) {
        setLiveTick({ q: latestQuote, e: latestEpoch });
      } else {
        setLiveTick(null);
      }
      setLatestTickDigit(extractLastDigit(latestQuote, expected));

      loadDigitStatsPaginated();

      window.requestAnimationFrame(() => {
        if (!isActiveStream()) return;
        chartRef.current?.timeScale().fitContent();
        chartRef.current?.timeScale().scrollToRealTime();
      });

      setChartHistoryLoading(false);
      setChartLoadMessage('');
      setIsConnected(true);
      setStatus(`Live on ${expected} · last 24 hr · ${trimmed.length} candles (1m)`);
      logManualTraderChart(expected, 'applyCandleHistoryOnce OK', {
        raw: candles.length,
        trimmed: trimmed.length,
      });

      const walletForVirt = activeLoginidRef.current || clientRef.current?.loginid || '';
      if (isCrVirtualShadowLogin(walletForVirt) && Number.isFinite(latestQuote) && Number.isFinite(latestEpoch)) {
        virtTickBufferRef.current = [{ epoch: latestEpoch, quote: latestQuote }];
        virtTickEpochRef.current = latestEpoch;
        virtTickMktRef.current = expected;
      }
      return true;
    };

    /** Legacy: build chart from ticks when candle history is unavailable. */
    const applyTickHistoryOnce = (prices: number[], times: number[], chartRetry = 0): boolean => {
      if (historyApplied || !isActiveStream() || !prices.length) return false;
      if (!times.length || times.length !== prices.length) return false;
      if (!candleSeriesRef.current) {
        if (chartRetry < 40) {
          window.setTimeout(() => applyTickHistoryOnce(prices, times, chartRetry + 1), 50);
        }
        return false;
      }

      const trimmed = trimTicksToChartWindow(prices, times);
      if (!trimmed.prices.length) return false;

      chartRollingPricesRef.current = [];
      chartRollingTimesRef.current = [];
      for (let i = 0; i < trimmed.prices.length; i++) {
        pushTickIntoChartWindow(trimmed.prices[i], trimmed.times[i]);
      }

      const candles = renderChartFromRollingTicks();
      if (!candles.length) return false;
      chartRollingCandlesRef.current = candles;

      historyApplied = true;
      chartHistoryReadyRef.current = true;
      clearFailTimer();

      const latestQuote = trimmed.prices[trimmed.prices.length - 1];
      const latestEpoch = trimmed.times[trimmed.times.length - 1];
      if (Number.isFinite(latestQuote) && Number.isFinite(latestEpoch)) {
        setLiveTick({ q: latestQuote, e: latestEpoch });
      } else {
        setLiveTick(null);
      }
      setLatestTickDigit(extractLastDigit(latestQuote, expected));
      applyDigitStatsFromTicks(trimmed.prices, trimmed.times);

      window.requestAnimationFrame(() => {
        if (!isActiveStream()) return;
        chartRef.current?.timeScale().fitContent();
        chartRef.current?.timeScale().scrollToRealTime();
      });

      setChartHistoryLoading(false);
      setChartLoadMessage('');
      setIsConnected(true);
      setStatus(
        `Live on ${expected} · last 24 hr · ${trimmed.prices.length} ticks · ${candles.length} candles`
      );
      logManualTraderChart(expected, 'applyTickHistoryOnce OK', {
        ticks: trimmed.prices.length,
        candles: candles.length,
      });
      return true;
    };

    const applyLiveOhlc = (ohlc: Record<string, unknown>) => {
      if (!chartHistoryReadyRef.current) return;
      if (!isActiveStream() || subscribedChartSymbolRef.current !== expected) return;
      if (!candleSeriesRef.current) return;

      const epochSec = normalizeTickEpochSec(Number(ohlc.open_time ?? ohlc.epoch));
      const open = Number(ohlc.open);
      const high = Number(ohlc.high);
      const low = Number(ohlc.low);
      const close = Number(ohlc.close);
      if (![open, high, low, close, epochSec].every(Number.isFinite)) return;

      const bar: CandlestickData = {
        time: epochSec as UTCTimestamp,
        open,
        high,
        low,
        close,
      };

      const rolling = chartRollingCandlesRef.current;
      const last = rolling[rolling.length - 1];
      if (last && Number(last.time) === epochSec) {
        rolling[rolling.length - 1] = bar;
      } else {
        rolling.push(bar);
      }
      const start = chartHistoryStartEpochSec();
      while (rolling.length && Number(rolling[0].time) < start) {
        rolling.shift();
      }
      chartRollingCandlesRef.current = rolling;

      candleSeriesRef.current.update(bar);
      currentCandleRef.current = bar;
      syncChartIndicatorsRef.current(rolling);
      setLiveTick({ q: close, e: epochSec });

      const d = extractLastDigit(close, expected);
      if (d !== null) {
        setLatestTickDigit(d);
        tickDigitsRef.current.push(d);
        tickDigitEpochsRef.current.push(epochSec);
        tickDigitCountsRef.current[d] += 1;
        while (tickDigitsRef.current.length > DIGIT_DOCK_HISTORY_TICK_COUNT) {
          const removed = tickDigitsRef.current.shift();
          tickDigitEpochsRef.current.shift();
          if (removed !== undefined) tickDigitCountsRef.current[removed] -= 1;
        }
        scheduleDigitDockUpdate();
      }

      chartRef.current?.timeScale().scrollToRealTime();
    };

    const applyLiveTick = (quote: number, epoch: number) => {
      if (!chartHistoryReadyRef.current) return;
      if (!isActiveStream() || subscribedChartSymbolRef.current !== expected) return;

      lastLiveTickAt = Date.now();

      const walletTick = activeLoginidRef.current || clientRef.current?.loginid || '';
      if (isCrVirtualShadowLogin(walletTick)) {
        if (virtTickEpochRef.current !== epoch) {
          virtTickEpochRef.current = epoch;
          virtTickBufferRef.current.push({ epoch, quote });
          const buf = virtTickBufferRef.current;
          if (buf.length > 600) buf.splice(0, buf.length - 600);
          virtTickMktRef.current = expected;
        }
      }

      const epochSec = normalizeTickEpochSec(epoch);
      setLiveTick({ q: quote, e: epochSec });

      const d = extractLastDigit(quote, expected);
      if (d === null) return;

      setLatestTickDigit(d);

      tickDigitsRef.current.push(d);
      tickDigitEpochsRef.current.push(epochSec);
      tickDigitCountsRef.current[d] += 1;

      while (tickDigitsRef.current.length > DIGIT_DOCK_HISTORY_TICK_COUNT) {
        const removed = tickDigitsRef.current.shift();
        tickDigitEpochsRef.current.shift();
        if (removed !== undefined) tickDigitCountsRef.current[removed] -= 1;
      }

      scheduleDigitDockUpdate();

      updateCandle(epoch, quote);

      const bucketSizeSec = candleSizeMin * 60;
      const bucket = Math.floor(epochSec / bucketSizeSec) * bucketSizeSec;
      const bar = currentCandleRef.current;
      if (bar && chartRollingCandlesRef.current.length) {
        const rolling = chartRollingCandlesRef.current;
        const last = rolling[rolling.length - 1];
        if (last && Number(last.time) === bucket) {
          rolling[rolling.length - 1] = bar;
        } else if (!last || Number(last.time) < bucket) {
          rolling.push(bar);
        }
        const start = chartHistoryStartEpochSec();
        while (rolling.length && Number(rolling[0].time) < start) {
          rolling.shift();
        }
        chartRollingCandlesRef.current = rolling;
        syncChartIndicatorsRef.current(rolling);
      }

      chartRef.current?.timeScale().scrollToRealTime();
    };

    const fetchTickPlotHistoryOnly = async (source: string): Promise<{ prices: number[]; times: number[] } | null> => {
      if (!tickApi) return null;
      const req = buildChartTicksHistoryReq(expected, 0, { plotWindow: true });
      logManualTraderChart(expected, 'fetchTickPlotHistoryOnly request', { source, req });
      try {
        const resp = await tickApi.send(req);
        if (resp?.error) {
          logManualTraderChart(expected, 'fetchTickPlotHistoryOnly error', { source, error: resp.error });
          return null;
        }
        const payload = extractTickHistoryPayload(resp);
        logManualTraderChart(expected, 'fetchTickPlotHistoryOnly response', {
          source,
          tickCount: payload?.prices.length ?? 0,
        });
        return payload;
      } catch (err) {
        logManualTraderChart(expected, 'fetchTickPlotHistoryOnly failed', {
          source,
          error: err instanceof Error ? err.message : err,
        });
        return null;
      }
    };

    const fetchCandleHistoryOnly = async (source: string): Promise<CandlestickData[] | null> => {
      if (!tickApi) return null;

      const attempts: Record<string, unknown>[] = [
        buildChartCandlesHistoryReq(expected, 0),
        ...chartCandleCountFallbacks().map(count => buildChartCandlesHistoryReq(expected, 0, { count })),
      ];

      for (const req of attempts) {
        if (!isActiveStream() || historyApplied) return null;
        try {
          logManualTraderChart(expected, 'fetchCandleHistoryOnly attempt', { source, req });
          const resp = await tickApi.send(req);
          if (!isActiveStream()) return null;
          if (resp?.error) {
            logManualTraderChart(expected, 'fetchCandleHistoryOnly error', { source, error: resp.error });
            continue;
          }
          const payload = extractCandleHistoryPayload(resp);
          logManualTraderChart(expected, 'fetchCandleHistoryOnly response', {
            source,
            candleCount: payload?.length ?? 0,
          });
          if (payload?.length) return payload;
        } catch (err) {
          logManualTraderChart(expected, 'fetchCandleHistoryOnly failed', {
            source,
            error: err instanceof Error ? err.message : err,
          });
        }
      }
      return null;
    };

    const fetchChartHistoryOnly = async (source: string): Promise<boolean> => {
      if (!tickApi || !isActiveStream() || historyApplied) return false;

      const tickPayload = await fetchTickPlotHistoryOnly(source);
      if (tickPayload && applyTickHistoryOnce(tickPayload.prices, tickPayload.times)) return true;

      const candles = await fetchCandleHistoryOnly(source);
      if (candles && applyCandleHistoryOnce(candles)) return true;

      const ticks = await fetchPaginatedTickHistory();
      if (ticks.prices.length && applyTickHistoryOnce(ticks.prices, ticks.times)) return true;

      logManualTraderChart(expected, 'fetchChartHistoryOnly exhausted', { source, historyApplied });
      return historyApplied;
    };

    const sub = tickApi.onMessage().subscribe(({ data }: any) => {
      if (!data) return;

      if (data.error) {
        const errSym = data.echo_req?.ticks_history;
        if (errSym && errSym !== expected) return;

        logManualTraderChart(expected, 'onMessage error', {
          error: data.error,
          echoReq: data.echo_req,
          historyApplied,
          chartReady: chartHistoryReadyRef.current,
        });

        if (
          isAlreadySubscribedTickError(data.error) &&
          isActiveStream() &&
          subscribedChartSymbolRef.current === expected &&
          errSym === expected
        ) {
          if (!historyApplied) {
            void fetchChartHistoryOnly('onMessage-already-subscribed').then(async ok => {
              if (ok || historyApplied) {
                chartHistoryReadyRef.current = true;
              }
              await attachLiveTickStream('onMessage-already-subscribed');
            });
          } else {
            chartHistoryReadyRef.current = true;
            void attachLiveTickStream('onMessage-already-subscribed-live');
          }
          return;
        }

        if (
          historyApplied ||
          chartHistoryReadyRef.current ||
          !isActiveStream() ||
          subscribedChartSymbolRef.current !== expected ||
          errSym !== expected
        ) {
          return;
        }

        setIsConnected(false);
        setChartHistoryLoading(true);
        setChartLoadMessage(chartChooseAnotherMarketMessage());
        setStatus('Choose another market');
        return;
      }

      if (!isActiveStream() || subscribedChartSymbolRef.current !== expected) return;

      if (data.msg_type === 'history') {
        const reqSym = data.echo_req?.ticks_history;
        if (reqSym && reqSym !== expected) return;

        logManualTraderChart(expected, 'onMessage history', {
          style: data.echo_req?.style,
          count: data.echo_req?.count,
        });

        const candlePayload = extractCandleHistoryPayload(data);
        if (candlePayload?.length) {
          applyCandleHistoryOnce(candlePayload);
          return;
        }
        const tickPayload = extractTickHistoryPayload(data);
        if (tickPayload) {
          applyTickHistoryOnce(tickPayload.prices, tickPayload.times);
          return;
        }
        logManualTraderChart(expected, 'onMessage history — no parseable payload', {
          hasHistory: !!data.history,
          hasCandles: !!data.candles,
        });
        return;
      }

      if (data.msg_type === 'ohlc' && data.ohlc) {
        const ohlcSym = data.ohlc.symbol ?? data.echo_req?.ticks_history;
        if (ohlcSym && ohlcSym !== expected) return;
        applyLiveOhlc(data.ohlc as Record<string, unknown>);
        return;
      }

      if (data.msg_type === 'tick' && data.tick) {
        const tickSym = data.tick.symbol ?? data.echo_req?.ticks;
        if (tickSym && tickSym !== expected) return;

        const quote = Number(data.tick.quote);
        const epoch = Number(data.tick.epoch);
        if (!Number.isFinite(quote) || !Number.isFinite(epoch)) return;
        applyLiveTick(quote, epoch);
      }
    });

    const subscribeChartTicks = async () => {
      if (chartSubscribeInFlightRef.current) return;
      if (!tickApi || tickApi.connection.readyState !== 1 || !isActiveStream()) return;
      if (historyApplied) return;

      chartSubscribeInFlightRef.current = true;
      subscribeAttempts += 1;

      try {
        const priorSubId = chartSubscriptionIdRef.current;
        chartSubscriptionIdRef.current = null;
        if (priorSubId) {
          await forgetChartSubscription(priorSubId);
        }
        if (!isActiveStream() || historyApplied) return;

        let subscribed = false;

        const tickPlotReq = buildChartTicksHistoryReq(expected, 1, { plotWindow: true });
        logManualTraderChart(expected, 'subscribe ticks_history (plot)', { req: tickPlotReq });

        try {
          const resp = await tickApi.send(tickPlotReq);
          if (!isActiveStream()) return;

          if (resp?.error && isAlreadySubscribedTickError(resp.error)) {
            logManualTraderChart(expected, 'ticks plot AlreadySubscribed');
            const ok = await fetchChartHistoryOnly('already-subscribed-response');
            if (ok || historyApplied) chartHistoryReadyRef.current = true;
            await attachLiveTickStream('already-subscribed-response');
            return;
          }

          if (resp?.error) {
            logManualTraderChart(expected, 'ticks plot error', { error: resp.error });
          } else {
            const newSubId = resp?.subscription?.id ? String(resp.subscription.id) : null;
            chartSubscriptionIdRef.current = newSubId;
            subscribed = !!newSubId;

            const tickPayload = extractTickHistoryPayload(resp);
            if (tickPayload && applyTickHistoryOnce(tickPayload.prices, tickPayload.times)) return;

            const candlePayload = extractCandleHistoryPayload(resp);
            if (candlePayload?.length && applyCandleHistoryOnce(candlePayload)) return;

            if (newSubId) {
              logManualTraderChart(expected, 'subscribed — waiting for history on stream', { newSubId });
              setChartLoadMessage(chartRetryMessage(marketLabel));
              return;
            }
          }
        } catch (err) {
          if (isAlreadySubscribedTickError(err)) {
            const ok = await fetchChartHistoryOnly('already-subscribed-catch');
            if (ok || historyApplied) chartHistoryReadyRef.current = true;
            await attachLiveTickStream('already-subscribed-catch');
            return;
          }
          logManualTraderChart(expected, 'ticks plot send failed', {
            error: err instanceof Error ? err.message : err,
          });
        }

        if (historyApplied) return;

        const windowReq = buildChartCandlesHistoryReq(expected, subscribed ? 0 : 1);
        logManualTraderChart(expected, 'subscribe candles fallback', { req: windowReq });

        try {
          const resp = await tickApi.send(windowReq);
          if (!isActiveStream()) return;

          if (resp?.error && isAlreadySubscribedTickError(resp.error)) {
            const ok = await fetchChartHistoryOnly('candles-already-subscribed');
            if (ok || historyApplied) chartHistoryReadyRef.current = true;
            await attachLiveTickStream('candles-already-subscribed');
            return;
          }

          if (!resp?.error) {
            if (!subscribed) {
              const newSubId = resp?.subscription?.id ? String(resp.subscription.id) : null;
              chartSubscriptionIdRef.current = newSubId;
              subscribed = !!newSubId;
            }
            const candlePayload = extractCandleHistoryPayload(resp);
            if (candlePayload?.length && applyCandleHistoryOnce(candlePayload)) return;
            const tickPayload = extractTickHistoryPayload(resp);
            if (tickPayload && applyTickHistoryOnce(tickPayload.prices, tickPayload.times)) return;
            if (chartSubscriptionIdRef.current && !historyApplied) {
              setChartLoadMessage(chartRetryMessage(marketLabel));
              return;
            }
          }
        } catch (err) {
          logManualTraderChart(expected, 'candles fallback failed', {
            error: err instanceof Error ? err.message : err,
          });
        }

        if (historyApplied) return;

        for (const count of chartCandleCountFallbacks()) {
          if (!isActiveStream() || historyApplied) return;
          try {
            const resp = await tickApi.send(
              buildChartCandlesHistoryReq(expected, subscribed ? 0 : 1, { count })
            );
            if (!isActiveStream()) return;

            if (resp?.error) {
              if (isAlreadySubscribedTickError(resp.error)) {
                const ok = await fetchChartHistoryOnly('already-subscribed-fallback');
                if (ok || historyApplied) chartHistoryReadyRef.current = true;
                await attachLiveTickStream('already-subscribed-fallback');
                return;
              }
              continue;
            }

            if (!subscribed) {
              const newSubId = resp?.subscription?.id ? String(resp.subscription.id) : null;
              chartSubscriptionIdRef.current = newSubId;
              subscribed = !!newSubId;
            }

            const candlePayload = extractCandleHistoryPayload(resp);
            if (candlePayload?.length && applyCandleHistoryOnce(candlePayload)) return;
            if (subscribed && !historyApplied) return;
          } catch (err) {
            if (isAlreadySubscribedTickError(err)) {
              const ok = await fetchChartHistoryOnly('already-subscribed-fallback-catch');
              if (ok || historyApplied) chartHistoryReadyRef.current = true;
              await attachLiveTickStream('already-subscribed-fallback-catch');
              return;
            }
          }
        }

        if (!historyApplied) {
          const ticks = await fetchPaginatedTickHistory();
          if (ticks.prices.length && applyTickHistoryOnce(ticks.prices, ticks.times)) return;
        }
      } finally {
        chartSubscribeInFlightRef.current = false;
      }

      if (historyApplied) return;

      if (
        isActiveStream() &&
        subscribedChartSymbolRef.current === expected &&
        subscribeAttempts < CHART_SUBSCRIBE_MAX_ATTEMPTS
      ) {
        setChartLoadMessage(chartRetryMessage(marketLabel));
        window.setTimeout(() => {
          if (isActiveStream() && !historyApplied && !chartSubscribeInFlightRef.current) {
            void subscribeChartTicks();
          }
        }, 800);
        return;
      }

      if (isActiveStream() && subscribedChartSymbolRef.current === expected && !historyApplied) {
        if (chartSubscriptionIdRef.current) {
          logManualTraderChart(expected, 'subscribed but history not parsed yet — waiting for fail timer');
          setChartLoadMessage(chartRetryMessage(marketLabel));
          return;
        }
        logManualTraderChart(expected, 'subscribe gave up immediately');
        setIsConnected(false);
        setChartHistoryLoading(true);
        setChartLoadMessage(chartChooseAnotherMarketMessage());
        setStatus('Choose another market');
      }
    };

    void subscribeChartTicks();

    const retryTimer = window.setTimeout(() => {
      if (
        !historyApplied &&
        isActiveStream() &&
        !chartSubscribeInFlightRef.current &&
        subscribeAttempts < CHART_SUBSCRIBE_MAX_ATTEMPTS
      ) {
        setChartLoadMessage(chartRetryMessage(marketLabel));
        void subscribeChartTicks();
      }
    }, CHART_LOAD_RETRY_MS);

    const tickWatchTimer = window.setInterval(() => {
      if (!isActiveStream() || !historyApplied || chartSubscribeInFlightRef.current || recoverInFlight) {
        return;
      }
      if (Date.now() - lastLiveTickAt < CHART_TICK_STALL_RECOVER_MS) return;
      logManualTraderChart(expected, 'tick stall — recovering live stream', {
        msSinceTick: Date.now() - lastLiveTickAt,
      });
      void attachLiveTickStream('tick-stall-watchdog');
    }, CHART_TICK_WATCH_INTERVAL_MS);

    return () => {
      logManualTraderChart(expected, 'stream effect cleanup', { streamOpId });
      window.clearTimeout(retryTimer);
      window.clearInterval(tickWatchTimer);
      clearFailTimer();
      chartHistoryReadyRef.current = false;
      if (digitDockUpdateTimerRef.current !== null) {
        window.clearTimeout(digitDockUpdateTimerRef.current);
        digitDockUpdateTimerRef.current = null;
      }
      sub.unsubscribe();
      subscribedChartSymbolRef.current = null;
      chartSubscribeInFlightRef.current = false;
      const subId = chartSubscriptionIdRef.current;
      chartSubscriptionIdRef.current = null;
      if (subId) void forgetChartSubscription(subId);
    };
  }, [symbol, updateCandle, visualTickApi, visualTickReady, forgetChartSubscription, resetCandles]);

  /**
   * Same idea as flipaa `finished`: settle when sold / expired / settleable / sold status.
   * We also treat explicit won/lost (and contract_status) so we do not wait extra ticks.
   */
  const isProposalContractFinished = (c: any) => {
    const st = String(c.status ?? '').toLowerCase();
    const cs = String(c.contract_status ?? '').toLowerCase();
    return (
      !!c.is_sold ||
      !!c.is_expired ||
      !!c.is_settleable ||
      st === 'sold' ||
      st === 'won' ||
      st === 'lost' ||
      cs === 'sold' ||
      cs === 'won' ||
      cs === 'lost'
    );
  };

  const resolveOutcome = (c: any, net: number): 'won' | 'lost' => {
    const cs = String(c.contract_status ?? c.status ?? '').toLowerCase();
    if (cs === 'won') return 'won';
    if (cs === 'lost') return 'lost';
    return net >= 0 ? 'won' : 'lost';
  };

  const ensureTradingApiReady = useCallback(async () => {
    if (!api_base.api || api_base.api.connection.readyState !== 1) {
      await api_base.init(true);
    }
    const liveApi = api_base.api;
    if (!liveApi || liveApi.connection.readyState !== 1) {
      throw new Error('Trading connection is still initializing. Please try again.');
    }
    return liveApi;
  }, []);

  useEffect(() => {
    let sub: { unsubscribe: () => void } | null = null;
    const start = async () => {
      try {
        const liveApi = await ensureTradingApiReady();
        try {
          await liveApi.send({ transactions: 1, subscribe: 1 });
        } catch {
          /* ignore — sell events still often arrive via authorized stream */
        }
        sub = liveApi.onMessage().subscribe(({ data }: any) => {
          if (!data || data.error) return;

          /** flipaa: process every proposal_open_contract for this id — don't return early on !finished */
          if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract) {
            const c = data.proposal_open_contract;
            const cid = String(c.contract_id);
            const finished = isProposalContractFinished(c);
            const net = Number(c.profit ?? 0);
            const exitEpochRaw = Number(c.exit_tick_time ?? c.sell_time ?? c.date_expiry ?? NaN);
            const exitEpoch = Number.isFinite(exitEpochRaw) ? Math.floor(exitEpochRaw) : undefined;
            const exitPrice = pickExitPriceFromContract(c);
            const entryFromContract = pickEntryPriceFromContract(c);
            const entryEpochFrom = pickEntryEpochFromContract(c);
            const contractValue = pickContractValueFromContract(c);
            const sellAllowed = Boolean(c.is_sell_allowed);
            const outcome = resolveOutcome(c, net);

            setTrades(prev =>
              prev.map(t => {
                if (t.id !== cid) return t;

                if (t.status === 'won' || t.status === 'lost') {
                  if (exitPrice !== undefined && (t.exitPrice === undefined || !Number.isFinite(t.exitPrice))) {
                    return {
                      ...t,
                      exitPrice,
                      exitEpoch: exitEpoch ?? t.exitEpoch,
                      isSellAllowed: false,
                      ...(entryFromContract !== undefined && t.entryPrice === undefined ? { entryPrice: entryFromContract } : {}),
                      ...(entryEpochFrom !== undefined && t.entryEpoch === undefined ? { entryEpoch: entryEpochFrom } : {}),
                    };
                  }
                  return t;
                }

                if (!finished) {
                  return {
                    ...t,
                    status: 'open',
                    isSellAllowed: sellAllowed,
                    ...(Number.isFinite(net) ? { profit: net } : {}),
                    ...(contractValue !== undefined ? { contractValue } : {}),
                    ...(Number.isFinite(Number(c.date_expiry)) ? { expiryEpoch: Math.floor(Number(c.date_expiry)) } : {}),
                    ...(entryFromContract !== undefined ? { entryPrice: entryFromContract } : {}),
                    ...(entryEpochFrom !== undefined ? { entryEpoch: entryEpochFrom } : {}),
                  };
                }

                return {
                  ...t,
                  status: outcome,
                  profit: net,
                  exitEpoch,
                  exitPrice,
                  isSellAllowed: false,
                  ...(contractValue !== undefined ? { contractValue } : {}),
                  ...(entryFromContract !== undefined && t.entryPrice === undefined ? { entryPrice: entryFromContract } : {}),
                  ...(entryEpochFrom !== undefined && t.entryEpoch === undefined ? { entryEpoch: entryEpochFrom } : {}),
                };
              })
            );
            return;
          }

          if (data.msg_type === 'transaction' && data.transaction?.action === 'sell') {
            const tx = data.transaction;
            const cid = String(tx.contract_id);
            const payout = Number(tx.amount);
            const txEpoch = Number(tx.transaction_time ?? NaN);
            const exitEpoch = Number.isFinite(txEpoch) ? Math.floor(txEpoch) : undefined;
            const txExit = Number((tx as { exit_tick?: number }).exit_tick ?? NaN);
            const exitPriceFromTx = Number.isFinite(txExit) ? txExit : undefined;
            setTrades(prev => {
              const row = prev.find(tr => tr.id === cid);
              if (!row) {
                window.setTimeout(() => {
                  setTrades(inner =>
                    inner.map(t => {
                      if (t.id !== cid || t.status === 'won' || t.status === 'lost') return t;
                      const stakeAmt = t.stake;
                      const netDelayed = Number.isFinite(payout) ? payout - stakeAmt : 0;
                      const out: 'won' | 'lost' = netDelayed >= 0 ? 'won' : 'lost';
                      return { ...t, status: out, profit: netDelayed, exitEpoch, exitPrice: exitPriceFromTx };
                    })
                  );
                }, 120);
                return prev;
              }
              return prev.map(t => {
                if (t.id !== cid || t.status === 'won' || t.status === 'lost') return t;
                const net = Number.isFinite(payout) ? payout - t.stake : Number(tx.amount) - t.stake;
                const out: 'won' | 'lost' = net >= 0 ? 'won' : 'lost';
                return { ...t, status: out, profit: net, exitEpoch, exitPrice: exitPriceFromTx ?? t.exitPrice };
              });
            });
          }
        });
      } catch {
        /* ignore init/subscribe failures */
      }
    };
    void start();
    return () => sub?.unsubscribe();
  }, [tradingSocketGeneration, ensureTradingApiReady]);

  /** One-shot contract polls while rows are still open (backup if stream updates are delayed). */
  useEffect(() => {
    const openIds = trades
      .filter(
        t =>
          (t.status === 'open' || t.status === 'pending') &&
          !String(t.id).startsWith('tmp') &&
          !String(t.id).startsWith('v-')
      )
      .map(t => t.id);
    if (!openIds.length) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const liveApi = await ensureTradingApiReady();
        if (cancelled) return;
        for (const contract_id of openIds) {
          if (cancelled) return;
          await liveApi.send({ proposal_open_contract: 1, contract_id, subscribe: 0 });
        }
      } catch {
        /* ignore transient poll errors */
      }
    };
    const id = window.setInterval(() => void poll(), 450);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [trades, ensureTradingApiReady]);

  const ensureVirtTicksForSymbol = useCallback(async (sym: string) => {
    virtTickMktRef.current = sym;
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      if (virtTickBufferRef.current.length >= 2) return;
      await sleep(25);
    }
    throw new Error('virtual-tick-timeout');
  }, []);

  const completeVirtualManualTrade = useCallback(
    async (
      tmpId: string,
      contractType: ContractType,
      amount: number,
      durCount: number,
      barrierNum: number | undefined,
      du: DurationUnit,
      sym: string,
      opts: { source: 'manual' | 'auto' }
    ) => {
      const cli = clientRef.current;
      const walletLogin =
        activeLoginidRef.current || cli?.loginid || '';
      if (!isCrVirtualShadowLogin(walletLogin) || !cli) throw new Error('restricted');
      const shadowLoginKey = ALLOWED_BOT_IFRAME_LOGINID;

      const st = contractTypeToFlipStrategy(contractType);
      if (!st) throw new Error('unknown-contract');

      const liveApi = await ensureTradingApiReady();

      virtTradeInFlightRef.current = true;
      try {
        await ensureVirtTicksForSymbol(sym);

        const barrierStr = contractNeedsBarrier(contractType)
          ? String(Math.floor(barrierNum ?? 0))
          : undefined;

        const proposalPayload: Record<string, unknown> = {
          proposal: 1,
          amount,
          basis: 'stake',
          currency: 'USD',
          contract_type: contractType,
          duration: durCount,
          duration_unit: du,
          ...(barrierStr !== undefined ? { barrier: barrierStr } : {}),
        };
        applyDerivSessionMarketField(proposalPayload, sym);

        const proposalResp = await liveApi.send(proposalPayload);
        if (proposalResp?.error) throw proposalResp.error;
        const pr = proposalResp.proposal as { ask_price?: number; payout?: number };
        const ask = Number(pr.ask_price ?? amount);
        const payout = Number(pr.payout ?? amount * 1.95);

        const virtDur = effectiveVirtDurationTicks(durCount, du);

        const decision = await decideFlipVirtualPair(
          {
            isRunningRef: virtTradeInFlightRef,
            tickBufferRef: virtTickBufferRef,
            sessionLossesRef: sessionLossesVirtRef,
            afterFactSuppressedRef,
            afterFactWinStreakRef,
            naturalLossStreakRef,
            onlyRunLossStreakRef: onlyRunLossStreakVirtRef,
          },
          st,
          typeof barrierNum === 'number' ? barrierNum : undefined,
          virtDur,
          sym
        );

        if (!decision.decided) {
          setTrades(prev => prev.map(t => (t.id === tmpId ? { ...t, status: 'error' } : t)));
          setStatus('Could not resolve virtual outcome');
          throw new Error('virtual-timeout');
        }

        const debitOk = await runWithCrShadowLock(() => tryDebitCrShadowSync(cli, shadowLoginKey, ask));
        if (!debitOk) {
          setTrades(prev => prev.map(t => (t.id === tmpId ? { ...t, status: 'error' } : t)));
          setStatus('Not enough virtual balance for this stake');
          throw new Error('insufficient-balance');
        }

        const net = decision.win ? payout - ask : -ask;
        const virtId = `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const isDir = isDirectionalDisplayContract(contractType);
        const isOneTick = du === 't' && durCount === 1;
        const entryShown = isDir ? decision.entry : isOneTick ? decision.exit : decision.entry;
        const exitShown = decision.exit;

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
          walletLoginId: walletLogin,
          ask,
          settlementCredit,
          entryEpochSec: entryShown.epoch,
          exitEpochSec: exitShown.epoch,
        });

        setTrades(prev =>
          prev.map(t =>
            t.id === tmpId
              ? {
                  ...t,
                  id: virtId,
                  contractType,
                  stake: amount,
                  duration: durCount,
                  durationUnit,
                  status: net >= 0 ? 'won' : 'lost',
                  profit: Number(net.toFixed(2)),
                  entryPrice: entryShown.quote,
                  entryEpoch: entryShown.epoch,
                  exitPrice: exitShown.quote,
                  exitEpoch: exitShown.epoch,
                  ...(typeof barrierNum === 'number' ? { barrier: barrierNum } : {}),
                }
              : t
          )
        );

        if (opts.source === 'auto') autoContractIdRef.current = virtId;

        setStatus(`${CONTRACT_LABEL[contractType]} settled (virtual)`);
      } finally {
        virtTradeInFlightRef.current = false;
      }
    },
    [ensureVirtTicksForSymbol]
  );

  const placeTrade = useCallback(
    async (contractType: ContractType, opts?: { source?: 'manual' | 'auto'; amountOverride?: number }) => {
      const source = opts?.source ?? 'manual';
      const amount = Number.isFinite(opts?.amountOverride as number) ? Number(opts?.amountOverride) : Number(stake);
      if (source === 'manual' && !canBuy) return;
      if (source === 'auto' && (!isConnected || isBuying)) return;
      const durRaw = Number(duration);
      const minDur = durationUnit === 't' ? minTicksForContract(contractType) : 1;
      const durCount = Number.isFinite(durRaw) ? Math.max(minDur, Math.floor(durRaw)) : minDur;
      const barrierStr = contractNeedsBarrier(contractType) ? String(Math.floor(overUnderDigit)) : undefined;
      const barrierNumVirt = contractNeedsBarrier(contractType) ? Math.floor(overUnderDigit) : undefined;
      const tmpId = `tmp-${Date.now()}`;
      setIsBuying(true);
      setStatus(`Placing ${CONTRACT_LABEL[contractType]}...`);
      setTrades(prev => [
        {
          id: tmpId,
          contractType,
          stake: amount,
          duration: durCount,
          durationUnit,
          source,
          status: 'pending',
          ...(barrierStr !== undefined ? { barrier: Number(barrierStr) } : {}),
        },
        ...prev,
      ]);

      const cli = clientRef.current;
      const walletLogin =
        activeLoginidRef.current || cli?.loginid || '';
      if (isCrVirtualShadowLogin(walletLogin)) {
        if (!cli) {
          setTrades(prev => prev.map(t => (t.id === tmpId ? { ...t, status: 'error' } : t)));
          setStatus('Wallet not ready — wait a moment and try again (virtual mode)');
          setIsBuying(false);
          return;
        }
        try {
          await ensureTradingApiReady();
          await completeVirtualManualTrade(tmpId, contractType, amount, durCount, barrierNumVirt, durationUnit, symbol, {
            source,
          });
        } catch (e: unknown) {
          const msg = (e instanceof Error ? e.message : String(e ?? '')).toString();
          if (!['restricted', 'insufficient-balance', 'virtual-timeout', 'unknown-contract'].includes(msg)) {
            setStatus(msg || 'Trade failed');
          }
          setTrades(prev =>
            prev.map(t =>
              t.id === tmpId && (t.status === 'pending' || t.status === 'open') ? { ...t, status: 'error' } : t
            )
          );
        } finally {
          setIsBuying(false);
        }
        return;
      }

      try {
        const liveApi = await ensureTradingApiReady();
        const resp = (await sendDerivSessionContractPurchase(
          d => liveApi.send(d) as Promise<unknown>,
          {
            contract_type: contractType,
            market: symbol,
            duration: durCount,
            stake: amount,
            duration_unit: durationUnit,
            ...(barrierStr !== undefined ? { barrier: barrierStr } : {}),
          }
        )) as { error?: { message?: string }; buy?: { contract_id?: unknown } };
        if (resp?.error) throw new Error(resp.error?.message || 'Buy failed');
        const contractIdRaw = resp.buy?.contract_id;
        if (contractIdRaw == null || contractIdRaw === '') {
          throw new Error('Buy failed: missing contract id');
        }
        const contractId = String(contractIdRaw);
        setTrades(prev =>
          prev.map(t =>
            t.id === tmpId ? { ...t, id: contractId, status: 'open', durationUnit } : t
          )
        );
        if (source === 'auto') autoContractIdRef.current = contractId;
        setStatus(`${CONTRACT_LABEL[contractType]} placed`);
        /* BotIframe-style: never await subscribe — extra RTT blocked UI / next trade */
        void liveApi.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 }).catch(() => {});
      } catch (e: any) {
        setTrades(prev => prev.map(t => (t.id === tmpId ? { ...t, status: 'error' } : t)));
        setStatus(e?.message || 'Trade failed');
      } finally {
        setIsBuying(false);
      }
    },
    [
      canBuy,
      stake,
      duration,
      durationUnit,
      symbol,
      isConnected,
      isBuying,
      overUnderDigit,
      completeVirtualManualTrade,
      ensureTradingApiReady,
    ]
  );

  const sellContract = useCallback(async (contractId: string) => {
    setSellingContractId(contractId);
    try {
      const liveApi = await ensureTradingApiReady();
      await liveApi.send({ sell: contractId, price: 0 });
      setStatus('Closing contract…');
    } catch (e: unknown) {
      setStatus(e instanceof Error ? e.message : 'Sell failed');
    } finally {
      setSellingContractId(prev => (prev === contractId ? null : prev));
    }
  }, [ensureTradingApiReady]);

  const adjustStake = useCallback((delta: number) => {
    const current = typeof stake === 'number' && Number.isFinite(stake) ? stake : 1;
    const next = Math.max(0.35, Number((current + delta).toFixed(2)));
    setStake(next);
  }, [stake]);

  useEffect(() => {
    const amount = typeof stake === 'number' && Number.isFinite(stake) ? stake : NaN;
    const dur = typeof duration === 'number' && Number.isFinite(duration) ? duration : NaN;
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(dur) || dur < minDurationTicks) {
      setPayouts({});
      return;
    }
    if (
      strategyNeedsDigit(manualStrategy) &&
      (!Number.isFinite(overUnderDigit) || overUnderDigit < 0 || overUnderDigit > 9)
    ) {
      setPayouts({});
      return;
    }

    const barrierOpts = strategyNeedsDigit(manualStrategy)
      ? { barrier: String(Math.floor(overUnderDigit)) }
      : undefined;

    let cancelled = false;
    const run = async () => {
      try {
        const liveApi = await ensureTradingApiReady();
        const leftCt = contractPair.left;
        const rightCt = contractPair.right;
        const leftPayload: Record<string, unknown> = {
            proposal: 1,
            amount,
            basis: 'stake',
            currency: 'USD',
            contract_type: leftCt,
            duration: dur,
            duration_unit: durationUnit,
            ...(barrierOpts ?? {}),
        };
        applyDerivSessionMarketField(leftPayload, symbol);
        const rightPayload: Record<string, unknown> = {
            proposal: 1,
            amount,
            basis: 'stake',
            currency: 'USD',
            contract_type: rightCt,
            duration: dur,
            duration_unit: durationUnit,
            ...(barrierOpts ?? {}),
        };
        applyDerivSessionMarketField(rightPayload, symbol);
        const [leftResp, rightResp] = await Promise.all([
          liveApi.send(leftPayload),
          liveApi.send(rightPayload),
        ]);
        if (cancelled) return;
        const profitOf = (resp: any) => {
          const p = Number(resp?.proposal?.profit ?? NaN);
          const pay = Number(resp?.proposal?.payout ?? NaN);
          return Number.isFinite(p) ? p : Number.isFinite(pay) ? pay - amount : NaN;
        };
        setPayouts({
          [leftCt]: profitOf(leftResp),
          [rightCt]: profitOf(rightResp),
        });
      } catch {
        if (!cancelled) setPayouts({});
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [stake, duration, symbol, manualStrategy, overUnderDigit, durationUnit, contractPair, minDurationTicks, ensureTradingApiReady]);

  const startAuto = useCallback(
    async (direction: ContractType) => {
      const base = typeof stake === 'number' && Number.isFinite(stake) && stake >= 0.35 ? stake : NaN;
      const mg = typeof martingale === 'number' && Number.isFinite(martingale) && martingale >= 1 ? martingale : NaN;
      if (!Number.isFinite(base) || !Number.isFinite(mg) || !isConnected || isBuying) return;
      setAutoDirection(direction);
      autoBaseStakeRef.current = base;
      autoStepRef.current = 0;
      autoContractIdRef.current = null;
      setAutoStake(base);
      setAutoRunning(true);
      setStatus(isConnected ? `Live on ${symbol} · Auto ${CONTRACT_LABEL[direction]}` : 'Offline');
      await placeTrade(direction, { source: 'auto', amountOverride: base });
    },
    [stake, martingale, isConnected, isBuying, placeTrade, symbol]
  );

  const stopAuto = useCallback(() => {
    setAutoRunning(false);
    autoContractIdRef.current = null;
    autoStepRef.current = 0;
    setAutoStake(autoBaseStakeRef.current);
    setStatus(isConnected ? `Live on ${symbol}` : 'Offline');
  }, [isConnected, symbol]);

  useEffect(() => {
    if (!autoRunning) return;
    const watchedId = autoContractIdRef.current;
    if (!watchedId) return;
    const settled = trades.find(t => t.id === watchedId && (t.status === 'won' || t.status === 'lost' || t.status === 'error'));
    if (!settled) return;

    const mg = typeof martingale === 'number' && Number.isFinite(martingale) && martingale >= 1 ? martingale : 1;
    const maxSteps =
      typeof maxMartingaleSteps === 'number' && Number.isFinite(maxMartingaleSteps) && maxMartingaleSteps >= 0
        ? Math.floor(maxMartingaleSteps)
        : 7;

    let nextStake = autoBaseStakeRef.current;
    if (settled.status === 'lost') {
      autoStepRef.current = Math.min(maxSteps, autoStepRef.current + 1);
      nextStake = Number((autoBaseStakeRef.current * Math.pow(mg, autoStepRef.current)).toFixed(2));
    } else {
      autoStepRef.current = 0;
    }

    setAutoStake(nextStake);
    autoContractIdRef.current = null;
    const walletLogin =
      activeLoginidRef.current || clientRef.current?.loginid || '';
    const chainDelayMs = isCrVirtualShadowLogin(walletLogin) ? AUTO_CHAIN_GAP_MS_CR_VIRTUAL : 0;
    const id = window.setTimeout(() => {
      if (autoRunning && modeView === 'auto') {
        void placeTrade(autoDirection, { source: 'auto', amountOverride: nextStake });
      }
    }, chainDelayMs);
    return () => window.clearTimeout(id);
  }, [trades, autoRunning, modeView, martingale, maxMartingaleSteps, autoDirection, placeTrade]);

  useEffect(() => {
    if (modeView === 'manual' && autoRunning) stopAuto();
  }, [modeView, autoRunning, stopAuto]);

  useEffect(() => {
    const prev = prevManualStrategyRef.current;
    prevManualStrategyRef.current = manualStrategy;
    if (prev !== manualStrategy && autoRunning) stopAuto();
  }, [manualStrategy, autoRunning, stopAuto]);

  const handleDirectionClick = useCallback(
    async (direction: ContractType) => {
      if (modeView === 'manual') {
        await placeTrade(direction);
        return;
      }
      if (!autoRunning) {
        await startAuto(direction);
        return;
      }
      if (autoDirection === direction) {
        stopAuto();
        return;
      }
      stopAuto();
      queueMicrotask(() => {
        void startAuto(direction);
      });
    },
    [modeView, autoRunning, autoDirection, placeTrade, startAuto, stopAuto]
  );

  useEffect(() => {
    if (!autoRunning) return;
    const tp = typeof targetProfit === 'number' && Number.isFinite(targetProfit) && targetProfit > 0 ? targetProfit : NaN;
    const sl = typeof stopLoss === 'number' && Number.isFinite(stopLoss) && stopLoss > 0 ? stopLoss : NaN;

    if (Number.isFinite(tp) && autoNetProfit >= tp) {
      stopAuto();
      setStatus(`Auto stopped at target profit (+$${autoNetProfit.toFixed(2)})`);
      return;
    }
    if (Number.isFinite(sl) && autoNetProfit <= -sl) {
      stopAuto();
      setStatus(`Auto stopped at stop loss ($${autoNetProfit.toFixed(2)})`);
    }
  }, [autoRunning, autoNetProfit, targetProfit, stopLoss, stopAuto]);

  return (
    <div className={`manual-trader-page${uiTheme === 'dark' ? ' manual-trader-page--dark' : ''}`}>
      <div className={`manual-trader${uiTheme === 'dark' ? ' manual-trader--dark' : ''}`}>
        <div className="manual-trader__theme-toggle" role="group" aria-label="Color theme">
          <button
            type="button"
            className={uiTheme === 'light' ? 'active' : ''}
            onClick={() => setUiTheme('light')}
            aria-pressed={uiTheme === 'light'}
            title="Light theme"
          >
            <IconSun size={17} />
          </button>
          <button
            type="button"
            className={uiTheme === 'dark' ? 'active' : ''}
            onClick={() => setUiTheme('dark')}
            aria-pressed={uiTheme === 'dark'}
            title="Dark theme"
          >
            <IconMoon size={17} />
          </button>
        </div>
        <div className="manual-trader__grid">
        <aside className="manual-trader__positions">
          <div className="manual-trader__positions-tabs">
            <button
              type="button"
              className={positionsView === 'transactions' ? 'active' : ''}
              onClick={() => setPositionsView('transactions')}
            >
              Transactions ({trades.length})
            </button>
            <button
              type="button"
              className={positionsView === 'closed' ? 'active' : ''}
              onClick={() => setPositionsView('closed')}
            >
              Closed ({closedTrades.length})
            </button>
          </div>
          <div className="manual-trader__orders" aria-label="Results and positions">
            <div className="manual-trader__orders-body">
              {!visibleTrades.length ? (
                <div className="manual-trader__orders-empty">
                  <small>No positions</small>
                </div>
              ) : (
                visibleTrades.slice(0, 24).map(t => (
                  <div
                    key={t.id}
                    className={`manual-trader__order manual-trader__order--${t.status}`}
                  >
                    <div className="manual-trader__order-header">
                      <div className="manual-trader__order-contract">
                        {MARKET_META[symbol]?.icon ?? null}
                        <ContractTypeIcon ct={t.contractType} size={16} />
                        {t.barrier !== undefined && contractNeedsBarrier(t.contractType) ? (
                          <span className="manual-trader__order-barrier" title="Prediction digit">
                            d{t.barrier}
                          </span>
                        ) : null}
                      </div>
                      {t.status === 'error' ? (
                        <div className="manual-trader__order-error">
                          <span className="manual-trader__order-error-badge" title="Trade failed">
                            !
                          </span>
                          <span className="manual-trader__order-error-text">Failed</span>
                        </div>
                      ) : null}
                    </div>

                    <ManualTrailingDelayProvider
                      walletLoginId={activeLoginid}
                      contractType={t.contractType}
                      entryPrice={t.entryPrice}
                      exitPrice={t.exitPrice}
                    >
                      <div className="manual-trader__order-spots">
                        <div className="manual-trader__order-spot manual-trader__order-spot--entry">
                          <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
                            <circle cx={8} cy={8} r={6} stroke="#FF4444" strokeWidth={1.5} fill="white" />
                            <circle cx={8} cy={8} r={3} fill="#FF4444" />
                          </svg>
                          {formatTickValue(t.entryPrice, symbol)}
                        </div>
                        <div className="manual-trader__order-spot manual-trader__order-spot--exit">
                          <ManualPositionExitCell exitPrice={t.exitPrice} symbol={symbol} />
                        </div>
                      </div>

                      <div className="manual-trader__order-footer">
                        <div className="manual-trader__order-stake">{t.stake.toFixed(2)} USD</div>
                        {(t.status === 'open' || t.status === 'pending') &&
                        typeof t.contractValue === 'number' ? (
                          <div
                            className="manual-trader__order-contract-value"
                            title="Current contract value (sell at market)"
                          >
                            <span className="manual-trader__order-contract-value-label">Value</span>
                            {t.contractValue.toFixed(2)}
                          </div>
                        ) : null}
                        <ManualPositionResultCell trade={t} />
                        {canSellManualTradeRow(t) ? (
                          <button
                            type="button"
                            className="manual-trader__order-sell"
                            disabled={sellingContractId === t.id}
                            onClick={() => void sellContract(t.id)}
                          >
                            {sellingContractId === t.id ? 'Selling…' : 'Sell'}
                          </button>
                        ) : null}
                      </div>
                    </ManualTrailingDelayProvider>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        <section className="manual-trader__chart-panel">
          <div className="manual-trader__smartchart">
            <div ref={chartWrapRef} className="manual-trader__smartchart-pane" />

            {chartHistoryLoading ? (
              <div className="manual-trader__chart-loading" role="status" aria-live="polite">
                <span className="manual-trader__chart-loading-spinner" aria-hidden />
                <span>{chartLoadMessage || 'Loading Denara chart…'}</span>
              </div>
            ) : null}

            {activeMinuteTradeNotifications.length ? (
              <div className="manual-trader__active-trade-notifications" aria-live="polite">
                {activeMinuteTradeNotifications.map(item => (
                  <div
                    key={item.id}
                    className={`manual-trader__active-trade-notification ${
                      item.status === 'pending'
                        ? 'manual-trader__active-trade-notification--pending'
                        : typeof item.profit === 'number' && item.profit < 0
                          ? 'manual-trader__active-trade-notification--loss'
                          : 'manual-trader__active-trade-notification--profit'
                    }`}
                  >
                    <strong>
                      {typeof item.profit === 'number' ? `${item.profit >= 0 ? '+' : ''}${item.profit.toFixed(2)}` : '...'}
                    </strong>
                    <span>{formatRemainingContractDuration(item.secondsRemaining)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="manual-trader__digit-dock" aria-hidden>
              {latestTickDigit !== null ? (
                <>
                  {digitLineup.map(d => {
                    const isLatest = d === latestTickDigit;
                    const rankColor =
                      d === digitDockRanks.most
                        ? '#16a34a'
                        : d === digitDockRanks.third
                          ? '#dc2626'
                          : d === digitDockRanks.least
                            ? '#f59e0b'
                            : null;

                    const isBarrierChoice =
                      !!openDigitContract &&
                      contractNeedsBarrier(openDigitContract.contractType) &&
                      openDigitContract.barrier === d;

                    const barrierSettlementPulse = settlementBarrierPulse === d;

                    const evenOddLiveTint =
                      !!openDigitContract &&
                      (openDigitContract.contractType === 'DIGITEVEN' ||
                        openDigitContract.contractType === 'DIGITODD') &&
                      isLatest &&
                      digitLiveHint !== null;

                    const showRankFill =
                      !!rankColor &&
                      !isBarrierChoice &&
                      !barrierSettlementPulse &&
                      !evenOddLiveTint;

                    const className =
                      `manual-trader__digit-circle` +
                      `${rankColor ? ' manual-trader__digit-circle--ranked' : ''}` +
                      `${isLatest ? ' manual-trader__digit-circle--latest' : ''}` +
                      `${isBarrierChoice ? ' manual-trader__digit-circle--barrier-choice-open' : ''}` +
                      `${barrierSettlementPulse ? ' manual-trader__digit-circle--barrier-settlement-pulse' : ''}` +
                      `${
                        isBarrierChoice && digitLiveHint === true
                          ? ' manual-trader__digit-circle--barrier-live-win'
                          : ''
                      }` +
                      `${
                        isBarrierChoice && digitLiveHint === false
                          ? ' manual-trader__digit-circle--barrier-live-lose'
                          : ''
                      }` +
                      `${evenOddLiveTint && digitLiveHint === true ? ' manual-trader__digit-circle--evenodd-live-win' : ''}` +
                      `${evenOddLiveTint && digitLiveHint === false ? ' manual-trader__digit-circle--evenodd-live-lose' : ''}`;

                    return (
                      <div
                        key={d}
                        className={className}
                        style={showRankFill ? { background: rankColor as string } : undefined}
                        title={`Digit ${d}${isLatest ? ' (latest)' : ''}`}
                      >
                        {d}
                      </div>
                    );
                  })}
                </>
              ) : null}
            </div>

            <div className="manual-trader__chart-controls">
              <div className="manual-trader__chart-market-card">
                <div className="manual-trader__chart-market-row">
                  {selectedMarketMeta.icon ? (
                    <span className="manual-trader__chart-market-icon">{selectedMarketMeta.icon}</span>
                  ) : null}
                  <select
                    className="trade-input manual-trader__chart-market-select"
                    value={symbol}
                    onChange={e => handleMarketChange(e.target.value)}
                  >
                    {SYMBOLS.map(s => (
                      <option key={s} value={s}>
                        {MARKET_META[s]?.label ?? s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="manual-trader__chart-ma-bar" aria-label="Chart indicators">
                <div className="manual-trader__chart-ma-bar-head">
                  {CHART_MA_SPECS[0] ? renderMaToggleButton(CHART_MA_SPECS[0]) : null}
                  {CHART_MA_SPECS.length > 1 ? (
                    <button
                      type="button"
                      className="manual-trader__chart-ma-expand"
                      aria-expanded={chartIndicatorsExpanded}
                      aria-label={
                        chartIndicatorsExpanded ? 'Hide moving averages' : 'Show more moving averages'
                      }
                      title={chartIndicatorsExpanded ? 'Show less' : 'Show more'}
                      onClick={() => setChartIndicatorsExpanded(v => !v)}
                    >
                      <span aria-hidden>{chartIndicatorsExpanded ? '▲' : '▼'}</span>
                    </button>
                  ) : null}
                </div>
                {chartIndicatorsExpanded ? (
                  <div className="manual-trader__chart-ma-bar-more">
                    {CHART_MA_SPECS.slice(1).map(spec => renderMaToggleButton(spec))}
                  </div>
                ) : null}
                <div className="manual-trader__chart-forecast-row">
                  <button
                    type="button"
                    className={`manual-trader__chart-forecast-btn${
                      positionForecastEnabled ? ' is-on' : ''
                    }${positionForecast ? '' : ' is-waiting'}`}
                    aria-pressed={positionForecastEnabled}
                    disabled={!positionForecast}
                    title={
                      positionForecast
                        ? positionForecastEnabled
                          ? 'Hide 3-minute position forecast'
                          : 'Forecast next 3 × 1m candles'
                        : 'Available after MA 9/21 cross, or via RSI/Structure alternatives'
                    }
                    onClick={() => {
                      if (!positionForecast) return;
                      setPositionForecastEnabled(v => !v);
                    }}
                  >
                    <span className="manual-trader__chart-forecast-swatch" aria-hidden />
                    Forecast
                  </button>
                  {positionForecastEnabled && positionForecast ? (
                    <>
                      <div className="manual-trader__chart-forecast-methods" aria-label="Forecast techniques">
                        <span className="manual-trader__chart-forecast-method manual-trader__chart-forecast-method--fixed">
                          MA cross
                        </span>
                        <button
                          type="button"
                          className={`manual-trader__chart-forecast-method${
                            forecastConfig.useRsiSignal ? ' is-on' : ''
                          }`}
                          aria-pressed={!!forecastConfig.useRsiSignal}
                          onClick={() =>
                            setForecastConfig(prev => ({ ...prev, useRsiSignal: !prev.useRsiSignal }))
                          }
                          title="Toggle RSI short-term reversal signal"
                        >
                          RSI
                        </button>
                        <button
                          type="button"
                          className={`manual-trader__chart-forecast-method${
                            forecastConfig.useStructureSignal ? ' is-on' : ''
                          }`}
                          aria-pressed={!!forecastConfig.useStructureSignal}
                          onClick={() =>
                            setForecastConfig(prev => ({
                              ...prev,
                              useStructureSignal: !prev.useStructureSignal,
                            }))
                          }
                          title="Toggle micro structure trend signal"
                        >
                          Structure
                        </button>
                      </div>
                      <div
                        className="manual-trader__chart-forecast-entry"
                        title={`Suggested ${positionForecast.entry.label} entry if the next 3 × 1m candles follow the forecast`}
                      >
                        <span className="manual-trader__chart-forecast-entry-label">Entry</span>
                        <span className="manual-trader__chart-forecast-entry-side">
                          {positionForecast.entry.label}
                        </span>
                        <span className="manual-trader__chart-forecast-entry-price">
                          {formatTickValue(positionForecast.entry.price, symbol)}
                        </span>
                      </div>
                      <div
                        className="manual-trader__chart-forecast-slots"
                        aria-label="Next three one-minute candle forecast"
                      >
                        {positionForecast.slots.map(slot => (
                          <span
                            key={slot.minuteOffset}
                            className={`manual-trader__chart-forecast-slot manual-trader__chart-forecast-slot--${slot.direction}`}
                            title={`+${slot.minuteOffset}m · ${slot.direction === 'up' ? 'bullish' : 'bearish'} · ${
                              positionForecast.mode === 'ma_cross'
                                ? `post ${positionForecast.cross?.type === 'bullish' ? 'golden' : 'death'} cross`
                                : 'RSI/Structure-driven (no MA cross)'
                            }`}
                          >
                            +{slot.minuteOffset}m {slot.direction === 'up' ? '↑' : '↓'}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="manual-trader__settings">
          <div className="manual-trader__settings-head">
            <span className="manual-trader__settings-mode-title">Trading Mode</span>
            <div className="manual-trader__mode-toggle">
              <button type="button" className={modeView === 'auto' ? 'active' : ''} onClick={() => setModeView('auto')}>
                Auto
              </button>
              <button type="button" className={modeView === 'manual' ? 'active' : ''} onClick={() => setModeView('manual')}>
                Manual
              </button>
            </div>
          </div>

          <div className="manual-trader__settings-body">
            <div className="trade-control-group manual-trader__trade-kind-control">
              <label className="manual-trader__trade-kind-label" htmlFor="manual-trader-strategy">
                Strategy
              </label>
              <select
                id="manual-trader-strategy"
                className="trade-input"
                value={manualStrategy}
                onChange={e => setManualStrategy(e.target.value as ManualStrategyKey)}
                aria-label="Strategy"
              >
                <option value="even">Even</option>
                <option value="odd">Odd</option>
                <option value="matches">Matches</option>
                <option value="differs">Differs</option>
                <option value="over">Over</option>
                <option value="under">Under</option>
                <option value="rise">Rise</option>
                <option value="fall">Fall</option>
                <option value="onlyups">Only Ups</option>
                <option value="onlydowns">Only Downs</option>
                <option value="rise_equals">Rise Equals</option>
                <option value="fall_equals">Fall Equals</option>
              </select>
            </div>

            <div className="mtp-trade-actions">
              <button
                type="button"
                className={`mtp-trade-btn mtp-trade-btn--slot-primary ${
                  modeView === 'auto' && autoRunning && autoDirection === contractPair.left ? 'mtp-trade-btn--auto-on' : ''
                }`}
                disabled={!canBuy}
                onClick={() => void handleDirectionClick(contractPair.left)}
              >
                <span>
                  <ContractTypeIcon ct={contractPair.left} size={14} /> {CONTRACT_LABEL[contractPair.left]}
                </span>
                <small>
                  {modeView === 'auto' && autoRunning && autoDirection === contractPair.left
                    ? `Running $${autoStake.toFixed(2)}`
                    : Number.isFinite(Number(payouts[contractPair.left]))
                      ? `$${Number(payouts[contractPair.left]).toFixed(2)}`
                      : '—'}
                </small>
              </button>
              <button
                type="button"
                className={`mtp-trade-btn mtp-trade-btn--slot-alt ${
                  modeView === 'auto' && autoRunning && autoDirection === contractPair.right ? 'mtp-trade-btn--auto-on' : ''
                }`}
                disabled={!canBuy}
                onClick={() => void handleDirectionClick(contractPair.right)}
              >
                <span>
                  <ContractTypeIcon ct={contractPair.right} size={14} /> {CONTRACT_LABEL[contractPair.right]}
                </span>
                <small>
                  {modeView === 'auto' && autoRunning && autoDirection === contractPair.right
                    ? `Running $${autoStake.toFixed(2)}`
                    : Number.isFinite(Number(payouts[contractPair.right]))
                      ? `$${Number(payouts[contractPair.right]).toFixed(2)}`
                      : '—'}
                </small>
              </button>
            </div>

            {strategyNeedsDigit(manualStrategy) ? (
              <div className="manual-trader__barrier-digit trade-control-group">
                <div className="manual-trader__barrier-digit-label">Prediction digit</div>
                <div className="manual-trader__barrier-digit-presets">
                  {BARRIER_DIGITS.map(d => (
                    <button
                      key={d}
                      type="button"
                      className={`manual-trader__barrier-digit-preset${overUnderDigit === d ? ' manual-trader__barrier-digit-preset--active' : ''}`}
                      onClick={() => setOverUnderDigit(d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

          <div className="trade-control-group manual-trader__control-stake">
            <label className="manual-trader__control-label-vis">Stake (USD)</label>
            <div className="manual-trader__stake-display">
              <button type="button" onClick={() => adjustStake(-1)} aria-label="Decrease stake">-</button>
              <div className="manual-trader__stake-value">
                <span>$</span>
                <input
                  type="number"
                  min={0.35}
                  step={0.01}
                  value={stake === '' ? '' : String(stake)}
                  onChange={e => setStake(e.target.value === '' ? '' : Number(e.target.value))}
                  onBlur={e => {
                    const next = Number(e.target.value);
                    if (!Number.isFinite(next)) {
                      setStake(0.35);
                      return;
                    }
                    setStake(Math.max(0.35, Number(next.toFixed(2))));
                  }}
                  aria-label="Stake amount"
                />
              </div>
              <button type="button" onClick={() => adjustStake(1)} aria-label="Increase stake">+</button>
            </div>
            <div className="manual-trader__stake-chips">
              {QUICK_STAKES.map(v => (
                <button
                  key={v}
                  type="button"
                  className={stake === v ? 'manual-trader__stake-chip--active' : undefined}
                  onClick={() => setStake(v)}
                >
                  ${v}
                </button>
              ))}
            </div>
          </div>

          {modeView === 'auto' && (
            <div className="trade-control-group manual-trader__auto-fields">
              <div className="manual-trader__auto-row manual-trader__auto-row--triple">
                <input
                  className="trade-input"
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="Target profit"
                  value={targetProfit === '' ? '' : String(targetProfit)}
                  onChange={e => setTargetProfit(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                  disabled={autoRunning}
                />
                <input
                  className="trade-input"
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="Stop loss"
                  value={stopLoss === '' ? '' : String(stopLoss)}
                  onChange={e => setStopLoss(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                  disabled={autoRunning}
                />
                <input
                  className="trade-input"
                  type="number"
                  min={1}
                  step={0.01}
                  placeholder="Multiplier"
                  value={martingale === '' ? '' : String(martingale)}
                  onChange={e => setMartingale(e.target.value === '' ? '' : Math.max(1, Number(e.target.value)))}
                  disabled={autoRunning}
                />
              </div>
            </div>
          )}

            <div className="trade-control-group manual-trader__control-duration">
              <div className="manual-trader__trade-kind-toggle" style={{ gridTemplateColumns: '1fr 1fr' }} role="group" aria-label="Duration unit">
                <button type="button" className={durationUnit === 't' ? 'active' : ''} onClick={() => setDurationUnit('t')}>
                  Ticks
                </button>
                <button type="button" className={durationUnit === 'm' ? 'active' : ''} onClick={() => setDurationUnit('m')}>
                  Minutes
                </button>
              </div>
              <input
                className="trade-input"
                type="number"
                min={minDurationTicks}
                step={1}
                value={duration === '' ? '' : String(duration)}
                onChange={e =>
                  setDuration(
                    e.target.value === '' ? '' : Math.max(minDurationTicks, Math.floor(Number(e.target.value)))
                  )
                }
                aria-label={durationUnit === 't' ? 'Duration in ticks' : 'Duration in minutes'}
              />
            </div>
          </div>
        </aside>
        </div>
      </div>
    </div>
  );
}
