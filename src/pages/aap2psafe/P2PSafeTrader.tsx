import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { playTradeResultSound } from './tradeSounds';
import './P2PSafeTrader.scss';

type ContractType = 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD' | 'CALL' | 'PUT';

type PickedContract = {
  contract_type: ContractType;
  barrier?: number;
  reason: string;
  edge: number;
  riskPct: number;
};

type TradeLog = {
  id: string;
  contract_type: ContractType;
  barrier?: number;
  stake: number;
  status: 'pending' | 'placed' | 'won' | 'lost' | 'error';
  created_at: Date;
  profit?: number;
  /** Account balance after this contract settled (when available). */
  balanceAfter?: number;
  error?: string;
};

type AnalysisView = {
  sampleSize: number;
  topChoices: string;
  lowStreak: number;
  highStreak: number;
  recommendation: string;
};

type RunMode = 'low_risk' | 'target_1usd' | 'medium_risk' | 'high_risk';
type OrderFilter = 'all' | 'open' | 'settled';
type PeriodUnit = 'minute' | 'hour';

const DEFAULT_SYMBOL = '1HZ10V';
const HISTORY_COUNT = 120;
const MIN_ANALYSIS_SIZE = 25;
const MIN_EDGE = 0.03;
const MIN_ANALYSIS_CYCLES_BEFORE_FIRST_TRADE = 3;
const SESSION_TARGET = 1;
const MARTINGALE_MULTIPLIER = 1.25;
const TARGET_DEADLINE_MS = 5 * 60 * 1000;
/** Balance API often lags payout; poll a few times so "Bal" reflects post-settlement account balance. */
const BALANCE_AFTER_SETTLE_DELAYS_MS = [600, 1600, 2800];

/** Time until oldest counted placement exits the rolling quota window (minute or hour). */
function formatQuotaWindowRemaining(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const formatQuote = (quote: number, symbol: string) => {
  if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(symbol)) return quote.toFixed(3);
  if (['R_50', 'R_75'].includes(symbol)) return quote.toFixed(4);
  return quote.toFixed(2);
};

const MODE_OPTIONS: Array<{
  value: RunMode;
  title: string;
  subtitle: string;
}> = [
  {
    value: 'low_risk',
    title: 'Low Risk',
    subtitle: '~1 trade per minute',
  },
  {
    value: 'target_1usd',
    title: '$1 Target',
    subtitle: '5-minute session sprint',
  },
  {
    value: 'medium_risk',
    title: 'Medium Risk',
    subtitle: 'Balanced entry profile',
  },
  {
    value: 'high_risk',
    title: 'High Risk',
    subtitle: 'Aggressive edge seeking',
  },
];

const extractLastDigit = (quote: number, symbol: string) => {
  const digit = Number.parseInt(formatQuote(quote, symbol).slice(-1), 10);
  return Number.isFinite(digit) ? digit : null;
};

const labelContract = (c: Pick<PickedContract, 'contract_type' | 'barrier'>) => {
  switch (c.contract_type) {
    case 'DIGITOVER':
      return `Over ${c.barrier ?? '?'}`;
    case 'DIGITUNDER':
      return `Under ${c.barrier ?? '?'}`;
    case 'DIGITEVEN':
      return 'Even';
    case 'DIGITODD':
      return 'Odd';
    case 'CALL':
      return 'Rise';
    case 'PUT':
      return 'Fall';
    default:
      return c.contract_type;
  }
};

function pickBestCandidate(candidates: PickedContract[]): { picked: PickedContract | null; topChoices: string } {
  const sorted = [...candidates].sort((a, b) => b.edge - a.edge);
  const topChoices = sorted
    .slice(0, 5)
    .map(c => `${labelContract(c)} (${c.riskPct.toFixed(1)}%)`)
    .join(' | ');
  const best = sorted[0];
  const second = sorted[1];
  if (!best || !second) return { picked: null, topChoices };
  const edgeGap = best.edge - second.edge;
  if (edgeGap < MIN_EDGE) return { picked: null, topChoices };
  return {
    picked: {
      ...best,
      edge: edgeGap,
      reason: `${best.reason} | edge ${(edgeGap * 100).toFixed(1)}%`,
    },
    topChoices,
  };
}

class SafePatternAnalyzer {
  digitSeq: number[] = [];
  prices: number[] = [];
  lowStreak = 0;
  highStreak = 0;

  feedTicks(prices: number[], digits: number[]) {
    this.prices = prices.slice(-HISTORY_COUNT);
    this.digitSeq = digits.slice(-HISTORY_COUNT);
    this.recomputeStreaks();
  }

  private recomputeStreaks() {
    let low = 0;
    let high = 0;
    for (let i = this.digitSeq.length - 1; i >= 0; i--) {
      if (this.digitSeq[i] <= 1) low += 1;
      else break;
    }
    for (let i = this.digitSeq.length - 1; i >= 0; i--) {
      if (this.digitSeq[i] >= 9) high += 1;
      else break;
    }
    this.lowStreak = low;
    this.highStreak = high;
  }

  private riseFallFromPrices(): { risePct: number; fallPct: number; riseStreakEnd: number; fallStreakEnd: number } {
    const p = this.prices;
    if (p.length < 2) return { risePct: 50, fallPct: 50, riseStreakEnd: 0, fallStreakEnd: 0 };
    let rises = 0;
    let falls = 0;
    for (let i = 1; i < p.length; i++) {
      if (p[i] > p[i - 1]) rises++;
      else if (p[i] < p[i - 1]) falls++;
    }
    const t = rises + falls || 1;
    let riseStreakEnd = 0;
    for (let i = p.length - 1; i >= 1; i--) {
      if (p[i] > p[i - 1]) riseStreakEnd++;
      else break;
    }
    let fallStreakEnd = 0;
    for (let i = p.length - 1; i >= 1; i--) {
      if (p[i] < p[i - 1]) fallStreakEnd++;
      else break;
    }
    return {
      risePct: (rises / t) * 100,
      fallPct: (falls / t) * 100,
      riseStreakEnd,
      fallStreakEnd,
    };
  }

  analyze(mode: RunMode): { picked: PickedContract | null; topChoices: string } {
    const n = this.digitSeq.length;
    if (n < MIN_ANALYSIS_SIZE) return { picked: null, topChoices: 'Not enough sample yet' };

    const { risePct, fallPct, riseStreakEnd, fallStreakEnd } = this.riseFallFromPrices();
    const candidates: PickedContract[] = [];

    const addOverUnder = (overs: number[], unders: number[]) => {
      overs.forEach(barrier => {
        const loseCount = this.digitSeq.filter(d => d <= barrier).length;
        const risk = loseCount / n;
        const score = (1 - risk) + this.lowStreak * 0.02 - this.highStreak * 0.01;
        candidates.push({
          contract_type: 'DIGITOVER',
          barrier,
          riskPct: risk * 100,
          edge: score,
          reason: `Over ${barrier} (${(risk * 100).toFixed(1)}% lose rate)`,
        });
      });
      unders.forEach(barrier => {
        const loseCount = this.digitSeq.filter(d => d >= barrier).length;
        const risk = loseCount / n;
        const score = (1 - risk) + this.highStreak * 0.02 - this.lowStreak * 0.01;
        candidates.push({
          contract_type: 'DIGITUNDER',
          barrier,
          riskPct: risk * 100,
          edge: score,
          reason: `Under ${barrier} (${(risk * 100).toFixed(1)}% lose rate)`,
        });
      });
    };

    if (mode === 'low_risk' || mode === 'target_1usd') {
      addOverUnder([0, 1, 2], [9, 8, 7]);
      return pickBestCandidate(candidates);
    }

    if (mode === 'medium_risk') {
      addOverUnder([3, 4], [7, 6]);
      const evenCount = this.digitSeq.filter(d => d % 2 === 0).length;
      const oddCount = n - evenCount;
      const evenRisk = (oddCount / n) * 100;
      const oddRisk = (evenCount / n) * 100;
      candidates.push({
        contract_type: 'DIGITEVEN',
        riskPct: oddRisk,
        edge: (1 - oddCount / n) + (this.lowStreak > this.highStreak ? 0.01 : 0),
        reason: `Even (${oddRisk.toFixed(1)}% lose vs odd)`,
      });
      candidates.push({
        contract_type: 'DIGITODD',
        riskPct: evenRisk,
        edge: (1 - evenCount / n) + (this.highStreak > this.lowStreak ? 0.01 : 0),
        reason: `Odd (${evenRisk.toFixed(1)}% lose vs even)`,
      });
      const callRisk = fallPct;
      const putRisk = risePct;
      candidates.push({
        contract_type: 'CALL',
        riskPct: callRisk,
        edge: (100 - callRisk) / 100 + riseStreakEnd * 0.015 - fallStreakEnd * 0.01,
        reason: `Rise (${callRisk.toFixed(1)}% down-move freq.)`,
      });
      candidates.push({
        contract_type: 'PUT',
        riskPct: putRisk,
        edge: (100 - putRisk) / 100 + fallStreakEnd * 0.015 - riseStreakEnd * 0.01,
        reason: `Fall (${putRisk.toFixed(1)}% up-move freq.)`,
      });
      return pickBestCandidate(candidates);
    }

    if (mode === 'high_risk') {
      addOverUnder([4, 5, 6], [6, 5, 4]);
      return pickBestCandidate(candidates);
    }

    return { picked: null, topChoices: 'Unknown mode' };
  }
}

class ExecutionModel {
  inFlight = false;
  nextAllowedAt = 0;
  canExecute(now: number) {
    return !this.inFlight && now >= this.nextAllowedAt;
  }
  lock() {
    this.inFlight = true;
  }
  release(intervalMs: number) {
    this.inFlight = false;
    this.nextAllowedAt = Date.now() + intervalMs;
  }
}

const P2PSafeTrader: React.FC = () => {
  const [stake, setStake] = useState<number | ''>(1);
  const [stopLoss, setStopLoss] = useState<number | ''>(3);
  const [mode, setMode] = useState<RunMode>('low_risk');
  const [maxRunsPerPeriod, setMaxRunsPerPeriod] = useState<number | ''>('');
  const [periodUnit, setPeriodUnit] = useState<PeriodUnit>('minute');
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState('Idle');
  const [analysisSummary, setAnalysisSummary] = useState('Waiting for first analysis...');
  const [analysisView, setAnalysisView] = useState<AnalysisView | null>(null);
  const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
  const [countdownSec, setCountdownSec] = useState(0);
  const [sessionPL, setSessionPL] = useState(0);
  const [currentStake, setCurrentStake] = useState(1);
  const [sessionRemainingSec, setSessionRemainingSec] = useState(Math.floor(TARGET_DEADLINE_MS / 1000));
  const [runsUsedInWindow, setRunsUsedInWindow] = useState(0);
  /** Seconds until rolling quota window drops oldest placement; null when quota off or no placements counted yet. */
  const [quotaWindowRemainingSec, setQuotaWindowRemainingSec] = useState<number | null>(null);
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');
  const [showAnalysisDetails, setShowAnalysisDetails] = useState(true);
  const [tradeSoundsOn, setTradeSoundsOn] = useState(true);

  const runningRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const analyzerRef = useRef(new SafePatternAnalyzer());
  const execRef = useRef(new ExecutionModel());
  const analysisCyclesRef = useRef(0);
  const sessionStartRef = useRef<number | null>(null);
  const currentStakeRef = useRef(1);
  const placedTimestampsRef = useRef<number[]>([]);
  const tradeLogsRef = useRef<TradeLog[]>(tradeLogs);
  /** Avoid double-applying P/L when both `proposal_open_contract` and `transaction` fire. */
  const settledContractIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    tradeLogsRef.current = tradeLogs;
  }, [tradeLogs]);

  useEffect(() => {
    runningRef.current = isRunning;
  }, [isRunning]);
  useEffect(() => {
    currentStakeRef.current = currentStake;
  }, [currentStake]);

  const intervalMs = useMemo(() => (mode === 'target_1usd' ? 30_000 : 60_000), [mode]);

  const runsCapActive = typeof maxRunsPerPeriod === 'number' && maxRunsPerPeriod > 0;
  const periodMs = periodUnit === 'hour' ? 3600000 : 60000;
  const slotMs = runsCapActive ? Math.max(2000, Math.floor(periodMs / Math.max(1, Number(maxRunsPerPeriod)))) : intervalMs;

  const isStakeValid = typeof stake === 'number' && Number.isFinite(stake) && stake > 0;
  const isStopLossValid = typeof stopLoss === 'number' && Number.isFinite(stopLoss) && stopLoss > 0;
  const baseStake = useMemo(() => (typeof stake === 'number' && stake > 0 ? stake : 1), [stake]);

  const pruneAndCountPlacements = useCallback(() => {
    const now = Date.now();
    const cutoff = now - periodMs;
    placedTimestampsRef.current = placedTimestampsRef.current.filter(ts => ts > cutoff);
    const c = placedTimestampsRef.current.length;
    setRunsUsedInWindow(c);
    return c;
  }, [periodMs]);

  useEffect(() => {
    if (isRunning) {
      analysisCyclesRef.current = 0;
      sessionStartRef.current = Date.now();
      setSessionRemainingSec(Math.floor(TARGET_DEADLINE_MS / 1000));
      setSessionPL(0);
      setCurrentStake(baseStake);
      currentStakeRef.current = baseStake;
      placedTimestampsRef.current = [];
      setRunsUsedInWindow(0);
      setAnalysisSummary('Warming up analysis...');
      setAnalysisView(null);
    }
  }, [isRunning, baseStake]);

  const stopRunning = useCallback((reason: string) => {
    setIsRunning(false);
    runningRef.current = false;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setMessage(reason);
    setCountdownSec(0);
  }, []);

  const ensureTradingApiReady = useCallback(async () => {
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

  const fetchRecentTicks = useCallback(async () => {
    const liveApi = await ensureTradingApiReady();
    const resp = await liveApi.send({
      ticks_history: DEFAULT_SYMBOL,
      style: 'ticks',
      count: HISTORY_COUNT,
      end: 'latest',
    });
    const prices: number[] = (resp?.history?.prices || []).map(Number);
    const digits = prices.map(q => extractLastDigit(q, DEFAULT_SYMBOL)).filter((d): d is number => typeof d === 'number');
    return { prices, digits };
  }, [ensureTradingApiReady]);

  const getBalance = useCallback(async () => {
    const liveApi = await ensureTradingApiReady();
    const res = await liveApi.send({ balance: 1 });
    return Number(res?.balance?.balance || 0);
  }, [ensureTradingApiReady]);

  const applySettlement = useCallback(
    (cid: string, net: number, preferred?: 'won' | 'lost', retries = 5) => {
      const cidStr = String(cid);
      if (settledContractIdsRef.current.has(cidStr)) return;
      if (!Number.isFinite(net)) return;

      const row = tradeLogsRef.current.find(t => t.id === cidStr);
      if (!row) {
        if (retries > 0) window.setTimeout(() => applySettlement(cidStr, net, preferred, retries - 1), 400);
        return;
      }
      if (row.status === 'won' || row.status === 'lost') {
        settledContractIdsRef.current.add(cidStr);
        return;
      }

      settledContractIdsRef.current.add(cidStr);
      const resolvedStatus: TradeLog['status'] =
        preferred === 'won' || preferred === 'lost' ? preferred : net >= 0 ? 'won' : 'lost';

      setTradeLogs(prev =>
        prev.map(t => (t.id === cidStr ? { ...t, status: resolvedStatus, profit: net } : t))
      );

      if (tradeSoundsOn && (resolvedStatus === 'won' || resolvedStatus === 'lost')) {
        playTradeResultSound(resolvedStatus === 'won');
      }

      setSessionPL(pl => pl + net);
      if (net < 0) {
        const nextStake = Number((currentStakeRef.current * MARTINGALE_MULTIPLIER).toFixed(2));
        currentStakeRef.current = nextStake;
        setCurrentStake(nextStake);
      } else {
        currentStakeRef.current = baseStake;
        setCurrentStake(baseStake);
      }

      BALANCE_AFTER_SETTLE_DELAYS_MS.forEach(delayMs => {
        window.setTimeout(() => {
          void getBalance().then(bal => {
            if (!Number.isFinite(bal)) return;
            setTradeLogs(prev =>
              prev.map(t =>
                t.id === cidStr && (t.status === 'won' || t.status === 'lost') ? { ...t, balanceAfter: bal } : t
              )
            );
          });
        }, delayMs);
      });
    },
    [baseStake, getBalance, tradeSoundsOn]
  );

  const buyContract = useCallback(async (picked: PickedContract, amount: number) => {
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const needsBarrier =
      picked.contract_type === 'DIGITOVER' || picked.contract_type === 'DIGITUNDER';
    setTradeLogs(prev => [
      {
        id: tempId,
        contract_type: picked.contract_type,
        ...(needsBarrier && picked.barrier !== undefined ? { barrier: picked.barrier } : {}),
        stake: amount,
        status: 'pending',
        created_at: new Date(),
      },
      ...prev,
    ]);
    const liveApi = await ensureTradingApiReady();
    const resp = await liveApi.send({
      buy: 1,
      price: amount,
      parameters: {
        amount,
        basis: 'stake',
        currency: 'USD',
        contract_type: picked.contract_type,
        duration: 1,
        duration_unit: 't',
        symbol: DEFAULT_SYMBOL,
        ...(needsBarrier && picked.barrier !== undefined ? { barrier: String(picked.barrier) } : {}),
      },
    });
    if (resp?.error) throw new Error(resp.error?.message || 'Trade failed');
    const contractId = resp.buy.contract_id;
    const cidStr = String(contractId);
    setTradeLogs(prev => prev.map(t => (t.id === tempId ? { ...t, id: cidStr, status: 'placed' } : t)));

    void liveApi.send({
      proposal_open_contract: 1,
      contract_id: contractId,
      subscribe: 1,
    });

    setMessage(`Trade placed: ${labelContract(picked)} | stake $${amount.toFixed(2)} | edge ${(picked.edge * 100).toFixed(1)}%`);
    return true;
  }, [ensureTradingApiReady]);

  const runCycle = useCallback(async () => {
    if (!runningRef.current) return;
    let placed = false;
    let nextDelayMs = runsCapActive ? Math.min(intervalMs, slotMs) : intervalMs;
    try {
      const now = Date.now();
      if (!execRef.current.canExecute(now)) {
        const wait = Math.max(0, execRef.current.nextAllowedAt - now);
        setMessage(`Execution cooldown: ${Math.ceil(wait / 1000)}s`);
        return;
      }
      await ensureTradingApiReady();

      if (mode === 'target_1usd' && sessionStartRef.current) {
        const remainMs = Math.max(0, TARGET_DEADLINE_MS - (Date.now() - sessionStartRef.current));
        setSessionRemainingSec(Math.ceil(remainMs / 1000));
        if (remainMs <= 0) {
          stopRunning(
            sessionPL >= SESSION_TARGET ? 'Session finished: $1 target reached.' : 'Session finished: 5 minute deadline reached.'
          );
          return;
        }
      }
      if (mode === 'target_1usd' && sessionPL >= SESSION_TARGET) {
        stopRunning('Target reached: +$1 session profit.');
        return;
      }
      if (isStopLossValid && sessionPL <= -Number(stopLoss)) {
        stopRunning(`Stop loss hit: ${sessionPL.toFixed(2)}`);
        return;
      }

      if (runsCapActive) {
        const used = pruneAndCountPlacements();
        const cap = Number(maxRunsPerPeriod);
        if (used >= cap) {
          const oldest = placedTimestampsRef.current[0];
          const waitMs = oldest ? Math.max(500, oldest + periodMs - Date.now()) : 1000;
          setMessage(`Run quota reached (${cap}/${cap} per ${periodUnit}). Skipped — analysis-only until window resets.`);
          nextDelayMs = Math.min(waitMs, 15000);
          return;
        }
      }

      const { prices, digits } = await fetchRecentTicks();
      analyzerRef.current.feedTicks(prices, digits);
      const { picked: signal, topChoices } = analyzerRef.current.analyze(mode);
      analysisCyclesRef.current += 1;
      const recommendation = signal
        ? `${labelContract(signal)} (${signal.riskPct.toFixed(1)}% risk)`
        : 'No strong signal yet';
      setAnalysisView({
        sampleSize: digits.length,
        topChoices,
        lowStreak: analyzerRef.current.lowStreak,
        highStreak: analyzerRef.current.highStreak,
        recommendation,
      });
      setAnalysisSummary(`Cycle ${analysisCyclesRef.current} | Sample ${digits.length} | ${topChoices}`);

      if (tradeLogs.length === 0 && analysisCyclesRef.current < MIN_ANALYSIS_CYCLES_BEFORE_FIRST_TRADE) {
        setMessage(`Analyzing market... (${analysisCyclesRef.current}/${MIN_ANALYSIS_CYCLES_BEFORE_FIRST_TRADE})`);
        nextDelayMs = 1000;
        return;
      }
      if (!signal) {
        setMessage(`No clear edge (min ${(MIN_EDGE * 100).toFixed(0)}%). Run quota not consumed — waiting for setup.`);
        nextDelayMs = runsCapActive ? Math.min(4000, slotMs) : 1000;
        return;
      }

      let stakeToUse = currentStakeRef.current;
      const bal = await getBalance();
      if (stakeToUse > bal && bal > 0) {
        stakeToUse = baseStake;
        setCurrentStake(baseStake);
        currentStakeRef.current = baseStake;
        setMessage(`Martingale stake too high for balance, fallback to base stake $${baseStake.toFixed(2)}.`);
      }

      execRef.current.lock();
      placed = await buyContract(signal, stakeToUse);
      if (placed) {
        placedTimestampsRef.current.push(Date.now());
        pruneAndCountPlacements();
      }
    } catch (error: any) {
      setMessage(error?.message || 'Trade failed');
    } finally {
      const cooldownAfterPlace = runsCapActive ? Math.max(intervalMs, slotMs) : intervalMs;
      if (placed) {
        execRef.current.release(cooldownAfterPlace);
        setCountdownSec(Math.floor(cooldownAfterPlace / 1000));
      }
      if (!runningRef.current) return;
      if (!placed) setCountdownSec(Math.ceil(nextDelayMs / 1000));
      timerRef.current = window.setTimeout(() => runCycle(), nextDelayMs);
    }
  }, [
    intervalMs,
    slotMs,
    runsCapActive,
    periodMs,
    periodUnit,
    maxRunsPerPeriod,
    mode,
    sessionPL,
    isStopLossValid,
    stopLoss,
    fetchRecentTicks,
    tradeLogs.length,
    baseStake,
    getBalance,
    buyContract,
    stopRunning,
    pruneAndCountPlacements,
    ensureTradingApiReady,
  ]);

  useEffect(() => {
    let sub: { unsubscribe: () => void } | null = null;
    let cancelled = false;
    const start = async () => {
      try {
        const liveApi = await ensureTradingApiReady();
        if (cancelled) return;
        sub = liveApi.onMessage().subscribe(({ data }: any) => {
          if (!data || data.error) return;

          if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract) {
            const c = data.proposal_open_contract;
            const cid = String(c.contract_id);
            const st = String(c.status ?? '').toLowerCase();
            const finished =
              c.is_sold ||
              c.is_expired ||
              c.is_settleable ||
              st === 'sold' ||
              st === 'won' ||
              st === 'lost';
            if (!finished) return;

            const contractStatus = String(c.contract_status || c.status || '').toLowerCase();
            const preferred: 'won' | 'lost' | undefined =
              contractStatus === 'won' ? 'won' : contractStatus === 'lost' ? 'lost' : undefined;
            const net = Number(c.profit ?? 0);
            applySettlement(cid, net, preferred);
            return;
          }

          if (data.msg_type === 'transaction' && data.transaction?.action === 'sell') {
            const tx = data.transaction;
            const cid = String(tx.contract_id);
            const amt = Number(tx.amount);
            const row = tradeLogsRef.current.find(t => t.id === cid);
            if (!row) {
              window.setTimeout(() => {
                const r = tradeLogsRef.current.find(t => t.id === cid);
                if (!r || settledContractIdsRef.current.has(cid)) return;
                applySettlement(cid, amt - r.stake);
              }, 500);
              return;
            }
            applySettlement(cid, amt - row.stake);
          }
        });
      } catch {
        /* ignore transient init/socket failures */
      }
    };
    void start();
    return () => {
      cancelled = true;
      sub?.unsubscribe();
    };
  }, [applySettlement, ensureTradingApiReady]);

  useEffect(() => {
    if (!isRunning) {
      setCountdownSec(0);
      setQuotaWindowRemainingSec(null);
      return;
    }
    const tick = () => {
      setCountdownSec(prev => (prev > 0 ? prev - 1 : 0));
      if (mode === 'target_1usd' && sessionStartRef.current) {
        const remainMs = Math.max(0, TARGET_DEADLINE_MS - (Date.now() - sessionStartRef.current));
        setSessionRemainingSec(Math.ceil(remainMs / 1000));
      }
      if (runsCapActive) {
        pruneAndCountPlacements();
        const oldest = placedTimestampsRef.current[0];
        if (oldest !== undefined) {
          const sec = Math.max(0, Math.ceil((oldest + periodMs - Date.now()) / 1000));
          setQuotaWindowRemainingSec(sec);
        } else {
          setQuotaWindowRemainingSec(null);
        }
      } else {
        setQuotaWindowRemainingSec(null);
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isRunning, mode, runsCapActive, periodMs, pruneAndCountPlacements]);

  const filteredTradeLogs = useMemo(() => {
    if (orderFilter === 'all') return tradeLogs;
    if (orderFilter === 'open') return tradeLogs.filter(t => t.status === 'pending' || t.status === 'placed');
    return tradeLogs.filter(t => t.status === 'won' || t.status === 'lost' || t.status === 'error');
  }, [orderFilter, tradeLogs]);

  const statusTone = useMemo(() => {
    const m = message.toLowerCase();
    if (m.includes('failed') || m.includes('stop loss') || m.includes('deadline')) return 'error';
    if (m.includes('target reached') || m.includes('trade placed')) return 'success';
    return 'info';
  }, [message]);

  useEffect(() => {
    if (!isRunning) {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      return;
    }
    runCycle();
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [isRunning, runCycle]);

  return (
    <div className="p2p-safe">
      <header className="p2p-safe__page-header">
        <div className="p2p-safe__header">
        <div>
          <div className="p2p-safe__brand">
            <div className="p2p-safe__brand-badge">D</div>
            Denara Defender Engine
          </div>
        </div>
          <div className={`p2p-safe__state ${isRunning ? 'running' : 'idle'}`}>{isRunning ? 'Running' : 'Idle'}</div>
        </div>
      </header>

      <section className="p2p-safe__surface p2p-safe__surface--controls">
        <div className="p2p-safe__controls p2p-safe__controls--layout">
          <aside className="p2p-safe__mode-rail" aria-label="Mode selection">
            <div className="p2p-safe__mode-rail-title">Modes</div>
            <div className="p2p-safe__mode-list">
              {MODE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={`p2p-safe__mode-btn ${mode === option.value ? 'active' : ''}`}
                  disabled={isRunning}
                  onClick={() => setMode(option.value)}
                >
                  <span className="p2p-safe__mode-btn-title">{option.title}</span>
                  <small>{option.subtitle}</small>
                </button>
              ))}
            </div>
          </aside>

          <div className="p2p-safe__controls-grid">
            <div className="p2p-safe__field">
          <label>Max runs / period (optional)</label>
          <input
            type="number"
            min={1}
            step={1}
            placeholder="Unlimited"
            value={maxRunsPerPeriod === '' ? '' : String(maxRunsPerPeriod)}
            onChange={e => setMaxRunsPerPeriod(e.target.value === '' ? '' : Math.max(1, Math.floor(Number(e.target.value))))}
            disabled={isRunning}
          />
            </div>

            <div className="p2p-safe__field">
          <label>Period</label>
          <select value={periodUnit} onChange={e => setPeriodUnit(e.target.value as PeriodUnit)} disabled={isRunning || !runsCapActive}>
            <option value="minute">Per minute</option>
            <option value="hour">Per hour</option>
          </select>
            </div>

            <div className="p2p-safe__field">
          <label>Stake Input (USD)</label>
          <input
            type="number"
            min={0.35}
            step={0.01}
            value={stake === '' ? '' : String(stake)}
            onChange={e => setStake(e.target.value === '' ? '' : Number(e.target.value))}
            disabled={isRunning}
            className={!isStakeValid ? 'invalid' : ''}
          />
          {!isStakeValid && <small>Enter a valid stake before starting.</small>}
          <div className="p2p-safe__chips">
            {[0.35, 0.5, 1, 2].map(v => (
              <button key={v} type="button" className="p2p-safe__chip" disabled={isRunning} onClick={() => setStake(v)}>
                ${v}
              </button>
            ))}
          </div>
            </div>

            <div className="p2p-safe__field">
          <label>Stop Loss ($)</label>
          <input
            type="number"
            min={0.5}
            step={0.1}
            value={stopLoss === '' ? '' : String(stopLoss)}
            onChange={e => setStopLoss(e.target.value === '' ? '' : Number(e.target.value))}
            disabled={isRunning}
            className={!isStopLossValid ? 'invalid' : ''}
          />
          <div className="p2p-safe__chips">
            {[1, 2, 3, 5].map(v => (
              <button key={v} type="button" className="p2p-safe__chip" disabled={isRunning} onClick={() => setStopLoss(v)}>
                ${v}
              </button>
            ))}
          </div>
            </div>

            <button
          type="button"
          onClick={() => setIsRunning(prev => !prev)}
          disabled={!isRunning && (!isStakeValid || !isStopLossValid)}
          className={`p2p-safe__run ${isRunning ? 'stop' : 'start'}`}
            >
          {isRunning ? 'Stop' : 'Start'}
            </button>
          </div>
        </div>
      </section>

      <section className="p2p-safe__metrics">
        <div className="p2p-safe__metric">
          <span>Symbol</span>
          <b>{DEFAULT_SYMBOL}</b>
        </div>
        <div className="p2p-safe__metric">
          <span>Countdown</span>
          <b>{countdownSec}s</b>
        </div>
        <div className="p2p-safe__metric">
          <span>Session P/L</span>
          <b>
            {sessionPL >= 0 ? '+' : ''}
            {sessionPL.toFixed(2)}
          </b>
        </div>
        <div className="p2p-safe__metric">
          <span>Current Stake</span>
          <b>{currentStake.toFixed(2)}</b>
        </div>
        <div className="p2p-safe__metric">
          <span>Martingale</span>
          <b>x{MARTINGALE_MULTIPLIER.toFixed(2)}</b>
        </div>
        <div className="p2p-safe__metric">
          <span>5m Deadline</span>
          <b>{mode === 'target_1usd' ? `${sessionRemainingSec}s` : '—'}</b>
        </div>
        <div className="p2p-safe__metric">
          <span>Runs ({periodUnit})</span>
          <b>
            {runsCapActive ? `${runsUsedInWindow} / ${maxRunsPerPeriod}` : '—'}
          </b>
        </div>
        <div className="p2p-safe__metric">
          <span>Period ends in</span>
          <b>
            {!runsCapActive || !isRunning || quotaWindowRemainingSec === null
              ? '—'
              : formatQuotaWindowRemaining(quotaWindowRemainingSec)}
          </b>
        </div>
      </section>

      <section className={`p2p-safe__status p2p-safe__status--${statusTone}`}>
        <b>Status:</b> {message}
      </section>
      <section className="p2p-safe__status secondary">
        <b>Analysis:</b> {analysisSummary}
      </section>
      <div className="p2p-safe__row-actions">
        <button type="button" className="p2p-safe__chip" onClick={() => setShowAnalysisDetails(v => !v)}>
          {showAnalysisDetails ? 'Hide analysis details' : 'Show analysis details'}
        </button>
      </div>
      {analysisView && showAnalysisDetails && (
        <section className="p2p-safe__status secondary">
          <b>Live Analysis:</b> sample {analysisView.sampleSize} | low streak {analysisView.lowStreak} | high streak {analysisView.highStreak} | recommendation{' '}
          {analysisView.recommendation}
          <br />
          <b>Top choices:</b> {analysisView.topChoices}
        </section>
      )}

      <section className="p2p-safe__orders">
        <div className="p2p-safe__orders-head">
          <h4>Recent Orders</h4>
          <div className="p2p-safe__orders-head-actions">
            <label className="p2p-safe__sound-toggle">
              <input type="checkbox" checked={tradeSoundsOn} onChange={e => setTradeSoundsOn(e.target.checked)} />
              <span>Sounds</span>
            </label>
            <div className="p2p-safe__chips">
              <button type="button" className={`p2p-safe__chip ${orderFilter === 'all' ? 'active' : ''}`} onClick={() => setOrderFilter('all')}>
                All
              </button>
              <button type="button" className={`p2p-safe__chip ${orderFilter === 'open' ? 'active' : ''}`} onClick={() => setOrderFilter('open')}>
                Open
              </button>
              <button type="button" className={`p2p-safe__chip ${orderFilter === 'settled' ? 'active' : ''}`} onClick={() => setOrderFilter('settled')}>
                Settled
              </button>
            </div>
          </div>
        </div>
        {!filteredTradeLogs.length ? (
          <div className="p2p-safe__empty">No orders yet.</div>
        ) : (
          <div className="p2p-safe__order-list">
            {filteredTradeLogs.slice(0, 20).map(log => {
              const statusUpper = log.status.toUpperCase();
              return (
                <div key={log.id} className={`p2p-safe__order p2p-safe__order--${log.status}`}>
                  <div className="p2p-safe__order-row">
                    <div className="p2p-safe__order-contract">{labelContract(log)} | Stake ${log.stake.toFixed(2)}</div>
                    <div className={`p2p-safe__order-result p2p-safe__order-result--${log.status}`}>
                      <span className="p2p-safe__order-status">{statusUpper}</span>
                      {typeof log.profit === 'number' && (
                        <span className="p2p-safe__order-pl">
                          Result {log.profit >= 0 ? '+' : ''}
                          {log.profit.toFixed(2)}
                        </span>
                      )}
                      {typeof log.balanceAfter === 'number' && (
                        <span className="p2p-safe__order-bal">Bal ${log.balanceAfter.toFixed(2)}</span>
                      )}
                      {log.error ? <span className="p2p-safe__order-err">{log.error}</span> : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default P2PSafeTrader;
