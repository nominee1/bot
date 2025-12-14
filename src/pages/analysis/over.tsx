import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import './OverAnalysis.scss';

interface TickData {
    digit: number;
    timestamp: Date;
}

interface Stats {
    currentTick: string;
    lastDigit: string;
    overCount: number;
    overPercentage: string;
    underCount: number;
    underPercentage: string;
    totalCount: number;
    lastDigitDisplay: string;
}

const OverAnalysis = observer(() => {
    const { ui } = useStore();
    const [activeOverDigit, setActiveOverDigit] = useState<number>(1);
    const [activeUnderDigit, setActiveUnderDigit] = useState<number>(8);
    const [selectedMarket, setSelectedMarket] = useState<string>('1HZ10V');

    const [stats, setStats] = useState<Stats>({
        currentTick: '-',
        lastDigit: '-',
        overCount: 0,
        overPercentage: '0%',
        underCount: 0,
        underPercentage: '0%',
        totalCount: 0,
        lastDigitDisplay: '-',
    });

    const [digitCounts, setDigitCounts] = useState<number[]>(Array(10).fill(0));
    const [lastResults, setLastResults] = useState<TickData[]>([]);
    const wsRef = useRef<WebSocket | null>(null);
    const appId = 37016;

    /* ──────────────────────────────────────────────────────────────
     *  WebSocket setup / teardown
     * ────────────────────────────────────────────────────────────── */
    const initializeWebSocket = (symbol: string) => {
        if (wsRef.current) wsRef.current.close();

        wsRef.current = new WebSocket(
            `wss://ws.binaryws.com/websockets/v3?app_id=${appId}`,
        );

        wsRef.current.onopen = () => {
            wsRef.current?.send(JSON.stringify({ ticks: symbol }));
            resetStats();
        };

        wsRef.current.onmessage = event => {
            const data = JSON.parse(event.data);
            if (data?.tick) processTick(data.tick.quote);
        };
    };

    /* ──────────────────────────────────────────────────────────────
     *  Tick processing (uses functional state to avoid race-loss)
     * ────────────────────────────────────────────────────────────── */
    const processTick = (tickValue: number) => {
        const tickString =
            selectedMarket === 'R_10' || selectedMarket === 'R_25'
                ? tickValue.toFixed(3)
                : selectedMarket === 'R_50' || selectedMarket === 'R_75'
                ? tickValue.toFixed(4)
                : tickValue.toFixed(2);

        const lastDigit = parseInt(tickString.slice(-1), 10);

        /* 1️⃣  update digit counts atomically */
        setDigitCounts(prevCounts => {
            const updated = [...prevCounts];
            updated[lastDigit] += 1;
            /* keep derived statistics in-step with the same array */
            updateStats(updated, lastDigit, tickValue);
            return updated;
        });

        /* 2️⃣  keep a rolling history (last 100 ticks) */
        setLastResults(prev =>
            [
                { digit: lastDigit, timestamp: new Date() },
                ...prev,
            ].slice(0, 100),
        );
    };

    /* ──────────────────────────────────────────────────────────────
     *  Statistics builder
     * ────────────────────────────────────────────────────────────── */
    const updateStats = (
        counts: number[],
        lastDigit: number,
        tickValue: number,
    ) => {
        const total = counts.reduce((s, c) => s + c, 0);

        /* Over analysis */
        const overCount =
            activeOverDigit === 0
                ? total - counts[0]
                : counts
                      .slice(activeOverDigit + 1)
                      .reduce((s, c) => s + c, 0);

        /* Under analysis */
        const underCount =
            activeUnderDigit === 0
                ? 0
                : counts.slice(0, activeUnderDigit).reduce((s, c) => s + c, 0);

        setStats({
            currentTick: tickValue.toFixed(4),
            lastDigit: lastDigit.toString(),
            overCount,
            overPercentage: total ? `${((overCount / total) * 100).toFixed(1)}%` : '0%',
            underCount,
            underPercentage: total
                ? `${((underCount / total) * 100).toFixed(1)}%`
                : '0%',
            totalCount: total,
            lastDigitDisplay: lastDigit.toString(),
        });
    };

    const resetStats = () => {
        setDigitCounts(Array(10).fill(0));
        setLastResults([]);
        setStats({
            currentTick: '-',
            lastDigit: '-',
            overCount: 0,
            overPercentage: '0%',
            underCount: 0,
            underPercentage: '0%',
            totalCount: 0,
            lastDigitDisplay: '-',
        });
    };

    /* ──────────────────────────────────────────────────────────────
     *  UI handlers
     * ────────────────────────────────────────────────────────────── */
    const handleDigitSelect = (type: 'over' | 'under', digit: number) => {
        if (type === 'over') setActiveOverDigit(digit);
        else setActiveUnderDigit(digit);

        /* refresh percentages without touching counts */
        updateStats(
            digitCounts,
            stats.lastDigit === '-' ? -1 : parseInt(stats.lastDigit, 10),
            stats.currentTick === '-' ? 0 : parseFloat(stats.currentTick),
        );
    };

    const handleMarketChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newMarket = e.target.value;
        setSelectedMarket(newMarket);
        initializeWebSocket(newMarket);
    };

    const handleRefresh = () => {
        resetStats();
        initializeWebSocket(selectedMarket);
    };

    /* ──────────────────────────────────────────────────────────────
     *  mount / unmount
     * ────────────────────────────────────────────────────────────── */
    useEffect(() => {
        initializeWebSocket(selectedMarket);

        return () => {
            wsRef.current?.close();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ──────────────────────────────────────────────────────────────
     *  Render
     * ────────────────────────────────────────────────────────────── */
    return (
        <div
            className={`over-analysis ${
                ui.is_dark_mode_on ? 'dark-mode' : ''
            }`}
        >
            <h1>Denara Over|Under Analyzer</h1>

            {/* Control panel */}
            <div className="control-panel">
                {/* Over selector */}
                <div className="selector-container">
                    <div className="selector-header">
                        <div className="selector-title">Over Analysis</div>
                        <button className="refresh-btn" onClick={handleRefresh}>
                            <i className="fas fa-sync-alt" /> Refresh
                        </button>
                    </div>
                    <div className="digit-selector">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(digit => (
                            <button
                                key={`over-${digit}`}
                                className={`digit-btn over-btn ${
                                    activeOverDigit === digit ? 'active' : ''
                                }`}
                                onClick={() => handleDigitSelect('over', digit)}
                            >
                                {digit}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Under selector */}
                <div className="selector-container">
                    <div className="selector-header">
                        <div className="selector-title">Under Analysis</div>
                        <div style={{ width: '60px' }} />
                    </div>
                    <div className="digit-selector">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(digit => (
                            <button
                                key={`under-${digit}`}
                                className={`digit-btn under-btn ${
                                    activeUnderDigit === digit ? 'active' : ''
                                }`}
                                onClick={() => handleDigitSelect('under', digit)}
                            >
                                {digit}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Market selector */}
                <div className="selector-container">
                    <div className="selector-title">Market Selection</div>
                    <select
                        className="marketSelection"
                        value={selectedMarket}
                        onChange={handleMarketChange}
                    >
                        <option value="1HZ10V">Volatility 10 (1s) index</option>
                        <option value="R_10">Volatility 10 index</option>
                        <option value="R_25">Volatility 25 index</option>
                        <option value="1HZ25V">Volatility 25 (1s) index</option>
                        <option value="R_50">Volatility 50 index</option>
                        <option value="1HZ50V">Volatility 50 (1s) index</option>
                        <option value="R_75">Volatility 75 index</option>
                        <option value="1HZ75V">Volatility 75 (1s) index</option>
                        <option value="R_100">Volatility 100 index</option>
                        <option value="1HZ100V">Volatility 100 (1s) index</option>
                    </select>
                </div>
            </div>

            {/* Stats */}
            <div className="stats-container">
                <div className="stat-box">
                    <div className="stat-title">Current Tick</div>
                    <div className="stat-value">{stats.currentTick}</div>
                    <div className="stat-label">
                        Last digit: <span>{stats.lastDigit}</span>
                    </div>
                </div>

                <div className="stat-box">
                    <div className="stat-title">
                        Over <span>{activeOverDigit}</span> Count
                    </div>
                    <div className="stat-value over-stat">{stats.overCount}</div>
                    <div className="stat-label">
                        Percentage: <span>{stats.overPercentage}</span>
                    </div>
                </div>

                <div className="stat-box">
                    <div className="stat-title">
                        Under <span>{activeUnderDigit}</span> Count
                    </div>
                    <div className="stat-value under-stat">
                        {stats.underCount}
                    </div>
                    <div className="stat-label">
                        Percentage: <span>{stats.underPercentage}</span>
                    </div>
                </div>

                <div className="stat-box">
                    <div className="stat-title">Total Ticks</div>
                    <div className="stat-value">{stats.totalCount}</div>
                    <div className="stat-label">
                        Last digit: <span>{stats.lastDigitDisplay}</span>
                    </div>
                </div>
            </div>

            {/* History */}
            <div className="history-container">
                <div className="history-header">
                    <div className="history-title">Last 100 Results</div>
                    <div className="stat-label">(E = Even, O = Odd)</div>
                </div>
                <div className="history-items">
                    {lastResults.map((r, i) => {
                        const isOver =
                            activeOverDigit === 0
                                ? r.digit > 0
                                : r.digit > activeOverDigit;
                        const isUnder = r.digit < activeUnderDigit;
                        const isEven = r.digit % 2 === 0;

                        return (
                            <span
                                key={i}
                                className="history-item"
                                style={{
                                    color:
                                        isOver && isUnder
                                            ? 'white'
                                            : isOver
                                            ? '#e74c3c'
                                            : isUnder
                                            ? '#2ecc71'
                                            : undefined,
                                    backgroundColor:
                                        isOver && isUnder ? '#9b59b6' : undefined,
                                }}
                                title={isEven ? 'Even' : 'Odd'}
                            >
                                {r.digit}
                            </span>
                        );
                    })}
                </div>
            </div>

            <div className="volume-control">
                <i className="fas fa-volume-up" />
            </div>
        </div>
    );
});

export default OverAnalysis;
