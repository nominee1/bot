import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import './BotIframe.scss';

const BotIframe = observer(() => {
    const { ui } = useStore();
    const [activeMode, setActiveMode] = useState('evenOdd');
    
    // Analysis state
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

    // Refs
    const marketSelectionRef = useRef<HTMLSelectElement>(null);
    const wsRef = useRef<WebSocket | null>(null);

    // WebSocket connection and tick processing
    useEffect(() => {
        const initializeWebSocket = (symbol: string) => {
            if (wsRef.current) {
                wsRef.current.close();
            }

            // Connect to WebSocket without authentication
            const app_id = 1089; // Deriv demo app_id
            wsRef.current = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);
            
            wsRef.current.onopen = () => {
                console.log("WebSocket connected");
                wsRef.current?.send(JSON.stringify({ "ticks": symbol }));
                resetStats();
                setAnalysisData(prev => ({ ...prev, currentMarket: symbol }));
            };

            wsRef.current.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                if (data?.error) {
                    console.error("WebSocket error:", data.error.message);
                    return;
                }
                
                if (data?.tick) {
                    processTick(data.tick.quote);
                }
            };

            wsRef.current.onclose = () => console.log("WebSocket connection closed");
            wsRef.current.onerror = (error) => console.error("WebSocket error: ", error);
        };

        const processTick = (tickValue: number) => {
            let tickString: string;
            const currentSymbol = analysisData.currentMarket;
            
            // Handle different decimal places for different markets
            if (currentSymbol === 'R_10' || currentSymbol === 'R_25') {
                tickString = tickValue.toFixed(3);
            } else if (currentSymbol === 'R_50' || currentSymbol === 'R_75') {
                tickString = tickValue.toFixed(4);
            } else if (currentSymbol === 'R_100') {
                tickString = tickValue.toFixed(5);
            } else {
                tickString = tickValue.toFixed(2);
            }
            
            const lastDigit = parseInt(tickString.slice(-1));
            const isEven = lastDigit % 2 === 0;
            
            let isRise = null;
            if (analysisData.lastPrice !== null) {
                isRise = tickValue > analysisData.lastPrice;
            }

            setAnalysisData(prev => {
                const digitCounts = [...prev.digitCounts];
                digitCounts[lastDigit]++;
                
                const newLastResults = [{
                    digit: lastDigit,
                    isEven,
                    isRise,
                    price: tickValue,
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
                    lastPrice: tickValue,
                    digitCounts
                };
            });
        };

        const resetStats = () => {
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
                digitCounts: Array(10).fill(0)
            }));
        };

        if (marketSelectionRef.current) {
            initializeWebSocket(marketSelectionRef.current.value);
        }

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, []);

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
            wsRef.current.send(JSON.stringify({ "ticks": marketSelectionRef.current.value }));
        }
    };

    // Render functions for different analysis modes
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
                    No rise/fall data available yet. Waiting for price changes...
                </div>
            );
        }

        return filteredResults.map((result, index) => (
            <div 
                key={index} 
                className="history-item" 
                style={{ color: result.isRise ? '#2ecc71' : '#e74c3c' }}
                title={`Price: ${result.price}`}
            >
                {result.isRise ? '↑' : '↓'}
            </div>
        ));
    };

    return (
        <div className="bot-app" style={{ background: ui.is_dark_mode_on ? 'var(--general-main-1)' : 'transparent' }}>
         

            {/* Analysis Mode Selector */}
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
                    <li>
                        <button 
                            className={`mode-btn ${activeMode === 'riseFall' ? 'active' : ''}`} 
                            onClick={() => toggleMode('riseFall')}
                            style={{ padding: '10px' }}
                        >
                            Rise/Fall
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
                        if (wsRef.current) {
                            wsRef.current.send(JSON.stringify({ "ticks": e.target.value }));
                        }
                    }}
                >
                    <option className="Volatility10" value="R_10">Volatility 10 index</option>
                    <option className="Volatility10s" value="1HZ10V" selected>
                        Volatility 10(1s) index
                    </option>
                    <option className="Volatility25" value="R_25">Volatility 25 index</option>
                    <option className="Volatility25s" value="1HZ25V">
                        Volatility 25(1s) index
                    </option>
                    <option className="Volatility50" value="R_50">Volatility 50 index</option>
                    <option className="Volatility50s" value="1HZ50V">
                        Volatility 50(1s) index
                    </option>
                    <option className="Volatility75" value="R_75">Volatility 75 index</option>
                    <option className="Volatility75s" value="1HZ75V">
                        Volatility 75(1s) index
                    </option>
                    <option className="Volatility100" value="R_100">
                        Volatility 100 index
                    </option>
                    <option className="Volatility100s" value="1HZ100V">
                        Volatility 100(1s) index
                    </option>
                </select>
            </div>

            {/* Analysis Sections */}
            <div id="evenOddSection" className="analysis-section" style={{ display: activeMode === 'evenOdd' ? 'block' : 'none' }}>
                {/* Content placeholder - actual analysis is in history section */}
            </div>

            <div id="overUnderSection" className="analysis-section" style={{ 
                display: activeMode === 'overUnder' ? 'block' : 'none',
                minWidth: '100%' // Prevent shrinking
            }}>
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
                                >
                                    {digit}
                                </button>
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
                                >
                                    {digit}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div id="riseFallSection" className="analysis-section" style={{ 
                display: activeMode === 'riseFall' ? 'block' : 'none',
                minWidth: '100%' // Prevent shrinking
            }}>
                
            </div>


            {/* trading-container */}
            {/* Content placeholder - Trading pannel */}
            {/* Content placeholder - Trading pannel */}
            {/* Content placeholder - Trading pannel */}
            {/* Content placeholder - Trading pannel */}
            {/* Content placeholder - Trading pannel */}
            {/* Content placeholder - Trading pannel */}
            {/* trading-container */}




            {/* History Section */}
            <div className="history-container" style={{ minWidth: '100%' }}>
                <div className="history-title">
                    Filtration Chamber 
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
                        minWidth: '100%' // Prevent shrinking
                    }}
                >
                    {renderRiseFallHistory()}
                </div>
            </div>
        </div>
    );
});

export default BotIframe;