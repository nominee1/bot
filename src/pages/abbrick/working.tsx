// IframeEvenOdd.tsx — Even/Odd analysis + continuous smart-trading
// Reverse toggle, TP/SL, and "Continue trading locked signal" mode
// Uses MultiStrategyBot classnames for positions & performance stats.

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { api_base } from '@/external/bot-skeleton';
import './IframeEvenOdd.scss';

import {
  TradeTypesDigitsEvenIcon,
  TradeTypesDigitsOddIcon,
  TradeTypesUpsAndDownsRiseIcon,
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
} from '@deriv/quill-icons';

type TAnalysisItem = { digit: number; price: number; timestamp: Date };
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

const FIXED3 = ['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'];
const FIXED4 = ['R_50', 'R_75'];

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
  DIGITEVEN: <TradeTypesDigitsEvenIcon width={16} height={16} />,
  DIGITODD: <TradeTypesDigitsOddIcon width={16} height={16} />,
  CALL: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
  PUT: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />
};

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

const formatTickValue = (v?: number, mf?: string) => {
  if (v === undefined) return '—';
  if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(mf || '')) return v.toFixed(3);
  if (['R_50', 'R_75'].includes(mf || '')) return v.toFixed(4);
  return v.toFixed(2);
};

// Initial defaults are only for first render; after that we track user's last valid stake in a ref.
const DEFAULTS = { stake: 2, mg: 1.75, tp: 5, sl: 50 };

const IframeEvenOdd = observer(() => {
  const { ui } = useStore();

  // ───── Analysis state ─────
  const [filterCount, setFilterCount] = useState<number | ''>(100);
  const [currentSymbol, setCurrentSymbol] = useState<string>('1HZ10V');
  const [threshold, setThreshold] = useState<number | ''>(55);
  const [analysisData, setAnalysisData] = useState<{
    lastResults: TAnalysisItem[];
    lastDigit: number | null;
    lastPrice: number | null;
    currentMarket: string;
  }>({ lastResults: [], lastDigit: null, lastPrice: null, currentMarket: '1HZ10V' });

  // ───── Smart trade inputs/state ─────
  const [autoTradeOn, setAutoTradeOn] = useState(false);
  const [reverseSignal, setReverseSignal] = useState(false);

  const [stakeInput, setStakeInput] = useState<number | ''>(DEFAULTS.stake);
  const [ticksInput, setTicksInput] = useState<number | ''>(1);
  const [mgInput, setMgInput] = useState<number | ''>(DEFAULTS.mg);
  const [signalHoldSec, setSignalHoldSec] = useState<number | ''>('');
  const [takeProfit, setTakeProfit] = useState<number | ''>(DEFAULTS.tp);
  const [stopLoss, setStopLoss] = useState<number | ''>(DEFAULTS.sl);

  const [continueLocked, setContinueLocked] = useState(false);
  const lockedSignalRef = useRef<'even' | 'odd' | null>(null);

  const [status, setStatus] = useState<string>('');

  // ───── Persistent base stake (prevents fallback to DEFAULTS after first valid change) ─────
  const baseStakeRef = useRef<number>(typeof DEFAULTS.stake === 'number' ? DEFAULTS.stake : 2);
  useEffect(() => {
    if (typeof stakeInput === 'number' && stakeInput > 0) {
      baseStakeRef.current = stakeInput;
    }
  }, [stakeInput]);

  // ───── MG runtime ─────
  const mgCurrentRef = useRef<number | null>(null);
  const mgStepRef = useRef<number>(0);

  // ───── P/L and risk ─────
  const [sessionPL, setSessionPL] = useState(0);
  const sessionPLRef = useRef(0);
  const tpRef = useRef<number | ''>(takeProfit);
  const slRef = useRef<number | ''>(stopLoss);
  useEffect(() => { tpRef.current = takeProfit; }, [takeProfit]);
  useEffect(() => { slRef.current = stopLoss; }, [stopLoss]);

  const riskHit = (plAfter: number) => {
    const tp = tpRef.current;
    const sl = slRef.current;
    if (typeof tp === 'number' && tp > 0 && plAfter >= tp) return { hit: true as const, reason: 'take_profit' as const };
    if (typeof sl === 'number' && sl > 0 && -plAfter >= sl) return { hit: true as const, reason: 'stop_loss' as const };
    return { hit: false as const, reason: null as null };
  };

  const stopSmartTradesHard = (reason?: 'take_profit' | 'stop_loss') => {
    setAutoTradeOn(false);
    inFlightRef.current = false;
    openContractIdRef.current = null;
    if (afterSettleTimerRef.current) { clearTimeout(afterSettleTimerRef.current); afterSettleTimerRef.current = null; }
    // reset MG runtime (preserve inputs & use last valid base stake)
    mgCurrentRef.current = baseStakeRef.current;
    mgStepRef.current = 0;
    // clear locks
    lastSignalRef.current = null;
    activeSignalRef.current = null;
    lockedSignalRef.current = null;
    setStatus(reason
      ? `⛔ ${reason === 'take_profit' ? 'Take Profit reached' : 'Stop Loss hit'}. Trading stopped.`
      : 'Smart Trade stopped');
  };

  // ───── Positions state ─────
  const [trades, setTrades] = useState<TTrade[]>([]);
  const stakesByIdRef = useRef<Record<string, number>>({});
  const settledContractsRef = useRef<Set<string>>(new Set());

  // ───── Execution/locks ─────
  const openContractIdRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  // ───── Signal persistence ─────
  const signalSinceRef = useRef<number | null>(null);
  const lastSignalRef = useRef<'even' | 'odd' | null>(null);
  const activeSignalRef = useRef<'even' | 'odd' | null>(null);

  // ───── Misc refs ─────
  const marketSelectionRef = useRef<HTMLSelectElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();
  const transactionsSubbedRef = useRef(false);
  const afterSettleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const autoTradeOnRef = useRef(autoTradeOn);
  useEffect(() => { autoTradeOnRef.current = autoTradeOn; }, [autoTradeOn]);

  const signalHoldSecRef = useRef<number | ''>(signalHoldSec);
  useEffect(() => { signalHoldSecRef.current = signalHoldSec; }, [signalHoldSec]);

  const decideSignalForBuy = (sig: 'even' | 'odd' | null): 'even' | 'odd' | null =>
    reverseSignal ? (sig === 'even' ? 'odd' : sig === 'odd' ? 'even' : null) : sig;

  const hasHeldLongEnough = () => {
    const hs = typeof signalHoldSecRef.current === 'number' ? signalHoldSecRef.current : 0;
    const since = signalSinceRef.current;
    if (!since) return false;
    return (Date.now() - since) >= Math.max(0, hs * 1000);
  };

  // ───── Deriv connection guard ─────
  const ensureApiReady = useCallback(async () => {
    const OPEN = 1 as const;
    if (!api_base.api || api_base.api.connection.readyState !== OPEN) {
      await api_base.init(true);
    }
    if (!transactionsSubbedRef.current) {
      try { await api_base.api.send({ transactions: 1, subscribe: 1 }); transactionsSubbedRef.current = true; } catch {}
    }
  }, []);

  // ───── Ticks → digits ─────
  const formatTickToLastDigit = (val: number, market: string) => {
    let tickString: string;
    if (FIXED3.includes(market)) tickString = val.toFixed(3);
    else if (FIXED4.includes(market)) tickString = val.toFixed(4);
    else tickString = val.toFixed(2);
    return parseInt(tickString.slice(-1));
  };

  const pushTick = (price: number, market: string) => {
    const lastDigit = formatTickToLastDigit(price, market);
    setAnalysisData(prev => ({
      ...prev,
      lastResults: [{ digit: lastDigit, price, timestamp: new Date() }, ...prev.lastResults].slice(0, 1000),
      lastDigit, lastPrice: price, currentMarket: market,
    }));
  };

  const handleTick = (val: number) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const market = marketSelectionRef.current?.value || currentSymbol;
    debounceTimer.current = setTimeout(() => pushTick(val, market), 50);
  };

  const refreshData = () => {
    if (!wsRef.current || !marketSelectionRef.current) return;
    const newMarket = marketSelectionRef.current.value;
    setCurrentSymbol(newMarket);
    setAnalysisData({ lastResults: [], lastDigit: null, lastPrice: null, currentMarket: newMarket });
    wsRef.current.send(JSON.stringify({
      ticks_history: newMarket, style: 'ticks', count: 5000, end: 'latest', subscribe: 1,
    }));
  };

  // ───── Parity stats (windowed) ─────
  const { total, evenCount, oddCount, evenPct, oddPct } = useMemo(() => {
    const windowN = typeof filterCount === 'number' ? Math.min(1000, Math.max(1, filterCount)) : 100;
    const windowed = analysisData.lastResults.slice(0, windowN);
    const total = windowed.length;
    let evenCount = 0;
    for (let i = 0; i < total; i++) if ((windowed[i].digit % 2) === 0) evenCount++;
    const oddCount = total - evenCount;
    const evenPct = total > 0 ? (evenCount / total) * 100 : 0;
    const oddPct  = total > 0 ? (oddCount  / total) * 100 : 0;
    return { total, evenCount, oddCount, evenPct, oddPct };
  }, [analysisData.lastResults, filterCount]);

  const thr = typeof threshold === 'number' ? threshold : 65;
  const evenHit = evenPct >= thr;
  const oddHit  = oddPct  >= thr;

  const activeSignal: 'even' | 'odd' | null =
    evenHit && oddHit ? (evenPct >= oddPct ? 'even' : 'odd')
    : evenHit ? 'even'
    : oddHit ? 'odd'
    : null;

  activeSignalRef.current = activeSignal;

  // ───── Create temp row before buy returns ─────
  const createTempTrade = useCallback((ct: string, stake: number, mkt: string, dur: number) => {
    const id = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const t: TTrade = {
      id, contractType: ct, stake, market: mkt, duration: dur,
      status: 'pending', timestamp: new Date(), marketFormat: mkt, temp: true
    };
    setTrades(prev => [t, ...prev]);
    return id;
  }, []);

  // ───── Validate inputs & seed MG base ─────
  const ensureStakeAndDuration = () => {
    // Prefer the live input if valid; otherwise fall back to the last valid base stake (ref).
    const uiStake = (typeof stakeInput === 'number' && stakeInput > 0) ? stakeInput : baseStakeRef.current;
    const base = Number(uiStake);
    const dur  = typeof ticksInput === 'number' ? ticksInput : NaN;

    if (!Number.isFinite(base) || base <= 0) { setStatus('Enter a valid Stake'); return null; }
    if (!Number.isFinite(dur)  || dur < 1)   { setStatus('Enter a valid Duration (ticks)'); return null; }
    const mgx = (typeof mgInput === 'number' && mgInput > 1) ? mgInput : 1;

    // If this is the very first time (runtime not seeded), seed from persistent base
    if (mgCurrentRef.current == null) mgCurrentRef.current = baseStakeRef.current;

    return { base, dur, mgx };
  };

  // ───── BUY (guarded + with temp row + streams) ─────
  const placeTrade = async (sig: 'even' | 'odd') => {
    if (inFlightRef.current || openContractIdRef.current) return;
    const need = ensureStakeAndDuration();
    if (!need) return;

    await ensureApiReady();

    const { base, dur } = need;
    // Always use current MG runtime stake; if missing, use persistent base
    const runtimeStake = mgCurrentRef.current ?? baseStakeRef.current ?? base;
    const stake = Math.max(0.01, Number(runtimeStake.toFixed(2)));

    const ct = sig === 'even' ? 'DIGITEVEN' : 'DIGITODD';
    const symbol = marketSelectionRef.current?.value || currentSymbol;

    const tmpId = createTempTrade(ct, stake, symbol, dur);
    try {
      inFlightRef.current = true;
      setStatus(`Placing ${sig.toUpperCase()} @ ${symbol} (${stake.toFixed(2)} / ${dur}t)…`);

      const resp = await api_base.api.send({
        buy: 1,
        price: stake,
        parameters: { amount: stake, basis: 'stake', currency: 'USD', contract_type: ct, duration: dur, duration_unit: 't', symbol }
      });
      if (resp?.error) throw resp.error;

      const realId = String(resp.buy.contract_id);
      stakesByIdRef.current[realId] = stake;
      openContractIdRef.current = realId;

      setTrades(ts => ts.map(t => t.id === tmpId ? ({ ...t, id: realId, temp: false, status: 'open' }) : t));
      await api_base.api.send({ proposal_open_contract: 1, contract_id: realId, subscribe: 1 });

      setStatus(`Trade opened: ${sig.toUpperCase()} (${realId})`);
    } catch (e: any) {
      const message = e?.message || 'Trade failed';
      setStatus(message);
      setTrades(ts => ts.map(t => t.id === tmpId ? ({
        ...t, status: 'error', temp: false,
        errorReason: /balance|fund/i.test(message) ? 'Insufficient balance' : 'Trade failed',
        errorDetails: message, closeTime: new Date()
      }) : t));
      inFlightRef.current = false;
      openContractIdRef.current = null;
    }
  };

  // ───── Settlement: MG update + risk + auto-continue ─────
  const applySettlement = useCallback((_cid: string, net: number) => {
    const need = ensureStakeAndDuration();
    if (!need) return;
    const { mgx } = need;

    // Update session P/L & risk
    setSessionPL(prev => {
      const next = prev + net;
      sessionPLRef.current = next;
      const guard = riskHit(next);
      if (guard.hit) stopSmartTradesHard(guard.reason!);
      return next;
    });

    // MG updates — ALWAYS reference the persistent base stake
    const base = baseStakeRef.current;

    if (net >= 0) {
      mgCurrentRef.current = base; // reset to user's last valid base stake
      mgStepRef.current = 0;
      setStatus(`Result: WIN ${net.toFixed(2)} — MG reset to ${base.toFixed(2)}`);
    } else {
      const current = mgCurrentRef.current ?? base;
      const next = Number((current * (mgx || 1)).toFixed(2));
      // Never drop below the user's base
      mgCurrentRef.current = Math.max(next, base);
      mgStepRef.current += (mgx && mgx > 1) ? 1 : 0;
      setStatus(`Result: LOSS ${net.toFixed(2)} — MG→ ${mgCurrentRef.current.toFixed(2)} (step ${mgStepRef.current})`);
    }

    openContractIdRef.current = null;
    inFlightRef.current = false;

    if (!autoTradeOnRef.current) return;

    // Schedule next buy
    if (afterSettleTimerRef.current) { clearTimeout(afterSettleTimerRef.current); afterSettleTimerRef.current = null; }
    afterSettleTimerRef.current = setTimeout(() => {
      if (!autoTradeOnRef.current || inFlightRef.current || openContractIdRef.current) return;

      if (continueLocked) {
        if (!(typeof tpRef.current === 'number' && tpRef.current > 0)) {
          setStatus('Set a Take Profit to use locked signal mode.');
          return;
        }
        const locked = lockedSignalRef.current;
        if (locked) {
          placeTrade(locked);
        }
        return;
      }

      const sig = decideSignalForBuy(activeSignalRef.current);
      if (sig && hasHeldLongEnough()) placeTrade(sig);
    }, 120);
  }, [continueLocked]);

  // ───── WS handler (contracts/transactions) ─────
  useEffect(() => {
    const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
      if (data?.error) return;

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
          const idStr = String(c.contract_id);
          if (!settledContractsRef.current.has(idStr)) {
            settledContractsRef.current.add(idStr);
            const net = Number(c.profit ?? 0);
            applySettlement(idStr, net);
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
          return { ...tr, status: net >= 0 ? 'won' : 'lost', profit: net, closeTime: new Date(tx.transaction_time * 1000) };
        }));

        if (!settledContractsRef.current.has(cid)) {
          settledContractsRef.current.add(cid);
          const stake = stakesByIdRef.current[cid] ?? 0;
          const net = Number(tx.amount) - stake;
          applySettlement(cid, net);
        }
      }
    });
    return () => sub.unsubscribe();
  }, [applySettlement]);

  // ───── Signal persistence & initial scheduler / locking ─────
  useEffect(() => {
    const now = Date.now();
    const current = activeSignal;

    if (current !== lastSignalRef.current) {
      lastSignalRef.current = current;
      signalSinceRef.current = current ? now : null;
    }

    if (!autoTradeOn) {
      if (afterSettleTimerRef.current) { clearTimeout(afterSettleTimerRef.current); afterSettleTimerRef.current = null; }
      return;
    }

    if (continueLocked && !lockedSignalRef.current) {
      if (!(typeof tpRef.current === 'number' && tpRef.current > 0)) {
        setStatus('Set a Take Profit to use locked signal mode.');
        return;
      }
      if (current && hasHeldLongEnough() && !inFlightRef.current && !openContractIdRef.current) {
        const sigForBuy = decideSignalForBuy(current);
        if (sigForBuy) {
          lockedSignalRef.current = sigForBuy;
          placeTrade(sigForBuy);
        }
      }
      return;
    }

    if (!continueLocked && current && hasHeldLongEnough() && !inFlightRef.current && !openContractIdRef.current) {
      const sig = decideSignalForBuy(current);
      if (sig) placeTrade(sig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisData.lastResults.length, activeSignal, autoTradeOn, signalHoldSec, reverseSignal, continueLocked]);

  // ───── WS (ticks) ─────
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
      setAnalysisData({ lastResults: [], lastDigit: null, lastPrice: null, currentMarket: currentSymbol });
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
      if (afterSettleTimerRef.current) { clearTimeout(afterSettleTimerRef.current); afterSettleTimerRef.current = null; }
    };
  }, [currentSymbol]);

  // ───── Panel actions: ON seeds from persistent base ─────
  const handleToggleRun = () => {
    if (!autoTradeOn) {
      const need = ensureStakeAndDuration();
      if (!need) return;
      // Always seed MG runtime from the last known valid base stake
      mgCurrentRef.current = baseStakeRef.current;
      mgStepRef.current = 0;
    }
    setAutoTradeOn(v => !v);
    setStatus(!autoTradeOn ? 'Smart Trade: ON' : 'Smart Trade: OFF');
  };

  // Totals / stats
  const profitLoss = useMemo(() => trades.reduce((s, t) => s + (t.profit ?? 0), 0), [trades]);
  const tradeStats = useMemo(() => {
    const completed = trades.filter(t => t.status === 'won' || t.status === 'lost');
    return {
      total: completed.length,
      won: completed.filter(t => t.status === 'won').length,
      lost: completed.filter(t => t.status === 'lost').length,
    };
  }, [trades]);

  // ───── Render ─────
  return (
    <div className="even-oddt" style={{ background: ui.is_dark_mode_on ? 'var(--general-main-1)' : 'transparent' }}>
      {/* Header */}
      <div className="eo-header">
        <div className="eo-title">Even / Odd Analysis + Smart Trade
        <small>Buys even or odd when the percentage is hit</small>
        </div>
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
            setAnalysisData({ lastResults: [], lastDigit: null, lastPrice: null, currentMarket: newMarket });
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                ticks_history: newMarket, style: 'ticks', count: 5000, end: 'latest', subscribe: 1,
              }));
            }
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
          <option value="JD10">Jump 10</option>
          <option value="JD25">Jump 25</option>
          <option value="JD50">Jump 50</option>
          <option value="JD75">Jump 75</option>
          <option value="JD100">Jump 100</option>
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
              if (v === '') return setFilterCount('');
              const n = Number(v);
              const clamped = Math.max(1, Math.min(1000, Number.isFinite(n) ? n : 100));
              setFilterCount(clamped);
            }}
            min={1}
            max={1000}
            step={1}
          />
          <span>ticks</span>
        </div>

        <div className="current-tick">
          <div><strong>Current Tick:</strong> {analysisData.lastPrice ?? '—'}</div>
          <div><strong>Last Digit:</strong> {analysisData.lastDigit ?? '—'}</div>
        </div>

        <div className="threshold">
          <label>Signal Threshold (%)</label>
          <input
            type="number"
            className="trade-input"
            value={threshold === '' ? '' : String(threshold)}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') return setThreshold('');
              const n = Number(v);
              setThreshold(Math.max(1, Math.min(99, Number.isFinite(n) ? n : 65)));
            }}
            min={1}
            max={99}
            step={1}
          />
        </div>
      </div>

      {/* Smart Trade Panel */}
      <div className="smart-trade-panel">
        <div className="panel-row">
          <div className="panel-field">
            <label>Stake ($)</label>
            <input
              type="number"
              className="trade-input"
              value={stakeInput === '' ? '' : String(stakeInput)}
              onChange={(e) => setStakeInput(e.target.value === '' ? '' : Number(e.target.value))}
              min={0.01}
              step={0.01}
            />
          </div>

          <div className="panel-field">
            <label>Duration (ticks)</label>
            <input
              type="number"
              className="trade-input"
              value={ticksInput === '' ? '' : String(ticksInput)}
              onChange={(e) => setTicksInput(e.target.value === '' ? '' : Number(e.target.value))}
              min={1}
              step={1}
            />
          </div>

          <div className="panel-field">
            <label>Martingale ×</label>
            <input
              type="number"
              className="trade-input"
              value={mgInput === '' ? '' : String(mgInput)}
              onChange={(e) => setMgInput(e.target.value === '' ? '' : Number(e.target.value))}
              min={1}
              step={0.01}
              placeholder="1 = off"
              title=">1 enables martingale; blank or 1 = off"
            />
          </div>

          <div className="panel-field">
            <label>Signal Hold (sec)</label>
            <input
              type="number"
              className="trade-input"
              value={signalHoldSec === '' ? '' : String(signalHoldSec)}
              onChange={(e) => setSignalHoldSec(e.target.value === '' ? '' : Number(e.target.value))}
              min={0}
              step={1}
              placeholder="0 = immediate"
              title="How long the signal must persist before buying"
            />
          </div>

          <div className="panel-field">
            <label>Take Profit ($)</label>
            <input
              type="number"
              className="trade-input"
              min={0}
              step={0.01}
              value={takeProfit === '' ? '' : String(takeProfit)}
              onChange={(e) => setTakeProfit(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
              title="Stop trading when session P/L reaches this profit"
            />
          </div>

          <div className="panel-field">
            <label>Stop Loss ($)</label>
            <input
              type="number"
              className="trade-input"
              min={0}
              step={0.01}
              value={stopLoss === '' ? '' : String(stopLoss)}
              onChange={(e) => setStopLoss(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
              title="Stop trading when session P/L drawdown reaches this loss"
            />
          </div>

          <div className="panel-field">
            <label>Reverse Signal</label>
            <button
              type="button"
              className={`strat-btn ${reverseSignal ? 'active' : ''}`}
              onClick={() => setReverseSignal(v => !v)}
              title="When ON: buy the opposite of the active signal"
              style={{ minHeight: 36 }}
            >
              {reverseSignal ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="panel-field">
            <label>Trading locked</label>
            <button
              type="button"
              className={`strat-btn ${continueLocked ? 'active' : ''}`}
              onClick={() => {
                const next = !continueLocked;
                setContinueLocked(next);
                if (!next) {
                  lockedSignalRef.current = null;
                  setStatus('Locked signal: OFF');
                } else {
                  setStatus('Locked signal: waiting for first qualifying signal… (requires TP)');
                }
              }}
              title="Locks to the first qualifying signal and keeps trading it even if the live signal drops. Requires TP."
              style={{ minHeight: 36 }}
            >
              {continueLocked ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="panel-actions">
            <button
              className={`trade-btn ${autoTradeOn ? 'odd-btn' : 'even-btn'}`}
              onClick={handleToggleRun}
            >
              {autoTradeOn ? 'Run: ON' : 'Run: OFF'}
            </button>

            <button
              className="trade-btn stop-btn"
              onClick={() => stopSmartTradesHard()}
            >
              Stop Smart Trades
            </button>
          </div>
        </div>

        <div className="panel-status">
          <span><b>Market:</b> {marketSelectionRef.current?.value || currentSymbol}</span>
          <span>·</span>
          <span><b>Active:</b> {activeSignal ?? '—'} {activeSignal ? `(≥${thr}%)` : ''}</span>
          <span>·</span>
          <span><b>Reverse:</b> {reverseSignal ? 'on' : 'off'}</span>
          <span>·</span>
          <span>
            <b>MG stake:</b>{' '}
            {mgCurrentRef.current != null ? mgCurrentRef.current.toFixed(2) : '—'}
            {mgInput && typeof mgInput === 'number' && mgInput > 1 ? ` (step ${mgStepRef.current})` : ' (off)'}
          </span>
          <span>·</span>
          <span><b>Session P/L:</b> {sessionPL >= 0 ? '+' : ''}{sessionPL.toFixed(2)}</span>
          {typeof takeProfit === 'number' && takeProfit > 0 && <><span>·</span><span><b>TP:</b> {takeProfit.toFixed(2)}</span></>}
          {typeof stopLoss === 'number' && stopLoss > 0 && <><span>·</span><span><b>SL:</b> {stopLoss.toFixed(2)}</span></>}
          {continueLocked && <><span>·</span><span><b>Locked:</b> {lockedSignalRef.current ?? 'pending'}</span></>}
        </div>
        <div className="panel-status">{status && <><span>💰</span><span className="panel-status-msg">{status}</span></>}</div>
      </div>

      {/* Signals Row */}
      <div className="signals-row eo-signals">
        <div className={`signals-box ${evenHit ? 'active' : ''}`}>
          <div className="signals-title">Even Signal</div>
          <div className="signals-badges">
            <span className={`badge ${evenHit ? 'badge-green' : ''}`}>
              {evenPct.toFixed(1)}% (≥ {thr}%)
            </span>
          </div>
          <div className="signals-note"><strong>Even Count:</strong> {evenCount}/{total}</div>
        </div>

        <div className={`signals-box ${oddHit ? 'active' : ''}`}>
          <div className="signals-title">Odd Signal</div>
          <div className="signals-badges">
            <span className={`badge ${oddHit ? 'badge-green' : ''}`}>
              {oddPct.toFixed(1)}% (≥ {thr}%)
            </span>
          </div>
          <div className="signals-note"><strong>Odd Count:</strong> {oddCount}/{total}</div>
        </div>
      </div>

      {/* Positions / Trade History */}
      <div className="title"><small>Type|Market</small><small>Entry|Exit spot</small><small>Buy price & P/L</small></div>
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

      {/* Reset history (preserve inputs) */}
      <div className="trade-control-group" style={{ marginTop: 10 }}>
        <label>&nbsp;</label>
        <button
          className="trade-btn reset-btn"
          onClick={() => {
            setTrades([]);
            setSessionPL(0);
            sessionPLRef.current = 0;
            settledContractsRef.current.clear();
            openContractIdRef.current = null;
            stakesByIdRef.current = {};
            inFlightRef.current = false;

            // Reset MG runtime using the persistent base stake, not defaults
            mgCurrentRef.current = baseStakeRef.current;
            mgStepRef.current = 0;

            // Clear any locks & timers
            lastSignalRef.current = null;
            activeSignalRef.current = null;
            lockedSignalRef.current = null;
            if (afterSettleTimerRef.current) { clearTimeout(afterSettleTimerRef.current); afterSettleTimerRef.current = null; }

            setStatus('History cleared (inputs preserved)');
          }}
          title="Clear results; keep your current inputs"
        >
          Reset
        </button>
      </div>

      {/* Performance Stats */}
      <div className="performance-stats">
        <div className="stat-item">
          <div className="stat-title">Total P/L</div>
          <div className={`stat-value ${profitLoss >= 0 ? 'profit' : 'loss'}`}>
            {profitLoss >= 0 ? '+' : '−'}${Math.abs(profitLoss).toFixed(2)} USD
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

      {/* Analysis Chamber */}
      <div className="history-container">
        <div className="history-title">
          Analysis Chamber
          <button className="refresh-btn" id="refreshBtn" onClick={refreshData}>
            <i className="fas fa-sync-alt"></i> Refresh
          </button>
        </div>
        <div className="history-items">
          {analysisData.lastResults.slice(0,
            typeof filterCount === 'number' ? Math.min(1000, filterCount) : 100
          ).map((result, index) => {
            const style: React.CSSProperties = {
              backgroundColor: result.digit % 2 === 0 ? '#2ecc71' : '#e74c3c',
              color: 'white',
            };
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

export default IframeEvenOdd;
