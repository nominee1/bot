import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { api_base } from '@/external/bot-skeleton';
import {
  TradeTypesDigitsEvenIcon,
  TradeTypesDigitsOddIcon,
  TradeTypesDigitsMatchesIcon,
  TradeTypesDigitsOverIcon,
  TradeTypesDigitsDiffersIcon,
  TradeTypesDigitsUnderIcon,
  TradeTypesUpsAndDownsFallIcon,
  TradeTypesUpsAndDownsRiseIcon,
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
  MarketDerivedVolatility151sIcon,
  MarketDerivedVolatility301sIcon,
  MarketDerivedVolatility901sIcon,
} from '@deriv/quill-icons';
import './BotIframe.scss';

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
  barrier?: number;
  isBulkTrade?: boolean;
  bulkTradeId?: string;
  counted?: boolean;
  marketFormat?: string;
  temp?: boolean;
  errorReason?: string;
  errorDetails?: string;
}

type TTransaction = {
  contract_id: string;
  amount: number;
  transaction_time: number;
};

const marketIcons: Record<string, JSX.Element> = {
  '1HZ100V': <MarketDerivedVolatility1001sIcon width={16} height={16} />,
  R_100: <MarketDerivedVolatility100Icon width={16} height={16} />,
  R_10: <MarketDerivedVolatility10Icon width={16} height={16} />,
  R_25: <MarketDerivedVolatility25Icon width={16} height={16} />,
  R_50: <MarketDerivedVolatility50Icon width={16} height={16} />,
  R_75: <MarketDerivedVolatility75Icon width={16} height={16} />,
  '1HZ10V': <MarketDerivedVolatility101sIcon width={16} height={16} />,
  '1HZ25V': <MarketDerivedVolatility251sIcon width={16} height={16} />,
  '1HZ50V': <MarketDerivedVolatility501sIcon width={16} height={16} />,
  '1HZ15V': <MarketDerivedVolatility151sIcon width={16} height={16} />,
  '1HZ30V': <MarketDerivedVolatility301sIcon width={16} height={16} />,
  '1HZ90V': <MarketDerivedVolatility901sIcon width={16} height={16} />,
  '1HZ75V': <MarketDerivedVolatility751sIcon width={16} height={16} />,
};

const contractIcons: Record<string, JSX.Element> = {
  DIGITEVEN: <TradeTypesDigitsEvenIcon width={16} height={16} />,
  DIGITODD: <TradeTypesDigitsOddIcon width={16} height={16} />,
  DIGITMATCH: <TradeTypesDigitsMatchesIcon width={16} height={16} />,
  DIGITDIFF: <TradeTypesDigitsDiffersIcon width={16} height={16} />,
  DIGITOVER: <TradeTypesDigitsOverIcon width={16} height={16} />,
  DIGITUNDER: <TradeTypesDigitsUnderIcon width={16} height={16} />,
  CALL: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
  PUT: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />,
};

// ✅ AUTO pending action types (single / both / bulk)
type PendingAuto =
  | null
  | { mode: 'single'; ct: string }
  | { mode: 'both'; left: string; right: string }
  | { mode: 'bulk'; ct: string };

const BotIframe = observer(() => {
  const { ui } = useStore();

  const [trades, setTrades] = useState<TTrade[]>([]);
  const [profitLoss, setPL] = useState(0);
  const [msg, setMsg] = useState<{ txt: string; type: 'info' | 'success' | 'error' | 'loading' | 'warning' }>({
    txt: '',
    type: 'info',
  });
  const [bulk, setBulk] = useState({ on: false, done: 0, fail: 0, tot: 0 });

  const [turbo, setTurbo] = useState(false);

  // ✅ TURBO live ref (must update immediately on click, not only via effect)
  const turboRef = useRef(false);
  const setTurboMode = (v: boolean) => {
    turboRef.current = v; // ✅ immediate
    setTurbo(v);
  };
  useEffect(() => {
    turboRef.current = turbo;
  }, [turbo]);

  // ✅ Selected digit highlight (user focus)
  const [selectedDigit, setSelectedDigit] = useState<number | null>(null);


  const [strategy, setStrat] = useState('even');
  const [ctypes, setCT] = useState<{ left: string; right: string }>({ left: 'DIGITEVEN', right: 'DIGITODD' });
  const [currentSymbol, setCurrentSymbol] = useState('1HZ10V');
  const [bothMode, setBothMode] = useState<boolean>(false);

  // ✅ AUTO controls (Entry Point must allow blank)
  const [autoOn, setAutoOn] = useState(false);
  const [autoEntryDigit, setAutoEntryDigit] = useState<string>('2'); // ✅ allow ''

  // keep live refs so WS/timeout always sees latest values
  const autoOnRef = useRef(false);
  const autoEntryRef = useRef<number>(2); // parsed numeric or NaN
  const pendingAutoRef = useRef<PendingAuto>(null);
  const autoBusyRef = useRef(false);
  const isLiveTickRef = useRef(false);

  useEffect(() => {
    autoOnRef.current = autoOn;
  }, [autoOn]);

  // ✅ parse entry digit into ref (blank => NaN) — do NOT mutate state here (no snapping)
  useEffect(() => {
    const s = autoEntryDigit.trim();
    if (s === '') {
      autoEntryRef.current = Number.NaN;
      return;
    }
    const n = Number(s);
    autoEntryRef.current = Number.isFinite(n) ? Math.min(9, Math.max(0, Math.trunc(n))) : Number.NaN;
  }, [autoEntryDigit]);

  const [activeMode, setActiveMode] = useState<'evenOdd' | 'overUnder' | 'riseFall'>('evenOdd');

  const [analysisData, setAnalysisData] = useState({
    evenCount: 0,
    oddCount: 0,
    riseCount: 0,
    fallCount: 0,
    totalCount: 0,
    lastResults: [] as Array<{
      digit: number;
      isEven: boolean;
      isRise: boolean | null;
      price: number;
      timestamp: Date;
    }>,
    lastDigit: null as number | null,
    lastPrice: null as number | null,
    digitCounts: Array(10).fill(0) as number[],
    overDigit: 1,
    underDigit: 7,
    tickRange: 100,
    currentMarket: '1HZ10V',
  });

  // ✅ Purchased RESULT digit blink state (digits SVG container)
  const [purchasedTickDigit, setPurchasedTickDigit] = useState<number | null>(null);
  const purchasedBlinkTimerRef = useRef<number | null>(null);
  const lastBlinkKeyRef = useRef<string>('');

  const marketSelectionRef = useRef<HTMLSelectElement>(null);
  const marketRef = useRef<HTMLSelectElement>(null);
  const strategyRef = useRef<HTMLSelectElement>(null);
  const stakeRef = useRef<HTMLInputElement>(null);
  const durRef = useRef<HTMLInputElement>(null);
  const digitRef = useRef<HTMLInputElement>(null);
  const bulkCntRef = useRef<HTMLInputElement>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const bulkQ = useRef<{
    active: boolean;
    processing: boolean;
    queue: {
      id: string;
      contractType: string;
      stake: number;
      market: string;
      duration: number;
      status: 'pending' | 'processing' | 'executed' | 'failed';
      attempts: number;
      maxAttempts: number;
    }[];
    completed: number;
    failed: number;
    total: number;
  } | null>(null);

  const prevTickRef = useRef<number | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();

  const showStatus = (txt: string, type: 'info' | 'success' | 'error' | 'loading' | 'warning' = 'info') =>
    setMsg({ txt, type });

  const playSound = (ok: boolean) => {
    try {
      const a = new Audio(ok ? '/sounds/success.mp3' : '/sounds/fail.mp3');
      a.volume = 0.5;
      a.play().catch(() => { });
    } catch { }
  };

  const needsDigit = (s: string) => ['matches', 'differs', 'over', 'under'].includes(s);

  const mapContracts = (s: string): [string, string] =>
  ({
    even: ['DIGITEVEN', 'DIGITODD'],
    odd: ['DIGITODD', 'DIGITEVEN'],
    matches: ['DIGITMATCH', 'DIGITDIFF'],
    differs: ['DIGITDIFF', 'DIGITMATCH'],
    over: ['DIGITOVER', 'DIGITUNDER'],
    under: ['DIGITUNDER', 'DIGITOVER'],
    rise: ['CALL', 'PUT'],
    fall: ['PUT', 'CALL'],
  }[s] ?? ['DIGITEVEN', 'DIGITODD']);

  const label = (ct: string) =>
    ({
      DIGITEVEN: 'Even',
      DIGITODD: 'Odd',
      DIGITMATCH: 'Matches',
      DIGITDIFF: 'Differs',
      DIGITOVER: 'Over',
      DIGITUNDER: 'Under',
      CALL: 'Rise',
      PUT: 'Fall',
    } as Record<string, string>)[ct] ?? ct;

  const getBalanceError = (error: any): { isBalanceError: boolean; message: string } => {
    if (!error) return { isBalanceError: false, message: 'Unknown error' };

    const errorObj = error.error || error;
    const rawMsg = (errorObj.message || 'Unknown error').toString().trim();
    const errorCode = errorObj.code || '';

    const isBalanceError =
      errorCode === 'InsufficientBalance' ||
      ['insufficient', 'balance', 'fund', 'not enough', 'no enough', 'low balance'].some(term =>
        rawMsg.toLowerCase().includes(term)
      );

    return { isBalanceError, message: rawMsg };
  };

  const createTempTrade = (
    ct: string,
    stake: number,
    market: string,
    dur: number,
    barrier?: number,
    isBulk?: boolean,
    bulkId?: string
  ) => {
    const tmpID = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const t: TTrade = {
      id: tmpID,
      contractType: ct,
      stake,
      market,
      duration: dur,
      status: 'pending',
      timestamp: new Date(),
      barrier,
      isBulkTrade: isBulk,
      bulkTradeId: bulkId,
      marketFormat: currentSymbol,
      temp: true,
    };
    setTrades(prev => [t, ...prev]);
    return tmpID;
  };

  const buy = async (ct: string, isBulk = false, bulkId?: string, stakeOv?: number, marketOv?: string, durOv?: number) => {
    const stake = stakeOv ?? parseFloat(stakeRef.current?.value || '0');
    const dur = durOv ?? parseInt(durRef.current?.value || '1', 10);
    const market = marketOv ?? marketRef.current?.value ?? '1HZ10V';

    let barrier: string | undefined;
    if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(ct)) {
      const d = digitRef.current ? parseInt(digitRef.current.value, 10) : NaN;
      if (isNaN(d)) {
        showStatus('Enter digit 0-9', 'error');
        throw new Error('digit');
      }
      barrier = d.toString();
    }

    const tmpID = createTempTrade(ct, stake, market, dur, barrier ? +barrier : undefined, isBulk, bulkId);

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
          symbol: market,
          ...(barrier ? { barrier } : {}),
        },
      });
      if (resp.error) throw new Error(resp.error.message);

      const realID = resp.buy.contract_id;
      setTrades(t => t.map(tr => (tr.id === tmpID ? { ...tr, id: realID, temp: false, status: 'open' } : tr)));

      showStatus('Next ✅', 'success');
      return realID;
    } catch (e: any) {
      let errorObj;
      try {
        errorObj = JSON.parse(e.message);
      } catch {
        errorObj = e;
      }

      const { isBalanceError, message } = getBalanceError(errorObj);

      setTrades(t =>
        t.map(tr =>
          tr.id === tmpID
            ? {
              ...tr,
              status: 'error',
              temp: false,
              errorReason: isBalanceError ? 'Insufficient balance' : 'Trade failed',
              errorDetails: message,
              closeTime: new Date(),
            }
            : tr
        )
      );

      showStatus(message, 'error');
      throw new Error(isBalanceError ? 'Insufficient balance' : 'Trade failed');
    }
  };

  const buyBoth = async () => {
    try {
      await Promise.all([buy(ctypes.left), buy(ctypes.right)]);
    } catch {
      // handled individually
    }
  };

  // ✅ top buttons: if AUTO is ON => arm, else buy immediately
  const armOrBuy = (side: 'left' | 'right') => {
    if (!autoOnRef.current) {
      return bothMode ? buyBoth() : buy(side === 'left' ? ctypes.left : ctypes.right);
    }

    const ep = autoEntryRef.current;
    if (!Number.isFinite(ep) || ep < 0 || ep > 9) {
      showStatus('AUTO: set Entry Point (0-9)', 'warning');
      return;
    }

    pendingAutoRef.current = bothMode
      ? { mode: 'both', left: ctypes.left, right: ctypes.right }
      : { mode: 'single', ct: side === 'left' ? ctypes.left : ctypes.right };

    autoBusyRef.current = false;
    showStatus(`AUTO armed → waiting for digit ${ep}`, 'info');
  };

  // ✅ bulk buttons: if AUTO is ON => arm, else start bulk immediately
  const armOrStartBulk = (ct: string) => {
    if (!autoOnRef.current) return startBulk(ct);

    const ep = autoEntryRef.current;
    if (!Number.isFinite(ep) || ep < 0 || ep > 9) {
      showStatus('AUTO: set Entry Point (0-9)', 'warning');
      return;
    }

    pendingAutoRef.current = { mode: 'bulk', ct };
    autoBusyRef.current = false;
    showStatus(`AUTO armed → BULK will start on digit ${ep}`, 'info');
  };

  const startBulk = (ct: string) => {
    const count = parseInt(bulkCntRef.current?.value || '0', 10);
    const stake = parseFloat(stakeRef.current?.value || '10');
    const duration = parseInt(durRef.current?.value || '1', 10);
    const market = marketRef.current?.value || '1HZ10V';

    if (!count || !stake) {
      showStatus('Invalid bulk params', 'error');
      return;
    }

    bulkQ.current = {
      active: true,
      processing: false,
      queue: Array(count)
        .fill(null)
        .map((_, i) => ({
          id: `bulk-${Date.now()}-${i}`,
          contractType: ct,
          stake,
          market,
          duration,
          status: 'pending' as const,
          attempts: 0,
          maxAttempts: 3,
        })),
      completed: 0,
      failed: 0,
      total: count,
    };

    setBulk({ on: true, done: 0, fail: 0, tot: count });
    showStatus(`Bulk ×${count} started`, 'info');

    // ✅ force process immediately using turboRef.current (true "fire all at once")
    processBulk();
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

  const processBulk = async () => {
    if (!bulkQ.current || !bulkQ.current.active) return;

    // ✅ TURBO = fire all pending at once (concurrently)
    if (turboRef.current) {
      const pendings = bulkQ.current.queue.filter(q => q.status === 'pending');
      if (pendings.length === 0) return;

      bulkQ.current.processing = true;

      await Promise.all(
        pendings.map(async job => {
          job.status = 'processing';
          job.attempts++;
          try {
            await buy(job.contractType, true, job.id, job.stake, job.market, job.duration);
            job.status = 'executed';
          } catch {
            if (job.attempts >= job.maxAttempts) {
              job.status = 'failed';
              bulkQ.current!.failed++;
            } else {
              job.status = 'pending';
            }
          }
        })
      );

      bulkQ.current.processing = false;
      updateBulkProgress();

      // keep retrying remaining pendings (still in TURBO batches)
      if (bulkQ.current.active && bulkQ.current.queue.some(q => q.status === 'pending')) {
        setTimeout(processBulk, 150);
      }
      return;
    }

    // SAFE sequential mode
    if (bulkQ.current.processing) return;
    const next = bulkQ.current.queue.find(q => q.status === 'pending');
    if (!next) return;

    bulkQ.current.processing = true;
    next.status = 'processing';
    next.attempts++;

    try {
      await buy(next.contractType, true, next.id, next.stake, next.market, next.duration);
      next.status = 'executed';
    } catch {
      if (next.attempts >= next.maxAttempts) {
        next.status = 'failed';
        bulkQ.current.failed++;
      } else {
        next.status = 'pending';
      }
    } finally {
      bulkQ.current.processing = false;
      updateBulkProgress();
      if (bulkQ.current.active) processBulk();
    }
  };

  const stopBulk = (m = 'Bulk stopped') => {
    if (bulkQ.current) bulkQ.current.active = false;
    setBulk(b => ({ ...b, on: false }));
    showStatus(m, 'info');
  };

  const handleReset = () => {
    if (bulkQ.current) bulkQ.current.active = false;

    // also clear AUTO
    pendingAutoRef.current = null;
    autoBusyRef.current = false;

    setTrades([]);
    setPL(0);
    setBulk({ on: false, done: 0, fail: 0, tot: 0 });
    showStatus('History cleared', 'info');
  };

  // ✅ blink helper (dedup + auto-clear)
  const blinkPurchasedTickDigit = useCallback((key: string, digit: number) => {
    if (!Number.isFinite(digit)) return;

    if (lastBlinkKeyRef.current === key) return;
    lastBlinkKeyRef.current = key;

    if (purchasedBlinkTimerRef.current) {
      window.clearTimeout(purchasedBlinkTimerRef.current);
      purchasedBlinkTimerRef.current = null;
    }

    setPurchasedTickDigit(digit);

    purchasedBlinkTimerRef.current = window.setTimeout(() => {
      setPurchasedTickDigit(null);
    }, 900);
  }, []);

  const handleWS = (d: any) => {
    if (d.error?.message?.includes('proposal_open_contract')) return;

    if (d.error) {
      const { message } = getBalanceError(d);
      showStatus(message, 'error');
      console.error('WebSocket error:', d.error);
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

  const extractSettlementDigit = (c: any, marketFormat?: string) => {
    const v = c?.exit_tick ?? c?.exit_spot ?? c?.current_spot;
    if (v === undefined || v === null) return null;

    const num = Number(v);
    if (!Number.isFinite(num)) return null;

    let tickString: string;
    const mf = marketFormat || currentSymbol;
    if (['JD10', 'JD25', 'JD50', 'JD75', 'JD100'].includes(mf)) tickString = num.toFixed(2);
    else if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(mf)) tickString = num.toFixed(3);
    else if (mf === 'R_50' || mf === 'R_75') tickString = num.toFixed(4);
    else tickString = num.toFixed(2);

    const d = parseInt(tickString.slice(-1), 10);
    return Number.isFinite(d) ? d : null;
  };

  const handlePOC = (c: any) => {
    setTrades(prev =>
      prev.map(tr => {
        if (tr.id !== c.contract_id) return tr;

        const marketFmt = tr.marketFormat || currentSymbol;

        if (!tr.startTime && c.entry_tick_time) {
          tr.startTime = new Date(c.entry_tick_time * 1000);
          tr.entryValue = c.entry_tick ? Number(c.entry_tick) : undefined;
          tr.marketFormat = marketFmt;
        }

        if (c.tick_count && c.current_tick) tr.ticksRemaining = c.tick_count - c.current_tick;
        tr.currentValue = c.current_spot ? Number(c.current_spot) : tr.currentValue;

        const finished = c.is_sold || c.is_expired || c.is_settleable || c.status === 'sold';
        if (finished) {
          const net = Number(c.profit ?? 0);
          tr.status = net >= 0 ? 'won' : 'lost';
          tr.profit = net;
          tr.closeTime = new Date();
          tr.exitValue = c.exit_tick ? Number(c.exit_tick) : c.exit_spot ? Number(c.exit_spot) : undefined;
          playSound(net >= 0);

          const settlementDigit = extractSettlementDigit(c, marketFmt);
          if (settlementDigit !== null) blinkPurchasedTickDigit(`${c.contract_id}:${settlementDigit}`, settlementDigit);

          if (tr.isBulkTrade && bulkQ.current && !tr.counted) {
            tr.counted = true;
            if (net >= 0) bulkQ.current.completed++;
            else bulkQ.current.failed++;
            updateBulkProgress();
          }
        } else {
          tr.status = (c.status as TradeStatus) || 'active';
        }
        return { ...tr };
      })
    );
  };

  const handleTX = (tx: TTransaction) => {
    setTrades(prev =>
      prev.map(tr => {
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
      })
    );
  };

  const getTradeStats = () => {
    const completedTrades = trades.filter(t => t.status === 'won' || t.status === 'lost');
    return {
      total: completedTrades.length,
      won: completedTrades.filter(t => t.status === 'won').length,
      lost: completedTrades.filter(t => t.status === 'lost').length,
    };
  };

  const toggleMode = (mode: 'evenOdd' | 'overUnder' | 'riseFall') => setActiveMode(mode);

  const handleOverDigitSelect = (digit: number) => setAnalysisData(prev => ({ ...prev, overDigit: digit }));
  const handleUnderDigitSelect = (digit: number) => setAnalysisData(prev => ({ ...prev, underDigit: digit }));

  const refreshData = () => {
    if (marketSelectionRef.current && wsRef.current) {
      const newMarket = marketSelectionRef.current.value;
      setCurrentSymbol(newMarket);

      pendingAutoRef.current = null;
      autoBusyRef.current = false;

      wsRef.current.send(
        JSON.stringify({
          ticks_history: newMarket,
          style: 'ticks',
          count: 5000,
          end: 'latest',
          subscribe: 1,
        })
      );

      setAnalysisData({
        evenCount: 0,
        oddCount: 0,
        riseCount: 0,
        fallCount: 0,
        totalCount: 0,
        lastResults: [],
        lastDigit: null,
        lastPrice: null,
        digitCounts: Array(10).fill(0),
        overDigit: 1,
        underDigit: 7,
        tickRange: 100,
        currentMarket: newMarket,
      });
    }
  };

  const formatTickForMarket = (val: number, market: string) => {
    if (['JD10', 'JD25', 'JD50', 'JD75', 'JD100'].includes(market)) return val.toFixed(2);
    if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(market)) return val.toFixed(3);
    if (market === 'R_50' || market === 'R_75') return val.toFixed(4);
    return val.toFixed(2);
  };

  const updateDistribution = (lastDigit: number, val: number, isRise: boolean | null) => {
    const isEven = lastDigit % 2 === 0;
    setAnalysisData(prev => {
      const digitCounts = [...prev.digitCounts];
      digitCounts[lastDigit]++;

      const newLastResults = [{ digit: lastDigit, isEven, isRise, price: val, timestamp: new Date() }, ...prev.lastResults].slice(
        0,
        1000
      );

      return {
        ...prev,
        evenCount: isEven ? prev.evenCount + 1 : prev.evenCount,
        oddCount: !isEven ? prev.oddCount + 1 : prev.oddCount,
        riseCount: isRise === true ? prev.riseCount + 1 : prev.riseCount,
        fallCount: isRise === false ? prev.fallCount + 1 : prev.fallCount,
        totalCount: prev.totalCount + 1,
        lastResults: newLastResults,
        lastDigit,
        lastPrice: val,
        digitCounts,
        currentMarket: marketSelectionRef.current?.value || prev.currentMarket,
      };
    });
  };

  // ✅ LIVE tick handler: triggers AUTO only on LIVE ticks
  const handleTick = (val: number) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(() => {
      const prev = prevTickRef.current;
      if (prev === null) {
        prevTickRef.current = val;
        return;
      }

      const currentMarket = marketSelectionRef.current?.value || '1HZ10V';
      const tickString = formatTickForMarket(val, currentMarket);
      const lastDigit = parseInt(tickString.slice(-1), 10);

      let isRise: boolean | null = null;
      if (prevTickRef.current !== null) {
        if (val > prevTickRef.current) isRise = true;
        else if (val < prevTickRef.current) isRise = false;
      }

      // ✅ AUTO trigger (LIVE ONLY + ARMED)
      if (
        isLiveTickRef.current &&
        autoOnRef.current &&
        pendingAutoRef.current &&
        !autoBusyRef.current &&
        Number.isFinite(autoEntryRef.current) &&
        autoEntryRef.current === lastDigit
      ) {
        autoBusyRef.current = true;
        const action = pendingAutoRef.current;
        pendingAutoRef.current = null;

        showStatus(`AUTO triggered ✅ (digit ${lastDigit})`, 'success');

        (async () => {
          try {
            if (action.mode === 'both') {
              await Promise.all([buy(action.left), buy(action.right)]);
            } else if (action.mode === 'single') {
              await buy(action.ct);
            } else if (action.mode === 'bulk') {
              // ✅ start bulk and process with turboRef immediately
              startBulk(action.ct);
            }
          } catch {
            // buy() already sets status
          } finally {
            autoBusyRef.current = false;
          }
        })();
      }

      // update distribution
      updateDistribution(lastDigit, val, isRise);
      prevTickRef.current = val;
    }, 50);
  };

  // ✅ history ticks: populate distribution only (NO AUTO)
  const processHistoryPrices = (prices: number[]) => {
    if (!prices?.length) return;

    const currentMarket = marketSelectionRef.current?.value || '1HZ10V';
    const lastN = prices.slice(0, 5000);

    setAnalysisData(prev => ({
      ...prev,
      evenCount: 0,
      oddCount: 0,
      riseCount: 0,
      fallCount: 0,
      totalCount: 0,
      lastResults: [],
      lastDigit: null,
      lastPrice: null,
      digitCounts: Array(10).fill(0),
      currentMarket,
    }));

    lastN.forEach(price => {
      const tickString = formatTickForMarket(Number(price), currentMarket);
      const lastDigit = parseInt(tickString.slice(-1), 10);
      const isEven = lastDigit % 2 === 0;

      setAnalysisData(prev => {
        const digitCounts = [...prev.digitCounts];
        digitCounts[lastDigit]++;

        const newLastResults = [
          { digit: lastDigit, isEven, isRise: null, price: Number(price), timestamp: new Date() },
          ...prev.lastResults,
        ].slice(0, 1000);

        return {
          ...prev,
          evenCount: isEven ? prev.evenCount + 1 : prev.evenCount,
          oddCount: !isEven ? prev.oddCount + 1 : prev.oddCount,
          totalCount: prev.totalCount + 1,
          lastResults: newLastResults,
          lastDigit,
          lastPrice: Number(price),
          digitCounts,
          currentMarket,
        };
      });
    });

    prevTickRef.current = Number(lastN[lastN.length - 1]);
  };

  const renderEvenOddHistory = () =>
    analysisData.lastResults.slice(0, 100).map((result, index) => (
      <div key={index} className="history-item" style={{ color: result.isEven ? '#2ecc71' : '#e74c3c' }}>
        {result.isEven ? 'E' : 'O'}
      </div>
    ));

  const renderOverUnderHistory = () =>
    analysisData.lastResults.slice(0, 100).map((result, index) => {
      const isOver = analysisData.overDigit === 0 ? result.digit > 0 : result.digit > analysisData.overDigit;
      const isUnder = result.digit < analysisData.underDigit;

      return (
        <div
          key={index}
          className="history-item"
          style={{
            backgroundColor: isOver && isUnder ? '#9b59b6' : undefined,
            color: isOver ? '#e74c3c' : isUnder ? '#2ecc71' : undefined,
          }}
          title={`Price: ${result.price}`}
        >
          {result.digit}
        </div>
      );
    });

  const renderRiseFallHistory = () => {
    const filteredResults = analysisData.lastResults.filter(result => result.isRise !== null).slice(0, 100);
    if (filteredResults.length === 0) {
      return (
        <div className="no-results-message">
          {analysisData.lastResults.length === 0 ? 'Waiting for first price data...' : 'No price changes detected'}
        </div>
      );
    }

    return filteredResults.map((result, index) => (
      <div
        key={index}
        className="history-item"
        style={{
          color: result.isRise ? '#2ecc71' : result.isRise === false ? '#e74c3c' : '#3498db',
        }}
        title={`Price: ${result.price}`}
      >
        {result.isRise ? '↑' : result.isRise === false ? '↓' : '='}
      </div>
    ));
  };

  const totalDigits = Math.max(analysisData.totalCount || 0, 1);

  const digitsData = useMemo(() => {
    const raw = Array.from({ length: 10 }).map((_, d) => {
      const count = analysisData.digitCounts[d] || 0;
      const pct = (count / totalDigits) * 100;
      return { digit: d, count, pct };
    });

    const sorted = [...raw].sort((a, b) => (b.count - a.count) || (a.digit - b.digit));

    const top1 = sorted[0]?.digit ?? null;
    const top2 = sorted[1]?.digit ?? null;
    const top3 = sorted[2]?.digit ?? null;

    const minCount = Math.min(...raw.map(x => x.count));
    const leastCandidates = raw.filter(x => x.count === minCount);
    const least = leastCandidates.length ? [...leastCandidates].sort((a, b) => b.digit - a.digit)[0].digit : null;

    const withRank = raw.map(x => {
      let rank: 1 | 2 | 3 | 4 | null = null;
      if (x.digit === top1) rank = 1;
      else if (x.digit === top2) rank = 2;
      else if (x.digit === top3) rank = 3;
      else if (x.digit === least) rank = 4;
      return { ...x, rank };
    });

    return withRank.sort((a, b) => a.digit - b.digit);
  }, [analysisData.digitCounts, totalDigits]);

  const latestDigit = analysisData.lastDigit;

  const R = 22;
  const C = 2 * Math.PI * R;

  const ringDash = (pct: number) => {
    const clamped = Math.max(0, Math.min(100, pct));
    const dash = (clamped / 100) * C;
    return `${dash} ${C - dash}`;
  };

  useEffect(() => {
    const sub = api_base.api.onMessage().subscribe(({ data }: any) => handleWS(data));
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades]);

  useEffect(() => {
    const initializeWebSocket = (symbol: string) => {
      if (wsRef.current) wsRef.current.close();

      pendingAutoRef.current = null;
      autoBusyRef.current = false;

      const app_id = 1089;
      wsRef.current = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);

      wsRef.current.onopen = () => {
        wsRef.current?.send(
          JSON.stringify({
            ticks_history: symbol,
            style: 'ticks',
            count: 5000,
            end: 'latest',
            subscribe: 1,
          })
        );

        setAnalysisData(prev => ({
          ...prev,
          evenCount: 0,
          oddCount: 0,
          riseCount: 0,
          fallCount: 0,
          totalCount: 0,
          lastResults: [],
          lastDigit: null,
          lastPrice: null,
          digitCounts: Array(10).fill(0),
          currentMarket: symbol,
        }));
      };

      wsRef.current.onmessage = event => {
        const data = JSON.parse(event.data);

        if (data?.error) {
          console.error('WebSocket error:', data.error.message);
          return;
        }

        if (data?.msg_type === 'history') {
          isLiveTickRef.current = false;
          const prices: number[] = data.history.prices.map(Number);
          processHistoryPrices(prices);
          return;
        }

        if (data?.msg_type === 'tick') {
          isLiveTickRef.current = true;
          handleTick(data.tick.quote);
        }
      };

      wsRef.current.onerror = err => console.error('WebSocket error: ', err);
    };

    if (marketSelectionRef.current) initializeWebSocket(marketSelectionRef.current.value);

    return () => {
      if (wsRef.current) wsRef.current.close();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (purchasedBlinkTimerRef.current) window.clearTimeout(purchasedBlinkTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketSelectionRef.current?.value]);

  useEffect(() => {
    const id = setInterval(() => {
      setTrades(prev =>
        prev.map(tr => {
          if (tr.status === 'pending') {
            const age = Date.now() - tr.timestamp.getTime();
            if (age > 8000) return { ...tr, status: 'error', temp: false };
          }
          return tr;
        })
      );
    }, 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setPL(trades.reduce((s, t) => s + (t.profit ?? 0), 0));
  }, [trades]);

  useEffect(() => {
    setCT({ left: mapContracts(strategy)[0], right: mapContracts(strategy)[1] });

    if (digitRef.current) {
      const need = needsDigit(strategy);
      digitRef.current.disabled = !need;
      digitRef.current.style.backgroundColor = need ? '' : 'gray';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy]);

  const posClass = (st: TradeStatus) =>
    st === 'won' ? 'position-win' : st === 'lost' || st === 'error' ? 'position-loss' : 'position-open';

  const formatTickValue = (value?: number, marketFormat?: string) => {
    if (value === undefined) return '—';
    if (['JD10', 'JD25', 'JD50', 'JD75', 'JD100'].includes(marketFormat || '')) return value.toFixed(2);
    if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(marketFormat || '')) return value.toFixed(3);
    if (['R_50', 'R_75'].includes(marketFormat || '')) return value.toFixed(4);
    return value.toFixed(2);
  };

  const tradeStats = getTradeStats();

  return (
    <div className="bot-app" style={{ background: ui.is_dark_mode_on ? 'var(--general-main-1)' : 'transparent' }}>
      {/* Analysis Mode Selector */}
      <div className="analysis-mode-selector">
        <ul className="mode-list">
          <li>
            <button className={`mode-btn ${activeMode === 'evenOdd' ? 'active' : ''}`} onClick={() => toggleMode('evenOdd')} style={{ padding: '10px' }}>
              Even/Odd
            </button>
          </li>
          <li>
            <button className={`mode-btn ${activeMode === 'overUnder' ? 'active' : ''}`} onClick={() => toggleMode('overUnder')} style={{ padding: '10px' }}>
              Over/Under
            </button>
          </li>
          <li>
            <button className={`mode-btn ${activeMode === 'riseFall' ? 'active' : ''}`} onClick={() => toggleMode('riseFall')} style={{ padding: '10px' }}>
              Rise/Fall
            </button>
          </li>
        </ul>
      </div>

      {/* Market Selector (top) */}
      <div className="market-selector one">
        <i className="fas fa-chart-line market-icon"></i>
        <select
          className="marketSelection"
          id="marketSelection"
          ref={marketSelectionRef}
          onChange={e => {
            const newMarket = e.target.value;
            setCurrentSymbol(newMarket);
            if (marketRef.current) marketRef.current.value = newMarket;

            pendingAutoRef.current = null;
            autoBusyRef.current = false;

            if (wsRef.current) {
              wsRef.current.send(
                JSON.stringify({
                  ticks_history: newMarket,
                  style: 'ticks',
                  count: 5000,
                  end: 'latest',
                  subscribe: 1,
                })
              );
            }

            setAnalysisData(prev => ({
              ...prev,
              evenCount: 0,
              oddCount: 0,
              riseCount: 0,
              fallCount: 0,
              totalCount: 0,
              lastResults: [],
              lastDigit: null,
              lastPrice: null,
              digitCounts: Array(10).fill(0),
              overDigit: 1,
              underDigit: 7,
              tickRange: 100,
              currentMarket: newMarket,
            }));
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
          <option value="JD10">Jump 10 Index</option>
          <option value="JD25">Jump 25 Index</option>
          <option value="JD50">Jump 50 Index</option>
          <option value="JD75">Jump 75 Index</option>
          <option value="JD100">Jump 100 Index</option>
        </select>
      </div>

      {/* ✅ FULL SVG DIGITS CONTAINER */}
      <div className="digits-container">
        <div className="digits">
          {digitsData.map(({ digit, pct, count, rank }) => {
            const isLatest = latestDigit === digit;
            const isPurchased = purchasedTickDigit === digit;
            const isSelected = selectedDigit === digit;

            const rankClass =
              rank === 1
                ? 'progress__value--rank-1'
                : rank === 2
                  ? 'progress__value--rank-2'
                  : rank === 3
                    ? 'progress__value--rank-3'
                    : rank === 4
                      ? 'progress__value--rank-last'
                      : '';

            return (
              <div
                key={digit}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedDigit(prev => (prev === digit ? null : digit))}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedDigit(prev => (prev === digit ? null : digit));
                  }
                }}
                className={[
                  'digits__digit',
                  isLatest ? 'digits__digit--latest' : '',
                  isPurchased ? 'digits__digit--purchased' : '',
                  isSelected ? 'digits__digit--selected' : '',
                ].join(' ')}
                title={`${digit}: ${count} (${pct.toFixed(4)}%)`}
              >
                <div className="digits__pie-container" aria-hidden>
                  <svg className="digits__pie-progress" viewBox="0 0 56 56">
                    <circle className="progress__bg" cx="28" cy="28" r={22} />
                    <circle
                      className={['progress__value', rankClass].join(' ')}
                      cx="28"
                      cy="28"
                      r={22}
                      strokeDasharray={`${C} ${C}`}
                      strokeDashoffset="0"
                    />
                  </svg>
                </div>

                <div className="digits__digit-value">
                  <div className="digits__digit-display-value">{digit}</div>
                  <div className="digits__digit-display-percentage">{pct.toFixed(2)}%</div>
                </div>
              </div>
            );
          })}

        </div>
      </div>

      {/* ✅ SINGLE PURCHASE BUTTONS (TOP) */}
      <div className="trade-buttons trade-buttons--single-top">
        <button className="trade-btn even-btn" onClick={() => armOrBuy('left')} title={bothMode ? 'Both mode: TWO trades will be placed' : ''}>
          <span className="button-icon">{contractIcons[ctypes.left] || null}</span>
          {label(ctypes.left)}
          {bothMode ? ' (Both)' : ''}
        </button>

        <button className="trade-btn odd-btn" onClick={() => armOrBuy('right')} title={bothMode ? 'Both mode: TWO trades will be placed' : ''}>
          <span className="button-icon">{contractIcons[ctypes.right] || null}</span>
          {label(ctypes.right)}
          {bothMode ? ' (Both)' : ''}
        </button>
      </div>

      {/* Analysis Sections */}
      <div id="evenOddSection" className="analysis-section" style={{ display: activeMode === 'evenOdd' ? 'block' : 'none' }} />

      <div id="overUnderSection" className="analysis-section" style={{ display: activeMode === 'overUnder' ? 'block' : 'none', minWidth: '100%' }}>
        <div className="control-panel">
          <div className="selector-container">
            <div className="selector-header">
              <div className="selector-title">Over Analysis</div>
            </div>
            <div className="digit-selector" id="overSelector">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(digit => (
                <button
                  key={`over-${digit}`}
                  className={`digit-btn over-btn ${analysisData.overDigit === digit ? 'active' : ''}`}
                  onClick={() => handleOverDigitSelect(digit)}
                >
                  {digit}
                </button>
              ))}
            </div>
          </div>

          <div className="selector-container">
            <div className="selector-header">
              <div className="selector-title">Under Analysis</div>
              <div style={{ width: '60px' }} />
            </div>
            <div className="digit-selector" id="underSelector">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(digit => (
                <button
                  key={`under-${digit}`}
                  className={`digit-btn under-btn ${analysisData.underDigit === digit ? 'active' : ''}`}
                  onClick={() => handleUnderDigitSelect(digit)}
                >
                  {digit}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div id="riseFallSection" className="analysis-section" style={{ display: activeMode === 'riseFall' ? 'block' : 'none', minWidth: '100%' }} />

      {/* Panel */}
      <div className="trading-container">
        <div className="history-title">Panel</div>

        <div className="trade-control-group execution">
          <label>Execution Mode</label>
          <div className="execution-mode-toggle">
            <button
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: turbo ? 'green' : 'red',
                borderColor: turbo ? 'green' : 'red',
                color: '#fff',
              }}
              onClick={() => setTurboMode(true)}
            >
              Turbo
            </button>
            <button
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: !turbo ? 'green' : 'red',
                borderColor: !turbo ? 'green' : 'red',
                color: '#fff',
              }}
              onClick={() => setTurboMode(false)}
            >
              Safe
            </button>
          </div>
          {turbo && <div className="execution-mode-warning">⚡ Faster execution: all bulk trades fire at once.</div>}
        </div>

        <div className="trade-controls">
          <div className="trade-control-group market-selector">
            <label>Market</label>
            <select
              id="tradeMarket"
              className="trade-input"
              ref={marketRef}
              value={currentSymbol}
              onChange={e => {
                const newMarket = e.target.value;
                setCurrentSymbol(newMarket);
                if (marketSelectionRef.current) marketSelectionRef.current.value = newMarket;

                pendingAutoRef.current = null;
                autoBusyRef.current = false;

                if (wsRef.current) {
                  wsRef.current.send(
                    JSON.stringify({
                      ticks_history: newMarket,
                      style: 'ticks',
                      count: 5000,
                      end: 'latest',
                      subscribe: 1,
                    })
                  );
                }

                setAnalysisData(prev => ({
                  ...prev,
                  evenCount: 0,
                  oddCount: 0,
                  riseCount: 0,
                  fallCount: 0,
                  totalCount: 0,
                  lastResults: [],
                  lastDigit: null,
                  lastPrice: null,
                  digitCounts: Array(10).fill(0),
                  currentMarket: newMarket,
                }));
              }}
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
            <label>Strategy</label>
            <select className="trade-input" ref={strategyRef} value={strategy} onChange={e => setStrat(e.target.value)}>
              <option value="even">Even</option>
              <option value="odd">Odd</option>
              <option value="matches">Matches</option>
              <option value="differs">Differs</option>
              <option value="over">Over</option>
              <option value="under">Under</option>
              <option value="rise">Rise</option>
              <option value="fall">Fall</option>
            </select>
          </div>

          <div className="trade-control-group">
            <label>Stake (USD)</label>
            <input type="number" className="trade-input" defaultValue="10" min="1" step="1" ref={stakeRef} />
          </div>

          <div className="trade-control-group">
            <label>Duration (ticks)</label>
            <input type="number" className="trade-input" defaultValue="1" min="1" step="1" ref={durRef} />
          </div>

          <div className="trade-control-group">
            <label>Prediction</label>
            <input
              type="number"
              className="trade-input"
              defaultValue="1"
              min="0"
              max="9"
              step="1"
              ref={digitRef}
              disabled={!needsDigit(strategy)}
              style={{ backgroundColor: needsDigit(strategy) ? '' : 'gray' }}
            />
          </div>

          <div className="trade-control-group">
            <label>Both</label>
            <button
              className={`both-toggle ${bothMode ? 'on' : 'off'}`}
              onClick={() => setBothMode(b => !b)}
              style={{
                padding: '.4rem .8rem',
                background: bothMode ? 'linear-gradient(90deg,#0f9d58,#34a853)' : '#555',
                color: '#fff',
                border: '1px solid #222',
                borderRadius: '4px',
                fontWeight: 'bold',
              }}
              title="When ON, single trade buttons buy both sides simultaneously"
            >
              {bothMode ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* ✅ AUTO beside BOTH */}
          <div className="trade-control-group">
            <label>Entry</label>
            <button
              onClick={() => {
                setAutoOn(v => !v);
                pendingAutoRef.current = null;
                autoBusyRef.current = false;
                showStatus(`AUTO ${!autoOn ? 'ON' : 'OFF'}`, 'info');
              }}
              style={{
                padding: '.4rem .8rem',
                background: autoOn ? 'linear-gradient(90deg,#1565c0,#42a5f5)' : '#555',
                color: '#fff',
                border: '1px solid #222',
                borderRadius: '4px',
                fontWeight: 'bold',
              }}
              title="When ON, buy is ARMED and only triggers when last digit matches Entry Point"
            >
              {autoOn ? 'ON' : 'OFF'}
            </button>
          </div>

          {autoOn && (
            <div className="trade-control-group">
              <label>Entry Point</label>
              <input
                type="text"
                className="trade-input"
                value={autoEntryDigit}
                placeholder="0-9"
                inputMode="numeric"
                onChange={e => {
                  const v = e.target.value;
                  if (v === '') return setAutoEntryDigit('');   // ✅ stays blank
                  if (/^\d$/.test(v)) return setAutoEntryDigit(v); // ✅ single digit 0-9 only
                }}
                title="AUTO triggers when LIVE tick last digit equals this value"
              />
            </div>
          )}
        </div>

        <div className="title">
          <small>Type</small>
          <small>Entry/Exit spot</small>
          <small>Buy price and P/L</small>
        </div>

        <div className="open-positions">
          {trades.length === 0 ? (
            <div className="no-positions">
              <small>No positions</small>
            </div>
          ) : (
            trades.map(tr => (
              <div key={tr.id} className={`position-item ${posClass(tr.status)}`}>
                <div className="position-header">
                  <div className="position-market-contract">
                    {marketIcons[tr.market] || <span>{tr.market}</span>}
                    {contractIcons[tr.contractType] || <span>{label(tr.contractType)}</span>}
                  </div>

                  {tr.status === 'error' && (
                    <div className="error-display">
                      <span
                        className="error-badge"
                        title={tr.errorDetails || 'Trade failed'}
                        onClick={() => showStatus(tr.errorDetails || 'Trade failed', 'error')}
                      >
                        ! {tr.errorReason === 'Insufficient balance' && '💰'}
                      </span>
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
            ))
          )}
        </div>

        <div className="trade-buttons">
          <button className="trade-btn reset-btn" onClick={handleReset}>
            Reset
          </button>
        </div>

        <div className="trade-control-group">
          <label>Bulk Count</label>
          <input type="number" className="trade-input" defaultValue="10" min="1" step="1" ref={bulkCntRef} />
        </div>

        <div className="trade-buttons">
          <button className="trade-btn even-btn" onClick={() => armOrStartBulk(ctypes.left)}>
            <span className="button-icon">{contractIcons[ctypes.left] || null}</span>
            Bulk {label(ctypes.left)}
          </button>
          <button className="trade-btn odd-btn" onClick={() => armOrStartBulk(ctypes.right)}>
            <span className="button-icon">{contractIcons[ctypes.right] || null}</span>
            Bulk {label(ctypes.right)}
          </button>
          <button className="trade-btn stop-btn" onClick={() => stopBulk()} disabled={!bulk.on}>
            Stop Bulk
          </button>
        </div>

        <div className={`trade-status status-${msg.type}`}>{msg.txt}</div>

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

      {/* History */}
      <div className="history-container">
        <div className="history-title">
          Analysis Chamber
          <button className="refresh-btn" id="refreshBtn" onClick={refreshData}>
            <i className="fas fa-sync-alt"></i> Refresh
          </button>
        </div>

        <div className="history-items" id="lastResults" style={{ display: activeMode === 'evenOdd' ? 'flex' : 'none' }}>
          {renderEvenOddHistory()}
        </div>

        <div className="history-items" id="lastResultsOverUnder" style={{ display: activeMode === 'overUnder' ? 'flex' : 'none' }}>
          {renderOverUnderHistory()}
        </div>

        <div className="history-items" id="lastResultsRiseFall" style={{ display: activeMode === 'riseFall' ? 'flex' : 'none', minWidth: '100%' }}>
          {renderRiseFallHistory()}
        </div>
      </div>
    </div>
  );
});

export default BotIframe;
