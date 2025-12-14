import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { createChart, ColorType, CrosshairMode } from 'lightweight-charts';
import { 
  MarketDerivedVolatility1001sIcon,
  MarketDerivedVolatility100Icon,
  MarketDerivedVolatility10Icon,
  MarketDerivedVolatility25Icon,
  MarketDerivedVolatility50Icon,
  MarketDerivedVolatility75Icon,
  MarketDerivedVolatility101sIcon,
  MarketDerivedVolatility251sIcon,
  MarketDerivedVolatility501sIcon,
  MarketDerivedVolatility751sIcon
} from '@deriv/quill-icons';
import { useEffect, useRef, useState } from 'react';
import './Rise.scss';

interface TickData {
  price: number;
  change: 'R' | 'F' | 'N';
  timestamp: number;
}

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Prediction {
  direction: 'R' | 'F';
  confidence: number;
  method: string;
}

const Rise = observer(() => {
  const { ui } = useStore();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const marketSelectionRef = useRef<HTMLSelectElement>(null);
  const ticksPerCandleRef = useRef<HTMLSelectElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const currentCandleRef = useRef<CandleData | null>(null);
  const lastPriceRef = useRef<number | null>(null);
  const allTicksRef = useRef<TickData[]>([]);
  const relevantTicksRef = useRef<TickData[]>([]);

  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState('Not Connected');
  const [currentTick, setCurrentTick] = useState('-');
  const [tickChange, setTickChange] = useState('-');
  const [riseCount, setRiseCount] = useState(0);
  const [fallCount, setFallCount] = useState(0);
  const [neutralCount, setNeutralCount] = useState(0);
  const [tickHistory, setTickHistory] = useState<TickData[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [selectedMethod, setSelectedMethod] = useState('probability');
  const [selectedMarket, setSelectedMarket] = useState('1HZ10V');
  const [ticksPerCandle, setTicksPerCandle] = useState(15);
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [lastChange, setLastChange] = useState('-');

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: ui.is_dark_mode_on ? '#1a1a1a' : '#ffffff' },
        textColor: ui.is_dark_mode_on ? '#d9d9d9' : '#333333',
      },
      grid: {
        vertLines: { color: ui.is_dark_mode_on ? '#404040' : '#e0e0e0' },
        horzLines: { color: ui.is_dark_mode_on ? '#404040' : '#e0e0e0' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    candleSeriesRef.current = candleSeries;

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [ui.is_dark_mode_on]);

  // Connect to WebSocket
  const connectToWebSocket = () => {
    if (isConnected) return;

    const symbol = marketSelectionRef.current?.value || '1HZ10V';
    setStatus('Connecting...');
    setIsConnected(false);

    wsRef.current = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=36300`);

    wsRef.current.onopen = () => {
      setIsConnected(true);
      setStatus('Connected, subscribing...');
      subscribeToTicks();
    };

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) {
        handleWebSocketError(data.error);
        return;
      }
      if (data.tick) {
        processTick(data.tick);
      } else if (data.msg_type === 'tick') {
        processTick(data.tick);
      }
    };

    wsRef.current.onclose = () => {
      setIsConnected(false);
      setStatus('Disconnected');
    };

    wsRef.current.onerror = (error) => {
      setIsConnected(false);
      setStatus(`Error: ${error}`);
    };
  };

  // Process tick data
  const processTick = (tick: any) => {
    const timestamp = tick.epoch * 1000;
    const price = parseFloat(tick.quote);
    const formattedPrice = formatPrice(price, selectedMarket);
    
    setCurrentTick(formattedPrice);

    let change: 'R' | 'F' | 'N' = 'N';
    if (lastPriceRef.current !== null) {
      if (price > lastPriceRef.current) {
        change = 'R';
        setRiseCount(prev => prev + 1);
      } else if (price < lastPriceRef.current) {
        change = 'F';
        setFallCount(prev => prev + 1);
      } else {
        setNeutralCount(prev => prev + 1);
      }
    }

    const newTick: TickData = {
      price,
      change,
      timestamp
    };

    // Update tick history
    allTicksRef.current = [newTick, ...allTicksRef.current.slice(0, 4999)];
    if (change !== 'N') {
      relevantTicksRef.current = [newTick, ...relevantTicksRef.current.slice(0, 4999)];
    }

    setTickHistory(prev => [newTick, ...prev.slice(0, 99)]);
    setTickChange(change === 'N' ? '-' : change);
    setLastChange(change === 'N' ? '-' : change);
    lastPriceRef.current = price;

    updateStatistics();
    renderHistory();
    processChartCandle(tick);
  };

  // Process candle for chart
  const processChartCandle = (tick: any) => {
    if (!candleSeriesRef.current) return;

    const timestamp = tick.epoch * 1000;
    const candleTime = Math.floor(timestamp / (60000)) * 60000; // 1-minute candles
    const price = parseFloat(tick.quote);

    if (!currentCandleRef.current || currentCandleRef.current.time !== candleTime) {
      if (currentCandleRef.current) {
        setCandles(prev => [currentCandleRef.current!, ...prev.slice(0, 199)]);
        candleSeriesRef.current.update(currentCandleRef.current);
      }

      currentCandleRef.current = {
        time: candleTime,
        open: price,
        high: price,
        low: price,
        close: price
      };
    } else {
      currentCandleRef.current.high = Math.max(currentCandleRef.current.high, price);
      currentCandleRef.current.low = Math.min(currentCandleRef.current.low, price);
      currentCandleRef.current.close = price;
    }

    setStatus(`Analyzing | Last: ${price} | Time: ${new Date(timestamp).toLocaleTimeString()}`);
  };

  // Format price based on market
  const formatPrice = (price: number, market: string) => {
    if (market === 'R_10' || market === '1HZ10V') return price.toFixed(3);
    if (market === 'R_50' || market === 'R_75') return price.toFixed(4);
    return price.toFixed(2);
  };

  // Subscribe to ticks
  const subscribeToTicks = () => {
    if (!wsRef.current || !isConnected) return;

    const symbol = marketSelectionRef.current?.value || '1HZ10V';
    const subscribeMsg = {
      ticks: symbol,
      subscribe: 1
    };

    wsRef.current.send(JSON.stringify(subscribeMsg));
    setStatus(`Subscribed to ${symbol}`);
  };

  // Disconnect WebSocket
  const disconnectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setStatus('Disconnected');
  };

  // Reset all data
  const resetData = () => {
    setRiseCount(0);
    setFallCount(0);
    setNeutralCount(0);
    setTickHistory([]);
    setPredictions([]);
    setCurrentTick('-');
    setTickChange('-');
    setLastChange('-');
    lastPriceRef.current = null;
    currentCandleRef.current = null;
    setCandles([]);
    allTicksRef.current = [];
    relevantTicksRef.current = [];
    
    if (candleSeriesRef.current) {
      candleSeriesRef.current.setData([]);
    }
  };

  // Handle WebSocket errors
  const handleWebSocketError = (error: any) => {
    console.error('WebSocket error:', error);
    setStatus(`Error: ${error.message}`);
    if (error.code === 'AuthorizationFailed') {
      disconnectWebSocket();
    }
  };

  // Update statistics
  const updateStatistics = () => {
    const total = riseCount + fallCount + neutralCount;
    if (total > 0) {
      const risePercent = (riseCount / total * 100).toFixed(1);
      const fallPercent = (fallCount / total * 100).toFixed(1);
      // These values would be used in your statistics display
    }
  };

  // Render tick history
  const renderHistory = () => {
    // This updates the visual representation of the history
    // The actual rendering is handled by React through the tickHistory state
  };

  // Prediction methods
  const predictWithProbability = (count = 5): Prediction[] => {
    const ticks = relevantTicksRef.current.slice(0, 100);
    if (ticks.length < 10) return [];
    
    const riseTicks = ticks.filter(t => t.change === 'R').length;
    const fallTicks = ticks.filter(t => t.change === 'F').length;
    const totalChanges = riseTicks + fallTicks;
    
    if (totalChanges === 0) return [];
    
    const riseProbability = riseTicks / totalChanges;
    
    return Array(count).fill(0).map(() => ({
      direction: Math.random() < riseProbability ? 'R' : 'F',
      confidence: Math.round(Math.max(riseProbability, 1 - riseProbability) * 100),
      method: 'Probability'
    }));
  };

  const predictWithPatterns = (count = 5): Prediction[] => {
    const ticks = relevantTicksRef.current;
    if (ticks.length < 20) return [];
    
    const patternLength = 5;
    const currentPattern = ticks.slice(0, patternLength).map(t => t.change).join('');
    const matches: ('R' | 'F')[] = [];
    
    for (let i = patternLength; i < ticks.length - 1; i++) {
      const testPattern = ticks.slice(i, i + patternLength).map(t => t.change).join('');
      if (testPattern === currentPattern) {
        matches.push(ticks[i + 1].change);
      }
    }
    
    if (matches.length === 0) return [];
    
    const riseMatches = matches.filter(m => m === 'R').length;
    const confidence = Math.round(Math.max(riseMatches, matches.length - riseMatches) / matches.length * 100);
    const predictedDirection = riseMatches > matches.length / 2 ? 'R' : 'F';
    
    return Array(count).fill({
      direction: predictedDirection,
      confidence,
      method: 'Patterns'
    });
  };

  const predictWithMovingAverages = (count = 5): Prediction[] => {
    const ticks = allTicksRef.current;
    if (ticks.length < 50) return [];
    
    const shortPeriod = 5;
    const longPeriod = 20;
    const shortMAs: number[] = [];
    const longMAs: number[] = [];
    
    // Calculate short moving averages
    for (let i = 0; i < ticks.length - shortPeriod; i++) {
      const sum = ticks.slice(i, i + shortPeriod).reduce((sum, t) => sum + t.price, 0);
      shortMAs.push(sum / shortPeriod);
    }
    
    // Calculate long moving averages
    for (let i = 0; i < ticks.length - longPeriod; i++) {
      const sum = ticks.slice(i, i + longPeriod).reduce((sum, t) => sum + t.price, 0);
      longMAs.push(sum / longPeriod);
    }
    
    if (shortMAs.length < 2 || longMAs.length < 2) return [];
    
    const currentShort = shortMAs[0];
    const currentLong = longMAs[0];
    const prevShort = shortMAs[1];
    const prevLong = longMAs[1];
    
    let predictedDirection: 'R' | 'F' | null = null;
    let confidence = 0;
    
    // Check for crossover
    if (currentShort > currentLong && prevShort <= prevLong) {
      predictedDirection = 'R';
      confidence = 75;
    } else if (currentShort < currentLong && prevShort >= prevLong) {
      predictedDirection = 'F';
      confidence = 75;
    } else {
      // Check for trend
      const shortTrend = currentShort - shortMAs[Math.min(3, shortMAs.length - 1)];
      const longTrend = currentLong - longMAs[Math.min(3, longMAs.length - 1)];
      
      if (shortTrend > 0 && longTrend > 0) {
        predictedDirection = 'R';
        confidence = 60;
      } else if (shortTrend < 0 && longTrend < 0) {
        predictedDirection = 'F';
        confidence = 60;
      } else {
        return [];
      }
    }
    
    return Array(count).fill({
      direction: predictedDirection,
      confidence,
      method: 'Moving Avg'
    });
  };

  const predictCombined = (count = 5): Prediction[] => {
    const methods = [
      { name: 'probability', weight: 0.4, fn: predictWithProbability },
      { name: 'patterns', weight: 0.3, fn: predictWithPatterns },
      { name: 'movingAvg', weight: 0.3, fn: predictWithMovingAverages }
    ];
    
    const methodResults = methods.map(method => ({
      method: method.name,
      results: method.fn(count),
      weight: method.weight
    })).filter(m => m.results.length > 0);
    
    if (methodResults.length === 0) return [];
    
    const combinedPredictions: Prediction[] = [];
    
    for (let i = 0; i < count; i++) {
      const votes = { R: 0, F: 0 };
      let totalWeight = 0;
      
      methodResults.forEach(method => {
        const direction = method.results[i].direction;
        votes[direction] += method.weight;
        totalWeight += method.weight;
      });
      
      const predictedDirection = votes.R > votes.F ? 'R' : 'F';
      const confidence = Math.round(Math.max(votes.R, votes.F) / totalWeight * 100);
      
      combinedPredictions.push({
        direction: predictedDirection,
        confidence,
        method: 'Combined'
      });
    }
    
    return combinedPredictions;
  };

  const generatePredictions = () => {
    if (!isConnected) {
      setStatus('Please wait for connection', 'warning');
      return;
    }
    
    let predictions: Prediction[] = [];
    let methodName = '';
    
    switch (selectedMethod) {
      case 'probability':
        predictions = predictWithProbability(5);
        methodName = 'Probability Method';
        break;
      case 'patterns':
        predictions = predictWithPatterns(5);
        methodName = 'Pattern Recognition';
        break;
      case 'movingAvg':
        predictions = predictWithMovingAverages(5);
        methodName = 'Moving Averages';
        break;
      case 'combined':
        predictions = predictCombined(5);
        methodName = 'Combined Analysis';
        break;
    }
    
    setPredictions(predictions);
  };

  const totalCount = riseCount + fallCount + neutralCount;
  const risePercent = totalCount > 0 ? (riseCount / totalCount * 100).toFixed(1) : '0';
  const fallPercent = totalCount > 0 ? (fallCount / totalCount * 100).toFixed(1) : '0';

  return (
    <div className="bot-app" style={{ background: ui.is_dark_mode_on ? 'var(--general-main-1)' : 'transparent' }}>
      <div className="app-container">
        <h1>Denara Rise | Fall Analyzer</h1>
        
        <div id="chart-container" ref={chartContainerRef} style={{ width: '100%', height: '400px' }}></div>
        
        <div className="control-panel">
          <div className="market-selector">
            <label htmlFor="marketSelection">Market:</label>
            <select 
              id="marketSelection" 
              ref={marketSelectionRef}
              value={selectedMarket}
              onChange={(e) => {
                setSelectedMarket(e.target.value);
                if (isConnected) {
                  disconnectWebSocket();
                  connectToWebSocket();
                }
              }}
            >
              <option value="R_10">Volatility 10 index</option>
              <option value="1HZ10V">Volatility 10(1s) index</option>
              <option value="R_25">Volatility 25 index</option>
              <option value="1HZ25V">Volatility 25(1s) index</option>
              <option value="R_50">Volatility 50 index</option>
              <option value="1HZ50V">Volatility 50(1s) index</option>
              <option value="R_75">Volatility 75 index</option>
              <option value="1HZ75V">Volatility 75(1s) index</option>
              <option value="R_100">Volatility 100 index</option>
              <option value="1HZ100V">Volatility 100(1s) index</option>
            </select>
          </div>
          
          <div className="candle-config">
            <label htmlFor="ticksPerCandle">Ticks per candle:</label>
            <select 
              id="ticksPerCandle" 
              ref={ticksPerCandleRef}
              value={ticksPerCandle}
              onChange={(e) => setTicksPerCandle(Number(e.target.value))}
            >
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="15">15</option>
              <option value="20">20</option>
              <option value="30">30</option>
            </select>
          </div>
          
          <div className="websocket-controls">
            <button 
              onClick={connectToWebSocket} 
              disabled={isConnected}
              className="connect-btn"
            >
              <i className="fas fa-plug"></i> Connect
            </button>
            <button 
              onClick={disconnectWebSocket} 
              disabled={!isConnected}
              className="disconnect-btn"
            >
              <i className="fas fa-plug"></i> Disconnect
            </button>
          </div>
          
          <button onClick={resetData} className="refresh-btn">
            <i className="fas fa-sync-alt"></i> Reset
          </button>
          
          <div id="status" style={{ 
            color: status.includes('Error') ? '#ef5350' : 
                  status.includes('Connected') ? '#26a69a' : 
                  status.includes('warning') ? '#f39c12' : '#d9d9d9'
          }}>
            {status}
          </div>
        </div>
        
        <div className="stats-container">
          <div className="stat-box">
            <div className="stat-title">Current Tick</div>
            <div className="stat-value" id="currentTick">{currentTick}</div>
            <div className="stat-label">Change: <span id="tickChange">{tickChange}</span></div>
          </div>
          
          <div className="stat-box">
            <div className="stat-title">Rise %</div>
            <div className="stat-value rise-stat" id="risePercent">{risePercent}%</div>
            <div className="stat-label">Count: <span id="riseCount">{riseCount}</span></div>
          </div>
          
          <div className="stat-box">
            <div className="stat-title">Fall %</div>
            <div className="stat-value fall-stat" id="fallPercent">{fallPercent}%</div>
            <div className="stat-label">Count: <span id="fallCount">{fallCount}</span></div>
          </div>
          
          <div className="stat-box">
            <div className="stat-title">Total Ticks</div>
            <div className="stat-value" id="totalCount">{totalCount}</div>
            <div className="stat-label">Last change: <span id="lastChange" style={{ 
              color: lastChange === 'R' ? '#26a69a' : 
                    lastChange === 'F' ? '#ef5350' : '#9e9e9e'
            }}>{lastChange}</span></div>
          </div>
        </div>
        
        <div className="prediction-panel">
          <div className="method-tabs">
            <div 
              className={`method-tab ${selectedMethod === 'probability' ? 'active' : ''}`} 
              data-method="probability"
              onClick={() => setSelectedMethod('probability')}
            >
              Probability
            </div>
            <div 
              className={`method-tab ${selectedMethod === 'patterns' ? 'active' : ''}`} 
              data-method="patterns"
              onClick={() => setSelectedMethod('patterns')}
            >
              Patterns
            </div>
            <div 
              className={`method-tab ${selectedMethod === 'movingAvg' ? 'active' : ''}`} 
              data-method="movingAvg"
              onClick={() => setSelectedMethod('movingAvg')}
            >
              Moving Avg
            </div>
            <div 
              className={`method-tab ${selectedMethod === 'combined' ? 'active' : ''}`} 
              data-method="combined"
              onClick={() => setSelectedMethod('combined')}
            >
              Combined
            </div>
          </div>
          <div className="prediction-header">Next 5 Predictions</div>
          <div id="predictionResults">
            {predictions.length > 0 ? (
              <div className="prediction-items">
                {predictions.map((prediction, index) => (
                  <div 
                    key={index} 
                    className="prediction-item" 
                    style={{ 
                      borderLeftColor: prediction.direction === 'R' ? '#26a69a' : '#ef5350',
                      backgroundColor: prediction.direction === 'R' ? '#26a69a30' : '#ef535030'
                    }}
                  >
                    <span style={{ fontWeight: 'bold' }}>
                      {index + 1}: {prediction.direction}
                    </span>
                    <span style={{ 
                      float: 'right', 
                      color: prediction.direction === 'R' ? '#26a69a' : '#ef5350'
                    }}>
                      {prediction.confidence}%
                    </span>
                    <div style={{ fontSize: '0.8em', color: '#9e9e9e' }}>
                      {prediction.method}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div>Connect then choose a prediction method</div>
            )}
          </div>
          <button 
            id="predictBtn" 
            className="refresh-btn"
            onClick={generatePredictions}
          >
            <i className="fas fa-chart-line"></i> Generate Predictions
          </button>
        </div>
        
        <div className="history-container">
          <div className="history-header">
            <div className="history-title">Last 100 Results (R=Rise, F=Fall)</div>
          </div>
          <div className="history-items" id="tickHistory">
            {tickHistory.map((tick, index) => (
              <div 
                key={index} 
                className={`tick-item ${tick.change === 'R' ? 'tick-rise' : tick.change === 'F' ? 'tick-fall' : 'tick-neutral'}`}
                title={`${tick.price} | ${new Date(tick.timestamp).toLocaleTimeString()}`}
              >
                {tick.change === 'N' ? '=' : tick.change}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

export default Rise;