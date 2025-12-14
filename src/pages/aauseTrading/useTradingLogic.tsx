import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';

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
  errorDetails?: string;
}

interface TTransaction {
  contract_id: string;
  amount: number;
  transaction_time: number;
}

interface TradingState {
  trades: TTrade[];
  profitLoss: number;
  message: { txt: string; type: 'info' | 'success' | 'error' | 'loading' | 'warning' };
  strategy: string;
  contractTypes: { left: string; right: string };
  currentSymbol: string;
  bothMode: boolean;
}

interface TradingActions {
  buy: (ct: string, stakeOv?: number, marketOv?: string, durOv?: number) => Promise<string | undefined>;
  buyBoth: () => Promise<void>;
  handleReset: () => void;
  getTradeStats: () => { total: number; won: number; lost: number };
  showStatus: (txt: string, type?: 'info' | 'success' | 'error' | 'loading' | 'warning') => void;
  playSound: (ok: boolean) => void;
  formatTickValue: (value?: number, marketFormat?: string) => string;
}

const useTradingLogic = (initialSymbol: string): { state: TradingState; actions: TradingActions } => {
  const [state, setState] = useState<TradingState>({
    trades: [],
    profitLoss: 0,
    message: { txt: '', type: 'info' },
    strategy: 'even',
    contractTypes: { left: 'DIGITEVEN', right: 'DIGITODD' },
    currentSymbol: initialSymbol,
    bothMode: false
  });

  const subs = useRef<Set<string>>(new Set());
  const stakeRef = useRef<HTMLInputElement>(null);
  const durRef = useRef<HTMLSelectElement>(null);
  const digitRef = useRef<HTMLInputElement>(null);
  const marketRef = useRef<HTMLSelectElement>(null);
  const strategyRef = useRef<HTMLSelectElement>(null);

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

  const showStatus = (txt: string, type: 'info' | 'success' | 'error' | 'loading' | 'warning' = 'info') => {
    setState(prev => ({ ...prev, message: { txt, type } }));
  };

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
      marketFormat: state.currentSymbol,
      temp: true
    };
    setState(prev => ({ ...prev, trades: [t, ...prev.trades] }));
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
      setState(prev => ({
        ...prev,
        trades: prev.trades.map(tr =>
          tr.id === tmpID
            ? { ...tr, id: realID, temp: false, status: 'open' }
            : tr
        )
      }));

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

      setState(prev => ({
        ...prev,
        trades: prev.trades.map(tr =>
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
        )
      }));

      showStatus(message, 'error');
      throw new Error(isBalanceError ? 'Insufficient balance' : 'Trade failed');
    }
  };

  const buyBoth = async () => {
    try {
      await Promise.all([
        buy(state.contractTypes.left),
        buy(state.contractTypes.right)
      ]);
    } catch {
      /* individual errors already handled */
    }
  };

  const handleReset = () => {
    state.trades.forEach(tr => unsubContract(tr.id));
    setState(prev => ({ ...prev, trades: [], profitLoss: 0 }));
    showStatus('History cleared', 'info');
  };

  const handlePOC = (c: any) => {
    setState(prev => ({
      ...prev,
      trades: prev.trades.map(tr => {
        if (tr.id !== c.contract_id) return tr;

        if (!tr.startTime && c.entry_tick_time) {
          tr.startTime = new Date(c.entry_tick_time * 1000);
          tr.entryValue = c.entry_tick ? Number(c.entry_tick) : undefined;
          tr.marketFormat = prev.currentSymbol;
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
      })
    }));
  };

  const handleTX = (tx: TTransaction) => {
    setState(prev => ({
      ...prev,
      trades: prev.trades.map(tr => {
        if (tr.id !== tx.contract_id) return tr;
        const net = Number(tx.amount) - tr.stake;
        tr.status = net >= 0 ? 'won' : 'lost';
        tr.profit = net;
        tr.closeTime = new Date(tx.transaction_time * 1000);
        playSound(net >= 0);
        return { ...tr };
      })
    }));
    unsubContract(tx.contract_id);
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

  const getTradeStats = () => {
    const completedTrades = state.trades.filter(t => t.status === 'won' || t.status === 'lost');
    return {
      total: completedTrades.length,
      won: completedTrades.filter(t => t.status === 'won').length,
      lost: completedTrades.filter(t => t.status === 'lost').length,
    };
  };

  const formatTickValue = (value?: number, marketFormat?: string) => {
    if (value === undefined) return '—';
    if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(marketFormat || state.currentSymbol)) {
      return value.toFixed(3);
    }
    if (['R_50', 'R_75'].includes(marketFormat || state.currentSymbol)) {
      return value.toFixed(4);
    }
    return value.toFixed(2);
  };

  useEffect(() => {
    const sub = api_base.api.onMessage().subscribe(({ data }: any) => handleWS(data));
    return () => sub.unsubscribe();
  }, [state.trades]);

  useEffect(() => {
    const id = setInterval(() => {
      setState(prev => ({
        ...prev,
        trades: prev.trades.map(tr => {
          if (tr.status === 'pending') {
            const age = Date.now() - tr.timestamp.getTime();
            if (age > 8000) {
              return { ...tr, status: 'error', temp: false };
            }
          }
          return tr;
        })
      }));
    }, 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      state.trades.filter(t => ['won', 'lost', 'completed', 'error'].includes(t.status))
        .forEach(t => unsubContract(t.id));
    }, 30000);
    return () => clearInterval(id);
  }, [state.trades]);

  useEffect(() => {
    setState(prev => ({
      ...prev,
      profitLoss: prev.trades.reduce((s, t) => s + (t.profit ?? 0), 0)
    }));
  }, [state.trades]);

  useEffect(() => {
    if (!strategyRef.current) return;
    const h = (e: any) => setState(prev => ({ ...prev, strategy: e.target.value }));
    strategyRef.current.addEventListener('change', h);
    return () => strategyRef.current?.removeEventListener('change', h);
  }, []);

  useEffect(() => {
    setState(prev => ({
      ...prev,
      contractTypes: { left: mapContracts(prev.strategy)[0], right: mapContracts(prev.strategy)[1] }
    }));
    if (digitRef.current) {
      const need = needsDigit(state.strategy);
      digitRef.current.disabled = !need;
      digitRef.current.style.backgroundColor = need ? '' : 'gray';
    }
  }, [state.strategy]);

  useEffect(() => {
    if (!marketRef.current) return;
    const h = (e: any) => {
      const newMarket = e.target.value;
      setState(prev => ({ ...prev, currentSymbol: newMarket }));
    };
    marketRef.current.addEventListener('change', h);
    return () => marketRef.current?.removeEventListener('change', h);
  }, []);

  return {
    state,
    actions: {
      buy,
      buyBoth,
      handleReset,
      getTradeStats,
      showStatus,
      playSound,
      formatTickValue
    }
  };
};

export default useTradingLogic;