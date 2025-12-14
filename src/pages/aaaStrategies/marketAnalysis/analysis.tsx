import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
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
    MarketDerivedVolatility751sIcon,
    MarketDerivedVolatility151sIcon,
    MarketDerivedVolatility301sIcon,
    MarketDerivedVolatility901sIcon,
    TradeTypesDigitsOverIcon,
    TradeTypesDigitsUnderIcon,
} from '@deriv/quill-icons';
import './analysis.scss';

type DigitStat = {
    digit: number;
    percentage: number;
    isMax: boolean;
    isMin: boolean;
};

type MarketScan = {
    symbol: string;
    digitCounts: number[];
    total: number;
    top3: Array<{ digit: number; count: number; pct: number }>;
    least: { digit: number; count: number; pct: number };
    volLabel: '1s' | 'std';
};

const digitColors = [
    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
    '#FF9F40', '#8AC249', '#EA5F89', '#00BFFF', '#A0522D'
];

const ALL_SYMBOLS = [
    'R_10', '1HZ10V', '1HZ15V',
    'R_25', '1HZ25V', '1HZ30V',
    'R_50', '1HZ50V',
    'R_75', '1HZ75V', '1HZ90V',
    'R_100', '1HZ100V'
];

const fixed3 = new Set(['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V']);
const fixed4 = new Set(['R_50', 'R_75']);

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
    '1HZ75V': <MarketDerivedVolatility751sIcon width={16} height={16} />,
};

const formatToDigit = (value: number, symbol: string): number => {
    const tickString =
        fixed3.has(symbol) ? value.toFixed(3) :
        fixed4.has(symbol) ? value.toFixed(4) :
        value.toFixed(2);

    return parseInt(tickString.slice(-1), 10);
};

const Iframe = observer(() => {
    const { ui } = useStore();

    /** ===== Single-market live analysis ===== */
    const [currentSymbol, setCurrentSymbol] = useState('1HZ10V');
    const marketSelectionRef = useRef<HTMLSelectElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const prevTickRef = useRef<number | null>(null);
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // how many ticks the circles use – ORIGINAL behaviour but default 1000 instead of 100
    const [filterCount, setFilterCount] = useState<number>(1000);

    const [analysisData, setAnalysisData] = useState({
        lastResults: [] as Array<{ digit: number; price: number; timestamp: Date }>,
        lastDigit: null as number | null,
        lastPrice: null as number | null,
        currentMarket: '1HZ10V',
    });

    /** ===== Cross-market scanner ===== */
    const [scanTicks, setScanTicks] = useState<number>(1000);
    const [scanInProgress, setScanInProgress] = useState(false);
    const [marketScans, setMarketScans] = useState<MarketScan[]>([]);
    const [aggregateTop3, setAggregateTop3] = useState<Array<{ digit: number; count: number; pct: number }>>([]);
    const [scanMsg, setScanMsg] = useState<string>('Waiting for first scan…');

    /** ===== Digit stats for circles (original max/min logic) ===== */
    const calculateDigitStats = (): { digitsData: DigitStat[] } => {
        const filtered = analysisData.lastResults.slice(0, filterCount);
        const total = filtered.length;
        const counts = Array(10).fill(0);

        filtered.forEach(r => {
            counts[r.digit]++;
        });

        if (!total) {
            return {
                digitsData: counts.map((_, digit) => ({
                    digit,
                    percentage: 0,
                    isMax: false,
                    isMin: false,
                })),
            };
        }

        const maxCount = Math.max(...counts);
        const minCount = Math.min(...counts);

        const digitsData: DigitStat[] = counts.map((count, digit) => {
            const percentage = (count / total) * 100;
            return {
                digit,
                percentage,
                isMax: count === maxCount && maxCount > 0,
                isMin: count === minCount && maxCount > 0 && count === minCount && minCount !== maxCount,
            };
        });

        return { digitsData };
    };

    const { digitsData } = calculateDigitStats();

    const calculateStrokeValues = () => {
        const circumference = 2 * Math.PI * 27;
        const dashValue = circumference / 2;
        const dashArray = `${dashValue} ${circumference}`;
        const dashOffset = circumference / 4;
        return { dashArray, dashOffset };
    };

    const { dashArray, dashOffset } = calculateStrokeValues();

    /** ===== Live tick handler ===== */
    const handleTick = (val: number) => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);

        debounceTimer.current = setTimeout(() => {
            const symbol = marketSelectionRef.current?.value || currentSymbol;
            const lastDigit = formatToDigit(val, symbol);

            setAnalysisData(prev => {
                const newLastResults = [
                    { digit: lastDigit, price: val, timestamp: new Date() },
                    ...prev.lastResults,
                ].slice(0, 1000); // store up to 1000

                return {
                    ...prev,
                    lastResults: newLastResults,
                    lastDigit,
                    lastPrice: val,
                    currentMarket: symbol,
                };
            });

            prevTickRef.current = val;
        }, 50);
    };

    /** ===== WebSocket for live panel – initialise ONCE ===== */
    useEffect(() => {
        const initializeWebSocket = (symbol: string) => {
            if (wsRef.current) wsRef.current.close();
            const app_id = 1089;
            wsRef.current = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);

            wsRef.current.onopen = () => {
                wsRef.current?.send(JSON.stringify({
                    ticks_history: symbol,
                    style: 'ticks',
                    count: 5000,
                    end: 'latest',
                    subscribe: 1,
                }));
                setAnalysisData({
                    lastResults: [],
                    lastDigit: null,
                    lastPrice: null,
                    currentMarket: symbol,
                });
            };

            wsRef.current.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data?.error) {
                    console.error('WebSocket error:', data.error.message);
                    return;
                }

                if (data?.msg_type === 'history') {
                    const sym = data?.echo_req?.ticks_history || symbol;
                    const prices: number[] = (data.history?.prices || []).map(Number);
                    if (!prices.length) return;

                    prices.forEach(price => {
                        const d = formatToDigit(price, sym);
                        setAnalysisData(prev => {
                            const newLastResults = [
                                { digit: d, price, timestamp: new Date() },
                                ...prev.lastResults,
                            ].slice(0, 1000);

                            return {
                                ...prev,
                                lastResults: newLastResults,
                                lastDigit: d,
                                lastPrice: price,
                                currentMarket: sym,
                            };
                        });
                    });

                    prevTickRef.current = prices[prices.length - 1];
                } else if (data?.tick) {
                    handleTick(data.tick.quote);
                }
            };

            wsRef.current.onclose = () => console.log('WebSocket connection closed');
            wsRef.current.onerror = (error) => console.error('WebSocket error: ', error);
        };

        const initialSymbol = marketSelectionRef.current?.value || currentSymbol;
        initializeWebSocket(initialSymbol);

        return () => {
            if (wsRef.current) wsRef.current.close();
            if (debounceTimer.current) clearTimeout(debounceTimer.current!);
        };
        // NOTE: empty dependency array → only runs once on mount
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const refreshData = () => {
        if (marketSelectionRef.current && wsRef.current) {
            const newMarket = marketSelectionRef.current.value;
            setCurrentSymbol(newMarket);
            wsRef.current.send(JSON.stringify({
                ticks_history: newMarket,
                style: 'ticks',
                count: 5000,
                end: 'latest',
                subscribe: 1,
            }));

            setAnalysisData({
                lastResults: [],
                lastDigit: null,
                lastPrice: null,
                currentMarket: newMarket,
            });
        }
    };

    /** ===== Suggestion logic (Over/Under) ===== */
    const suggestFromDigit = (digit: number) => {
        if (digit <= 4) {
            return {
                type: 'UNDER' as const,
                text: 'Under 6–9 (start from 7)',
                icon: <TradeTypesDigitsUnderIcon width={16} height={16} />,
            };
        }
        return {
            type: 'OVER' as const,
            text: 'Over 3–4 (start from 4)',
            icon: <TradeTypesDigitsOverIcon width={16} height={16} />,
        };
    };

    /** ===== Cross-market scanner (one-shot) ===== */
    const runScan = async () => {
        if (scanInProgress) return;

        setScanInProgress(true);
        setScanMsg('Scanning markets…');

        try {
            const app_id = 1089;
            const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);

            const perMarket: Record<string, MarketScan> = {};
            const pending = new Set<string>(ALL_SYMBOLS);
            const maxCount = Math.max(10, Math.min(5000, scanTicks));

            await new Promise<void>((resolve, reject) => {
                let opened = false;

                ws.onopen = () => {
                    opened = true;
                    ALL_SYMBOLS.forEach(sym => {
                        ws.send(JSON.stringify({
                            ticks_history: sym,
                            style: 'ticks',
                            count: maxCount,
                            end: 'latest',
                        }));
                    });
                };

                ws.onerror = (err) => {
                    console.error(err);
                    reject(err);
                };

                ws.onmessage = (evt) => {
                    const data = JSON.parse(evt.data);
                    if (data?.error) {
                        console.error('Scan error:', data.error.message);
                        const sym = data?.echo_req?.ticks_history;
                        if (sym) pending.delete(sym);
                        if (!pending.size && opened) resolve();
                        return;
                    }

                    if (data?.msg_type === 'history') {
                        const sym = data?.echo_req?.ticks_history;
                        const prices: number[] = (data.history?.prices || []).map(Number);
                        if (!sym) return;

                        const counts = Array(10).fill(0);
                        prices.forEach(p => {
                            const d = formatToDigit(p, sym);
                            counts[d]++;
                        });

                        const total = prices.length || 1;
                        const rankedFull = counts
                            .map((c, d) => ({ digit: d, count: c, pct: (c / total) * 100 }))
                            .sort((a, b) => b.count - a.count);

                        const top3 = rankedFull.slice(0, 3);
                        const least = rankedFull[rankedFull.length - 1];

                        perMarket[sym] = {
                            symbol: sym,
                            digitCounts: counts,
                            total,
                            top3,
                            least,
                            volLabel: sym.startsWith('1HZ') ? '1s' : 'std',
                        };

                        pending.delete(sym);
                        setScanMsg(`Scanned ${ALL_SYMBOLS.length - pending.size}/${ALL_SYMBOLS.length}…`);

                        if (!pending.size && opened) resolve();
                    }
                };
            });

            ws.close();

            const results = ALL_SYMBOLS
                .filter(sym => perMarket[sym])
                .map(sym => perMarket[sym]);

            // Aggregate across all markets (only for top-3 global cards)
            const aggCounts = Array(10).fill(0);
            let aggTotal = 0;

            results.forEach(r => {
                aggTotal += r.total;
                r.digitCounts.forEach((c, d) => {
                    aggCounts[d] += c;
                });
            });

            const top3 = aggCounts
                .map((c, d) => ({ digit: d, count: c, pct: aggTotal ? (c / aggTotal) * 100 : 0 }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 3);

            setMarketScans(results);
            setAggregateTop3(top3);
            setScanMsg('Live every 5s');
        } catch (e) {
            console.error(e);
            setScanMsg('Scan failed.');
        } finally {
            setScanInProgress(false);
        }
    };

    /** ===== Auto scan every 5 seconds ===== */
    useEffect(() => {
        runScan(); // initial
        const id = setInterval(() => {
            runScan();
        }, 5000);

        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scanTicks]);

    return (
        <div
            className="bot-analysis"
            style={{ background: ui.is_dark_mode_on ? 'var(--general-main-1)' : 'transparent' }}
        >
            {/* Analysis mode selector (visual only now) */}
        

            {/* Market selection for live panel */}
            <div className="market-selector">
                <i className="fas fa-chart-line market-icon"></i>
                <select
                    className="marketSelection"
                    id="marketSelection"
                    ref={marketSelectionRef}
                    onChange={(e) => {
                        const newMarket = e.target.value;
                        setCurrentSymbol(newMarket);

                        // Only re-subscribe + reset digit analysis – no full re-init
                        if (wsRef.current) {
                            wsRef.current.send(JSON.stringify({
                                ticks_history: newMarket,
                                style: 'ticks',
                                count: 5000,
                                end: 'latest',
                                subscribe: 1,
                            }));
                        }
                        setAnalysisData({
                            lastResults: [],
                            lastDigit: null,
                            lastPrice: null,
                            currentMarket: newMarket,
                        });
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

            {/* Digits circular stats (single-market, original style, 1000 ticks default) */}
            <div className="digits-container">
                <div className="digits-header">
                    <div className="digits-filter">
                        <label>Analyze last:</label>
                        <input
                            type="number"
                            className="trade-input"
                            value={filterCount}
                            onChange={(e) =>
                                setFilterCount(
                                    Math.max(1, Math.min(10000, Number(e.target.value) || 1))
                                )
                            }
                            min="1"
                            max="10000"
                            step="1"
                        />
                    </div>
                </div>

                <div className="digits digits--trade">
                    {digitsData.map((d) => {
                        const isLatest = analysisData.lastDigit === d.digit;

                        return (
                            <div
                                key={d.digit}
                                className={`digits__digit ${isLatest ? 'digits__digit--latest' : ''}`}
                                data-digit={d.digit}
                            >
                                <div className="digits__pie-container">
                                    <svg
                                        className="digits__pie-progress"
                                        width="60"
                                        height="60"
                                        viewBox="0 0 60 60"
                                    >
                                        <circle
                                            className="progress__bg"
                                            cx="30"
                                            cy="30"
                                            r="27"
                                        ></circle>
                                        <circle
                                            className={`progress__value ${
                                                d.isMax
                                                    ? 'progress__value--is-max'
                                                    : d.isMin
                                                    ? 'progress__value--is-min'
                                                    : ''
                                            }`}
                                            cx="30"
                                            cy="30"
                                            r="27"
                                            strokeDasharray={dashArray}
                                            strokeDashoffset={dashOffset}
                                        />
                                    </svg>
                                </div>
                                <span
                                    className={`digits__digit-value ${
                                        isLatest ? 'digits__digit-value--latest' : ''
                                    }`}
                                >
                                    <i className="digits__digit-display-value">{d.digit}</i>
                                    <i className="digits__digit-display-percentage">
                                        {d.percentage.toFixed(1)}%
                                    </i>
                                </span>
                            </div>
                        );
                    })}

                    <span
                        className="digits__pointer"
                        style={{
                            left: `calc(${(analysisData.lastDigit || 0) * 10 + 5}%)`,
                            transform: 'translateX(-50%)',
                        }}
                    >
                        <svg viewBox="0 0 8 8" width="8" height="8" className="digits__icon">
                            <circle cx="4" cy="4" r="3.5" fill="#FF9800" />
                            <path d="M4 2 L5 5.5 H3 Z" fill="#fff" />
                        </svg>
                    </span>
                </div>
            </div>

            {/* Volatility-aware scanner (always visible, auto-refresh) */}
            <div className="scanner-container">
                <div className="history-title">Volatility-Aware Scanner</div>

                <div className="scanner-controls">
                    <div className="scanner-input-group">
                        <label>Ticks per market</label>
                        <input
                            type="number"
                            className="trade-input"
                            min={10}
                            max={5000}
                            step={10}
                            value={scanTicks}
                            onChange={(e) =>
                                setScanTicks(
                                    Math.max(10, Math.min(5000, Number(e.target.value) || 1000))
                                )
                            }
                        />
                    </div>

                    <button
                        className="refresh-btn"
                        onClick={runScan}
                        disabled={scanInProgress}
                    >
                        {scanInProgress ? 'Scanning…' : 'Rescan now'}
                    </button>

                    <div className="scan-status">{scanMsg}</div>
                </div>

                {/* Aggregate Top-3 (only 3 cards, no least here) */}
                <div className="scanner-grid">
                    {aggregateTop3.length === 0 ? (
                        <div className="scanner-empty">
                            Waiting for scan data…
                        </div>
                    ) : (
                        aggregateTop3.map((item, idx) => {
                            const suggestion = suggestFromDigit(item.digit);
                            const cardClass =
                                idx === 0
                                    ? 'suggestion-card top-1'
                                    : idx === 1
                                    ? 'suggestion-card top-2'
                                    : 'suggestion-card top-3';

                            return (
                                <div key={idx} className={cardClass}>
                                    <div className="suggestion-rank">#{idx + 1}</div>
                                    <div
                                        className="suggestion-digit"
                                        style={{ backgroundColor: digitColors[item.digit] }}
                                    >
                                        {item.digit}
                                    </div>
                                    <div className="suggestion-pct">
                                        {item.pct.toFixed(2)}%
                                    </div>
                                    <div className="suggestion-type">
                                        {suggestion.icon}
                                        <span>{suggestion.text}</span>
                                    </div>
                                    <div className="suggestion-note">
                                        {idx === 2
                                            ? 'Gainer (3rd most appearing across all markets)'
                                            : 'Most appearing across all markets'}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Per-market breakdown with least digit added */}
                <div className="scanner-results">
                    {marketScans.length === 0 ? (
                        <div className="scanner-empty">
                            Pulling snapshots for all volatility markets…
                        </div>
                    ) : (
                        marketScans.map((ms) => (
                            <div key={ms.symbol} className="scanner-row">
                                <div className="scanner-row-left">
                                    <div className="market-icon">
                                        {marketIcons[ms.symbol] || <span>{ms.symbol}</span>}
                                    </div>
                                    <div className="scanner-symbol">
                                        {ms.symbol}
                                        <span className={`vol-badge vol-${ms.volLabel}`}>
                                            {ms.volLabel}
                                        </span>
                                    </div>
                                </div>
                                <div className="scanner-row-right">
                                    {/* Top 3 chips */}
                                    {ms.top3.map((t, i) => {
                                        const suggestion = suggestFromDigit(t.digit);
                                        return (
                                            <div
                                                key={`top-${ms.symbol}-${i}`}
                                                className="scanner-chip"
                                                title={`Digit ${t.digit} • ${t.pct.toFixed(2)}%`}
                                            >
                                                <span
                                                    className="chip-digit"
                                                    style={{ backgroundColor: digitColors[t.digit] }}
                                                >
                                                    {t.digit}
                                                </span>
                                                <span className="chip-pct">
                                                    {t.pct.toFixed(1)}%
                                                </span>
                                                <span
                                                    className={`chip-sugg ${suggestion.type.toLowerCase()}`}
                                                >
                                                    {suggestion.type}
                                                </span>
                                            </div>
                                        );
                                    })}

                                    {/* Least appearing chip (only here, not in global cards) */}
                                    {!ms.top3.some(t => t.digit === ms.least.digit) && (
                                        <div
                                            key={`least-${ms.symbol}`}
                                            className="scanner-chip"
                                            title={`Least: digit ${ms.least.digit} • ${ms.least.pct.toFixed(2)}%`}
                                        >
                                            <span
                                                className="chip-digit"
                                                style={{ backgroundColor: digitColors[ms.least.digit] }}
                                            >
                                                {ms.least.digit}
                                            </span>
                                            <span className="chip-pct">
                                                {ms.least.pct.toFixed(1)}%
                                            </span>
                                            <span className="chip-sugg least">
                                                LEAST
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* History strip (single-market) */}
            <div className="history-container">
                <div className="history-title">
                    Analysis Chamber
                    <button className="refresh-btn" id="refreshBtn" onClick={refreshData}>
                        <i className="fas fa-sync-alt"></i> Refresh
                    </button>
                </div>
                <div className="history-items">
                    {analysisData.lastResults.slice(0, filterCount).map((result, index) => (
                        <div
                            key={index}
                            className="history-item"
                            style={{
                                backgroundColor: digitColors[result.digit],
                                color: 'white',
                            }}
                            title={`Price: ${result.price}`}
                        >
                            {result.digit}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});

export default Iframe;
