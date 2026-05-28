import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { sendDerivSessionContractPurchase } from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import { useApiBase } from '@/hooks/useApiBase';
import {
  brickTowerLastDigitFromQuote,
  brickTowerResolveDigitTickDecimals,
} from './brickTowerTickDigitFormat';
import { useStore } from '@/hooks/useStore';
import {
  decideFlipVirtualPair,
  type FlipVirtStrategyType,
  MAX_SESSION_LOSSES,
  ONLY_RUN_MAX_CONSECUTIVE_LOSSES,
  updateAfterFactGovernor,
  type VirtTick,
} from '@/pages/aaflipaa/flipaaVirtualDecision';
import { scheduleCrChanceLedgerRoundTrip } from '@/utils/chanceVirtualStatements';
import {
  ALLOWED_BOT_IFRAME_LOGINID,
  isCrVirtualShadowLogin,
  runWithCrShadowLock,
  tryDebitCrShadowSync,
} from '@/utils/crVirtualBalanceShadow';
/* ====== Icons (same set used in MultiStrategy) ====== */
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
  TradeTypesDigitsOverIcon,
  TradeTypesDigitsUnderIcon,
} from '@deriv/quill-icons';
import './BrickTower.scss';

type TAnalysisItem = {
  digit: number;
  price: number;
  timestamp: Date;
};

/** Analysis chamber history depth (Deriv `ticks_history` — oldest→newest in `history.prices`). */
const BRICK_ANALYSIS_HISTORY_TICK_COUNT = 1000;

const DEFAULT_OVER = [90, 80, 70, 65, 60, 55, 40, 30, 20, 1];
const DEFAULT_UNDER = [1, 20, 30, 35, 40, 45, 60, 70, 80, 90];

/** Sample window: last N ticks (preset buttons only). */
const TICK_PRESETS = [50, 100, 150, 250, 500, 1000] as const;
const DEFAULT_SAMPLE_TICKS = 100;

/** ===== Trading types ===== */
type ContractType = 'DIGITOVER' | 'DIGITUNDER';
type StrategyBasic = 'over' | 'under';
type RiskMode = 'off' | 'low' | 'medium' | 'high' | 'jumble';
type SignalRiskPreset = 'low' | 'medium' | 'high' | 'jumble';

const PRESET_TOAST_TITLE: Record<SignalRiskPreset, string> = {
  low: 'Low risk signals',
  medium: 'Medium risk signals',
  high: 'High risk signals',
  jumble: 'Jumble signals',
};

const PRESET_TOAST_MS = 2500;

/** Copy for “?” help modal — matches `allowedDigitsForMode` + `buildCategoryOrder` (Under desc, then Over asc). */
const SIGNAL_SET_HELP_MODAL: { preset: SignalRiskPreset; title: string; lines: string[] }[] = [
  {
    preset: 'low',
    title: 'Low risk signals',
    lines: [
      'Runs in a fixed order: Under on digits 8, 7, then Over on 1, 2.',
      'Each step only trades when that digit’s live signal % is at or above its threshold.',
      'After a loss, smart mode moves to the next digit in the list (switch on loss = 1).',
    ],
  },
  {
    preset: 'medium',
    title: 'Medium risk signals',
    lines: [
      'Order: Under on 6, 5, 4, then Over on 3, 4, 5.',
      'Same threshold rule per digit; advances on loss within this set.',
    ],
  },
  {
    preset: 'high',
    title: 'High risk signals',
    lines: [
      'Order: Under on 3, 2, then Over on 6, 7.',
      'Same threshold rule per digit; advances on loss within this set.',
    ],
  },
  {
    preset: 'jumble',
    title: 'Jumble signals',
    lines: [
      'Order: Under on every digit 8 down through 0, then Over on 1 through 9.',
      'Widest rotation across barriers; still only trades when thresholds are met.',
    ],
  },
];

type TradeStatus = 'pending' | 'open' | 'active' | 'won' | 'lost' | 'completed' | 'error';

type TTrade = {
  id: string;
  contractType: ContractType;
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
  barrier: number; // prediction digit
};

type TTransaction = { contract_id: string; amount: number; transaction_time: number };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const labelCT = (ct: ContractType) => (ct === 'DIGITOVER' ? 'Over' : 'Under');

// Treat possibly-empty threshold value as 0 for comparisons
const thrNum = (v: number | '' | undefined) => (typeof v === 'number' ? v : 0);

/* ===== Market & Contract Icons map ===== */
const marketIcons: Record<string, JSX.Element> = {
  '1HZ100V': <MarketDerivedVolatility1001sIcon width={16} height={16} />,
  'R_100': <MarketDerivedVolatility100Icon width={16} height={16} />,
  'R_10': <MarketDerivedVolatility10Icon width={16} height={16} />,
  'R_25': <MarketDerivedVolatility25Icon width={16} height={16} />,
  'R_50': <MarketDerivedVolatility50Icon width={16} height={16} />,
  'R_75': <MarketDerivedVolatility75Icon width={16} height={16} />,
  '1HZ10V': <MarketDerivedVolatility101sIcon width={16} height={16} />,
  '1HZ25V': <MarketDerivedVolatility251sIcon width={16} height={16} />,
  '1HZ50V': <MarketDerivedVolatility501sIcon width={16} height={16} />,
  '1HZ15V': <MarketDerivedVolatility151sIcon width={16} height={16} />,
  '1HZ30V': <MarketDerivedVolatility301sIcon width={16} height={16} />,
  '1HZ90V': <MarketDerivedVolatility901sIcon width={16} height={16} />,
  '1HZ75V': <MarketDerivedVolatility751sIcon width={16} height={16} />,
};

const contractIcons: Record<'DIGITOVER' | 'DIGITUNDER', JSX.Element> = {
  DIGITOVER: <TradeTypesDigitsOverIcon width={16} height={16} />,
  DIGITUNDER: <TradeTypesDigitsUnderIcon width={16} height={16} />,
};

/* ===== Entry/Exit spot SVGs (exactly like MultiStrategy) ===== */
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

/* ===== Value formatter (same precision logic as elsewhere) ===== */
const formatTickValue = (v?: number, market?: string) => {
  if (v === undefined) return '—';
  if (!market) return v.toFixed(2);
  return v.toFixed(brickTowerResolveDigitTickDecimals(market));
};

type Target = { ct: ContractType; digit: number };

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

/** Same cadence as Manual Trader auto-chain for CR7557018 — real accounts wait on open contract + ticks. */
const AUTO_CHAIN_GAP_MS_CR_VIRTUAL = 1200;

function brickContractToFlipStrategy(ct: ContractType): FlipVirtStrategyType | null {
  if (ct === 'DIGITOVER') return 'over';
  if (ct === 'DIGITUNDER') return 'under';
  return null;
}

export type BrickTowerProps = {
  /** Hides the large page heading — for dashboard / drawer embeds */
  dashboardEmbed?: boolean;
  /** When true, positions + session stats stay hidden until `showRunPanel` is true */
  deferRunPanel?: boolean;
  /** Used with `deferRunPanel`: set true after the user starts a run (e.g. from parent state) */
  showRunPanel?: boolean;
  /** Called when the user presses Execute and the bot actually starts */
  onRunStarted?: () => void;
};

const BrickTower = observer((props: BrickTowerProps = {}) => {
  const {
    dashboardEmbed = false,
    deferRunPanel = false,
    showRunPanel = true,
    onRunStarted,
  } = props;
  const { client, ui } = useStore();
  const { activeLoginid, tradingSocketGeneration, connectionStatus } = useApiBase();
  const activeLoginidRef = useRef(activeLoginid);
  const clientRef = useRef(client);
  useEffect(() => {
    activeLoginidRef.current = activeLoginid;
  }, [activeLoginid]);
  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  // ───────────────────────── Trading panel states ─────────────────────────
  const [stakeInput, setStakeInput] = useState<number | ''>(0.5);
  const [martingaleInput, setMartingaleInput] = useState<number | ''>(1.25);
  const [ticksInput, setTicksInput] = useState<number | ''>(1); // duration (ticks)
  const [takeProfit, setTakeProfit] = useState<number | ''>(5);
  const [stopLoss, setStopLoss] = useState<number | ''>(50);
  const [entryPoint, setEntryPoint] = useState<number | null>(null);
  const [roundsInput, setRoundsInput] = useState<number | ''>(''); // optional; blank=infinite
  const [isRunning, setIsRunning] = useState(false);
  const [basicStrategy, setBasicStrategy] = useState<StrategyBasic>('over'); // Over/Under for normal mode

  // Manual Over/Under vs smart presets — actual mode for the current run lives in `tradingRiskModeRef`
  const [riskMode, setRiskMode] = useState<RiskMode>('off');
  /** Which risk preset is armed in the UI (none = no chip active). On Execute with none + no manual digit → jumble. */
  const [signalRiskSelection, setSignalRiskSelection] = useState<SignalRiskPreset | null>(null);
  const [presetToastMessage, setPresetToastMessage] = useState<string | null>(null);
  const [signalSetHelpOpen, setSignalSetHelpOpen] = useState(false);

  const tradingRiskModeRef = useRef<RiskMode>('off');
  const autoImpliedJumbleSessionRef = useRef(false);

  // Positions + P/L UI
  const [trades, setTrades] = useState<TTrade[]>([]);
  const [sessionPL, setSessionPL] = useState(0);

  // ───────────────────────── Tick / signal stats (no separate “analysis chamber” UI) ─────────────────────────
  // REMOVE default active digit for Over/Under: user must pick manually
  const [activeOverUnderDigit, setActiveOverUnderDigit] = useState<number | null>(null);

  const [filterCount, setFilterCount] = useState<number>(DEFAULT_SAMPLE_TICKS);
  const [currentSymbol, setCurrentSymbol] = useState<string>('1HZ10V');

  // Thresholds now allow empty values (no snapping)
  const [overThresholds, setOverThresholds] = useState<Array<number | ''>>([...DEFAULT_OVER]);
  const [underThresholds, setUnderThresholds] = useState<Array<number | ''>>([...DEFAULT_UNDER]);

  const [showThresholdPanel, setShowThresholdPanel] = useState(false);
  const thresholdsRef = useRef<HTMLDivElement>(null);

  const [analysisData, setAnalysisData] = useState<{
    lastResults: TAnalysisItem[];
    lastDigit: number | null;
    lastPrice: number | null;
    digitCounts: number[];
    currentMarket: string;
  }>({
    lastResults: [],
    lastDigit: null,
    lastPrice: null,
    digitCounts: Array(10).fill(0),
    currentMarket: '1HZ10V',
  });

  const marketSelectionRef = useRef<HTMLSelectElement>(null);
  const subscribedTickSymbolRef = useRef<string | null>(null);
  const isLiveTickRef = useRef(false);
  const debounceTimer = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (!showThresholdPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowThresholdPanel(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showThresholdPanel]);

  useEffect(() => {
    if (!signalSetHelpOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSignalSetHelpOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [signalSetHelpOpen]);

  /** Light “chat” toast when a signal set is armed (including auto-jumble on Execute). */
  useEffect(() => {
    if (signalRiskSelection === null) {
      setPresetToastMessage(null);
      return;
    }
    const title = PRESET_TOAST_TITLE[signalRiskSelection];
    setPresetToastMessage(`${title} armed — Execute to run this set.`);
    const id = window.setTimeout(() => setPresetToastMessage(null), PRESET_TOAST_MS);
    return () => window.clearTimeout(id);
  }, [signalRiskSelection]);

  const calculateDigitStats = () => {
    const cap = filterCount >= 1 ? Math.min(1000, filterCount) : 1000;
    const filtered = analysisData.lastResults.slice(0, cap);
    const total = filtered.length;
    const digitCounts = Array(10).fill(0);
    filtered.forEach(r => { digitCounts[r.digit]++; });

    return {
      digitCounts,
      total,
    };
  };

  const { digitCounts, total } = calculateDigitStats();

  const handleDigitClick = (digit: number) => {
    setSignalRiskSelection(null);
    if (riskMode !== 'off') setRiskMode('off');
    setActiveOverUnderDigit(digit);
  };

  const feedVirtTick = useCallback((epoch: number, quote: number, market: string) => {
    if (!isCrVirtualShadowLogin(activeLoginidRef.current) || !isRunningRef.current) return;
    if (virtTickMktRef.current !== market) {
      virtTickBufferRef.current = [];
      virtTickMktRef.current = market;
      virtTickEpochRef.current = null;
    }
    if (virtTickEpochRef.current === epoch) return;
    virtTickEpochRef.current = epoch;
    virtTickBufferRef.current.push({ epoch, quote });
    const buf = virtTickBufferRef.current;
    if (buf.length > 600) buf.splice(0, buf.length - 600);
  }, []);

  const seedVirtTicksFromHistory = useCallback(
    (market: string, prices: number[], times: number[]) => {
      if (!isCrVirtualShadowLogin(activeLoginidRef.current)) return;
      if (!prices.length || times.length !== prices.length) return;
      virtTickBufferRef.current = [];
      const n = prices.length;
      const from = Math.max(0, n - 3);
      for (let i = from; i < n; i++) {
        if (Number.isFinite(prices[i]) && Number.isFinite(times[i])) {
          virtTickBufferRef.current.push({ epoch: times[i], quote: prices[i] });
        }
      }
      virtTickEpochRef.current = times[n - 1] ?? null;
      virtTickMktRef.current = market;
    },
    []
  );

  const applyHistoryPrices = useCallback((symbol: string, prices: number[]) => {
    if (!prices.length) return;

    const recent = prices.slice(-BRICK_ANALYSIS_HISTORY_TICK_COUNT);
    const results: TAnalysisItem[] = [];
    const digitCounts = Array(10).fill(0);

    for (let i = recent.length - 1; i >= 0; i--) {
      const price = Number(recent[i]);
      if (!Number.isFinite(price)) continue;
      const lastDigit = brickTowerLastDigitFromQuote(price, symbol);
      digitCounts[lastDigit]++;
      results.push({ digit: lastDigit, price, timestamp: new Date() });
    }

    setAnalysisData({
      lastResults: results,
      lastDigit: results[0]?.digit ?? null,
      lastPrice: results[0]?.price ?? null,
      digitCounts,
      currentMarket: symbol,
    });
  }, []);

  const pushLiveTick = (price: number, market: string) => {
    const lastDigit = brickTowerLastDigitFromQuote(price, market);
    setAnalysisData(prev => {
      const digitCounts = [...prev.digitCounts];
      digitCounts[lastDigit]++;
      const newLastResults: TAnalysisItem[] = [
        { digit: lastDigit, price, timestamp: new Date() },
        ...prev.lastResults,
      ].slice(0, 1000);
      return { ...prev, lastResults: newLastResults, lastDigit, lastPrice: price, digitCounts, currentMarket: market };
    });

    evaluateAndMaybeBuyRef.current();
  };

  const evaluateAndMaybeBuyRef = useRef<() => void>(() => {});

  const handleTick = (val: number) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const market =
      subscribedTickSymbolRef.current || marketSelectionRef.current?.value || currentSymbol;
    debounceTimer.current = setTimeout(() => {
      if (!isLiveTickRef.current) return;
      pushLiveTick(val, market);
    }, 50);
  };

  // Signals (cumulative)
  const overSignalPct = useMemo(() => Array.from({ length: 10 }, (_, d) => {
    if (total === 0) return 0;
    let sum = 0; for (let k = d + 1; k <= 9; k++) sum += digitCounts[k];
    return (sum / total) * 100;
  }), [digitCounts, total]);

  const underSignalPct = useMemo(() => Array.from({ length: 10 }, (_, d) => {
    if (total === 0) return 0;
    let sum = 0; for (let k = 0; k <= d - 1; k++) sum += digitCounts[k];
    return (sum / total) * 100;
  }), [digitCounts, total]);

  const overSignals = useMemo(() => overSignalPct
    .map((pct, d) => ({ d, pct }))
    .filter(({ d, pct }) => pct >= thrNum(overThresholds[d]))
    .map(({ d }) => d), [overSignalPct, overThresholds]);

  const underSignals = useMemo(() => underSignalPct
    .map((pct, d) => ({ d, pct }))
    .filter(({ d, pct }) => pct >= thrNum(underThresholds[d]))
    .map(({ d }) => d), [underSignalPct, underThresholds]);

  // Selected digit for Over/Under: now ONLY user-chosen (no fallback)
  const selectedDigit = activeOverUnderDigit;

  const selOverReq = (selectedDigit !== null) ? thrNum(overThresholds[selectedDigit]) : 0;
  const selUnderReq = (selectedDigit !== null) ? thrNum(underThresholds[selectedDigit]) : 0;
  const selOverSignal = (selectedDigit !== null) ? overSignalPct[selectedDigit] : 0;
  const selUnderSignal = (selectedDigit !== null) ? underSignalPct[selectedDigit] : 0;

  const hitOver = (selectedDigit !== null) && selOverSignal >= selOverReq;
  const hitUnder = (selectedDigit !== null) && selUnderSignal >= selUnderReq;
  const hitClass = (selectedDigit !== null && (hitOver || hitUnder))
    ? (hitOver ? 'selected-digit--hit-over' : 'selected-digit--hit-under')
    : '';

  // Threshold updaters — allow empty input without snapping
  const updateOverFor = (d: number, raw: string) => {
    setOverThresholds(prev => {
      const next = [...prev];
      if (raw === '') next[d] = '';
      else {
        const n = Math.round(Number(raw));
        next[d] = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
      }
      return next;
    });
  };
  const updateUnderFor = (d: number, raw: string) => {
    setUnderThresholds(prev => {
      const next = [...prev];
      if (raw === '') next[d] = '';
      else {
        const n = Math.round(Number(raw));
        next[d] = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
      }
      return next;
    });
  };

  const subscribeMarketTicks = useCallback(async (symbol: string) => {
    if (!api_base.api || api_base.api.connection.readyState !== 1) return;

    subscribedTickSymbolRef.current = symbol;
    isLiveTickRef.current = false;

    try {
      await api_base.api.send({ forget_all: 'ticks' });
    } catch {
      /* noop */
    }

    if (subscribedTickSymbolRef.current !== symbol) return;

    await api_base.api.send({
      ticks_history: symbol,
      style: 'ticks',
      count: BRICK_ANALYSIS_HISTORY_TICK_COUNT,
      end: 'latest',
      subscribe: 1,
    });
  }, []);

  useEffect(() => {
    if (!api_base.api || connectionStatus !== CONNECTION_STATUS.OPENED) return;

    const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
      if (!data || data.error) return;

      const expected = subscribedTickSymbolRef.current;
      if (!expected) return;

      if (data.msg_type === 'history') {
        const reqSym = data.echo_req?.ticks_history;
        if (reqSym && reqSym !== expected) return;

        isLiveTickRef.current = false;
        const prices = (data.history?.prices ?? []).map(Number).filter((n: number) => Number.isFinite(n));
        const times = (data.history?.times ?? []).map(Number);
        if (times.length === prices.length && prices.length) {
          seedVirtTicksFromHistory(expected, prices, times);
        }
        applyHistoryPrices(expected, prices);
        return;
      }

      if (data.msg_type === 'tick' && data.tick) {
        const tickSym = data.tick.symbol ?? data.echo_req?.ticks;
        if (tickSym && tickSym !== expected) return;

        isLiveTickRef.current = true;
        const q = Number(data.tick.quote);
        const ep = Number(data.tick.epoch);
        if (!Number.isFinite(q)) return;
        if (Number.isFinite(ep)) {
          feedVirtTick(ep, q, expected);
        }
        handleTick(q);
      }
    });

    return () => sub.unsubscribe();
  }, [connectionStatus, tradingSocketGeneration, applyHistoryPrices, seedVirtTicksFromHistory, feedVirtTick]);

  useEffect(() => {
    if (connectionStatus !== CONNECTION_STATUS.OPENED) return;

    const symbol = currentSymbol;
    if (marketSelectionRef.current) marketSelectionRef.current.value = symbol;

    setAnalysisData({
      lastResults: [],
      lastDigit: null,
      lastPrice: null,
      digitCounts: Array(10).fill(0),
      currentMarket: symbol,
    });

    void subscribeMarketTicks(symbol);

    return () => {
      subscribedTickSymbolRef.current = null;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      void api_base.api?.send({ forget_all: 'ticks' }).catch(() => {});
    };
  }, [currentSymbol, connectionStatus, tradingSocketGeneration, subscribeMarketTicks]);

  // ───────────────────────── Trading runtime mirrors & refs ─────────────────────────
  const isRunningRef = useRef(isRunning); useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);
  const sessionPLRef = useRef(0); useEffect(() => { sessionPLRef.current = sessionPL; }, [sessionPL]);

  const martingaleInputRef = useRef<number | ''>(martingaleInput);
  useEffect(() => { martingaleInputRef.current = martingaleInput; }, [martingaleInput]);

  const roundsEnabledRef = useRef<boolean>(false);
  const roundsRemainingRef = useRef<number>(0);

  const currentOpenIdRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const haltRef = useRef(false);
  const handleSettleRef = useRef<(cid: string, net: number) => void>(() => {});
  /** Blocks tick-driven `evaluateAndMaybeBuy` until the post–virtual-settle delay elapses (CR shadow only). */
  const crVirtChainLockRef = useRef(false);
  const crVirtChainTimerRef = useRef<number | null>(null);

  // Current target and rotation among candidates (Smart modes only)
  const currentTargetRef = useRef<Target | null>(null);
  const targetRotationRef = useRef<Target[]>([]);
  const rotationIndexRef = useRef(0);

  // NEW: persistent per-mode fixed category order & tried set
  const categoryOrderRef = useRef<Target[]>([]);
  const triedSetRef = useRef<Set<string>>(new Set());

  // Martingale state (single-stream)
  const martingale = useRef({ base: 1, current: 1, step: 0, maxSteps: 7 });

  // Auth re-subscribe guard
  const [apiEpoch, setApiEpoch] = useState(0);
  useEffect(() => {
    const api = api_base.api;
    const conn = api?.connection as any;
    if (!conn) return;
    const bump = () => setApiEpoch(x => x + 1);
    conn.addEventListener('open', bump);
    conn.addEventListener('close', bump);
    return () => {
      try { conn.removeEventListener('open', bump); } catch { }
      try { conn.removeEventListener('close', bump); } catch { }
    };
  }, [apiEpoch]);

  const ensureApiReady = useCallback(async () => {
    const OPEN = 1 as const;
    if (!api_base.api || api_base.api.connection.readyState !== OPEN) {
      await api_base.init(true); // recreate + authorize + subscribe
    }
  }, []);

  /* ─── CR7557018 shadow: virtual ticks fed from main market tick stream ─── */
  const virtTickBufferRef = useRef<VirtTick[]>([]);
  const virtTickEpochRef = useRef<number | null>(null);
  const virtTickMktRef = useRef<string>('');
  const virtTradeInFlightRef = useRef(false);
  const sessionLossesVirtRef = useRef(0);
  const afterFactSuppressedRef = useRef(false);
  const afterFactWinStreakRef = useRef(0);
  const naturalLossStreakRef = useRef(0);
  const onlyRunLossStreakVirtRef = useRef<{ only_up: number; only_down: number }>({ only_up: 0, only_down: 0 });

  const ensureVirtTicksForMarket = useCallback(async (symbol: string) => {
    if (virtTickMktRef.current !== symbol) {
      virtTickBufferRef.current = [];
      virtTickEpochRef.current = null;
      virtTickMktRef.current = symbol;
    }
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      if (virtTickBufferRef.current.length >= 2 && virtTickMktRef.current === symbol) return;
      await sleep(25);
    }
    throw new Error('virtual-tick-timeout');
  }, []);

  useEffect(() => {
    if (!isRunning || !isCrVirtualShadowLogin(activeLoginid)) {
      virtTickBufferRef.current = [];
      virtTickEpochRef.current = null;
      virtTickMktRef.current = '';
    }
  }, [isRunning, activeLoginid]);

  // ====== Risk mode → allowed digit sets ======
  const allowedDigitsForMode = useCallback((mode: RiskMode): { over: number[]; under: number[] } => {
    switch (mode) {
      case 'low': return { over: [1, 2], under: [8, 7] };
      case 'medium': return { over: [3, 4, 5], under: [6, 5, 4] };
      case 'high': return { over: [6, 7], under: [3, 2] };
      case 'jumble': return { over: [1, 2, 3, 4, 5, 6, 7, 8, 9], under: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
      default: return { over: [], under: [] };
    }
  }, []);

  // ===== Helpers: current signal check & candidates =====
  const hasSignal = useCallback((ct: ContractType, digit: number) => {
    if (ct === 'DIGITOVER') return overSignalPct[digit] >= thrNum(overThresholds[digit]);
    return underSignalPct[digit] >= thrNum(underThresholds[digit]);
  }, [overSignalPct, underSignalPct, overThresholds, underThresholds]);

  const entryPointPasses = useCallback(() => {
    if (entryPoint === null || entryPoint === undefined) return true;
    const latest = analysisData.lastDigit;
    return latest === entryPoint;
  }, [entryPoint, analysisData.lastDigit]);

  // === NEW: fixed per-mode order builder (Under desc, then Over asc)
  const buildCategoryOrder = (mode: RiskMode): Target[] => {
    if (mode === 'off') return [];
    const sets = allowedDigitsForMode(mode);
    const order: Target[] = [];
    [...sets.under].sort((a, b) => b - a).forEach(d => order.push({ ct: 'DIGITUNDER', digit: d }));
    [...sets.over].sort((a, b) => a - b).forEach(d => order.push({ ct: 'DIGITOVER', digit: d }));
    return order;
  };

  // === NEW: pick next active target avoiding repeats within cycle
  const pickNextActiveTarget = (): Target | null => {
    const order = categoryOrderRef.current;
    if (!order.length) return null;

    const startAt = currentTargetRef.current
      ? (order.findIndex(t => t.ct === currentTargetRef.current!.ct && t.digit === currentTargetRef.current!.digit) + 1)
      : 0;

    // Pass 1: prefer not-yet-tried with signal
    for (let i = 0; i < order.length; i++) {
      const idx = (startAt + i) % order.length;
      const t = order[idx];
      const key = `${t.ct}:${t.digit}`;
      if (!triedSetRef.current.has(key) && hasSignal(t.ct, t.digit)) return t;
    }

    // Pass 2: reset cycle and pick first with signal
    triedSetRef.current.clear();
    for (let i = 0; i < order.length; i++) {
      const idx = (startAt + i) % order.length;
      const t = order[idx];
      if (hasSignal(t.ct, t.digit)) return t;
    }

    return null; // no signals
  };

  // === NEW: rebuild fixed order on risk mode change; disable digit prediction when smart mode ON
  useEffect(() => {
    if (riskMode !== 'off') {
      categoryOrderRef.current = buildCategoryOrder(riskMode);
      triedSetRef.current.clear();
      // When Smart Trading is active, digit prediction isn't active
      if (activeOverUnderDigit !== null) setActiveOverUnderDigit(null);
      // Drop current target if not in order
      const cur = currentTargetRef.current;
      if (cur && !categoryOrderRef.current.some(t => t.ct === cur.ct && t.digit === cur.digit)) {
        currentTargetRef.current = null;
      }
    } else {
      categoryOrderRef.current = [];
      triedSetRef.current.clear();
    }
  }, [riskMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ====== Build candidate targets (cycle-aware; halts when no signal) ======
  const computeCandidates = useCallback((): Target[] => {
    if (!isRunningRef.current) return [];
    if (!entryPointPasses()) return [];

    const mode = tradingRiskModeRef.current;
    if (mode === 'off') {
      // Manual prediction: requires user-picked digit; HALT if none or no signal
      if (activeOverUnderDigit === null) return [];
      const digit = activeOverUnderDigit;
      const ct: ContractType = basicStrategy === 'over' ? 'DIGITOVER' : 'DIGITUNDER';
      return hasSignal(ct, digit) ? [{ ct, digit }] : [];
    }

    const list: Target[] = [];
    for (const t of categoryOrderRef.current) {
      if (hasSignal(t.ct, t.digit)) list.push(t);
    }
    return list;
  }, [
    basicStrategy, activeOverUnderDigit, hasSignal, entryPointPasses
  ]);

  // ====== Buy pipeline (single in-flight) ======
  const createTempTrade = useCallback((ct: ContractType, stake: number, mkt: string, dur: number, barrier: number) => {
    const id = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const t: TTrade = {
      id, contractType: ct, stake, market: mkt, duration: dur,
      status: 'pending', timestamp: new Date(), marketFormat: mkt, temp: true, barrier
    };
    setTrades(prev => [t, ...prev]);
    return id;
  }, []);

  const stakesByIdRef = useRef<Record<string, number>>({});
  const settledContractsRef = useRef<Set<string>>(new Set());

  const getBalanceError = useCallback((e: any) => {
    const errorObj = e?.error ?? e;
    const message = (errorObj?.message || 'Unknown error').toString();
    const code = errorObj?.code || '';
    const isBalanceError = code === 'InsufficientBalance' || /insufficient|balance|fund|not enough|no enough|low balance/i.test(message);
    return { isBalanceError, message };
  }, []);

  const completeVirtualBrickTrade = useCallback(
    async (tmpID: string, ct: ContractType, stake: number, mkt: string, dur: number, barrier: number) => {
      const loginid = activeLoginidRef.current;
      const cli = clientRef.current;
      if (!loginid || !isCrVirtualShadowLogin(loginid) || !cli) {
        setTrades(ts =>
          ts.map(t =>
            t.id === tmpID
              ? {
                  ...t,
                  status: 'error',
                  temp: false,
                  errorReason: 'Trade failed',
                  errorDetails: 'Wallet not ready (virtual mode)',
                  closeTime: new Date(),
                }
              : t
          )
        );
        throw new Error('restricted');
      }

      const st = brickContractToFlipStrategy(ct);
      if (!st) {
        setTrades(ts =>
          ts.map(t =>
            t.id === tmpID
              ? {
                  ...t,
                  status: 'error',
                  temp: false,
                  errorReason: 'Trade failed',
                  errorDetails: 'Unknown contract',
                  closeTime: new Date(),
                }
              : t
          )
        );
        throw new Error('unknown-contract');
      }

      await ensureApiReady();
      virtTradeInFlightRef.current = true;
      try {
        await ensureVirtTicksForMarket(mkt);

        const proposalResp = await api_base.api!.send({
          proposal: 1,
          amount: stake,
          basis: 'stake',
          currency: 'USD',
          contract_type: ct,
          duration: dur,
          duration_unit: 't',
          symbol: mkt,
          barrier: String(barrier),
        });
        if (proposalResp?.error) {
          const err = proposalResp.error as { message?: string };
          setTrades(ts =>
            ts.map(t =>
              t.id === tmpID
                ? {
                    ...t,
                    status: 'error',
                    temp: false,
                    errorReason: 'Trade failed',
                    errorDetails: String(err?.message ?? proposalResp.error),
                    closeTime: new Date(),
                  }
                : t
            )
          );
          throw proposalResp;
        }
        const pr = proposalResp.proposal as { ask_price?: number; payout?: number };
        const ask = Number(pr.ask_price ?? stake);
        const payout = Number(pr.payout ?? stake * 1.95);

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
          barrier,
          dur,
          mkt
        );

        if (!decision.decided) {
          setTrades(ts =>
            ts.map(t =>
              t.id === tmpID
                ? {
                    ...t,
                    status: 'error',
                    temp: false,
                    errorReason: 'Trade failed',
                    errorDetails: 'Could not resolve virtual outcome',
                    closeTime: new Date(),
                  }
                : t
            )
          );
          throw new Error('virtual-timeout');
        }

        const debitOk = await runWithCrShadowLock(() => tryDebitCrShadowSync(cli, ALLOWED_BOT_IFRAME_LOGINID, ask));
        if (!debitOk) {
          setTrades(ts =>
            ts.map(t =>
              t.id === tmpID
                ? {
                    ...t,
                    status: 'error',
                    temp: false,
                    errorReason: 'Insufficient balance',
                    errorDetails: 'Not enough virtual balance for this stake.',
                    closeTime: new Date(),
                  }
                : t
            )
          );
          throw new Error('insufficient-balance');
        }

        const virtId = `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        stakesByIdRef.current[virtId] = stake;

        const net = decision.win ? payout - ask : -ask;
        const isOneTick = Number(dur || 1) === 1;
        const entryShown = isOneTick ? decision.exit : decision.entry;
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
          walletLoginId: loginid,
          ask,
          settlementCredit,
          entryEpochSec: entryShown.epoch,
          exitEpochSec: exitShown.epoch,
        });

        setTrades(ts =>
          ts.map(t =>
            t.id === tmpID
              ? {
                  ...t,
                  id: virtId,
                  temp: false,
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

        handleSettleRef.current(virtId, net);
        return virtId;
      } finally {
        virtTradeInFlightRef.current = false;
      }
    },
    [ensureApiReady, ensureVirtTicksForMarket]
  );

  const buy = useCallback(
    async (ct: ContractType, stake: number, mkt: string, dur: number, barrier: number) => {
      if (haltRef.current || !isRunningRef.current) return null;

      await ensureApiReady();

      const walletLogin = activeLoginidRef.current || clientRef.current?.loginid || '';
      if (!walletLogin.trim() || !clientRef.current) {
        const tid = createTempTrade(ct, stake, mkt, dur, barrier);
        setTrades(ts =>
          ts.map(t =>
            t.id === tid
              ? {
                  ...t,
                  status: 'error',
                  temp: false,
                  errorReason: 'Trade failed',
                  errorDetails: 'Log in to place trades',
                  closeTime: new Date(),
                }
              : t
          )
        );
        inFlightRef.current = false;
        currentOpenIdRef.current = null;
        return null;
      }

      const tmpID = createTempTrade(ct, stake, mkt, dur, barrier);
      if (isCrVirtualShadowLogin(walletLogin)) {
        try {
          return await completeVirtualBrickTrade(tmpID, ct, stake, mkt, dur, barrier);
        } catch (e: unknown) {
          const msg = (e instanceof Error ? e.message : String(e ?? '')).toString();
          if (!['restricted', 'insufficient-balance', 'virtual-timeout', 'unknown-contract'].includes(msg)) {
            const { isBalanceError, message } = getBalanceError(e);
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
          inFlightRef.current = false;
          currentOpenIdRef.current = null;
          return null;
        }
      }

      try {
        const resp = (await sendDerivSessionContractPurchase(d => api_base.api!.send(d) as Promise<unknown>, {
          contract_type: ct,
          market: mkt,
          duration: dur,
          stake,
          barrier: String(barrier),
        })) as { error?: unknown; buy?: { contract_id?: unknown } };
        if (resp?.error) throw resp;

        const cidRaw = resp.buy?.contract_id;
        if (cidRaw == null || cidRaw === '') throw new Error('No contract_id in buy response');
        const realID = String(cidRaw);
        stakesByIdRef.current[realID] = stake;

        setTrades(ts => ts.map(t => (t.id === tmpID ? { ...t, id: realID, temp: false, status: 'open' } : t)));
        currentOpenIdRef.current = realID;
        return realID;
      } catch (e: any) {
        const { isBalanceError, message } = getBalanceError(e);
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
        inFlightRef.current = false;
        currentOpenIdRef.current = null;
        return null;
      }
    },
    [completeVirtualBrickTrade, createTempTrade, ensureApiReady, getBalanceError]
  );

  // ====== Risk checks: TP / SL ======
  const riskHit = useCallback((plAfter: number) => {
    const tp = takeProfit;
    const sl = stopLoss;
    if (isNum(tp) && tp > 0 && plAfter >= tp) return { hit: true as const, reason: 'take_profit' as const };
    if (isNum(sl) && sl > 0 && -plAfter >= sl) return { hit: true as const, reason: 'stop_loss' as const };
    return { hit: false as const, reason: null };
  }, [takeProfit, stopLoss]);

  const stopBotHard = useCallback((reason: 'take_profit' | 'stop_loss') => {
    if (autoImpliedJumbleSessionRef.current) {
      setSignalRiskSelection(null);
      autoImpliedJumbleSessionRef.current = false;
    }
    if (crVirtChainTimerRef.current != null) {
      window.clearTimeout(crVirtChainTimerRef.current);
      crVirtChainTimerRef.current = null;
    }
    crVirtChainLockRef.current = false;
    // Stop completely (user TP/SL), not just halt
    haltRef.current = true;
    isRunningRef.current = false;
    setIsRunning(false);
    inFlightRef.current = false;
    currentOpenIdRef.current = null;
  }, []);

  // ====== Scheduler & evaluation ======
  const evaluateAndMaybeBuy = useCallback(async () => {
    if (!isRunningRef.current || haltRef.current) return;
    if (crVirtChainLockRef.current) return;
    if (inFlightRef.current || currentOpenIdRef.current) return;

    // rounds guard (only when enabled via input)
    if (roundsEnabledRef.current && roundsRemainingRef.current <= 0) {
      if (autoImpliedJumbleSessionRef.current) {
        setSignalRiskSelection(null);
        autoImpliedJumbleSessionRef.current = false;
      }
      isRunningRef.current = false;
      setIsRunning(false);
      return;
    }

    // risk guard — uses ref which we keep in sync synchronously in settle
    const guard = riskHit(sessionPLRef.current);
    if (guard.hit) { stopBotHard(guard.reason!); return; }

    // build candidate targets ( [] when no signal or entry point unmet )
    const candidates = computeCandidates();
    if (candidates.length === 0) return; // HALT until signals reappear — martingale preserved

    // Decide target
    const mode = tradingRiskModeRef.current;
    let target: Target | null = null;

    if (mode === 'off') {
      target = candidates[0];
    } else {
      // Keep current if still valid, else pick next active from fixed order
      const cur = currentTargetRef.current;
      if (cur && hasSignal(cur.ct, cur.digit)) {
        target = cur;
      } else {
        target = pickNextActiveTarget();
        if (!target) return;
        currentTargetRef.current = target;
      }
    }

    // keep the UI selected digit consistent ONLY when manual mode is off
    if (mode !== 'off') {
      // No digit prediction when smart mode is active
      if (activeOverUnderDigit !== null) setActiveOverUnderDigit(null);
    }

    // stake/duration
    const mkt = marketSelectionRef.current?.value || currentSymbol;
    const duration = (isNum(ticksInput) && ticksInput > 0) ? Math.floor(ticksInput) : 1;

    // Martingale stake
    const mi = isNum(martingaleInputRef.current) ? martingaleInputRef.current : 1;
    const useMg = mi > 1;
    const baseStake = isNum(stakeInput) && stakeInput > 0 ? stakeInput : martingale.current.base;
    const stake = useMg ? martingale.current.current : baseStake;

    inFlightRef.current = true;
    await buy(target.ct, stake, mkt, duration, target.digit);
    inFlightRef.current = false;
  }, [
    computeCandidates, currentSymbol, martingaleInputRef,
    riskMode, riskHit, stopBotHard, ticksInput, stakeInput,
    activeOverUnderDigit, hasSignal, buy
  ]);

  useEffect(() => {
    evaluateAndMaybeBuyRef.current = () => {
      void evaluateAndMaybeBuy();
    };
  }, [evaluateAndMaybeBuy]);

  // ====== Settlement handling (wins/losses/switch) ======

  // FIX: make this return a reason so caller can short-circuit immediately
  const applySessionPLAndMaybeStop = useCallback((net: number): 'none' | 'tp' | 'sl' => {
    // Update the ref synchronously to avoid stale reads
    const next = sessionPLRef.current + net;
    sessionPLRef.current = next;

    const guard = riskHit(next);
    if (guard.hit) {
      stopBotHard(guard.reason!);
      // reflect UI (no harm to set; the ref already has the true value)
      setSessionPL(next);
      return guard.reason === 'take_profit' ? 'tp' : 'sl';
    }

    // No hit — update UI normally
    setSessionPL(next);
    return 'none';
  }, [riskHit, stopBotHard]);

  const handleSettle = useCallback((cid: string, net: number) => {
    const won = net >= 0;

    // Session P/L + TP/SL checks (synchronous guard)
    const reason = applySessionPLAndMaybeStop(net);
    if (reason !== 'none') {
      // FIX: If TP/SL hit, do NOT progress further (no next evaluate call)
      inFlightRef.current = false;
      currentOpenIdRef.current = null;
      return;
    }

    // Martingale update
    const mi = isNum(martingaleInputRef.current) ? martingaleInputRef.current : 1;
    const useMg = mi > 1;

    if (useMg) {
      if (won) { martingale.current.current = martingale.current.base; martingale.current.step = 0; }
      else {
        if (martingale.current.step < martingale.current.maxSteps) {
          martingale.current.step += 1;
          martingale.current.current = Number((martingale.current.current * mi).toFixed(2));
        } else {
          martingale.current.current = martingale.current.base;
          martingale.current.step = 0;
        }
      }
    }

    // Rounds decrement only if rounds are enabled
    if (roundsEnabledRef.current) {
      roundsRemainingRef.current = Math.max(0, roundsRemainingRef.current - 1);
    }

    // Smart mode: on loss advance within category without repeating until exhausted
    if (!won && tradingRiskModeRef.current !== 'off') {
      const prev = currentTargetRef.current;
      if (prev) triedSetRef.current.add(`${prev.ct}:${prev.digit}`);
      const next = pickNextActiveTarget();
      if (next) currentTargetRef.current = next;
    }
    // Normal mode: NO auto-switch

    currentOpenIdRef.current = null;
    inFlightRef.current = false;

    const walletLogin = activeLoginidRef.current || clientRef.current?.loginid || '';
    const scheduleCrVirtChain = isCrVirtualShadowLogin(walletLogin) && String(cid).startsWith('v-');
    if (scheduleCrVirtChain) {
      if (crVirtChainTimerRef.current != null) {
        window.clearTimeout(crVirtChainTimerRef.current);
        crVirtChainTimerRef.current = null;
      }
      crVirtChainLockRef.current = true;
      crVirtChainTimerRef.current = window.setTimeout(() => {
        crVirtChainTimerRef.current = null;
        crVirtChainLockRef.current = false;
        if (!isRunningRef.current || haltRef.current) return;
        void evaluateAndMaybeBuy();
      }, AUTO_CHAIN_GAP_MS_CR_VIRTUAL);
      return;
    }

    // Real-money contracts: next buy as soon as Deriv has settled (matches prior behavior)
    void evaluateAndMaybeBuy();
  }, [applySessionPLAndMaybeStop, riskMode, evaluateAndMaybeBuy]);

  useEffect(() => {
    handleSettleRef.current = handleSettle;
  }, [handleSettle]);

  useEffect(
    () => () => {
      if (crVirtChainTimerRef.current != null) {
        window.clearTimeout(crVirtChainTimerRef.current);
        crVirtChainTimerRef.current = null;
      }
      crVirtChainLockRef.current = false;
    },
    []
  );

  // ====== API message listener (open-contract + transaction) ======
  const handleApiMessage = useCallback(({ data }: any) => {
    if (data?.error) { console.error('WS error', data.error); return; }

    if (data?.msg_type === 'proposal_open_contract') {
      const c = data.proposal_open_contract;
      const cid = String(c.contract_id);

      setTrades(prev => prev.map(tr => {
        if (tr.id !== cid) return tr;
        if (!tr.startTime && c.entry_tick_time) {
          tr.startTime = new Date(c.entry_tick_time * 1000);
          tr.entryValue = c.entry_tick ? Number(c.entry_tick) : undefined;
        }
        if (c.tick_count && c.current_tick) tr.ticksRemaining = c.tick_count - c.current_tick;
        tr.currentValue = c.current_spot ? Number(c.current_spot) : tr.currentValue;

        const finished = c.is_sold || c.is_expired || c.is_settleable || c.status === 'sold';
        if (finished) {
          const net = Number(c.profit ?? 0);
          tr.status = net >= 0 ? 'won' : 'lost';
          tr.profit = net;
          tr.closeTime = new Date();
          tr.exitValue = c.exit_tick ? Number(c.exit_tick) : undefined;
        } else {
          tr.status = (c.status as TradeStatus) || 'active';
        }
        return { ...tr };
      }));

      const finished = c.is_sold || c.is_expired || c.is_settleable || c.status === 'sold';
      if (finished) {
        const cidStr = String(c.contract_id);
        if (!settledContractsRef.current.has(cidStr)) {
          settledContractsRef.current.add(cidStr);
          const net = Number(c.profit ?? 0);
          handleSettle(cidStr, net);
        }
      }
    }

    if (data?.msg_type === 'transaction' && data.transaction?.action === 'sell') {
      const tx: TTransaction = data.transaction;
      const cid = String(tx.contract_id);
      setTrades(prev => prev.map(tr => {
        if (tr.id !== cid) return tr;
        const stake = stakesByIdRef.current[cid] ?? tr.stake ?? 0;
        const net = Number(tx.amount) - stake;
        return {
          ...tr,
          status: net >= 0 ? 'won' : 'lost',
          profit: net,
          closeTime: new Date(tx.transaction_time * 1000),
        };
      }));

      if (!settledContractsRef.current.has(cid)) {
        settledContractsRef.current.add(cid);
        const stake = stakesByIdRef.current[cid] ?? 0;
        const net = Number(tx.amount) - stake;
        handleSettle(cid, net);
      }
    }
  }, [handleSettle]);

  useEffect(() => {
    const sub = api_base.api.onMessage().subscribe(handleApiMessage);
    return () => sub.unsubscribe();
  }, [apiEpoch, tradingSocketGeneration, handleApiMessage]);

  // ====== Run / Stop ======
  const handleRunToggle = useCallback(() => {
    if (isRunningRef.current) {
      // Stop manually
      if (autoImpliedJumbleSessionRef.current) {
        setSignalRiskSelection(null);
        autoImpliedJumbleSessionRef.current = false;
      }
      if (crVirtChainTimerRef.current != null) {
        window.clearTimeout(crVirtChainTimerRef.current);
        crVirtChainTimerRef.current = null;
      }
      crVirtChainLockRef.current = false;
      isRunningRef.current = false;
      setIsRunning(false);
      inFlightRef.current = false;
      currentOpenIdRef.current = null;
      haltRef.current = false;
      return;
    }

    // Start
    // Rounds: enabled only if user provided a positive number
    if (isNum(roundsInput) && roundsInput > 0) {
      roundsEnabledRef.current = true;
      roundsRemainingRef.current = Math.floor(roundsInput);
    } else {
      roundsEnabledRef.current = false; // infinite
      roundsRemainingRef.current = Number.MAX_SAFE_INTEGER;
    }

    const preset = signalRiskSelection;
    const digit = activeOverUnderDigit;
    const autoImpliedJumble = preset === null && digit === null;
    const effective: RiskMode =
      preset !== null ? preset : digit !== null ? 'off' : 'jumble';

    tradingRiskModeRef.current = effective;
    setRiskMode(effective);

    if (autoImpliedJumble) {
      autoImpliedJumbleSessionRef.current = true;
      setSignalRiskSelection('jumble');
    } else {
      autoImpliedJumbleSessionRef.current = false;
    }

    // Init martingale base/current
    const base = (isNum(stakeInput) && stakeInput > 0) ? stakeInput : 1;
    martingale.current.base = base;
    martingale.current.current = base;
    martingale.current.step = 0;

    // Reset locks & maps
    haltRef.current = false;
    inFlightRef.current = false;
    currentOpenIdRef.current = null;
    if (crVirtChainTimerRef.current != null) {
      window.clearTimeout(crVirtChainTimerRef.current);
      crVirtChainTimerRef.current = null;
    }
    crVirtChainLockRef.current = false;
    settledContractsRef.current.clear();
    stakesByIdRef.current = {};
    sessionPLRef.current = sessionPL; // keep ref & state coherent at start

    // Clear current target/rotation & fixed order cycle
    currentTargetRef.current = null;
    targetRotationRef.current = [];
    rotationIndexRef.current = 0;
    triedSetRef.current.clear();
    if (effective !== 'off') categoryOrderRef.current = buildCategoryOrder(effective);
    else categoryOrderRef.current = [];

    isRunningRef.current = true;
    setIsRunning(true);
    onRunStarted?.();

    // Try immediate evaluation (if signal already meets conditions)
    evaluateAndMaybeBuy();
  }, [
    evaluateAndMaybeBuy,
    roundsInput,
    stakeInput,
    sessionPL,
    signalRiskSelection,
    activeOverUnderDigit,
    onRunStarted,
  ]);

  // ====== Aggregate performance (requested block below Reset) ======
  const profitLoss = useMemo(
    () => trades.reduce((s, t) => s + (t.profit ?? 0), 0),
    [trades]
  );
  const tradeStats = useMemo(() => {
    const completed = trades.filter(t => t.status === 'won' || t.status === 'lost');
    return {
      total: completed.length,
      won: completed.filter(t => t.status === 'won').length,
      lost: completed.filter(t => t.status === 'lost').length,
    };
  }, [trades]);

  // ───────────────────────── Render ─────────────────────────
  const hasAnySignals = overSignals.length > 0 || underSignals.length > 0;
  const tickWindowReady = total > 0;
  const showResultsPanel = !deferRunPanel || showRunPanel;

  return (
    <div
      className={`brick-tower-container${ui.is_dark_mode_on ? ' brick-tower-container--dark' : ''}${
        dashboardEmbed ? ' brick-tower-container--dashboard-embed' : ''
      }`}
      style={{ background: ui.is_dark_mode_on ? 'var(--general-main-1)' : 'transparent' }}
    >
      {!dashboardEmbed && (
        <header className="brick-tower-page-heading">
          <h1 className="brick-tower-page-heading__title">
            <span className="brick-tower-page-heading__title-line">Over / Under</span>
            <span className="brick-tower-page-heading__title-accent">Percentage signal trader</span>
          </h1>
          <p className="brick-tower-page-heading__sub">
            Live over% and under% vs digit percentages — executes when signals align.
          </p>
        </header>
      )}

      <div className="brick-tower-top">
        <div className="market-selector brick-tower-market">
          <i className="fas fa-chart-line market-icon" aria-hidden />
          <select
            className="marketSelection"
            id="marketSelection"
            ref={marketSelectionRef}
            onChange={(e) => {
              setCurrentSymbol(e.target.value);
            }}
            value={currentSymbol}
          >
            <option className="Volatility10" value="R_10">
              Volatility 10 index
            </option>
            <option className="Volatility10s" value="1HZ10V">
              Volatility 10(1s) index
            </option>
            <option className="Volatility10s" value="1HZ15V">
              Volatility 15(1s) index
            </option>
            <option className="Volatility25" value="R_25">
              Volatility 25 index
            </option>
            <option className="Volatility25s" value="1HZ25V">
              Volatility 25(1s) index
            </option>
            <option className="Volatility25s" value="1HZ30V">
              Volatility 30(1s) index
            </option>
            <option className="Volatility50" value="R_50">
              Volatility 50 index
            </option>
            <option className="Volatility50s" value="1HZ50V">
              Volatility 50(1s) index
            </option>
            <option className="Volatility75" value="R_75">
              Volatility 75 index
            </option>
            <option className="Volatility75s" value="1HZ75V">
              Volatility 75(1s) index
            </option>
            <option className="Volatility75s" value="1HZ90V">
              Volatility 90(1s) index
            </option>
            <option className="Volatility100" value="R_100">
              Volatility 100 index
            </option>
            <option className="Volatility100s" value="1HZ100V">
              Volatility 100(1s) index
            </option>
          </select>
        </div>

        <div className="brick-tower-live-quote">
          <span className="brick-tower-live-quote__label">Live</span>
          <span className="brick-tower-live-quote__price">
            {analysisData.lastPrice !== null ? formatTickValue(analysisData.lastPrice, currentSymbol) : '—'}
          </span>
          <span className="brick-tower-live-quote__digit">
            last digit{' '}
            <span className="brick-tower-digit-pill" aria-live="polite">
              {analysisData.lastDigit !== null ? analysisData.lastDigit : '—'}
            </span>
          </span>
        </div>
      </div>

      <div className="brick-tower-signal-risk-bar" role="group" aria-label="Risk signal preset">
        <div className="brick-tower-signal-risk-bar__head">
          <div className="brick-tower-signal-risk-bar__title-row">
            <span className="brick-tower-signal-risk-bar__title">Choose Signal Risk</span>
            <button
              type="button"
              className="brick-tower-signal-risk-bar__help"
              aria-label="What each signal set does"
              onClick={() => setSignalSetHelpOpen(true)}
            >
              ?
            </button>
          </div>
          <span className="brick-tower-signal-risk-bar__hint">
            Choose what runs on Execute — tap again to clear. No selection + no manual digit → jumble.
          </span>
        </div>
        <div className="brick-tower-signal-risk-bar__buttons">
          {(
            [
              ['low', 'Low risk signals'],
              ['medium', 'Medium risk signals'],
              ['high', 'High risk signals'],
              ['jumble', 'Jumble signals'],
            ] as const
          ).map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={`brick-tower-signal-risk-btn ${signalRiskSelection === key ? 'active' : ''}`}
              onClick={() => {
                setSignalRiskSelection(prev => {
                  if (prev === key) return null;
                  setActiveOverUnderDigit(null);
                  return key;
                });
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Primary: threshold signals + run/stop */}
      <section className="brick-tower-signals-hero" aria-label="Trading signals">
        <div className="brick-tower-signals-hero__grid">
          <div className="signals-box signals-box--hero">
            <div className="signals-title signals-title--hero">Over digits above percentage</div>
            <div className="signals-badges signals-badges--chips">
              {overSignals.length ? (
                overSignals.map(d => (
                  <span
                    className="signal-digit-chip signal-digit-chip--over"
                    key={`over-${d}`}
                    title={`Over ${overSignalPct[d].toFixed(1)}% · trade when ≥ ${thrNum(overThresholds[d])}%`}
                  >
                    <span className="signal-digit-chip__label">D{d}</span>
                    <span className="signal-digit-chip__pct">{overSignalPct[d].toFixed(1)}%</span>
                  </span>
                ))
              ) : (
                <span className="signals-badges__empty">None</span>
              )}
            </div>
          </div>
          <div className="signals-box signals-box--hero">
            <div className="signals-title signals-title--hero">Under digits above percentage</div>
            <div className="signals-badges signals-badges--chips">
              {underSignals.length ? (
                underSignals.map(d => (
                  <span
                    className="signal-digit-chip signal-digit-chip--under"
                    key={`under-${d}`}
                    title={`Under ${underSignalPct[d].toFixed(1)}% · trade when ≥ ${thrNum(underThresholds[d])}%`}
                  >
                    <span className="signal-digit-chip__label">D{d}</span>
                    <span className="signal-digit-chip__pct">{underSignalPct[d].toFixed(1)}%</span>
                  </span>
                ))
              ) : (
                <span className="signals-badges__empty">None</span>
              )}
            </div>
          </div>
        </div>

        <div className="brick-tower-signals-hero__actions">
          {isRunning ? (
            <>
              <p className="brick-tower-signals-hero__hint">Running — halts when no signal; resumes when signals return.</p>
              <button type="button" className="brick-tower-btn brick-tower-btn--stop" onClick={handleRunToggle}>
                Stop
              </button>
            </>
          ) : !tickWindowReady ? (
            <button type="button" className="brick-tower-btn brick-tower-btn--ghost" disabled>
              Loading tick window…
            </button>
          ) : !hasAnySignals ? (
            <button type="button" className="brick-tower-btn brick-tower-btn--ghost" disabled>
              Waiting for signals…
            </button>
          ) : (
            <button type="button" className="brick-tower-btn brick-tower-btn--primary" onClick={handleRunToggle}>
              Execute signals
            </button>
          )}
        </div>
      </section>

      <div className="brick-tower-toolbar">
        <div className="brick-tower-toolbar__panels">
          <div className="brick-tower-toolbar__panel brick-tower-toolbar__panel--sample">
            <div className="brick-tower-sample-field" aria-label="Sample ticks">
              <span className="brick-tower-sample-field__label">Sample ticks</span>
              <div className="brick-tower-tick-presets" role="group" aria-label="Sample window tick presets">
                {TICK_PRESETS.map(n => (
                  <button
                    key={n}
                    type="button"
                    className={`brick-tower-tick-preset ${filterCount === n ? 'active' : ''}`}
                    onClick={() => setFilterCount(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="brick-tower-toolbar__panel brick-tower-toolbar__panel--trader">
            <div className="brick-tower-digit-trader-panel" aria-label="One digit percentage trader">
              <div className="brick-tower-prediction__titles brick-tower-digit-trader-panel__titles">
                <div className="selector-title brick-tower-prediction__title">One digit percentage trader</div>
                <p className="brick-tower-prediction__subtitle">Trade one digit prediction percentage</p>
              </div>
              <div className="digit-selector brick-tower-digit-selector">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit => (
                  <button
                    type="button"
                    key={`ou-${digit}`}
                    className={`digit-btn brick-tower-digit-btn ${activeOverUnderDigit === digit ? 'active' : ''}`}
                    onClick={() => handleDigitClick(digit)}
                    disabled={signalRiskSelection !== null || (isRunning && riskMode !== 'off')}
                    title={
                      signalRiskSelection !== null
                        ? 'Clear a risk signal set above to pick a digit manually'
                        : isRunning && riskMode !== 'off'
                          ? 'Stop the bot to change digit'
                          : 'Select digit for manual Over/Under'
                    }
                  >
                    <span className="brick-tower-digit-btn__num">{digit}</span>
                  </button>
                ))}
              </div>
              {isRunning && riskMode !== 'off' && (
                <div className="selector-note brick-tower-digit-trader-panel__status">
                  Running smart: <b>{riskMode}</b>
                </div>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="brick-tower-btn brick-tower-btn--secondary"
          onClick={() => setShowThresholdPanel(v => !v)}
          aria-expanded={showThresholdPanel}
        >
          Edit signal percentages
        </button>
      </div>

      {selectedDigit !== null && (
        <div
          className={['selected-digit', 'brick-tower-manual-digit-card', hitClass].filter(Boolean).join(' ').trim()}
          aria-label={`Manual digit ${selectedDigit}, Over and Under percentage thresholds`}
        >
          <div className="brick-tower-manual-digit-card__bar">
            <span className="brick-tower-manual-digit-card__digit-pill" title={`Digit ${selectedDigit}`}>
              D{selectedDigit}
            </span>
            <div className="brick-tower-manual-digit-card__thresholds">
              <div className="brick-tower-manual-digit-card__field">
                <label htmlFor={`brick-manual-over-${selectedDigit}`}>Over ≥ (%)</label>
                <input
                  id={`brick-manual-over-${selectedDigit}`}
                  type="number"
                  className="trade-input brick-tower-manual-digit-card__input"
                  min={0}
                  max={100}
                  step={1}
                  value={overThresholds[selectedDigit] === '' ? '' : String(overThresholds[selectedDigit])}
                  onChange={e => updateOverFor(selectedDigit, e.target.value)}
                />
              </div>
              <div className="brick-tower-manual-digit-card__field">
                <label htmlFor={`brick-manual-under-${selectedDigit}`}>Under ≥ (%)</label>
                <input
                  id={`brick-manual-under-${selectedDigit}`}
                  type="number"
                  className="trade-input brick-tower-manual-digit-card__input"
                  min={0}
                  max={100}
                  step={1}
                  value={underThresholds[selectedDigit] === '' ? '' : String(underThresholds[selectedDigit])}
                  onChange={e => updateUnderFor(selectedDigit, e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedDigit === null && signalRiskSelection === null && !isRunning && (
        <div className="selected-digit selected-digit--hint brick-tower-hint">
          <strong>Pick a digit</strong> for manual Over/Under, or choose a risk signal set above, then Execute.
        </div>
      )}

      {showThresholdPanel && (
        <>
          <div
            className="thresholds-backdrop brick-tower-thresholds-backdrop"
            onClick={() => setShowThresholdPanel(false)}
            aria-hidden
          />
          <div
            className="thresholds-panel thresholds-panel--overlay brick-tower-thresholds-modal"
            ref={thresholdsRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="brick-tower-thresholds-title"
          >
            <div className="thresholds-panel__head">
              <div className="title" id="brick-tower-thresholds-title">
                Signal percentages (per digit)
              </div>
              <div className="hint">Tap any cell to edit. Values are 0–100. Empty = 0.</div>
              <button
                type="button"
                className="thresholds-close"
                onClick={() => setShowThresholdPanel(false)}
                aria-label="Close signal percentages"
              >
                ✕
              </button>
            </div>

            <div className="thresholds-grid">
              <div className="row row-digits">
                <div className="cell cell--label">Digit</div>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                  <div key={`d-${d}`} className="cell cell--digit">
                    {d}
                  </div>
                ))}
              </div>

              <div className="row row-over">
                <div className="cell cell--label">Over ≥ %</div>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                  <div key={`over-${d}`} className="cell">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      className="cell-input cell-input--over"
                      value={overThresholds[d] === '' ? '' : String(overThresholds[d])}
                      onChange={e => updateOverFor(d, e.target.value)}
                    />
                  </div>
                ))}
              </div>

              <div className="row row-under">
                <div className="cell cell--label">Under ≥ %</div>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                  <div key={`under-${d}`} className="cell">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      className="cell-input cell-input--under"
                      value={underThresholds[d] === '' ? '' : String(underThresholds[d])}
                      onChange={e => updateUnderFor(d, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <section className="trading-container brick-tower-contract-panel" aria-label="Contract settings">
        <h2 className="brick-tower-contract-panel__title">Contract settings</h2>
        <div className="trade-controls brick-tower-contract-panel__grid">
          <div className="trade-control-group brick-tower-field">
            <label>Strategy</label>
            <div className="brick-tower-field__row">
              <button
                type="button"
                className={`strat-btn ${basicStrategy === 'over' ? 'active' : ''}`}
                onClick={() => setBasicStrategy('over')}
                disabled={signalRiskSelection !== null || (isRunning && riskMode !== 'off')}
                title={signalRiskSelection !== null ? 'Clear risk signal set to switch strategy' : 'Manual Over/Under'}
              >
                Over
              </button>
              <button
                type="button"
                className={`strat-btn ${basicStrategy === 'under' ? 'active' : ''}`}
                onClick={() => setBasicStrategy('under')}
                disabled={signalRiskSelection !== null || (isRunning && riskMode !== 'off')}
                title={signalRiskSelection !== null ? 'Clear risk signal set to switch strategy' : 'Manual Over/Under'}
              >
                Under
              </button>
            </div>
          </div>

          <div className="trade-control-group brick-tower-field">
            <label>Stake (USD)</label>
            <input
              type="number"
              className="trade-input"
              min={0}
              step={0.01}
              value={stakeInput === '' ? '' : String(stakeInput)}
              onChange={e => setStakeInput(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>

          <div className="trade-control-group brick-tower-field">
            <label>Martingale ×</label>
            <input
              type="number"
              className="trade-input"
              min={1}
              step={0.01}
              value={martingaleInput === '' ? '' : String(martingaleInput)}
              onChange={e => setMartingaleInput(e.target.value === '' ? '' : Number(e.target.value))}
              title=">1 enables martingale"
            />
          </div>

          <div className="trade-control-group brick-tower-field">
            <label>Duration (ticks)</label>
            <input
              type="number"
              className="trade-input"
              min={1}
              step={1}
              value={ticksInput === '' ? '' : String(ticksInput)}
              onChange={e => setTicksInput(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>

          <div className="trade-control-group brick-tower-field brick-tower-field--readonly">
            <label>Switch on loss</label>
            <button type="button" className={`strat-btn ${riskMode !== 'off' ? 'active' : ''}`} disabled>
              {riskMode !== 'off' ? 'ON (1) — smart mode' : 'OFF — manual'}
            </button>
          </div>

          <div className="trade-control-group brick-tower-field">
            <label>Take profit ($)</label>
            <input
              type="number"
              className="trade-input"
              min={0}
              step={0.01}
              value={takeProfit === '' ? '' : String(takeProfit)}
              onChange={e => setTakeProfit(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
            />
          </div>

          <div className="trade-control-group brick-tower-field">
            <label>Stop loss ($)</label>
            <input
              type="number"
              className="trade-input"
              min={0}
              step={0.01}
              value={stopLoss === '' ? '' : String(stopLoss)}
              onChange={e => setStopLoss(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
            />
          </div>

          <div className="trade-control-group brick-tower-field">
            <label>Entry point (digit)</label>
            <input
              type="number"
              className="trade-input"
              placeholder="Any"
              value={entryPoint === null ? '' : String(entryPoint)}
              onChange={e => {
                if (e.target.value === '') setEntryPoint(null);
                else {
                  const v = Math.floor(Number(e.target.value));
                  if (Number.isFinite(v)) setEntryPoint(Math.max(0, Math.min(9, v)));
                }
              }}
              title="Optional; latest tick digit must match"
            />
          </div>

          <div className="trade-control-group brick-tower-field">
            <label>Rounds (blank = ∞)</label>
            <input
              type="number"
              className="trade-input"
              min={1}
              step={1}
              value={roundsInput === '' ? '' : String(roundsInput)}
              onChange={e => setRoundsInput(e.target.value === '' ? '' : Math.max(1, Math.floor(Number(e.target.value))))}
            />
          </div>
        </div>
      </section>

      {showResultsPanel && (
        <>
          <div className="open-positions">
            {trades.length === 0 ? (
              <div className="no-positions"><small>No positions</small></div>
            ) : trades.map(tr => (
              <div
                key={tr.id}
                className={`position-item ${tr.status === 'won'
                    ? 'position-win'
                    : tr.status === 'lost' || tr.status === 'error'
                      ? 'position-loss'
                      : 'position-open'
                  }`}
              >
                <div className="position-header">
                  <div className="position-market-contract">
                    {marketIcons[tr.market] || <span>{tr.market}</span>}
                    <span>{tr.market}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {contractIcons[tr.contractType]}
                      {tr.contractType === 'DIGITOVER' ? 'Over' : 'Under'} D{tr.barrier}
                    </span>
                  </div>

                  {tr.status === 'error' && (
                    <div className="error-display">
                      <span className="error-badge" title={tr.errorDetails || 'Trade failed'}>!</span>
                      <span className="error-text">{tr.errorReason || 'Error'}</span>
                    </div>
                  )}
                </div>

                <div className="position-spots">
                  <div className="spot-entry">
                    <EntrySpotIcon />
                    {formatTickValue(tr.entryValue, tr.marketFormat ?? tr.market)}
                  </div>
                  <div className="spot-exit">
                    <ExitSpotIcon />
                    {formatTickValue(tr.exitValue, tr.marketFormat ?? tr.market)}
                  </div>
                </div>

                <div className="position-footer">
                  <div className="position-stake">{tr.stake.toFixed(2)} USD</div>
                  <div
                    className={`position-result ${tr.status === 'pending'
                        ? 'pending'
                        : tr.status === 'error'
                          ? 'loss'
                          : tr.profit !== undefined
                            ? tr.profit >= 0 ? 'profit' : 'loss'
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
            ))}
          </div>

          <div className="brick-tower-footer-actions">
            <button
              type="button"
              className="trade-btn reset-btn"
              onClick={() => {
                if (isRunningRef.current) return;
                setTrades([]);
                setSessionPL(0);
                sessionPLRef.current = 0;
                settledContractsRef.current.clear();
                currentOpenIdRef.current = null;
                stakesByIdRef.current = {};
                inFlightRef.current = false;
                haltRef.current = false;
                if (crVirtChainTimerRef.current != null) {
                  window.clearTimeout(crVirtChainTimerRef.current);
                  crVirtChainTimerRef.current = null;
                }
                crVirtChainLockRef.current = false;
                currentTargetRef.current = null;
                targetRotationRef.current = [];
                rotationIndexRef.current = 0;
                triedSetRef.current.clear();
                sessionLossesVirtRef.current = 0;
                afterFactSuppressedRef.current = false;
                afterFactWinStreakRef.current = 0;
                naturalLossStreakRef.current = 0;
                onlyRunLossStreakVirtRef.current = { only_up: 0, only_down: 0 };
              }}
              title="Clear positions and P/L"
            >
              Reset session
            </button>
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

          <div className="trade-status">
            <div>
              {isRunning ? 'Bot running (halts on no-signal, auto-resumes)' : 'Ready.'}
              {riskMode !== 'off' && <> · Mode: <b>{riskMode}</b></>}
              {riskMode === 'off' && <> · Strategy: <b>{basicStrategy.toUpperCase()}</b></>}
              {isNum(martingaleInput) && martingaleInput > 1
                ? <> · Martingale: <b>step {martingale.current.step} / {martingale.current.maxSteps} · Current ${martingale.current.current.toFixed(2)}</b></>
                : <> · Martingale: <b>off</b></>}
              <span style={{ marginLeft: 12 }}>· Session P/L: <b>{sessionPL >= 0 ? '+' : ''}{sessionPL.toFixed(2)}</b></span>
              {isNum(takeProfit) && takeProfit > 0 && (
                <span style={{ marginLeft: 12 }}>· TP: <b>{takeProfit.toFixed(2)}</b></span>
              )}
              {isNum(stopLoss) && stopLoss > 0 && (
                <span style={{ marginLeft: 12 }}>· SL: <b>{stopLoss.toFixed(2)}</b></span>
              )}
              {riskMode !== 'off'
                ? <span style={{ marginLeft: 12 }}>· Switch on loss: <b>1</b></span>
                : <span style={{ marginLeft: 12 }}>· Switch on loss: <b>OFF</b></span>
              }
            </div>
          </div>
        </>
      )}

      {deferRunPanel && !showRunPanel && (
        <div className="brick-tower-embed-run-hint" role="status">
          <p className="brick-tower-embed-run-hint__text">
            After you tap <strong>Execute signals</strong>, your positions and run stats appear here.
          </p>
        </div>
      )}

      {presetToastMessage !== null && (
        <div className="brick-tower-preset-toast" role="status" aria-live="polite">
          <div className="brick-tower-preset-toast__bubble">
            <span className="brick-tower-preset-toast__text">{presetToastMessage}</span>
          </div>
        </div>
      )}

      {signalSetHelpOpen && (
        <>
          <div
            className="brick-tower-help-backdrop"
            onClick={() => setSignalSetHelpOpen(false)}
            aria-hidden
          />
          <div
            className="brick-tower-help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="brick-tower-help-title"
          >
            <div className="brick-tower-help-modal__head">
              <h2 id="brick-tower-help-title" className="brick-tower-help-modal__title">
                What each signal set does
              </h2>
              <button
                type="button"
                className="brick-tower-help-modal__close"
                onClick={() => setSignalSetHelpOpen(false)}
                aria-label="Close help"
              >
                ✕
              </button>
            </div>
            <div className="brick-tower-help-modal__body">
              <p className="brick-tower-help-modal__intro">
                When you press <strong>Execute signals</strong>, the bot uses the armed set (or jumble if none is
                selected and no manual digit). It only buys when the live <strong>Over %</strong> or{' '}
                <strong>Under %</strong> for the current digit meets your threshold for that digit.
              </p>
              <ul className="brick-tower-help-modal__list">
                {SIGNAL_SET_HELP_MODAL.map(block => (
                  <li key={block.preset} className="brick-tower-help-modal__item">
                    <div className="brick-tower-help-modal__item-title">{block.title}</div>
                    {block.lines.map((line, i) => (
                      <p key={i} className="brick-tower-help-modal__item-line">
                        {line}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
});

export default BrickTower;