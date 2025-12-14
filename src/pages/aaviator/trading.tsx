/* ===========================================================================
 *  TickAnalysis.tsx  –  analysis + fully self‑contained Accumulator trading
 * =========================================================================== */

import { useEffect, useRef, useState, useCallback } from 'react';
import { api_base } from '@/external/bot-skeleton';
import SnakeRun from '../asnake';
import './Aviator.scss';

/* ───────────────────────── Constants ───────────────────────── */

const MARKET_NAMES: Record<string, string> = {
  R_10: 'Volatility 10 Index',
  '1HZ10V': 'Volatility 10(1s) Index',
  R_25: 'Volatility 25 Index',
  '1HZ25V': 'Volatility 25(1s) Index',
  R_50: 'Volatility 50 Index',
  '1HZ50V': 'Volatility 50(1s) Index',
  R_75: 'Volatility 75 Index',
  '1HZ75V': 'Volatility 75(1s) Index',
  R_100: 'Volatility 100 Index',
  '1HZ100V': 'Volatility 100(1s) Index',
};

const THRESHOLD_MAP: Record<string, Record<string, number>> = {
  /* … thresholds unchanged … */
  '1': {
    R_10: 0.00613,
    '1HZ10V': 0.00433,
    R_25: 0.01531,
    '1HZ25V': 0.01083,
    R_50: 0.03063,
    '1HZ50V': 0.02166,
    R_75: 0.04594,
    '1HZ75V': 0.03249,
    R_100: 0.06126,
    '1HZ100V': 0.04331,
  },
  '2': {
    R_10: 0.00573,
    '1HZ10V': 0.00405,
    R_25: 0.01431,
    '1HZ25V': 0.01012,
    R_50: 0.02863,
    '1HZ50V': 0.02024,
    R_75: 0.04294,
    '1HZ75V': 0.03036,
    R_100: 0.05725,
    '1HZ100V': 0.04048,
  },
  '3': {
    R_10: 0.00537,
    '1HZ10V': 0.0038,
    R_25: 0.01342,
    '1HZ25V': 0.00949,
    R_50: 0.02685,
    '1HZ50V': 0.01898,
    R_75: 0.04027,
    '1HZ75V': 0.02847,
    R_100: 0.05369,
    '1HZ100V': 0.03797,
  },
  '4': {
    R_10: 0.00511,
    '1HZ10V': 0.00361,
    R_25: 0.01277,
    '1HZ25V': 0.00903,
    R_50: 0.02554,
    '1HZ50V': 0.01806,
    R_75: 0.03831,
    '1HZ75V': 0.02709,
    R_100: 0.05109,
    '1HZ100V': 0.03612,
  },
  '5': {
    R_10: 0.00486,
    '1HZ10V': 0.00344,
    R_25: 0.01216,
    '1HZ25V': 0.0086,
    R_50: 0.02431,
    '1HZ50V': 0.01719,
    R_75: 0.03647,
    '1HZ75V': 0.02579,
    R_100: 0.04863,
    '1HZ100V': 0.03438,
  },
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

const AccumulatorPanel: React.FC<{ symbol: string; growthRate: number }> = ({
  symbol,
  growthRate,
}) => {
  const [stake, setStake] = useState(10);
  const [takeProfit, setTP] = useState(0);
  const [cons, setCons] = useState<Record<string, TAccum>>({});
  const [recent, setRecent] = useState<TAccum[]>([]);
  const [pl, setPL] = useState(0);
  const [isBuying, setIsBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<NodeJS.Timeout | null>(null);
  const subs = useRef<Set<string>>(new Set());
  const closedIds = useRef<Set<string>>(new Set()); // 🆕 prevents duplicates

  /* ───── helpers ───── */

  const showStatus = (message: string, type: 'info' | 'error' | 'success') => {
    setError(type === 'error' ? message : null);
    if (type === 'info') console.info(message);
    else if (type === 'error') console.error(message);
    else console.log(message);
  };

  const addToRecent = (c: TAccum, profit?: number) => {
    if (closedIds.current.has(c.id)) return;       // 🆕 skip dups
    closedIds.current.add(c.id);                   // 🆕 remember
    setRecent((prev) => [
      {
        ...c,
        profit: profit ?? c.profit,
        status: 'sold',
        closedTime: Date.now(),
      },
      ...prev,
    ]);
  };

  /* ───── buy / sell ───── */

  const buy = async () => {
    if (isBuying) return;
    setIsBuying(true);
    setError(null);

    try {
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
      setCons((c) => ({
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
      await subscribeToContractUpdates(id);
    } catch (err: any) {
      const errorMsg = err.message.toLowerCase().includes('insufficient')
        ? 'Insufficient balance'
        : err.message;
      showStatus(`Buy failed: ${errorMsg}`, 'error');
    } finally {
      setIsBuying(false);
    }
  };

  const doSell = async (id: string) => {
    const resp = await api_base.api.send({ sell: id, price: 0 });
    if (resp.error) throw new Error(resp.error.message);
    return resp.sell;
  };

  const handleManualSell = async (id: string) => {
    try {
      const sellInfo = await doSell(id);
      const closed = cons[id];
      if (closed) addToRecent(closed, sellInfo.profit);
      setCons((prev) => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
      unsubscribeFromContractUpdates(id);
      showStatus(`Sold contract: ${id}`, 'success');
    } catch (err: any) {
      showStatus(`Sell failed: ${err.message}`, 'error');
    }
  };

  /* ───── proposal subscription helpers ───── */

  const subscribeToContractUpdates = async (id: string) => {
    if (subs.current.has(id)) return;
    try {
      await api_base.api.send({
        proposal_open_contract: 1,
        contract_id: id,
        subscribe: 1,
      });
      subs.current.add(id);
    } catch (err) {
      console.warn('Subscription error:', err);
    }
  };

  const unsubscribeFromContractUpdates = async (id: string) => {
    if (!subs.current.has(id)) return;
    try {
      await api_base.api.send({
        proposal_open_contract: 0,
        contract_id: id,
      });
      subs.current.delete(id);
    } catch (err) {
      console.warn('Unsubscription error:', err);
    }
  };

  /* ───── websocket listener ───── */

  useEffect(() => {
    const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
      if (data.error) {
        showStatus(data.error.message, 'error');
        return;
      }

      switch (data.msg_type) {
        case 'proposal_open_contract':
          handleContractUpdate(data.proposal_open_contract);
          break;
        case 'sell':
          handleSellResponse(data.sell);
          break;
        case 'portfolio':
          handlePortfolioUpdate(data.portfolio);
          break;
      }
    });

    api_base.api.send({ portfolio: 1 });

    refreshRef.current = setInterval(() => {
      api_base.api.send({ portfolio: 1 });
    }, 180_000);

    return () => {
      sub.unsubscribe();
      if (refreshRef.current) clearInterval(refreshRef.current);
      subs.current.forEach((id) => unsubscribeFromContractUpdates(id));
    };
  }, [takeProfit]);

  /* ───── handlers ───── */

  const handleContractUpdate = (contract: any) => {
    setCons((prev) => {
      const existing = prev[contract.contract_id];
      if (!existing) return prev;

      const updated: TAccum = {
        ...existing,
        profit: parseFloat(contract.profit ?? 0),
        status: contract.status as TAccum['status'],
      };

      // TP / SL auto‑sell
      if (
        updated.status === 'open' &&
        updated.target > 0 &&
        updated.profit >= updated.target
      ) {
        doSell(updated.id)
          .then((sellInfo) => {
            addToRecent(updated, sellInfo.profit);
            setCons((p) => {
              const { [updated.id]: _, ...rest } = p;
              return rest;
            });
            unsubscribeFromContractUpdates(updated.id);
            showStatus(`TP hit – sold ${updated.id}`, 'success');
          })
          .catch((e) => showStatus(`Auto‑sell failed: ${e.message}`, 'error'));
        return prev;
      }

      // Natural expiry / settled
      if (updated.status !== 'open') {
        addToRecent(updated);
        const { [updated.id]: _, ...rest } = prev;
        return rest;
      }

      return { ...prev, [updated.id]: updated };
    });
  };

  const handleSellResponse = (sellData: any) => {
    setCons((prev) => {
      const sold = prev[sellData.contract_id];
      if (sold) addToRecent(sold, sellData.profit);
      const { [sellData.contract_id]: _, ...rest } = prev;
      return rest;
    });
    unsubscribeFromContractUpdates(sellData.contract_id);
  };

  const handlePortfolioUpdate = (portfolio: any) => {
    if (!portfolio?.contracts) return;

    const openContracts: Record<string, TAccum> = {};
    portfolio.contracts
      .filter((c: any) => c.contract_type === 'ACCU' && c.status === 'open')
      .forEach((c: any) => {
        const id = String(c.contract_id);
        openContracts[id] = {
          id,
          symbol: c.symbol,
          buyPrice: c.buy_price,
          profit: parseFloat(c.profit ?? 0),
          status: c.status,
          target: takeProfit,
        };
        subscribeToContractUpdates(id);
      });

    setCons(openContracts);
  };

  /* ───── total P/L ───── */

  useEffect(() => {
    const openPl = Object.values(cons).reduce((sum, c) => sum + c.profit, 0);
    const closedPl = recent.reduce((sum, c) => sum + c.profit, 0);
    setPL(openPl + closedPl);
  }, [cons, recent]);

  /* ───── render ───── */

  return (
    <div className="accu-panel">
      <h3>Accumulator Trader</h3>

      {error && <div className="accu-error">{error}</div>}

      <div className="accu-controls">
        <label>
          Stake&nbsp;
          <input
            type="number"
            min={1}
            step={1}
            value={stake}
            onChange={(e) => setStake(+e.target.value || 1)}
          />
        </label>

        <label>
          TP&nbsp;
          <input
            type="number"
            min={0}
            step={0.01}
            value={takeProfit}
            onChange={(e) => setTP(+e.target.value || 0)}
            placeholder="Auto sell at"
          />
        </label>

        <button onClick={buy} disabled={isBuying}>
          {isBuying
            ? 'Buying…'
            : `Buy ACCU (${MARKET_NAMES[symbol]}) @ ${growthRate}%`}
        </button>
      </div>

      {/* ─── Open Contracts ─── */}
      <div className="accu-contracts">
        <h4>Active</h4>
        {Object.values(cons).length === 0 && <p>No active ACCU contracts</p>}
        {Object.values(cons).map((c) => (
          <div key={c.id} className={`accu-row ${c.status}`}>
            <span className="ct-id">{c.id.slice(-8)}</span>
            <span className="ct-pl">{c.profit.toFixed(2)}</span>
            <span className="ct-st">{c.status}</span>
            {c.status === 'open' && (
              <button onClick={() => handleManualSell(c.id)}>Sell</button>
            )}
          </div>
        ))}
      </div>

      {/* ─── Recent / Closed Trades ─── */}
      <div className="accu-contracts recent">
        <div className="recent-header">
          <h4>Recent Trades</h4>
          <button
            onClick={() => {
              setRecent([]);
              closedIds.current.clear(); // 🆕 clear dup‑guard
            }}
          >
            Reset
          </button>
        </div>

        {recent.length === 0 && <p>No closed trades yet</p>}
        {recent.map((c) => (
          <div key={c.id} className={`accu-row ${c.status}`}>
            <span className="ct-id">{c.id.slice(-8)}</span>
            <span className="ct-pl">{c.profit.toFixed(2)}</span>
            <span className="ct-st">{c.status}</span>
          </div>
        ))}
      </div>

      <div className="accu-summary">
        Total&nbsp;P/L:&nbsp;{pl >= 0 ? '+' : ''}
        {pl.toFixed(2)}
      </div>
    </div>
  );
};

/* ───────────────────── Analyse helper (push 0s) ───────────────────── */

const analysePrices = (
  prices: number[],
  symbol: string,
  rate: number,
): { currentStreak: number; streakHistory: number[] } => {
  const thr = THRESHOLD_MAP[String(rate)][symbol];
  const hist: number[] = [];
  let counter = 0;

  for (let i = 1; i < prices.length; i++) {
    const pct = Math.abs(((prices[i] - prices[i - 1]) / prices[i - 1]) * 100);
    if (pct <= thr) counter++;
    else {
      hist.push(counter);
      counter = 0;
    }
  }
  return { currentStreak: counter, streakHistory: hist.slice(-100) };
};

/* ────────────────────────── Main Component ────────────────────────── */

const TickAnalysis = () => {
  const [symbol, setSymbol] = useState('1HZ10V');
  const [growthRate, setGrowthRate] = useState(5);
  const [entry, setEntry] = useState(0);
  const [exit, setExit] = useState(0);
  const [diff, setDiff] = useState(0);
  const [pct, setPct] = useState(0);
  const [counter, setCounter] = useState(0);
  const [hist, setHist] = useState<number[]>([]);
  const [filterN, setFilter] = useState(100);
  const [crashed, setCrash] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const prev = useRef<number | null>(null);
  const streak = useRef(0);

  const openSocket = useCallback(
    (sym: string) => {
      wsRef.current?.close();
      const sock = new WebSocket(
        'wss://ws.binaryws.com/websockets/v3?app_id=1089',
      );
      wsRef.current = sock;

      sock.onopen = () =>
        sock.send(
          JSON.stringify({
            ticks_history: sym,
            style: 'ticks',
            count: 5000,
            end: 'latest',
            subscribe: 1,
          }),
        );

      sock.onmessage = (e) => {
        const msg = JSON.parse(e.data);

        if (msg.msg_type === 'history') {
          const prices: number[] = msg.history.prices.map(Number);
          const { currentStreak, streakHistory } = analysePrices(
            prices,
            sym,
            growthRate,
          );
          streak.current = currentStreak;
          prev.current = prices.at(-1) ?? null;
          setCounter(currentStreak);
          setHist(streakHistory);
          setCrash(false);
          return;
        }

        if (msg.msg_type === 'tick') onTick(msg.tick.quote);
      };

      sock.onerror = console.error;
    },
    [growthRate],
  );

  const onTick = (val: number) => {
    const p = prev.current;
    prev.current = val;
    if (p === null) return;

    const d = val - p;
    const pctChange = Math.abs((d / p) * 100);
    const thr = THRESHOLD_MAP[String(growthRate)][symbol];

    setEntry(p);
    setExit(val);
    setDiff(d);
    setPct(pctChange);

    if (pctChange <= thr) {
      streak.current += 1;
      setCounter(streak.current);
      setCrash(false);
    } else {
      // 🆕 Always push one value (prev streak or 0) on crash
      setHist((h) => {
        const toPush = streak.current === 0 ? 0 : streak.current;
        const nxt = [...h, toPush];
        return nxt.length > 100 ? nxt.slice(-100) : nxt;
      });
      streak.current = 0;
      setCounter(0);
      setCrash(true);
    }
  };

  /* reopen WS on deps change */
  useEffect(() => {
    openSocket(symbol);
    return () => wsRef.current?.close();
  }, [symbol, openSocket]);

  const shownHist = (filterN > 0 ? hist.slice(-filterN) : hist).reverse();

  /* ───── render ───── */

  return (
    <div className="aviator-predictor">
      <SnakeRun length={counter} crashed={crashed} />
      <AccumulatorPanel symbol={symbol} growthRate={growthRate} />

      <div className="market-selector">
        <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          {Object.entries(MARKET_NAMES).map(([v, lbl]) => (
            <option key={v} value={v}>
              {lbl}
            </option>
          ))}
        </select>
      </div>

      <div className="growth-rate-selector">
        {[1, 2, 3, 4, 5].map((r) => (
          <button
            key={r}
            className={growthRate === r ? 'active' : ''}
            onClick={() => setGrowthRate(r)}
          >
            {r}% Growth
          </button>
        ))}
      </div>

      <div className="analyse-last">
        <label>
          Analyse last&nbsp;
          <input
            type="number"
            min={0}
            max={100}
            value={filterN}
            onChange={(e) => setFilter(+e.target.value || 0)}
          />
          &nbsp;streaks (0 = all)
        </label>
      </div>

      <div className="data-display">
        <div className="data-row">
          <span>Entry Spot:</span>
          <span>{entry.toFixed(4)}</span>
        </div>
        <div className="data-row">
          <span>Exit Spot:</span>
          <span>{exit.toFixed(4)}</span>
        </div>
        <div className="data-row">
          <span>Current:</span>
          <span>{diff.toFixed(4)}</span>
        </div>
        <div className="data-row">
          <span>Crash Monitor:</span>
          <span>{pct.toFixed(6)}%</span>
        </div>
        <div className="data-row">
          <span>Counter:</span>
          <span style={{ color: getCounterColor(counter) }}>{counter}</span>
        </div>
      </div>

      <div className="history-display">
        <h3>Last 100 Counts</h3>
        <div className="history-values">
          {shownHist.map((n, i) => (
            <span
              key={i}
              className="history-value"
              style={{ color: getCounterColor(n) }}
            >
              {n}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TickAnalysis;
