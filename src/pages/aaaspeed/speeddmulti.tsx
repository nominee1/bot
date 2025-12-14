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


import './Speed.scss';

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

export default function MultiStrategyBot() {
  /* ===== Inputs ===== */
  const [isRunning, setIsRunning] = useState(false);
  const [market, setMarket] = useState('JD50');
  const [stakeInput, setStakeInput] = useState(10);
  const [martingaleInput, setMartingaleInput] = useState(1.25);
  const [strategy, setStrategy] = useState<StrategyType>('over');
  const [param, setParam] = useState(2);
  const [ticks, setTicks] = useState(1);
  const [tpInput, setTpInput] = useState<number>(500000);
  const [slInput, setSlInput] = useState<number>(100000);

  const [ytOpen, setYtOpen] = useState(false);
  const YT_URL = "https://youtu.be/lJZO89NS78Q?si=Z_jJLcS1uTTXmNA6";

  /* ===== Trades & status ===== */
  const [trades, setTrades] = useState<TTrade[]>([]);
  const [msg, setMsg] = useState<{ txt: string; type: 'info' | 'success' | 'error' | 'loading' | 'warning' }>({ txt: '', type: 'info' });
  const [profitLoss, setPL] = useState(0);       // total P/L (from visible trades)
  const [sessionPL, setSessionPL] = useState(0); // session P/L (resets on start & reset)

  /* ===== Tick stream & FSM ===== */
  const wsRef = useRef<WebSocket | null>(null);
  const lastEpochRef = useRef<number | null>(null);
  const awaitingNextTickRef = useRef(false);
  const entryPriceRef = useRef<number | null>(null);
  const ladderRef = useRef<number[]>([]);
  const stakeIndexRef = useRef(0);
  const nextStakeRef = useRef(2);

  /* ===== Instant running flag (prevents race) ===== */
  const isRunningRef = useRef(false);
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);

  /* ===== Locked runtime config ===== */
  const locked = useRef({
    S: 2, M: 2, strat: 'even' as StrategyType, param: 4,
    market: '1HZ10V', ticks: 1, tp: 0, sl: 0
  });

  /* ===== GIF overlay ===== */
  const [gif, setGif] = useState<{ show: boolean; url: string; label: 'tp' | 'sl' | null }>({ show: false, url: '', label: null });
  const hideGifLater = useCallback(() => {
    setTimeout(() => setGif(g => ({ ...g, show: false })), 4000);
  }, []);

  const setStatus = useCallback((txt: string, type: 'info' | 'success' | 'error' | 'loading' | 'warning' = 'info') => setMsg({ txt, type }), []);

  const buildLadder = useCallback((S: number, M: number) => {
    const arr: number[] = [];
    for (let k = 0; k <= 7; k++) arr.push(Number((S * Math.pow(M, k)).toFixed(2)));
    return arr;
  }, []);

  const createTempTrade = useCallback((ct: string, stake: number, mkt: string, dur: number) => {
    const id = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const t: TTrade = { id, contractType: ct, stake, market: mkt, duration: dur, status: 'pending', timestamp: new Date(), marketFormat: mkt, temp: true };
    setTrades(prev => [t, ...prev]);
    return id;
  }, []);

  const getBalanceError = useCallback((e: any) => {
    const errorObj = e?.error ?? e;
    const message = (errorObj?.message || 'Unknown error').toString();
    const code = errorObj?.code || '';
    const isBalanceError = code === 'InsufficientBalance' || /insufficient|balance|fund|not enough|no enough|low balance/i.test(message);
    return { isBalanceError, message };
  }, []);

  const contractFor = useCallback((st: StrategyType) => {
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
  }, []);

  /* ===== HARD STOP: instant shutdown (TP/SL/manual) ===== */
  const hardStop = useCallback((reason: 'tp' | 'sl' | 'manual') => {
    // flip ref immediately so tick loop sees it this tick
    isRunningRef.current = false;
    // stop state
    setIsRunning(false);
    // clear pending one-tick evaluation
    awaitingNextTickRef.current = false;
    entryPriceRef.current = null;
    // close stream now
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { }
      wsRef.current = null;
    }
    if (reason === 'manual') setStatus('Bot stopped', 'info');
  }, [setStatus]);

  const buyContract = useCallback(async (stake: number) => {
    if (!isRunningRef.current) return; // guard against races
    const ct = contractFor(locked.current.strat);
    const mkt = locked.current.market;
    const dur = locked.current.ticks;
    const needsBarrier = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(ct);
    const barrier = (locked.current.strat === 'over' || locked.current.strat === 'under' || locked.current.strat === 'matches' || locked.current.strat === 'differs')
      ? String(locked.current.param) : undefined;

    const tmpID = createTempTrade(ct, stake, mkt, dur);
    try {
      const resp = await api_base.api.send({
        buy: 1, price: stake,
        parameters: {
          amount: stake, basis: 'stake', currency: 'USD',
          contract_type: ct, duration: dur, duration_unit: 't', symbol: mkt,
          ...(needsBarrier ? { barrier } : {})
        }
      });
      if (resp?.error) throw resp;
      const realID = resp.buy.contract_id;
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
      return;
    }
  }, [contractFor, createTempTrade, getBalanceError, setStatus]);

  /* ===== POC / TX → update UI + session P/L + TP/SL ===== */
  useEffect(() => {
    const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
      if (data?.error) { console.error('WS error', data.error); return; }

      if (data?.msg_type === 'proposal_open_contract') {
        const c = data.proposal_open_contract;
        setTrades(prev => prev.map(tr => {
          if (tr.id !== c.contract_id) return tr;
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
      }

      if (data?.msg_type === 'transaction' && data.transaction?.action === 'sell') {
        const tx: TTransaction = data.transaction;
        setTrades(prev => prev.map(tr => {
          if (tr.id !== tx.contract_id) return tr;
          const net = Number(tx.amount) - tr.stake;
          tr.status = net >= 0 ? 'won' : 'lost';
          tr.profit = net;
          tr.closeTime = new Date(tx.transaction_time * 1000);
          return { ...tr };
        }));

        const tradeStake = trades.find(t => t.id === data.transaction?.contract_id)?.stake ?? 0;
        const tr_net = Number(tx.amount) - tradeStake;

        // setSessionPL(s => {
        //   const next = Number((s + tr_net).toFixed(2));
        //   const { tp, sl } = locked.current;
        //   if (isRunningRef.current) {
        //     if (tp > 0 && next >= tp) {
        //       // TP reached → show happy, hard stop NOW
        //       setGif({
        //         show: true,
        //         url: 'https://media.giphy.com/media/v1.Y2lkPWVjZjA1ZTQ3eWk5aG1pbmZ6OHN4enlhY2U0cGgyZG1xZ2hyajIzNXEyMHd3ZzJjOCZlcD12MV9naWZzX3JlbGF0ZWQmY3Q9Zw/6g8XtfomGPqjS/giphy.gif',
        //         label: 'tp'
        //       });
        //       setStatus(`🎉 Take Profit hit: +$${next.toFixed(2)} (session)`, 'success');
        //       hardStop('tp');
        //       hideGifLater();
        //     } else if (sl > 0 && -next >= sl) {
        //       // SL reached → show sad, hard stop NOW
        //       setGif({
        //         show: true,
        //         url: 'https://media.giphy.com/media/v1.Y2lkPWVjZjA1ZTQ3c3EwMGtqZ2tlOW13dWFpZTU0ZjV1YXFobnFhdWE4aGNrc2hjdncyNiZlcD12MV9naWZzX3JlbGF0ZWQmY3Q9Zw/h1MhVdwd8HirC/giphy.gif',
        //         label: 'sl'
        //       });
        //       setStatus(`🛑 Stop Loss hit: -$${Math.abs(next).toFixed(2)} (session)`, 'error');
        //       hardStop('sl');
        //       hideGifLater();
        //     }
        //   }
        //   return next;
        // });
      }
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardStop, trades.length]);

  /* ===== Aggregate P/L for visible list ===== */
  useEffect(() => {
    setPL(trades.reduce((s, t) => s + (t.profit ?? 0), 0));
  }, [trades]);

  /* ===== Strategy loss logic (evaluate on next tick) ===== */
  const evalIsLoss = useCallback((lastDigit: number, price: number) => {
    const st = locked.current.strat;
    switch (st) {
      case 'even': return (lastDigit % 2) !== 0;
      case 'odd': return (lastDigit % 2) === 0;
      case 'over': return lastDigit <= locked.current.param; // 0..T loss
      case 'under': return lastDigit >= locked.current.param; // T..9 loss
      case 'matches': return lastDigit !== locked.current.param;
      case 'differs': return lastDigit === locked.current.param;
      case 'rise': return entryPriceRef.current !== null ? price <= entryPriceRef.current : false; // '=' loss
      case 'fall': return entryPriceRef.current !== null ? price >= entryPriceRef.current : false; // '=' loss
    }
  }, []);

  /* ===== Price → last digit using correct decimals ===== */
  const getLastDigit = useCallback((price: number, mkt: string) => {
    let s: string;
    if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(mkt)) s = price.toFixed(3);
    else if (['R_50', 'R_75'].includes(mkt)) s = price.toFixed(4);
    else s = price.toFixed(2);
    return parseInt(s.slice(-1), 10);
  }, []);

  /* ===== Main tick loop (only when running) ===== */
  useEffect(() => {
    // If not running, ensure stream is closed and bail.
    if (!isRunning) {
      if (wsRef.current) { try { wsRef.current.close(); } catch { } wsRef.current = null; }
      return;
    }

    const app_id = 1089;
    const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isRunningRef.current) return;
      ws.send(JSON.stringify({ ticks: locked.current.market, subscribe: 1 }));
    };

    ws.onmessage = async (ev) => {
      if (!isRunningRef.current) return;
      const d = JSON.parse(ev.data);
      if (d?.error) { console.error('Tick stream error:', d.error?.message); return; }
      if (!d?.tick?.quote || !d?.tick?.epoch) return;

      const price = Number(d.tick.quote);
      const epoch = Number(d.tick.epoch);
      if (lastEpochRef.current === epoch) return;
      lastEpochRef.current = epoch;

      const lastDigit = getLastDigit(price, locked.current.market);

      // Evaluate previous result → set next stake
      if (isRunningRef.current && awaitingNextTickRef.current) {
        const loss = evalIsLoss(lastDigit, price);
        stakeIndexRef.current = loss ? Math.min(7, stakeIndexRef.current + 1) : 0;
        nextStakeRef.current = ladderRef.current[stakeIndexRef.current];
        awaitingNextTickRef.current = false;
        entryPriceRef.current = null;
      }

      // Place new buy on this tick
      if (isRunningRef.current) {
        await buyContract(nextStakeRef.current);
        if (!isRunningRef.current) return; // if hardStop happened during await
        awaitingNextTickRef.current = true;
        entryPriceRef.current = price; // for rise/fall
      }
    };

    ws.onerror = (e) => console.error('Tick ws error', e);
    ws.onclose = () => { };
    return () => { try { ws.close(); } catch { } };
  }, [isRunning, buyContract, evalIsLoss, getLastDigit]);

  /* ===== Start / Stop ===== */
  const startBot = useCallback(() => {
    if (strategy === 'over' && param === 9) { setStatus('Over 9 never resets (unwinnable). Choose ≤ 8.', 'warning'); return; }
    if (strategy === 'under' && param === 0) { setStatus('Under 0 never resets (unwinnable). Choose ≥ 1.', 'warning'); return; }

    locked.current = {
      S: stakeInput, M: martingaleInput, strat: strategy, param, market, ticks,
      tp: Math.max(0, Number(tpInput || 0)), sl: Math.max(0, Number(slInput || 0))
    };
    ladderRef.current = buildLadder(locked.current.S, locked.current.M);
    stakeIndexRef.current = 0;
    nextStakeRef.current = ladderRef.current[0];
    awaitingNextTickRef.current = false;
    entryPriceRef.current = null;
    setSessionPL(0);

    isRunningRef.current = true;      // set ref first
    setIsRunning(true);               // then state (UI)
    setStatus('Bot started', 'success');
  }, [stakeInput, martingaleInput, strategy, param, market, ticks, tpInput, slInput, buildLadder, setStatus]);

  const stopBot = useCallback(() => {
    hardStop('manual');
  }, [hardStop]);

  /* ===== Reset (only when stopped) ===== */
  const handleReset = useCallback(() => {
    if (isRunningRef.current) return;
    setTrades([]);
    setPL(0);
    setSessionPL(0);
    // re-prime ladder index & next stake to base for next run
    stakeIndexRef.current = 0;
    ladderRef.current = buildLadder(stakeInput, martingaleInput);
    nextStakeRef.current = ladderRef.current[0];
    setStatus('History cleared', 'info');
  }, [buildLadder, stakeInput, martingaleInput, setStatus]);

  /* ===== Derived stats ===== */
  const tradeStats = useMemo(() => {
    const completed = trades.filter(t => t.status === 'won' || t.status === 'lost');
    return { total: completed.length, won: completed.filter(t => t.status === 'won').length, lost: completed.filter(t => t.status === 'lost').length };
  }, [trades]);

  return (
    <div className="speed-apppt">
      {/* GIF overlay */}
      {gif.show && (
        <div className="gif-overlay">
          <div className="gif-container">
            <img className="gif-animation" src={gif.url} alt={gif.label || 'status'} />
            <div className={`gif-message ${gif.label === 'tp' ? 'profit-message' : 'loss-message'}`}>
              {gif.label === 'tp' ? 'Take Profit reached ✅' : 'Stop Loss reached 🛑'}
            </div>
          </div>
        </div>
      )}

      <div className="history-title"><div className='eve'><TradeTypesDigitsEvenIcon width={18} height={18} />
        Speed Bot V1 | Buys Every Tick
        <TradeTypesDigitsOddIcon width={16} height={16} />
      </div>
        <div
          className="youtube"
          role="button"
          tabIndex={0}
          aria-label="Play tutorial video"
          onClick={() => setYtOpen(true)}
          onKeyDown={(e) => {
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

        <LazyYouTubeModal
          videoUrl={YT_URL}
          isOpen={ytOpen}
          onClose={() => setYtOpen(false)}
        />
        <div className="trade-controls">
          <div className="trade-control-group market-selector">
            <label>Market</label>
            <select value={market} onChange={(e) => setMarket(e.target.value)} disabled={isRunning} className="trade-input">
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
            <input type="number" className="trade-input" value={stakeInput}
              onChange={(e) => setStakeInput(parseFloat(e.target.value || '0'))}
              min={0.01} step={0.01} disabled={isRunning} />
          </div>

          <div className="trade-control-group">
            <label>Martingale</label>
            <input type="number" className="trade-input" value={martingaleInput}
              onChange={(e) => setMartingaleInput(parseFloat(e.target.value || '0'))}
              min={0} step={0.01} disabled={isRunning} />
          </div>

          <div className="trade-control-group">
            <label>Strategy</label>
            <select className="trade-input" value={strategy} onChange={(e) => setStrategy(e.target.value as StrategyType)} disabled={isRunning}>
              <option value="even">Even</option>
              <option value="odd">Odd</option>
              <option value="over">Over</option>
              <option value="under">Under</option>
              <option value="matches">Matches</option>
              <option value="differs">Differs</option>
            </select>
          </div>

          {(strategy === 'over' || strategy === 'under' || strategy === 'matches' || strategy === 'differs') && (
            <div className="trade-control-group">
              <label>{strategy === 'over' || strategy === 'under' ? 'Prediction' : 'Digit'}</label>
              <input type="number" className="trade-input" value={param}
                onChange={(e) => setParam(Math.max(0, Math.min(9, parseInt(e.target.value || '0', 10))))}
                min={0} max={9} disabled={isRunning} />
            </div>
          )}

          {/* <div className="trade-control-group">
            <label>Take Profit</label>
            <input type="number" className="trade-input" value={tpInput}
                   onChange={(e)=>setTpInput(parseFloat(e.target.value||'0'))}
                   min={0} step={1} disabled={isRunning} placeholder="0 to disable"/>
          </div> */}

          {/* <div className="trade-control-group">
            <label>Stop Loss</label>
            <input type="number" className="trade-input" value={slInput}
                   onChange={(e)=>setSlInput(parseFloat(e.target.value||'0'))}
                   min={0} step={1} disabled={isRunning} placeholder="0 to disable"/>
          </div> */}

          <div className="trade-control-group">
            <label>Ticks</label>
            <select className="trade-input" value={ticks} onChange={(e) => setTicks(parseInt(e.target.value, 10))} disabled={isRunning}>
              <option value={1}>1</option><option value={2}>2</option>

            </select>
          </div>

          <div className="trade-control-group">
            <label
              className="start"
              style={{
                display: 'flex',
                alignItems: 'center',
                fontWeight: 'bold',
                fontSize: '15px', // matches icon height
                gap: '4px',       // space between icon and text
                cursor: 'pointer'
              }}
            >
              <LegacyPlayFillIcon width={20} height={20} /> Run
            </label>

            <button
              className={`auto-trade-toggle ${isRunning ? 'on' : 'off'}`}
              onClick={isRunning ? () => stopBot() : () => startBot()}
              style={{
                padding: '.8rem .12rem',
                background: isRunning ? 'linear-gradient(90deg,#4285F4,#34a853)' : '#E6A85C',
                color: '#fff', border: '1px solid #222',
                justifyContent: 'center', display: 'flex', borderRadius: '4px', fontWeight: 'bold'
              }}
              title="One buy per tick; Don't Miss a beat!"
            >
              {isRunning ? 'ON' : 'OFF'}
            </button>
          </div>


        </div>

        <div className="title"><small>Type|Market</small><small>Entry|Exit spot</small><small>Buy price & P/L</small></div>

        <div className="open-positions">
          {trades.length === 0 ? (
            <div className="no-positions"><small>No positions</small></div>
          ) : trades.map(tr => (
            <div key={tr.id} className={`position-item ${tr.status === 'won' ? 'position-win' : tr.status === 'lost' || tr.status === 'error' ? 'position-loss' : 'position-open'}`}>
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
                <div className={`position-result ${tr.status === 'pending' ? 'pending' :
                  tr.status === 'error' ? 'loss' :
                    tr.profit !== undefined ? (tr.profit >= 0 ? 'profit' : 'loss') : ''
                  }`}>
                  {tr.status === 'pending' ? '...' :
                    tr.profit !== undefined ? `${tr.profit >= 0 ? '+' : ''}${tr.profit.toFixed(2)}` : '—'}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Reset (only when stopped) */}
        {!isRunning && (
          <div className="trade-control-group">
            <label>&nbsp;</label>
            <button
              className="trade-btn reset-btn"
              onClick={handleReset}
              title="Clear results and P/L"
            >
              Reset
            </button>
          </div>
        )}
      </div>

      <div className="trade-status">
        <div>
          {msg.txt}
          {isRunning && <span style={{ marginLeft: 10 }}>🔁 1 buy/tick | stake set by next-tick outcome</span>}
        </div>
        <div style={{ marginTop: 6 }}>
          Losses: <b>{stakeIndexRef.current}</b>/7 · Next stake: <b>${nextStakeRef.current.toFixed(2)}</b> ·
          Session P/L: <b style={{ marginLeft: 6 }}>{sessionPL >= 0 ? '+' : ''}${Math.abs(sessionPL).toFixed(2)}</b>
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
