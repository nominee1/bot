import { useEffect, useRef, useState, type CSSProperties, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useApiBase } from '@/hooks/useApiBase';
import { api_base } from '@/external/bot-skeleton';
import { sendDerivSessionContractPurchase } from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import {
    TradeTypesDigitsMatchesIcon,
    TradeTypesDigitsOverIcon,
    TradeTypesDigitsUnderIcon,
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
} from '@deriv/quill-icons';
import './multiple.scss';

type TradeStatus = 'pending' | 'open' | 'active' | 'won' | 'lost' | 'completed' | 'error';

interface TTrade {
    id: string;
    contractType: string;
    stake: number;
    takeProfit?: number;
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
    barrier?: string;
    selectedDigit?: number;
    counted?: boolean;
    marketFormat?: string;
    _debugId?: string;
}

type TTransaction = {
    contract_id: string;
    amount: number;
    transaction_time: number;
};

let incrCounter = 0;
const genTempId = () => {
    incrCounter = (incrCounter + 1) % 1_000_000_000;
    return `tmp_${Date.now()}_${incrCounter}`;
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
    '1HZ15V': <MarketDerivedVolatility151sIcon width={16} height={16} />,
    '1HZ30V': <MarketDerivedVolatility301sIcon width={16} height={16} />,
    '1HZ90V': <MarketDerivedVolatility901sIcon width={16} height={16} />,
    '1HZ75V': <MarketDerivedVolatility751sIcon width={16} height={16} />,
};

const contractIcons: Record<string, JSX.Element> = {
    DIGITMATCH: <TradeTypesDigitsMatchesIcon width={16} height={16} />,
    DIGITOVER: <TradeTypesDigitsOverIcon width={16} height={16} />,
    DIGITUNDER: <TradeTypesDigitsUnderIcon width={16} height={16} />,
};

const digitColors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#8AC249', '#EA5F89', '#00BFFF', '#A0522D'];

const fixed3 = ['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'];
const fixed4 = ['R_50', 'R_75'];

const formatByMarket = (value: number, marketFormat: string) => {
    if (fixed3.includes(marketFormat)) return value.toFixed(3);
    if (fixed4.includes(marketFormat)) return value.toFixed(4);
    return value.toFixed(2);
};

const lastDigitOfQuote = (value: number, marketFormat: string) => {
    const s = formatByMarket(value, marketFormat);
    const d = parseInt(s.slice(-1), 10);
    return Number.isFinite(d) ? d : null;
};

const Iframe = observer(() => {
    const { tradingSocketGeneration } = useApiBase();
    const { ui } = useStore();

    const [trades, setTrades] = useState<TTrade[]>([]);
    const [profitLoss, setPL] = useState(0);
    const [msg, setMsg] = useState<{ txt: string; type: 'info' | 'success' | 'error' | 'loading' | 'warning' }>({
        txt: '',
        type: 'info',
    });

    // Only Over/Under as trade strategies (Matches kept for analysis only)
    const [strategy, setStrat] = useState<'over' | 'under'>('over');
    const [ctypes, setCT] = useState<{ left: string; right: string }>({ left: 'DIGITOVER', right: 'DIGITUNDER' });

    const [currentSymbol, setCurrentSymbol] = useState('1HZ10V');

    // ✅ default: Over/Under analysis active
    const [activeMode, setActiveMode] = useState<'matches' | 'overUnder'>('overUnder');

    // Matches mode multi-select (still available)
    const [activeDigits, setActiveDigits] = useState<number[]>([2, 4, 6]);

    // ✅ default active digit for Over/Under = 2
    const [activeOverUnderDigit, setActiveOverUnderDigit] = useState<number | null>(2);

    // Per-prediction stakes
    // ✅ ensure digit 2 has a default stake
    const [stakesByDigit, setStakesByDigit] = useState<Record<number, number>>({ 2: 5 });

    // ✅ analyze 1000 ticks by default
    const [filterCount, setFilterCount] = useState(1000);

    // temp↔real id mapping
    const tempToRealRef = useRef<Map<string, string>>(new Map());
    const realToTempRef = useRef<Map<string, string>>(new Map());

    // ✅ purchased-result digit blink (settlement digit)
    const [purchasedDigit, setPurchasedDigit] = useState<number | null>(null);
    const purchasedTimerRef = useRef<number | null>(null);

    // ✅ dedupe to prevent double blink
    const flashedRef = useRef<Record<string, string>>({}); // contract_id -> "exitVal:lastDigit"

    const [analysisData, setAnalysisData] = useState({
        lastResults: [] as Array<{ digit: number; price: number; timestamp: Date }>,
        lastDigit: null as number | null,
        lastPrice: null as number | null,
        digitCounts: Array(10).fill(0),
        currentMarket: '1HZ10V',
    });

    const marketSelectionRef = useRef<HTMLSelectElement>(null);
    const marketRef = useRef<HTMLSelectElement>(null);
    const takeProfitRef = useRef<HTMLInputElement>(null);
    const durRef = useRef<HTMLSelectElement>(null);
    const digitRef = useRef<HTMLInputElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const prevTickRef = useRef<number | null>(null);
    const debounceTimer = useRef<NodeJS.Timeout>();

    const showStatus = (txt: string, type: 'info' | 'success' | 'error' | 'loading' | 'warning' = 'info') => setMsg({ txt, type });

    const playSound = (ok: boolean) => {
        try {
            const a = new Audio(ok ? '/sounds/success.mp3' : '/sounds/fail.mp3');
            a.volume = 0.5;
            a.play().catch(() => {});
        } catch {
            // ignore
        }
    };

    const flashPurchasedDigit = (d: number) => {
        if (purchasedTimerRef.current) window.clearTimeout(purchasedTimerRef.current);
        setPurchasedDigit(d);
        purchasedTimerRef.current = window.setTimeout(() => setPurchasedDigit(null), 900);
    };

    const mapContracts = (s: 'over' | 'under'): [string, string] =>
        ({
            over: ['DIGITOVER', 'DIGITUNDER'],
            under: ['DIGITUNDER', 'DIGITOVER'],
        }[s]);

    const label = (ct: string) => ({ DIGITMATCH: 'Matches', DIGITOVER: 'Over', DIGITUNDER: 'Under' } as Record<string, string>)[ct] ?? ct;

    const getDigitStake = (digit?: number) => {
        if (typeof digit === 'number') return Number(stakesByDigit[digit] ?? 5) || 5;
        return 5;
    };

    const buy = async (ct: string, digitOv?: number) => {
        const takeProfit = parseFloat(takeProfitRef.current?.value || '0');
        const dur = parseInt(durRef.current?.value || '1', 10);
        const market = marketRef.current?.value ?? '1HZ10V';

        let barrier: string | undefined;
        if (['DIGITOVER', 'DIGITUNDER'].includes(ct)) {
            if (typeof digitOv !== 'number' || digitOv < 0 || digitOv > 9) {
                showStatus('Select digit 0-9', 'error');
                throw new Error('digit');
            }
            barrier = String(digitOv);
        }

        const stake = getDigitStake(digitOv);
        const tmpID = genTempId();
        const tradeDebugId = `${ct}-${barrier ?? 'N/A'}-${tmpID.slice(-4)}`;

        const newTrade: TTrade = {
            id: tmpID,
            contractType: ct,
            stake,
            takeProfit,
            market,
            duration: dur,
            status: 'pending',
            timestamp: new Date(),
            barrier,
            selectedDigit: barrier ? Number(barrier) : undefined,
            marketFormat: currentSymbol,
            _debugId: tradeDebugId,
        };

        setTrades(t => [newTrade, ...t]);

        try {
            const resp = (await sendDerivSessionContractPurchase(
                d => api_base.api.send(d) as Promise<unknown>,
                {
                    contract_type: ct,
                    market,
                    duration: dur,
                    stake,
                    ...(barrier ? { barrier } : {}),
                }
            )) as { error?: { message?: string }; buy?: { contract_id?: unknown; purchase_id?: unknown } };

            if (resp?.error) throw new Error(resp.error.message);

            const realID = (resp?.buy?.contract_id ?? resp?.buy?.purchase_id ?? tmpID).toString();
            tempToRealRef.current.set(tmpID, realID);
            realToTempRef.current.set(realID, tmpID);

            setTrades(t => t.map(tr => (tr.id === tmpID ? { ...tr, id: realID, status: 'open' } : tr)));

            showStatus('Next ✅', 'success');
            return realID;
        } catch (e: any) {
            setTrades(t => t.filter(tr => tr.id !== tmpID));
            showStatus(`Trade failed: ${e?.message || e}`, 'error');
            throw e;
        }
    };

    const handleReset = () => {
        setTrades([]);
        setPL(0);
        showStatus('History cleared', 'info');
        tempToRealRef.current.clear();
        realToTempRef.current.clear();
        flashedRef.current = {};
        if (purchasedTimerRef.current) window.clearTimeout(purchasedTimerRef.current);
        setPurchasedDigit(null);
    };

    /** ---------------- PASSIVE HANDLERS FOR EXIT / STATUS ---------------- **/

    const onBuy = (d: any) => {
        const realId = (d?.buy?.contract_id ?? '').toString();
        if (!realId) return;

        const tempId = realToTempRef.current.get(realId);
        if (tempId) {
            setTrades(prev => prev.map(tr => (tr.id === tempId ? { ...tr, id: realId } : tr)));
            tempToRealRef.current.set(tempId, realId);
        }

        setTrades(prev =>
            prev.map(tr => {
                if (tr.id !== realId) return tr;
                return { ...tr, status: 'open' };
            })
        );
    };

    // proposal_open_contract updates
    const onPOC = (c: any) => {
        const realId = c?.contract_id?.toString();
        if (!realId) return;

        const tempId = realToTempRef.current.get(realId);
        if (tempId) {
            setTrades(prev => prev.map(tr => (tr.id === tempId ? { ...tr, id: realId } : tr)));
            tempToRealRef.current.set(tempId, realId);
        }

        setTrades(prev =>
            prev.map(tr => {
                if (tr.id !== realId) return tr;

                const updated: TTrade = { ...tr };

                if (!updated.startTime && c.entry_tick_time) {
                    updated.startTime = new Date(c.entry_tick_time * 1000);
                    updated.entryValue = c.entry_tick ? Number(c.entry_tick) : undefined;
                    updated.marketFormat = updated.marketFormat || currentSymbol;
                }

                if (c.tick_count && c.current_tick) updated.ticksRemaining = c.tick_count - c.current_tick;
                if (c.current_spot) updated.currentValue = Number(c.current_spot);

                const finished = c.is_sold || c.is_expired || c.is_settleable || c.status === 'sold';

                if (finished) {
                    const net = Number(c.profit ?? 0);
                    updated.status = net >= 0 ? 'won' : 'lost';
                    updated.profit = net;
                    updated.closeTime = new Date();
                    updated.exitValue = c.exit_tick ? Number(c.exit_tick) : c.exit_spot ? Number(c.exit_spot) : undefined;

                    // ✅ blink ONLY once per contract + final tick digit (result tick)
                    const marketFmt = updated.marketFormat || currentSymbol;

                    const exitCandidate =
                        c.exit_tick !== undefined
                            ? Number(c.exit_tick)
                            : c.exit_spot !== undefined
                              ? Number(c.exit_spot)
                              : c.current_spot !== undefined
                                ? Number(c.current_spot)
                                : undefined;

                    if (exitCandidate !== undefined && Number.isFinite(exitCandidate)) {
                        const d = lastDigitOfQuote(exitCandidate, marketFmt);
                        if (d !== null) {
                            const key = `${exitCandidate}:${d}`;
                            if (flashedRef.current[realId] !== key) {
                                flashedRef.current[realId] = key;
                                flashPurchasedDigit(d);
                            }
                        }
                    }

                    playSound(net >= 0);
                } else {
                    updated.status = (c.status as TradeStatus) || 'active';
                }

                return updated;
            })
        );
    };

    // transaction: sell settlement (final profit / status)
    const onTX = (tx: TTransaction) => {
        const realId = tx.contract_id.toString();
        setTrades(prev =>
            prev.map(tr => {
                if (tr.id !== realId) return tr;
                const net = Number(tx.amount) - tr.stake;
                const updated: TTrade = {
                    ...tr,
                    status: net >= 0 ? 'won' : 'lost',
                    profit: net,
                    closeTime: new Date(tx.transaction_time * 1000),
                };
                playSound(net >= 0);
                return updated;
            })
        );
    };

    // API bus listener
    useEffect(() => {
        const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
            if (data?.error) {
                showStatus(data.error.message, 'error');
                return;
            }
            switch (data?.msg_type) {
                case 'buy':
                    onBuy(data);
                    break;
                case 'proposal_open_contract':
                    onPOC(data.proposal_open_contract);
                    break;
                case 'transaction':
                    if (data.transaction?.action === 'sell') onTX(data.transaction as TTransaction);
                    break;
                default:
                    break;
            }
        });
        return () => sub.unsubscribe();
    }, [tradingSocketGeneration]);

    /** ---------------- ANALYSIS (TICKS) WEBSOCKET ---------------- **/

    const handleTick = (val: number) => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
            const currentMarket = marketSelectionRef.current?.value || '1HZ10V';

            const tickString = formatByMarket(val, currentMarket);
            const lastDigit = parseInt(tickString.slice(-1), 10);

            setAnalysisData(prev => {
                const digitCounts = [...prev.digitCounts];
                digitCounts[lastDigit]++;

                // ✅ keep only 1000 ticks in memory
                const newLastResults = [{ digit: lastDigit, price: val, timestamp: new Date() }, ...prev.lastResults].slice(0, 1000);

                return { ...prev, lastResults: newLastResults, lastDigit, lastPrice: val, digitCounts, currentMarket };
            });

            prevTickRef.current = val;
        }, 50);
    };

    useEffect(() => {
        const initializeWebSocket = (symbol: string) => {
            if (wsRef.current) wsRef.current.close();
            const app_id = 1089;
            wsRef.current = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);

            wsRef.current.onopen = () => {
                // ✅ request 1000 ticks
                wsRef.current?.send(
                    JSON.stringify({
                        ticks_history: symbol,
                        style: 'ticks',
                        count: 1000,
                        end: 'latest',
                        subscribe: 1,
                    })
                );

                setAnalysisData(prev => ({
                    ...prev,
                    lastResults: [],
                    lastDigit: null,
                    lastPrice: null,
                    digitCounts: Array(10).fill(0),
                    currentMarket: symbol,
                }));
            };

            wsRef.current.onmessage = event => {
                const data = JSON.parse(event.data);
                if (data?.error) {
                    console.error('WebSocket error:', data.error.message);
                    return;
                }

                if (data?.msg_type === 'history') {
                    const prices: number[] = data.history.prices.map(Number);
                    if (!prices.length) return;

                    // build lastResults from history but keep max 1000
                    const currentMarket = marketSelectionRef.current?.value || '1HZ10V';
                    const results: Array<{ digit: number; price: number; timestamp: Date }> = [];
                    const digitCounts = Array(10).fill(0);

                    // history is old->new; we want newest first in UI
                    prices.slice(-1000).forEach((price: number) => {
                        const tickString = formatByMarket(price, currentMarket);
                        const lastDigit = parseInt(tickString.slice(-1), 10);
                        digitCounts[lastDigit]++;
                        results.unshift({ digit: lastDigit, price, timestamp: new Date() });
                    });

                    setAnalysisData(prev => ({
                        ...prev,
                        lastResults: results.slice(0, 1000),
                        lastDigit: results[0]?.digit ?? null,
                        lastPrice: results[0]?.price ?? null,
                        digitCounts,
                        currentMarket,
                    }));

                    prevTickRef.current = prices[prices.length - 1];
                } else if (data?.tick) {
                    handleTick(data.tick.quote);
                }
            };

            wsRef.current.onclose = () => console.log('WebSocket connection closed');
            wsRef.current.onerror = error => console.error('WebSocket error: ', error);
        };

        if (marketSelectionRef.current) initializeWebSocket(marketSelectionRef.current.value);

        return () => {
            if (wsRef.current) wsRef.current.close();
            if (debounceTimer.current) clearTimeout(debounceTimer.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [marketSelectionRef.current?.value]);

    // auto-trim very old pendings
    useEffect(() => {
        const id = setInterval(() => {
            setTrades(t => t.filter(tr => !(tr.status === 'pending' && Date.now() - tr.timestamp.getTime() > 15_000)));
        }, 5_000);
        return () => clearInterval(id);
    }, []);

    // aggregate P/L
    useEffect(() => {
        setPL(trades.reduce((s, t) => s + (t.profit ?? 0), 0));
    }, [trades]);

    // reflect strategy mapping
    useEffect(() => {
        setCT({ left: mapContracts(strategy)[0], right: mapContracts(strategy)[1] });
        if (digitRef.current) {
            digitRef.current.disabled = true;
            digitRef.current.style.backgroundColor = 'gray';
        }
    }, [strategy]);

    // ensure over/under default digit exists
    useEffect(() => {
        if (activeMode === 'overUnder') {
            const d = activeOverUnderDigit ?? 2;
            if (activeOverUnderDigit === null) setActiveOverUnderDigit(d);
            setStakesByDigit(s => ({ ...s, [d]: s[d] ?? 5 }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // sync market dropdowns
    useEffect(() => {
        if (!marketRef.current) return;
        const h = (e: any) => {
            const newMarket = e.target.value;
            setCurrentSymbol(newMarket);
            if (marketSelectionRef.current) marketSelectionRef.current.value = newMarket;
            if (wsRef.current) {
                wsRef.current.send(
                    JSON.stringify({
                        ticks_history: newMarket,
                        style: 'ticks',
                        count: 1000,
                        end: 'latest',
                        subscribe: 1,
                    })
                );
            }
            setAnalysisData(prev => ({
                ...prev,
                lastResults: [],
                lastDigit: null,
                lastPrice: null,
                digitCounts: Array(10).fill(0),
                currentMarket: newMarket,
            }));
        };
        marketRef.current.addEventListener('change', h);
        return () => marketRef.current?.removeEventListener('change', h);
    }, []);

    const toggleMode = (mode: 'matches' | 'overUnder') => {
        setActiveMode(mode);
        if (mode === 'overUnder') {
            setActiveOverUnderDigit(prev => {
                const next = prev ?? 2;
                setStakesByDigit(s => ({ ...s, [next]: s[next] ?? 5 }));
                return next;
            });
        }
    };

    const handleDigitClick = (digit: number) => {
        if (activeMode === 'matches') {
            setActiveDigits(prev => {
                const next = prev.includes(digit) ? prev.filter(d => d !== digit) : [...prev, digit];
                setStakesByDigit(s => {
                    const copy = { ...s };
                    if (!prev.includes(digit)) copy[digit] = copy[digit] ?? 5;
                    return copy;
                });
                return next;
            });
        } else {
            setActiveOverUnderDigit(prev => {
                const next = prev === digit ? digit : digit; // always select one (no null)
                setStakesByDigit(s => ({ ...s, [next]: s[next] ?? 5 }));
                return next;
            });
        }
    };

    const refreshData = () => {
        if (marketSelectionRef.current && wsRef.current) {
            const newMarket = marketSelectionRef.current.value;
            setCurrentSymbol(newMarket);
            wsRef.current.send(
                JSON.stringify({
                    ticks_history: newMarket,
                    style: 'ticks',
                    count: 1000,
                    end: 'latest',
                    subscribe: 1,
                })
            );

            setAnalysisData({
                lastResults: [],
                lastDigit: null,
                lastPrice: null,
                digitCounts: Array(10).fill(0),
                currentMarket: newMarket,
            });
        }
    };

    const handleSingleTrade = async (ct: string) => {
        if (activeMode === 'matches' && activeDigits.length > 0) {
            const promises = activeDigits.map(digit => buy(ct, digit));
            try {
                await Promise.all(promises);
                showStatus(`Trades placed for digits: ${activeDigits.join(', ')}`, 'success');
            } catch {
                showStatus('Some trades failed', 'error');
            }
        } else if (activeMode === 'overUnder' && activeOverUnderDigit !== null) {
            await buy(ct, activeOverUnderDigit);
        } else {
            showStatus(activeMode === 'matches' ? 'Select at least one digit' : 'Select a digit', 'error');
        }
    };

    const posClass = (st: TradeStatus) => (st === 'won' ? 'position-win' : st === 'lost' || st === 'error' ? 'position-loss' : 'position-open');

    const formatTickValue = (value?: number, marketFormat?: string) => {
        if (value === undefined) return '—';
        return formatByMarket(value, marketFormat || '');
    };

    const calculateDigitStats = () => {
        const filteredResults = analysisData.lastResults.slice(0, filterCount);
        const total = filteredResults.length;
        const digitCounts = Array(10).fill(0);
        filteredResults.forEach(result => {
            digitCounts[result.digit]++;
        });
        const maxCount = Math.max(...digitCounts);
        const minCount = Math.min(...digitCounts);
        return {
            digitsData: digitCounts.map((count, digit) => {
                const percentage = total > 0 ? (count / total) * 100 : 0;
                return {
                    digit,
                    percentage,
                    isMax: count === maxCount && maxCount > 0,
                    isMin: count === minCount && maxCount > 0 && minCount !== maxCount && count === minCount,
                };
            }),
        };
    };

    const { digitsData } = calculateDigitStats();

    const calculateStrokeValues = () => {
        const circumference = 2 * Math.PI * 27;
        const dashValue = circumference / 2;
        const dashArray = `${dashValue} ${circumference}`;
        const dashOffset = circumference / 4;
        return { dashArray, dashOffset };
    };

    const tradeStats = (() => {
        const completed = trades.filter(t => t.status === 'won' || t.status === 'lost');
        return {
            total: completed.length,
            won: completed.filter(t => t.status === 'won').length,
            lost: completed.filter(t => t.status === 'lost').length,
        };
    })();

    // ✅ NEW: blink the purchased digit in the history list too (first/latest occurrence only)
    const visibleHistory = useMemo(() => analysisData.lastResults.slice(0, filterCount), [analysisData.lastResults, filterCount]);
    const purchasedHistoryIndex = useMemo(() => {
        if (purchasedDigit === null) return -1;
        return visibleHistory.findIndex(r => r.digit === purchasedDigit);
    }, [visibleHistory, purchasedDigit]);

    return (
        <div className="bot-same" style={{ background: ui.is_dark_mode_on ? 'var(--general-main-1)' : 'transparent' }}>
            {/* Analysis Mode Selector */}
            <div className="analysis-mode-selector">
                <ul className="mode-list">
                    <li>
                        <button className={`mode-btn ${activeMode === 'overUnder' ? 'active' : ''}`} onClick={() => toggleMode('overUnder')}>
                           Single Prediction
                        </button>
                    </li>
                    <li>
                        <button className={`mode-btn ${activeMode === 'matches' ? 'active' : ''}`} onClick={() => toggleMode('matches')}>
                            Multiple Predictions
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
                    onChange={e => {
                        const newMarket = e.target.value;
                        setCurrentSymbol(newMarket);
                        if (marketRef.current) marketRef.current.value = newMarket;
                        if (wsRef.current) {
                            wsRef.current.send(
                                JSON.stringify({
                                    ticks_history: newMarket,
                                    style: 'ticks',
                                    count: 1000,
                                    end: 'latest',
                                    subscribe: 1,
                                })
                            );
                        }
                        setAnalysisData(prev => ({
                            ...prev,
                            lastResults: [],
                            lastDigit: null,
                            lastPrice: null,
                            digitCounts: Array(10).fill(0),
                            currentMarket: newMarket,
                        }));
                    }}
                    value={currentSymbol}
                >
                    <option className="Volatility10" value="R_10">
                        Volatility 10 index
                    </option>
                    <option className="Volatility10s" value="1HZ10V">
                        Volatility 10(1s) index
                    </option>
                    <option className="Volatility10s" value="1HZ15V">
                        Volatility 15(1s) index
                    </option>
                    <option className="Volatility25" value="R_25">
                        Volatility 25 index
                    </option>
                    <option className="Volatility25s" value="1HZ25V">
                        Volatility 25(1s) index
                    </option>
                    <option className="Volatility25s" value="1HZ30V">
                        Volatility 30(1s) index
                    </option>
                    <option className="Volatility50" value="R_50">
                        Volatility 50 index
                    </option>
                    <option className="Volatility50s" value="1HZ50V">
                        Volatility 50(1s) index
                    </option>
                    <option className="Volatility75" value="R_75">
                        Volatility 75 index
                    </option>
                    <option className="Volatility75s" value="1HZ75V">
                        Volatility 75(1s) index
                    </option>
                    <option className="Volatility75s" value="1HZ90V">
                        Volatility 90(1s) index
                    </option>
                    <option className="Volatility100" value="R_100">
                        Volatility 100 index
                    </option>
                    <option className="Volatility100s" value="1HZ100V">
                        Volatility 100(1s) index
                    </option>
                </select>
            </div>

            {/* Single Over/Under buttons (sticky via your SCSS) */}
            <div className="trade-buttons">
                <button className="trade-btn even-btn" onClick={() => handleSingleTrade(ctypes.left)}>
                    <span className="button-icon">{contractIcons[ctypes.left] || null}</span>
                    {label(ctypes.left)}
                </button>
                <button className="trade-btn odd-btn" onClick={() => handleSingleTrade(ctypes.right)}>
                    <span className="button-icon">{contractIcons[ctypes.right] || null}</span>
                    {label(ctypes.right)}
                </button>
            </div>

            {/* Analysis Selectors */}
            <div className="analysis-selectors">
                {activeMode === 'matches' && (
                    <div className="selector-container">
                        <div className="selector-header">
                            <div className="selector-title">Prediction selector</div>
                        </div>
                        <div className="digit-selector">
                            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit => {
                                const active = activeDigits.includes(digit);
                                return (
                                    <button
                                        key={`match-${digit}`}
                                        className={`digit-btn ${active ? 'active' : ''}`}
                                        style={active ? { backgroundColor: digitColors[digit] } : {}}
                                        onClick={() => handleDigitClick(digit)}
                                    >
                                        {digit}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {activeMode === 'overUnder' && (
                    <div className="selector-container">
                        <div className="selector-header">
                            <div className="selector-title">Over/Under Analysis</div>
                        </div>
                        <div className="digit-selector">
                            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit => {
                                const active = activeOverUnderDigit === digit;
                                return (
                                    <button key={`overunder-${digit}`} className={`digit-btn ${active ? 'active' : ''}`} onClick={() => handleDigitClick(digit)}>
                                        {digit}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Stakes */}
            <div className="analysis-stakes">
                {activeMode === 'matches' && activeDigits.length > 0 && (
                    <div className="stake-row">
                        {activeDigits.map(digit => (
                            <div key={`stake-${digit}`} className="stake-item">
                                <label className="stake-label">Digit {digit} Stake </label>
                                <input
                                    type="number"
                                    className="digit-stake-input"
                                    step={0.01}
                                    value={stakesByDigit[digit] ?? 5}
                                    onChange={e => {
                                        const raw = e.target.value;
                                        setStakesByDigit(s => ({
                                            ...s,
                                            [digit]: raw === '' ? ('' as any) : Number(raw),
                                        }));
                                    }}
                                    placeholder="Stake"
                                    title={`Stake for digit ${digit}`}
                                />
                            </div>
                        ))}
                    </div>
                )}

                {activeMode === 'overUnder' && activeOverUnderDigit !== null && (
                    <div className="stake-row">
                        <div className="stake-item">
                            <label className="stake-label">Stake for {activeOverUnderDigit}</label>
                            <input
                                type="number"
                                className="digit-stake-input"
                                min={0.35}
                                step={0.01}
                                value={(stakesByDigit[activeOverUnderDigit] ?? 5).toString()}
                                onChange={e => {
                                    const v = Math.max(0.35, Number(e.target.value) || 0);
                                    setStakesByDigit(s => ({ ...s, [activeOverUnderDigit]: Number(v.toFixed(2)) }));
                                }}
                                placeholder="Stake"
                                title={`Stake for threshold ${activeOverUnderDigit}`}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Digits Progress Visualization */}
            <div className="digits-container">
                <div className="digits-header">
                    <div className="digits-filter">
                        <label>Analyze last:</label>
                        <input
                            type="number"
                            className="trade-input"
                            value={filterCount}
                            onChange={e => setFilterCount(Math.max(1, Math.min(1000, Number(e.target.value))))}
                            min="1"
                            max="1000"
                            step="1"
                        />
                    </div>
                </div>

                <div className="digits digits--trade">
                    {digitsData.map(d => {
                        const { dashArray, dashOffset } = calculateStrokeValues();
                        const isLatest = analysisData.lastDigit === d.digit;
                        const isPurchased = purchasedDigit === d.digit;

                        return (
                            <div
                                key={d.digit}
                                className={['digits__digit', isLatest ? 'digits__digit--latest' : '', isPurchased ? 'digits__digit--purchased' : '']
                                    .filter(Boolean)
                                    .join(' ')}
                                data-digit={d.digit}
                            >
                                <div className="digits__pie-container">
                                    <svg className="digits__pie-progress" width="60" height="60" viewBox="0 0 60 60">
                                        <circle className="progress__bg" cx="30" cy="30" r="27"></circle>
                                        <circle
                                            className={`progress__value ${d.isMax ? 'progress__value--is-max' : d.isMin ? 'progress__value--is-min' : ''}`}
                                            cx="30"
                                            cy="30"
                                            r="27"
                                            strokeDasharray={dashArray}
                                            strokeDashoffset={dashOffset}
                                        />
                                    </svg>
                                </div>
                                <span className={`digits__digit-value ${isLatest ? 'digits__digit-value--latest' : ''}`}>
                                    <i className="digits__digit-display-value">{d.digit}</i>
                                    <i className="digits__digit-display-percentage">{d.percentage.toFixed(1)}%</i>
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

            {/* Trading Container */}
            <div className="trading-container">
                <div className="history-title">Panel</div>

                <div className="trade-controls">
                    <div className="trade-control-group">
                        <label>Market</label>
                        <select
                            id="tradeMarket"
                            className="trade-input"
                            ref={marketRef}
                            value={currentSymbol}
                            onChange={e => {
                                const newMarket = e.target.value;
                                setCurrentSymbol(newMarket);
                                if (marketSelectionRef.current) marketSelectionRef.current.value = newMarket;
                                if (wsRef.current) {
                                    wsRef.current.send(
                                        JSON.stringify({
                                            ticks_history: newMarket,
                                            style: 'ticks',
                                            count: 1000,
                                            end: 'latest',
                                            subscribe: 1,
                                        })
                                    );
                                }
                                setAnalysisData(prev => ({
                                    ...prev,
                                    lastResults: [],
                                    lastDigit: null,
                                    lastPrice: null,
                                    digitCounts: Array(10).fill(0),
                                    currentMarket: newMarket,
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
                        <select id="tradeStrategy" className="trade-input" value={strategy} onChange={e => setStrat(e.target.value as 'over' | 'under')}>
                            <option value="over">Over</option>
                            <option value="under">Under</option>
                        </select>
                    </div>

                    <div className="trade-control-group">
                        <label>Take Profit (USD)</label>
                        <input type="number" className="trade-input" defaultValue="0" min="0" step="1" ref={takeProfitRef} />
                    </div>

                    <div className="trade-control-group">
                        <label>Duration (ticks)</label>
                        <select className="trade-input" ref={durRef}>
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                            <option value="5">5</option>
                            <option value="10">10</option>
                        </select>
                    </div>

                    {/* Hidden legacy digit input kept disabled */}
                    <div className="trade-control-group" style={{ display: 'none' }}>
                        <input type="number" className="trade-input" defaultValue="1" min="0" max="9" step="1" ref={digitRef} disabled />
                    </div>
                </div>

                <div className="title">
                    <small>Type</small>
                    <small>Entry/Exit spot</small>
                    <small>Buy price and P/L</small>
                </div>

                <div className="open-positions">
                    {trades.length === 0 ? (
                        <div className="no-positions">
                            <small>No positions</small>
                        </div>
                    ) : (
                        trades
                            .filter(t => t.status !== 'pending')
                            .map(tr => (
                                <div key={tr.id} className={`position-item ${posClass(tr.status)}`}>
                                    <div className="position-header">
                                        <div className="position-market-contract">
                                            <div className="market-icon">{marketIcons[tr.market] || <span>{tr.market}</span>}</div>
                                            <div className="contract-icon">{contractIcons[tr.contractType] || <span>{label(tr.contractType)}</span>}</div>
                                            {typeof tr.selectedDigit === 'number' && (
                                                <span className="barrier-tag" title={`Barrier / Prediction digit: ${tr.selectedDigit}`}>
                                                    D{tr.selectedDigit}
                                                </span>
                                            )}
                                        </div>
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
                                        <div className="position-stake">{tr.stake.toFixed(2)} USD</div>
                                        <div className={`position-result ${tr.profit !== undefined ? (tr.profit >= 0 ? 'profit' : 'loss') : ''}`}>
                                            {tr.profit !== undefined ? `${tr.profit >= 0 ? '+' : ''}${tr.profit.toFixed(2)}` : '—'}
                                        </div>
                                    </div>
                                </div>
                            ))
                    )}
                </div>

                <div className="trade-buttons">
                    <button className="trade-btn reset-btn" onClick={handleReset}>
                        Reset
                    </button>
                </div>

                <div className={`trade-status status-${msg.type}`}>{msg.txt}</div>

                <div className="performance-stats">
                    <div className="stat-item">
                        <div className="stat-title">Total P/L</div>
                        <div className={`stat-value ${profitLoss >= 0 ? 'profit' : 'loss'}`}>{profitLoss >= 0 ? '+' : ''}${Math.abs(profitLoss).toFixed(2)} USD</div>
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

            <div className="history-container">
                <div className="history-title">
                    Analysis Chamber
                    <button className="refresh-btn" id="refreshBtn" onClick={refreshData}>
                        <i className="fas fa-sync-alt"></i> Refresh
                    </button>
                </div>

                <div className="history-items">
                    {visibleHistory.map((result, index) => {
                        let style: CSSProperties = { backgroundColor: 'transparent', color: 'black' };

                        if (activeMode === 'matches' && activeDigits.includes(result.digit)) {
                            style = { backgroundColor: digitColors[result.digit], color: 'white' };
                        } else if (activeMode === 'overUnder' && activeOverUnderDigit !== null) {
                            if (result.digit > activeOverUnderDigit) style = { backgroundColor: '#e74c3c', color: 'white' };
                            else if (result.digit < activeOverUnderDigit) style = { backgroundColor: '#2ecc71', color: 'white' };
                        }

                        // ✅ add blink class for the purchased result tick digit (first match only)
                        const isPurchasedHistory = purchasedDigit !== null && index === purchasedHistoryIndex;

                        return (
                            <div
                                key={`${result.timestamp.getTime()}-${index}`}
                                className={`history-item ${isPurchasedHistory ? 'history-item--purchased' : ''}`}
                                style={style}
                                title={`Price: ${result.price}`}
                                data-digit={result.digit}
                            >
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
