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
  MarketDerivedVolatility151sIcon,
  MarketDerivedVolatility301sIcon,
  MarketDerivedVolatility901sIcon,
  TradeTypesUpsAndDownsRiseIcon
} from '@deriv/quill-icons';
import './SpeedBot.scss';

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
  marketFormat?: string;
  temp?: boolean;
  errorReason?: string;
}

type TTransaction = {
  contract_id: string;
  amount: number;
  transaction_time: number;
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
  '1HZ15V': <MarketDerivedVolatility501sIcon width={16} height={16} />,
  '1HZ30V': <MarketDerivedVolatility501sIcon width={16} height={16} />,
  '1HZ90V': <MarketDerivedVolatility501sIcon width={16} height={16} />,
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

const SpeedBot = observer(() => {
  const { ui } = useStore();

  const [trades, setTrades] = useState<TTrade[]>([]);
  const [profitLoss, setPL] = useState(0);
  const [msg, setMsg] = useState<{ txt: string; type: 'info' | 'success' | 'error' | 'loading' | 'warning' }>({ txt: '', type: 'info' });
  const [strategy, setStrat] = useState('even');
  const [ctypes, setCT] = useState<{ left: string; right: string }>({ left: 'DIGITEVEN', right: 'DIGITODD' });
  const [currentSymbol, setCurrentSymbol] = useState('1HZ10V');
  const [bothMode, setBothMode] = useState<boolean>(false);

  const [activeMode, setActiveMode] = useState('evenOdd');
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
    digitCounts: Array(10).fill(0),
    overDigit: 1,
    underDigit: 7,
    tickRange: 100,
    currentMarket: "1HZ10V"
  });

  const marketSelectionRef = useRef<HTMLSelectElement>(null);
  const marketRef = useRef<HTMLSelectElement>(null);
  const strategyRef = useRef<HTMLSelectElement>(null);
  const stakeRef = useRef<HTMLInputElement>(null);
  const durRef = useRef<HTMLSelectElement>(null);
  const digitRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const subs = useRef<Set<string>>(new Set());
  const prevTickRef = useRef<number | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();

  const getBalanceError = (error: any): { isBalanceError: boolean; message: string } => {
    if (!error) return { isBalanceError: false, message: 'Unknown error' };

    const errorObj = error.error || error;
    const rawMsg = (errorObj.message || 'Unknown error').toString().trim();
    const errorCode = errorObj.code || '';

    const isBalanceError = errorCode === 'InsufficientBalance' || [
      'insufficient',
      'balance',
      'fund',
      'not enough',
      'no enough',
      'low balance'
    ].some(term => rawMsg.toLowerCase().includes(term));

    return {
      isBalanceError,
      message: isBalanceError ? rawMsg : 'Unknown error'
    };
  };

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

  const createTempTrade = (ct: string, stake: number, market: string, dur: number, barrier?: number) => {
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
      marketFormat: currentSymbol,
      temp: true
    };
    setTrades(prev => [t, ...prev]);
    return tmpID;
  };

  const buy = async (ct: string, stakeOv?: number, marketOv?: string, durOv?: number) => {
    const stake = stakeOv ?? parseFloat(stakeRef.current?.value || '0');
    const dur = durOv ?? parseInt(durRef.current?.value || '1', 10);
    const market = marketOv ?? marketRef.current?.value ?? '1HZ10V';

    let barrier: string | undefined;
    if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(ct)) {
      const d = digitRef.current ? parseInt(digitRef.current.value, 10) : NaN;
      if (isNaN(d)) { showStatus('Enter digit 0-9', 'error'); throw new Error('digit'); }
      barrier = d.toString();
    }

    const tmpID = createTempTrade(ct, stake, market, dur, barrier ? +barrier : undefined);

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
      setTrades(t => t.map(tr =>
        tr.id === tmpID
          ? { ...tr, id: realID, temp: false, status: 'open' }
          : tr
      ));

      subContract(realID);
      showStatus('Next ✅ ', 'success');
      return realID;

    } catch (e: any) {
      let errorObj;
      try {
        errorObj = JSON.parse(e.message);
      } catch {
        errorObj = e;
      }

      const { isBalanceError, message } = getBalanceError(errorObj);

      setTrades(t => t.map(tr =>
        tr.id === tmpID
          ? {
            ...tr,
            status: 'error',
            temp: false,
            errorReason: isBalanceError ? 'Insufficient balance' : 'Trade failed',
            errorDetails: message,
            closeTime: new Date()
          }
          : tr
      ));

      showStatus(message, 'error');
      throw new Error(isBalanceError ? 'Insufficient balance' : 'Trade failed');
    }
  };

  const buyBoth = async () => {
    try {
      await Promise.all([
        buy(ctypes.left),
        buy(ctypes.right)
      ]);
    } catch {
      /* individual errors already handled */
    }
  };

  const handleReset = () => {
    trades.forEach(tr => unsubContract(tr.id));
    setTrades([]);
    setPL(0);
    showStatus('History cleared', 'info');
  };

  const handleWS = (d: any) => {
    if (d.error?.message?.includes('proposal_open_contract')) {
      return;
    }

    if (d.error) {
      const { isBalanceError, message } = getBalanceError(d);
      showStatus(message, isBalanceError ? 'error' : 'error');
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

  const handlePOC = (c: any) => {
    setTrades(prev => prev.map(tr => {
      if (tr.id !== c.contract_id) return tr;

      if (!tr.startTime && c.entry_tick_time) {
        tr.startTime = new Date(c.entry_tick_time * 1000);
        tr.entryValue = c.entry_tick ? Number(c.entry_tick) : undefined;
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
      } else {
        tr.status = (c.status as TradeStatus) || 'active';
      }
      return { ...tr };
    }));
  };

  const handleTX = (tx: TTransaction) => {
    setTrades(prev => prev.map(tr => {
      if (tr.id !== tx.contract_id) return tr;
      const net = Number(tx.amount) - tr.stake;
      tr.status = net >= 0 ? 'won' : 'lost';
      tr.profit = net;
      tr.closeTime = new Date(tx.transaction_time * 1000);
      playSound(net >= 0);
      return { ...tr };
    }));
    unsubContract(tx.contract_id);
  };

  const getTradeStats = () => {
    const completedTrades = trades.filter(t => t.status === 'won' || t.status === 'lost');
    return {
      total: completedTrades.length,
      won: completedTrades.filter(t => t.status === 'won').length,
      lost: completedTrades.filter(t => t.status === 'lost').length,
    };
  };

  const toggleMode = (mode: string) => {
    setActiveMode(mode);
  };

  const handleOverDigitSelect = (digit: number) => {
    setAnalysisData(prev => ({ ...prev, overDigit: digit }));
  };

  const handleUnderDigitSelect = (digit: number) => {
    setAnalysisData(prev => ({ ...prev, underDigit: digit }));
  };

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
        currentMarket: newMarket
      });
    }
  };

  const handleTick = (val: number) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const prev = prevTickRef.current;
      if (prev === null) { prevTickRef.current = val; return; }

      const currentMarket = marketSelectionRef.current?.value || '1HZ10V';
      let tickString: string;

      if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(currentMarket)) {
        tickString = val.toFixed(3);
      } else if (currentMarket === 'R_50' || currentMarket === 'R_75') {
        tickString = val.toFixed(4);
      } else {
        tickString = val.toFixed(2);
      }

      const lastDigit = parseInt(tickString.slice(-1));
      const isEven = lastDigit % 2 === 0;

      let isRise = null as boolean | null;
      if (prevTickRef.current !== null) {
        if (val > prevTickRef.current) {
          isRise = true;
        } else if (val < prevTickRef.current) {
          isRise = false;
        }
      }

      setAnalysisData(prev => {
        const digitCounts = [...prev.digitCounts];
        digitCounts[lastDigit]++;

        const newLastResults = [{
          digit: lastDigit,
          isEven,
          isRise,
          price: val,
          timestamp: new Date()
        }, ...prev.lastResults].slice(0, 1000);

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
          currentMarket
        };
      });
      prevTickRef.current = val;
    }, 50);
  };

  const renderEvenOddHistory = () => {
    return analysisData.lastResults.slice(0, 100).map((result, index) => (
      <div key={index} className="history-item" style={{ color: result.isEven ? '#2ecc71' : '#e74c3c' }}>
        {result.isEven ? 'E' : 'O'}
      </div>
    ));
  };

  const renderOverUnderHistory = () => {
    return analysisData.lastResults.slice(0, 100).map((result, index) => {
      const isOver = analysisData.overDigit === 0 ?
        result.digit > 0 :
        result.digit > analysisData.overDigit;
      const isUnder = result.digit < analysisData.underDigit;

      return (
        <div
          key={index}
          className="history-item"
          style={{
            backgroundColor: isOver && isUnder ? '#9b59b6' : undefined,
            color: isOver ? '#e74c3c' : isUnder ? '#2ecc71' : undefined
          }}
          title={`Price: ${result.price}`}
        >
          {result.digit}
        </div>
      );
    });
  };

  const renderRiseFallHistory = () => {
    const filteredResults = analysisData.lastResults
      .filter(result => result.isRise !== null)
      .slice(0, 100);

    if (filteredResults.length === 0) {
      return (
        <div className="no-results-message">
          {analysisData.lastResults.length === 0
            ? "Waiting for first price data..."
            : "No price changes detected (all ticks had same price)"}
        </div>
      );
    }

    return filteredResults.map((result, index) => (
      <div
        key={index}
        className="history-item"
        style={{
          color: result.isRise ? '#2ecc71' :
            result.isRise === false ? '#e74c3c' : '#3498db'
        }}
        title={`Price: ${result.price} (Previous: ${analysisData.lastPrice})`}
      >
        {result.isRise ? '↑' : result.isRise === false ? '↓' : '='}
      </div>
    ));
  };

  useEffect(() => {
    const sub = api_base.api.onMessage().subscribe(({ data }: any) => handleWS(data));
    return () => sub.unsubscribe();
  }, [trades]);

  useEffect(() => {
    const initializeWebSocket = (symbol: string) => {
      if (wsRef.current) {
        wsRef.current.close();
      }

      const app_id = 1089;
      wsRef.current = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);

      wsRef.current.onopen = () => {
        wsRef.current?.send(JSON.stringify({
          ticks_history: symbol,
          style: 'ticks',
          count: 5000,
          end: 'latest',
          subscribe: 1
        }));
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

          prices.forEach(price => {
            const currentMarket = marketSelectionRef.current?.value || '1HZ10V';
            let tickString: string;

            if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(currentMarket)) {
              tickString = price.toFixed(3);
            } else if (currentMarket === 'R_50' || currentMarket === 'R_75') {
              tickString = price.toFixed(4);
            } else {
              tickString = price.toFixed(2);
            }

            const lastDigit = parseInt(tickString.slice(-1));
            const isEven = lastDigit % 2 === 0;

            setAnalysisData(prev => {
              const digitCounts = [...prev.digitCounts];
              digitCounts[lastDigit]++;

              const newLastResults = [{
                digit: lastDigit,
                isEven,
                isRise: null,
                price,
                timestamp: new Date()
              }, ...prev.lastResults].slice(0, 1000);

              return {
                ...prev,
                evenCount: isEven ? prev.evenCount + 1 : prev.evenCount,
                oddCount: !isEven ? prev.oddCount + 1 : prev.oddCount,
                totalCount: prev.totalCount + 1,
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

      wsRef.current.onclose = () => { };
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
      setTrades(prev => prev.map(tr => {
        if (tr.status === 'pending') {
          const age = Date.now() - tr.timestamp.getTime();
          if (age > 8000) {
            return { ...tr, status: 'error', temp: false };
          }
        }
        return tr;
      }));
    }, 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      trades.filter(t => ['won', 'lost', 'completed', 'error'].includes(t.status))
        .forEach(t => unsubContract(t.id));
    }, 30000);
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
      digitRef.current.disabled = !need;
      digitRef.current.style.backgroundColor = need ? '' : 'gray';
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
        evenCount: 0,
        oddCount: 0,
        riseCount: 0,
        fallCount: 0,
        totalCount: 0,
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
    st === 'won' ? 'position-win' :
      st === 'lost' || st === 'error' ? 'position-loss' :
        'position-open';

  const formatTickValue = (value?: number, marketFormat?: string) => {
    if (value === undefined) return '—';
    if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(marketFormat)) {
      return value.toFixed(3);
    }
    if (['R_50', 'R_75'].includes(marketFormat)) {
      return value.toFixed(4);
    }
    return value.toFixed(2);
  };

  const tradeStats = getTradeStats();

  return (
    <div className="speed-app" style={{ background: ui.is_dark_mode_on ? 'var(--general-main-1)' : 'transparent' }}>
      <div className="analysis-mode-selector">
        <ul className="mode-list">
          <li>
            <button
              className={`mode-btn ${activeMode === 'evenOdd' ? 'active' : ''}`}
              onClick={() => toggleMode('evenOdd')}
              style={{ padding: '10px' }}
            >
              Even/Odd
            </button>
          </li>
          <li>
            <button
              className={`mode-btn ${activeMode === 'overUnder' ? 'active' : ''}`}
              onClick={() => toggleMode('overUnder')}
              style={{ padding: '10px' }}
            >
              Over/Under
            </button>
          </li>
          <li>{/* rise/fall placeholder */}</li>
        </ul>
      </div>

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
                >{digit}</button>
              ))}
            </div>
          </div>
          <div className="selector-container">
            <div className="selector-header">
              <div className="selector-title">Under Analysis</div>
              <div style={{ width: '60px' }}></div>
            </div>
            <div className="digit-selector" id="underSelector">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(digit => (
                <button
                  key={`under-${digit}`}
                  className={`digit-btn under-btn ${analysisData.underDigit === digit ? 'active' : ''}`}
                  onClick={() => handleUnderDigitSelect(digit)}
                >{digit}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div id="riseFallSection" className="analysis-section" style={{ display: activeMode === 'riseFall' ? 'block' : 'none', minWidth: '100%' }} />

      <div className="trading-container">
        <div className="history-title">Panel</div>

        <div className="trade-controls">
          <div className="trade-control-group market-selector">
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
                  evenCount: 0,
                  oddCount: 0,
                  riseCount: 0,
                  fallCount: 0,
                  totalCount: 0,
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
              <option value="even">Even</option><option value="odd">Odd</option>
              <option value="matches">Matches</option><option value="differs">Differs</option>
              <option value="over">Over</option><option value="under">Under</option>
              <option value="rise">Rise</option><option value="fall">Fall</option>
            </select>
          </div>

          <div className="trade-control-group">
            <label>Stake (USD)</label>
            <input type="number" className="trade-input" defaultValue="10"
              min="1" step="1" ref={stakeRef} />
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
            <label>Prediction</label>
            <input type="number" className="trade-input" defaultValue="1"
              min="0" max="9" step="1" ref={digitRef}
              disabled={!needsDigit(strategy)}
              style={{ backgroundColor: needsDigit(strategy) ? '' : 'gray' }} />
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
                fontWeight: 'bold'
              }}
              title="When ON, single trade buttons buy both sides simultaneously"
            >
              {bothMode ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
        <div className="title"><small>Type</small><small>Entry/Exit spot</small><small>Buy price and P/L</small></div>

        <div className="open-positions">
          {trades.length === 0
            ? <div className="no-positions"><small>No positions</small></div>
            : trades.map(tr => (
              <div key={tr.id} className={`position-item ${posClass(tr.status, tr.profit)}`}>
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
                      <span className="error-text">
                        {tr.errorReason}
                      </span>
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
                  <div className="position-stake">{tr.stake.toFixed(2)}</div>
                  <div className={`position-result ${tr.status === 'pending' ? 'pending' :
                    tr.status === 'error' ? 'loss' :
                      tr.profit !== undefined
                        ? (tr.profit >= 0 ? 'profit' : 'loss')
                        : ''}`}>
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

        <div className="trade-buttons">
          <button
            className="trade-btn even-btn"
            onClick={() => bothMode ? buyBoth() : buy(ctypes.left)}
            title={bothMode ? 'Both mode: TWO trades will be placed' : ''}
          >
            <span className="button-icon">
              {contractIcons[ctypes.left] || null}
            </span>
            {label(ctypes.left)}{bothMode ? ' (Both)' : ''}
          </button>
          <button
            className="trade-btn odd-btn"
            onClick={() => bothMode ? buyBoth() : buy(ctypes.right)}
            title={bothMode ? 'Both mode: TWO trades will be placed' : ''}
          >
            <span className="button-icon">
              {contractIcons[ctypes.right] || null}
            </span>
            {label(ctypes.right)}{bothMode ? ' (Both)' : ''}
          </button>
          <button className="trade-btn reset-btn"
            onClick={handleReset}>Reset</button>
        </div>

        <div className={`trade-status status-${msg.type}`}>
          {msg.txt}{msg.type === 'loading' && <div className="loading-spinner" />}
        </div>

        <div className="performance-stats">
          <div className="stat-item">
            <div className="stat-title">Total P/L</div>
            <div className={`stat-value ${profitLoss >= 0 ? 'profit' : 'loss'}`}>
              {profitLoss >= 0 ? '+' : ''}${Math.abs(profitLoss).toFixed(2)}
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

      <div className="history-container" >
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
        <div
          className="history-items"
          id="lastResults"
          style={{ display: activeMode === 'evenOdd' ? 'flex' : 'none' }}
        >
          {renderEvenOddHistory()}
        </div>
        <div
          className="history-items"
          id="lastResultsOverUnder"
          style={{ display: activeMode === 'overUnder' ? 'flex' : 'none' }}
        >
          {renderOverUnderHistory()}
        </div>
        <div
          className="history-items"
          id="lastResultsRiseFall"
          style={{
            display: activeMode === 'riseFall' ? 'flex' : 'none',
            minWidth: '100%'
          }}
        >
          {renderRiseFallHistory()}
        </div>
      </div>
    </div>
  );
});

export default SpeedBot;