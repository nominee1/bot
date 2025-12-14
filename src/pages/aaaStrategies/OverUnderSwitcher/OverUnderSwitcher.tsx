import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { api_base } from '@/external/bot-skeleton';
import {
  TradeTypesDigitsOverIcon,
  TradeTypesDigitsUnderIcon,
  LegacyPlayFillIcon,
  MarketDerivedVolatility1001sIcon,
  MarketDerivedVolatility100Icon,
  SocialYoutubeBlackIcon,
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
import LazyYouTubeModal from '../LazyYoutubeModal/LazyYouTubeModal';

import './OverUnderSwitcher.scss';

type StrategyType = 'over' | 'under';
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
  'DIGITOVER': <TradeTypesDigitsOverIcon width={16} height={16} />,
  'DIGITUNDER': <TradeTypesDigitsUnderIcon width={16} height={16} />,
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

// parse helpers that treat '' as 0 (so inputs can be cleared visually)
const toNum = (s: string, fallback = 0) => {
  if (s === '' || s === undefined || s === null) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
};

export default function OverUnderSwitcher() {
  /* ===== Inputs (string-based so they can be cleared) ===== */
  const [isRunning, setIsRunning] = useState(false);
  const [market, setMarket] = useState('JD50');

  const [stakeStr, setStakeStr] = useState('10');
  const [martingaleStr, setMartingaleStr] = useState('1.25');
  const [strategy, setStrategy] = useState<StrategyType>('over'); // over/under
  const [paramStr, setParamStr] = useState('4');                  // barrier digit 0..9
  const [ticksStr, setTicksStr] = useState('1');

  const [tpStr, setTpStr] = useState('0'); // visible empty -> '', effective 0
  const [slStr, setSlStr] = useState('0');

  const [switchEveryStr, setSwitchEveryStr] = useState('2');

  const stakeInput = toNum(stakeStr, 0);
  const martingaleInput = toNum(martingaleStr, 0);
  const param = Math.max(0, Math.min(9, Math.trunc(toNum(paramStr, 0))));
  const ticks = Math.max(1, Math.min(2, Math.trunc(toNum(ticksStr, 1))));
  const tpInput = Math.max(0, Math.trunc(toNum(tpStr, 0)));
  const slInput = Math.max(0, Math.trunc(toNum(slStr, 0)));
  const switchEvery = Math.max(1, Math.min(7, Math.trunc(toNum(switchEveryStr, 2))));

  const [ytOpen, setYtOpen] = useState(false);
  const YT_URL = 'https://youtu.be/sOH92GU0XPE?si=aEGtwX9aBT6U8vtM';

  /* ===== Trades & status ===== */
  const [trades, setTrades] = useState<TTrade[]>([]);
  const [msg, setMsg] = useState<{ txt: string; type: 'info' | 'success' | 'error' | 'loading' | 'warning' }>({ txt: '', type: 'info' });
  const [profitLoss, setPL] = useState(0);
  const [sessionPL, setSessionPL] = useState(0);

  /* ===== Tick stream & FSM ===== */
  const wsRef = useRef<WebSocket | null>(null);
  const lastEpochRef = useRef<number | null>(null);
  const awaitingNextTickRef = useRef(false);
  const entryPriceRef = useRef<number | null>(null); // not used by over/under, kept for structure
  const ladderRef = useRef<number[]>([]);
  const stakeIndexRef = useRef(0);
  const nextStakeRef = useRef(2);

  // count losses since last switch to trigger switching every N loss progressions
  const lossesSinceSwitchRef = useRef(0);

  // guard to prevent stray post-TP/SL buy
  const stopRequestedRef = useRef(false);

  /* ===== Instant running flag (prevents race) ===== */
  const isRunningRef = useRef(false);
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);

  /* ===== Locked runtime config ===== */
  const locked = useRef({
    S: 2, M: 2, strat: 'over' as StrategyType, param: 4,
    market: '1HZ10V', ticks: 1, tp: 0, sl: 0,
    switchEvery: 2,
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
    const isBalanceError =
      code === 'InsufficientBalance' ||
      /insufficient|balance|fund|not enough|no enough|low balance/i.test(message);
    return { isBalanceError, message };
  }, []);

  const contractFor = useCallback((st: StrategyType) => (st === 'over' ? 'DIGITOVER' : 'DIGITUNDER'), []);

  /* ===== HARD STOP ===== */
  const hardStop = useCallback((reason: 'tp' | 'sl' | 'manual') => {
    stopRequestedRef.current = true;
    isRunningRef.current = false;
    setIsRunning(false);
    awaitingNextTickRef.current = false;
    entryPriceRef.current = null;
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { }
      wsRef.current = null;
    }
    if (reason === 'manual') setStatus('Bot stopped', 'info');
  }, [setStatus]);

  /* ===== Session P/L apply + TP/SL enforce (immediate) ===== */
  const applyPnLAndMaybeStop = useCallback((delta: number) => {
    setSessionPL(prev => {
      const next = Number((prev + delta).toFixed(2));
      const { tp, sl } = locked.current;
      if (tp > 0 && next >= tp) {
        stopRequestedRef.current = true; // guard
        // ❌ remove TP GIF:
        // setGif({ show: true, url: '...', label: 'tp' });
        setStatus(`🎉 Take Profit hit: +$${next.toFixed(2)} (session)`, 'success');
        hardStop('tp');
        // ❌ and remove hideGifLater() here
      }
      return next;
    });
  }, [hardStop, hideGifLater, setStatus]);

  const buyContract = useCallback(async (stake: number) => {
    if (!isRunningRef.current || stopRequestedRef.current) return;
    const ct = contractFor(locked.current.strat);
    const mkt = locked.current.market;
    const dur = locked.current.ticks;
    const barrier = String(locked.current.param); // keep same digit when switching

    const tmpID = createTempTrade(ct, stake, mkt, dur);
    try {
      const resp = await api_base.api.send({
        buy: 1, price: stake,
        parameters: {
          amount: stake, basis: 'stake', currency: 'USD',
          contract_type: ct, duration: dur, duration_unit: 't', symbol: mkt,
          barrier
        }
      });
      if (resp?.error) throw resp;
      if (stopRequestedRef.current) return;

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

  /* ===== POC / TX ===== */
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
          if (finished && tr.profit === undefined) {
            const net = Number(c.profit ?? 0);
            tr.status = net >= 0 ? 'won' : 'lost';
            tr.profit = net;
            tr.closeTime = new Date();
            tr.exitValue = c.exit_tick ? Number(c.exit_tick) : undefined;
            // apply to session P/L now (prevents extra buy after TP/SL)
            applyPnLAndMaybeStop(net);
          } else if (!finished) {
            tr.status = (c.status as TradeStatus) || 'active';
          }
          return { ...tr };
        }));
      }

      if (data?.msg_type === 'transaction' && data.transaction?.action === 'sell') {
        const tx: TTransaction = data.transaction;
        setTrades(prev => prev.map(tr => {
          if (tr.id !== tx.contract_id) return tr;
          if (tr.profit === undefined) {
            const net = Number(tx.amount) - tr.stake;
            tr.status = net >= 0 ? 'won' : 'lost';
            tr.profit = net;
            tr.closeTime = new Date(tx.transaction_time * 1000);
          }
          return { ...tr };
        }));
      }
    });
    return () => sub.unsubscribe();
  }, [applyPnLAndMaybeStop]);

  /* ===== Aggregate P/L for visible list ===== */
  useEffect(() => {
    setPL(trades.reduce((s, t) => s + (t.profit ?? 0), 0));
  }, [trades]);

  /* ===== Loss evaluator: Over/Under only ===== */
  const evalIsLoss = useCallback((lastDigit: number) => {
    const st = locked.current.strat;
    const barrier = locked.current.param;
    if (st === 'over') {
      // predict lastDigit > barrier → loss when lastDigit <= barrier (0..barrier)
      return lastDigit <= barrier;
    }
    // st === 'under': predict lastDigit < barrier → loss when lastDigit >= barrier (barrier..9)
    return lastDigit >= barrier;
  }, []);

  /* ===== Price → last digit by market decimals ===== */
  const getLastDigit = useCallback((price: number, mkt: string) => {
    let s: string;
    if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(mkt)) s = price.toFixed(3);
    else if (['R_50', 'R_75'].includes(mkt)) s = price.toFixed(4);
    else s = price.toFixed(2);
    return parseInt(s.slice(-1), 10);
  }, []);

  /* ===== Main tick loop ===== */
  useEffect(() => {
    if (!isRunning) {
      if (wsRef.current) { try { wsRef.current.close(); } catch { } wsRef.current = null; }
      return;
    }

    stopRequestedRef.current = false; // clear on start

    const app_id = 1089;
    const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isRunningRef.current) return;
      ws.send(JSON.stringify({ ticks: locked.current.market, subscribe: 1 }));
    };

    ws.onmessage = async (ev) => {
      if (!isRunningRef.current || stopRequestedRef.current) return;
      const d = JSON.parse(ev.data);
      if (d?.error) { console.error('Tick stream error:', d.error?.message); return; }
      if (!d?.tick?.quote || !d?.tick?.epoch) return;

      const price = Number(d.tick.quote);
      const epoch = Number(d.tick.epoch);
      if (lastEpochRef.current === epoch) return;
      lastEpochRef.current = epoch;

      const lastDigit = getLastDigit(price, locked.current.market);

      // evaluate previous result → adjust stake & possibly switch
      if (isRunningRef.current && awaitingNextTickRef.current) {
        const loss = evalIsLoss(lastDigit);
        if (loss) {
          stakeIndexRef.current = Math.min(7, stakeIndexRef.current + 1);
          lossesSinceSwitchRef.current += 1;

          const N = Math.max(1, Math.min(7, locked.current.switchEvery));
          if (lossesSinceSwitchRef.current >= N) {
            locked.current.strat = (locked.current.strat === 'over') ? 'under' : 'over';
            lossesSinceSwitchRef.current = 0;
            setStatus(`↔️ Switched to ${locked.current.strat.toUpperCase()} (barrier ${locked.current.param}) after ${N} loss step(s)`, 'info');
          }
        } else {
          stakeIndexRef.current = 0;
          lossesSinceSwitchRef.current = 0;
        }

        nextStakeRef.current = ladderRef.current[stakeIndexRef.current];
        awaitingNextTickRef.current = false;
        entryPriceRef.current = null;
      }

      // guard just before buy
      if (!isRunningRef.current || stopRequestedRef.current) return;

      await buyContract(nextStakeRef.current);
      if (!isRunningRef.current || stopRequestedRef.current) return;

      awaitingNextTickRef.current = true;
      entryPriceRef.current = price;
    };

    ws.onerror = (e) => console.error('Tick ws error', e);
    ws.onclose = () => { };
    return () => { try { ws.close(); } catch { } };
  }, [isRunning, buyContract, evalIsLoss, getLastDigit]);

  /* ===== Start / Stop ===== */
  const startBot = useCallback(() => {
    // guard impossible barriers
    if (strategy === 'over' && param === 9) { setStatus('Over 9 never resets (unwinnable). Choose ≤ 8.', 'warning'); return; }
    if (strategy === 'under' && param === 0) { setStatus('Under 0 never resets (unwinnable). Choose ≥ 1.', 'warning'); return; }

    const N = switchEvery;

    locked.current = {
      S: stakeInput,
      M: martingaleInput,
      strat: strategy,
      param,
      market,
      ticks,
      tp: Math.max(0, tpInput),
      sl: Math.max(0, slInput),
      switchEvery: N,
    };
    ladderRef.current = buildLadder(locked.current.S, locked.current.M);
    stakeIndexRef.current = 0;
    nextStakeRef.current = ladderRef.current[0];
    awaitingNextTickRef.current = false;
    entryPriceRef.current = null;
    lossesSinceSwitchRef.current = 0;
    stopRequestedRef.current = false;
    setSessionPL(0);

    isRunningRef.current = true;
    setIsRunning(true);
    setStatus(`Bot started (strategy: ${strategy.toUpperCase()} ${param}, switch every ${N} loss step${N > 1 ? 's' : ''})`, 'success');
  }, [strategy, param, market, ticks, stakeInput, martingaleInput, tpInput, slInput, switchEvery, buildLadder, setStatus]);

  const stopBot = useCallback(() => { hardStop('manual'); }, [hardStop]);

  /* ===== Reset (only when stopped) ===== */
  const handleReset = useCallback(() => {
    if (isRunningRef.current) return;
    setTrades([]);
    setPL(0);
    setSessionPL(0);
    stakeIndexRef.current = 0;
    ladderRef.current = buildLadder(stakeInput, martingaleInput);
    nextStakeRef.current = ladderRef.current[0];
    lossesSinceSwitchRef.current = 0;
    stopRequestedRef.current = false;
    setStatus('History cleared', 'info');
  }, [buildLadder, stakeInput, martingaleInput, setStatus]);

  /* ===== Derived stats ===== */
  const tradeStats = useMemo(() => {
    const completed = trades.filter(t => t.status === 'won' || t.status === 'lost');
    return { total: completed.length, won: completed.filter(t => t.status === 'won').length, lost: completed.filter(t => t.status === 'lost').length };
  }, [trades]);

  return (
    <div className="over-under">
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

      <div className="history-title">
        <div className="eve">
          <TradeTypesDigitsOverIcon width={18} height={18} />
          Over | Under Switch On Loss
          <TradeTypesDigitsUnderIcon width={16} height={16} />
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
            <select
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              disabled={isRunning}
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
            <label>Stake</label>
            <input
              type="number"
              className="trade-input"
              value={stakeStr}
              onChange={(e) => setStakeStr(e.target.value)}
              min={0.01}
              step={0.01}
              disabled={isRunning}
              placeholder="0"
            />
          </div>

          <div className="trade-control-group">
            <label>Martingale</label>
            <input
              type="number"
              className="trade-input"
              value={martingaleStr}
              onChange={(e) => setMartingaleStr(e.target.value)}
              min={0}
              step={0.01}
              disabled={isRunning}
              placeholder="0"
            />
          </div>

          <div className="trade-control-group">
            <label>Strategy</label>
            <select
              className="trade-input"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as StrategyType)}
              disabled={isRunning}
            >
              <option value="over">Over</option>
              <option value="under">Under</option>
            </select>
          </div>

          <div className="trade-control-group">
            <label>Prediction (digit)</label>
            <input
              type="number"
              className="trade-input"
              value={paramStr}
              onChange={(e) => setParamStr(e.target.value)}
              min={0}
              max={9}
              disabled={isRunning}
              placeholder="0"
            />
          </div>

          {/* Switch-after-N-loss-progressions */}
          <div className="trade-control-group">
            <label>Switch after (loss steps)</label>
            <input
              type="number"
              className="trade-input"
              value={switchEveryStr}
              onChange={(e) => setSwitchEveryStr(e.target.value)}
              min={1}
              max={7}
              disabled={isRunning}
              placeholder="2"
            />
          </div>

          {/* Take Profit / Stop Loss (clearable) */}
          <div className="trade-control-group">
            <label>Take Profit</label>
            <input
              type="number"
              className="trade-input"
              value={tpStr}
              onChange={(e) => setTpStr(e.target.value)}
              min={0}
              step={1}
              disabled={isRunning}
              placeholder="0"
            />
          </div>

          <div className="trade-control-group">
            <label>Stop Loss</label>
            <input
              type="number"
              className="trade-input"
              value={slStr}
              onChange={(e) => setSlStr(e.target.value)}
              min={0}
              step={1}
              disabled={isRunning}
              placeholder="0"
            />
          </div>

          <div className="trade-control-group">
            <label>Ticks</label>
            <select
              className="trade-input"
              value={ticksStr}
              onChange={(e) => setTicksStr(e.target.value)}
              disabled={isRunning}
            >
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </div>

          <div className="trade-control-group">
            <label
              className="start"
              style={{
                display: 'flex',
                alignItems: 'center',
                fontWeight: 'bold',
                fontSize: '15px',
                gap: '4px',
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
          {isRunning && <span style={{ marginLeft: 10 }}>🔁 1 buy/tick · Switch every {locked.current.switchEvery} loss step(s)</span>}
        </div>
        <div style={{ marginTop: 6 }}>
          Losses: <b>{stakeIndexRef.current}</b>/7 · Next stake: <b>${nextStakeRef.current.toFixed(2)}</b> ·
          Current: <b style={{ marginLeft: 6 }}>{locked.current.strat.toUpperCase()} {locked.current.param}</b> ·
          Losses since switch: <b>{lossesSinceSwitchRef.current}</b> ·
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
