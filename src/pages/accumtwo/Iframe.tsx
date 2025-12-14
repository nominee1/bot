import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { api_base } from '@/external/bot-skeleton';
import {
  LegacyExitSpotIcon,
  LegacyEntrySpotIcon,
  TradeTypesDigitsMatchesIcon,
  TradeTypesDigitsOverIcon,
  TradeTypesDigitsUnderIcon,
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
import './Iframe.scss';

type TradeStatus = 'pending' | 'open' | 'active' | 'won' | 'lost' | 'completed' | 'error';

interface TTrade {
  id: string;
  contractType: string;
  stake: number;
  takeProfit?: number;
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
  barrier?: string;
  selectedDigit?: number;
  isBulkTrade?: boolean;
  bulkTradeId?: string;
  counted?: boolean;
  marketFormat?: string;
  _debugId?: string;
  _bulkIndex?: number;
}

type TTransaction = {
  contract_id: string;
  amount: number;
  transaction_time: number;
};

let incrCounter = 0;
const genTempId = () => {
  incrCounter = (incrCounter + 1) % 1_000_000_000;
  return `tmp_${Date.now()}_${incrCounter}`;
};

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
  '1HZ15V': <MarketDerivedVolatility151sIcon width={16} height={16} />,
  '1HZ30V': <MarketDerivedVolatility301sIcon width={16} height={16} />,
  '1HZ90V': <MarketDerivedVolatility901sIcon width={16} height={16} />,
  '1HZ75V': <MarketDerivedVolatility751sIcon width={16} height={16} />
};

const contractIcons: Record<string, JSX.Element> = {
  'DIGITMATCH': <TradeTypesDigitsMatchesIcon width={16} height={16} />,
  'DIGITOVER': <TradeTypesDigitsOverIcon width={16} height={16} />,
  'DIGITUNDER': <TradeTypesDigitsUnderIcon width={16} height={16} />
};

const digitColors = [
  '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
  '#FF9F40', '#8AC249', '#EA5F89', '#00BFFF', '#A0522D'
];

const Iframe = observer(() => {
  const { ui } = useStore();

  const [trades, setTrades] = useState<TTrade[]>([]);
  const [profitLoss, setPL] = useState(0);
  const [msg, setMsg] = useState<{ txt: string; type: 'info' | 'success' | 'error' | 'loading' | 'warning' }>({ txt: '', type: 'info' });
  const [bulk, setBulk] = useState({ on: false, done: 0, fail: 0, tot: 0 });
  const [turbo, setTurbo] = useState(false);
  const [strategy, setStrat] = useState('matches');
  const [ctypes, setCT] = useState<{ left: string; right: string }>({ left: 'DIGITMATCH', right: 'DIGITOVER' });
  const [currentSymbol, setCurrentSymbol] = useState('1HZ10V');
  const [activeMode, setActiveMode] = useState<'matches' | 'overUnder'>('matches');
  const [activeDigits, setActiveDigits] = useState<number[]>([2, 4, 6]); // Default digits: 2, 4, 6
  const [activeOverUnderDigit, setActiveOverUnderDigit] = useState<number | null>(null);
  const [filterCount, setFilterCount] = useState(100);

  const tempToRealRef = useRef<Map<string, string>>(new Map());
  const realToTempRef = useRef<Map<string, string>>(new Map());

  const [analysisData, setAnalysisData] = useState({
    lastResults: [] as Array<{
      digit: number;
      price: number;
      timestamp: Date;
    }>,
    lastDigit: null as number | null,
    lastPrice: null as number | null,
    digitCounts: Array(10).fill(0),
    currentMarket: "1HZ10V"
  });

  const marketSelectionRef = useRef<HTMLSelectElement>(null);
  const marketRef = useRef<HTMLSelectElement>(null);
  const strategyRef = useRef<HTMLSelectElement>(null);
  const stakeRef = useRef<HTMLInputElement>(null);
  const takeProfitRef = useRef<HTMLInputElement>(null);
  const durRef = useRef<HTMLSelectElement>(null);
  const digitRef = useRef<HTMLInputElement>(null);
  const bulkCntRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const subs = useRef<Set<string>>(new Set());
  const prevTickRef = useRef<number | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();

  const [bulkQueue, setBulkQueue] = useState<{
    active: boolean;
    processing: boolean;
    queue: {
      id: string;
      contractType: string;
      stake: number;
      takeProfit?: number;
      market: string;
      duration: number;
      digit?: number;
      status: 'pending' | 'processing' | 'executed' | 'failed';
      attempts: number;
      maxAttempts: number;
      _bulkIndex: number;
    }[];
    completed: number;
    failed: number;
    total: number;
    currentIndex: number;
    bulkId: string;
  } | null>(null);

  const logTradeEvent = (eventType: string, data: any) => {
    console.log(`[Trade ${eventType}]`, {
      timestamp: new Date().toISOString(),
      ...data
    });
  };

  const calculateDigitStats = () => {
    const filteredResults = analysisData.lastResults.slice(0, filterCount);
    const total = filteredResults.length;
    const digitCounts = Array(10).fill(0);

    filteredResults.forEach(result => {
      digitCounts[result.digit]++;
    });

    const maxCount = Math.max(...digitCounts);
    const minCount = Math.min(...digitCounts);

    return {
      digitCounts,
      total,
      digitsData: digitCounts.map((count, digit) => {
        const percentage = total > 0 ? (count / total) * 100 : 0;
        return {
          digit,
          count,
          percentage,
          isMax: count === maxCount && maxCount > 0,
          isMin: count === minCount && minCount > 0 && minCount !== maxCount
        };
      })
    };
  };

  const { digitCounts, total, digitsData } = calculateDigitStats();

  const calculateStrokeValues = () => {
    const circumference = 2 * Math.PI * 27; // Circumference of the circle
    const dashValue = circumference / 2; // Half the circumference
    const dashArray = `${dashValue} ${circumference}`;
    const dashOffset = circumference / 4; // This positions the start at the top
    return { dashArray, dashOffset };
  };

  const subContract = async (id: string) => {
    if (subs.current.has(id)) return;
    try {
      await api_base.api.send({ proposal_open_contract: 1, contract_id: id, subscribe: 1 });
      subs.current.add(id);
      logTradeEvent('Subscription', { contractId: id });
    } catch (e) {
      logTradeEvent('SubscriptionError', { contractId: id, error: e });
      console.warn('Subscription error (non-critical):', e);
    }
  };

  const unsubContract = async (id: string) => {
    if (!subs.current.has(id)) return;
    try {
      await api_base.api.send({ proposal_open_contract: 0, contract_id: id });
      subs.current.delete(id);
      logTradeEvent('Unsubscription', { contractId: id });
    } catch (e) {
      logTradeEvent('UnsubscriptionError', { contractId: id, error: e });
      console.warn('Unsubscription error (non-critical):', e);
    }
  };

  const showStatus = (txt: string, type: 'info' | 'success' | 'error' | 'loading' | 'warning' = 'info') =>
    setMsg({ txt, type });

  const playSound = (ok: boolean) => {
    try {
      const a = new Audio(ok ? '/sounds/success.mp3' : '/sounds/fail.mp3');
      a.volume = .5; a.play().catch(() => { });
    } catch { }
  };

  const needsDigit = (s: string) => ['matches', 'over', 'under'].includes(s);

  const mapContracts = (s: string): [string, string] => ({
    matches: ['DIGITMATCH', 'DIGITOVER'],
    over: ['DIGITOVER', 'DIGITUNDER'],
    under: ['DIGITUNDER', 'DIGITOVER'],
  }[s] ?? ['DIGITMATCH', 'DIGITOVER']);

  const label = (ct: string) => ({
    DIGITMATCH: 'Matches',
    DIGITOVER: 'Over',
    DIGITUNDER: 'Under'
  } as Record<string, string>)[ct] ?? ct;

  const buy = async (ct: string, isBulk = false, bulkId?: string,
    stakeOv?: number, marketOv?: string, durOv?: number, digitOv?: number, bulkIndex?: number) => {
    const stake = stakeOv ?? parseFloat(stakeRef.current?.value || '0');
    const takeProfit = parseFloat(takeProfitRef.current?.value || '0');
    const dur = durOv ?? parseInt(durRef.current?.value || '1', 10);
    const market = marketOv ?? marketRef.current?.value ?? '1HZ10V';

    let barrier: string | undefined;
    if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH'].includes(ct)) {
      const d = digitOv ?? (digitRef.current ? parseInt(digitRef.current.value, 10) : NaN);
      if (isNaN(d)) { showStatus('Enter digit 0-9', 'error'); throw new Error('digit'); }
      barrier = d.toString();
    }

    const tmpID = genTempId();
    const digitUsed = barrier ? Number(barrier) : undefined;
    const tradeDebugId = `${ct}-${digitUsed ?? 'N/A'}-${tmpID.slice(-4)}`;

    const newTrade: TTrade = {
      id: tmpID,
      contractType: ct,
      stake,
      takeProfit,
      market,
      duration: dur,
      status: 'pending',
      timestamp: new Date(),
      barrier: barrier,
      selectedDigit: digitUsed,
      isBulkTrade: isBulk,
      bulkTradeId: bulkId,
      marketFormat: currentSymbol,
      _debugId: tradeDebugId,
      _bulkIndex: bulkIndex
    };

    logTradeEvent('Creation', {
      id: tradeDebugId,
      contractType: ct,
      digit: digitOv,
      stake,
      takeProfit,
      market,
      duration: dur,
      barrier,
      isBulk,
      bulkId,
      bulkIndex
    });

    setTrades(t => [newTrade, ...t]);

    try {
      const resp = await api_base.api.send({
        buy: 1, price: stake,
        parameters: {
          amount: stake, basis: 'stake', currency: 'USD',
          contract_type: ct, duration: dur, duration_unit: 't', symbol: market,
          ...(barrier ? { barrier } : {})
        }
      });

      if (resp.error) {
        logTradeEvent('CreationError', {
          id: tradeDebugId,
          error: resp.error.message
        });
        throw new Error(resp.error.message);
      }

      const realID = resp.buy.contract_id.toString();
      tempToRealRef.current.set(tmpID, realID);
      realToTempRef.current.set(realID, tmpID);

      logTradeEvent('Open', {
        id: tradeDebugId,
        realId: realID,
        status: 'open',
        barrier
      });

      setTrades(t => t.map(tr =>
        tr.id === tmpID ? { ...tr, id: realID, status: 'open' } : tr
      ));

      subContract(realID);
      showStatus('Next ✅ ', 'success');
      return realID;

    } catch (e: any) {
      tempToRealRef.current.delete(tmpID);
      logTradeEvent('CreationFailed', {
        id: tradeDebugId,
        error: e.message
      });
      setTrades(t => t.filter(tr => tr.id !== tmpID));
      showStatus(`Trade failed: ${e.message}`, 'error');
      throw e;
    }
  };

  const startBulk = (ct: string) => {
    const count = parseInt(bulkCntRef.current?.value || '0', 10);
    const stake = parseFloat(stakeRef.current?.value || '10');
    const takeProfit = parseFloat(takeProfitRef.current?.value || '0');
    const duration = parseInt(durRef.current?.value || '1', 10);
    const market = marketRef.current?.value || '1HZ10V';

    if (!count || !stake) { showStatus('Invalid bulk params', 'error'); return; }

    let digitsToUse: number[] = [];
    if (activeMode === 'matches' && activeDigits.length > 0) {
      digitsToUse = activeDigits;
    } else if (activeMode === 'overUnder' && activeOverUnderDigit !== null) {
      digitsToUse = [activeOverUnderDigit];
    } else {
      showStatus('Select at least one digit', 'error');
      return;
    }

    const bulkId = `bulk-${Date.now()}`;
    const queue = [];
    for (let i = 0; i < count; i++) {
      const digitIndex = i % digitsToUse.length;
      queue.push({
        id: `${bulkId}-${i}`,
        contractType: ct,
        stake,
        takeProfit,
        market,
        duration,
        digit: digitsToUse[digitIndex],
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        _bulkIndex: i
      });
    }

    const newBulkQueue = {
      active: true,
      processing: false,
      queue,
      completed: 0,
      failed: 0,
      total: count,
      currentIndex: 0,
      bulkId
    };

    logTradeEvent('BulkStart', {
      bulkId,
      count,
      contractType: ct,
      digits: digitsToUse,
      queue: newBulkQueue.queue.map(q => ({
        id: q.id,
        digit: q.digit,
        stake: q.stake,
        index: q._bulkIndex
      }))
    });

    setBulkQueue(newBulkQueue);
    setBulk({ on: true, done: 0, fail: 0, tot: count });
    showStatus(`Bulk ×${count} started`, 'info');
    processBulk(newBulkQueue);
  };

  const processBulk = async (queueState: NonNullable<typeof bulkQueue>) => {
    if (!queueState.active || queueState.processing) return;

    if (queueState.currentIndex >= queueState.queue.length) {
      updateBulkProgress(queueState);
      return;
    }

    const updatedQueue = {
      ...queueState,
      processing: true
    };
    setBulkQueue(updatedQueue);

    const currentJob = updatedQueue.queue[updatedQueue.currentIndex];
    const updatedQueueItems = [...updatedQueue.queue];
    updatedQueueItems[updatedQueue.currentIndex] = {
      ...currentJob,
      status: 'processing',
      attempts: currentJob.attempts + 1
    };

    logTradeEvent('BulkProcessing', {
      bulkId: queueState.bulkId,
      jobId: currentJob.id,
      attempt: currentJob.attempts + 1,
      digit: currentJob.digit,
      index: updatedQueue.currentIndex,
      bulkIndex: currentJob._bulkIndex
    });

    try {
      await buy(
        currentJob.contractType,
        true,
        queueState.bulkId,
        currentJob.stake,
        currentJob.market,
        currentJob.duration,
        currentJob.digit,
        currentJob._bulkIndex
      );

      updatedQueueItems[updatedQueue.currentIndex] = {
        ...updatedQueueItems[updatedQueue.currentIndex],
        status: 'executed'
      };

      const newQueueState = {
        ...updatedQueue,
        queue: updatedQueueItems,
        completed: updatedQueue.completed + 1,
        currentIndex: updatedQueue.currentIndex + 1,
        processing: false
      };

      logTradeEvent('BulkSuccess', {
        bulkId: queueState.bulkId,
        jobId: currentJob.id,
        index: updatedQueue.currentIndex,
        bulkIndex: currentJob._bulkIndex
      });

      setBulkQueue(newQueueState);
      updateBulkProgress(newQueueState);

      if (newQueueState.active && newQueueState.currentIndex < newQueueState.queue.length) {
        setTimeout(() => processBulk(newQueueState), turbo ? 0 : 300);
      }
    } catch (e) {
      if (currentJob.attempts >= currentJob.maxAttempts) {
        updatedQueueItems[updatedQueue.currentIndex] = {
          ...updatedQueueItems[updatedQueue.currentIndex],
          status: 'failed'
        };

        const newQueueState = {
          ...updatedQueue,
          queue: updatedQueueItems,
          failed: updatedQueue.failed + 1,
          currentIndex: updatedQueue.currentIndex + 1,
          processing: false
        };

        logTradeEvent('BulkFailed', {
          bulkId: queueState.bulkId,
          jobId: currentJob.id,
          index: updatedQueue.currentIndex,
          bulkIndex: currentJob._bulkIndex,
          error: e instanceof Error ? e.message : String(e)
        });

        setBulkQueue(newQueueState);
        updateBulkProgress(newQueueState);

        if (newQueueState.active && newQueueState.currentIndex < newQueueState.queue.length) {
          setTimeout(() => processBulk(newQueueState), turbo ? 0 : 300);
        }
      } else {
        const newQueueState = {
          ...updatedQueue,
          queue: updatedQueueItems,
          processing: false
        };

        logTradeEvent('BulkRetry', {
          bulkId: queueState.bulkId,
          jobId: currentJob.id,
          index: updatedQueue.currentIndex,
          bulkIndex: currentJob._bulkIndex,
          attempt: currentJob.attempts
        });

        setBulkQueue(newQueueState);
        setTimeout(() => processBulk(newQueueState), turbo ? 0 : 300);
      }
    }
  };

  const stopBulk = (msg = 'Bulk stopped') => {
    if (bulkQueue) {
      const newQueueState = {
        ...bulkQueue,
        active: false,
        processing: false
      };
      setBulkQueue(newQueueState);

      logTradeEvent('BulkStop', {
        bulkId: bulkQueue.bulkId,
        completed: bulkQueue.completed,
        failed: bulkQueue.failed,
        remaining: bulkQueue.total - bulkQueue.completed - bulkQueue.failed
      });

      trades
        .filter(t => t.status === 'pending' && t.isBulkTrade && t.bulkTradeId === bulkQueue.bulkId)
        .forEach(t => {
          api_base.api.send({ cancel: t.id }).catch(() => { });
        });
    }
    setBulk(b => ({ ...b, on: false }));
    showStatus(msg, 'info');
  };

  const updateBulkProgress = (queueState: NonNullable<typeof bulkQueue>) => {
    if (!queueState) return;

    const completed = queueState.completed;
    const failed = queueState.failed;
    const total = queueState.total;

    setBulk({
      on: queueState.active,
      done: completed,
      fail: failed,
      tot: total,
    });

    if (completed + failed === total) {
      logTradeEvent('BulkComplete', {
        bulkId: queueState.bulkId,
        completed,
        failed,
        total
      });

      setBulk(b => ({ ...b, on: false }));
      setBulkQueue(prev => prev ? { ...prev, active: false } : null);
      showStatus(`Bulk completed: ${completed} succeeded, ${failed} failed`, 'success');
    }
  };

  const handleReset = () => {
    stopBulk('Bulk stopped by reset');
    trades.forEach(tr => unsubContract(tr.id));
    setTrades([]);
    setPL(0);
    setBulk({ on: false, done: 0, fail: 0, tot: 0 });
    setBulkQueue(null);
    showStatus('History cleared', 'info');
    tempToRealRef.current.clear();
    realToTempRef.current.clear();
  };

  const handleWS = (d: any) => {
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

  const handlePOC = (c: any) => {
    const realId = c.contract_id?.toString();
    if (!realId) return;

    let foundDirect = false;

    setTrades(prev => {
      if (prev.some(tr => tr.id === realId)) foundDirect = true;
      return prev;
    });

    if (!foundDirect) {
      const tempId = realToTempRef.current.get(realId);
      if (tempId) {
        setTrades(prev => prev.map(tr =>
          tr.id === tempId ? { ...tr, id: realId } : tr
        ));
        tempToRealRef.current.set(tempId, realId);
      }
    }

    setTrades(prev => prev.map(tr => {
      if (tr.id !== realId) return tr;

      const isBulk = tr.isBulkTrade;
      const bulkId = tr.bulkTradeId;
      const bulkIndex = tr._bulkIndex;

      logTradeEvent('ContractUpdate', {
        id: tr._debugId || tr.id,
        isBulk,
        bulkId,
        bulkIndex,
        currentStatus: tr.status,
        newStatus: c.status,
        isSold: c.is_sold,
        isExpired: c.is_expired,
        profit: c.profit,
        currentSpot: c.current_spot,
        entryTick: c.entry_tick,
        exitTick: c.exit_tick,
        barrier: tr.barrier
      });

      const updatedTrade = { ...tr };

      if (!updatedTrade.startTime && c.entry_tick_time) {
        updatedTrade.startTime = new Date(c.entry_tick_time * 1000);
        updatedTrade.entryValue = c.entry_tick ? Number(c.entry_tick) : undefined;
        updatedTrade.marketFormat = currentSymbol;
      }

      if (c.tick_count && c.current_tick)
        updatedTrade.ticksRemaining = c.tick_count - c.current_tick;

      if (c.current_spot)
        updatedTrade.currentValue = Number(c.current_spot);

      const finished = c.is_sold || c.is_expired || c.is_settleable || c.status === 'sold';
      if (finished) {
        const net = Number(c.profit ?? 0);
        updatedTrade.status = net >= 0 ? 'won' : 'lost';
        updatedTrade.profit = net;
        updatedTrade.closeTime = new Date();
        updatedTrade.exitValue = c.exit_tick ? Number(c.exit_tick) : undefined;
        unsubContract(realId);
        playSound(net >= 0);

        logTradeEvent('ContractFinished', {
          id: updatedTrade._debugId || updatedTrade.id,
          isBulk,
          bulkId,
          bulkIndex,
          status: updatedTrade.status,
          profit: net,
          entry: updatedTrade.entryValue,
          exit: updatedTrade.exitValue,
          barrier: updatedTrade.barrier
        });

        if (isBulk && bulkQueue && bulkId === bulkQueue.bulkId && !updatedTrade.counted) {
          updatedTrade.counted = true;
          updateBulkProgress(bulkQueue);
        }
      } else {
        updatedTrade.status = c.status as TradeStatus;
      }
      return updatedTrade;
    }));
  };

  const handleTX = (tx: TTransaction) => {
    const realId = tx.contract_id.toString();
    setTrades(prev => {
      let list = prev;
      if (!list.some(tr => tr.id === realId)) {
        const tempId = realToTempRef.current.get(realId);
        if (tempId) {
          list = list.map(tr => tr.id === tempId ? { ...tr, id: realId } : tr);
          tempToRealRef.current.set(tempId, realId);
        }
      }
      return list.map(tr => {
        if (tr.id !== realId) return tr;
        const net = Number(tx.amount) - tr.stake;
        const updatedTrade: TTrade = {
          ...tr,
          status: net >= 0 ? 'won' : 'lost',
          profit: net,
          closeTime: new Date(tx.transaction_time * 1000)
        };
        playSound(net >= 0);

        logTradeEvent('TransactionProcessed', {
          id: updatedTrade._debugId || updatedTrade.id,
          isBulk: updatedTrade.isBulkTrade,
          bulkId: updatedTrade.bulkTradeId,
          bulkIndex: updatedTrade._bulkIndex,
          amount: tx.amount,
          stake: updatedTrade.stake,
          profit: net,
          status: updatedTrade.status,
          barrier: updatedTrade.barrier
        });

        if (updatedTrade.isBulkTrade && bulkQueue && updatedTrade.bulkTradeId === bulkQueue.bulkId && !updatedTrade.counted) {
          updatedTrade.counted = true;
          updateBulkProgress(bulkQueue);
        }
        return updatedTrade;
      });
    });
    unsubContract(realId);
  };

  const getTradeStats = () => {
    const completedTrades = trades.filter(t => t.status === 'won' || t.status === 'lost');
    const wonTrades = completedTrades.filter(t => t.status === 'won');
    const lostTrades = completedTrades.filter(t => t.status === 'lost');

    logTradeEvent('StatsUpdate', {
      total: completedTrades.length,
      won: wonTrades.length,
      lost: lostTrades.length,
      profit: wonTrades.reduce((sum, t) => sum + (t.profit || 0), 0),
      loss: lostTrades.reduce((sum, t) => sum + (t.profit || 0), 0)
    });

    return {
      total: completedTrades.length,
      won: wonTrades.length,
      lost: lostTrades.length,
      profit: wonTrades.reduce((sum, t) => sum + (t.profit || 0), 0),
      loss: lostTrades.reduce((sum, t) => sum + (t.profit || 0), 0)
    };
  };

  const toggleMode = (mode: 'matches' | 'overUnder') => {
    setActiveMode(mode);
    setActiveDigits([]);
    setActiveOverUnderDigit(null);
  };

  const handleDigitClick = (digit: number) => {
    if (activeMode === 'matches') {
      setActiveDigits(prev =>
        prev.includes(digit)
          ? prev.filter(d => d !== digit)
          : [...prev, digit]
      );
    } else {
      setActiveOverUnderDigit(prev => prev === digit ? null : digit);
    }
  };

  const handleTick = (val: number) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const currentMarket = marketSelectionRef.current?.value || '1HZ10V';
      let tickString: string;

      const fixed3Markets = ['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'];
      const fixed4Markets = ['R_50', 'R_75'];

      if (fixed3Markets.includes(currentMarket)) {
        tickString = val.toFixed(3);
      } else if (fixed4Markets.includes(currentMarket)) {
        tickString = val.toFixed(4);
      } else {
        tickString = val.toFixed(2);
      }


      const lastDigit = parseInt(tickString.slice(-1));

      setAnalysisData(prev => {
        const digitCounts = [...prev.digitCounts];
        digitCounts[lastDigit]++;

        const newLastResults = [{
          digit: lastDigit,
          price: val,
          timestamp: new Date()
        }, ...prev.lastResults].slice(0, 1000);

        return {
          ...prev,
          lastResults: newLastResults,
          lastDigit,
          lastPrice: val,
          digitCounts,
          currentMarket
        };
      });
      prevTickRef.current = val;
    }, 50);
  };

  const latestDigitRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // This effect will run whenever analysisData.lastDigit changes
    // No need for any code here since the pointer position is handled by the style prop
  }, [analysisData.lastDigit]);

  const refreshData = () => {
    if (marketSelectionRef.current && wsRef.current) {
      const newMarket = marketSelectionRef.current.value;
      setCurrentSymbol(newMarket);
      wsRef.current.send(JSON.stringify({
        ticks_history: newMarket,
        style: 'ticks',
        count: 5000,
        end: 'latest',
        subscribe: 1
      }));

      setAnalysisData({
        lastResults: [],
        lastDigit: null,
        lastPrice: null,
        digitCounts: Array(10).fill(0),
        currentMarket: newMarket
      });
    }
  };

  const renderHistoryItems = () => {
    return analysisData.lastResults.slice(0, filterCount).map((result, index) => {
      let style = { backgroundColor: 'transparent', color: 'black' };

      if (activeMode === 'matches' && activeDigits.length > 0) {
        if (activeDigits.includes(result.digit)) {
          style = {
            backgroundColor: digitColors[result.digit],
            color: 'white'
          };
        }
      } else if (activeMode === 'overUnder' && activeOverUnderDigit !== null) {
        if (result.digit > activeOverUnderDigit) {
          style = { backgroundColor: '#e74c3c', color: 'white' };
        } else if (result.digit < activeOverUnderDigit) {
          style = { backgroundColor: '#2ecc71', color: 'white' };
        }
      }

      return (
        <div
          key={index}
          className="history-item"
          style={style}
          title={`Price: ${result.price}`}
        >
          {result.digit}
        </div>
      );
    });
  };

  const handleSingleTrade = async (ct: string) => {
    if (activeMode === 'matches' && activeDigits.length > 0) {
      const promises = activeDigits.map(digit =>
        buy(ct, false, undefined, undefined, undefined, undefined, digit)
      );
      try {
        await Promise.all(promises);
        showStatus(`Trades placed for digits: ${activeDigits.join(', ')}`, 'success');
      } catch (e) {
        showStatus('Some trades failed', 'error');
      }
    } else if (activeMode === 'overUnder' && activeOverUnderDigit !== null) {
      await buy(ct, false, undefined, undefined, undefined, undefined, activeOverUnderDigit);
    } else {
      showStatus(activeMode === 'matches' ? 'Select at least one digit' : 'Select a digit', 'error');
    }
  };


  useEffect(() => {
    const sub = api_base.api.onMessage().subscribe(({ data }: any) => handleWS(data));
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    const initializeWebSocket = (symbol: string) => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      const app_id = 1089;
      wsRef.current = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);

      wsRef.current.onopen = () => {
        console.log("WebSocket connected for market:", symbol);
        wsRef.current?.send(JSON.stringify({
          ticks_history: symbol,
          style: 'ticks',
          count: 5000,
          end: 'latest',
          subscribe: 1
        }));

        setAnalysisData(prev => ({
          ...prev,
          lastResults: [],
          lastDigit: null,
          lastPrice: null,
          digitCounts: Array(10).fill(0),
          currentMarket: symbol
        }));
      };

      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data?.error) {
          console.error("WebSocket error:", data.error.message);
          return;
        }

        if (data?.msg_type === 'history') {
          const prices: number[] = data.history.prices.map(Number);
          if (!prices.length) return;

          // Process historical data
          prices.forEach(price => {
            const currentMarket = marketSelectionRef.current?.value || '1HZ10V';
            let tickString: string;

            if (currentMarket === 'R_10' || currentMarket === 'R_25') {
              tickString = price.toFixed(3);
            } else if (currentMarket === 'R_50' || currentMarket === 'R_75') {
              tickString = price.toFixed(4);
            } else {
              tickString = price.toFixed(2);
            }

            const lastDigit = parseInt(tickString.slice(-1));

            setAnalysisData(prev => {
              const digitCounts = [...prev.digitCounts];
              digitCounts[lastDigit]++;

              const newLastResults = [{
                digit: lastDigit,
                price,
                timestamp: new Date()
              }, ...prev.lastResults].slice(0, 1000);

              return {
                ...prev,
                lastResults: newLastResults,
                lastDigit,
                lastPrice: price,
                digitCounts,
                currentMarket
              };
            });
          });
          prevTickRef.current = prices[prices.length - 1];
        } else if (data?.tick) {
          handleTick(data.tick.quote);
        }
      };

      wsRef.current.onclose = () => console.log("WebSocket connection closed");
      wsRef.current.onerror = (error) => console.error("WebSocket error: ", error);
    };

    if (marketSelectionRef.current) {
      initializeWebSocket(marketSelectionRef.current.value);
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [marketSelectionRef.current?.value]);

  useEffect(() => {
    const id = setInterval(() => {
      setTrades(t => t.filter(tr =>
        !(tr.status === 'pending' && Date.now() - tr.timestamp.getTime() > 15_000)
      ));
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      trades.filter(t => ['won', 'lost', 'completed', 'error'].includes(t.status))
        .forEach(t => unsubContract(t.id));
    }, 30_000);
    return () => clearInterval(id);
  }, [trades]);

  useEffect(() => {
    setPL(trades.reduce((s, t) => s + (t.profit ?? 0), 0));
  }, [trades]);

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
      digitRef.current.disabled = true;
      digitRef.current.style.backgroundColor = 'gray';
    }
  }, [strategy]);

  useEffect(() => {
    if (!marketRef.current) return;
    const h = (e: any) => {
      const newMarket = e.target.value;
      setCurrentSymbol(newMarket);
      if (marketSelectionRef.current) {
        marketSelectionRef.current.value = newMarket;
      }
      if (wsRef.current) {
        wsRef.current.send(JSON.stringify({
          ticks_history: newMarket,
          style: 'ticks',
          count: 5000,
          end: 'latest',
          subscribe: 1
        }));
      }
      setAnalysisData(prev => ({
        ...prev,
        lastResults: [],
        lastDigit: null,
        lastPrice: null,
        digitCounts: Array(10).fill(0),
        currentMarket: newMarket
      }));
    };
    marketRef.current.addEventListener('change', h);
    return () => marketRef.current?.removeEventListener('change', h);
  }, []);

  const posClass = (st: TradeStatus, p?: number) =>
    st === 'won' || (st === 'completed' && p! < 0) ? 'position-win' :
      st === 'lost' || st === 'error' || (st === 'completed' && p! >= 0) ? 'position-loss' :
        'position-open';

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
    <div className="bot-appp" style={{ background: ui.is_dark_mode_on ? 'var(--general-main-1)' : 'transparent' }}>
      {/* Analysis Mode Selector */}
      <div className="analysis-mode-selector">
        <ul className="mode-list">
          <li>
            <button
              className={`mode-btn ${activeMode === 'matches' ? 'active' : ''}`}
              onClick={() => toggleMode('matches')}
            >
              Matches Analysis
            </button>
          </li>
          <li>
            <button
              className={`mode-btn ${activeMode === 'overUnder' ? 'active' : ''}`}
              onClick={() => toggleMode('overUnder')}
            >
              Over/Under Analysis
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
            if (marketRef.current) {
              marketRef.current.value = newMarket;
            }
            if (wsRef.current) {
              wsRef.current.send(JSON.stringify({
                ticks_history: newMarket,
                style: 'ticks',
                count: 5000,
                end: 'latest',
                subscribe: 1
              }));
            }
            setAnalysisData(prev => ({
              ...prev,
              lastResults: [],
              lastDigit: null,
              lastPrice: null,
              digitCounts: Array(10).fill(0),
              currentMarket: newMarket
            }));
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

      {/* Analysis Selectors */}
      <div className="analysis-selectors">
        {activeMode === 'matches' && (
          <div className="selector-container">
            <div className="selector-header">
              <div className="selector-title">Matches Analysis</div>
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
        <div className="digits-header">
          <div className="digits-filter">
            <label>Analyze last:</label>
            <input
              type="number"
              className="trade-input"
              value={filterCount}
              onChange={(e) => {
                const value = Math.max(1, Math.min(10000, Number(e.target.value)));
                setFilterCount(value);
              }}
              min="1"
              max="10000"
              step="1"
            />
          </div>
        </div>

        <div className="digits digits--trade">
          {digitsData.map((digitData) => {
            const { dashArray, dashOffset } = calculateStrokeValues();
            const isLatest = analysisData.lastDigit === digitData.digit;

            return (
              <div
                key={digitData.digit}
                className={`digits__digit ${isLatest ? 'digits__digit--latest' : ''}`}
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


<span
  className="digits__pointer"
  style={{
    left: `calc(${(analysisData.lastDigit || 0) * 10 + 5}%)`,
    transform: 'translateX(-50%)'
  }}
>
  <svg viewBox="0 0 8 8" width="8" height="8" className="digits__icon">
    <circle cx="4" cy="4" r="3.5" fill="#FF9800" />
    <path d="M4 2 L5 5.5 H3 Z" fill="#fff" />
  </svg>
</span>
        </div>
      </div>

      {/* Trading Container */}
      <div className="trading-container">
        <div className="history-title">Panel</div>

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
            ⚡ Slightly faster exercution than safe
          </div>}
          {!turbo && <div className="execution-mode-warning">
            🛡️ Safe mode
          </div>}
        </div>

        <div className="trade-controls">
          <div className="trade-control-group">
            <label>Market</label>
            <select id="tradeMarket" className="trade-input" ref={marketRef} value={currentSymbol}
              onChange={(e) => {
                const newMarket = e.target.value;
                setCurrentSymbol(newMarket);
                if (marketSelectionRef.current) {
                  marketSelectionRef.current.value = newMarket;
                }
                if (wsRef.current) {
                  wsRef.current.send(JSON.stringify({
                    ticks_history: newMarket,
                    style: 'ticks',
                    count: 5000,
                    end: 'latest',
                    subscribe: 1
                  }));
                }
                setAnalysisData(prev => ({
                  ...prev,
                  lastResults: [],
                  lastDigit: null,
                  lastPrice: null,
                  digitCounts: Array(10).fill(0),
                  currentMarket: newMarket
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
            </select>
          </div>

          <div className="trade-control-group">
            <label>Strategy</label>
            <select id="tradeStrategy"
              className="trade-input"
              ref={strategyRef}
              value={strategy}
              onChange={e => setStrat(e.target.value)}>
              <option value="matches">Matches</option>
              <option value="over">Over</option>
              <option value="under">Under</option>
            </select>
          </div>

          <div className="trade-control-group">
            <label>Stake (USD)</label>
            <input type="number" className="trade-input" defaultValue="10"
              min="1" step="1" ref={stakeRef} />
          </div>

          <div className="trade-control-group">
            <label>Take Profit (USD)</label>
            <input type="number" className="trade-input" defaultValue="0"
              min="0" step="1" ref={takeProfitRef} />
          </div>

          <div className="trade-control-group">
            <label>Duration (ticks)</label>
            <select className="trade-input" ref={durRef}>
              <option value="1">1</option><option value="2">2</option>
              <option value="3">3</option><option value="5">5</option>
              <option value="10">10</option>
            </select>
          </div>

          <div className="trade-control-group">
            <input type="number" className="trade-input" defaultValue="1"
              min="0" max="9" step="1" ref={digitRef}
              disabled={true}
              style={{ display: 'none' }} />
          </div>
        </div>
        <div className="title"><small>Type</small><small>Entry/Exit spot</small><small>Buy price and P/L</small></div>

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

                    {typeof tr.selectedDigit === 'number' && (
                      <span
                        className="barrier-tag"
                        title={`Barrier / Prediction digit: ${tr.selectedDigit}`}
                      >
                        D{tr.selectedDigit}
                      </span>
                    )}
                  </div>
                  {tr.isBulkTrade && <span className="bulk-indicator">[Bulk #{tr._bulkIndex}]</span>}
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
                  <div className={`position-result ${tr.profit && tr.profit >= 0 ? 'profit' : 'loss'}`}>
                    {tr.profit !== undefined
                      ? `${tr.profit >= 0 ? '+' : ''}${tr.profit.toFixed(2)}`
                      : '—'}
                  </div>
                </div>
              </div>
            ))}
        </div>

        <div className="trade-buttons">
          <button className="trade-btn even-btn"
            onClick={() => handleSingleTrade(ctypes.left)}>
            <span className="button-icon">
              {contractIcons[ctypes.left] || null}
            </span>
            {label(ctypes.left)}
          </button>
          <button className="trade-btn odd-btn"
            onClick={() => handleSingleTrade(ctypes.right)}>
            <span className="button-icon">
              {contractIcons[ctypes.right] || null}
            </span>
            {label(ctypes.right)}
          </button>
          <button className="trade-btn reset-btn"
            onClick={handleReset}>Reset</button>
        </div>

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

        <div className={`trade-status status-${msg.type}`}>
          {msg.txt}{msg.type === 'loading' && <div className="loading-spinner" />}
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

      <div className="history-container">
        <div className="history-title">
          Analysis Chamber
          <button
            className="refresh-btn"
            id="refreshBtn"
            onClick={refreshData}
          >
            <i className="fas fa-sync-alt"></i> Refresh
          </button>
        </div>
        <div className="history-items">
          {renderHistoryItems()}
        </div>
      </div>
    </div>
  );
});

export default Iframe;