/* =====================================================================
 *  BotIframe.tsx – 03 Jul 2025  •  Denara React Trade Panel (Optimized Queues)
 *  – Turbo mode: No pending trade displays (all successful)
 *  – Safe mode: Optimized queue processing (100ms intervals)
 * ===================================================================== */

import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { api_base } from '@/external/bot-skeleton';
import {
  LegacyExitSpotIcon,
  LegacyEntrySpotIcon,
  TradeTypesDigitsEvenIcon,
  TradeTypesDigitsOddIcon,
  TradeTypesDigitsMatchesIcon,
  TradeTypesAccumulatorBreakOutIcon,
  TradeTypesDigitsOverIcon,
  TradeTypesDigitsDiffersIcon,
  TradeTypesDigitsUnderIcon,
  TradeTypesUpsAndDownsFallIcon,
  MarketDerivedVolatility1001sIcon,
  MarketDerivedVolatility100Icon,
  MarketDerivedVolatility10Icon,
  MarketDerivedVolatility25Icon,
  MarketDerivedVolatility50Icon,
  MarketDerivedVolatility75Icon,
  MarketDerivedVolatility101sIcon,
  MarketDerivedVolatility251sIcon,
  MarketDerivedVolatility501sIcon,
  MarketDerivedVolatility751sIcon,
  TradeTypesUpsAndDownsRiseIcon
} from '@deriv/quill-icons';
import './BotIframe.scss';

/* ──────────────────────────────────────────────────────────────
 *  Type helpers
 * ────────────────────────────────────────────────────────────── */
type TradeStatus =
  | 'pending'
  | 'open'
  | 'active'
  | 'won'
  | 'lost'
  | 'completed'
  | 'error';

interface TTrade {
  id: string;                    // Deriv contract_id (string because tmp IDs are Date.now())
  contractType: string;          // DIGITEVEN, CALL, …
  stake: number;
  market: string;
  duration: number;              // ticks requested
  status: TradeStatus;
  timestamp: Date;               // when BUY was sent
  startTime?: Date;              // entry_tick_time from Deriv
  closeTime?: Date;
  profit?: number;               // net (payout – stake)
  entryValue?: number;           // entry tick value
  exitValue?: number;            // exit tick value
  currentValue?: number;
  ticksRemaining?: number;       // live countdown
  barrier?: number;
  isBulkTrade?: boolean;
  bulkTradeId?: string;
  counted?: boolean;             // bulk counter flag
  marketFormat?: string;         // stores the market format for decimal places
}

type TTransaction = {
  contract_id: string;
  amount: number;
  transaction_time: number;      // epoch-seconds
};

/* ──────────────────────────────────────────────────────────────
 *  Market and Contract Icons Mapping
 * ────────────────────────────────────────────────────────────── */
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

/* ──────────────────────────────────────────────────────────────
 *  Component
 * ────────────────────────────────────────────────────────────── */
const BotIframe = observer(() => {
  const { ui } = useStore();

  /* ---------- component state -------------------------------- */
  const [trades, setTrades] = useState<TTrade[]>([]);
  const [profitLoss, setPL] = useState(0);
  const [msg, setMsg] = useState<{ txt: string; type: 'info' | 'success' | 'error' | 'loading' | 'warning' }>({ txt: '', type: 'info' });
  const [bulk, setBulk] = useState({ on: false, done: 0, fail: 0, tot: 0 });
  const [turbo, setTurbo] = useState(false);
  const [strategy, setStrat] = useState('even');
  const [ctypes, setCT] = useState<{ left: string; right: string }>({ left: 'DIGITEVEN', right: 'DIGITODD' });
  const [currentSymbol, setCurrentSymbol] = useState('R_10');

  /* ---------- dom refs --------------------------------------- */
  const marketRef = useRef<HTMLSelectElement>(null);
  const strategyRef = useRef<HTMLSelectElement>(null);
  const stakeRef = useRef<HTMLInputElement>(null);
  const durRef = useRef<HTMLSelectElement>(null);
  const digitRef = useRef<HTMLInputElement>(null);
  const bulkCntRef = useRef<HTMLInputElement>(null);

  /* ---------- bulk queue ref --------------------------------- */
  const bulkQ = useRef<{
    active: boolean; processing: boolean;
    queue: { id: string; contractType: string; stake: number; market: string; duration: number; status: 'pending' | 'processing' | 'executed' | 'failed'; attempts: number; maxAttempts: number; }[];
    completed: number; failed: number; total: number;
  } | null>(null);

  /* ---------- contract stream registry ----------------------- */
  const subs = useRef<Set<string>>(new Set());

  const subContract = async (id: string) => {
    if (subs.current.has(id)) return;
    try {
      await api_base.api.send({ proposal_open_contract: 1, contract_id: id, subscribe: 1 });
      subs.current.add(id);
    } catch (e) {
      console.warn('Subscription error (non-critical):', e);
    }
  };

  const unsubContract = async (id: string) => {
    if (!subs.current.has(id)) return;
    try {
      await api_base.api.send({ proposal_open_contract: 0, contract_id: id });
      subs.current.delete(id);
    } catch (e) {
      console.warn('Unsubscription error (non-critical):', e);
    }
  };

  /* ---------- helpers ---------------------------------------- */
  const showStatus = (txt: string, type: 'info' | 'success' | 'error' | 'loading' | 'warning' = 'info') =>
    setMsg({ txt, type });

  const playSound = (ok: boolean) => {
    try {
      const a = new Audio(ok ? '/sounds/success.mp3' : '/sounds/fail.mp3');
      a.volume = .5; a.play().catch(() => { });
    } catch { }
  };

  const needsDigit = (s: string) => ['matches', 'differs', 'over', 'under'].includes(s);

  const mapContracts = (s: string): [string, string] => ({
    even: ['DIGITEVEN', 'DIGITODD'],
    odd: ['DIGITODD', 'DIGITEVEN'],
    matches: ['DIGITMATCH', 'DIGITDIFF'],
    differs: ['DIGITDIFF', 'DIGITMATCH'],
    over: ['DIGITOVER', 'DIGITUNDER'],
    under: ['DIGITUNDER', 'DIGITOVER'],
    rise: ['CALL', 'PUT'],
    fall: ['PUT', 'CALL'],
  }[s] ?? ['DIGITEVEN', 'DIGITODD']);

  const label = (ct: string) => ({
    DIGITEVEN: 'Even', DIGITODD: 'Odd', DIGITMATCH: 'Matches', DIGITDIFF: 'Differs',
    DIGITOVER: 'Over', DIGITUNDER: 'Under', CALL: 'Rise', PUT: 'Fall',
  } as Record<string, string>)[ct] ?? ct;

  /* ---------- strategy selector ------------------------------ */
  useEffect(() => {
    if (!strategyRef.current) return;
    const h = (e: any) => setStrat(e.target.value);
    strategyRef.current.addEventListener('change', h);
    return () => strategyRef.current?.removeEventListener('change', h);
  }, []);

  useEffect(() => {
    setCT({ left: mapContracts(strategy)[0], right: mapContracts(strategy)[1] });
    if (digitRef.current) {
      const need = needsDigit(strategy);
      digitRef.current.disabled = !need;
      digitRef.current.style.backgroundColor = need ? '' : 'gray';
    }
  }, [strategy]);

  /* ---------- market selector -------------------------------- */
  useEffect(() => {
    if (!marketRef.current) return;
    const h = (e: any) => setCurrentSymbol(e.target.value);
    marketRef.current.addEventListener('change', h);
    return () => marketRef.current?.removeEventListener('change', h);
  }, []);

  /* ---------- running P/L and trade stats -------------------- */
  useEffect(() => {
    setPL(trades.reduce((s, t) => s + (t.profit ?? 0), 0));
  }, [trades]);

  const getTradeStats = () => {
    const completedTrades = trades.filter(t => t.status === 'won' || t.status === 'lost');
    return {
      total: completedTrades.length,
      won: completedTrades.filter(t => t.status === 'won').length,
      lost: completedTrades.filter(t => t.status === 'lost').length,
    };
  };

  /* ---------- WebSocket stream ------------------------------- */
  useEffect(() => {
    const sub = api_base.api.onMessage().subscribe(({ data }: any) => handleWS(data));
    return () => sub.unsubscribe();
  }, [trades]);

  const handleWS = (d: any) => {
    // Skip the proposal_open_contract validation error
    if (d.error?.message?.includes('proposal_open_contract')) {
      return;
    }

    if (d.error) {
      showStatus(d.error.message, 'error');
      return;
    }

    switch (d.msg_type) {
      case 'buy':
        showStatus('✅ Next', 'success');
        break;

      case 'proposal_open_contract':
        handlePOC(d.proposal_open_contract);
        break;

      case 'transaction':
        if (d.transaction.action === 'sell') handleTX(d.transaction);
        break;
    }
  };

  /* ---------- contract-update handler ------------------------ */
  const handlePOC = (c: any) => {
    setTrades(prev => prev.map(tr => {
      if (tr.id !== c.contract_id) return tr;

      if (!tr.startTime && c.entry_tick_time) {
        tr.startTime = new Date(c.entry_tick_time * 1000);
        tr.entryValue = c.entry_tick ? Number(c.entry_tick) : undefined;
        // Store market format at time of trade
        tr.marketFormat = currentSymbol;
      }

      if (c.tick_count && c.current_tick)
        tr.ticksRemaining = c.tick_count - c.current_tick;

      tr.currentValue = c.current_spot ? Number(c.current_spot) : tr.currentValue;

      const finished = c.is_sold || c.is_expired || c.is_settleable || c.status === 'sold';
      if (finished) {
        const net = Number(c.profit ?? 0);
        tr.status = net >= 0 ? 'won' : 'lost';
        tr.profit = net;
        tr.closeTime = new Date();
        tr.exitValue = c.exit_tick ? Number(c.exit_tick) : undefined;
        unsubContract(c.contract_id);
        playSound(net >= 0);

        if (tr.isBulkTrade && bulkQ.current && !tr.counted) {
          tr.counted = true;
          if (net >= 0) bulkQ.current.completed++;
          else bulkQ.current.failed++;
          updateBulkProgress();
        }
      } else {
        tr.status = c.status as TradeStatus;
      }
      return { ...tr };
    }));
  };

  /* ---------- sell-transaction handler ----------------------- */
  const handleTX = (tx: TTransaction) => {
    setTrades(prev => prev.map(tr => {
      if (tr.id !== tx.contract_id) return tr;
      const net = Number(tx.amount) - tr.stake;
      tr.status = net >= 0 ? 'won' : 'lost';
      tr.profit = net;
      tr.closeTime = new Date(tx.transaction_time * 1000);
      playSound(net >= 0);

      if (tr.isBulkTrade && bulkQ.current && !tr.counted) {
        tr.counted = true;
        if (net >= 0) bulkQ.current.completed++;
        else bulkQ.current.failed++;
        updateBulkProgress();
      }
      return { ...tr };
    }));
    unsubContract(tx.contract_id);
  };

  /* ---------- BUY ------------------------------------------- */
  const buy = async (ct: string, isBulk = false, bulkId?: string,
    stakeOv?: number, marketOv?: string, durOv?: number) => {
    const stake = stakeOv ?? parseFloat(stakeRef.current?.value || '0');
    const dur = durOv ?? parseInt(durRef.current?.value || '1', 10);
    const market = marketOv ?? marketRef.current?.value ?? '1HZ10V';

    let barrier: string | undefined;
    if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(ct)) {
      const d = digitRef.current ? parseInt(digitRef.current.value, 10) : NaN;
      if (isNaN(d)) { showStatus('Enter digit 0-9', 'error'); throw new Error('digit'); }
      barrier = d.toString();
    }

    // Always add to trades array for non-turbo or non-bulk trades
    const tmpID = Date.now().toString();
    setTrades(t => [
      {
        id: tmpID, contractType: ct, stake, market, duration: dur, status: 'pending',
        timestamp: new Date(), barrier: barrier ? +barrier : undefined,
        isBulkTrade: isBulk, bulkTradeId: bulkId,
        marketFormat: currentSymbol // Store current market format
      },
      ...t,
    ]);

    try {
      const resp = await api_base.api.send({
        buy: 1, price: stake,
        parameters: {
          amount: stake, basis: 'stake', currency: 'USD',
          contract_type: ct, duration: dur, duration_unit: 't', symbol: market,
          ...(barrier ? { barrier } : {})
        }
      });
      if (resp.error) throw new Error(resp.error.message);

      const realID = resp.buy.contract_id;

      // Update the trade with the real ID and status
      setTrades(t => t.map(tr =>
        tr.id === tmpID ? { ...tr, id: realID, status: 'open' } : tr
      ));

      subContract(realID);
      showStatus('Next ✅ ', 'success');
      return realID;

    } catch (e: any) {
      setTrades(t => t.filter(tr => tr.id !== tmpID)); // Remove failed trades immediately
      showStatus(`Trade failed: ${e.message}`, 'error');
      throw e;
    }
  };

  /* ---------- BULK ------------------------------------------ */
  const startBulk = (ct: string) => {
    const count = parseInt(bulkCntRef.current?.value || '0', 10);
    const stake = parseFloat(stakeRef.current?.value || '10');
    const duration = parseInt(durRef.current?.value || '1', 10);
    const market = marketRef.current?.value || '1HZ10V';

    if (!count || !stake) { showStatus('Invalid bulk params', 'error'); return; }

    bulkQ.current = {
      active: true, processing: false,
      queue: Array(count).fill(null).map((_, i) => ({
        id: `bulk-${Date.now()}-${i}`, contractType: ct, stake, market, duration,
        status: 'pending', attempts: 0, maxAttempts: 3
      })),
      completed: 0, failed: 0, total: count,
    };
    setBulk({ on: true, done: 0, fail: 0, tot: count });
    showStatus(`Bulk ×${count} started`, 'info');
    processBulk();
  };

  /* --------------  TURBO-aware processor  ------------------- */
  const processBulk = async () => {
    if (!bulkQ.current || !bulkQ.current.active) return;

    /* ⚡  Turbo path – fire EVERY pending buy in parallel  */
    if (turbo) {
      const pendings = bulkQ.current.queue.filter(q => q.status === 'pending');
      if (pendings.length === 0) return;

      bulkQ.current.processing = true;
      await Promise.all(pendings.map(async job => {
        job.status = 'processing'; job.attempts++;
        try {
          await buy(job.contractType, true, job.id, job.stake, job.market, job.duration);
          job.status = 'executed';
        } catch {
          if (job.attempts >= job.maxAttempts) {
            job.status = 'failed'; bulkQ.current!.failed++;
          } else {
            job.status = 'pending';
          }
        }
      }));
      bulkQ.current.processing = false;
      updateBulkProgress();

      if (bulkQ.current.active &&
        bulkQ.current.queue.some(q => q.status === 'pending')) {
        setTimeout(processBulk, 200);   // brief breather
      }
      return;
    }

    /* 🟢  Safe sequential path - optimized for speed */
    if (bulkQ.current.processing) return;
    const next = bulkQ.current.queue.find(q => q.status === 'pending');
    if (!next) return;

    bulkQ.current.processing = true;
    next.status = 'processing'; next.attempts++;

    try {
      await buy(next.contractType, true, next.id, next.stake, next.market, next.duration);
      next.status = 'executed';
    } catch {
      if (next.attempts >= next.maxAttempts) {
        next.status = 'failed'; bulkQ.current.failed++;
      } else {
        next.status = 'pending';
      }
    } finally {
      bulkQ.current.processing = false;
      updateBulkProgress();
      if (bulkQ.current.active) if (bulkQ.current.active) processBulk(); // No delay // Fast processing
    }
  };

  const stopBulk = (msg = 'Bulk stopped') => {
    if (bulkQ.current) bulkQ.current.active = false;
    setBulk(b => ({ ...b, on: false }));
    showStatus(msg, 'info');
  };

  const updateBulkProgress = () => {
    if (!bulkQ.current) return;
    setBulk({
      on: true,
      done: bulkQ.current.completed,
      fail: bulkQ.current.failed,
      tot: bulkQ.current.total,
    });
    if (bulkQ.current.completed + bulkQ.current.failed === bulkQ.current.total) {
      setBulk(b => ({ ...b, on: false }));
      bulkQ.current.active = false;
    }
  };

  /* ---------- auto-purge "orphan" pendings ------------------- */
  useEffect(() => {
    const id = setInterval(() => {
      setTrades(t => t.filter(tr =>
        !(tr.status === 'pending' && Date.now() - tr.timestamp.getTime() > 15_000)
      ));
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  /* ---------- RESET / CLEAR --------------------------------- */
  const handleReset = () => {
    if (bulkQ.current) bulkQ.current.active = false;
    trades.forEach(tr => unsubContract(tr.id));
    setTrades([]);
    setPL(0);
    setBulk({ on: false, done: 0, fail: 0, tot: 0 });
    showStatus('History cleared', 'info');
  };

  /* ---------- status checker (unsubscribe finished) ---------- */
  useEffect(() => {
    const id = setInterval(() => {
      trades.filter(t => ['won', 'lost', 'completed', 'error'].includes(t.status))
        .forEach(t => unsubContract(t.id));
    }, 30_000);
    return () => clearInterval(id);
  }, [trades]);

  /* =================================================================
   *  RENDER
   * ================================================================= */
  const posClass = (st: TradeStatus, p?: number) =>
    st === 'won' || (st === 'completed' && p! < 0) ? 'position-win' :
      st === 'lost' || st === 'error' || (st === 'completed' && p! >= 0) ? 'position-loss' :
        'position-open';

  // Format tick value based on the market format stored at trade time
  const formatTickValue = (value?: number, marketFormat?: string) => {
    if (value === undefined) return '—';

    let tickString: string;
    if (marketFormat === 'R_10' || marketFormat === 'R_25') {
      tickString = value.toFixed(3);
    } else if (marketFormat === 'R_50' || marketFormat === 'R_75') {
      tickString = value.toFixed(4);
    } else {
      tickString = value.toFixed(2);
    }

    return tickString;
  };

  const tradeStats = getTradeStats();

  return (
    <div className="bot-app"
      style={{ background: ui.is_dark_mode_on ? 'var(--general-main-1)' : 'transparent' }}>
      <div className="trading-container">
        <div className="history-title">Panel</div>

        {/* ---------- execution mode toggle -------- */}
        <div className="trade-control-group">
          <label>Execution Mode</label>
          <div className="execution-mode-toggle">
            <button style={{
              padding: '0.5rem 1rem',
              backgroundColor: turbo ? 'green' : 'red',
              borderColor: turbo ? 'green' : 'red', color: '#fff'
            }}
              onClick={() => setTurbo(true)}>Turbo</button>
            <button style={{
              padding: '0.5rem 1rem',
              backgroundColor: !turbo ? 'green' : 'red',
              borderColor: !turbo ? 'green' : 'red', color: '#fff'
            }}
              onClick={() => setTurbo(false)}>Safe</button>
          </div>
          {turbo && <div className="execution-mode-warning">
            ⚡ Faster execution: all bulk trades fire at once (no pending displays).
          </div>}
        </div>

        {/* ---------- trade controls ---------------- */}
        <div className="trade-controls">
          {/* market */}
          <div className="trade-control-group">
            <label>Market</label>
            <select id="tradeMarket" className="trade-input" ref={marketRef}>
              <option value="R_10">Vol 10</option><option value="1HZ10V">Vol 10 (1s)</option>
              <option value="R_25">Vol 25</option><option value="1HZ25V">Vol 25 (1s)</option>
              <option value="R_50">Vol 50</option><option value="1HZ50V">Vol 50 (1s)</option>
              <option value="R_75">Vol 75</option><option value="1HZ75V">Vol 75 (1s)</option>
              <option value="R_100">Vol 100</option><option value="1HZ100V">Vol 100 (1s)</option>
            </select>
          </div>

          {/* strategy */}
          <div className="trade-control-group">
            <label>Strategy</label>
            <select id="tradeStrategy"
              className="trade-input"
              ref={strategyRef}
              value={strategy}
              onChange={e => setStrat(e.target.value)}>
              <option value="even">Even</option><option value="odd">Odd</option>
              <option value="matches">Matches</option><option value="differs">Differs</option>
              <option value="over">Over</option><option value="under">Under</option>
              <option value="rise">Rise</option><option value="fall">Fall</option>
            </select>
          </div>

          {/* stake */}
          <div className="trade-control-group">
            <label>Stake (USD)</label>
            <input type="number" className="trade-input" defaultValue="10"
              min="1" step="1" ref={stakeRef} />
          </div>

          {/* duration */}
          <div className="trade-control-group">
            <label>Duration (ticks)</label>
            <select className="trade-input" ref={durRef}>
              <option value="1">1</option><option value="2">2</option>
              <option value="3">3</option><option value="5">5</option>
              <option value="10">10</option>
            </select>
          </div>

          {/* digit */}
          <div className="trade-control-group">
            <label>Prediction</label>
            <input type="number" className="trade-input" defaultValue="1"
              min="0" max="9" step="1" ref={digitRef}
              disabled={!needsDigit(strategy)}
              style={{ backgroundColor: needsDigit(strategy) ? '' : 'gray' }} />
          </div>
        </div>
        <div className="title"><small>Type</small><small>
            Entry/Exit spot</small><small>
              Buy price and P/L</small></div>

        {/* ---------- open positions list ---------- */}
        <div className="open-positions">
        
          {trades.length === 0
            ? <div className="no-positions"><small>No positions</small></div>
            : trades.filter(t => t.status !== 'pending').map(tr => (
              <div key={tr.id} className={`position-item ${posClass(tr.status, tr.profit)}`}>
                <div className="position-header">
                  <div className="position-market-contract">
                    <div className="market-icon">
                      {marketIcons[tr.market] || <span>{tr.market}</span>}
                    </div>
                    <div className="contract-icon">
                      {contractIcons[tr.contractType] || <span>{label(tr.contractType)}</span>}
                    </div>
                  </div>
                  {tr.isBulkTrade && <span className="bulk-indicator">[Bulk]</span>}
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
                  <div className="position-stake">{tr.stake.toFixed(2)}</div>
                  <div className={`position-result ${tr.profit && tr.profit >= 0 ? 'profit' : 'loss'}`}>
                    {tr.profit !== undefined
                      ? `${tr.profit >= 0 ? '+' : ''}${tr.profit.toFixed(2)}`
                      : '—'}
                  </div>
                </div>
              </div>
            ))}
        </div>

        {/* ---------- single-trade buttons -------- */}
        <div className="trade-buttons">
          <button className="trade-btn even-btn"
            onClick={() => buy(ctypes.left)}>
            <span className="button-icon">
              {contractIcons[ctypes.left] || null}
            </span>
            {label(ctypes.left)}
          </button>
          <button className="trade-btn odd-btn"
            onClick={() => buy(ctypes.right)}>
            <span className="button-icon">
              {contractIcons[ctypes.right] || null}
            </span>
            {label(ctypes.right)}
          </button>
          <button className="trade-btn reset-btn"
            onClick={handleReset}>Reset</button>
        </div>

        {/* ---------- bulk controls -------------- */}
        <div className="trade-control-group">
          <label>Bulk Count</label>
          <input type="number" className="trade-input" defaultValue="1"
            min="1" step="1" ref={bulkCntRef} />
        </div>

        <div className="trade-buttons">
          <button className="trade-btn even-btn"
            onClick={() => startBulk(ctypes.left)}>
            <span className="button-icon">
              {contractIcons[ctypes.left] || null}
            </span>
            Bulk {label(ctypes.left)}
          </button>
          <button className="trade-btn odd-btn"
            onClick={() => startBulk(ctypes.right)}>
            <span className="button-icon">
              {contractIcons[ctypes.right] || null}
            </span>
            Bulk {label(ctypes.right)}
          </button>
          <button className="trade-btn stop-btn"
            onClick={() => stopBulk()}
            disabled={!bulk.on}>Stop Bulk</button>
        </div>

        {bulk.on &&
          <div className="bulk-progress">
            <div className="bulk-progress-bar">
              <div className="progress-completed"
                style={{ width: `${(bulk.done / bulk.tot) * 100}%` }} />
              <div className="progress-failed"
                style={{ width: `${(bulk.fail / bulk.tot) * 100}%` }} />
            </div>
            <div className="bulk-progress-text">
              {bulk.done} completed, {bulk.fail} failed, {Math.max(0, bulk.tot - bulk.done - bulk.fail)} remaining
            </div>
          </div>}

        {/* ---------- status / P&L --------------- */}
        <div className={`trade-status status-${msg.type}`}>
          {msg.txt}{msg.type === 'loading' && <div className="loading-spinner" />}
        </div>

        <div className="performance-stats">
          <div className="stat-item">
            <div className="stat-title">Total profit/loss</div>
            <div className={`stat-value ${profitLoss >= 0 ? 'profit' : 'loss'}`}>
              {profitLoss >= 0 ? '+' : ''}${Math.abs(profitLoss).toFixed(2)}
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-title">No. of runs</div>
            <div className="stat-value">{tradeStats.total}</div>
          </div>
          <div className="stat-item">
            <div className="stat-title">Contracts won</div>
            <div className="stat-value profit">{tradeStats.won}</div>
          </div>
          <div className="stat-item">
            <div className="stat-title">Contracts lost</div>
            <div className="stat-value loss">{tradeStats.lost}</div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default BotIframe;