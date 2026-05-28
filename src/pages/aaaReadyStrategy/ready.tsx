// src/pages/aaaStrategies/Flipa/MultiStrategyBot.tsx
import { useCallback, useEffect, useLayoutEffect, useMemo,useRef, useState } from 'react';
import { reaction } from 'mobx';
import { run_panel as RUN_PANEL_TAB } from '@/constants/run-panel';
import { api_base } from '@/external/bot-skeleton';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import {
  decideFlipVirtualPair,
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
import { sendDerivSessionContractPurchase } from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import {
  LegacyPlayFillIcon,
  MarketDerivedJump75Icon,
  TradeTypesDigitsDiffersIcon,
  TradeTypesDigitsEvenIcon,
  TradeTypesDigitsMatchesIcon,
  TradeTypesDigitsOverIcon,
  TradeTypesDigitsUnderIcon,
  TradeTypesUpsAndDownsFallIcon,
  TradeTypesUpsAndDownsRiseIcon,
} from '@deriv/quill-icons';
import LazyYouTubeModal from '../aaaStrategies/LazyYoutubeModal/LazyYoutubeModal';
import type { ReadyTradeStatus, TReadyTrade } from './ready-trade-types';
import {
  createReadyStrategyCards,
  presetUsesUpsDownsStrategies,
  READY_MARKET_OPTIONS,
  type ActiveStrategy,
  type ReadyBuildOptions,
  type ReadyStrategyCard,
  type ReadyStrategyKey,
  type RuntimePresetMode,
  type StrategyType,
} from './readyStrategyPresets';
import {
  createReadyStrategyCards as createDigitBarStrategyCards,
  type ReadyStrategyKey as DigitBarReadyStrategyKey,
} from '../aaaDigitBarReady/readyStrategyPresets';
import {
  readyExternalController,
  stopReadyFromExternal,
  type AutoDigitContract,
  type AutoEvenOddSide,
  type ReadyExternalStartConfig,
} from '../aaaDigitBarReady/readyExternalController';

/** Auto Strategy tab uses Digit Bar presets; Ready Strategies tab uses the full ready list. */
type EngineStrategyKey = ReadyStrategyKey | DigitBarReadyStrategyKey;
import './ready.scss';

type TTrade = TReadyTrade;
type TradeStatus = ReadyTradeStatus;

type TTransaction = { contract_id: string; amount: number; transaction_time: number };

type VirtualHookMode = 'wins' | 'losses';

const DIGIT_KEYS: StrategyType[] = ['matches', 'differs', 'over', 'under'];

const ALL_MARKETS: readonly string[] = READY_MARKET_OPTIONS.map(o => o.value);

const formatTickForMarket = (val: number, market: string) => {
  if (['JD10', 'JD25', 'JD50', 'JD75', 'JD100'].includes(market)) return val.toFixed(2);
  if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(market)) return val.toFixed(3);
  if (market === 'R_50' || market === 'R_75') return val.toFixed(4);
  return val.toFixed(2);
};

const extractLastDigit = (quote: number, market: string) => {
  const s = formatTickForMarket(quote, market);
  const d = parseInt(s.slice(-1), 10);
  return Number.isFinite(d) ? d : null;
};

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
    case 'rise':
      return 'CALL';
    case 'fall':
      return 'PUT';
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

const minTicksForContract = (ct: string) => {
  if (ct === 'RUNHIGH' || ct === 'RUNLOW') return 2;
  return 1;
};

/** Inverse of {@link contractFor} — for CR virtual resolution / flipaa decision engine. */
const CONTRACT_TO_STRATEGY: Record<string, StrategyType> = {
  DIGITEVEN: 'even',
  DIGITODD: 'odd',
  DIGITOVER: 'over',
  DIGITUNDER: 'under',
  DIGITMATCH: 'matches',
  DIGITDIFF: 'differs',
  CALL: 'rise',
  PUT: 'fall',
  RUNHIGH: 'only_up',
  RUNLOW: 'only_down',
  CALLE: 'rise_equals',
  PUTE: 'fall_equals',
};

const isDirectionalDisplayContract = (ct: string) =>
  ct === 'CALL' || ct === 'PUT' || ct === 'CALLE' || ct === 'PUTE' || ct === 'RUNHIGH' || ct === 'RUNLOW';

const MIN_BUY_GAP_MS = 500;
const DELAY_AFTER_SETTLE_MS = 2000;

/** Next buy delay after virtual settle on CR7557018 — instant settle otherwise chains too fast. */
const AUTO_CHAIN_GAP_MS_CR_VIRTUAL = 1000;

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

const isRateLimitError = (e: any) => {
  const errObj = e?.error ?? e;
  const code = (errObj?.code ?? '').toString();
  const msg = (errObj?.message ?? '').toString();
  return code === 'RateLimit' || /rate\s*limit|too\s*many\s*requests|throttl/i.test(msg);
};

type MultiStrategyBotProps = {
  /** Hide Ready chrome when embedded as trading engine for Auto Strategy */
  shellHidden?: boolean;
};

export default function MultiStrategyBot({ shellHidden = false }: MultiStrategyBotProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [market, setMarket] = useState('1HZ10V');
  const [ticks, setTicks] = useState<number | ''>(1);
  const [marketSuggestion, setMarketSuggestion] = useState<{ value: string; label: string } | null>(null);
  const [marketScanning, setMarketScanning] = useState(false);
  const marketScanTimeoutRef = useRef<number | null>(null);
  const [martingaleInput, setMartingaleInput] = useState<number | ''>(1.25);
  const [stakeInput, setStakeInput] = useState<number | ''>(2);
  const [takeProfit, setTakeProfit] = useState<number | ''>('');
  const [stopLoss, setStopLoss] = useState<number | ''>('');
  const [delayAfterSettle, setDelayAfterSettle] = useState(true);

  const [selectedPresetKey, setSelectedPresetKey] = useState<EngineStrategyKey | null>(null);
  const [showPresetModule, setShowPresetModule] = useState(false);

  const [activeStrategies, setActiveStrategies] = useState<ActiveStrategy[]>([]);
  const [currentStratIndex, setCurrentStratIndex] = useState(0);
  const [switchOnLoss, setSwitchOnLoss] = useState(true);
  const [lossesToSwitch, setLossesToSwitch] = useState<number | ''>(1);
  const [mainMode, setMainMode] = useState(false);

  const [trades, setTrades] = useState<TTrade[]>([]);
  const [msg, setMsg] = useState<{ txt: string; type: 'info' | 'success' | 'error' | 'loading' | 'warning' }>({
    txt: '',
    type: 'info',
  });
  const [profitLoss, setPL] = useState(0);
  const [sessionPL, setSessionPL] = useState(0);

  const [ytOpen, setYtOpen] = useState(false);
  const [virtualStatsUI, setVirtualStatsUI] = useState({
    enabled: false,
    wins: 0,
    losses: 0,
    ready: true,
    recoveryOn: false,
    recoveryWins: 0,
    recoveryLosses: 0,
  });


  const rootStore = useStore();
  const { ready_strategy_panel, run_panel: runPanelStore } = rootStore;
  const client = rootStore.client;

  const { activeLoginid, tradingSocketGeneration } = useApiBase();
  const activeLoginidRef = useRef(activeLoginid);
  const clientRef = useRef(client);
  clientRef.current = client;
  useLayoutEffect(() => {
    activeLoginidRef.current = activeLoginid;
  }, [activeLoginid]);

  useEffect(() => {
    ready_strategy_panel.attach();
    return () => ready_strategy_panel.detach();
  }, [ready_strategy_panel]);

  useEffect(() => {
    ready_strategy_panel.sync({
      trades,
      session_pl: sessionPL,
      profit_loss_from_trades: profitLoss,
    });
  }, [ready_strategy_panel, trades, sessionPL, profitLoss]);

  useEffect(() => {
    ready_strategy_panel.setStrategyRunning(isRunning);
  }, [ready_strategy_panel, isRunning]);

  const YT_URL = 'https://youtu.be/lJZO89NS78Q?si=Z_jJLcS1uTTXmNA6';

  const isRunningRef = useRef(false);
  const inFlightRef = useRef(false);
  const currentOpenIdRef = useRef<string | null>(null);
  const settledContractsRef = useRef<Set<string>>(new Set());
  const stakesByIdRef = useRef<Record<string, number>>({});
  const haltRef = useRef(false);
  const lastBuyTsRef = useRef<number>(0);
  const runIdRef = useRef(0);
  const nextTimerRef = useRef<number | null>(null);
  const buyInFlightRef = useRef(false);

  const activeStrategiesRef = useRef<ActiveStrategy[]>([]);
  const currentStratIndexRef = useRef(0);
  const marketRef = useRef(market);
  const ticksRef = useRef(ticks);
  const martingaleInputRef = useRef<number | ''>(martingaleInput);
  const tpRef = useRef<number | ''>(takeProfit);
  const slRef = useRef<number | ''>(stopLoss);
  const delayAfterSettleRef = useRef(false);
  const sessionPLRef = useRef(0);
  const switchOnLossRef = useRef<boolean>(switchOnLoss);
  const lossesToSwitchRef = useRef<number>(1);
  const mainModeRef = useRef(false);

  const presetModeRef = useRef<RuntimePresetMode>('default');
  const readyMarketSequenceRef = useRef<string[]>([]);
  const readyMarketIndexRef = useRef(0);
  const readyMarketWinCountRef = useRef(0);
  const readyAwaitFirstAfterSwitchRef = useRef(false);

  const martingale = useRef({ base: 0.35, current: 0.35, step: 0, maxSteps: 7 });
  const lossStreakByStratRef = useRef<Record<StrategyType, number>>({} as Record<StrategyType, number>);

  const virtualHooksEnabledRef = useRef(false);
  const virtualModeRef = useRef<VirtualHookMode>('wins');
  const virtualTargetRef = useRef(0);
  const martingaleDelayRef = useRef(0);
  const returnToVirtualRef = useRef(1);

  const vWinsRef = useRef(0);
  const vLossesRef = useRef(0);
  const readyForRealRef = useRef(true);
  const recoveryRef = useRef<{ on: boolean; wins: number; losses: number }>({
    on: false,
    wins: 0,
    losses: 0,
  });

  const awaitingVirtualRef = useRef<null | {
    tradeId: string;
    entryPrice: number;
    remaining: number;
    dur: number;
    stake: number;
    market: string;
    contractType: string;
    barrier?: number;
    strategyKey: StrategyType;
  }>(null);

  const tickWsRef = useRef<WebSocket | null>(null);
  const tickMarketRef = useRef('');
  const tickLastQuoteRef = useRef<number | null>(null);
  const tickLastDigitRef = useRef<number | null>(null);

  /** CR7557018 shadow virtual fills — flipaa-style tick buffer + settle bridge */
  const handleSettleRef = useRef<(cid: string, net: number) => void>(() => {});
  const crVirtTickWsRef = useRef<WebSocket | null>(null);
  const virtTickBufferRef = useRef<VirtTick[]>([]);
  const virtTickEpochRef = useRef<number | null>(null);
  const virtTickMktRef = useRef('');
  const virtTradeInFlightRef = useRef(false);
  const sessionLossesVirtRef = useRef(0);
  const afterFactSuppressedRef = useRef(false);
  const afterFactWinStreakRef = useRef(0);
  const naturalLossStreakRef = useRef(0);
  const onlyRunLossStreakVirtRef = useRef<{ only_up: number; only_down: number }>({ only_up: 0, only_down: 0 });

  const cards: ReadyStrategyCard[] = useMemo(
    () => (shellHidden ? createDigitBarStrategyCards() : createReadyStrategyCards()),
    [shellHidden],
  );

  const pendingExternalStartRef = useRef<ReadyExternalStartConfig | null>(null);
  const externalBuildOptionsRef = useRef<ReadyBuildOptions | null>(null);
  const externalAutoContractRef = useRef<AutoDigitContract | null>(null);
  const externalAutoEvenOddSideRef = useRef<AutoEvenOddSide | null>(null);

  const selectedCard = useMemo(
    () => cards.find(card => card.key === selectedPresetKey) ?? null,
    [cards, selectedPresetKey]
  );

  const selectedPresetUsesUpsDowns = useMemo(() => {
    if (!selectedCard) return false;
    return presetUsesUpsDownsStrategies(selectedCard.build(0.35));
  }, [selectedCard]);

  const selectableMarketOptions = useMemo(() => {
    if (!selectedPresetUsesUpsDowns) return [...READY_MARKET_OPTIONS];
    return READY_MARKET_OPTIONS.filter(o => !o.value.startsWith('JD'));
  }, [selectedPresetUsesUpsDowns]);

  const rerollMarketSuggestion = useCallback(() => {
    const pool = selectableMarketOptions;
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    setMarketSuggestion({ value: pick.value, label: pick.label });
  }, [selectableMarketOptions]);

  const clearMarketScanTimeout = useCallback(() => {
    if (marketScanTimeoutRef.current !== null) {
      window.clearTimeout(marketScanTimeoutRef.current);
      marketScanTimeoutRef.current = null;
    }
  }, []);

  /** Loader-driven scan (no label shuffle); reveals one random suggestion when finished — user applies separately */
  const runMarketScan = useCallback(() => {
    if (isRunning || marketScanning) return;
    const pool = selectableMarketOptions;
    if (!pool.length) return;
    clearMarketScanTimeout();
    setMarketScanning(true);

    const scanMs = 1800;

    marketScanTimeoutRef.current = window.setTimeout(() => {
      marketScanTimeoutRef.current = null;
      const finalPick = pool[Math.floor(Math.random() * pool.length)]!;
      setMarketSuggestion({ value: finalPick.value, label: finalPick.label });
      setMarketScanning(false);
    }, scanMs);
  }, [clearMarketScanTimeout, isRunning, marketScanning, selectableMarketOptions]);

  useEffect(() => {
    return () => clearMarketScanTimeout();
  }, [clearMarketScanTimeout]);

  useEffect(() => {
    setSelectedPresetKey(cur => (cur === null && cards[0] ? cards[0].key : cur));
  }, [cards]);

  useEffect(() => {
    if (!selectedCard) {
      clearMarketScanTimeout();
      setMarketScanning(false);
      setMarketSuggestion(null);
      return;
    }
    clearMarketScanTimeout();
    setMarketScanning(false);
    rerollMarketSuggestion();
  }, [clearMarketScanTimeout, rerollMarketSuggestion, selectedCard, selectedPresetUsesUpsDowns]);

  useEffect(() => {
    if (!selectableMarketOptions.some(o => o.value === market)) {
      const next = selectableMarketOptions[0]?.value ?? '1HZ10V';
      setMarket(next);
    }
  }, [selectableMarketOptions, market]);

  const handleSelectStrategy = useCallback(
    (card: ReadyStrategyCard) => {
      if (isRunning) return;
      setSelectedPresetKey(card.key);
    },
    [isRunning]
  );

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    activeStrategiesRef.current = activeStrategies;
  }, [activeStrategies]);

  useEffect(() => {
    currentStratIndexRef.current = currentStratIndex;
  }, [currentStratIndex]);

  useEffect(() => {
    marketRef.current = market;
  }, [market]);

  useEffect(() => {
    ticksRef.current = ticks;
  }, [ticks]);

  useEffect(() => {
    martingaleInputRef.current = martingaleInput;
  }, [martingaleInput]);

  useEffect(() => {
    tpRef.current = takeProfit;
  }, [takeProfit]);

  useEffect(() => {
    slRef.current = stopLoss;
  }, [stopLoss]);

  useEffect(() => {
    delayAfterSettleRef.current = delayAfterSettle;
  }, [delayAfterSettle]);

  useEffect(() => {
    switchOnLossRef.current = switchOnLoss;
  }, [switchOnLoss]);

  useEffect(() => {
    lossesToSwitchRef.current =
      typeof lossesToSwitch === 'number' && lossesToSwitch > 0 ? Math.floor(lossesToSwitch) : 1;
  }, [lossesToSwitch]);

  useEffect(() => {
    mainModeRef.current = mainMode;
  }, [mainMode]);

  useEffect(() => {
    sessionPLRef.current = sessionPL;
  }, [sessionPL]);

  const [apiEpoch, setApiEpoch] = useState(0);

  useEffect(() => {
    const api = api_base.api;
    const conn = api?.connection as { addEventListener: (e: string, fn: () => void) => void; removeEventListener: (e: string, fn: () => void) => void; readyState?: number } | undefined;
    if (!conn) return;

    const bump = () => setApiEpoch(x => x + 1);
    conn.addEventListener('open', bump);
    conn.addEventListener('close', bump);
    /** Socket may already be OPEN after Options account switches (new `api_base.api` instance). */
    if (conn.readyState === 1) {
      bump();
    }

    return () => {
      try {
        conn.removeEventListener('open', bump);
        conn.removeEventListener('close', bump);
      } catch {
        void 0;
      }
    };
  }, [activeLoginid, tradingSocketGeneration]);

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

  const rateLimitRef = useRef<{ until: number; attempt: number; lastMsg: string }>({
    until: 0,
    attempt: 0,
    lastMsg: '',
  });

  const clearNextTimer = useCallback(() => {
    if (nextTimerRef.current != null) {
      window.clearTimeout(nextTimerRef.current);
      nextTimerRef.current = null;
    }
  }, []);

  const waitForRateLimitBackoff = useCallback(async () => {
    const now = Date.now();
    if (now < rateLimitRef.current.until) {
      const ms = rateLimitRef.current.until - now;
      await sleep(ms);
    }
  }, []);

  const setStatus = useCallback(
    (txt: string, type: 'info' | 'success' | 'error' | 'loading' | 'warning' = 'info') => setMsg({ txt, type }),
    []
  );

  const getBalanceError = useCallback((e: any) => {
    const errorObj = e?.error ?? e;
    const message = (errorObj?.message || 'Unknown error').toString();
    const code = errorObj?.code || '';
    const isBalanceError =
      code === 'InsufficientBalance' ||
      /insufficient|balance|fund|not enough|no enough|low balance/i.test(message);
    return { isBalanceError, message };
  }, []);

  const applyRateLimitBackoff = useCallback(
    async (err: any) => {
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
    },
    []
  );

  const clearRateLimitBackoff = useCallback(() => {
    rateLimitRef.current.attempt = 0;
    rateLimitRef.current.until = 0;
    rateLimitRef.current.lastMsg = '';
  }, []);

  const buildMarketSequence = useCallback((startMarket: string, excludeJumpIndices: boolean) => {
    let list = [...ALL_MARKETS];
    if (excludeJumpIndices) {
      list = list.filter(s => !s.startsWith('JD'));
    }
    if (!list.length) {
      list = [...ALL_MARKETS].filter(s => !s.startsWith('JD'));
    }
    const idx = list.indexOf(startMarket);
    if (idx <= 0) return list;
    return [...list.slice(idx), ...list.slice(0, idx)];
  }, []);

  const advanceReadyMarket = useCallback(() => {
    const seq = readyMarketSequenceRef.current;
    if (!seq.length) return;
    readyMarketIndexRef.current = (readyMarketIndexRef.current + 1) % seq.length;
  }, []);

  const pickMarketFromRefs = useCallback(() => {
    if (presetModeRef.current === 'market_flip_after_3_wins') {
      const seq = readyMarketSequenceRef.current;
      if (seq.length) return seq[readyMarketIndexRef.current % seq.length];
    }
    return marketRef.current;
  }, []);

  const updateVirtualUI = useCallback(() => {
    setVirtualStatsUI({
      enabled: virtualHooksEnabledRef.current,
      wins: vWinsRef.current,
      losses: vLossesRef.current,
      ready: readyForRealRef.current,
      recoveryOn: recoveryRef.current.on,
      recoveryWins: recoveryRef.current.wins,
      recoveryLosses: recoveryRef.current.losses,
    });
  }, []);

  const resetVirtualCycle = useCallback(() => {
    vWinsRef.current = 0;
    vLossesRef.current = 0;
    readyForRealRef.current = virtualTargetRef.current <= 0;
    updateVirtualUI();
  }, [updateVirtualUI]);

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
    tickLastQuoteRef.current = null;
    tickLastDigitRef.current = null;
  }, []);

  const closeCrVirtTickWs = useCallback(() => {
    if (crVirtTickWsRef.current) {
      try {
        crVirtTickWsRef.current.onopen = null;
        crVirtTickWsRef.current.onmessage = null;
        crVirtTickWsRef.current.onerror = null;
        crVirtTickWsRef.current.onclose = null;
        crVirtTickWsRef.current.close();
      } catch {
        /* ignore */
      }
      crVirtTickWsRef.current = null;
    }
    virtTickEpochRef.current = null;
    virtTickMktRef.current = '';
  }, []);

  const openCrVirtTickWs = useCallback(
    (symbol: string) => {
      closeCrVirtTickWs();
      virtTickBufferRef.current = [];
      virtTickMktRef.current = symbol;

      const app_id = 1089;
      const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);
      crVirtTickWsRef.current = ws;

      ws.onopen = async () => {
        try {
          const seed = await api_base.api?.send({
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
    [closeCrVirtTickWs]
  );

  const ensureVirtTicksForCrMarket = useCallback(
    async (symbol: string) => {
      if (virtTickMktRef.current !== symbol || !crVirtTickWsRef.current) {
        openCrVirtTickWs(symbol);
      }
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        if (virtTickBufferRef.current.length >= 2) return;
        await sleep(25);
      }
      throw new Error('virtual-tick-timeout');
    },
    [openCrVirtTickWs]
  );

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
      barrier,
      virtual: true,
      virtualLabel: 'Virtual Hook',
    };
    setTrades(prev => [t, ...prev]);
    return id;
  }, []);

  const evalVirtualIsLoss = useCallback(
    (strategyKey: StrategyType, lastDigit: number, price: number, entryPrice: number, barrier?: number) => {
      switch (strategyKey) {
        case 'even':
          return lastDigit % 2 !== 0;
        case 'odd':
          return lastDigit % 2 === 0;
        case 'over':
          return lastDigit <= Number(barrier ?? 0);
        case 'under':
          return lastDigit >= Number(barrier ?? 0);
        case 'matches':
          return lastDigit !== Number(barrier ?? 0);
        case 'differs':
          return lastDigit === Number(barrier ?? 0);
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
    },
    []
  );

  const applyVirtualOutcome = useCallback(
    (loss: boolean) => {
      if (virtualModeRef.current === 'wins') {
        if (!loss) vWinsRef.current += 1;
        else vWinsRef.current = 0;
      } else {
        if (loss) vLossesRef.current += 1;
        else vLossesRef.current = 0;
      }

      readyForRealRef.current =
        virtualTargetRef.current > 0
          ? virtualModeRef.current === 'wins'
            ? vWinsRef.current >= virtualTargetRef.current
            : vLossesRef.current >= virtualTargetRef.current
          : true;

      updateVirtualUI();
    },
    [updateVirtualUI]
  );

  const updateRecoveryOnRealOutcome = useCallback(
    (isWin: boolean) => {
      if (!virtualHooksEnabledRef.current) return;

      if (!recoveryRef.current.on && !isWin) {
        recoveryRef.current.on = true;
        recoveryRef.current.wins = 0;
        recoveryRef.current.losses = 0;
        updateVirtualUI();
        return;
      }

      if (!recoveryRef.current.on && isWin) {
        resetVirtualCycle();
        updateVirtualUI();
        return;
      }

      if (recoveryRef.current.on) {
        if (isWin) recoveryRef.current.wins += 1;
        else recoveryRef.current.losses += 1;

        const threshold = Math.max(1, returnToVirtualRef.current || 1);
        if (recoveryRef.current.wins >= threshold) {
          recoveryRef.current.on = false;
          recoveryRef.current.wins = 0;
          recoveryRef.current.losses = 0;
          resetVirtualCycle();
        } else {
          updateVirtualUI();
        }
      }
    },
    [resetVirtualCycle, updateVirtualUI]
  );

  const ensureTickStream = useCallback(
    (symbol: string) => {
      if (!isRunningRef.current) return;
      if (!virtualHooksEnabledRef.current) return;
      if (tickWsRef.current && tickMarketRef.current === symbol) return;

      closeTickWS();

      const app_id = 1089;
      tickMarketRef.current = symbol;

      const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);
      tickWsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            ticks_history: symbol,
            style: 'ticks',
            count: 50,
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
            const prices: number[] = (data.history?.prices || []).map(Number);
            const last = prices.length ? Number(prices[prices.length - 1]) : NaN;
            if (Number.isFinite(last)) {
              tickLastQuoteRef.current = last;
              tickLastDigitRef.current = extractLastDigit(last, symbol);
            }
            return;
          }

          if (data?.msg_type === 'tick') {
            const quote = Number(data.tick?.quote);
            if (!Number.isFinite(quote)) return;

            tickLastQuoteRef.current = quote;
            tickLastDigitRef.current = extractLastDigit(quote, symbol);

            const a = awaitingVirtualRef.current;
            if (a && a.market === symbol && tickLastDigitRef.current != null) {
              a.remaining -= 1;

              setTrades(prev =>
                prev.map(tr =>
                  tr.id === a.tradeId
                    ? {
                        ...tr,
                        currentValue: quote,
                      }
                    : tr
                )
              );

              if (a.remaining <= 0) {
                const loss = evalVirtualIsLoss(
                  a.strategyKey,
                  tickLastDigitRef.current,
                  quote,
                  a.entryPrice,
                  a.barrier
                );

                const deciding = quote;
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

                applyVirtualOutcome(loss);
                awaitingVirtualRef.current = null;

                if (isRunningRef.current && !haltRef.current) {
                  scheduleNext(loss ? 'after_loss' : 'after_win');
                }
              }
            }
          }
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {};
      ws.onclose = () => {};
    },
    [applyVirtualOutcome, closeTickWS, evalVirtualIsLoss]
  );

  useEffect(() => {
    return () => closeTickWS();
  }, [closeTickWS]);

  const getNextConfigFromRefs = useCallback((): NextCfg => {
    const actives = activeStrategiesRef.current;
    if (!actives || actives.length === 0) return { error: 'No ready strategy configured' };

    const idx = currentStratIndexRef.current % actives.length;
    const strat = actives[idx];
    const ct = contractFor(strat.key)!;
    const needBarrier = DIGIT_KEYS.includes(strat.key);
    const barrier = strat.prediction;

    if (needBarrier && !(typeof barrier === 'number' && barrier >= 0 && barrier <= 9)) {
      return { error: 'Missing digit prediction' };
    }

    const mi = isNum(martingaleInputRef.current) ? martingaleInputRef.current : 1;
    const useMg = mi > 1;

    const base =
      isNum(strat.stake) && strat.stake > 0
        ? strat.stake
        : isNum(stakeInput) && stakeInput > 0
        ? stakeInput
        : 0.35;

    const stake = useMg ? martingale.current.current : base;
    let dur = typeof ticksRef.current === 'number' && ticksRef.current > 0 ? Math.floor(ticksRef.current) : 1;
    dur = Math.max(dur, minTicksForContract(ct));

    return {
      contractType: ct,
      stake,
      market: pickMarketFromRefs(),
      duration: dur,
      barrier: typeof barrier === 'number' ? barrier : undefined,
    };
  }, [pickMarketFromRefs, stakeInput]);

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

  const completeVirtualCrReadyTrade = useCallback(
    async (tmpID: string, ct: string, stake: number, mkt: string, dur: number, barrier?: number) => {
      const cli = clientRef.current;
      if (!cli) throw new Error('restricted');
      const shadowKey = ALLOWED_BOT_IFRAME_LOGINID;

      const st = CONTRACT_TO_STRATEGY[ct];
      if (!st) {
        patchTempToError(tmpID, 'Trade failed', 'Unknown contract');
        throw new Error('unknown-contract');
      }

      await ensureApiReady();
      virtTradeInFlightRef.current = true;
      try {
        await ensureVirtTicksForCrMarket(mkt);

        const proposalResp = await api_base.api!.send({
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
        if (proposalResp?.error) throw proposalResp.error;
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
          typeof barrier === 'number' ? barrier : undefined,
          dur,
          mkt
        );

        if (!decision.decided) {
          patchTempToError(tmpID, 'Trade failed', 'Could not resolve virtual outcome');
          throw new Error('virtual-timeout');
        }

        const debitOk = await runWithCrShadowLock(() => tryDebitCrShadowSync(cli, shadowKey, ask));
        if (!debitOk) {
          patchTempToError(tmpID, 'Trade failed — insufficient balance', 'Not enough virtual balance for this stake.');
          throw new Error('insufficient-balance');
        }

        const net = decision.win ? payout - ask : -ask;
        const virtId = `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        stakesByIdRef.current[virtId] = stake;

        const isDir = isDirectionalDisplayContract(ct);
        const isOneTick = dur === 1;
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
        const walletLogin = activeLoginidRef.current || cli.loginid || '';
        scheduleCrChanceLedgerRoundTrip({
          client: cli,
          walletLoginId: walletLogin,
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
                  closeTime: new Date(),
                  startTime: new Date(entryShown.epoch * 1000),
                }
              : t
          )
        );

        clearRateLimitBackoff();
        setStatus('✅ Trade placed', 'success');
        handleSettleRef.current(virtId, net);
        return virtId;
      } finally {
        virtTradeInFlightRef.current = false;
      }
    },
    [ensureApiReady, ensureVirtTicksForCrMarket, setStatus, clearRateLimitBackoff]
  );

  const buy = async (ct: string, stake: number, mkt: string, dur: number, barrier?: number) => {
    if (haltRef.current || !isRunningRef.current) throw new Error('Trading halted');
    if (buyInFlightRef.current) throw new Error('Buy in flight');
    buyInFlightRef.current = true;

    const tmpID = createTempTrade(ct, stake, mkt, dur, barrier);

    try {
      const walletLogin = activeLoginidRef.current || clientRef.current?.loginid || '';
      if (isCrVirtualShadowLogin(walletLogin)) {
        if (!clientRef.current) {
          patchTempToError(tmpID, 'Wallet not ready', 'Virtual trading requires an initialized wallet.');
          setStatus('Wallet not ready — wait and retry', 'error');
          throw new Error('Wallet not ready');
        }
        await ensureApiReady();
        await waitForThrottleGap();
        await waitForRateLimitBackoff();
        try {
          return await completeVirtualCrReadyTrade(tmpID, ct, stake, mkt, dur, barrier);
        } catch (e: unknown) {
          const msg = (e instanceof Error ? e.message : String(e ?? '')).toString();
          if (
            !['restricted', 'insufficient-balance', 'virtual-timeout', 'unknown-contract', 'Wallet not ready'].includes(
              msg
            )
          ) {
            const { message } = getBalanceError(e);
            setStatus(message || msg || 'Trade failed', 'error');
          }
          inFlightRef.current = false;
          currentOpenIdRef.current = null;
          throw e;
        }
      }

      await ensureApiReady();
      await waitForThrottleGap();
      await waitForRateLimitBackoff();

      const MAX_RL_RETRIES = 8;

      for (let attempt = 0; attempt <= MAX_RL_RETRIES; attempt++) {
        if (haltRef.current || !isRunningRef.current) throw new Error('Trading halted');

        try {
          const liveApi = await ensureApiReady();
          const resp = (await sendDerivSessionContractPurchase(d => liveApi.send(d) as Promise<unknown>, {
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

          setTrades(ts =>
            ts.map(t =>
              t.id === tmpID
                ? {
                    ...t,
                    id: realID,
                    temp: false,
                    status: 'open',
                  }
                : t
            )
          );

          setStatus('✅ Trade placed', 'success');
          return realID;
        } catch (e: any) {
          if (isRateLimitError(e) && attempt < MAX_RL_RETRIES) {
            await applyRateLimitBackoff(e);
            await waitForRateLimitBackoff();
            continue;
          }

          const { isBalanceError, message } = getBalanceError(e);
          patchTempToError(tmpID, isBalanceError ? 'Insufficient balance' : 'Trade failed', message);
          setStatus(message || 'Trade failed', 'error');

          inFlightRef.current = false;
          currentOpenIdRef.current = null;
          throw e;
        }
      }

      patchTempToError(tmpID, 'Rate limit', 'Too many rate limit retries');
      setStatus('Rate limit retries exhausted', 'error');
      throw new Error('Rate limit retries exhausted');
    } finally {
      buyInFlightRef.current = false;
    }
  };

  const riskHit = (plAfter: number) => {
    const tp = tpRef.current;
    const sl = slRef.current;
    if (isNum(tp) && tp > 0 && plAfter >= tp) return { hit: true, reason: 'take_profit' as const };
    if (isNum(sl) && sl > 0 && -plAfter >= sl) return { hit: true, reason: 'stop_loss' as const };
    return { hit: false as const, reason: null as null };
  };

  const stopBotHard = useCallback(
    (reason: 'take_profit' | 'stop_loss') => {
      haltRef.current = true;
      isRunningRef.current = false;
      setIsRunning(false);
      inFlightRef.current = false;
      currentOpenIdRef.current = null;
      awaitingVirtualRef.current = null;
      clearNextTimer();
      closeTickWS();
      closeCrVirtTickWs();
      setStatus(`⛔ ${reason === 'take_profit' ? 'Take Profit reached' : 'Stop Loss hit'}. Trading stopped.`, 'warning');
    },
    [clearNextTimer, closeCrVirtTickWs, closeTickWS, setStatus]
  );

  const applySessionPLAndMaybeStop = useCallback(
    (net: number) => {
      setSessionPL(prev => {
        const next = prev + net;
        sessionPLRef.current = next;
        const guard = riskHit(next);
        if (guard.hit) stopBotHard(guard.reason!);
        return next;
      });
    },
    [stopBotHard]
  );

  const handlePresetOutcome = useCallback(
    (won: boolean) => {
      const mode = presetModeRef.current;
      const actives = activeStrategiesRef.current;
      if (!actives.length) return;

      if (virtualHooksEnabledRef.current) {
        updateRecoveryOnRealOutcome(won);
      }

      if (mode === 'market_flip_after_3_wins') {
        if (won) {
          readyMarketWinCountRef.current += 1;

          if (readyMarketWinCountRef.current >= 3) {
            advanceReadyMarket();
            readyMarketWinCountRef.current = 0;
            readyAwaitFirstAfterSwitchRef.current = true;
            setStatus('🔁 3 wins reached — switched market', 'success');
          } else {
            readyAwaitFirstAfterSwitchRef.current = false;
          }
        } else {
          if (readyAwaitFirstAfterSwitchRef.current) {
            advanceReadyMarket();
            readyAwaitFirstAfterSwitchRef.current = false;
            readyMarketWinCountRef.current = 0;
            setStatus('🔁 First trade lost after switch — switched market again', 'warning');
          } else {
            readyMarketWinCountRef.current = 0;
          }
        }
        return;
      }

      if (mode === 'rotate_each_settle') {
        const next = (currentStratIndexRef.current + 1) % actives.length;
        currentStratIndexRef.current = next;
        setCurrentStratIndex(next);
        return;
      }

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
    },
    [advanceReadyMarket, setStatus, updateRecoveryOnRealOutcome]
  );

  const handleSettle = useCallback(
    (cid: string, net: number) => {
      const won = net >= 0;

      applySessionPLAndMaybeStop(net);

      if (!isRunningRef.current || haltRef.current) {
        inFlightRef.current = false;
        currentOpenIdRef.current = null;
        return;
      }

      const mi = isNum(martingaleInputRef.current) ? martingaleInputRef.current : 1;
      const useMg = mi > 1;

      if (useMg) {
        if (won) {
          martingale.current.current = martingale.current.base;
          martingale.current.step = 0;
        } else {
          const delay = Math.max(0, martingaleDelayRef.current || 0);
          const effectiveStep = martingale.current.step + 1;
          if (effectiveStep <= delay) {
            martingale.current.step = effectiveStep;
            martingale.current.current = martingale.current.base;
          } else if (effectiveStep < martingale.current.maxSteps + delay + 1) {
            martingale.current.step = effectiveStep;
            const multStep = effectiveStep - delay;
            martingale.current.current = Number(
              (martingale.current.base * Math.pow(mi, multStep)).toFixed(2)
            );
          } else {
            martingale.current.current = martingale.current.base;
            martingale.current.step = 0;
          }
        }
      }

      handlePresetOutcome(won);

      if (currentOpenIdRef.current === cid) currentOpenIdRef.current = null;
      inFlightRef.current = false;

      if (isRunningRef.current && !haltRef.current) {
        scheduleNext(won ? 'after_win' : 'after_loss');
      }
    },
    [applySessionPLAndMaybeStop, handlePresetOutcome]
  );

  useLayoutEffect(() => {
    handleSettleRef.current = handleSettle;
  }, [handleSettle]);

  const handleApiMessage = useCallback(
    ({ data }: any) => {
      if (data?.error) return;

      if (data?.msg_type === 'proposal_open_contract') {
        const c = data.proposal_open_contract;
        const cid = String(c.contract_id);
        if (cid.startsWith('v-')) return;

        setTrades(prev =>
          prev.map(tr => {
            if (tr.id !== cid) return tr;

            const next = { ...tr };

            if (!next.startTime && c.entry_tick_time) {
              next.startTime = new Date(c.entry_tick_time * 1000);
              next.entryValue = c.entry_tick ? Number(c.entry_tick) : undefined;
            }

            if (c.tick_count && c.current_tick) next.ticksRemaining = c.tick_count - c.current_tick;
            next.currentValue = c.current_spot ? Number(c.current_spot) : next.currentValue;

            const finished = c.is_sold || c.is_expired || c.is_settleable || c.status === 'sold';
            if (finished) {
              const net = Number(c.profit ?? 0);
              next.status = net >= 0 ? 'won' : 'lost';
              next.profit = net;
              next.closeTime = new Date();
              next.exitValue = c.exit_tick ? Number(c.exit_tick) : undefined;
            } else {
              next.status = (c.status as TradeStatus) || 'active';
            }

            return next;
          })
        );

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
          settledContractsRef.current.add(cid);
          const stake = stakesByIdRef.current[cid] ?? 0;
          const net = Number(tx.amount) - stake;
          handleSettle(cid, net);
        }
      }
    },
    [handleSettle]
  );

  useEffect(() => {
    let sub: { unsubscribe: () => void } | null = null;
    let cancelled = false;
    const start = async () => {
      try {
        const liveApi = await ensureApiReady();
        if (cancelled) return;
        sub = liveApi.onMessage().subscribe(handleApiMessage);
      } catch {
        /* ignore transient socket setup failures */
      }
    };
    void start();
    return () => {
      cancelled = true;
      sub?.unsubscribe();
    };
  }, [apiEpoch, tradingSocketGeneration, handleApiMessage, ensureApiReady]);

  useEffect(() => {
    setPL(trades.reduce((s, t) => s + (t.profit ?? 0), 0));
  }, [trades]);

  const tradeStats = useMemo(() => {
    const completed = trades.filter(t => !t.virtual && (t.status === 'won' || t.status === 'lost'));
    return {
      total: completed.length,
      won: completed.filter(t => t.status === 'won').length,
      lost: completed.filter(t => t.status === 'lost').length,
    };
  }, [trades]);

  const scheduleNext = useCallback(
    (why: 'start' | 'after_win' | 'after_loss' | 'after_error' = 'start') => {
      const myRunId = runIdRef.current;

      const run = () => {
        if (runIdRef.current !== myRunId) return;
        if (haltRef.current) return;
        if (!isRunningRef.current) return;
        if (inFlightRef.current) return;
        if (currentOpenIdRef.current) return;
        if (awaitingVirtualRef.current) return;

        const guard = riskHit(sessionPLRef.current);
        if (guard.hit) {
          stopBotHard(guard.reason!);
          return;
        }

        const cfg = getNextConfigFromRefs();
        if ('error' in cfg) {
          setStatus(cfg.error, 'warning');
          return;
        }

        if (virtualHooksEnabledRef.current) {
          ensureTickStream(cfg.market);

          const canPlaceVirtual = !recoveryRef.current.on && !readyForRealRef.current;

          if (canPlaceVirtual) {
            const quote = tickLastQuoteRef.current;
            const lastDigit = tickLastDigitRef.current;

            if (!isNum(quote) || !isNum(lastDigit)) {
              setStatus('⏳ Waiting live ticks for virtual hook', 'info');
              clearNextTimer();
              nextTimerRef.current = window.setTimeout(() => {
                if (runIdRef.current !== myRunId) return;
                if (!isRunningRef.current || haltRef.current) return;
                run();
              }, 300);
              return;
            }

            const active =
              activeStrategiesRef.current[currentStratIndexRef.current % activeStrategiesRef.current.length];
            const vId = createVirtualTrade(cfg.contractType, cfg.stake, cfg.market, cfg.duration, cfg.barrier);

            if (cfg.duration === 1) {
              const loss = evalVirtualIsLoss(active.key, lastDigit, quote, quote, cfg.barrier);

              setTrades(prev =>
                prev.map(tr =>
                  tr.id === vId
                    ? {
                        ...tr,
                        entryValue: quote,
                        exitValue: quote,
                        currentValue: quote,
                        status: loss ? 'lost' : 'won',
                        profit: 0,
                        closeTime: new Date(),
                      }
                    : tr
                )
              );

              applyVirtualOutcome(loss);

              if (isRunningRef.current && !haltRef.current) {
                scheduleNext(loss ? 'after_loss' : 'after_win');
              }
              return;
            }

            setTrades(prev =>
              prev.map(tr =>
                tr.id === vId
                  ? {
                      ...tr,
                      entryValue: quote,
                      currentValue: quote,
                    }
                  : tr
              )
            );

            awaitingVirtualRef.current = {
              tradeId: vId,
              entryPrice: quote,
              remaining: cfg.duration,
              dur: cfg.duration,
              stake: cfg.stake,
              market: cfg.market,
              contractType: cfg.contractType,
              barrier: cfg.barrier,
              strategyKey: active.key,
            };

            setStatus('👀 Virtual hook running', 'info');
            return;
          }
        }

        inFlightRef.current = true;

        clearNextTimer();
        const walletForChain = activeLoginidRef.current || clientRef.current?.loginid || '';
        const chainDelayMs = isCrVirtualShadowLogin(walletForChain) ? AUTO_CHAIN_GAP_MS_CR_VIRTUAL : 0;
        nextTimerRef.current = window.setTimeout(() => {
          if (runIdRef.current !== myRunId) {
            inFlightRef.current = false;
            return;
          }
          if (haltRef.current || !isRunningRef.current) {
            inFlightRef.current = false;
            return;
          }

          buy(cfg.contractType, cfg.stake, cfg.market, cfg.duration, cfg.barrier)
            .then(realID => {
              /** Virtual CR fills settle inside `buy`; tracking a `v-` id blocks `scheduleNext` (still-open guard). */
              if (!realID || String(realID).startsWith('v-')) currentOpenIdRef.current = null;
              else currentOpenIdRef.current = realID;
            })
            .catch(() => {
              setIsRunning(false);
              isRunningRef.current = false;
              inFlightRef.current = false;
              closeTickWS();
            });
        }, chainDelayMs);
      };

      if (why !== 'start' && delayAfterSettleRef.current) {
        clearNextTimer();
        nextTimerRef.current = window.setTimeout(() => {
          if (runIdRef.current !== myRunId) return;
          if (!isRunningRef.current || haltRef.current) return;
          run();
        }, DELAY_AFTER_SETTLE_MS);
      } else {
        run();
      }
    },
    [
      applyVirtualOutcome,
      buy,
      clearNextTimer,
      closeTickWS,
      createVirtualTrade,
      ensureTickStream,
      evalVirtualIsLoss,
      getNextConfigFromRefs,
      setStatus,
      stopBotHard,
    ]
  );

  const stopBot = useCallback(() => {
    clearNextTimer();
    haltRef.current = false;
    isRunningRef.current = false;
    setIsRunning(false);
    inFlightRef.current = false;
    currentOpenIdRef.current = null;
    awaitingVirtualRef.current = null;
    closeTickWS();
    closeCrVirtTickWs();
    setStatus('Bot stopped', 'info');
  }, [clearNextTimer, closeCrVirtTickWs, closeTickWS, setStatus]);

  useEffect(() => {
    ready_strategy_panel.setStopStrategyHandler(() => {
      stopReadyFromExternal();
    });
    return () => ready_strategy_panel.setStopStrategyHandler(null);
  }, [ready_strategy_panel]);

  useEffect(() => {
    readyExternalController.current = {
      selectPreset: key => setSelectedPresetKey(key),
      start: cfg => {
        pendingExternalStartRef.current = cfg;
        externalBuildOptionsRef.current =
          cfg.presetKey === 'over_market_flip'
            ? {
                contractKind: cfg.autoContract?.kind ?? cfg.contractKind ?? 'over',
                contractBarrier:
                  cfg.autoContract?.barrier ??
                  cfg.contractBarrier ??
                  cfg.overDigit ??
                  (cfg.contractKind === 'under' || cfg.autoContract?.kind === 'under' ? 7 : 2),
              }
            : null;
        externalAutoContractRef.current = cfg.autoContract ?? null;
        externalAutoEvenOddSideRef.current = cfg.autoEvenOddSide ?? null;
        setSelectedPresetKey(cfg.presetKey);
        setMarket(cfg.market);
        setStakeInput(cfg.stake);
        setTicks(cfg.ticks);
        setMartingaleInput(cfg.martingale);
        setTakeProfit(cfg.takeProfit);
        setStopLoss(cfg.stopLoss);
        setDelayAfterSettle(cfg.delayAfterSettle);
      },
      stop: stopBot,
      isRunning: () => isRunningRef.current,
    };
    return () => {
      readyExternalController.current = null;
    };
  }, [stopBot]);

  const resetHistory = useCallback(() => {
    if (isRunningRef.current) return;

    clearNextTimer();
    haltRef.current = false;
    setTrades([]);
    setPL(0);
    setSessionPL(0);
    sessionPLRef.current = 0;
    settledContractsRef.current.clear();
    currentOpenIdRef.current = null;
    stakesByIdRef.current = {};
    inFlightRef.current = false;
    lastBuyTsRef.current = 0;
    clearRateLimitBackoff();
    closeTickWS();
    closeCrVirtTickWs();
    awaitingVirtualRef.current = null;
    virtualHooksEnabledRef.current = false;
    setVirtualStatsUI({
      enabled: false,
      wins: 0,
      losses: 0,
      ready: true,
      recoveryOn: false,
      recoveryWins: 0,
      recoveryLosses: 0,
    });
    setStatus('History cleared', 'info');
  }, [clearNextTimer, clearRateLimitBackoff, closeCrVirtTickWs, closeTickWS, setStatus]);

  useEffect(() => {
    return reaction(
      () => ready_strategy_panel.run_panel_clear_generation,
      gen => {
        if (gen < 1) return;
        stopBot();
        haltRef.current = false;
        resetHistory();
      }
    );
  }, [ready_strategy_panel, stopBot, resetHistory]);

  const startSelectedPreset = useCallback(() => {
    if (!selectedCard) {
      setStatus('Select a ready strategy first', 'warning');
      return;
    }

    const baseStake = isNum(stakeInput) && stakeInput > 0 ? stakeInput : 0.35;
    const preset = selectedCard.build(baseStake, externalBuildOptionsRef.current ?? undefined);
    externalBuildOptionsRef.current = null;

    const autoContract = externalAutoContractRef.current;
    externalAutoContractRef.current = null;
    const autoEvenOddSide = externalAutoEvenOddSideRef.current;
    externalAutoEvenOddSideRef.current = null;

    let activeStrategies: ActiveStrategy[] = preset.activeStrategies;
    if (autoContract) {
      activeStrategies = [{ key: autoContract.kind, stake: baseStake, prediction: autoContract.barrier }];
    } else if (autoEvenOddSide) {
      activeStrategies = [{ key: autoEvenOddSide, stake: baseStake }];
    }

    setActiveStrategies(activeStrategies);
    activeStrategiesRef.current = activeStrategies;

    presetModeRef.current = preset.mode;
    setMainMode(preset.mainMode);
    mainModeRef.current = preset.mainMode;

    setSwitchOnLoss(preset.switchOnLoss);
    switchOnLossRef.current = preset.switchOnLoss;

    setLossesToSwitch(preset.lossesToSwitch);
    lossesToSwitchRef.current = preset.lossesToSwitch;

    currentStratIndexRef.current = 0;
    setCurrentStratIndex(0);

    martingale.current.base = baseStake;
    martingale.current.current = baseStake;
    martingale.current.step = 0;

    lossStreakByStratRef.current = {} as Record<StrategyType, number>;
    preset.activeStrategies.forEach(s => {
      lossStreakByStratRef.current[s.key] = 0;
    });

    if (preset.virtualHooks?.enabled) {
      virtualHooksEnabledRef.current = true;
      virtualModeRef.current = preset.virtualHooks.virtualMode;
      virtualTargetRef.current = preset.virtualHooks.virtualTarget;
      martingaleDelayRef.current = preset.virtualHooks.martingaleDelay;
      returnToVirtualRef.current = preset.virtualHooks.returnToVirtual;
      recoveryRef.current = { on: false, wins: 0, losses: 0 };
      resetVirtualCycle();
    } else {
      virtualHooksEnabledRef.current = false;
      virtualModeRef.current = 'wins';
      virtualTargetRef.current = 0;
      martingaleDelayRef.current = 0;
      returnToVirtualRef.current = 1;
      recoveryRef.current = { on: false, wins: 0, losses: 0 };
      readyForRealRef.current = true;
      updateVirtualUI();
      closeTickWS();
    }

    const chosenMarket = market;
    const usesUpsDownsPreset = presetUsesUpsDownsStrategies(preset);
    let rotateStart = chosenMarket;
    if (usesUpsDownsPreset && rotateStart.startsWith('JD')) {
      rotateStart = ALL_MARKETS.find(s => !s.startsWith('JD')) ?? '1HZ10V';
    }
    marketRef.current = chosenMarket;
    readyMarketSequenceRef.current = buildMarketSequence(rotateStart, usesUpsDownsPreset);
    readyMarketIndexRef.current = 0;
    readyMarketWinCountRef.current = 0;
    readyAwaitFirstAfterSwitchRef.current = false;

    settledContractsRef.current.clear();
    currentOpenIdRef.current = null;
    stakesByIdRef.current = {};
    setSessionPL(0);
    sessionPLRef.current = 0;
    lastBuyTsRef.current = 0;

    haltRef.current = false;
    clearNextTimer();
    clearRateLimitBackoff();
    runIdRef.current += 1;

    isRunningRef.current = true;
    setIsRunning(true);
    setShowPresetModule(false);

    runPanelStore.toggleDrawer(true);
    runPanelStore.setActiveTabIndex(RUN_PANEL_TAB.SUMMARY);

    setStatus(`Bot started: ${selectedCard.title} | Market: ${chosenMarket}`, 'success');
    scheduleNext('start');
  }, [
    buildMarketSequence,
    clearNextTimer,
    clearRateLimitBackoff,
    closeTickWS,
    market,
    runPanelStore,
    resetVirtualCycle,
    scheduleNext,
    selectedCard,
    setStatus,
    stakeInput,
    updateVirtualUI,
  ]);

  useEffect(() => {
    const pending = pendingExternalStartRef.current;
    if (!pending || isRunningRef.current) return;
    if (selectedPresetKey !== pending.presetKey) return;
    pendingExternalStartRef.current = null;
    startSelectedPreset();
  }, [selectedPresetKey, market, stakeInput, ticks, martingaleInput, takeProfit, stopLoss, delayAfterSettle, startSelectedPreset]);

  const handleConfigureRun = useCallback(() => {
    if (isRunning) return;
    setShowPresetModule(true);
  }, [isRunning]);

  return (
    <div className={shellHidden ? 'flip flip--shell-hidden' : 'flip'}>
      <header className="ready-page-header">
        <div className="ready-page-header__title-row">
          <div className="ready-page-header__title">
            <MarketDerivedJump75Icon width={22} height={22} aria-hidden />
            <div>
              <h1 className="ready-page-header__heading">Ready Strategies</h1>
              <p className="ready-page-header__sub">Denara Ready strategies — choose a market, configure and run.</p>
            </div>
          </div>
          <button className="youtube" type="button" onClick={() => setYtOpen(true)}>
            Tutorial
          </button>
        </div>
      </header>

      <LazyYouTubeModal videoUrl={YT_URL} isOpen={ytOpen} onClose={() => setYtOpen(false)} />

      <div className="ready-shell">
        <div className="ready-nav-wrap">
          <h2 className="ready-rail-heading">Choose a strategy</h2>
          <div className="ready-nav-scroll-clip">
            <nav className="ready-strategy-nav" aria-label="Ready strategies">
              {cards.map(card => {
                const selected = selectedPresetKey === card.key;
                return (
                  <button
                    key={card.key}
                    type="button"
                    aria-current={selected ? 'true' : undefined}
                    className={`ready-strategy-nav__item ${selected ? 'ready-strategy-nav__item--selected' : ''}`}
                    disabled={isRunning}
                    onClick={() => handleSelectStrategy(card)}
                  >
                    <span className="ready-strategy-nav__icon">{card.icon}</span>
                    <span className="ready-strategy-nav__text">
                      <span className="ready-strategy-nav__title">{card.title}</span>
                      <span className="ready-strategy-nav__hint">{card.description}</span>
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        <section className="ready-summary" aria-live="polite">
          <div className="ready-summary-card">
            {selectedCard ? (
              <>
                <div className="ready-summary-card__head">
                  <div className="ready-summary-card__icon-wrap">{selectedCard.icon}</div>
                  <div>
                    <h2 className="ready-summary-card__title">{selectedCard.title}</h2>
                    <p className="ready-summary-card__lede">{selectedCard.description}</p>
                  </div>
                </div>

                <p className="ready-summary-card__modal-note">
                  Stake, martingale, and TP/SL are set in the modal when you run.
                </p>

                {virtualStatsUI.enabled ? (
                  <dl className="ready-summary-meta">
                    <div className="ready-summary-meta__row">
                      <dt>Virtual</dt>
                      <dd>
                        {virtualModeRef.current}{' '}
                        {virtualModeRef.current === 'wins' ? virtualStatsUI.wins : virtualStatsUI.losses}/
                        {virtualTargetRef.current}
                      </dd>
                    </div>
                    <div className="ready-summary-meta__row">
                      <dt>Ready</dt>
                      <dd>{virtualStatsUI.ready ? 'Yes' : 'No'}</dd>
                    </div>
                    <div className="ready-summary-meta__row">
                      <dt>Recovery</dt>
                      <dd>
                        {virtualStatsUI.recoveryOn
                          ? `${virtualStatsUI.recoveryWins}W / ${virtualStatsUI.recoveryLosses}L`
                          : 'Off'}
                      </dd>
                    </div>
                  </dl>
                ) : null}

                <div className="ready-summary-card__actions">
                  <div className="ready-summary-card__market-field">
                    <select
                      id="ready-summary-market"
                      className="trade-input ready-summary-card__market-select"
                      value={market}
                      disabled={isRunning || marketScanning}
                      onChange={e => setMarket(e.target.value)}
                      aria-label="Market"
                    >
                      {selectableMarketOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {marketSuggestion ? (
                      <div
                        className="ready-summary-card__market-suggestion"
                        aria-busy={marketScanning}
                      >
                        <span className="ready-summary-card__market-suggestion-label">Suggestion</span>
                        {marketScanning ? (
                          <div className="ready-summary-card__market-scan-row">
                            <div className="ready-summary-card__market-scan-loader-wrap">
                              <div className="ready-summary-card__market-scan-loader" />
                            </div>
                            <span className="ready-summary-card__market-scan-caption">Scanning markets…</span>
                          </div>
                        ) : (
                          <span className="ready-summary-card__market-suggestion-value">{marketSuggestion.label}</span>
                        )}
                        <button
                          type="button"
                          className="ready-summary-card__market-suggestion-apply"
                          disabled={isRunning || marketScanning}
                          onClick={() => setMarket(marketSuggestion.value)}
                        >
                          Apply
                        </button>
                        <button
                          type="button"
                          className="ready-summary-card__market-suggestion-scan"
                          disabled={isRunning || marketScanning}
                          onClick={() => runMarketScan()}
                          title="Scan with loader — updates suggestion when complete; use Apply to set market"
                        >
                          Scan
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="ready-summary-card__ticks-field">
                    <label className="ready-summary-card__ticks-label" htmlFor="ready-summary-ticks">
                      Duration (ticks)
                    </label>
                    <input
                      id="ready-summary-ticks"
                      type="number"
                      className="trade-input ready-summary-card__ticks-input"
                      min={1}
                      step={1}
                      disabled={isRunning}
                      value={ticks === '' ? '' : String(ticks)}
                      onChange={e =>
                        setTicks(e.target.value === '' ? '' : Math.max(1, Math.floor(Number(e.target.value))))
                      }
                      onBlur={e => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n) || n < 1) setTicks(1);
                      }}
                      aria-label="Duration in ticks"
                    />
                  </div>

                  <button
                    type="button"
                    className="preset-run-btn ready-summary-card__primary"
                    disabled={isRunning}
                    onClick={handleConfigureRun}
                  >
                    <LegacyPlayFillIcon width={18} height={18} />
                    Configure &amp; run
                  </button>
                  <button
                    type="button"
                    className={`mini-btn ready-summary-card__delay ${delayAfterSettle ? 'active' : ''}`}
                    disabled={isRunning}
                    onClick={() => setDelayAfterSettle(v => !v)}
                    title="Pause briefly after each contract settles before the next buy"
                  >
                    Post-settle delay {delayAfterSettle ? 'on' : 'off'}
                  </button>
                </div>
              </>
            ) : (
              <p className="ready-summary-empty">Select a strategy from the list.</p>
            )}
          </div>
        </section>
      </div>

      {showPresetModule && selectedCard && (
        <div className="preset-module-overlay">
          <div className="preset-module">
            <div className="preset-module__header">
              <div>
                <h3>{selectedCard.title}</h3>
                <p>{selectedCard.description}</p>
              </div>
            </div>

            <div className="preset-module__body">
              <div className="trade-control-group">
                <label>Stake</label>
                <input
                  type="number"
                  className="trade-input"
                  value={stakeInput === '' ? '' : String(stakeInput)}
                  onChange={e => setStakeInput(e.target.value === '' ? '' : Number(e.target.value))}
                  min={0.01}
                  step={0.01}
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
                />
              </div>

              <div className="trade-control-group">
                <label>Take Profit ($)</label>
                <input
                  type="number"
                  className="trade-input"
                  min={0}
                  step={0.01}
                  value={takeProfit === '' ? '' : String(takeProfit)}
                  onChange={e => setTakeProfit(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
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
                />
              </div>
            </div>

            <div className="preset-module__actions">
              <button
                type="button"
                className="preset-back-btn"
                onClick={() => {
                  if (isRunning) return;
                  setShowPresetModule(false);
                }}
              >
                Back
              </button>

              <button type="button" className="preset-run-btn" onClick={startSelectedPreset}>
                <LegacyPlayFillIcon width={18} height={18} />
                Run
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`trade-status trade-status--${msg.type}`}>
        {msg.txt ? <div className="trade-status__message">{msg.txt}</div> : null}
        <div className="trade-status__meta">
          <span>
            Session P/L <b>{sessionPL >= 0 ? '+' : ''}{sessionPL.toFixed(2)}</b>
          </span>
        </div>
      </div>

      <div className="performance-stats performance-stats--compact">
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