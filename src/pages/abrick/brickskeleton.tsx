// Iframe.tsx — Analysis-only UI + Trading controls (UI ONLY; no trading logic)
// Keeps your analysis exactly the same; adds:
// - Trading panel: stake, martingale, ticks, switch-on-loss, losses-to-switch, TP, SL,
//   Entry Point (null), Number of Rounds, Run button (no logic yet).
// - Smart trading modes: Low / Medium / High / Jumble
// - T/P strip, Reset button, Positions placeholder
// Uses same classnames as your reference bot so you can reuse SCSS.

import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import './BrickTower.scss';

type AnalysisMode = 'matches' | 'overUnder';

type TAnalysisItem = {
  digit: number;
  price: number;
  timestamp: Date;
};

const FIXED3 = ['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'];
const FIXED4 = ['R_50', 'R_75'];

const DEFAULT_OVER = [90, 85, 70, 70, 60, 55, 40, 30, 20, 10];
const DEFAULT_UNDER = [10, 20, 30, 30, 40, 45, 60, 70, 80, 90];

const digitColors = [
  '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
  '#FF9F40', '#8AC249', '#EA5F89', '#00BFFF', '#A0522D'
];

const Iframe = observer(() => {
  const { ui } = useStore();

  // ───────────────────────── New (UI-only) trading states ─────────────────────────
  const [stakeInput, setStakeInput] = useState<number | ''>('');
  const [martingaleInput, setMartingaleInput] = useState<number | ''>('');
  const [ticksInput, setTicksInput] = useState<number | ''>(''); // duration (ticks)
  const [switchOnLoss, setSwitchOnLoss] = useState<boolean>(false);
  const [lossesToSwitch, setLossesToSwitch] = useState<number | ''>('');
  const [takeProfit, setTakeProfit] = useState<number | ''>('');
  const [stopLoss, setStopLoss] = useState<number | ''>('');
  const [entryPoint, setEntryPoint] = useState<number | null>(null); // explicit null
  const [roundsInput, setRoundsInput] = useState<number | ''>(''); // number of rounds
  const [isRunning, setIsRunning] = useState(false); // visual only; no trading

  // Positions placeholder (UI only)
  type TStubPos = { id: string; note?: string };
  const [positions, setPositions] = useState<TStubPos[]>([]);
  const [sessionPL, setSessionPL] = useState(0); // UI only status strip

  // ───────────────────────── Existing analysis state (unchanged) ─────────────────────────
  const [activeMode, setActiveMode] = useState<AnalysisMode>('matches');
  const [activeDigits, setActiveDigits] = useState<number[]>([4]);
  const [activeOverUnderDigit, setActiveOverUnderDigit] = useState<number>(4); // default to 4 (visible card)

  const [filterCount, setFilterCount] = useState<number>(100);
  const [currentSymbol, setCurrentSymbol] = useState<string>('1HZ10V');

  const [signalsMode, setSignalsMode] = useState<'over' | 'under'>('over');

  const [overThresholds, setOverThresholds] = useState<number[]>([...DEFAULT_OVER]);
  const [underThresholds, setUnderThresholds] = useState<number[]>([...DEFAULT_UNDER]);

  const [showThresholdPanel, setShowThresholdPanel] = useState(false);
  const thresholdsRef = useRef<HTMLDivElement>(null);

  const [analysisData, setAnalysisData] = useState<{
    lastResults: TAnalysisItem[];
    lastDigit: number | null;
    lastPrice: number | null;
    digitCounts: number[];
    currentMarket: string;
  }>({
    lastResults: [],
    lastDigit: null,
    lastPrice: null,
    digitCounts: Array(10).fill(0),
    currentMarket: '1HZ10V',
  });

  const marketSelectionRef = useRef<HTMLSelectElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();
  const latestDigitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showThresholdPanel) thresholdsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [showThresholdPanel]);

  const formatTickToLastDigit = (val: number, market: string) => {
    let s: string;
    if (FIXED3.includes(market)) s = val.toFixed(3);
    else if (FIXED4.includes(market)) s = val.toFixed(4);
    else s = val.toFixed(2);
    return parseInt(s.slice(-1));
  };

  const calculateDigitStats = () => {
    const filtered = analysisData.lastResults.slice(0, Math.min(1000, filterCount));
    const total = filtered.length;
    const digitCounts = Array(10).fill(0);
    filtered.forEach(r => { digitCounts[r.digit]++; });

    const maxCount = Math.max(...digitCounts);
    const minCount = Math.min(...digitCounts);

    return {
      digitCounts,
      total,
      digitsData: digitCounts.map((count: number, digit: number) => {
        const percentage = total > 0 ? (count / total) * 100 : 0;
        return {
          digit,
          count,
          percentage,
          isMax: count === maxCount && maxCount > 0,
          isMin: count === minCount && minCount > 0 && minCount !== maxCount,
        };
      }),
    };
  };

  const { digitCounts, total, digitsData } = calculateDigitStats();

  const calcRing = () => {
    const circumference = 2 * Math.PI * 27;
    const dashValue = circumference / 2;
    const dashArray = `${dashValue} ${circumference}`;
    const dashOffset = circumference / 4;
    return { dashArray, dashOffset };
  };

  const toggleMode = (mode: AnalysisMode) => {
    setActiveMode(mode);
    if (mode === 'matches') setActiveDigits(prev => (prev.length ? prev : [4]));
    else setActiveOverUnderDigit(d => (typeof d === 'number' ? d : 4));
  };

  const handleDigitClick = (digit: number) => {
    if (activeMode === 'matches') {
      setActiveDigits(prev => prev.includes(digit) ? prev.filter(d => d !== digit) : [...prev, digit]);
    } else {
      setActiveOverUnderDigit(digit);
    }
  };

  const pushTick = (price: number, market: string) => {
    const lastDigit = formatTickToLastDigit(price, market);
    setAnalysisData(prev => {
      const digitCounts = [...prev.digitCounts];
      digitCounts[lastDigit]++;
      const newLastResults: TAnalysisItem[] = [
        { digit: lastDigit, price, timestamp: new Date() },
        ...prev.lastResults,
      ].slice(0, 1000);
      return { ...prev, lastResults: newLastResults, lastDigit, lastPrice: price, digitCounts, currentMarket: market };
    });
  };

  const handleTick = (val: number) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const market = marketSelectionRef.current?.value || currentSymbol;
    debounceTimer.current = setTimeout(() => { pushTick(val, market); }, 50);
  };

  const refreshData = () => {
    if (!wsRef.current || !marketSelectionRef.current) return;
    const newMarket = marketSelectionRef.current.value;

    setCurrentSymbol(newMarket);
    setAnalysisData({
      lastResults: [],
      lastDigit: null,
      lastPrice: null,
      digitCounts: Array(10).fill(0),
      currentMarket: newMarket,
    });

    wsRef.current.send(JSON.stringify({
      ticks_history: newMarket, style: 'ticks', count: 5000, end: 'latest', subscribe: 1,
    }));
  };

  // Signals (cumulative)
  const overSignalPct = Array.from({ length: 10 }, (_, d) => {
    if (total === 0) return 0;
    let sum = 0; for (let k = d + 1; k <= 9; k++) sum += digitCounts[k];
    return (sum / total) * 100;
  });
  const underSignalPct = Array.from({ length: 10 }, (_, d) => {
    if (total === 0) return 0;
    let sum = 0; for (let k = 0; k <= d - 1; k++) sum += digitCounts[k];
    return (sum / total) * 100;
  });

  const overSignals = overSignalPct.map((pct, d) => ({ d, pct }))
    .filter(({ d, pct }) => pct >= overThresholds[d])
    .map(({ d }) => d);

  const underSignals = underSignalPct.map((pct, d) => ({ d, pct }))
    .filter(({ d, pct }) => pct >= underThresholds[d])
    .map(({ d }) => d);

  const selectedDigit =
    activeMode === 'overUnder'
      ? (typeof activeOverUnderDigit === 'number' ? activeOverUnderDigit : (analysisData.lastDigit ?? 4))
      : (analysisData.lastDigit ?? 4);

  const selCount = total > 0 ? digitCounts[selectedDigit] : 0;
  const selPct = total > 0 ? (selCount / total) * 100 : 0;
  const selOverReq = overThresholds[selectedDigit];
  const selUnderReq = underThresholds[selectedDigit];
  const selOverSignal = overSignalPct[selectedDigit];
  const selUnderSignal = underSignalPct[selectedDigit];

  const hitOver = selOverSignal >= selOverReq;
  const hitUnder = selUnderSignal >= selUnderReq;
  const selectedDigitHit = hitOver || hitUnder;

  const clamp01 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const updateOverFor = (d: number, val: number) => setOverThresholds(prev => { const next = [...prev]; next[d] = clamp01(val); return next; });
  const updateUnderFor = (d: number, val: number) => setUnderThresholds(prev => { const next = [...prev]; next[d] = clamp01(val); return next; });
  const updateOverForSelected = (val: number) => updateOverFor(selectedDigit, val);
  const updateUnderForSelected = (val: number) => updateUnderFor(selectedDigit, val);

  // WebSocket
  useEffect(() => {
    if (marketSelectionRef.current) marketSelectionRef.current.value = currentSymbol;

    const app_id = 1089;
    const url = `wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        ticks_history: currentSymbol, style: 'ticks', count: 5000, end: 'latest', subscribe: 1,
      }));
      setAnalysisData({
        lastResults: [], lastDigit: null, lastPrice: null,
        digitCounts: Array(10).fill(0), currentMarket: currentSymbol,
      });
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data?.error) { console.error('WebSocket error:', data.error.message); return; }
      if (data?.msg_type === 'history' && Array.isArray(data.history?.prices)) {
        const prices: number[] = data.history.prices.map(Number);
        if (!prices.length) return;
        const market = marketSelectionRef.current?.value || currentSymbol;
        prices.forEach((p) => pushTick(p, market));
      }
      if (data?.tick?.quote) handleTick(Number(data.tick.quote));
    };

    ws.onerror = (err) => console.error('WebSocket error:', err);
    ws.onclose = () => {};

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      ws.close();
      wsRef.current = null;
    };
  }, [currentSymbol]);

  // ───────────────────────── Render ─────────────────────────
  const { dashArray, dashOffset } = calcRing();

  return (
    <div
      className="brick-tower-container"
      style={{ background: ui.is_dark_mode_on ? 'var(--general-main-1)' : 'transparent' }}
    >
      {/* Analysis Mode Selector */}
      <div className="analysis-mode-selector">
        <ul className="mode-list">
          <li>
            <button
              className={`mode-btn ${activeMode === 'overUnder' ? 'active' : ''}`}
              onClick={() => toggleMode('overUnder')}
            >
              Over/Under Analysis
            </button>
          </li>
          <li>
            <button
              className={`mode-btn ${activeMode === 'matches' ? 'active' : ''}`}
              onClick={() => toggleMode('matches')}
            >
              Digit Spotter
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
            setAnalysisData({
              lastResults: [],
              lastDigit: null,
              lastPrice: null,
              digitCounts: Array(10).fill(0),
              currentMarket: newMarket,
            });
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                ticks_history: newMarket, style: 'ticks', count: 5000, end: 'latest', subscribe: 1,
              }));
            }
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

      {/* Quick row */}
      <div className="analysis-quick-row">
        <div className="digits-filter">
          <label>Analyze last:</label>
          <input
            type="number"
            className="trade-input"
            value={filterCount}
            onChange={(e) => {
              const n = e.target.value === '' ? 1 : Number(e.target.value);
              const value = Math.max(1, Math.min(1000, n));
              setFilterCount(value);
            }}
            min={1}
            max={1000}
            step={1}
          />
          <span>ticks</span>
        </div>

        <div className="current-tick">
          <div><strong>Current Tick:</strong> {analysisData.lastPrice !== null ? analysisData.lastPrice : '—'}</div>
          <div><strong>Last Digit:</strong> {analysisData.lastDigit !== null ? analysisData.lastDigit : '—'}</div>
        </div>

        <button
          className="thresholds-toggle"
          onClick={() => setShowThresholdPanel(v => !v)}
          aria-expanded={showThresholdPanel}
        >
          Change % thresholds
        </button>

        {/* Selected Digit card — always visible in Over/Under */}
        {activeMode === 'overUnder' && (
          <div
            className={[
              'selected-digit',
              (hitOver || hitUnder) ? (hitOver ? 'selected-digit--hit-over' : 'selected-digit--hit-under') : '',
            ].join(' ').trim()}
          >
            <label>Selected Digit: <strong>D{selectedDigit}</strong></label>
            <div className="selected-digit-summary">
              <span><strong>Count:</strong> {selCount}/{total}</span>
              <span><strong>Pct:</strong> {selPct.toFixed(1)}%</span>
              <span className="sel-over"><strong>Signal Over%:</strong> {selOverSignal.toFixed(1)}%</span>
              <span className="sel-under"><strong>Signal Under%:</strong> {selUnderSignal.toFixed(1)}%</span>
            </div>

            <div className="threshold-editors">
              <div className="threshold-field">
                <label>Over ≥ (%)</label>
                <input
                  type="number"
                  className="trade-input"
                  min={0}
                  max={100}
                  step={1}
                  value={overThresholds[selectedDigit]}
                  onChange={(e) => updateOverForSelected(e.target.value === '' ? 0 : Number(e.target.value))}
                />
              </div>
              <div className="threshold-field">
                <label>Under ≥ (%)</label>
                <input
                  type="number"
                  className="trade-input"
                  min={0}
                  max={100}
                  step={1}
                  value={underThresholds[selectedDigit]}
                  onChange={(e) => updateUnderForSelected(e.target.value === '' ? 0 : Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        )}
      </div>

            {/* Signals mode */}
            <div className="signals-mode">
        <label>Screening:</label>
        <div className="signals-toggle">
          <label>
            <input
              type="radio"
              name="signalsMode"
              value="over"
              checked={signalsMode === 'over'}
              onChange={() => setSignalsMode('over')}
            />
            Over thresholds
          </label>
          <label>
            <input
              type="radio"
              name="signalsMode"
              value="under"
              checked={signalsMode === 'under'}
              onChange={() => setSignalsMode('under')}
            />
            Under thresholds
          </label>
        </div>
      </div>

      {/* Thresholds panel as overlay */}
      {showThresholdPanel && (
        <>
          <div className="thresholds-backdrop" onClick={() => setShowThresholdPanel(false)} aria-hidden />
          <div className="thresholds-panel thresholds-panel--overlay" ref={thresholdsRef} role="dialog" aria-modal="true">
            <div className="thresholds-panel__head">
              <div className="title">Thresholds (per digit)</div>
              <div className="hint">Tap any cell to edit. Values are 0–100.</div>
              <button className="thresholds-close" onClick={() => setShowThresholdPanel(false)} aria-label="Close thresholds">✕</button>
            </div>

            <div className="thresholds-grid">
              <div className="row row-digits">
                <div className="cell cell--label">Digit</div>
                {[0,1,2,3,4,5,6,7,8,9].map(d => <div key={`d-${d}`} className="cell cell--digit">{d}</div>)}
              </div>

              <div className="row row-over">
                <div className="cell cell--label">Over ≥ %</div>
                {[0,1,2,3,4,5,6,7,8,9].map(d => (
                  <div key={`over-${d}`} className="cell">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      className="cell-input cell-input--over"
                      value={overThresholds[d]}
                      onChange={(e) => {
                        const v = e.target.value === '' ? 0 : +e.target.value;
                        setOverThresholds(prev => { const next = [...prev]; next[d] = Math.max(0, Math.min(100, Math.round(v))); return next; });
                      }}
                    />
                  </div>
                ))}
              </div>

              <div className="row row-under">
                <div className="cell cell--label">Under ≥ %</div>
                {[0,1,2,3,4,5,6,7,8,9].map(d => (
                  <div key={`under-${d}`} className="cell">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      className="cell-input cell-input--under"
                      value={underThresholds[d]}
                      onChange={(e) => {
                        const v = e.target.value === '' ? 0 : +e.target.value;
                        setUnderThresholds(prev => { const next = [...prev]; next[d] = Math.max(0, Math.min(100, Math.round(v))); return next; });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Analysis Selectors */}
      <div className="analysis-selectors">
        {activeMode === 'matches' && (
          <div className="selector-container">
            <div className="selector-header">
              <div className="selector-title">Spotter Analysis</div>
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
        <div className="digits digits--trade">
          {digitsData.map((digitData) => {
            const isLatest = analysisData.lastDigit === digitData.digit;
            const ouClass =
              activeMode === 'overUnder'
                ? (digitData.digit > selectedDigit ? 'is-over' : digitData.digit < selectedDigit ? 'is-under' : 'is-equal')
                : '';
            return (
              <div
                key={digitData.digit}
                className={`digits__digit ${isLatest ? 'digits__digit--latest' : ''} ${ouClass}`}
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
        </div>
      </div>

         {/* Smart Trading Modes (risk presets) */}
         
         <div className="risk-modes" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 12px' }}>
          <button type="button" className="strat-btn" title="Low risk preset">Low</button>
          <button type="button" className="strat-btn" title="Medium risk preset">Medium</button>
          <button type="button" className="strat-btn" title="High risk preset">High</button>
          <button type="button" className="strat-btn" title="Randomize supported fields">Jumble</button>
        </div>

      {/* ============================ NEW: Trading Panel (UI only) ============================ */}
      <div className="trading-container">
     

        {/* Controls Panel */}
        <div className="trade-controls">
          <div className="trade-control-group">
            <label>Stake</label>
            <input
              type="number"
              className="trade-input"
              min={0}
              step={0.01}
              value={stakeInput === '' ? '' : String(stakeInput)}
              onChange={(e) => setStakeInput(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>

          <div className="trade-control-group">
            <label>Martingale ×</label>
            <input
              type="number"
              className="trade-input"
              min={1}
              step={0.01}
              value={martingaleInput === '' ? '' : String(martingaleInput)}
              onChange={(e) => setMartingaleInput(e.target.value === '' ? '' : Number(e.target.value))}
              title=">1 would enable martingale when logic is added"
            />
          </div>

          <div className="trade-control-group">
            <label>Duration (ticks)</label>
            <input
              type="number"
              className="trade-input"
              min={1}
              step={1}
              value={ticksInput === '' ? '' : String(ticksInput)}
              onChange={(e) => setTicksInput(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>

          <div className="trade-control-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => setSwitchOnLoss(v => !v)}
              className={`strat-btn ${switchOnLoss ? 'active' : ''}`}
              title="When ON: switch after N consecutive losses (logic later)"
            >
              {switchOnLoss ? 'Switch on Loss: ON' : 'Switch on Loss: OFF'}
            </button>
          </div>

          <div className="trade-control-group">
            <label>Losses to switch</label>
            <input
              type="number"
              className="trade-input"
              min={1}
              step={1}
              value={lossesToSwitch === '' ? '' : String(lossesToSwitch)}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') setLossesToSwitch('');
                else setLossesToSwitch(Math.max(1, Math.floor(Number(v))));
              }}
              disabled={!switchOnLoss}
              title="Consecutive losses before switching"
            />
          </div>

          <div className="trade-control-group">
            <label>Take Profit ($)</label>
            <input
              type="number"
              className="trade-input"
              min={0}
              step={0.01}
              value={takeProfit === '' ? '' : String(takeProfit)}
              onChange={(e) => setTakeProfit(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
            />
          </div>

          <div className="trade-control-group">
            <label>Stop Loss ($)</label>
            <input
              type="number"
              className="trade-input"
              min={0}
              step={0.01}
              value={stopLoss === '' ? '' : String(stopLoss)}
              onChange={(e) => setStopLoss(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
            />
          </div>

          <div className="trade-control-group">
            <label>Entry Point</label>
            <input
              type="number"
              className="trade-input"
              placeholder="null"
              value={entryPoint === null ? '' : String(entryPoint)}
              onChange={(e) => {
                if (e.target.value === '') setEntryPoint(null);
                else setEntryPoint(Number(e.target.value));
              }}
              title="Optional; stays null unless set"
            />
          </div>

          <div className="trade-control-group">
            <label>Number of Rounds</label>
            <input
              type="number"
              className="trade-input"
              min={1}
              step={1}
              value={roundsInput === '' ? '' : String(roundsInput)}
              onChange={(e) => setRoundsInput(e.target.value === '' ? '' : Math.max(1, Math.floor(Number(e.target.value))))}
              title="How many rounds to attempt (logic later)"
            />
          </div>

          <div className="trade-control-group">
            <label className="start" style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold', fontSize: 15, gap: 4, cursor: 'pointer' }}>
              Run
            </label>
            <button
              className={`auto-trade-toggle ${isRunning ? 'on' : 'off'}`}
              onClick={() => setIsRunning(v => !v)}
              style={{ padding: '.8rem .12rem', borderRadius: 4 }}
              title="UI only — logic will be added later"
            >
              {isRunning ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

    


       
      </div>
      <div className="title"><small>Type|Market</small><small>Entry|Exit spot</small><small>Buy price & P/L</small></div>
        <div className="open-positions">
          {positions.length === 0 ? (
            <div className="no-positions"><small>No positions</small></div>
          ) : positions.map(p => (
            <div key={p.id} className="position-item position-open">
              <div className="position-header">
                <div className="position-market-contract">—</div>
              </div>
              <div className="position-spots">
                <div className="spot-entry">—</div>
                <div className="spot-exit">—</div>
              </div>
              <div className="position-footer">
                <div className="position-stake">—</div>
                <div className="position-result pending">…</div>
              </div>
            </div>
          ))}
        </div>

        {/* Reset & Positions (UI only) */}
        <div className="trade-control-group" style={{ marginTop: 10 }}>
          <label>&nbsp;</label>
          <button
            className="trade-btn reset-btn"
            onClick={() => {
              setPositions([]);
              setSessionPL(0);
              setIsRunning(false);
            }}
            title="Clear positions and P/L (UI only)"
          >
            Reset
          </button>
        </div>

          {/* T/P & Status strip (UI only) */}
          <div className="trade-status">
          <div>Ready. (No trading logic wired yet)</div>
          <div style={{ marginTop: 6 }}>
            <span>· Session P/L: <b>{sessionPL >= 0 ? '+' : ''}{sessionPL.toFixed(2)}</b></span>
            {typeof takeProfit === 'number' && takeProfit > 0 && (
              <span style={{ marginLeft: 12 }}>· TP: <b>{takeProfit.toFixed(2)}</b></span>
            )}
            {typeof stopLoss === 'number' && stopLoss > 0 && (
              <span style={{ marginLeft: 12 }}>· SL: <b>{stopLoss.toFixed(2)}</b></span>
            )}
            {switchOnLoss && (
              <span style={{ marginLeft: 12 }}>
                · Switch after: <b>{(typeof lossesToSwitch === 'number' ? lossesToSwitch : 1)} loss{(typeof lossesToSwitch === 'number' ? lossesToSwitch : 1) > 1 ? 'es' : ''}</b>
              </span>
            )}
          </div>
        </div>
      {/* ========================== End Trading Panel (UI only) ========================== */}



      {/* Signals Row */}
      <div className="signals-row">
        <div className={`signals-box ${signalsMode === 'over' ? 'active' : ''}`}>
          <div className="signals-title">Over Signals (≥ threshold)</div>
          <div className="signals-badges">
            {overSignals.length
              ? overSignals.map((d) => (
                  <span className="badge badge-red badge--over" key={`over-${d}`} title={`Signal%: ${overSignalPct[d].toFixed(1)} • Threshold: ${overThresholds[d]}%`}>
                    D{d}
                  </span>
                ))
              : <span className="badge">—</span>}
          </div>
        </div>

        <div className={`signals-box ${signalsMode === 'under' ? 'active' : ''}`}>
          <div className="signals-title">Under Signals (≥ threshold)</div>
          <div className="signals-badges">
            {underSignals.length
              ? underSignals.map((d) => (
                  <span className="badge badge-green badge--under" key={`under-${d}`} title={`Signal%: ${underSignalPct[d].toFixed(1)} • Threshold: ${underThresholds[d]}%`}>
                    D{d}
                  </span>
                ))
              : <span className="badge">—</span>}
          </div>
        </div>
      </div>

      {/* Analysis Chamber (History) */}
      <div className="history-container">
        <div className="history-title">
          Analysis Chamber
          <button className="refresh-btn" id="refreshBtn" onClick={refreshData}>
            <i className="fas fa-sync-alt"></i> Refresh
          </button>
        </div>
        <div className="history-items">
          {analysisData.lastResults.slice(0, Math.min(1000, filterCount)).map((result, index) => {
            let style: React.CSSProperties = { backgroundColor: 'transparent', color: 'black' };
            if (activeMode === 'matches' && activeDigits.length > 0) {
              if (activeDigits.includes(result.digit)) style = { backgroundColor: digitColors[result.digit], color: 'white' };
            } else if (activeMode === 'overUnder') {
              if (result.digit > selectedDigit) style = { backgroundColor: '#e74c3c', color: 'white' }; // OVER = red
              else if (result.digit < selectedDigit) style = { backgroundColor: '#2ecc71', color: 'white' }; // UNDER = green
            }
            return (
              <div key={index} className="history-item" style={style} title={`Price: ${result.price}`}>
                {result.digit}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default Iframe;
