import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { api_base } from '@/external/bot-skeleton';
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
  TradeTypesUpsAndDownsRiseIcon
} from '@deriv/quill-icons';

import LazyYouTubeModal from '../aaaStrategies/LazyYoutubeModal/LazyYouTubeModal';
import './flipa.scss';

type StrategyType = 'even' | 'odd' | 'over' | 'under' | 'matches' | 'differs' | 'rise' | 'fall';
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
  'R_100': <MarketDerivedVolatility100Icon width={16} height={16} />,
  'R_10': <MarketDerivedVolatility10Icon width={16} height={16} />,
  'R_25': <MarketDerivedVolatility25Icon width={16} height={16} />,
  'R_50': <MarketDerivedVolatility50Icon width={16} height={16} />,
  'R_75': <MarketDerivedVolatility75Icon width={16} height={16} />,
  'JD10': <MarketDerivedJump10Icon width={16} height={16} />,
  'JD25': <MarketDerivedJump25Icon width={16} height={16} />,
  'JD50': <MarketDerivedJump50Icon width={16} height={16} />,
  'JD75': <MarketDerivedJump75Icon width={16} height={16} />,
  'JD100': <MarketDerivedJump100Icon width={16} height={16} />,
  '1HZ10V': <MarketDerivedVolatility101sIcon width={16} height={16} />,
  '1HZ25V': <MarketDerivedVolatility251sIcon width={16} height={16} />,
  '1HZ50V': <MarketDerivedVolatility501sIcon width={16} height={16} />,
  '1HZ15V': <MarketDerivedVolatility151sIcon width={16} height={16} />,
  '1HZ30V': <MarketDerivedVolatility301sIcon width={16} height={16} />,
  '1HZ90V': <MarketDerivedVolatility901sIcon width={16} height={16} />,
  '1HZ75V': <MarketDerivedVolatility751sIcon width={16} height={16} />
};

const contractIcons: Record<string, JSX.Element> = {
  'DIGITEVEN': <TradeTypesDigitsEvenIcon width={16} height={16} />,
  'DIGITODD': <TradeTypesDigitsOddIcon width={16} height={16} />,
  'DIGITMATCH': <TradeTypesDigitsMatchesIcon width={16} height={16} />,
  'DIGITDIFF': <TradeTypesDigitsDiffersIcon width={16} height={16} />,
  'DIGITOVER': <TradeTypesDigitsOverIcon width={16} height={16} />,
  'DIGITUNDER': <TradeTypesDigitsUnderIcon width={16} height={16} />,
  'CALL': <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
  'PUT': <TradeTypesUpsAndDownsFallIcon width={16} height={16} />
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

/* ---------- Helpers ---------- */
const formatTickValue = (v?: number, mf?: string) => {
  if (v === undefined) return '—';
  if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(mf || '')) return v.toFixed(3);
  if (['R_50', 'R_75'].includes(mf || '')) return v.toFixed(4);
  return v.toFixed(2);
};

const labelFor = (s: StrategyType) => ({
  even: 'Even', odd: 'Odd', over: 'Over', under: 'Under',
  matches: 'Matches', differs: 'Differs', rise: 'Rise', fall: 'Fall'
}[s]);

const contractFor = (st: StrategyType) => {
  switch (st) {
    case 'even': return 'DIGITEVEN';
    case 'odd': return 'DIGITODD';
    case 'over': return 'DIGITOVER';
    case 'under': return 'DIGITUNDER';
    case 'matches': return 'DIGITMATCH';
    case 'differs': return 'DIGITDIFF';
    case 'rise': return 'CALL';
    case 'fall': return 'PUT';
  }
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export default function MultiStrategyBot() {
  /* ===== Inputs ===== */
  const [isRunning, setIsRunning] = useState(false);
  const [market, setMarket] = useState('JD50');
  const [ticks, setTicks] = useState(1);

  // Default martingale 1.75
  const [martingaleInput, setMartingaleInput] = useState<number | ''>(1.75);
  const [stakeInput, setStakeInput] = useState<number | ''>(5);

  // Multi-Buy (buy all strategies per round)
  const [multiBuy, setMultiBuy] = useState(false);

  // NEW: Turbo Runs (number of rounds to execute in Multi-Buy mode)
  const [turboRuns, setTurboRuns] = useState<number | ''>(1);

  // Global default digit prediction = 2
  const [defaultDigitPrediction, setDefaultDigitPrediction] = useState<number>(2);

  // Take Profit / Stop Loss (session P/L)
  const [takeProfit, setTakeProfit] = useState<number | ''>('');
  const [stopLoss, setStopLoss] = useState<number | ''>('');

  // Volatility switcher (round-robin per trade/round)
  const [volSwitch, setVolSwitch] = useState(false);
  const VOL_LIST = useRef<string[]>([
    'R_10', '1HZ10V', '1HZ15V', 'R_25', '1HZ25V', '1HZ30V', 'R_50', '1HZ50V', 'R_75', '1HZ75V', '1HZ90V', 'R_100', '1HZ100V',
    'JD10', 'JD25', 'JD50', 'JD75', 'JD100'
  ]);
  const volIndexRef = useRef(0);

  // Strategy chooser
  const ALL_STRATEGIES: StrategyType[] = ['even', 'odd', 'matches', 'differs', 'over', 'under', 'rise', 'fall'];
  const [activeStrategies, setActiveStrategies] = useState<ActiveStrategy[]>([]);
  const [currentStratIndex, setCurrentStratIndex] = useState(0);

  // NEW: Switch-on-loss mode & threshold (consecutive losses to trigger switch)
  const [switchOnLoss, setSwitchOnLoss] = useState(true);
  const [lossesToSwitch, setLossesToSwitch] = useState<number | ''>(1);

  // Tutorial
  const [ytOpen, setYtOpen] = useState(false);
  const YT_URL = "https://youtu.be/lJZO89NS78Q?si=Z_jJLcS1uTTXmNA6";

  /* ===== Trades & status ===== */
  const [trades, setTrades] = useState<TTrade[]>([]);
  const [msg, setMsg] = useState<{ txt: string; type: 'info' | 'success' | 'error' | 'loading' | 'warning' }>({ txt: '', type: 'info' });
  const [profitLoss, setPL] = useState(0);
  const [sessionPL, setSessionPL] = useState(0);

  /* ===== Execution state/locks ===== */
  const isRunningRef = useRef(false);
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);

  const inFlightRef = useRef(false);
  const currentOpenIdRef = useRef<string | null>(null);

  const inFlightRoundRef = useRef(false);
  const currentRoundRemainingRef = useRef(0);
  const contractToStratRef = useRef<Record<string, StrategyType>>({});

  const settledContractsRef = useRef<Set<string>>(new Set());
  const stakesByIdRef = useRef<Record<string, number>>({});

  // HARD STOP FLAG — instant kill switch
  const haltRef = useRef(false);

  /* ===== Martingale (single mode) ===== */
  const martingale = useRef({ base: 0.35, current: 0.35, step: 0, maxSteps: 7 });

  /* ===== Martingale (multi mode per strategy) ===== */
  type MgState = { base: number; current: number; step: number; maxSteps: number };
  const mgByStratRef = useRef<Record<StrategyType, MgState>>({} as Record<StrategyType, MgState>);

  /* ===== NEW: Switch-on-loss tracking ===== */
  const lossStreakByStratRef = useRef<Record<StrategyType, number>>({} as Record<StrategyType, number>);
  const switchOnLossRef = useRef<boolean>(switchOnLoss);
  useEffect(() => { switchOnLossRef.current = switchOnLoss; }, [switchOnLoss]);

  const lossesToSwitchRef = useRef<number>(1);
  useEffect(() => {
    const n = typeof lossesToSwitch === 'number' && lossesToSwitch > 0 ? Math.floor(lossesToSwitch) : 1;
    lossesToSwitchRef.current = n;
  }, [lossesToSwitch]);

  /* ===== NEW: Turbo runs trackers ===== */
  const turboRunsRef = useRef<number | ''>(turboRuns);
  useEffect(() => { turboRunsRef.current = turboRuns; }, [turboRuns]);

  const turboRunsTotalRef = useRef<number>(1);
  const turboRunsRemainingRef = useRef<number>(0);

  /* ===== Live value refs ===== */
  const setStatus = useCallback((txt: string, type: 'info' | 'success' | 'error' | 'loading' | 'warning' = 'info') => setMsg({ txt, type }), []);
  const getBalanceError = useCallback((e: any) => {
    const errorObj = e?.error ?? e;
    const message = (errorObj?.message || 'Unknown error').toString();
    const code = errorObj?.code || '';
    const isBalanceError = code === 'InsufficientBalance' || /insufficient|balance|fund|not enough|no enough|low balance/i.test(message);
    return { isBalanceError, message };
  }, []);

  const activeStrategiesRef = useRef<ActiveStrategy[]>([]);
  useEffect(() => { activeStrategiesRef.current = activeStrategies; }, [activeStrategies]);

  const volSwitchRef = useRef(false); useEffect(() => { volSwitchRef.current = volSwitch; }, [volSwitch]);
  const marketRef = useRef(market); useEffect(() => { marketRef.current = market; }, [market]);
  const ticksRef = useRef(ticks); useEffect(() => { ticksRef.current = ticks; }, [ticks]);

  const martingaleInputRef = useRef<number | ''>(martingaleInput);
  useEffect(() => { martingaleInputRef.current = martingaleInput; }, [martingaleInput]);

  const currentStratIndexRef = useRef(0);
  useEffect(() => { currentStratIndexRef.current = currentStratIndex; }, [currentStratIndex]);

  const multiBuyRef = useRef(false); useEffect(() => { multiBuyRef.current = multiBuy; }, [multiBuy]);

  const defaultDigitPredictionRef = useRef<number>(defaultDigitPrediction);
  useEffect(() => { defaultDigitPredictionRef.current = defaultDigitPrediction; }, [defaultDigitPrediction]);

  const sessionPLRef = useRef(0); useEffect(() => { sessionPLRef.current = sessionPL; }, [sessionPL]);

  const tpRef = useRef<number | ''>(takeProfit); useEffect(() => { tpRef.current = takeProfit; }, [takeProfit]);
  const slRef = useRef<number | ''>(stopLoss); useEffect(() => { slRef.current = stopLoss; }, [stopLoss]);

  /* ===== Account-switch safe: API epoch + re-subscription ===== */
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

  /* ===== Market picker ===== */
  const pickMarketFromRefs = () => {
    if (!volSwitchRef.current) return marketRef.current;
    const list = VOL_LIST.current;
    const idx = volIndexRef.current % list.length;
    const m = list[idx];
    volIndexRef.current = (idx + 1) % list.length;
    return m;
  };

  /* ===== Strategy buttons ===== */
  const toggleStrategy = (key: StrategyType) => {
    setActiveStrategies(prev => {
      const idx = prev.findIndex(s => s.key === key);
      if (idx >= 0) {
        const copy = [...prev]; copy.splice(idx, 1);
        if (currentStratIndex >= copy.length) setCurrentStratIndex(0);
        return copy;
      }
      const isDigit = DIGIT_KEYS.includes(key);
      return [...prev, {
        key,
        stake: '',
        prediction: isDigit ? defaultDigitPredictionRef.current : undefined
      }];
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

  /* ===== Single-mode next config ===== */
  const getNextConfigFromRefs = () => {
    const actives = activeStrategiesRef.current;
    if (!actives || actives.length === 0) return { error: 'Activate at least one strategy' } as const;

    const i = currentStratIndexRef.current % actives.length;
    const strat = actives[i];

    const ct = contractFor(strat.key)!;
    const needBarrier = DIGIT_KEYS.includes(strat.key);
    const barrier = strat.prediction;

    if (needBarrier && !(typeof barrier === 'number' && barrier >= 0 && barrier <= 9)) {
      return { error: 'Set prediction (0–9) for digit strategies' } as const;
    }

    const mi = isNum(martingaleInputRef.current) ? martingaleInputRef.current : 1;
    const useMg = mi > 1;

    const base = isNum(strat.stake) && strat.stake > 0
      ? strat.stake
      : (isNum(stakeInput) && stakeInput > 0 ? stakeInput : 0.35);

    const stake = useMg ? martingale.current.current : base;
    const mkt = pickMarketFromRefs();

    return {
      contractType: ct,
      stake,
      market: mkt,
      duration: ticksRef.current,
      barrier: typeof barrier === 'number' ? barrier : undefined
    } as const;
  };

  /* ===== BUY (with readyState guard + hard stop guard) ===== */
  const createTempTrade = useCallback((ct: string, stake: number, mkt: string, dur: number, barrier?: number) => {
    const id = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const t: TTrade = {
      id, contractType: ct, stake, market: mkt, duration: dur,
      status: 'pending', timestamp: new Date(), marketFormat: mkt, temp: true
    };
    setTrades(prev => [t, ...prev]);
    return id;
  }, []);

  const buy = async (ct: string, stake: number, mkt: string, dur: number, barrier?: number) => {
    if (haltRef.current || !isRunningRef.current) throw new Error('Trading halted');

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
          ...(typeof barrier === 'number' ? { barrier: String(barrier) } : {})
        }
      });
      if (resp?.error) throw resp;

      const realID = String(resp.buy.contract_id);
      stakesByIdRef.current[realID] = stake;

      setTrades(ts => ts.map(t => t.id === tmpID ? ({ ...t, id: realID, temp: false, status: 'open' }) : t));
      setStatus('✅ Trade placed', 'success');
      return realID;
    } catch (e: any) {
      const { isBalanceError, message } = getBalanceError(e);
      setTrades(ts => ts.map(t => t.id === tmpID ? ({
        ...t, status: 'error', temp: false,
        errorReason: isBalanceError ? 'Insufficient balance' : 'Trade failed',
        errorDetails: message, closeTime: new Date()
      }) : t));
      setStatus(message || 'Trade failed', 'error');

      // release locks appropriately
      if (!multiBuyRef.current) {
        inFlightRef.current = false;
        currentOpenIdRef.current = null;
      } else {
        currentRoundRemainingRef.current = Math.max(0, currentRoundRemainingRef.current - 1);
        if (currentRoundRemainingRef.current === 0) {
          inFlightRoundRef.current = false;
          if (isNum(turboRunsRef.current)) {
            turboRunsRemainingRef.current = Math.max(0, turboRunsRemainingRef.current - 1);
          }
          if (isRunningRef.current && !haltRef.current) {
            if (isNum(turboRunsRef.current) && turboRunsRemainingRef.current <= 0) {
              isRunningRef.current = false;
              setIsRunning(false);
              setStatus('✅ Turbo runs completed', 'success');
            } else {
              scheduleNext('after_error');
            }
          }
        }
      }
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
    inFlightRef.current = false;
    inFlightRoundRef.current = false;
    currentRoundRemainingRef.current = 0;
    setStatus(`⛔ ${reason === 'take_profit' ? 'Take Profit reached' : 'Stop Loss hit'}. Trading stopped.`, 'warning');
  };

  /* ===== Scheduler (guards first) ===== */
  const scheduleNext = (why: 'start' | 'after_win' | 'after_loss' | 'after_error' = 'start') => {
    if (haltRef.current) return;
    if (!isRunningRef.current) return;

    const guard = riskHit(sessionPLRef.current);
    if (guard.hit) {
      stopBotHard(guard.reason!);
      return;
    }

    // MULTI-BUY MODE (Turbo)
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
      if (!actives || actives.length === 0) { setStatus('Activate at least one strategy', 'warning'); return; }

      for (const s of actives) {
        if (DIGIT_KEYS.includes(s.key) && !(typeof s.prediction === 'number' && s.prediction >= 0 && s.prediction <= 9)) {
          setStatus(`Set prediction (0–9) for ${labelFor(s.key)}`, 'warning');
          return;
        }
      }

      const mkt = pickMarketFromRefs();
      const mi = isNum(martingaleInputRef.current) ? martingaleInputRef.current : 1;
      const useMg = mi > 1;

      const batch = actives.map(s => {
        const ct = contractFor(s.key)!;
        const needBarrier = DIGIT_KEYS.includes(s.key);
        const barrier = needBarrier ? (s.prediction as number) : undefined;

        const base = isNum(s.stake) && s.stake > 0
          ? s.stake
          : (isNum(stakeInput) && stakeInput > 0 ? stakeInput : 0.35);

        const mg = mgByStratRef.current[s.key] ?? { base, current: base, step: 0, maxSteps: 7 };
        mg.base = base; // sync
        const stake = useMg ? mg.current : base;

        return { key: s.key, ct, barrier, stake, mkt, dur: ticksRef.current };
      });

      inFlightRoundRef.current = true;
      contractToStratRef.current = {};
      currentRoundRemainingRef.current = batch.length;

      if (haltRef.current) {
        inFlightRoundRef.current = false;
        currentRoundRemainingRef.current = 0;
        return;
      }

      batch.forEach((b, idx) => {
        setTimeout(() => {
          if (haltRef.current || !isRunningRef.current) {
            inFlightRoundRef.current = false;
            currentRoundRemainingRef.current = 0;
            return;
          }
          buy(b.ct, b.stake, b.mkt, b.dur, b.barrier)
            .then(realID => { if (realID) contractToStratRef.current[realID] = b.key; })
            .catch(() => { /* handled */ });
        }, 120 * idx);
      });

      return;
    }

    // SINGLE-MODE
    if (inFlightRef.current) return;
    if (currentOpenIdRef.current) return;

    const cfg = getNextConfigFromRefs();
    if ('error' in cfg) {
      if (isRunningRef.current) setStatus(cfg.error, 'warning');
      return;
    }

    inFlightRef.current = true;
    setTimeout(() => {
      if (haltRef.current || !isRunningRef.current) {
        inFlightRef.current = false;
        return;
      }
      buy(cfg.contractType, cfg.stake, cfg.market, cfg.duration, cfg.barrier as number | undefined)
        .then(realID => { currentOpenIdRef.current = realID || null; })
        .catch(() => {
          setIsRunning(false);
          isRunningRef.current = false;
          inFlightRef.current = false;
        });
    }, 200);
  };

  /* ===== Settlement handling (extracted for reuse) ===== */
  const applySessionPLAndMaybeStop = useCallback((net: number) => {
    setSessionPL(prev => {
      const next = prev + net;
      sessionPLRef.current = next;
      const guard = riskHit(next);
      if (guard.hit) stopBotHard(guard.reason!);
      return next;
    });
  }, []);

  const handleSettle = useCallback((cid: string, net: number) => {
    const won = net >= 0;
    const mi = isNum(martingaleInputRef.current) ? martingaleInputRef.current : 1;
    const useMg = mi > 1;

    // Session P/L and risk check
    applySessionPLAndMaybeStop(net);
    if (!isRunningRef.current || haltRef.current) {
      inFlightRef.current = false;
      inFlightRoundRef.current = false;
      currentRoundRemainingRef.current = 0;
      return;
    }

    if (!multiBuyRef.current) {
      // Single-mode martingale
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

      // NEW: Strategy switching with toggle & consecutive loss threshold
      const actives = activeStrategiesRef.current;
      if (actives && actives.length > 0) {
        const idx = currentStratIndexRef.current % actives.length;
        const key = actives[idx].key;

        if (won) {
          // Maintain current strategy on win; reset its loss streak.
          lossStreakByStratRef.current[key] = 0;
        } else {
          // Increment loss streak for this strategy
          const nextStreak = (lossStreakByStratRef.current[key] ?? 0) + 1;
          lossStreakByStratRef.current[key] = nextStreak;

          // Only switch if toggle is ON and streak meets threshold
          if (switchOnLossRef.current) {
            const threshold = lossesToSwitchRef.current || 1;
            if (nextStreak >= threshold) {
              const next = (currentStratIndexRef.current + 1) % actives.length;
              currentStratIndexRef.current = next; setCurrentStratIndex(next);
              // Reset the old strategy's streak after switching
              lossStreakByStratRef.current[key] = 0;
            }
          }
          // If toggle is OFF → never switch automatically
        }
      }

      if (currentOpenIdRef.current === cid) currentOpenIdRef.current = null;
      inFlightRef.current = false;

      if (isRunningRef.current && !haltRef.current) scheduleNext(won ? 'after_win' : 'after_loss');
    } else {
      // Multi-mode per strategy martingale
      const stratKey = contractToStratRef.current[cid];
      if (stratKey) {
        const s = mgByStratRef.current[stratKey];
        if (s && useMg) {
          if (won) { s.current = s.base; s.step = 0; }
          else {
            if (s.step < s.maxSteps) { s.step += 1; s.current = Number((s.current * mi).toFixed(2)); }
            else { s.current = s.base; s.step = 0; }
          }
          mgByStratRef.current[stratKey] = { ...s };
        }
      }

      // Round completion
      currentRoundRemainingRef.current = Math.max(0, currentRoundRemainingRef.current - 1);
      if (haltRef.current) { inFlightRoundRef.current = false; currentRoundRemainingRef.current = 0; return; }
      if (currentRoundRemainingRef.current === 0) {
        inFlightRoundRef.current = false;
        if (isNum(turboRunsRef.current)) {
          turboRunsRemainingRef.current = Math.max(0, turboRunsRemainingRef.current - 1);
        }
        if (isRunningRef.current && !haltRef.current) {
          if (isNum(turboRunsRef.current) && turboRunsRemainingRef.current <= 0) {
            isRunningRef.current = false; setIsRunning(false); setStatus('✅ Turbo runs completed', 'success');
          } else {
            scheduleNext(won ? 'after_win' : 'after_loss');
          }
        }
      }
    }
  }, [applySessionPLAndMaybeStop]);

  /* ===== onMessage handler — RE-SUBSCRIBE on apiEpoch changes ===== */
  const handleApiMessage = useCallback(({ data }: any) => {
    if (data?.error) { console.error('WS error', data.error); return; }

    // proposal_open_contract stream → keep UI live & detect finished
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

    // transaction: sell → settle
    if (data?.msg_type === 'transaction' && data.transaction?.action === 'sell') {
      const tx: TTransaction = data.transaction;
      const cid = String(tx.contract_id); // ✅ correct field
    
      // Update the trade in UI
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
    
      // Prevent double-settlement; then apply session P/L + switching logic
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
          <div className='eve'>
            <MarketDerivedJump75Icon width={18} height={18} />
            Strategy Switcher | Market Flipaa
            <MarketDerivedJump75Icon width={16} height={16} />
          </div>
        </div>
    
        {/* Strategy buttons */}
        <div className="strategy-buttons" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 12px' }}>
          {(['even', 'odd', 'matches', 'differs', 'over', 'under', 'rise', 'fall'] as StrategyType[]).map(sk => {
            const active = activeStrategies.some(s => s.key === sk);
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
                  gap: 6
                }}
              >
                {sk === 'even' && <TradeTypesDigitsEvenIcon width={14} height={14} />}
                {sk === 'odd' && <TradeTypesDigitsOddIcon width={14} height={14} />}
                {sk === 'matches' && <TradeTypesDigitsMatchesIcon width={14} height={14} />}
                {sk === 'differs' && <TradeTypesDigitsDiffersIcon width={14} height={14} />}
                {sk === 'over' && <TradeTypesDigitsOverIcon width={14} height={14} />}
                {sk === 'under' && <TradeTypesDigitsUnderIcon width={14} height={14} />}
                {sk === 'rise' && <TradeTypesUpsAndDownsRiseIcon width={14} height={14} />}
                {sk === 'fall' && <TradeTypesUpsAndDownsFallIcon width={14} height={14} />}
                {labelFor(sk)}
              </button>
            );
          })}
        </div>
    
        {/* Active strategies panel */}
        <div style={{ border: '1px solid #2b2b2b', borderRadius: 8, padding: 10, marginBottom: 12 }}>
          <div className="active-strategies" style={{ fontWeight: 700, marginBottom: 8 }}>
            Active strategies ({multiBuy ? 'multi-buy' : `switch-on-loss${switchOnLossRef.current ? ` · ${lossesToSwitchRef.current} loss${(lossesToSwitchRef.current ?? 1) > 1 ? 'es' : ''}` : ''}`})
          </div>
          {activeStrategies.length === 0 ? (
            <div style={{ opacity: .8 }}>Activate favorite strategy(s) above.</div>
          ) : (
            <div className='active-strat' style={{ display: 'grid', gap: 2 }}>
              {activeStrategies.map((s, i) => (
                <div className='whuee' key={`${s.key}-${i}`} >
                  <div className='see'><b>#{i + 1}</b> — {labelFor(s.key)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
                  ) : <div />}
                  <div style={{ opacity: .7 }}>
                    {!multiBuy && activeStrategies.length && (currentStratIndex % activeStrategies.length === i) && isRunning ? '⏳ current' : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
    
        <div className="trading-container">
          <LazyYouTubeModal videoUrl={YT_URL} isOpen={ytOpen} onClose={() => setYtOpen(false)} />
    
          {/* Controls */}
          <div className="trade-controls">
            <div className="trade-control-group market-selector">
              <label>Market</label>
              <select value={market} onChange={(e) => setMarket(e.target.value)} disabled={isRunning || volSwitch} className="trade-input">
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
                onChange={(e) => setStakeInput(e.target.value === '' ? '' : Number(e.target.value))}
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
                onChange={(e) => setMartingaleInput(e.target.value === '' ? '' : Number(e.target.value))}
                min={1}
                step={0.01}
                disabled={isRunning}
                title=">1 enables martingale; 1 disables"
              />
            </div>
    
            <div className="trade-control-group">
              <label>Ticks</label>
              <select className="trade-input" value={ticks} onChange={(e) => setTicks(parseInt(e.target.value, 10))} disabled={isRunning}>
                <option value={1}>1</option>
              </select>
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
                onChange={(e) => {
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
                style={{ border: '1px solid #333', background: volSwitch ? '#2e7d32' : '#424242', color: '#fff', alignItems: 'center', minHeight: 36 }}
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
                title="When ON: only switch to next strategy after N consecutive losses; on win, maintain"
                style={{ border: '1px solid #333', background: switchOnLoss ? '#2e7d32' : '#424242', color: '#fff', alignItems: 'center', minHeight: 36 }}
              >
                {switchOnLoss ? 'Switch on Loss: ON' : 'Switch on Loss: OFF'}
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
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setLossesToSwitch('');
                  else setLossesToSwitch(Math.max(1, Math.floor(Number(v))));
                }}
                disabled={isRunning || !switchOnLoss || multiBuy}
                title="Number of consecutive losses before switching strategies"
                style={{ width: 96 }}
              />
            </div>
    
            {/* Multi-Buy (Turbo) */}
            <div className="trade-control-group" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setMultiBuy(v => !v)}
                disabled={isRunning}
                className={`strat-btn ${multiBuy ? 'active' : ''}`}
                title="Buy all active strategies at once; martingale per strategy"
                style={{ border: '1px solid #333', background: multiBuy ? '#2e7d32' : '#424242', color: '#fff', alignItems: 'center', minHeight: 36 }}
              >
                {multiBuy ? 'Turbo: ON' : 'Turbo: OFF'}
              </button>
            </div>
    
            {/* Turbo Runs input (only for Turbo mode) */}
            <div className="trade-control-group" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label>Rounds</label>
              <input
                type="number"
                className="trade-input"
                min={1}
                step={1}
                value={turboRuns === '' ? '' : String(turboRuns)}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setTurboRuns('');
                  else setTurboRuns(Math.max(1, Math.floor(Number(v))));
                }}
                disabled={isRunning || !multiBuy}
                title="Number of rounds in Turbo mode; each round buys all active strategies once"
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
                onChange={(e) => setTakeProfit(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                disabled={isRunning}
                title="Close session when session P/L reaches this profit"
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
                disabled={isRunning}
                title="Close session when session P/L drawdown reaches this loss"
              />
            </div>
    
            <div className="trade-control-group">
              <label className="start" style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold', fontSize: 15, gap: 4, cursor: 'pointer' }}>
                <LegacyPlayFillIcon width={20} height={20} /> Run
              </label>
              <button
                className={`auto-trade-toggle ${isRunning ? 'on' : 'off'}`}
                onClick={isRunning ? () => { 
                  // stop
                  isRunningRef.current = false;
                  setIsRunning(false);
                  inFlightRef.current = false;
                  inFlightRoundRef.current = false;
                  currentRoundRemainingRef.current = 0;
                  setStatus('Bot stopped', 'info');
                } : () => { 
                  // start
                  const actives = activeStrategiesRef.current = activeStrategies;
                  if (!actives || actives.length === 0) {
                    setStatus('Activate at least one strategy below the header', 'warning');
                    return;
                  }
    
                  // reset kill switch & session
                  haltRef.current = false;
    
                  // determine base stake
                  const first = actives[0];
                  const base0 = isNum(first?.stake) && first.stake > 0
                    ? first.stake
                    : (isNum(stakeInput) && stakeInput > 0 ? stakeInput : 0.35);
    
                  // Single-mode MG init
                  martingale.current.base = base0;
                  martingale.current.current = base0;
                  martingale.current.step = 0;
    
                  // Multi-mode MG init per strategy
                  mgByStratRef.current = {} as Record<StrategyType, { base: number; current: number; step: number; maxSteps: number }>;
                  actives.forEach(s => {
                    const base = isNum(s.stake) && s.stake > 0
                      ? s.stake
                      : (isNum(stakeInput) && stakeInput > 0 ? stakeInput : 0.35);
                    mgByStratRef.current[s.key] = { base, current: base, step: 0, maxSteps: 7 };
                  });
    
                  // reset loss streaks
                  lossStreakByStratRef.current = {} as Record<StrategyType, number>;
                  actives.forEach(s => { lossStreakByStratRef.current[s.key] = 0; });
    
                  volSwitchRef.current = volSwitch;
                  marketRef.current = market;
                  ticksRef.current = ticks;
    
                  const mi = isNum(martingaleInput) ? martingaleInput : 1;
                  martingaleInputRef.current = mi;
                                    // start from here (continuation)
                                    currentStratIndexRef.current = 0;
                                    setCurrentStratIndex(0);
                  
                                    // clear & reset tracking maps
                                    settledContractsRef.current.clear();
                                    currentOpenIdRef.current = null;
                                    stakesByIdRef.current = {};
                                    volIndexRef.current = 0;
                  
                                    // locks
                                    inFlightRef.current = false;
                                    inFlightRoundRef.current = false;
                                    currentRoundRemainingRef.current = 0;
                                    contractToStratRef.current = {};
                  
                                    // reset session P/L
                                    setSessionPL(0);
                                    sessionPLRef.current = 0;
                  
                                    // init turbo runs only when Multi-Buy is ON
                                    if (multiBuy) {
                                      const total = (typeof turboRunsRef.current === 'number' && turboRunsRef.current > 0)
                                        ? Math.floor(turboRunsRef.current)
                                        : 1;
                                      turboRunsTotalRef.current = total;
                                      turboRunsRemainingRef.current = total;
                                      setStatus(`Bot started (Turbo ON · ${total} run${total > 1 ? 's' : ''})`, 'success');
                                    } else {
                                      const lossesN = lossesToSwitchRef.current || 1;
                                      if (switchOnLossRef.current) {
                                        setStatus(`Bot started (Switch on loss · ${lossesN} loss${lossesN > 1 ? 'es' : ''} to switch)`, 'success');
                                      } else {
                                        setStatus('Bot started (No auto-switch)', 'success');
                                      }
                                    }
                  
                                    isRunningRef.current = true;
                                    setIsRunning(true);
                  
                                    // kick off the first schedule
                                    scheduleNext('start');
                                  }}
                                  style={{
                                    padding: '.8rem .12rem',
                                    background: isRunning ? 'linear-gradient(90deg,#4285F4,#34a853)' : '#E6A85C',
                                    color: '#fff', border: '1px solid #222',
                                    justifyContent: 'center', display: 'flex', borderRadius: '4px', fontWeight: 'bold'
                                  }}
                                  title={multiBuy ? 'Buys all actives each round' : (switchOnLoss ? 'Maintains on win, switches after N losses' : 'Manual switching')}
                                >
                                  {isRunning ? 'ON' : 'OFF'}
                                </button>
                              </div>
                            </div>
                  
                            {/* Positions */}
                            <div className="title"><small>Type|Market</small><small>Entry|Exit spot</small><small>Buy price & P/L</small></div>
                  
                            <div className="open-positions">
                              {trades.length === 0 ? (
                                <div className="no-positions"><small>No positions</small></div>
                              ) : trades.map(tr => (
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
                              ))}
                            </div>
                  
                            {!isRunning && (
                              <div className="trade-control-group" style={{ marginTop: 10 }}>
                                <label>&nbsp;</label>
                                <button
                                  className="trade-btn reset-btn"
                                  onClick={() => {
                                    if (isRunningRef.current) return;
                                    setTrades([]);
                                    setPL(0);
                                    setSessionPL(0);
                                    sessionPLRef.current = 0;
                                    settledContractsRef.current.clear();
                                    currentOpenIdRef.current = null;
                                    stakesByIdRef.current = {};
                                    inFlightRef.current = false;
                                    inFlightRoundRef.current = false;
                                    currentRoundRemainingRef.current = 0;
                                    contractToStratRef.current = {};
                                    turboRunsRemainingRef.current = 0;
                                    setStatus('History cleared', 'info');
                                  }}
                                  title="Clear results and P/L"
                                >
                                  Reset
                                </button>
                              </div>
                            )}
                          </div>
                  
                          {/* Status & Stats */}
                          <div className="trade-status">
                            <div>{msg.txt}</div>
                            <div style={{ marginTop: 6 }}>
                              {isNum(martingaleInput) && martingaleInput > 1 ? (
                                <>
                                  Martingale:{' '}
                                  <b>
                                    {multiBuy
                                      ? 'per-strategy'
                                      : `step ${martingale.current.step} / ${martingale.current.maxSteps} · Current $${martingale.current.current.toFixed(2)}`}
                                  </b>
                                </>
                              ) : (
                                <>
                                  Martingale: <b>off</b>
                                </>
                              )}
                              {volSwitch ? (
                                <span style={{ marginLeft: 12 }}>· Vol Switch: <b>on</b></span>
                              ) : (
                                <span style={{ marginLeft: 12 }}>· Vol Switch: <b>off</b></span>
                              )}
                              <span style={{ marginLeft: 12 }}>· Mode: <b>{multiBuy ? 'Multi-Buy' : 'Switch on loss'}</b></span>
                              {!multiBuy && switchOnLoss && (
                                <span style={{ marginLeft: 12 }}>
                                  · Switch after: <b>{lossesToSwitchRef.current} loss{(lossesToSwitchRef.current ?? 1) > 1 ? 'es' : ''}</b>
                                </span>
                              )}
                              {multiBuy && isRunning && typeof turboRunsTotalRef.current === 'number' && (
                                <span style={{ marginLeft: 12 }}>
                                  · Runs: <b>{Math.max(0, turboRunsRemainingRef.current)} / {turboRunsTotalRef.current}</b>
                                </span>
                              )}
                              {!multiBuy && activeStrategies.length > 0 && isRunning && (
                                <span style={{ marginLeft: 12 }}>
                                  · Current Strategy: <b>{labelFor(activeStrategies[currentStratIndex % activeStrategies.length].key)}</b>
                                </span>
                              )}
                              <span style={{ marginLeft: 12 }}>· Default Digit: <b>{defaultDigitPrediction}</b></span>
                              <span style={{ marginLeft: 12 }}>· Session P/L: <b>{sessionPL >= 0 ? '+' : ''}{sessionPL.toFixed(2)}</b></span>
                              {isNum(takeProfit) && takeProfit > 0 && (
                                <span style={{ marginLeft: 12 }}>· TP: <b>{takeProfit.toFixed(2)}</b></span>
                              )}
                              {isNum(stopLoss) && stopLoss > 0 && (
                                <span style={{ marginLeft: 12 }}>· SL: <b>{stopLoss.toFixed(2)}</b></span>
                              )}
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
                  
    
                 
    
