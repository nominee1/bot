import { useEffect, useRef, useState } from 'react';

interface AnalysisData {
  evenCount: number;
  oddCount: number;
  riseCount: number;
  fallCount: number;
  totalCount: number;
  lastResults: Array<{
    digit: number;
    isEven: boolean;
    isRise: boolean | null;
    price: number;
    timestamp: Date;
  }>;
  lastDigit: number | null;
  lastPrice: number | null;
  digitCounts: number[];
  overDigit: number;
  underDigit: number;
  tickRange: number;
  currentMarket: string;
}

interface AnalysisActions {
  handleTick: (val: number) => void;
  refreshData: () => void;
  renderHistory: (mode: string) => JSX.Element;
  handleOverDigitSelect: (digit: number) => void;
  handleUnderDigitSelect: (digit: number) => void;
}

const useMarketAnalysis = (initialMarket: string): { data: AnalysisData; actions: AnalysisActions } => {
  const [data, setData] = useState<AnalysisData>({
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
    currentMarket: initialMarket
  });

  const wsRef = useRef<WebSocket | null>(null);
  const prevTickRef = useRef<number | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();
  const marketSelectionRef = useRef<HTMLSelectElement>(null);

  const formatTickValue = (value: number, marketFormat?: string) => {
    if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(marketFormat || data.currentMarket)) {
      return value.toFixed(3);
    }
    if (['R_50', 'R_75'].includes(marketFormat || data.currentMarket)) {
      return value.toFixed(4);
    }
    return value.toFixed(2);
  };

  const handleTick = (val: number) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const prev = prevTickRef.current;
      if (prev === null) { prevTickRef.current = val; return; }

      const tickString = formatTickValue(val, data.currentMarket);
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

      setData(prev => {
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
          currentMarket: prev.currentMarket
        };
      });
      prevTickRef.current = val;
    }, 50);
  };

  const renderEvenOddHistory = () => {
    return data.lastResults.slice(0, 100).map((result, index) => (
      <div key={index} className="history-item" style={{ color: result.isEven ? '#2ecc71' : '#e74c3c' }}>
        {result.isEven ? 'E' : 'O'}
      </div>
    ));
  };

  const renderOverUnderHistory = () => {
    return data.lastResults.slice(0, 100).map((result, index) => {
      const isOver = data.overDigit === 0 ?
        result.digit > 0 :
        result.digit > data.overDigit;
      const isUnder = result.digit < data.underDigit;

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
    const filteredResults = data.lastResults
      .filter(result => result.isRise !== null)
      .slice(0, 100);

    if (filteredResults.length === 0) {
      return (
        <div className="no-results-message">
          {data.lastResults.length === 0
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
        title={`Price: ${result.price} (Previous: ${data.lastPrice})`}
      >
        {result.isRise ? '↑' : result.isRise === false ? '↓' : '='}
      </div>
    ));
  };

  const renderHistory = (mode: string) => {
    switch (mode) {
      case 'evenOdd':
        return renderEvenOddHistory();
      case 'overUnder':
        return renderOverUnderHistory();
      case 'riseFall':
        return renderRiseFallHistory();
      default:
        return renderEvenOddHistory();
    }
  };

  const handleOverDigitSelect = (digit: number) => {
    setData(prev => ({ ...prev, overDigit: digit }));
  };

  const handleUnderDigitSelect = (digit: number) => {
    setData(prev => ({ ...prev, underDigit: digit }));
  };

  const refreshData = () => {
    if (marketSelectionRef.current && wsRef.current) {
      const newMarket = marketSelectionRef.current.value;
      setData({
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

      wsRef.current.send(JSON.stringify({
        ticks_history: newMarket,
        style: 'ticks',
        count: 5000,
        end: 'latest',
        subscribe: 1
      }));
    }
  };

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
            const tickString = formatTickValue(price, data.currentMarket);
            const lastDigit = parseInt(tickString.slice(-1));
            const isEven = lastDigit % 2 === 0;

            setData(prev => {
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
                currentMarket: symbol
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

    initializeWebSocket(initialMarket);

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [initialMarket]);

  return {
    data,
    actions: {
      handleTick,
      refreshData,
      renderHistory,
      handleOverDigitSelect,
      handleUnderDigitSelect
    }
  };
};

export default useMarketAnalysis;