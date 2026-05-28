import { useCallback, useEffect, useMemo, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { useApiBase } from '@/hooks/useApiBase';
import { sendDerivSessionContractPurchase } from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import { CHART_MA_SPECS } from '@/pages/manualtrader/manualTraderChartIndicators';
import { manualTraderFormatQuoteForDigitContract } from '@/pages/manualtrader/manualTraderTickDigitFormat';
import {
    MarketDerivedVolatility1001sIcon,
    MarketDerivedVolatility100Icon,
    MarketDerivedVolatility101sIcon,
    MarketDerivedVolatility10Icon,
    MarketDerivedVolatility251sIcon,
    MarketDerivedVolatility25Icon,
    MarketDerivedVolatility501sIcon,
    MarketDerivedVolatility50Icon,
    MarketDerivedVolatility751sIcon,
    MarketDerivedVolatility75Icon,
    MarketDerivedVolatility901sIcon,
    TradeTypesUpsAndDownsFallIcon,
    TradeTypesUpsAndDownsRiseIcon,
} from '@deriv/quill-icons';
import { useRiseFallManualChart, type RiseFallChartOverlay } from './useRiseFallManualChart';
import { useRiseFallBarrierQuote } from './useRiseFallBarrierQuote';
import { useRiseFallTradePayouts } from './useRiseFallTradePayouts';
import {
    computeLiveBarrierFromOffset,
    RISE_FALL_CUSTOM_BARRIER,
} from './riseFallBarrierUtils';
import '../manualtrader/ManualTrader.scss';
import './RiseFallManual.scss';

type TradeMode = 'rise_fall' | 'higher_lower';
type ContractType = 'CALL' | 'PUT' | 'VANILLALONGCALL' | 'VANILLALONGPUT';
type TradeDirection = 'up' | 'down';

type TradeRow = {
    id: string;
    tradeMode: TradeMode;
    contractType: ContractType;
    stake: number;
    durationMin: number;
    status: 'pending' | 'open' | 'won' | 'lost' | 'error';
    profit?: number;
    entryPrice?: number;
    exitPrice?: number;
    entryEpoch?: number;
    exitEpoch?: number;
    purchaseEpoch?: number;
    expiryEpoch?: number;
    isSellAllowed?: boolean;
    barrierOffset?: string;
    strike?: number;
};

const DEFAULT_MARKET = '1HZ100V';
const UI_THEME_KEY = 'rise-fall-manual-ui-theme';
const QUICK_STAKES = [1, 5, 10, 25, 50];
const DURATION_MINUTES = [1, 2, 3, 5, 10, 15, 30, 60];

const SYMBOLS = [
    'R_10',
    'R_25',
    'R_50',
    'R_75',
    'R_100',
    '1HZ10V',
    '1HZ25V',
    '1HZ50V',
    '1HZ75V',
    '1HZ90V',
    '1HZ100V',
];

const MARKET_META: Record<string, { label: string; icon: JSX.Element }> = {
    '1HZ10V': { label: 'Vol 10 (1s)', icon: <MarketDerivedVolatility101sIcon width={16} height={16} /> },
    '1HZ25V': { label: 'Vol 25 (1s)', icon: <MarketDerivedVolatility251sIcon width={16} height={16} /> },
    '1HZ50V': { label: 'Vol 50 (1s)', icon: <MarketDerivedVolatility501sIcon width={16} height={16} /> },
    '1HZ75V': { label: 'Vol 75 (1s)', icon: <MarketDerivedVolatility751sIcon width={16} height={16} /> },
    '1HZ90V': { label: 'Vol 90 (1s)', icon: <MarketDerivedVolatility901sIcon width={16} height={16} /> },
    '1HZ100V': { label: 'Vol 100 (1s)', icon: <MarketDerivedVolatility1001sIcon width={16} height={16} /> },
    R_10: { label: 'Vol 10', icon: <MarketDerivedVolatility10Icon width={16} height={16} /> },
    R_25: { label: 'Vol 25', icon: <MarketDerivedVolatility25Icon width={16} height={16} /> },
    R_50: { label: 'Vol 50', icon: <MarketDerivedVolatility50Icon width={16} height={16} /> },
    R_75: { label: 'Vol 75', icon: <MarketDerivedVolatility75Icon width={16} height={16} /> },
    R_100: { label: 'Vol 100', icon: <MarketDerivedVolatility100Icon width={16} height={16} /> },
};

const pickExitPrice = (c: Record<string, unknown>): number | undefined => {
    const v = Number(c.exit_tick ?? c.exit_spot ?? c.sell_price ?? c.bid_price ?? NaN);
    return Number.isFinite(v) ? v : undefined;
};

const pickEntryPrice = (c: Record<string, unknown>): number | undefined => {
    const v = Number(c.entry_tick ?? c.entry_spot ?? NaN);
    return Number.isFinite(v) ? v : undefined;
};

const pickEntryEpoch = (c: Record<string, unknown>): number | undefined => {
    const v = Number(c.entry_tick_time ?? c.date_start ?? c.purchase_time ?? NaN);
    return Number.isFinite(v) ? Math.floor(v) : undefined;
};

const pickExpiryEpoch = (c: Record<string, unknown>): number | undefined => {
    const v = Number(c.date_expiry ?? NaN);
    return Number.isFinite(v) ? Math.floor(v) : undefined;
};

const isProposalFinished = (c: Record<string, unknown>) => {
    const s = String(c.status ?? c.contract_status ?? '').toLowerCase();
    return s === 'won' || s === 'lost' || s === 'sold' || Boolean(c.is_sold) || Boolean(c.is_expired);
};

const pickStrike = (c: Record<string, unknown>): number | undefined => {
    const details = c.contract_details as Record<string, unknown> | undefined;
    const v = Number(c.barrier ?? details?.barrier ?? NaN);
    return Number.isFinite(v) ? v : undefined;
};

function isUpContract(ct: ContractType): boolean {
    return ct === 'CALL' || ct === 'VANILLALONGCALL';
}

function resolveContractType(mode: TradeMode, direction: TradeDirection): ContractType {
    if (mode === 'higher_lower') {
        return direction === 'up' ? 'VANILLALONGCALL' : 'VANILLALONGPUT';
    }
    return direction === 'up' ? 'CALL' : 'PUT';
}

function contractDisplayLabel(t: TradeRow): string {
    const up = isUpContract(t.contractType);
    if (t.tradeMode === 'higher_lower') return up ? 'Higher' : 'Lower';
    return up ? 'Rise' : 'Fall';
}

function directionDisplayLabel(mode: TradeMode, direction: TradeDirection): string {
    if (mode === 'higher_lower') return direction === 'up' ? 'Higher' : 'Lower';
    return direction === 'up' ? 'Rise' : 'Fall';
}

function riseFallOrderStatusClass(t: TradeRow): string {
    if (t.status === 'won') return 'manual-trader__order--won';
    if (t.status === 'lost' || t.status === 'error') return 'manual-trader__order--lost';
    if (t.status === 'pending') return 'manual-trader__order--pending';
    const live = typeof t.profit === 'number' ? t.profit : 0;
    return live >= 0 ? 'manual-trader__order--won' : 'manual-trader__order--lost';
}

function IconSun({ size = 18 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox='0 0 24 24' fill='none' aria-hidden>
            <circle cx='12' cy='12' r='4' stroke='currentColor' strokeWidth='2' />
            <path
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                d='M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41'
            />
        </svg>
    );
}

function IconMoon({ size = 18 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox='0 0 24 24' fill='none' aria-hidden>
            <path
                d='M21 14.5A8.5 8.5 0 1 1 9.5 3a6.5 6.5 0 1 0 11.5 11.5z'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinejoin='round'
            />
        </svg>
    );
}

function RiseFallResultCell({ trade }: { trade: TradeRow }) {
    const pendingLike = trade.status === 'pending';
    const profitClass =
        pendingLike
            ? 'manual-trader__order-result--pending'
            : trade.status === 'error'
              ? 'manual-trader__order-result--loss'
              : typeof trade.profit === 'number'
                ? trade.profit >= 0
                    ? 'manual-trader__order-result--profit'
                    : 'manual-trader__order-result--loss'
                : '';

    return (
        <div className={`manual-trader__order-result ${profitClass}`.trim()}>
            {pendingLike
                ? '...'
                : trade.status === 'error'
                  ? 'Failed'
                  : typeof trade.profit === 'number'
                    ? `${trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(2)}`
                    : '—'}
        </div>
    );
}

export default function RiseFallManual() {
    const [symbol, setSymbol] = useState(DEFAULT_MARKET);
    const [tradeMode, setTradeMode] = useState<TradeMode>('rise_fall');
    const [stake, setStake] = useState<number | ''>(1);
    const [durationMin, setDurationMin] = useState<number | ''>(1);
    const [trades, setTrades] = useState<TradeRow[]>([]);
    const [isBuying, setIsBuying] = useState(false);
    const [status, setStatus] = useState('');
    const [uiTheme, setUiTheme] = useState<'light' | 'dark'>(() => {
        try {
            const s = localStorage.getItem(UI_THEME_KEY);
            return s === 'dark' ? 'dark' : 'light';
        } catch {
            return 'light';
        }
    });

    const { tradingSocketGeneration } = useApiBase();
    const isHigherLower = tradeMode === 'higher_lower';
    const {
        barrier,
        barrierChoices,
        barrierSelect,
        barrierInput,
        setBarrierInput,
        proposalStrike,
        isQuoting,
        quoteError,
        onBarrierSelectChange,
        commitCustomBarrier,
        customBarrierMode,
    } = useRiseFallBarrierQuote({
        enabled: isHigherLower,
        symbol,
        durationMin,
        stake,
        tradingSocketGeneration,
    });
    const openTrades = useMemo(
        () => trades.filter(t => t.status === 'open' || t.status === 'pending'),
        [trades]
    );

    const chartOverlay = useMemo((): RiseFallChartOverlay => {
        const activeContracts = openTrades.map(t => ({
            id: t.id,
            tradeMode: t.tradeMode,
            contractType: t.contractType,
            durationMin: t.durationMin,
            entryEpoch: t.entryEpoch,
            entryPrice: t.entryPrice,
            strike: t.strike,
            expiryEpoch:
                t.expiryEpoch ??
                (t.entryEpoch != null
                    ? Math.floor(t.entryEpoch) + Math.max(1, t.durationMin) * 60
                    : undefined),
            barrierOffset: t.barrierOffset,
            purchaseEpoch: t.purchaseEpoch,
        }));
        const settledTrades = trades
            .filter(t => t.status === 'won' || t.status === 'lost')
            .map(t => ({
                id: t.id,
                status: t.status,
                entryEpoch: t.entryEpoch,
                exitEpoch: t.exitEpoch,
                entryPrice: t.entryPrice,
                exitPrice: t.exitPrice,
            }));
        return {
            tradeMode,
            barrierOffset: isHigherLower ? barrier : null,
            activeContracts,
            settledTrades,
        };
    }, [tradeMode, isHigherLower, barrier, openTrades, trades]);

    const {
        chartWrapRef,
        isConnected,
        chartHistoryLoading,
        chartLoadMessage,
        liveTick,
        maEnabled,
        setMaEnabled,
        chartIndicatorsExpanded,
        setChartIndicatorsExpanded,
    } = useRiseFallManualChart(symbol, uiTheme, chartOverlay);

    const { formatPayout } = useRiseFallTradePayouts({
        tradeMode,
        symbol,
        durationMin,
        stake,
        barrier,
        isConnected,
        tradingSocketGeneration,
    });

    useEffect(() => {
        try {
            localStorage.setItem(UI_THEME_KEY, uiTheme);
        } catch {
            /* noop */
        }
    }, [uiTheme]);

    const sellableOpen = useMemo(
        () => openTrades.filter(t => t.isSellAllowed && !String(t.id).startsWith('tmp')),
        [openTrades]
    );

    const canBuy = useMemo(() => {
        const okStake = typeof stake === 'number' && Number.isFinite(stake) && stake >= 0.35;
        const okDur = typeof durationMin === 'number' && Number.isFinite(durationMin) && durationMin >= 1;
        const okBarrier = !isHigherLower || Boolean(barrier?.trim());
        return okStake && okDur && okBarrier && isConnected && !isBuying && !isQuoting;
    }, [stake, durationMin, isConnected, isBuying, isHigherLower, barrier, isQuoting]);

    useEffect(() => {
        let sub: { unsubscribe: () => void } | null = null;
        const start = async () => {
            try {
                if (!api_base.api || api_base.api.connection.readyState !== 1) {
                    await api_base.init(true);
                }
                sub = api_base.api.onMessage().subscribe(({ data }: { data: Record<string, unknown> }) => {
                    if (!data || data.error) return;

                    if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract) {
                        const c = data.proposal_open_contract as Record<string, unknown>;
                        const cid = String(c.contract_id);
                        const finished = isProposalFinished(c);
                        const net = Number(c.profit ?? 0);
                        const sellAllowed = Boolean(c.is_sell_allowed);
                        const exitEpochRaw = Number(c.exit_tick_time ?? c.sell_time ?? c.date_expiry ?? NaN);
                        const exitEpoch = Number.isFinite(exitEpochRaw) ? Math.floor(exitEpochRaw) : undefined;
                        const exitPrice = pickExitPrice(c);
                        const entryPrice = pickEntryPrice(c);
                        const entryEpoch = pickEntryEpoch(c);
                        const expiryEpoch = pickExpiryEpoch(c);
                        const strike = pickStrike(c);
                        const outcome: 'won' | 'lost' = net >= 0 ? 'won' : 'lost';

                        setTrades(prev =>
                            prev.map(t => {
                                if (t.id !== cid) return t;
                                if (!finished) {
                                    return {
                                        ...t,
                                        status: t.status === 'pending' ? 'pending' : 'open',
                                        isSellAllowed: sellAllowed,
                                        profit: net,
                                        entryPrice: entryPrice ?? t.entryPrice,
                                        entryEpoch: entryEpoch ?? t.entryEpoch,
                                        expiryEpoch: expiryEpoch ?? t.expiryEpoch,
                                        strike: strike ?? t.strike,
                                    };
                                }
                                return {
                                    ...t,
                                    status: outcome,
                                    profit: net,
                                    exitEpoch,
                                    exitPrice,
                                    isSellAllowed: false,
                                    entryPrice: entryPrice ?? t.entryPrice,
                                    entryEpoch: entryEpoch ?? t.entryEpoch,
                                    expiryEpoch: expiryEpoch ?? t.expiryEpoch,
                                    strike: strike ?? t.strike,
                                };
                            })
                        );
                    }
                });
            } catch {
                /* noop */
            }
        };
        void start();
        return () => sub?.unsubscribe();
    }, [tradingSocketGeneration]);

    useEffect(() => {
        const ids = openTrades.filter(t => !String(t.id).startsWith('tmp')).map(t => t.id);
        if (!ids.length) return;
        let cancelled = false;
        const poll = async () => {
            if (cancelled || !api_base.api || api_base.api.connection.readyState !== 1) return;
            for (const contract_id of ids) {
                try {
                    await api_base.api.send({ proposal_open_contract: 1, contract_id, subscribe: 0 });
                } catch {
                    /* noop */
                }
            }
        };
        const id = window.setInterval(() => void poll(), 500);
        void poll();
        return () => {
            cancelled = true;
            window.clearInterval(id);
        };
    }, [openTrades]);

    const placeTrade = useCallback(
        async (direction: TradeDirection) => {
            if (!canBuy) return;
            const amount = Number(stake);
            const dur = Math.max(1, Math.floor(Number(durationMin)));
            const contractType = resolveContractType(tradeMode, direction);
            const label = directionDisplayLabel(tradeMode, direction);
            const tmpId = `tmp-${Date.now()}`;
            const purchaseEpoch = Math.floor(Date.now() / 1000);
            setIsBuying(true);
            setStatus(`Placing ${label}…`);
            setTrades(prev => [
                {
                    id: tmpId,
                    tradeMode,
                    contractType,
                    stake: amount,
                    durationMin: dur,
                    status: 'pending',
                    purchaseEpoch,
                    expiryEpoch: purchaseEpoch + dur * 60,
                    ...(isHigherLower
                        ? {
                              barrierOffset: barrier,
                              strike: proposalStrike ?? undefined,
                          }
                        : {}),
                },
                ...prev,
            ]);

            try {
                if (!api_base.api || api_base.api.connection.readyState !== 1) await api_base.init(true);
                const resp = (await sendDerivSessionContractPurchase(
                    d => api_base.api!.send(d) as Promise<unknown>,
                    {
                        contract_type: contractType,
                        market: symbol,
                        duration: dur,
                        stake: amount,
                        duration_unit: 'm',
                        ...(isHigherLower && barrier ? { barrier } : {}),
                    }
                )) as { error?: { message?: string }; buy?: { contract_id?: unknown } };
                if (resp?.error) throw new Error(resp.error?.message || 'Buy failed');
                const contractId = resp.buy?.contract_id;
                if (contractId == null || contractId === '') throw new Error('Missing contract id');
                const id = String(contractId);
                setTrades(prev => prev.map(t => (t.id === tmpId ? { ...t, id, status: 'open' } : t)));
                setStatus(`${label} placed`);
                void api_base.api.send({ proposal_open_contract: 1, contract_id: id, subscribe: 1 }).catch(() => {});
            } catch (e: unknown) {
                setTrades(prev => prev.map(t => (t.id === tmpId ? { ...t, status: 'error' } : t)));
                setStatus(e instanceof Error ? e.message : 'Trade failed');
            } finally {
                setIsBuying(false);
            }
        },
        [canBuy, stake, durationMin, symbol, tradeMode, isHigherLower, barrier, proposalStrike]
    );

    const sellContract = useCallback(async (contractId: string) => {
        if (!api_base.api || api_base.api.connection.readyState !== 1) return;
        try {
            await api_base.api.send({ sell: contractId, price: 0 });
            setStatus('Closing contract…');
        } catch (e: unknown) {
            setStatus(e instanceof Error ? e.message : 'Sell failed');
        }
    }, []);

    const closeAllContracts = useCallback(async () => {
        for (const t of sellableOpen) {
            await sellContract(t.id);
        }
    }, [sellableOpen, sellContract]);

    const fmtPrice = (v?: number) =>
        v !== undefined && Number.isFinite(v) ? manualTraderFormatQuoteForDigitContract(v, symbol) : '—';

    const upLabel = directionDisplayLabel(tradeMode, 'up');
    const downLabel = directionDisplayLabel(tradeMode, 'down');

    const renderModeTabs = () => (
        <div className='rise-fall-manual__mode-tabs' role='tablist' aria-label='Contract mode'>
            <button
                type='button'
                role='tab'
                aria-selected={tradeMode === 'rise_fall'}
                className={tradeMode === 'rise_fall' ? 'active' : ''}
                onClick={() => setTradeMode('rise_fall')}
            >
                Rise / Fall
            </button>
            <button
                type='button'
                role='tab'
                aria-selected={tradeMode === 'higher_lower'}
                className={tradeMode === 'higher_lower' ? 'active' : ''}
                onClick={() => setTradeMode('higher_lower')}
            >
                Higher / Lower
            </button>
        </div>
    );

    const renderBarrierControls = () => {
        if (!isHigherLower) return null;
        return (
            <div className='rise-fall-manual__barrier'>
                <label className='rise-fall-manual__field'>
                    Barrier offset
                    <div className='rise-fall-manual__barrier-row'>
                        <select
                            className='trade-input'
                            value={barrierSelect}
                            onChange={e => onBarrierSelectChange(e.target.value)}
                            disabled={isQuoting && !barrierChoices.length}
                        >
                            {barrierChoices.map(b => (
                                <option key={b} value={b}>
                                    {b}
                                </option>
                            ))}
                            <option value={RISE_FALL_CUSTOM_BARRIER}>Custom…</option>
                        </select>
                        {customBarrierMode ? (
                            <input
                                className='trade-input'
                                type='text'
                                value={barrierInput}
                                onChange={e => setBarrierInput(e.target.value)}
                                onBlur={() => commitCustomBarrier()}
                                placeholder='+0.00'
                            />
                        ) : null}
                    </div>
                </label>
                {liveTick && Number.isFinite(liveTick.q) ? (
                    <p className='rise-fall-manual__barrier-strike'>
                        Barrier (live): {fmtPrice(computeLiveBarrierFromOffset(liveTick.q, barrier) ?? liveTick.q)}
                        {proposalStrike != null && Number.isFinite(proposalStrike)
                            ? ` · quote ${fmtPrice(proposalStrike)}`
                            : ''}
                        {isQuoting ? ' · updating…' : ''}
                    </p>
                ) : proposalStrike != null && Number.isFinite(proposalStrike) ? (
                    <p className='rise-fall-manual__barrier-strike'>
                        Strike: {fmtPrice(proposalStrike)}
                        {isQuoting ? ' · updating…' : ''}
                    </p>
                ) : isQuoting ? (
                    <p className='rise-fall-manual__barrier-strike'>Loading barriers…</p>
                ) : null}
                {quoteError && !isQuoting ? (
                    <p className='rise-fall-manual__barrier-error' title={quoteError}>
                        Quote: {quoteError.length > 80 ? `${quoteError.slice(0, 80)}…` : quoteError}
                    </p>
                ) : null}
            </div>
        );
    };

    const renderMaToggle = (spec: (typeof CHART_MA_SPECS)[0]) => (
        <button
            key={spec.period}
            type='button'
            className={`manual-trader__chart-ma-btn${maEnabled[spec.period] ? ' manual-trader__chart-ma-btn--on' : ''}`}
            style={{ '--ma-color': spec.color } as React.CSSProperties}
            onClick={() => setMaEnabled(prev => ({ ...prev, [spec.period]: !prev[spec.period] }))}
            aria-pressed={Boolean(maEnabled[spec.period])}
        >
            {spec.label}
        </button>
    );

    const dark = uiTheme === 'dark';

    return (
        <div
            className={`manual-trader-page rise-fall-manual-page${dark ? ' manual-trader-page--dark rise-fall-manual-page--dark' : ''}`}
        >
            <div className={`rise-fall-manual${dark ? ' rise-fall-manual--dark' : ''}`}>
                <div className='rise-fall-manual__theme-toggle' role='group' aria-label='Rise Fall theme'>
                    <button
                        type='button'
                        className={uiTheme === 'light' ? 'active' : ''}
                        onClick={() => setUiTheme('light')}
                        aria-pressed={uiTheme === 'light'}
                        title='Light theme'
                    >
                        <IconSun size={17} />
                    </button>
                    <button
                        type='button'
                        className={uiTheme === 'dark' ? 'active' : ''}
                        onClick={() => setUiTheme('dark')}
                        aria-pressed={uiTheme === 'dark'}
                        title='Dark theme'
                    >
                        <IconMoon size={17} />
                    </button>
                </div>

                <div className='rise-fall-manual__top-bar'>
                    {status ? <span className='rise-fall-manual__status'>{status}</span> : null}
                </div>

                <div className='rise-fall-manual__body'>
                    <aside className='rise-fall-manual__sidebar' aria-label='Contract settings'>
                        <div className='rise-fall-manual__settings'>
                            {renderModeTabs()}
                            <label className='rise-fall-manual__field'>
                                Stake (USD)
                                <input
                                    type='number'
                                    min={0.35}
                                    step={0.01}
                                    className='trade-input'
                                    value={stake}
                                    onChange={e =>
                                        setStake(e.target.value === '' ? '' : Number(e.target.value))
                                    }
                                />
                            </label>
                            <div className='rise-fall-manual__quick-stakes'>
                                {QUICK_STAKES.map(v => (
                                    <button
                                        key={v}
                                        type='button'
                                        className={stake === v ? 'active' : ''}
                                        onClick={() => setStake(v)}
                                    >
                                        {v}
                                    </button>
                                ))}
                            </div>
                            <label className='rise-fall-manual__field'>
                                Duration (minutes)
                                <select
                                    className='trade-input'
                                    value={durationMin}
                                    onChange={e => setDurationMin(Number(e.target.value))}
                                >
                                    {DURATION_MINUTES.map(m => (
                                        <option key={m} value={m}>
                                            {m} min
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {renderBarrierControls()}
                        </div>

                        {trades.length > 0 ? (
                            <div className='rise-fall-manual__results' aria-label='Trade results'>
                                <div className='rise-fall-manual__results-head'>
                                    <h3>Results ({trades.length})</h3>
                                    {sellableOpen.length > 0 ? (
                                        <button
                                            type='button'
                                            className='rise-fall-manual__close-all'
                                            onClick={() => void closeAllContracts()}
                                        >
                                            Close all
                                        </button>
                                    ) : null}
                                </div>
                                <div className='manual-trader__orders rise-fall-manual__orders'>
                                    <div className='rise-fall-manual__results-title'>
                                        <small>Type</small>
                                        <small>Entry / Exit</small>
                                        <small>Stake & P/L</small>
                                    </div>
                                    <div className='manual-trader__orders-body'>
                                        {trades.map(t => {
                                            const isUp = isUpContract(t.contractType);
                                            const canSell =
                                                t.isSellAllowed &&
                                                !String(t.id).startsWith('tmp') &&
                                                (t.status === 'open' || t.status === 'pending');
                                            return (
                                                <div
                                                    key={t.id}
                                                    className={`manual-trader__order ${riseFallOrderStatusClass(t)}`}
                                                >
                                                    <div className='manual-trader__order-header'>
                                                        <div className='manual-trader__order-contract'>
                                                            {isUp ? (
                                                                <TradeTypesUpsAndDownsRiseIcon
                                                                    width={16}
                                                                    height={16}
                                                                />
                                                            ) : (
                                                                <TradeTypesUpsAndDownsFallIcon
                                                                    width={16}
                                                                    height={16}
                                                                />
                                                            )}
                                                            <span>
                                                                {contractDisplayLabel(t)}
                                                                {t.barrierOffset ? (
                                                                    <span className='rise-fall-manual__order-barrier'>
                                                                        {' '}
                                                                        {t.barrierOffset}
                                                                    </span>
                                                                ) : null}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className='manual-trader__order-spots'>
                                                        <div className='manual-trader__order-spot manual-trader__order-spot--entry'>
                                                            <svg
                                                                width={16}
                                                                height={16}
                                                                viewBox='0 0 16 16'
                                                                aria-hidden
                                                            >
                                                                <circle
                                                                    cx={8}
                                                                    cy={8}
                                                                    r={6}
                                                                    stroke='#FF4444'
                                                                    strokeWidth={1.5}
                                                                    fill='white'
                                                                />
                                                                <circle cx={8} cy={8} r={3} fill='#FF4444' />
                                                            </svg>
                                                            {fmtPrice(t.entryPrice)}
                                                        </div>
                                                        <div className='manual-trader__order-spot manual-trader__order-spot--exit'>
                                                            <svg
                                                                width={16}
                                                                height={16}
                                                                viewBox='0 0 16 16'
                                                                aria-hidden
                                                            >
                                                                <circle
                                                                    cx={8}
                                                                    cy={8}
                                                                    r={6}
                                                                    stroke='#999999'
                                                                    strokeWidth={1.5}
                                                                    fill='white'
                                                                />
                                                            </svg>
                                                            {fmtPrice(t.exitPrice)}
                                                        </div>
                                                        {t.tradeMode === 'higher_lower' && t.strike != null ? (
                                                            <div className='manual-trader__order-spot rise-fall-manual__order-strike'>
                                                                <small>Strike</small>
                                                                {fmtPrice(t.strike)}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                    <div className='manual-trader__order-footer rise-fall-manual__order-footer'>
                                                        <div className='manual-trader__order-stake'>
                                                            {t.stake.toFixed(2)} USD
                                                        </div>
                                                        <RiseFallResultCell trade={t} />
                                                        {canSell ? (
                                                            <button
                                                                type='button'
                                                                className='rise-fall-manual__order-sell'
                                                                onClick={() => void sellContract(t.id)}
                                                            >
                                                                Sell
                                                            </button>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        <div className='rise-fall-manual__trade-buttons rise-fall-manual__trade-buttons--sidebar'>
                            <button
                                type='button'
                                className='rise-fall-manual__trade-btn rise-fall-manual__trade-btn--rise'
                                disabled={!canBuy}
                                onClick={() => void placeTrade('up')}
                            >
                                <span>
                                    <TradeTypesUpsAndDownsRiseIcon width={22} height={22} />
                                    {upLabel}
                                </span>
                                <small>{formatPayout('up')}</small>
                            </button>
                            <button
                                type='button'
                                className='rise-fall-manual__trade-btn rise-fall-manual__trade-btn--fall'
                                disabled={!canBuy}
                                onClick={() => void placeTrade('down')}
                            >
                                <span>
                                    <TradeTypesUpsAndDownsFallIcon width={22} height={22} />
                                    {downLabel}
                                </span>
                                <small>{formatPayout('down')}</small>
                            </button>
                        </div>
                    </aside>

                    <section className='rise-fall-manual__chart-section manual-trader__chart-panel'>
                        <div className='manual-trader__smartchart rise-fall-manual__chart-wrap'>
                            <div ref={chartWrapRef} className='manual-trader__smartchart-pane' />
                            {chartHistoryLoading ? (
                                <div className='manual-trader__chart-loading' role='status'>
                                    <span className='manual-trader__chart-loading-spinner' aria-hidden />
                                    <span>{chartLoadMessage}</span>
                                </div>
                            ) : null}
                            <div className='manual-trader__chart-controls'>
                                <div className='manual-trader__chart-market-card'>
                                    <div className='manual-trader__chart-market-row'>
                                        {MARKET_META[symbol]?.icon}
                                        <select
                                            className='trade-input manual-trader__chart-market-select'
                                            value={symbol}
                                            onChange={e => setSymbol(e.target.value)}
                                        >
                                            {SYMBOLS.map(s => (
                                                <option key={s} value={s}>
                                                    {MARKET_META[s]?.label ?? s}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div className='manual-trader__chart-ma-bar'>
                                    <div className='manual-trader__chart-ma-bar-head'>
                                        {CHART_MA_SPECS[0] ? renderMaToggle(CHART_MA_SPECS[0]) : null}
                                        {CHART_MA_SPECS.length > 1 ? (
                                            <button
                                                type='button'
                                                className='manual-trader__chart-ma-expand'
                                                onClick={() => setChartIndicatorsExpanded(v => !v)}
                                            >
                                                {chartIndicatorsExpanded ? '▲' : '▼'}
                                            </button>
                                        ) : null}
                                    </div>
                                    {chartIndicatorsExpanded ? (
                                        <div className='manual-trader__chart-ma-bar-more'>
                                            {CHART_MA_SPECS.slice(1).map(renderMaToggle)}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                <footer className='rise-fall-manual__footer rise-fall-manual__footer--mobile'>
                    <div className='rise-fall-manual__controls'>
                        {renderModeTabs()}
                        <label className='rise-fall-manual__field'>
                            Stake (USD)
                            <input
                                type='number'
                                min={0.35}
                                step={0.01}
                                className='trade-input'
                                value={stake}
                                onChange={e =>
                                    setStake(e.target.value === '' ? '' : Number(e.target.value))
                                }
                            />
                        </label>
                        <div className='rise-fall-manual__quick-stakes'>
                            {QUICK_STAKES.map(v => (
                                <button
                                    key={v}
                                    type='button'
                                    className={stake === v ? 'active' : ''}
                                    onClick={() => setStake(v)}
                                >
                                    {v}
                                </button>
                            ))}
                        </div>
                        <label className='rise-fall-manual__field'>
                            Duration (minutes)
                            <select
                                className='trade-input'
                                value={durationMin}
                                onChange={e => setDurationMin(Number(e.target.value))}
                            >
                                {DURATION_MINUTES.map(m => (
                                    <option key={m} value={m}>
                                        {m} min
                                    </option>
                                ))}
                            </select>
                        </label>
                        {renderBarrierControls()}
                    </div>
                    <div className='rise-fall-manual__trade-buttons'>
                        <button
                            type='button'
                            className='rise-fall-manual__trade-btn rise-fall-manual__trade-btn--rise'
                            disabled={!canBuy}
                            onClick={() => void placeTrade('up')}
                        >
                            <span>
                                <TradeTypesUpsAndDownsRiseIcon width={22} height={22} />
                                {upLabel}
                            </span>
                            <small>{formatPayout('up')}</small>
                        </button>
                        <button
                            type='button'
                            className='rise-fall-manual__trade-btn rise-fall-manual__trade-btn--fall'
                            disabled={!canBuy}
                            onClick={() => void placeTrade('down')}
                        >
                            <span>
                                <TradeTypesUpsAndDownsFallIcon width={22} height={22} />
                                {downLabel}
                            </span>
                            <small>{formatPayout('down')}</small>
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
}
