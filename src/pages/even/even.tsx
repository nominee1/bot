import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import './EvenAnalysis.scss';

interface TickData {
    digit: number;
    timestamp: Date;
    isEven: boolean;
}

interface Stats {
    currentTick: string;
    lastDigit: string;
    evenCount: number;
    evenPercentage: string;
    oddCount: number;
    oddPercentage: string;
    totalCount: number;
    status: string;
    statusClass: string;
    evenOddRatio: string;
    rangeEvenCount: number;
    rangeOddCount: number;
    rangeDifference: number;
    rangeEvenPercentage: string;
    rangeOddPercentage: string;
    rangeDiffPercentage: string;
}

const EvenAnalysis = observer(() => {
    const { ui } = useStore();
    const [selectedMarket, setSelectedMarket] = useState<string>('1HZ10V');
    const [tickRange, setTickRange] = useState<number>(100);
    const tickRangeRef = useRef(tickRange); // Add this ref
    const [stats, setStats] = useState<Stats>({
        currentTick: '-',
        lastDigit: '-',
        evenCount: 0,
        evenPercentage: '0%',
        oddCount: 0,
        oddPercentage: '0%',
        totalCount: 0,
        status: '-',
        statusClass: '',
        evenOddRatio: '0:0',
        rangeEvenCount: 0,
        rangeOddCount: 0,
        rangeDifference: 0,
        rangeEvenPercentage: '0%',
        rangeOddPercentage: '0%',
        rangeDiffPercentage: '0%'
    });

    const [lastResults, setLastResults] = useState<TickData[]>([]);
    const wsRef = useRef<WebSocket | null>(null);
    const appId = 37016;

    // Keep the ref updated
    useEffect(() => {
        tickRangeRef.current = tickRange;
    }, [tickRange]);

    // Initialize WebSocket connection
    const initializeWebSocket = (symbol: string) => {
        if (wsRef.current) {
            wsRef.current.close();
        }

        wsRef.current = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${appId}`);

        wsRef.current.onopen = () => {
            console.log("WebSocket connected");
            wsRef.current?.send(JSON.stringify({ "ticks": symbol }));
            resetStats();
        };

        wsRef.current.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data?.tick) {
                processTick(data.tick.quote);
            }
        };

        wsRef.current.onclose = () => {
            console.log("WebSocket connection closed");
        };

        wsRef.current.onerror = (error) => {
            console.error("WebSocket error: ", error);
        };
    };

    // Process tick data - modified version
    const processTick = (tickValue: number) => {
        let tickString: string;
    
        if (selectedMarket === 'R_10' || selectedMarket === 'R_25') {
            tickString = tickValue.toFixed(3);
        } else if (selectedMarket === 'R_50' || selectedMarket === 'R_75') {
            tickString = tickValue.toFixed(4);
        } else {
            tickString = tickValue.toFixed(2);
        }
    
        const lastDigit = parseInt(tickString.slice(-1));
        const isEven = lastDigit % 2 === 0;

        setLastResults(prev => {
            const newResult = {
                digit: lastDigit,
                isEven,
                timestamp: new Date()
            };
            const updatedResults = [newResult, ...prev].slice(0, 100);
            
            // Calculate range stats using current tickRange from ref
            const rangeResults = updatedResults.slice(0, tickRangeRef.current);
            const rangeEvenCount = rangeResults.filter(r => r.isEven).length;
            const rangeOddCount = rangeResults.length - rangeEvenCount;
            const rangeDifference = Math.abs(rangeEvenCount - rangeOddCount);
            
            const rangeEvenPercentage = rangeResults.length > 0 ? 
                (rangeEvenCount / rangeResults.length * 100).toFixed(1) : 0;
            const rangeOddPercentage = rangeResults.length > 0 ? 
                (rangeOddCount / rangeResults.length * 100).toFixed(1) : 0;
            const rangeDiffPercentage = rangeResults.length > 0 ? 
                (rangeDifference / rangeResults.length * 100).toFixed(1) : 0;

            setStats(prevStats => {
                const newEvenCount = isEven ? prevStats.evenCount + 1 : prevStats.evenCount;
                const newOddCount = isEven ? prevStats.oddCount : prevStats.oddCount + 1;
                const newTotalCount = prevStats.totalCount + 1;
                
                const evenPercentage = newTotalCount > 0 ? (newEvenCount / newTotalCount * 100).toFixed(1) : 0;
                const oddPercentage = newTotalCount > 0 ? (newOddCount / newTotalCount * 100).toFixed(1) : 0;
                
                return {
                    ...prevStats,
                    currentTick: tickValue.toFixed(4),
                    lastDigit: lastDigit.toString(),
                    evenCount: newEvenCount,
                    evenPercentage: `${evenPercentage}%`,
                    oddCount: newOddCount,
                    oddPercentage: `${oddPercentage}%`,
                    totalCount: newTotalCount,
                    status: isEven ? 'EVEN' : 'ODD',
                    statusClass: isEven ? 'even' : 'odd',
                    evenOddRatio: `${newEvenCount}:${newOddCount}`,
                    rangeEvenCount,
                    rangeOddCount,
                    rangeDifference,
                    rangeEvenPercentage: `${rangeEvenPercentage}%`,
                    rangeOddPercentage: `${rangeOddPercentage}%`,
                    rangeDiffPercentage: `${rangeDiffPercentage}%`
                };
            });

            return updatedResults;
        });
    };

    // Reset all statistics
    const resetStats = () => {
        setLastResults([]);
        setStats({
            currentTick: '-',
            lastDigit: '-',
            evenCount: 0,
            evenPercentage: '0%',
            oddCount: 0,
            oddPercentage: '0%',
            totalCount: 0,
            status: '-',
            statusClass: '',
            evenOddRatio: '0:0',
            rangeEvenCount: 0,
            rangeOddCount: 0,
            rangeDifference: 0,
            rangeEvenPercentage: '0%',
            rangeOddPercentage: '0%',
            rangeDiffPercentage: '0%'
        });
    };

    // Handle market change
    const handleMarketChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newMarket = e.target.value;
        setSelectedMarket(newMarket);
        initializeWebSocket(newMarket);
    };

    // Handle tick range change - modified version
    const handleTickRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseInt(e.target.value);
        if (!isNaN(value) && value > 0) {
            setTickRange(value);
            // Force update with new range
            if (stats.lastDigit !== '-') {
                setLastResults(prev => [...prev]);
            }
        }
    };

    // Handle refresh
    const handleRefresh = () => {
        resetStats();
        initializeWebSocket(selectedMarket);
    };

    // Initialize WebSocket on component mount
    useEffect(() => {
        initializeWebSocket(selectedMarket);

        // Clean up WebSocket on unmount
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, []);


    return (
        <div className={`over-analysis ${ui.is_dark_mode_on ? 'dark-mode' : ''}`}>
            <h1>Denara Even/Odd Analyzer</h1>

            <div className="control-panel">
                <div className="selector-container">
                    <div className="selector-header">
                        <div className="selector-title">Market Selection</div>
                        <button className="refresh-btn" onClick={handleRefresh}>
                            <i className="fas fa-sync-alt"></i> Refresh
                        </button>
                    </div>
                    <select
                        className="marketSelection"
                        value={selectedMarket}
                        onChange={handleMarketChange}
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

                <div className="selector-container">
                    <div className="selector-title">Analyze last</div>
                    <div className="tick-range-control">
                        <input
                            type="number"
                            className="tick-range-input"
                            value={tickRange}
                            onChange={handleTickRangeChange}
                            min="1"
                        />
                        <span>ticks</span>
                       
                    </div>
                </div>
            </div>

            <div className="stats-container">
                <div className="stat-box">
                    <div className="stat-title">Current Tick</div>
                    <div className="stat-value">{stats.currentTick}</div>
                    <div className="stat-label">Last digit: <span>{stats.lastDigit}</span></div>
                    <div className="stat-label">Status: <span className={stats.statusClass}>{stats.status}</span></div>
                </div>

                <div className="stat-box">
                    <div className="stat-title">Total Ticks</div>
                    <div className="stat-value">{stats.totalCount}</div>
                    <div className="stat-label">Even/Odd Ratio: <span>{stats.evenOddRatio}</span></div>
                </div>

                <div className="stat-box">
                    <div className="stat-title">Even Count</div>
                    <div className="stat-value even">{stats.evenCount}</div>
                    <div className="stat-label">Percentage: <span>{stats.evenPercentage}</span></div>
                </div>

                <div className="stat-box">
                    <div className="stat-title">Odd Count</div>
                    <div className="stat-value odd">{stats.oddCount}</div>
                    <div className="stat-label">Percentage: <span>{stats.oddPercentage}</span></div>
                </div>
            </div>

            <div className="range-stats">
                <div className="history-title">Custom Range Analysis (<span>{tickRange}</span> ticks)</div>
                <div className="stats-container">
                    <div className="stat-box">
                        <div className="stat-title">Even Count</div>
                        <div className="stat-value even">{stats.rangeEvenCount}</div>
                        <div className="stat-label">Percentage: <span>{stats.rangeEvenPercentage}</span></div>
                    </div>

                    <div className="stat-box">
                        <div className="stat-title">Odd Count</div>
                        <div className="stat-value odd">{stats.rangeOddCount}</div>
                        <div className="stat-label">Percentage: <span>{stats.rangeOddPercentage}</span></div>
                    </div>

                    <div className="stat-box">
                        <div className="stat-title">Difference</div>
                        <div className="stat-value">{stats.rangeDifference}</div>
                        <div className="stat-label">Percentage: <span>{stats.rangeDiffPercentage}</span></div>
                    </div>
                </div>
            </div>

            <div className="history-container">
                <div className="history-header">
                    <div className="history-title">Last 100 Results (E=Even, O=Odd)</div>
                </div>
                <div className="history-items">
                    {lastResults.map((result, index) => (
                        <span
                            key={index}
                            className="history-item"
                            style={{
                                color: result.isEven ? '#2ecc71' : '#e74c3c'
                            }}
                        >
                            {result.isEven ? 'E' : 'O'}
                        </span>
                    ))}
                </div>
            </div>

            <div className="volume-control">
                <i className="fas fa-volume-up"></i>
            </div>
        </div>
    );
});

export default EvenAnalysis;