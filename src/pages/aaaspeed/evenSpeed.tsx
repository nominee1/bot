import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { api_base } from '@/external/bot-skeleton';
import {
  TradeTypesDigitsEvenIcon,
  MarketDerivedVolatility1001sIcon,
  MarketDerivedVolatility100Icon,
  MarketDerivedVolatility10Icon,
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
  MarketDerivedJump10Icon,
  MarketDerivedJump25Icon,
  MarketDerivedJump50Icon,
  MarketDerivedJump75Icon,
  MarketDerivedJump100Icon,
} from '@deriv/quill-icons';
import './Speed.scss';

type TradeStatus = 'pending' | 'open' | 'active' | 'won' | 'lost' | 'completed' | 'error';

interface TTrade {
  id: string;
  contractType: 'DIGITEVEN';
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
type TTransaction = { contract_id: string; amount: number; transaction_time: number; };

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
const contractIcon = <TradeTypesDigitsEvenIcon width={16} height={16} />;

const formatTickValue = (v?: number, mf?: string) => {
  if (v === undefined) return '—';
  if (['R_10','R_25','1HZ15V','1HZ30V','1HZ90V'].includes(mf||'')) return v.toFixed(3);
  if (['R_50','R_75'].includes(mf||'')) return v.toFixed(4);
  return v.toFixed(2);
};

const Speed = observer(() => {
  const { ui } = useStore();

  const [trades, setTrades] = useState<TTrade[]>([]);
  const [profitLoss, setPL] = useState(0);
  const [msg, setMsg] = useState<{ txt: string; type: 'info'|'success'|'error'|'loading'|'warning' }>({ txt:'', type:'info' });

  const [currentSymbol, setCurrentSymbol] = useState('1HZ10V');
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);

  const marketRef = useRef<HTMLSelectElement>(null);
  const stakeInputRef = useRef<HTMLInputElement>(null);
  const martingaleInputRef = useRef<HTMLInputElement>(null);
  const durRef = useRef<HTMLSelectElement>(null);

  const wsRef = useRef<WebSocket|null>(null);
  const lastEpochRef = useRef<number|null>(null);

  // Ladder + FSM
  const ladderRef = useRef<number[]>([]);          // S * M^k for k=0..7
  const stakeIndexRef = useRef(0);                 // 0..7
  const nextStakeRef = useRef(2);                  // stake used for the next BUY
  const hasBoughtOnceRef = useRef(false);          // first tick special-case
  const pendingParityRef = useRef(false);          // true after we buy, until we see the very next tick

  const setStatus = useCallback((txt:string, type: 'info'|'success'|'error'|'loading'|'warning'='info') => setMsg({txt,type}), []);

  const playSound = useCallback((ok:boolean) => {
    try { const a = new Audio(ok ? '/sounds/success.mp3' : '/sounds/fail.mp3'); a.volume=.5; a.play().catch(()=>{}); } catch {}
  }, []);

  const lockLadder = useCallback(() => {
    const S = Math.max(0.01, Number(parseFloat(stakeInputRef.current?.value || '2').toFixed(2)));
    const M = Math.max(0, Number(parseFloat(martingaleInputRef.current?.value || '2')));
    const arr:number[] = [];
    for (let k=0;k<=7;k++) arr.push(Number((S*Math.pow(M,k)).toFixed(2)));
    ladderRef.current = arr;
    stakeIndexRef.current = 0;
    nextStakeRef.current = arr[0];
    hasBoughtOnceRef.current = false;     // reset FSM
    pendingParityRef.current = false;
  }, []);

  const createTempTrade = useCallback((stake:number, market:string, dur:number) => {
    const id = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const t: TTrade = {
      id, contractType:'DIGITEVEN', stake, market, duration:dur,
      status:'pending', timestamp:new Date(), marketFormat:market, temp:true
    };
    setTrades(p => [t, ...p]);
    return id;
  }, []);

  const getBalanceError = useCallback((e:any) => {
    const err = e?.error ?? e;
    const message = (err?.message || 'Unknown error').toString();
    const code = err?.code || '';
    const isBalanceError = code==='InsufficientBalance' || /insufficient|balance|fund|not enough|no enough|low balance/i.test(message);
    return { isBalanceError, message };
  }, []);

  const buyEven = useCallback(async (stake:number, market:string, dur:number) => {
    const tmpID = createTempTrade(stake, market, dur);
    try {
      const resp = await api_base.api.send({
        buy: 1, price: stake,
        parameters: { amount: stake, basis: 'stake', currency: 'USD', contract_type: 'DIGITEVEN', duration: dur, duration_unit:'t', symbol: market }
      });
      if (resp?.error) throw resp;
      const realID = resp.buy.contract_id;
      setTrades(ts => ts.map(t => t.id===tmpID ? {...t, id:realID, temp:false, status:'open'} : t));
      setStatus('✅ Trade placed', 'success');
      return realID;
    } catch (e:any) {
      const { isBalanceError, message } = getBalanceError(e);
      setTrades(ts => ts.map(t => t.id===tmpID ? ({
        ...t, status:'error', temp:false, errorReason: isBalanceError ? 'Insufficient balance' : 'Trade failed', errorDetails: message, closeTime:new Date()
      }) : t));
      setStatus(message || 'Trade failed', 'error');
      return;
    }
  }, [createTempTrade, getBalanceError, setStatus]);

  // POC / TX (UI only)
  const handlePOC = useCallback((c:any) => {
    setTrades(prev => prev.map(tr => {
      if (tr.id !== c.contract_id) return tr;
      if (!tr.startTime && c.entry_tick_time) {
        tr.startTime = new Date(c.entry_tick_time*1000);
        tr.entryValue = c.entry_tick ? Number(c.entry_tick) : undefined;
      }
      if (c.tick_count && c.current_tick) tr.ticksRemaining = c.tick_count - c.current_tick;
      tr.currentValue = c.current_spot ? Number(c.current_spot) : tr.currentValue;

      const finished = c.is_sold || c.is_expired || c.is_settleable || c.status==='sold';
      if (finished) {
        const net = Number(c.profit ?? 0);
        tr.status = net >= 0 ? 'won' : 'lost';
        tr.profit = net;
        tr.closeTime = new Date();
        tr.exitValue = c.exit_tick ? Number(c.exit_tick) : undefined;
        playSound(net >= 0);
      } else {
        tr.status = (c.status as TradeStatus) || 'active';
      }
      return { ...tr };
    }));
  }, [playSound]);

  const handleTX = useCallback((tx:TTransaction) => {
    setTrades(prev => prev.map(tr => {
      if (tr.id !== tx.contract_id) return tr;
      const net = Number(tx.amount) - tr.stake;
      tr.status = net >= 0 ? 'won' : 'lost';
      tr.profit = net;
      tr.closeTime = new Date(tx.transaction_time*1000);
      playSound(net >= 0);
      return { ...tr };
    }));
  }, [playSound]);

  useEffect(() => {
    const sub = api_base.api.onMessage().subscribe(({data}:any) => {
      if (data?.error) { console.error('WS error', data.error); return; }
      if (data?.msg_type==='proposal_open_contract') handlePOC(data.proposal_open_contract);
      if (data?.msg_type==='transaction' && data.transaction?.action==='sell') handleTX(data.transaction);
    });
    return () => sub.unsubscribe();
  }, [handlePOC, handleTX]);

  useEffect(() => { setPL(trades.reduce((s,t)=>s+(t.profit ?? 0),0)); }, [trades]);

  // Ticks: exact 1-per-tick buy, with *previous-buy's* next-tick parity applied before today's buy
  useEffect(() => {
    if (wsRef.current) { try{ wsRef.current.close(); } catch{} wsRef.current=null; }
    const app_id = 1089;
    const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ ticks: currentSymbol, subscribe: 1 }));
    };

    ws.onmessage = async (ev) => {
      const d = JSON.parse(ev.data);
      if (d?.error) { console.error('Tick stream error:', d.error.message); return; }
      if (!d?.tick?.quote || !d?.tick?.epoch) return;

      const price = Number(d.tick.quote);
      const epoch = Number(d.tick.epoch);
      if (lastEpochRef.current === epoch) return;
      lastEpochRef.current = epoch;

      // --- If we have a pending parity decision from the previous buy, evaluate it NOW (on this tick)
      if (autoTradeEnabled && pendingParityRef.current) {
        // compute parity for this tick (the "next tick after the previous buy")
        let s: string;
        if (['R_10','R_25','1HZ15V','1HZ30V','1HZ90V'].includes(currentSymbol)) s = price.toFixed(3);
        else if (['R_50','R_75'].includes(currentSymbol)) s = price.toFixed(4);
        else s = price.toFixed(2);
        const lastDigit = parseInt(s.slice(-1), 10);
        const isEven = (lastDigit % 2) === 0;

        if (isEven) stakeIndexRef.current = 0;            // reset on even
        else stakeIndexRef.current = Math.min(7, stakeIndexRef.current + 1); // step up on odd

        nextStakeRef.current = ladderRef.current[stakeIndexRef.current];
        pendingParityRef.current = false; // parity for previous buy has been applied
      }

      // --- Place today's buy on this tick (uses stake already prepared by previous parity)
      if (autoTradeEnabled) {
        // First ever buy after start → use base (already in nextStakeRef), then start waiting for next tick’s parity
        if (!hasBoughtOnceRef.current) {
          hasBoughtOnceRef.current = true;
        }
        const dur = parseInt(durRef.current?.value || '1', 10);
        await buyEven(nextStakeRef.current, currentSymbol, dur);

        // After a buy, the *next* tick will carry the parity used to compute the following stake
        pendingParityRef.current = true;
      }
    };

    ws.onerror = (e) => console.error('Tick ws error', e);
    ws.onclose = () => {};

    return () => { try{ ws.close(); } catch{} };
  }, [currentSymbol, autoTradeEnabled, buyEven]);

  const tradeStats = useMemo(() => {
    const completed = trades.filter(t => t.status==='won' || t.status==='lost');
    return {
      total: completed.length,
      won: completed.filter(t => t.status==='won').length,
      lost: completed.filter(t => t.status==='lost').length,
    };
  }, [trades]);

  const toggleStart = useCallback(() => {
    if (!autoTradeEnabled) {
      lockLadder();
      setStatus('Even-only bot started (per tick)', 'success');
    } else {
      setStatus('Bot stopped', 'info');
    }
    setAutoTradeEnabled(v => !v);
  }, [autoTradeEnabled, lockLadder, setStatus]);

  const posClass = useCallback((st:TradeStatus) =>
    st==='won' ? 'position-win' :
    st==='lost' || st==='error' ? 'position-loss' : 'position-open'
  , []);

  return (
    <div className="speed-appp" style={{ background: ui.is_dark_mode_on ? 'var(--general-main-1)' : 'transparent' }}>
      <div className="history-title">Even-only Speed Bot</div>

      <div className="trading-container">
        <div className="trade-controls">
          <div className="trade-control-group market-selector">
            <label>Market</label>
            <select
              id="tradeMarket"
              className="trade-input"
              ref={marketRef}
              value={currentSymbol}
              onChange={(e)=>setCurrentSymbol(e.target.value)}
              disabled={autoTradeEnabled}
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
            <label>Stake (S)</label>
            <input type="number" className="trade-input" defaultValue="2" min="0.01" step="0.01" ref={stakeInputRef} disabled={autoTradeEnabled}/>
          </div>

          <div className="trade-control-group">
            <label>Martingale (M)</label>
            <input type="number" className="trade-input" defaultValue="2" min="0" step="0.01" ref={martingaleInputRef} disabled={autoTradeEnabled}/>
          </div>

          <div className="trade-control-group">
            <label>Ticks</label>
            <select className="trade-input" ref={durRef} disabled={autoTradeEnabled}>
              <option value="1">1</option><option value="2">2</option>
              <option value="3">3</option><option value="5">5</option>
              <option value="10">10</option>
            </select>
          </div>

          <div className="trade-control-group">
            <label className="start">▶️ Start Bot ▶️</label>
            <button
              className={`auto-trade-toggle ${autoTradeEnabled ? 'on' : 'off'}`}
              onClick={toggleStart}
              style={{
                padding: '.4rem .8rem',
                background: autoTradeEnabled ? 'linear-gradient(90deg,#4285F4,#34a853)' : '#555',
                color: '#fff', border: '1px solid #222',
                justifyContent: 'center', display: 'flex', borderRadius: '4px', fontWeight: 'bold'
              }}
              title="Parity is evaluated on the next tick after each buy; one buy per tick."
            >
              {autoTradeEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        <div className="title"><small>Type</small><small>Entry/Exit spot</small><small>Buy price and P/L</small></div>

        <div className="open-positions">
          {trades.length===0
            ? <div className="no-positions"><small>No positions</small></div>
            : trades.map(tr => (
              <div key={tr.id} className={`position-item ${posClass(tr.status)}`}>
                <div className="position-header">
                  <div className="position-market-contract">
                    {marketIcons[tr.market] || <span>{tr.market}</span>}
                    {contractIcon}
                  </div>
                  {tr.status==='error' && (
                    <div className="error-display">
                      <span className="error-badge" title={tr.errorDetails || 'Trade failed'}>!</span>
                      <span className="error-text">{tr.errorReason}</span>
                    </div>
                  )}
                </div>

                <div className="position-spots">
                  <div className="spot-entry">
                    <svg width={16} height={16} viewBox="0 0 16 16">
                      <circle cx={8} cy={8} r={6} stroke="#FF4444" strokeWidth={1.5} fill="white" />
                      <circle cx={8} cy={8} r={3} fill="#FF4444" />
                    </svg>
                    {formatTickValue(tr.entryValue, tr.marketFormat)}
                  </div>
                  <div className="spot-exit">
                    <svg width={16} height={16} viewBox="0 0 16 16">
                      <circle cx={8} cy={8} r={6} stroke="#999999" strokeWidth={1.5} fill="white" />
                    </svg>
                    {formatTickValue(tr.exitValue, tr.marketFormat)}
                  </div>
                </div>

                <div className="position-footer">
                  <div className="position-stake">{tr.stake.toFixed(2)} USD</div>
                  <div className={`position-result ${
                    tr.status==='pending' ? 'pending' :
                    tr.status==='error' ? 'loss' :
                    tr.profit!==undefined ? (tr.profit>=0 ? 'profit' : 'loss') : ''
                  }`}>
                    {tr.status==='pending' ? '...' :
                      tr.profit!==undefined ? `${tr.profit>=0?'+':''}${tr.profit.toFixed(2)}` : '—'}
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>

      <div className="trade-status">
        <div>
          {msg.txt}
          {autoTradeEnabled && <span style={{ marginLeft: 10 }}>🔁 1 buy per tick | stake set by the *next* tick after each buy</span>}
        </div>
        <div style={{ marginTop: 6 }}>
          Ladder index: <b>{stakeIndexRef.current}</b>/7 · Next stake: <b>${nextStakeRef.current.toFixed(2)}</b>
        </div>
      </div>

      <div className="performance-stats">
        <div className="stat-item">
          <div className="stat-title">Total P/L</div>
          <div className={`stat-value ${profitLoss>=0?'profit':'loss'}`}>
            {profitLoss>=0?'+':''}${Math.abs(profitLoss).toFixed(2)} USD
          </div>
        </div>
        <div className="stat-item">
          <div className="stat-title">No. of runs</div>
          <div className="stat-value">{trades.filter(t=>t.status==='won'||t.status==='lost').length}</div>
        </div>
        <div className="stat-item">
          <div className="stat-title">Won</div>
          <div className="stat-value profit">{trades.filter(t=>t.status==='won').length}</div>
        </div>
        <div className="stat-item">
          <div className="stat-title">Lost</div>
          <div className="stat-value loss">{trades.filter(t=>t.status==='lost').length}</div>
        </div>
      </div>
    </div>
  );
});

export default Speed;
