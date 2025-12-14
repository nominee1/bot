import { useEffect, useRef, useState, useCallback } from 'react'; // Added useCallback here
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { api_base } from '@/external/bot-skeleton';
import chart_api from '@/external/bot-skeleton/services/api/chart-api';
import {
    ActiveSymbolsRequest,
    ServerTimeRequest,
    TicksHistoryResponse,
    TicksStreamRequest,
    TradingTimesRequest,
} from '@deriv/api-types';
import { ChartTitle, SmartChart } from '@deriv/deriv-charts';
import { useDevice } from '@deriv-com/ui';
import ToolbarWidgets from './toolbar-widgets';
import '@deriv/deriv-charts/dist/smartcharts.css';
import './chart.scss';

type TSubscription = {
    [key: string]: null | {
        unsubscribe?: () => void;
    };
};

const Chart = observer(({ show_digits_stats }: { show_digits_stats: boolean }) => {
    const barriers: [] = [];
    const { common, ui } = useStore();
    const { chart_store, run_panel, dashboard } = useStore();
    const {
        chart_type,
        getMarketsOrder,
        granularity,
        onSymbolChange,
        setChartStatus,
        symbol,
        updateChartType,
        updateGranularity,
        updateSymbol,
        setChartSubscriptionId,
        chart_subscription_id,
    } = chart_store;

    // Chart refs and state
    const chartSubscriptionIdRef = useRef(chart_subscription_id);
    const subscriptions = useRef<TSubscription>({});

    // Trading state
    const [numberOfTicks, setNumberOfTicks] = useState(5);
    const [stake, setStake] = useState(10);
    const [isAuth, setIsAuth] = useState(false);
    const [trades, setTrades] = useState<Array<{ id: string; profit: number | null }>>([]);
    const [balance, setBalance] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    const { isDesktop, isMobile } = useDevice();
    const { is_drawer_open } = run_panel;
    const { is_chart_modal_visible } = dashboard;

    // Initialize chart
    useEffect(() => {
        if (!symbol) updateSymbol();
    }, [symbol, updateSymbol]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            chart_api.api.forgetAll('ticks');
            Object.values(subscriptions.current).forEach(sub => sub?.unsubscribe?.());
        };
    }, []);

    useEffect(() => {
        chartSubscriptionIdRef.current = chart_subscription_id;
    }, [chart_subscription_id]);

    const requestAPI = (req: ServerTimeRequest | ActiveSymbolsRequest | TradingTimesRequest) => {
        return chart_api.api.send(req);
    };

    const requestForgetStream = (subscription_id: string) => {
        subscription_id && chart_api.api.forget(subscription_id);
    };

    const requestSubscribe = async (req: TicksStreamRequest, callback: (data: any) => void) => {
        try {
            requestForgetStream(chartSubscriptionIdRef.current);
            const history = await chart_api.api.send(req);
            setChartSubscriptionId(history?.subscription.id);
            if (history) callback(history);
            if (req.subscribe === 1) {
                subscriptions.current[history?.subscription.id] = chart_api.api
                    .onMessage()
                    ?.subscribe(({ data }: { data: TicksHistoryResponse }) => {
                        callback(data);
                    });
            }
        } catch (e) {
            console.error('Chart stream error:', e);
        }
    };

    // Handle account switching
    const handleAccountSwitch = useCallback(async () => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            setIsAuth(false);
            return;
        }

        setIsLoading(true);
        try {
            // Clear existing subscriptions and trades
            Object.values(subscriptions.current).forEach(sub => sub?.unsubscribe?.());
            subscriptions.current = {};
            setTrades([]);
            setBalance(0);

            // Reauthorize with new token
            await api_base.api.authorize(token);
            setIsAuth(true);
            
            // Get new balance
            const balanceResponse = await api_base.api.send({ balance: 1, subscribe: 1 });
            setBalance(balanceResponse.balance?.balance || 0);
        } catch (error) {
            console.error('Authorization failed:', error);
            setIsAuth(false);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Trading system with account switching support
    useEffect(() => {
        // Listen for storage changes (like token changes)
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === 'authToken') {
                handleAccountSwitch();
            }
        };

        window.addEventListener('storage', handleStorageChange);
        handleAccountSwitch(); // Initial auth check

        const balanceSub = api_base.api.onMessage().subscribe(({ data }) => {
            if (data.balance) setBalance(data.balance.balance);
        });

        const contractSub = api_base.api.onMessage().subscribe(({ data }) => {
            if (data.proposal_open_contract) {
                const contract = data.proposal_open_contract;
                setTrades(prev =>
                    prev.map(trade =>
                        trade.id === contract.contract_id ? { ...trade, profit: contract.profit } : trade
                    )
                );
            }
        });

        return () => {
            window.removeEventListener('storage', handleStorageChange);
            balanceSub.unsubscribe();
            contractSub.unsubscribe();
        };
    }, [handleAccountSwitch]);

    const purchaseContract = async (contractType: 'CALL' | 'PUT') => {
        if (!isAuth) {
            console.error('Not authenticated');
            return;
        }

        try {
            const response = await api_base.api.send({
                buy: 1,
                price: stake,
                parameters: {
                    amount: stake,
                    basis: 'stake',
                    currency: 'USD',
                    contract_type: contractType,
                    duration: numberOfTicks,
                    duration_unit: 't',
                    symbol: symbol,
                },
            });

            const contractId = response.buy.contract_id;
            setTrades(prev => [{ id: contractId, profit: null }, ...prev.slice(0, 3)]);

            await api_base.api.send({
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1,
            });
        } catch (error) {
            console.error('Purchase failed:', error);
        }
    };

    const settings = {
        assetInformation: false,
        countdown: true,
        isHighestLowestMarkerEnabled: false,
        language: common.current_language.toLowerCase(),
        position: ui.is_chart_layout_default ? 'bottom' : 'left',
        theme: ui.is_dark_mode_on ? 'dark' : 'light',
        displayCrosshair: false,
    };

    if (!symbol) return null;

    return (
        <div
            className={classNames('dashboard__chart-wrapper', {
                'dashboard__chart-wrapper--expanded': is_drawer_open && isDesktop,
                'dashboard__chart-wrapper--modal': is_chart_modal_visible && isDesktop,
            })}
            dir="ltr"
        >
            {isLoading && <div className="loading-overlay">Switching account...</div>}
            
            <SmartChart
                id="dbot"
                barriers={barriers}
                showLastDigitStats={show_digits_stats}
                chartControlsWidgets={null}
                enabledChartFooter={false}
                chartStatusListener={(v: boolean) => setChartStatus(!v)}
                toolbarWidget={() => (
                    <ToolbarWidgets
                        updateChartType={updateChartType}
                        updateGranularity={updateGranularity}
                        position={!isDesktop ? 'bottom' : 'top'}
                        isDesktop={isDesktop}
                    />
                )}
                chartType={chart_type}
                isMobile={isMobile}
                enabledNavigationWidget={isDesktop}
                granularity={granularity}
                requestAPI={requestAPI}
                requestForget={() => { }}
                requestForgetStream={requestForgetStream}
                requestSubscribe={requestSubscribe}
                settings={settings}
                symbol={symbol}
                topWidgets={() => <ChartTitle onChange={onSymbolChange} />}
                isConnectionOpened={!!chart_api?.api}
                getMarketsOrder={getMarketsOrder}
                isLive
                leftMargin={80}
            />

            {/* Right sidebar with P/L display */}
            <div className="right-squares-container">
                <div className="right-squares-scroll">
                    <div className="right-square">
                        <div>Balance</div>
                        <div>${balance.toFixed(2)}</div>
                    </div>
                    {trades.map((trade, index) => (
                        <div
                            key={trade.id}
                            className={`right-square ${trade.profit !== null ? (trade.profit >= 0 ? 'profit' : 'loss') : ''
                                }`}
                        >
                            <div>Trade {index + 1}</div>
                            <div>
                                {trade.profit !== null
                                    ? (trade.profit >= 0 ? '+' : '') + trade.profit.toFixed(2)
                                    : 'Pending'}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Trading controls */}
            <div className="prediction-controls-container">
                <div className="prediction-inputs">
                    <div className="input-group">
                        <label>Ticks:</label>
                        <input
                            type="number"
                            min="1"
                            value={numberOfTicks}
                            onChange={(e) => setNumberOfTicks(Math.max(1, parseInt(e.target.value) || 1))}
                        />
                    </div>

                    <div className="input-group">
                        <label>Stake:</label>
                        <input
                            type="number"
                            min="0.35"
                            step="0.01"
                            value={stake}
                            onChange={e => {
                                const val = e.target.value
                                if (val === '') {
                                    setStake('')
                                    return
                                }
                                const num = parseFloat(val)
                                if (!isNaN(num)) {
                                    setStake(num)
                                }
                            }}
                            onBlur={e => {
                                let num = parseFloat(e.target.value)
                                if (isNaN(num) || num < 0.35) num = 0.35
                                setStake(Number(num.toFixed(2)))
                            }}
                        />
                    </div>
                </div>

                <div className="prediction-buttons">
                    <button
                        className="prediction-button rise"
                        onClick={() => purchaseContract('CALL')}
                        disabled={!isAuth}
                    >
                        Rise
                    </button>
                    <button
                        className="prediction-button fall"
                        onClick={() => purchaseContract('PUT')}
                        disabled={!isAuth}
                    >
                        Fall
                    </button>
                </div>

                {!isAuth && <div className="auth-warning">Please login to place trades</div>}
            </div>
        </div>
    );
});

export default Chart;