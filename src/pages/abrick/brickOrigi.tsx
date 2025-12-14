// Iframe.tsx — Over/Under Analysis + Trading Logic (continuous; halts when no signal)
// Updates in this version:
// - Default mode: Over/Under; default active digit = 2
// - Defaults: stake=1, martingale=1.75, duration=1, TP=5, SL=50
// - When signal disappears (normal or smart), trading HALTS (no new buys) but bot stays ON,
//   and martingale progress is preserved; resumes automatically when signal returns
// - "Switch after loss" remains ONLY for Smart modes (Low/Medium/High/Jumble)
// - All inputs (including thresholds) allow full clearing without snapping.
//   Cleared thresholds are treated as 0 for comparisons.

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { api_base } from '@/external/bot-skeleton';
import './BrickTower.scss';

type AnalysisMode = 'matches' | 'overUnder';

type TAnalysisItem = {
  digit: number;
  price: number;
  timestamp: Date;
};

const FIXED3 = ['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'];
const FIXED4 = ['R_50', 'R_75'];

const DEFAULT_OVER = [90, 85, 70, 70, 60, 55, 40, 30, 20, 10];
const DEFAULT_UNDER = [10, 20, 30, 30, 40, 45, 60, 70, 80, 90];

const digitColors = [
  '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
  '#FF9F40', '#8AC249', '#EA5F89', '#00BFFF', '#A0522D'
];

/** ===== Trading types ===== */
type ContractType = 'DIGITOVER' | 'DIGITUNDER';
type StrategyBasic = 'over' | 'under';
type RiskMode = 'off' | 'low' | 'medium' | 'high' | 'jumble';

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

const Iframe = observer(() => {
  const { ui } = useStore();

  // ───────────────────────── Trading panel states ─────────────────────────
  const [stakeInput, setStakeInput] = useState<number | ''>(1);
  const [martingaleInput, setMartingaleInput] = useState<number | ''>(1.75);
  const [ticksInput, setTicksInput] = useState<number | ''>(1); // duration (ticks)
  const [takeProfit, setTakeProfit] = useState<number | ''>(5);
  const [stopLoss, setStopLoss] = useState<number | ''>(50);
  const [entryPoint, setEntryPoint] = useState<number | null>(null);
  const [roundsInput, setRoundsInput] = useState<number | ''>(''); // optional; blank=infinite
  const [isRunning, setIsRunning] = useState(false);
  const [basicStrategy, setBasicStrategy] = useState<StrategyBasic>('over'); // Over/Under for normal mode
  const [riskMode, setRiskMode] = useState<RiskMode>('off'); // smart trading modes (controls switching)

  // Positions + P/L UI
  const [trades, setTrades] = useState<TTrade[]>([]);
  const [sessionPL, setSessionPL] = useState(0);

  // ───────────────────────── Existing analysis state (unchanged visuals) ─────────────────────────
  const [activeMode, setActiveMode] = useState<AnalysisMode>('overUnder'); // default to Over/Under
  const [activeDigits, setActiveDigits] = useState<number[]>([2]); // for matches mode
  const [activeOverUnderDigit, setActiveOverUnderDigit] = useState<number>(2); // default to 2

  const [filterCount, setFilterCount] = useState<number | ''>(100);
  const [currentSymbol, setCurrentSymbol] = useState<string>('1HZ10V');

  const [signalsMode, setSignalsMode] = useState<'over' | 'under'>('over');

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
  const wsRef = useRef<WebSocket | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();
  const latestDigitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showThresholdPanel) thresholdsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [showThresholdPanel]);

  const formatTickToLastDigit = (val: number, market: string) => {
    let s: string;
    if (FIXED3.includes(market)) s = val.toFixed(3);
    else if (FIXED4.includes(market)) s = val.toFixed(4);
    else s = val.toFixed(2);
    return parseInt(s.slice(-1));
  };

  const calculateDigitStats = () => {
    const cap = (typeof filterCount === 'number' && filterCount >= 1) ? Math.min(1000, filterCount) : 1000;
    const filtered = analysisData.lastResults.slice(0, cap);
    const total = filtered.length;
    const digitCounts = Array(10).fill(0);
    filtered.forEach(r => { digitCounts[r.digit]++; });

    const maxCount = Math.max(...digitCounts);
    const minCount = Math.min(...digitCounts);

    return {
      digitCounts,
      total,
      digitsData: digitCounts.map((count: number, digit: number) => {
        const percentage = total > 0 ? (count / total) * 100 : 0;
        return {
          digit,
          count,
          percentage,
          isMax: count === maxCount && maxCount > 0,
          isMin: count === minCount && minCount > 0 && minCount !== maxCount,
        };
      }),
    };
  };

  const { digitCounts, total, digitsData } = calculateDigitStats();

  const calcRing = () => {
    const circumference = 2 * Math.PI * 27;
    const dashValue = circumference / 2;
    const dashArray = `${dashValue} ${circumference}`;
    const dashOffset = circumference / 4;
    return { dashArray, dashOffset };
  };

  const toggleMode = (mode: AnalysisMode) => {
    setActiveMode(mode);
    if (mode === 'matches') setActiveDigits(prev => (prev.length ? prev : [2]));
    else setActiveOverUnderDigit(d => (typeof d === 'number' ? d : 2));
  };

  const handleDigitClick = (digit: number) => {
    if (activeMode === 'matches') {
      setActiveDigits(prev => prev.includes(digit) ? prev.filter(d => d !== digit) : [...prev, digit]);
    } else {
      setActiveOverUnderDigit(digit);
    }
  };

  const pushTick = (price: number, market: string) => {
    const lastDigit = formatTickToLastDigit(price, market);
    setAnalysisData(prev => {
      const digitCounts = [...prev.digitCounts];
      digitCounts[lastDigit]++;
      const newLastResults: TAnalysisItem[] = [
        { digit: lastDigit, price, timestamp: new Date() },
        ...prev.lastResults,
      ].slice(0, 1000);
      return { ...prev, lastResults: newLastResults, lastDigit, lastPrice: price, digitCounts, currentMarket: market };
    });

    // Evaluate trading opportunity on each tick (halts automatically if no signal)
    evaluateAndMaybeBuy();
  };

  const handleTick = (val: number) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const market = marketSelectionRef.current?.value || currentSymbol;
    debounceTimer.current = setTimeout(() => { pushTick(val, market); }, 50);
  };

  const refreshData = () => {
    if (!wsRef.current || !marketSelectionRef.current) return;
    const newMarket = marketSelectionRef.current.value;

    setCurrentSymbol(newMarket);
    setAnalysisData({
      lastResults: [],
      lastDigit: null,
      lastPrice: null,
      digitCounts: Array(10).fill(0),
      currentMarket: newMarket,
    });

    wsRef.current.send(JSON.stringify({
      ticks_history: newMarket, style: 'ticks', count: 5000, end: 'latest', subscribe: 1,
    }));
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

  const selectedDigit =
    activeMode === 'overUnder'
      ? (typeof activeOverUnderDigit === 'number' ? activeOverUnderDigit : (analysisData.lastDigit ?? 2))
      : (analysisData.lastDigit ?? 2);

  const selCount = total > 0 ? digitCounts[selectedDigit] : 0;
  const selPct = total > 0 ? (selCount / total) * 100 : 0;
  const selOverReq = thrNum(overThresholds[selectedDigit]);
  const selUnderReq = thrNum(underThresholds[selectedDigit]);
  const selOverSignal = overSignalPct[selectedDigit];
  const selUnderSignal = underSignalPct[selectedDigit];

  const hitOver = selOverSignal >= selOverReq;
  const hitUnder = selUnderSignal >= selUnderReq;
  const hitClass = (hitOver || hitUnder) ? (hitOver ? 'selected-digit--hit-over' : 'selected-digit--hit-under') : '';

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

  // WebSocket
  useEffect(() => {
    if (marketSelectionRef.current) marketSelectionRef.current.value = currentSymbol;

    const app_id = 1089;
    const url = `wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        ticks_history: currentSymbol, style: 'ticks', count: 5000, end: 'latest', subscribe: 1,
      }));
      setAnalysisData({
        lastResults: [], lastDigit: null, lastPrice: null,
        digitCounts: Array(10).fill(0), currentMarket: currentSymbol,
      });
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data?.error) { console.error('WebSocket error:', data.error.message); return; }
      if (data?.msg_type === 'history' && Array.isArray(data.history?.prices)) {
        const prices: number[] = data.history.prices.map(Number);
        if (!prices.length) return;
        const market = marketSelectionRef.current?.value || currentSymbol;
        prices.forEach((p) => pushTick(p, market));
      }
      if (data?.tick?.quote) handleTick(Number(data.tick.quote));
    };

    ws.onerror = (err) => console.error('WebSocket error:', err);
    ws.onclose = () => {};

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      ws.close();
      wsRef.current = null;
    };
  }, [currentSymbol]);

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

  // Current target and rotation among candidates (Smart modes only)
  type Target = { ct: ContractType; digit: number };
  const currentTargetRef = useRef<Target | null>(null);
  const targetRotationRef = useRef<Target[]>([]);
  const rotationIndexRef = useRef(0);

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
      try { conn.removeEventListener('open', bump); } catch {}
      try { conn.removeEventListener('close', bump); } catch {}
    };
  }, [apiEpoch]);

  const ensureApiReady = useCallback(async () => {
    const OPEN = 1 as const;
    if (!api_base.api || api_base.api.connection.readyState !== OPEN) {
      await api_base.init(true); // recreate + authorize + subscribe
    }
  }, []);

  // ====== Risk mode → allowed digit sets ======
  const allowedDigitsForMode = useCallback((mode: RiskMode): { over: number[]; under: number[] } => {
    switch (mode) {
      case 'low':    return { over: [0,1,2],       under: [9,8,7] };
      case 'medium': return { over: [3,4,5],       under: [6,5,4] };
      case 'high':   return { over: [6,7],         under: [3,2]   };
      case 'jumble': return { over: [0,1,2,3,4,5,6,7,8,9], under: [0,1,2,3,4,5,6,7,8,9] };
      default:       return { over: [], under: [] };
    }
  }, []);

  // ====== Helpers: current signal check & candidates ======
  const hasSignal = useCallback((ct: ContractType, digit: number) => {
    if (ct === 'DIGITOVER') return overSignalPct[digit] >= thrNum(overThresholds[digit]);
    return underSignalPct[digit] >= thrNum(underThresholds[digit]);
  }, [overSignalPct, underSignalPct, overThresholds, underThresholds]);

  const entryPointPasses = useCallback(() => {
    if (entryPoint === null || entryPoint === undefined) return true;
    const latest = analysisData.lastDigit;
    return latest === entryPoint;
  }, [entryPoint, analysisData.lastDigit]);

  // Build candidate targets based on mode/strategy/state
  const computeCandidates = useCallback((): Target[] => {
    if (!isRunningRef.current) return [];
    if (!entryPointPasses()) return [];

    if (riskMode === 'off') {
      // Normal mode = one target using selected digit + panel strategy
      const digit = activeOverUnderDigit;
      const ct: ContractType = basicStrategy === 'over' ? 'DIGITOVER' : 'DIGITUNDER';
      if (hasSignal(ct, digit)) return [{ ct, digit }];
      return [];
    }

    // Smart modes
    const sets = allowedDigitsForMode(riskMode);
    const list: Target[] = [];

    for (const d of sets.over) if (hasSignal('DIGITOVER', d)) list.push({ ct: 'DIGITOVER', digit: d });
    for (const d of sets.under) if (hasSignal('DIGITUNDER', d)) list.push({ ct: 'DIGITUNDER', digit: d });

    // sort by strongest signal first
    list.sort((a, b) => {
      const sa = a.ct === 'DIGITOVER' ? overSignalPct[a.digit] : underSignalPct[a.digit];
      const sb = b.ct === 'DIGITOVER' ? overSignalPct[b.digit] : underSignalPct[b.digit];
      return sb - sa;
    });

    return list;
  }, [
    riskMode, basicStrategy, activeOverUnderDigit, allowedDigitsForMode,
    hasSignal, overSignalPct, underSignalPct, entryPointPasses
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

  const buy = constBuyWrap();
  function constBuyWrap() {
    return async (ct: ContractType, stake: number, mkt: string, dur: number, barrier: number) => {
      if (haltRef.current || !isRunningRef.current) return null;

      await ensureApiReady();

      const tmpID = createTempTrade(ct, stake, mkt, dur, barrier);
      try {
        const resp = await api_base.api.send({
          buy: 1,
          price: stake,
          parameters: {
            amount: stake,
            basis: 'stake',
            currency: 'USD',
            contract_type: ct,
            duration: dur,
            duration_unit: 't',
            symbol: mkt,
            barrier: String(barrier),
          }
        });
        if (resp?.error) throw resp;

        const realID = String(resp.buy.contract_id);
        stakesByIdRef.current[realID] = stake;

        setTrades(ts => ts.map(t => t.id === tmpID ? ({ ...t, id: realID, temp: false, status: 'open' }) : t));
        currentOpenIdRef.current = realID;
        return realID;
      } catch (e: any) {
        const { isBalanceError, message } = getBalanceError(e);
        setTrades(ts => ts.map(t => t.id === tmpID ? ({
          ...t, status: 'error', temp: false,
          errorReason: isBalanceError ? 'Insufficient balance' : 'Trade failed',
          errorDetails: message, closeTime: new Date()
        }) : t));
        inFlightRef.current = false;
        currentOpenIdRef.current = null;
        return null;
      }
    };
  }

  // ====== Risk checks: TP / SL ======
  const riskHit = useCallback((plAfter: number) => {
    const tp = takeProfit;
    const sl = stopLoss;
    if (isNum(tp) && tp > 0 && plAfter >= tp) return { hit: true as const, reason: 'take_profit' as const };
    if (isNum(sl) && sl > 0 && -plAfter >= sl) return { hit: true as const, reason: 'stop_loss' as const };
    return { hit: false as const, reason: null };
  }, [takeProfit, stopLoss]);

  const stopBotHard = useCallback((reason: 'take_profit' | 'stop_loss') => {
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
    if (inFlightRef.current || currentOpenIdRef.current) return;

    // rounds guard (only when enabled via input)
    if (roundsEnabledRef.current && roundsRemainingRef.current <= 0) {
      isRunningRef.current = false;
      setIsRunning(false);
      return;
    }

    // risk guard
    const guard = riskHit(sessionPLRef.current);
    if (guard.hit) { stopBotHard(guard.reason!); return; }

    // build candidate targets (returns [] when no signal or entry point unmet → HALT)
    let candidates = computeCandidates();
    if (candidates.length === 0) return; // HALT (no new trade) until signals reappear

    // respect current target if still valid
    const cur = currentTargetRef.current;
    if (cur && candidates.some(t => t.ct === cur.ct && t.digit === cur.digit)) {
      candidates = [cur, ...candidates.filter(t => !(t.ct === cur.ct && t.digit === cur.digit))];
    }

    // Smart modes: initialize rotation list (switch-after-loss=1)
    if (riskMode !== 'off') {
      targetRotationRef.current = candidates;
      if (!cur) rotationIndexRef.current = 0;
      else {
        const idx = targetRotationRef.current.findIndex(t => t.ct === cur.ct && t.digit === cur.digit);
        rotationIndexRef.current = idx >= 0 ? idx : 0;
      }
    }

    // Pick target
    const target = candidates[0];
    currentTargetRef.current = target;

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
    riskMode, riskHit, stopBotHard, ticksInput, stakeInput
  ]);

  // ====== Settlement handling (wins/losses/switch) ======
  const applySessionPLAndMaybeStop = useCallback((net: number) => {
    setSessionPL(prev => {
      const next = prev + net;
      const guard = riskHit(next);
      if (guard.hit) stopBotHard(guard.reason!);
      return next;
    });
  }, [riskHit, stopBotHard]);

  const handleSettle = useCallback((cid: string, net: number) => {
    const won = net >= 0;

    // Session P/L + TP/SL checks
    applySessionPLAndMaybeStop(net);
    if (!isRunningRef.current || haltRef.current) {
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

    // Smart mode: switch on loss = 1
    if (!won && riskMode !== 'off') {
      const rot = targetRotationRef.current;
      if (rot.length > 1) {
        rotationIndexRef.current = (rotationIndexRef.current + 1) % rot.length;
        currentTargetRef.current = rot[rotationIndexRef.current];
      }
      // if only one target, maintain it
    }
    // Normal mode: NO auto-switch

    currentOpenIdRef.current = null;
    inFlightRef.current = false;

    // Immediately try next trade — if signal is gone, it will HALT (no buy) until signal returns
    evaluateAndMaybeBuy();
  }, [applySessionPLAndMaybeStop, riskMode, evaluateAndMaybeBuy]);

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
  }, [apiEpoch, handleApiMessage]);

  // ====== Run / Stop ======
  const handleRunToggle = useCallback(() => {
    if (isRunningRef.current) {
      // Stop manually
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

    // Init martingale base/current
    const base = (isNum(stakeInput) && stakeInput > 0) ? stakeInput : 1;
    martingale.current.base = base;
    martingale.current.current = base;
    martingale.current.step = 0;

    // Reset locks & maps
    haltRef.current = false;
    inFlightRef.current = false;
    currentOpenIdRef.current = null;
    settledContractsRef.current.clear();
    stakesByIdRef.current = {};

    // Clear current target; it will be chosen on next tick or immediately below
    currentTargetRef.current = null;
    targetRotationRef.current = [];
    rotationIndexRef.current = 0;

    isRunningRef.current = true;
    setIsRunning(true);

    // Try immediate evaluation (if signal already meets conditions)
    evaluateAndMaybeBuy();
  }, [evaluateAndMaybeBuy, roundsInput, stakeInput]);

  // ───────────────────────── Render ─────────────────────────
  const { dashArray, dashOffset } = calcRing();

  return (
    <div
      className="brick-tower-container"
      style={{ background: ui.is_dark_mode_on ? 'var(--general-main-1)' : 'transparent' }}
    >
      {/* Analysis Mode Selector */}
      <div className="analysis-mode-selector">
        <ul className="mode-list">
          <li>
            <button
              className={`mode-btn ${activeMode === 'overUnder' ? 'active' : ''}`}
              onClick={() => toggleMode('overUnder')}
            >
              Over/Under Analysis
            </button>
          </li>
          <li>
            <button
              className={`mode-btn ${activeMode === 'matches' ? 'active' : ''}`}
              onClick={() => toggleMode('matches')}
            >
              Digit Spotter
            </button>
          </li>
        </ul>
      </div>

      {/* Market Selection */}
      <div className="market-selector">
        <i className="fas fa-chart-line market-icon"></i>
        <select
          className="marketSelection"
          id="marketSelection"
          ref={marketSelectionRef}
          onChange={(e) => {
            const newMarket = e.target.value;
            setCurrentSymbol(newMarket);
            setAnalysisData({
              lastResults: [],
              lastDigit: null,
              lastPrice: null,
              digitCounts: Array(10).fill(0),
              currentMarket: newMarket,
            });
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                ticks_history: newMarket, style: 'ticks', count: 5000, end: 'latest', subscribe: 1,
              }));
            }
          }}
          value={currentSymbol}
        >
          <option className="Volatility10" value="R_10">Volatility 10 index</option>
          <option className="Volatility10s" value="1HZ10V">Volatility 10(1s) index</option>
          <option className="Volatility10s" value="1HZ15V">Volatility 15(1s) index</option>
          <option className="Volatility25" value="R_25">Volatility 25 index</option>
          <option className="Volatility25s" value="1HZ25V">Volatility 25(1s) index</option>
          <option className="Volatility25s" value="1HZ30V">Volatility 30(1s) index</option>
          <option className="Volatility50" value="R_50">Volatility 50 index</option>
          <option className="Volatility50s" value="1HZ50V">Volatility 50(1s) index</option>
          <option className="Volatility75" value="R_75">Volatility 75 index</option>
          <option className="Volatility75s" value="1HZ75V">Volatility 75(1s) index</option>
          <option className="Volatility75s" value="1HZ90V">Volatility 90(1s) index</option>
          <option className="Volatility100" value="R_100">Volatility 100 index</option>
          <option className="Volatility100s" value="1HZ100V">Volatility 100(1s) index</option>
        </select>
      </div>

      {/* Quick row */}
      <div className="analysis-quick-row">
        <div className="digits-filter">
          <label>Analyze last:</label>
          <input
            type="number"
            className="trade-input"
            value={filterCount === '' ? '' : String(filterCount)}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') setFilterCount('');
              else {
                const n = Number(v);
                if (Number.isFinite(n)) setFilterCount(Math.max(1, Math.min(1000, Math.floor(n))));
              }
            }}
            min={1}
            max={1000}
            step={1}
          />
          <span>ticks</span>
        </div>

        <div className="current-tick">
          <div><strong>Current Tick:</strong> {analysisData.lastPrice !== null ? analysisData.lastPrice : '—'}</div>
          <div><strong>Last Digit:</strong> {analysisData.lastDigit !== null ? analysisData.lastDigit : '—'}</div>
        </div>

        <button
          className="thresholds-toggle"
          onClick={() => setShowThresholdPanel(v => !v)}
          aria-expanded={showThresholdPanel}
        >
          Change % thresholds
        </button>

        {/* Selected Digit card — always visible in Over/Under */}
        {activeMode === 'overUnder' && (
          <div className={['selected-digit', hitClass].join(' ').trim()}>
            <label>Selected Digit: <strong>D{selectedDigit}</strong></label>
            <div className="selected-digit-summary">
              <span><strong>Count:</strong> {selCount}/{total}</span>
              <span><strong>Pct:</strong> {selPct.toFixed(1)}%</span>
              <span className="sel-over"><strong>Signal Over%:</strong> {selOverSignal.toFixed(1)}%</span>
              <span className="sel-under"><strong>Signal Under%:</strong> {selUnderSignal.toFixed(1)}%</span>
            </div>

            <div className="threshold-editors">
              <div className="threshold-field">
                <label>Over ≥ (%)</label>
                <input
                  type="number"
                  className="trade-input"
                  min={0}
                  max={100}
                  step={1}
                  value={overThresholds[selectedDigit] === '' ? '' : String(overThresholds[selectedDigit])}
                  onChange={(e) => updateOverFor(selectedDigit, e.target.value)}
                />
              </div>
              <div className="threshold-field">
                <label>Under ≥ (%)</label>
                <input
                  type="number"
                  className="trade-input"
                  min={0}
                  max={100}
                  step={1}
                  value={underThresholds[selectedDigit] === '' ? '' : String(underThresholds[selectedDigit])}
                  onChange={(e) => updateUnderFor(selectedDigit, e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Signals mode (visual screen only) */}
      <div className="signals-mode">
        <label>Screening:</label>
        <div className="signals-toggle">
          <label>
            <input
              type="radio"
              name="signalsMode"
              value="over"
              checked={signalsMode === 'over'}
              onChange={() => setSignalsMode('over')}
            />
            Over thresholds
          </label>
          <label>
            <input
              type="radio"
              name="signalsMode"
              value="under"
              checked={signalsMode === 'under'}
              onChange={() => setSignalsMode('under')}
            />
            Under thresholds
          </label>
        </div>
      </div>

      {/* Thresholds panel as overlay */}
      {showThresholdPanel && (
        <>
          <div className="thresholds-backdrop" onClick={() => setShowThresholdPanel(false)} aria-hidden />
          <div className="thresholds-panel thresholds-panel--overlay" ref={thresholdsRef} role="dialog" aria-modal="true">
            <div className="thresholds-panel__head">
              <div className="title">Thresholds (per digit)</div>
              <div className="hint">Tap any cell to edit. Values are 0–100. Empty = 0.</div>
              <button className="thresholds-close" onClick={() => setShowThresholdPanel(false)} aria-label="Close thresholds">✕</button>
            </div>

            <div className="thresholds-grid">
              <div className="row row-digits">
                <div className="cell cell--label">Digit</div>
                {[0,1,2,3,4,5,6,7,8,9].map(d => <div key={`d-${d}`} className="cell cell--digit">{d}</div>)}
              </div>

              <div className="row row-over">
                <div className="cell cell--label">Over ≥ %</div>
                {[0,1,2,3,4,5,6,7,8,9].map(d => (
                  <div key={`over-${d}`} className="cell">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      className="cell-input cell-input--over"
                      value={overThresholds[d] === '' ? '' : String(overThresholds[d])}
                      onChange={(e) => updateOverFor(d, e.target.value)}
                    />
                  </div>
                ))}
              </div>

              <div className="row row-under">
                <div className="cell cell--label">Under ≥ %</div>
                {[0,1,2,3,4,5,6,7,8,9].map(d => (
                  <div key={`under-${d}`} className="cell">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      className="cell-input cell-input--under"
                      value={underThresholds[d] === '' ? '' : String(underThresholds[d])}
                      onChange={(e) => updateUnderFor(d, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Analysis Selectors */}
      <div className="analysis-selectors">
        {activeMode === 'matches' && (
          <div className="selector-container">
            <div className="selector-header">
              <div className="selector-title">Spotter Analysis</div>
            </div>
            <div className="digit-selector">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit => (
                <button
                  key={`match-${digit}`}
                  className={`digit-btn ${activeDigits.includes(digit) ? 'active' : ''}`}
                  style={activeDigits.includes(digit) ? { backgroundColor: digitColors[digit] } : {}}
                  onClick={() => handleDigitClick(digit)}
                >
                  {digit}
                </button>
              ))}
            </div>
          </div>
        )}

        {activeMode === 'overUnder' && (
          <div className="selector-container">
            <div className="selector-header">
              <div className="selector-title">Over/Under Analysis</div>
            </div>
            <div className="digit-selector">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit => (
                <button
                  key={`overunder-${digit}`}
                  className={`digit-btn ${activeOverUnderDigit === digit ? 'active' : ''}`}
                  onClick={() => handleDigitClick(digit)}
                >
                  {digit}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Digits Progress Visualization */}
      <div className="digits-container">
        <div className="digits digits--trade">
          {digitsData.map((digitData) => {
            const isLatest = analysisData.lastDigit === digitData.digit;
            const ouClass =
              activeMode === 'overUnder'
                ? (digitData.digit > selectedDigit ? 'is-over' : digitData.digit < selectedDigit ? 'is-under' : 'is-equal')
                : '';
            return (
              <div
                key={digitData.digit}
                className={`digits__digit ${isLatest ? 'digits__digit--latest' : ''} ${ouClass}`}
                data-digit={digitData.digit}
                ref={isLatest ? latestDigitRef : null}
              >
                <div className="digits__pie-container">
                  <svg className="digits__pie-progress" width="60" height="60" viewBox="0 0 60 60">
                    <circle className="progress__bg" cx="30" cy="30" r="27"></circle>
                    <circle
                      className={`progress__value ${digitData.isMax ? 'progress__value--is-max' : digitData.isMin ? 'progress__value--is-min' : ''}`}
                      cx="30"
                      cy="30"
                      r="27"
                      strokeDasharray={dashArray}
                      strokeDashoffset={dashOffset}
                    />
                  </svg>
                </div>
                <span className={`digits__digit-value ${isLatest ? 'digits__digit-value--latest' : ''}`}>
                  <i className="digits__digit-display-value">{digitData.digit}</i>
                  <i className="digits__digit-display-percentage">
                    {digitData.percentage.toFixed(1)}%
                  </i>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Smart Trading Modes (risk presets) */}
      <div className="risk-modes" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 12px' }}>
        <button
          type="button"
          className={`strat-btn ${riskMode === 'low' ? 'active' : ''}`}
          onClick={() => setRiskMode(riskMode === 'low' ? 'off' : 'low')}
          title="Low risk preset: Over 0,1,2 · Under 9,8,7"
        >
          Low
        </button>
        <button
          type="button"
          className={`strat-btn ${riskMode === 'medium' ? 'active' : ''}`}
          onClick={() => setRiskMode(riskMode === 'medium' ? 'off' : 'medium')}
          title="Medium: Over 3,4,5 · Under 6,5,4"
        >
          Medium
        </button>
        <button
          type="button"
          className={`strat-btn ${riskMode === 'high' ? 'active' : ''}`}
          onClick={() => setRiskMode(riskMode === 'high' ? 'off' : 'high')}
          title="High: Over 6,7 · Under 3,2"
        >
          High
        </button>
        <button
          type="button"
          className={`strat-btn ${riskMode === 'jumble' ? 'active' : ''}`}
          onClick={() => setRiskMode(riskMode === 'jumble' ? 'off' : 'jumble')}
          title="Jumble: any digit, Over/Under"
        >
          Jumble
        </button>
      </div>

      {/* ============================ Trading Panel ============================ */}
      <div className="trading-container">
        {/* Strategy (only Over / Under for normal mode) */}
        <div className="trade-controls">
          <div className="trade-control-group" style={{ display: 'flex', gap: 8 }}>
            <label>Strategy</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`strat-btn ${basicStrategy === 'over' ? 'active' : ''}`}
                onClick={() => setBasicStrategy('over')}
                disabled={riskMode !== 'off'}
                title="Over strategy (normal mode)"
              >
                Over
              </button>
              <button
                type="button"
                className={`strat-btn ${basicStrategy === 'under' ? 'active' : ''}`}
                onClick={() => setBasicStrategy('under')}
                disabled={riskMode !== 'off'}
                title="Under strategy (normal mode)"
              >
                Under
              </button>
            </div>
          </div>

          <div className="trade-control-group">
            <label>Stake</label>
            <input
              type="number"
              className="trade-input"
              min={0}
              step={0.01}
              value={stakeInput === '' ? '' : String(stakeInput)}
              onChange={(e) => setStakeInput(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>

          <div className="trade-control-group">
            <label>Martingale ×</label>
            <input
              type="number"
              className="trade-input"
              min={1}
              step={0.01}
              value={martingaleInput === '' ? '' : String(martingaleInput)}
              onChange={(e) => setMartingaleInput(e.target.value === '' ? '' : Number(e.target.value))}
              title=">1 enables martingale"
            />
          </div>

          <div className="trade-control-group">
            <label>Duration (ticks)</label>
            <input
              type="number"
              className="trade-input"
              min={1}
              step={1}
              value={ticksInput === '' ? '' : String(ticksInput)}
              onChange={(e) => setTicksInput(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>

          {/* Switch-after-loss is ONLY for Smart modes → display-only here */}
          <div className="trade-control-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className={`strat-btn ${riskMode !== 'off' ? 'active' : ''}`}
              disabled
              title="Switch on loss is controlled by Smart Modes and is always 1 when a mode is ON"
            >
              {riskMode !== 'off' ? 'Switch on Loss: ON (1)' : 'Switch on Loss: OFF'}
            </button>
          </div>

          <div className="trade-control-group">
            <label>Take Profit ($)</label>
            <input
              type="number"
              className="trade-input"
              min={0}
              step={0.01}
              value={takeProfit === '' ? '' : String(takeProfit)}
              onChange={(e) => setTakeProfit(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
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
              onChange={(e) => setStopLoss(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
            />
          </div>

          <div className="trade-control-group">
            <label>Entry Point</label>
            <input
              type="number"
              className="trade-input"
              placeholder="null"
              value={entryPoint === null ? '' : String(entryPoint)}
              onChange={(e) => {
                if (e.target.value === '') setEntryPoint(null);
                else {
                  const v = Math.floor(Number(e.target.value));
                  if (Number.isFinite(v)) setEntryPoint(Math.max(0, Math.min(9, v)));
                }
              }}
              title="Optional; requires latest tick digit === this value"
            />
          </div>

          <div className="trade-control-group">
            <label>Number of Rounds</label>
            <input
              type="number"
              className="trade-input"
              min={1}
              step={1}
              value={roundsInput === '' ? '' : String(roundsInput)}
              onChange={(e) => setRoundsInput(e.target.value === '' ? '' : Math.max(1, Math.floor(Number(e.target.value))))}
              title="Leave blank for infinite (continuous) trading"
            />
          </div>

          <div className="trade-control-group">
            <label className="start" style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold', fontSize: 15, gap: 4, cursor: 'pointer' }}>
              Run
            </label>
            <button
              className={`auto-trade-toggle ${isRunning ? 'on' : 'off'}`}
              onClick={handleRunToggle}
              style={{ padding: '.8rem .12rem', borderRadius: 4 }}
              title={isRunning ? 'Stop' : 'Start'}
            >
              {isRunning ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      </div>

      {/* Positions header */}
      <div className="title"><small>Type|Market</small><small>Entry|Exit spot</small><small>Buy price & P/L</small></div>

      {/* Positions list */}
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
                <span>{tr.market}</span>
                <span>{labelCT(tr.contractType)} D{tr.barrier}</span>
              </div>
              {tr.status === 'error' && (
                <div className="error-display">
                  <span className="error-badge" title={tr.errorDetails || 'Trade failed'}>!</span>
                  <span className="error-text">{tr.errorReason}</span>
                </div>
              )}
            </div>

            <div className="position-spots">
              <div className="spot-entry">
                <span style={{ marginRight: 6 }}>⦿</span>
                {tr.entryValue ?? '—'}
              </div>
              <div className="spot-exit">
                <span style={{ marginRight: 6 }}>◯</span>
                {tr.exitValue ?? '—'}
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
        ))}
      </div>

      {/* Reset */}
      <div className="trade-control-group" style={{ marginTop: 10 }}>
        <label>&nbsp;</label>
        <button
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
            currentTargetRef.current = null;
            targetRotationRef.current = [];
            rotationIndexRef.current = 0;
          }}
          title="Clear positions and P/L"
        >
          Reset
        </button>
      </div>

      {/* T/P & Status strip */}
      <div className="trade-status">
        <div>
          {isRunning ? 'Bot running' : 'Ready.'}
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

      {/* Signals Row */}
      <div className="signals-row">
        <div className={`signals-box ${signalsMode === 'over' ? 'active' : ''}`}>
          <div className="signals-title">Over Signals (≥ threshold)</div>
          <div className="signals-badges">
            {overSignals.length
              ? overSignals.map((d) => (
                  <span className="badge badge-red badge--over" key={`over-${d}`} title={`Signal%: ${overSignalPct[d].toFixed(1)} • Threshold: ${thrNum(overThresholds[d])}%`}>
                    D{d}
                  </span>
                ))
              : <span className="badge">—</span>}
          </div>
        </div>

        <div className={`signals-box ${signalsMode === 'under' ? 'active' : ''}`}>
          <div className="signals-title">Under Signals (≥ threshold)</div>
          <div className="signals-badges">
            {underSignals.length
              ? underSignals.map((d) => (
                  <span className="badge badge-green badge--under" key={`under-${d}`} title={`Signal%: ${underSignalPct[d].toFixed(1)} • Threshold: ${thrNum(underThresholds[d])}%`}>
                    D{d}
                  </span>
                ))
              : <span className="badge">—</span>}
          </div>
        </div>
      </div>

      {/* Analysis Chamber (History) */}
      <div className="history-container">
        <div className="history-title">
          Analysis Chamber
          <button className="refresh-btn" id="refreshBtn" onClick={refreshData}>
            <i className="fas fa-sync-alt"></i> Refresh
          </button>
        </div>
        <div className="history-items">
          {analysisData.lastResults.slice(0, (typeof filterCount === 'number' ? Math.min(1000, filterCount) : 1000)).map((result, index) => {
            let style: React.CSSProperties = { backgroundColor: 'transparent', color: 'black' };
            if (activeMode === 'matches' && (Array.isArray(activeDigits) && activeDigits.length > 0)) {
              if (activeDigits.includes(result.digit)) style = { backgroundColor: digitColors[result.digit], color: 'white' };
            } else if (activeMode === 'overUnder') {
              if (result.digit > selectedDigit) style = { backgroundColor: '#e74c3c', color: 'white' }; // OVER = red
              else if (result.digit < selectedDigit) style = { backgroundColor: '#2ecc71', color: 'white' }; // UNDER = green
            }
            return (
              <div key={index} className="history-item" style={style} title={`Price: ${result.price}`}>
                {result.digit}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default Iframe;
