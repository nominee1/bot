 
 import { useEffect, useRef, useState, useCallback } from 'react';
 import { api_base } from '@/external/bot-skeleton';
 import BrickTower from '../abrick';
 import SnakeRun from '../asnake';
 import './Aviator.scss';
 
 /* ───────────────────────── Constants ───────────────────────── */
 
 const MARKET_NAMES: Record<string, string> = {
   R_10: 'Volatility 10 Index', '1HZ10V': 'Volatility 10(1s) Index',
   R_25: 'Volatility 25 Index', '1HZ25V': 'Volatility 25(1s) Index',
   R_50: 'Volatility 50 Index', '1HZ50V': 'Volatility 50(1s) Index',
   R_75: 'Volatility 75 Index', '1HZ75V': 'Volatility 75(1s) Index',
   R_100: 'Volatility 100 Index', '1HZ100V': 'Volatility 100(1s) Index',
 };
 
 const THRESHOLD_MAP: Record<string, Record<string, number>> = {
   '1': { R_10: 0.00613, '1HZ10V': 0.00433, R_25: 0.01531, '1HZ25V': 0.01083, R_50: 0.03063, '1HZ50V': 0.02166, R_75: 0.04594, '1HZ75V': 0.03249, R_100: 0.06126, '1HZ100V': 0.04331 },
   '2': { R_10: 0.00573, '1HZ10V': 0.00405, R_25: 0.01431, '1HZ25V': 0.01012, R_50: 0.02863, '1HZ50V': 0.02024, R_75: 0.04294, '1HZ75V': 0.03036, R_100: 0.05725, '1HZ100V': 0.04048 },
   '3': { R_10: 0.00537, '1HZ10V': 0.0038, R_25: 0.01342, '1HZ25V': 0.00949, R_50: 0.02685, '1HZ50V': 0.01898, R_75: 0.04027, '1HZ75V': 0.02847, R_100: 0.05369, '1HZ100V': 0.03797 },
   '4': { R_10: 0.00511, '1HZ10V': 0.00361, R_25: 0.01277, '1HZ25V': 0.00903, R_50: 0.02554, '1HZ50V': 0.01806, R_75: 0.03831, '1HZ75V': 0.02709, R_100: 0.05109, '1HZ100V': 0.03612 },
   '5': { R_10: 0.00486, '1HZ10V': 0.00344, R_25: 0.01216, '1HZ25V': 0.0086, R_50: 0.02431, '1HZ50V': 0.01719, R_75: 0.03647, '1HZ75V': 0.02579, R_100: 0.04863, '1HZ100V': 0.03438 },
 };
 
 const getCounterColor = (c: number) => {
   if (c <= 0) return '#cb4335';
   if (c < 10) return '#cb4335';
   if (c < 20) return '#2874a6';
   if (c < 50) return '#6c3483';
   if (c < 100) return '#800080';
   if (c < 150) return '#4B0082';
   if (c < 200) return '#0000FF';
   return '#00008B';
 };
 
 /* ───────────────────────── Accumulator Panel ───────────────────────── */
 
 type TAccum = {
   id: string;
   symbol: string;
   buyPrice: number;
   profit: number;
   status: 'open' | 'sold' | 'expired';
   target: number;
   closedTime?: number;
 };
 
 const AccumulatorPanel: React.FC<{ symbol: string; growthRate: number; counter: number }> = ({
   symbol,
   growthRate,
   counter,
 }) => {
   const [stake, setStake] = useState(10);
   const [takeProfit, setTP] = useState(0);
   const [contracts, setCons] = useState<Record<string, TAccum>>({});
   const [recent, setRecent] = useState<TAccum[]>([]);
   const [pl, setPL] = useState(0);
   const [isBuying, setIsBuying] = useState(false);
   const [error, setError] = useState<string | null>(null);
 
   const refreshRef = useRef<NodeJS.Timeout | null>(null);
   const subs = useRef<Set<string>>(new Set());
   const closedIds = useRef<Set<string>>(new Set());
   const pendingStatusChecks = useRef<Set<string>>(new Set());

   // ADD: guard that the API socket is OPEN and a small "epoch" to force rebinds on reconnections
const [apiEpoch, setApiEpoch] = useState(0);

const ensureApiReady = useCallback(async () => {
  const OPEN = 1 as const;
  if (!api_base.api || api_base.api.connection.readyState !== OPEN) {
    await api_base.init(true);        // re-create + authorize + subscribe
    setApiEpoch(x => x + 1);          // bump so effects rebind to the new socket
  }
}, []);

useEffect(() => {
  const conn = api_base.api?.connection as any;
  if (!conn) return;
  const bump = () => setApiEpoch(x => x + 1);
  conn.addEventListener('open', bump);
  conn.addEventListener('close', bump);
  return () => {
    try { conn.removeEventListener('open', bump); } catch {}
    try { conn.removeEventListener('close', bump); } catch {}
  };
}, [api_base.api, apiEpoch]);

 
   const showStatus = (msg: string, type: 'info' | 'error' | 'success') => {
     setError(type === 'error' ? msg : null);
     console[type === 'info' ? 'info' : type === 'error' ? 'error' : 'log'](msg);
   };
 
   const addToRecent = (c: TAccum, profit?: number) => {
     if (closedIds.current.has(c.id)) return;
     closedIds.current.add(c.id);
     setRecent(prev => [
       { ...c, profit: profit ?? c.profit, status: 'sold', closedTime: Date.now() },
       ...prev,
     ]);
   };
 
   const buy = async () => {
    if (isBuying) return;
    setIsBuying(true);
    setError(null);
  
    try {
      await ensureApiReady();
  
      const resp = await api_base.api.send({
        buy: 1,
        price: stake,
        parameters: {
          amount: stake,
          basis: 'stake',
          currency: 'USD',
          contract_type: 'ACCU',
          symbol,
          growth_rate: growthRate / 100,
        },
      });
  
      if (resp.error) throw new Error(resp.error.message);
      if (!resp.buy?.contract_id) throw new Error('No contract ID in response');
  
      const id = String(resp.buy.contract_id);
      setCons(c => ({
        ...c,
        [id]: {
          id,
          symbol,
          buyPrice: resp.buy.buy_price,
          profit: 0,
          status: 'open',
          target: takeProfit,
        },
      }));
  
      showStatus(`Bought ACCU contract: ${id}`, 'success');
      await subscribeToUpdates(id);
    } catch (err: any) {
      const msg = err.message?.toLowerCase()?.includes('insufficient')
        ? 'Insufficient balance'
        : err.message || 'Buy failed';
      showStatus(`Buy failed: ${msg}`, 'error');
    } finally {
      setIsBuying(false);
    }
  };
  
 
  const doSell = async (id: string) => {
    await ensureApiReady();
    const resp = await api_base.api.send({ sell: id, price: 0 });
    if (resp.error) throw new Error(resp.error.message);
    return resp.sell;
  };
  
 
   const manualSell = async (id: string) => {
     try {
       const sellInfo = await doSell(id);
       const closed = contracts[id];
       if (closed) addToRecent(closed, sellInfo.profit);
 
       setCons(prev => {
         const { [id]: _, ...rest } = prev;
         return rest;
       });
       unsubscribe(id);
       showStatus(`Sold contract: ${id}`, 'success');
     } catch (err: any) {
       showStatus(`Sell failed: ${err.message}`, 'error');
     }
   };
 
   const subscribeToUpdates = async (id: string) => {
     if (subs.current.has(id)) return;
     try {
       await api_base.api.send({
         proposal_open_contract: 1,
         contract_id: id,
         subscribe: 1,
       });
       subs.current.add(id);
       pendingStatusChecks.current.delete(id);
     } catch (e) { console.warn('Subscription error:', e); }
   };
 
   const unsubscribe = async (id: string) => {
     if (!subs.current.has(id)) return;
     try {
       await api_base.api.send({
         proposal_open_contract: 0,
         contract_id: id,
       });
       subs.current.delete(id);
       pendingStatusChecks.current.delete(id);
     } catch (e) { console.warn('Unsubscription error:', e); }
   };
 
   const checkContractStatus = async (id: string) => {
     if (pendingStatusChecks.current.has(id)) return;
     pendingStatusChecks.current.add(id);
 
     try {
       const resp = await api_base.api.send({
         proposal_open_contract: 1,
         contract_id: id,
       });
 
       if (resp.error) {
         console.warn('Status check failed for', id, resp.error);
         return;
       }
 
       handleContract(resp.proposal_open_contract);
     } catch (e) {
       console.warn('Error checking contract status:', e);
     } finally {
       pendingStatusChecks.current.delete(id);
     }
   };
 
   useEffect(() => {
     const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
       if (data.error) { showStatus(data.error.message, 'error'); return; }
 
       switch (data.msg_type) {
         case 'proposal_open_contract': handleContract(data.proposal_open_contract); break;
         case 'sell': handleSell(data.sell); break;
         case 'portfolio': handlePortfolio(data.portfolio); break;
       }
     });
 
     // Initial load and periodic refresh
     api_base.api.send({ portfolio: 1 });
     refreshRef.current = setInterval(() => {
       api_base.api.send({ portfolio: 1 });
       // Check status of all open contracts
       Object.keys(contracts).forEach(checkContractStatus);
     }, 180_000);
 
     return () => {
       sub.unsubscribe();
       if (refreshRef.current) clearInterval(refreshRef.current);
       subs.current.forEach(id => unsubscribe(id));
     };
   }, [takeProfit]);
 
   const handleContract = (c: any) => {
     setCons(prev => {
       const old = prev[c.contract_id];
       if (!old) return prev;
 
       const updated: TAccum = {
         ...old,
         profit: parseFloat(c.profit ?? 0),
         status: c.status as TAccum['status'],
       };
 
       if (updated.status === 'open' && updated.target > 0 && updated.profit >= updated.target) {
         doSell(updated.id)
           .then(sell => {
             addToRecent(updated, sell.profit);
             setCons(p => {
               const { [updated.id]: _, ...rest } = p;
               return rest;
             });
             unsubscribe(updated.id);
             showStatus(`TP hit – sold ${updated.id}`, 'success');
           })
           .catch(e => showStatus(`Auto-sell failed: ${e.message}`, 'error'));
         return prev;
       }
 
       if (updated.status !== 'open') {
         addToRecent(updated);
         const { [updated.id]: _, ...rest } = prev;
         return rest;
       }
 
       return { ...prev, [updated.id]: updated };
     });
   };
 
   const handleSell = (sell: any) => {
     setCons(prev => {
       const sold = prev[sell.contract_id];
       if (sold) addToRecent(sold, sell.profit);
       const { [sell.contract_id]: _, ...rest } = prev;
       return rest;
     });
     unsubscribe(sell.contract_id);
   };
 
   const handlePortfolio = (portfolio: any) => {
     if (!portfolio?.contracts) return;
     const open: Record<string, TAccum> = {};
 
     portfolio.contracts
       .filter((c: any) => c.contract_type === 'ACCU' && c.status === 'open')
       .forEach((c: any) => {
         const id = String(c.contract_id);
         open[id] = {
           id,
           symbol: c.symbol,
           buyPrice: c.buy_price,
           profit: parseFloat(c.profit ?? 0),
           status: c.status,
           target: takeProfit,
         };
         subscribeToUpdates(id);
       });
 
     setCons(open);
   };
 
   useEffect(() => {
     const openPL = Object.values(contracts).reduce((s, c) => s + c.profit, 0);
     const closedPL = recent.reduce((s, c) => s + c.profit, 0);
     setPL(openPL + closedPL);
   }, [contracts, recent]);
 
   return (
     <div className="accu-panel">
       <div className="accu-header">
         <h3>Accumulator Ai</h3>

         <span className="counter-badge" style={{ color: getCounterColor(counter) }}>
           {counter}
         </span>
       </div>
       {error && <div className="accu-error">{error}</div>}
       <div className="accu-controls">
         <label>
           Stake (USD)
           <input
             type="number"
             min="1"
             step="1"
             value={stake}
             onChange={(e) => {
               const value = e.target.value === '' ? '' : Math.max(1, Math.floor(+e.target.value || 1));
               setStake(value);
             }}
             onBlur={(e) => {
               if (e.target.value === '') {
                 setStake(1);
               }
             }}
             onKeyDown={(e) => {
               if (e.key === '.' || e.key === ',') {
                 e.preventDefault();
               }
             }}
           />
         </label>
 
         <label>
           Take Profit
           <input
             type="number"
             min="0"
             step="0.01"
             value={takeProfit}
             onChange={(e) => {
               const value = e.target.value === '' ? '' : Math.max(0, +e.target.value || 0);
               setTP(value);
             }}
             onBlur={(e) => {
               if (e.target.value === '') {
                 setTP(0);
               }
             }}
             placeholder="Auto sell at (0 = disabled)"
           />
         </label>
         <button onClick={buy} disabled={isBuying}>
           {isBuying ? 'Buying…' : `Buy ACCU (${MARKET_NAMES[symbol]}) @ ${growthRate}%`}
         </button>
       </div>
       <div className="accu-contracts">
         <h4>Active</h4>
         <p>Refresh page before trading after switching demo | real acccount to see trade status</p>

         {Object.values(contracts).length === 0 && <p>No active ACCU contracts</p>}
         {Object.values(contracts).map(c => (
           <div key={c.id} className={`accu-row ${c.status}`}>
             <span className="ct-id">{c.id.slice(-8)}</span>
             <span className="ct-pl">{c.profit.toFixed(2)}</span>
             <span className="ct-st">{c.status}</span>
             {c.status === 'open' && (
               <button onClick={() => manualSell(c.id)}>Sell</button>
             )}
           </div>
         ))}
       </div>
       <div className="accu-contracts recent">
         <div className="recent-header">
           <h4>Recent Trades</h4>
           <button onClick={() => { setRecent([]); closedIds.current.clear(); }}>
             Reset
           </button>
         </div>
         {recent.length === 0 && <p>No closed trades yet</p>}
         {recent.map(c => (
           <div key={c.id} className={`accu-row ${c.status}`}>
             <span className="ct-id">{c.id.slice(-8)}</span>
             <span className="ct-pl">{c.profit.toFixed(2)}</span>
             <span className="ct-st">{c.status}</span>
           </div>
         ))}
       </div>
       <div className="accu-summary">
         Total&nbsp;P/L:&nbsp;{pl >= 0 ? '+' : ''}{pl.toFixed(2)}
       </div>
     </div>
   );
 };
 
 /* ───────────────────── Analysis Helper ───────────────────── */
 
 function analysePrices(
   prices: number[],
   symbol: string,
   rate: number
 ): { currentStreak: number; streakHistory: number[] } {
   const thr = THRESHOLD_MAP[String(rate)]?.[symbol];
   if (!thr) {
     console.warn('No threshold found for', symbol, rate);
     return { currentStreak: 0, streakHistory: [] };
   }
 
   const history: number[] = [];
   let counter = 0;
 
   for (let i = 1; i < prices.length; i++) {
     const pct = Math.abs((prices[i] - prices[i - 1]) / prices[i - 1] * 100);
     if (pct <= thr) counter++;
     else { history.push(counter); counter = 0; }
   }
   return { currentStreak: counter, streakHistory: history.slice(-100) };
 }
 
 /* ────────────────────────── Main Component ────────────────────────── */
 
 const TickAnalysis: React.FC = () => {
   const [symbol, setSymbol] = useState('1HZ10V');
   const [growthRate, setGrowthRate] = useState(5);
   const [entrySpot, setEntrySpot] = useState(0);
   const [exitSpot, setExitSpot] = useState(0);
   const [tickDiff, setTickDiff] = useState(0);
   const [pctDiff, setPctDiff] = useState(0);
   const [counter, setCounter] = useState(0);
   const [history, setHistory] = useState<number[]>([]);
   const [filterN, setFilterN] = useState(100);
   const [crashed, setCrashed] = useState(false);
 
   const wsRef = useRef<WebSocket | null>(null);
   const prevTickRef = useRef<number | null>(null);
   const streakRef = useRef<number>(0);
   const debounceTimer = useRef<NodeJS.Timeout>();
   const isMounted = useRef(false);
 
   const openSocket = useCallback((sym: string) => {
     if (wsRef.current) {
       wsRef.current.close();
       wsRef.current = null;
     }
 
     // Reset states when opening new connection
     setCounter(0);
     streakRef.current = 0;
     setHistory([]);
     setCrashed(false);
     prevTickRef.current = null;
 
     const sock = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');
     wsRef.current = sock;
 
     sock.onopen = () => {
       console.log('WebSocket connected for', sym);
       sock.send(JSON.stringify({
         ticks_history: sym,
         style: 'ticks',
         count: 5000,
         end: 'latest',
         subscribe: 1,
       }));
     };
 
     sock.onmessage = (e) => {
       if (!isMounted.current) return;
 
       try {
         const msg = JSON.parse(e.data);
 
         // Skip if we're not tracking this symbol anymore
         if (msg.error || symbol !== msg.echo_req?.ticks_history) return;
 
         if (msg.msg_type === 'history') {
           const prices: number[] = msg.history.prices.map(Number);
           if (!prices.length) return;
 
           const { currentStreak, streakHistory } = analysePrices(prices, sym, growthRate);
           streakRef.current = currentStreak;
           prevTickRef.current = prices.at(-1) ?? null;
           setCounter(currentStreak);
           setHistory(streakHistory);
           setCrashed(false);
           return;
         }
 
         if (msg.msg_type === 'tick') {
           handleTick(msg.tick.quote);
         }
       } catch (err) {
         console.error('Error processing WS message:', err);
       }
     };
 
     sock.onerror = (e) => {
       console.error('WebSocket error:', e);
     };
 
     sock.onclose = () => {
       console.log('WebSocket closed for', sym);
     };
   }, [growthRate, symbol]);
 
   const handleTick = (val: number) => {
     if (debounceTimer.current) clearTimeout(debounceTimer.current);
 
     debounceTimer.current = setTimeout(() => {
       const prev = prevTickRef.current;
       if (prev === null) {
         prevTickRef.current = val;
         return;
       }
 
       const diff = val - prev;
       const pct = Math.abs(diff / prev * 100);
       const thr = THRESHOLD_MAP[String(growthRate)]?.[symbol];
 
       if (!thr) {
         console.warn('No threshold found for', symbol, growthRate);
         return;
       }
 
       setEntrySpot(prev);
       setExitSpot(val);
       setTickDiff(diff);
       setPctDiff(pct);
 
       if (pct <= thr) {
         const newCounter = streakRef.current + 1;
         streakRef.current = newCounter;
         setCounter(newCounter);
         setCrashed(false);
       } else {
         const streak = streakRef.current;
         setHistory(h => {
           const next = [...h, streak];
           return next.length > 100 ? next.slice(-100) : next;
         });
         streakRef.current = 0;
         setCounter(0);
         setCrashed(true);
       }
 
       prevTickRef.current = val;
     }, 50); // 50ms debounce
   };
 
   useEffect(() => {
     isMounted.current = true;
     openSocket(symbol);
 
     return () => {
       isMounted.current = false;
       if (wsRef.current) {
         wsRef.current.close();
         wsRef.current = null;
       }
       if (debounceTimer.current) clearTimeout(debounceTimer.current);
     };
   }, [symbol, growthRate, openSocket]);
 
   const shownHistory = (filterN > 0 ? history.slice(-filterN) : history).reverse();
 
   return (
     <div className="aviator-predictor">
       <SnakeRun length={counter} crashed={crashed} />
       <AccumulatorPanel symbol={symbol} growthRate={growthRate} counter={counter} />
 
       <div className="market-selector">
         <select value={symbol} onChange={e => setSymbol(e.target.value)}>
           {Object.entries(MARKET_NAMES).map(([v, lbl]) => (
             <option key={v} value={v}>{lbl}</option>
           ))}
         </select>
       </div>
 
       <div className="growth-rate-selector">
         {[1, 2, 3, 4, 5].map(r => (
           <button key={r}
             className={growthRate === r ? 'active' : ''}
             onClick={() => setGrowthRate(r)}>
             {r}% Growth
           </button>
         ))}
       </div>
 
       <div className="analyse-last" style={{ display: 'none' }}>>
         <label>
           Analyse last&nbsp;
           <input type="number" min={0} max={100}
             value={filterN}
             onChange={e => setFilterN(+e.target.value || 0)} />
           &nbsp;streaks (0 = all)
         </label>
       </div>
 
       <div className="data-display">
         <div className="data-row"><span>Entry Spot:</span><span>{entrySpot.toFixed(4)}</span></div>
         <div className="data-row"><span>Exit Spot:</span><span>{exitSpot.toFixed(4)}</span></div>
         <div className="data-row" style={{ display: 'none' }}>
           <span>Current:</span>
           <span>{tickDiff.toFixed(4)}</span>
         </div>
         <div className="data-row"><span>Crash Monitor:</span><span>{pctDiff.toFixed(6)}%</span></div>
         <div className="data-row"><span>Counter:</span>
           <span style={{ color: getCounterColor(counter) }}>{counter}</span>
         </div>
       </div>
 
       <div className="history-display">
         <h3>Last 100 Counts</h3>
         <div className="history-values">
           {shownHistory.map((cnt, idx) => (
             <span key={idx}
               className="history-value"
               style={{ color: getCounterColor(cnt) }}>
               {cnt}
             </span>
           ))}
         </div>
       </div>
     </div>
   );
 };
 
 export default TickAnalysis;