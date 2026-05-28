import { useCallback, useEffect, useRef, useState } from 'react';
import {
    CandlestickData,
    CandlestickSeries,
    createChart,
    createSeriesMarkers,
    CrosshairMode,
    IChartApi,
    IPriceLine,
    LineSeries,
    LineStyle,
    type ISeriesApi,
    type ISeriesMarkersPluginApi,
    type Time,
    type UTCTimestamp,
} from 'lightweight-charts';
import { useDerivVisualTickApi } from '@/hooks/useDerivVisualTickApi';
import {
    CHART_MA_DEFAULT_ENABLED,
    CHART_MA_SPECS,
    computeSmaFromCandles,
} from '@/pages/manualtrader/manualTraderChartIndicators';
import { manualTraderResolveDigitTickDecimals } from '@/pages/manualtrader/manualTraderTickDigitFormat';
import {
    forgetDerivSubscription,
    isAlreadySubscribedTickError,
    recoverDerivLiveTickStream,
    subscribeDerivLiveTicks,
} from '@/utils/derivTickStream';
import { computeLiveBarrierFromOffset } from './riseFallBarrierUtils';
import {
    buildContractBracketLines,
    buildContractBracketMarkers,
    buildSettledTradeMarkers,
    type RiseFallActiveContract,
} from './riseFallChartContractBracket';
import {
    applyRiseFallChartVisibleRange,
    buildChartCandlesHistoryReq,
    buildChartTicksHistoryReq,
    buildMinuteCandlesFromTicks,
    chartHistoryStartEpochSec,
    extractCandleHistoryPayload,
    extractTickHistoryPayload,
    normalizeTickEpochSec,
    RISE_FALL_CANDLE_COUNT_FALLBACKS,
    trimCandlesToChartWindow,
    trimTicksToChartWindow,
} from './riseFallChartConfig';

const CHART_LOAD_FAIL_MS = 22_000;
const CHART_LOAD_RETRY_MS = 10_000;
const CHART_SUBSCRIBE_MAX_ATTEMPTS = 4;
const CHART_TICK_STALL_RECOVER_MS = 25_000;
const CHART_TICK_WATCH_INTERVAL_MS = 5_000;
const CHART_RIGHT_EDGE_GAP_REM = 2;
const CANDLE_SIZE_MIN = 1;

type UiTheme = 'light' | 'dark';

export type RiseFallChartOverlay = {
    tradeMode: 'rise_fall' | 'higher_lower';
    /** HL offset label on chart, e.g. `+0.59` (tracks live tick + delta). */
    barrierOffset: string | null;
    activeContracts: RiseFallActiveContract[];
    settledTrades: Array<{
        id: string;
        status: string;
        entryEpoch?: number;
        exitEpoch?: number;
        entryPrice?: number;
        exitPrice?: number;
    }>;
};

export function useRiseFallManualChart(
    symbol: string,
    uiTheme: UiTheme,
    overlay?: RiseFallChartOverlay
) {
    const chartWrapRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const maSeriesRef = useRef<Map<number, ISeriesApi<'Line'>>>(new Map());
    const seriesMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const livePriceLineRef = useRef<IPriceLine | null>(null);
    const offsetPriceLineRef = useRef<IPriceLine | null>(null);
    const contractBracketSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const contractEntryGuideSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const contractEndGuideSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const [contractClockSec, setContractClockSec] = useState(() => Math.floor(Date.now() / 1000));
    const chartStreamOpRef = useRef(0);
    const chartSubscriptionIdRef = useRef<string | null>(null);
    const subscribedChartSymbolRef = useRef<string | null>(null);
    const chartSubscribeInFlightRef = useRef(false);
    const chartHistoryReadyRef = useRef(false);
    const currentCandleRef = useRef<CandlestickData | null>(null);
    const chartRollingCandlesRef = useRef<CandlestickData[]>([]);
    const chartRollingPricesRef = useRef<number[]>([]);
    const chartRollingTimesRef = useRef<number[]>([]);

    const [isConnected, setIsConnected] = useState(false);
    const [chartHistoryLoading, setChartHistoryLoading] = useState(true);
    const [chartLoadMessage, setChartLoadMessage] = useState('Loading chart…');
    const [liveTick, setLiveTick] = useState<{ q: number; e: number } | null>(null);
    const [maEnabled, setMaEnabled] = useState<Record<number, boolean>>(() => ({ ...CHART_MA_DEFAULT_ENABLED }));
    const [chartIndicatorsExpanded, setChartIndicatorsExpanded] = useState(false);

    const { visualTickApi, visualTickReady, visualTickApiRef } = useDerivVisualTickApi();

    const applyChartRightGap = useCallback(() => {
        const chart = chartRef.current;
        if (!chart) return;
        const container = chartWrapRef.current;
        if (!container?.clientWidth) return;
        const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const gapPx = CHART_RIGHT_EDGE_GAP_REM * remPx;
        const barSpacing = chart.timeScale().options().barSpacing ?? 6;
        const offset = Math.max(2, Math.ceil(gapPx / barSpacing));
        chart.timeScale().applyOptions({ rightOffset: offset });
    }, []);

    const syncChartIndicators = useCallback(
        (candles: CandlestickData[]) => {
            for (const spec of CHART_MA_SPECS) {
                const series = maSeriesRef.current.get(spec.period);
                if (!series) continue;
                if (!maEnabled[spec.period]) {
                    series.setData([]);
                    continue;
                }
                series.setData(computeSmaFromCandles(candles, spec.period));
            }
        },
        [maEnabled]
    );

    const syncChartIndicatorsRef = useRef(syncChartIndicators);
    syncChartIndicatorsRef.current = syncChartIndicators;

    const resetCandles = useCallback(() => {
        chartRollingCandlesRef.current = [];
        chartRollingPricesRef.current = [];
        chartRollingTimesRef.current = [];
        currentCandleRef.current = null;
        candleSeriesRef.current?.setData([]);
        maSeriesRef.current.forEach(s => s.setData([]));
    }, []);

    const updateCandle = useCallback((epoch: number, quote: number) => {
        if (!candleSeriesRef.current) return;
        const epochSec = normalizeTickEpochSec(epoch);
        if (!Number.isFinite(epochSec)) return;
        const bucketSizeSec = CANDLE_SIZE_MIN * 60;
        const bucket = Math.floor(epochSec / bucketSizeSec) * bucketSizeSec;
        const existing = currentCandleRef.current;

        if (!existing || Number(existing.time) !== bucket) {
            const next: CandlestickData = {
                time: bucket as UTCTimestamp,
                open: quote,
                high: quote,
                low: quote,
                close: quote,
            };
            currentCandleRef.current = next;
            candleSeriesRef.current.update(next);
            chartRef.current?.timeScale().scrollToRealTime();
            return;
        }

        const next: CandlestickData = {
            ...existing,
            high: Math.max(existing.high, quote),
            low: Math.min(existing.low, quote),
            close: quote,
        };
        currentCandleRef.current = next;
        candleSeriesRef.current.update(next);
        chartRef.current?.timeScale().scrollToRealTime();
    }, []);

    useEffect(() => {
        const count = overlay?.activeContracts?.length ?? 0;
        if (!count) return;
        const id = window.setInterval(
            () => setContractClockSec(Math.floor(Date.now() / 1000)),
            1000
        );
        return () => window.clearInterval(id);
    }, [overlay?.activeContracts?.length]);

    useEffect(() => {
        const wrap = chartWrapRef.current;
        if (!wrap) return;

        const chartHost = () =>
            (wrap.parentElement?.closest('.rise-fall-manual__chart-wrap') as HTMLElement | null) ??
            wrap.parentElement;

        const chartSize = () => {
            const host = chartHost();
            const h = Math.max(host?.clientHeight ?? wrap.clientHeight, wrap.clientHeight, 280);
            const w = Math.max(host?.clientWidth ?? wrap.clientWidth, wrap.clientWidth, 1);
            return { width: w, height: h };
        };

        const chart = createChart(wrap, {
            layout: {
                background: { color: '#ffffff' },
                textColor: '#334155',
                attributionLogo: false,
            },
            grid: { vertLines: { visible: false }, horzLines: { visible: false } },
            crosshair: { mode: CrosshairMode.Normal },
            ...chartSize(),
            timeScale: {
                visible: true,
                timeVisible: true,
                secondsVisible: false,
                ticksVisible: true,
                borderVisible: true,
                rightOffset: 5,
                fixRightEdge: false,
                rightBarStaysOnScroll: true,
                shiftVisibleRangeOnNewBar: true,
            },
            rightPriceScale: { borderColor: '#cbd5e1', minimumWidth: 72, autoScale: true },
        });
        chartRef.current = chart;
        candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
            upColor: '#16a34a',
            downColor: '#dc2626',
            borderVisible: false,
            wickUpColor: '#16a34a',
            wickDownColor: '#dc2626',
            lastValueVisible: false,
            priceLineVisible: false,
        });
        seriesMarkersRef.current = createSeriesMarkers(candleSeriesRef.current, []);
        const bracketOpts = {
            color: '#22c55e',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        };
        const guideOpts = {
            color: '#22c55e',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        };
        contractBracketSeriesRef.current = chart.addSeries(LineSeries, bracketOpts);
        contractEntryGuideSeriesRef.current = chart.addSeries(LineSeries, guideOpts);
        contractEndGuideSeriesRef.current = chart.addSeries(LineSeries, guideOpts);
        applyChartRightGap();

        for (const spec of CHART_MA_SPECS) {
            maSeriesRef.current.set(
                spec.period,
                chart.addSeries(LineSeries, {
                    color: spec.color,
                    lineWidth: 2,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false,
                })
            );
        }

        const syncChartSize = () => {
            if (!chartWrapRef.current || !chartRef.current) return;
            const { width, height } = chartSize();
            chartRef.current.applyOptions({ width, height });
            applyChartRightGap();
        };

        const onResize = () => syncChartSize();
        window.addEventListener('resize', onResize);
        const resizeObserver = new ResizeObserver(() => syncChartSize());
        resizeObserver.observe(wrap);
        const host = chartHost();
        if (host && host !== wrap) resizeObserver.observe(host);
        syncChartSize();

        return () => {
            window.removeEventListener('resize', onResize);
            resizeObserver.disconnect();
            seriesMarkersRef.current?.detach();
            seriesMarkersRef.current = null;
            chart.remove();
            chartRef.current = null;
            candleSeriesRef.current = null;
            contractBracketSeriesRef.current = null;
            contractEntryGuideSeriesRef.current = null;
            contractEndGuideSeriesRef.current = null;
            maSeriesRef.current.clear();
        };
    }, [applyChartRightGap]);

    /** Live tick + HL offset price lines, contract duration brackets, and markers. */
    useEffect(() => {
        const series = candleSeriesRef.current;
        if (!series) return;

        const clearLine = (ref: { current: IPriceLine | null }) => {
            if (ref.current) {
                series.removePriceLine(ref.current);
                ref.current = null;
            }
        };

        clearLine(livePriceLineRef);
        clearLine(offsetPriceLineRef);

        const dark = uiTheme === 'dark';
        const liveColor = dark ? '#e2e8f0' : '#171717';
        const offsetBlue = dark ? '#60a5fa' : '#377cfc';
        const winColor = dark ? '#4ade80' : '#16a34a';
        const loseColor = dark ? '#fb7185' : '#dc2626';
        const prec = manualTraderResolveDigitTickDecimals(symbol);

        const lt = liveTick;
        const nowSec =
            lt && Number.isFinite(lt.e) ? Math.floor(lt.e) : contractClockSec;

        if (lt && Number.isFinite(lt.q)) {
            const liveTitle = lt.q.toFixed(Math.max(0, prec));
            livePriceLineRef.current = series.createPriceLine({
                price: lt.q,
                color: liveColor,
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title: liveTitle,
                lineVisible: true,
            });
        }

        const offsetLevel =
            overlay?.tradeMode === 'higher_lower' &&
            lt &&
            overlay.barrierOffset &&
            computeLiveBarrierFromOffset(lt.q, overlay.barrierOffset);

        if (offsetLevel != null && Number.isFinite(offsetLevel) && overlay?.barrierOffset) {
            offsetPriceLineRef.current = series.createPriceLine({
                price: offsetLevel,
                color: offsetBlue,
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: true,
                title: overlay.barrierOffset,
                lineVisible: true,
            });
        }

        const candles = chartRollingCandlesRef.current;
        let yMin = lt?.q ?? 0;
        let yMax = lt?.q ?? 0;
        if (candles.length) {
            const vis = candles.slice(-48);
            yMin = Math.min(...vis.map(c => c.low));
            yMax = Math.max(...vis.map(c => c.high));
        }
        const pricePad = Math.max(
            yMax - yMin,
            10 ** -prec
        ) * 0.06;

        const active = overlay?.activeContracts ?? [];
        const contractMarkers: SeriesMarker<Time>[] = [];
        for (const c of active) {
            contractMarkers.push(...buildContractBracketMarkers(c, nowSec));
        }

        const bracketContract = active.length ? active[active.length - 1] : null;
        const seg = bracketContract
            ? buildContractBracketLines(bracketContract, nowSec, pricePad)
            : { horizontal: [], entryGuide: [], endGuide: [] };

        const sortByTime = <T extends { time: Time }>(points: T[]): T[] =>
            [...points].sort((a, b) => Number(a.time) - Number(b.time));

        contractBracketSeriesRef.current?.setData(sortByTime(seg.horizontal));
        contractEntryGuideSeriesRef.current?.setData(sortByTime(seg.entryGuide));
        contractEndGuideSeriesRef.current?.setData(sortByTime(seg.endGuide));

        const settled = buildSettledTradeMarkers(overlay?.settledTrades ?? [], {
            win: winColor,
            lose: loseColor,
        });
        const allMarkers = [...contractMarkers, ...settled].sort(
            (a, b) => Number(a.time) - Number(b.time)
        );
        seriesMarkersRef.current?.setMarkers(allMarkers);

        return () => {
            clearLine(livePriceLineRef);
            clearLine(offsetPriceLineRef);
            contractBracketSeriesRef.current?.setData([]);
            contractEntryGuideSeriesRef.current?.setData([]);
            contractEndGuideSeriesRef.current?.setData([]);
        };
    }, [liveTick, overlay, uiTheme, symbol, contractClockSec]);

    useEffect(() => {
        const series = candleSeriesRef.current;
        if (!series) return;
        const prec = manualTraderResolveDigitTickDecimals(symbol);
        const minMove = prec <= 0 ? 1 : 10 ** -prec;
        const priceFormat = { type: 'price' as const, precision: prec, minMove };
        series.applyOptions({ priceFormat });
        maSeriesRef.current.forEach(ma => ma.applyOptions({ priceFormat }));
    }, [symbol]);

    useEffect(() => {
        if (!chartRef.current || !candleSeriesRef.current) return;
        const dark = uiTheme === 'dark';
        chartRef.current.applyOptions({
            layout: {
                background: { color: dark ? '#14181f' : '#ffffff' },
                textColor: dark ? '#94a3b8' : '#334155',
                attributionLogo: false,
            },
            rightPriceScale: { borderColor: dark ? '#2d3545' : '#cbd5e1', minimumWidth: 72 },
            timeScale: {
                borderColor: dark ? '#2d3545' : '#cbd5e1',
                tickMarkMaxCharacterLength: 8,
            },
        });
        applyChartRightGap();
        candleSeriesRef.current.applyOptions(
            dark
                ? {
                      upColor: '#34d399',
                      downColor: '#f87171',
                      wickUpColor: '#34d399',
                      wickDownColor: '#f87171',
                  }
                : {
                      upColor: '#16a34a',
                      downColor: '#dc2626',
                      wickUpColor: '#16a34a',
                      wickDownColor: '#dc2626',
                  }
        );
    }, [uiTheme, applyChartRightGap]);

    useEffect(() => {
        const candles = chartRollingCandlesRef.current;
        if (candles.length) syncChartIndicators(candles);
    }, [maEnabled, syncChartIndicators]);

    const forgetChartSubscription = useCallback(
        async (subscriptionId: string | null) => {
            await forgetDerivSubscription(visualTickApiRef.current, subscriptionId);
        },
        [visualTickApiRef]
    );

    useEffect(() => {
        const tickApi = visualTickApi;
        if (!tickApi || !visualTickReady || tickApi.connection.readyState !== 1) return;

        const streamOpId = ++chartStreamOpRef.current;
        const expected = symbol;
        const isActiveStream = () => chartStreamOpRef.current === streamOpId;

        subscribedChartSymbolRef.current = expected;
        chartHistoryReadyRef.current = false;
        resetCandles();
        setIsConnected(false);
        setChartHistoryLoading(true);
        setChartLoadMessage(`Loading chart (72h)…`);

        let historyApplied = false;
        let subscribeAttempts = 0;
        let failTimer: number | null = null;
        let lastLiveTickAt = Date.now();
        let recoverInFlight = false;

        const clearFailTimer = () => {
            if (failTimer !== null) {
                window.clearTimeout(failTimer);
                failTimer = null;
            }
        };

        const scheduleFailTimer = () => {
            clearFailTimer();
            failTimer = window.setTimeout(() => {
                if (!historyApplied && isActiveStream()) {
                    setChartHistoryLoading(true);
                    setChartLoadMessage('Could not load chart — try another market.');
                    setIsConnected(false);
                }
            }, CHART_LOAD_FAIL_MS);
        };
        scheduleFailTimer();

        const applyCandleHistoryOnce = (candles: CandlestickData[], chartRetry = 0): boolean => {
            if (historyApplied || !isActiveStream() || !candles.length) return false;
            if (!candleSeriesRef.current) {
                if (chartRetry < 40) {
                    window.setTimeout(() => applyCandleHistoryOnce(candles, chartRetry + 1), 50);
                }
                return false;
            }
            const trimmed = trimCandlesToChartWindow(candles);
            if (!trimmed.length) return false;

            chartRollingCandlesRef.current = trimmed;
            candleSeriesRef.current.setData(trimmed);
            currentCandleRef.current = trimmed[trimmed.length - 1];
            syncChartIndicatorsRef.current(trimmed);

            historyApplied = true;
            chartHistoryReadyRef.current = true;
            clearFailTimer();

            const last = trimmed[trimmed.length - 1];
            setLiveTick({ q: last.close, e: Number(last.time) });

            window.requestAnimationFrame(() => {
                const chart = chartRef.current;
                if (!chart) return;
                applyRiseFallChartVisibleRange(chart, trimmed);
                applyChartRightGap();
            });

            setChartHistoryLoading(false);
            setChartLoadMessage('');
            setIsConnected(true);
            return true;
        };

        const ensureLiveTicksAfterHistory = () => {
            if (!historyApplied || !isActiveStream() || subscribedChartSymbolRef.current !== expected) return;
            queueMicrotask(() => {
                if (isActiveStream() && subscribedChartSymbolRef.current === expected) {
                    void attachLiveTickStream();
                }
            });
        };

        const applyTickHistoryOnce = (prices: number[], times: number[], chartRetry = 0): boolean => {
            if (historyApplied || !isActiveStream() || !prices.length) return false;
            if (!candleSeriesRef.current) {
                if (chartRetry < 40) {
                    window.setTimeout(() => applyTickHistoryOnce(prices, times, chartRetry + 1), 50);
                }
                return false;
            }
            const trimmed = trimTicksToChartWindow(prices, times);
            if (!trimmed.prices.length) return false;

            const bucketSizeSec = CANDLE_SIZE_MIN * 60;
            const candles = buildMinuteCandlesFromTicks(trimmed.prices, trimmed.times, bucketSizeSec);
            return applyCandleHistoryOnce(candles);
        };

        const attachLiveTickStream = async (forceRecover = false) => {
            if (!tickApi || !isActiveStream() || recoverInFlight) return;
            recoverInFlight = true;
            try {
                const result = forceRecover
                    ? await recoverDerivLiveTickStream(tickApi, expected)
                    : await subscribeDerivLiveTicks(tickApi, expected);

                if (result.error && isAlreadySubscribedTickError(result.error)) {
                    const recovered = await recoverDerivLiveTickStream(tickApi, expected);
                    if (recovered.subscriptionId && isActiveStream()) {
                        chartSubscriptionIdRef.current = recovered.subscriptionId;
                        lastLiveTickAt = Date.now();
                        setIsConnected(true);
                    }
                    return;
                }

                if (result.subscriptionId && isActiveStream()) {
                    chartSubscriptionIdRef.current = result.subscriptionId;
                    lastLiveTickAt = Date.now();
                    setIsConnected(true);
                }
            } finally {
                recoverInFlight = false;
            }
        };

        const applyLiveTick = (quote: number, epoch: number) => {
            if (!chartHistoryReadyRef.current || !isActiveStream() || subscribedChartSymbolRef.current !== expected) {
                return;
            }

            lastLiveTickAt = Date.now();
            const epochSec = normalizeTickEpochSec(epoch);
            if (!Number.isFinite(quote) || !Number.isFinite(epochSec)) return;

            setLiveTick({ q: quote, e: epochSec });
            updateCandle(epochSec, quote);

            const bar = currentCandleRef.current;
            if (bar && chartRollingCandlesRef.current.length) {
                const rolling = chartRollingCandlesRef.current;
                const bucket = Math.floor(epochSec / (CANDLE_SIZE_MIN * 60)) * (CANDLE_SIZE_MIN * 60);
                const last = rolling[rolling.length - 1];
                if (last && Number(last.time) === bucket) {
                    rolling[rolling.length - 1] = bar;
                } else if (!last || Number(last.time) < bucket) {
                    rolling.push(bar);
                }
                const start = chartHistoryStartEpochSec();
                while (rolling.length && Number(rolling[0].time) < start) {
                    rolling.shift();
                }
                chartRollingCandlesRef.current = rolling;
                syncChartIndicatorsRef.current(rolling);
            }

            chartRef.current?.timeScale().scrollToRealTime();
        };

        const fetchCandleHistoryOnly = async (): Promise<CandlestickData[] | null> => {
            if (!tickApi) return null;

            const attempts: Record<string, unknown>[] = [
                buildChartCandlesHistoryReq(expected, 0),
                ...RISE_FALL_CANDLE_COUNT_FALLBACKS().map(count =>
                    buildChartCandlesHistoryReq(expected, 0, { count })
                ),
            ];

            for (const req of attempts) {
                if (!isActiveStream() || historyApplied) return null;
                try {
                    const resp = await tickApi.send(req);
                    if (!isActiveStream() || resp?.error) continue;
                    const candles = extractCandleHistoryPayload(resp);
                    if (candles?.length) return candles;
                } catch {
                    /* noop */
                }
            }
            return null;
        };

        const fetchChartHistoryOnly = async (): Promise<boolean> => {
            if (!tickApi || !isActiveStream() || historyApplied) return false;

            const candles = await fetchCandleHistoryOnly();
            if (candles?.length && applyCandleHistoryOnce(candles)) {
                ensureLiveTicksAfterHistory();
                return true;
            }

            try {
                const resp = await tickApi.send(
                    buildChartTicksHistoryReq(expected, 0, { count: 5000, end: 'latest' })
                );
                if (!resp?.error) {
                    const payload = extractTickHistoryPayload(resp);
                    if (payload && applyTickHistoryOnce(payload.prices, payload.times)) {
                        ensureLiveTicksAfterHistory();
                        return true;
                    }
                }
            } catch {
                /* noop */
            }

            return historyApplied;
        };

        const sub = tickApi.onMessage().subscribe(({ data }: { data: Record<string, unknown> }) => {
            if (!data || !isActiveStream()) return;

            if (!isActiveStream() || subscribedChartSymbolRef.current !== expected) return;

            if (data.error) {
                if (isAlreadySubscribedTickError(data.error)) {
                    void fetchChartHistoryOnly().then(ok => {
                        if (ok || historyApplied) chartHistoryReadyRef.current = true;
                        void attachLiveTickStream(true);
                    });
                }
                return;
            }

            if (data.msg_type === 'history') {
                const reqSym = data.echo_req?.ticks_history;
                if (reqSym && reqSym !== expected) return;

                const candlePayload = extractCandleHistoryPayload(data);
                if (candlePayload?.length) {
                    if (applyCandleHistoryOnce(candlePayload)) ensureLiveTicksAfterHistory();
                    return;
                }
                const tickPayload = extractTickHistoryPayload(data);
                if (tickPayload && applyTickHistoryOnce(tickPayload.prices, tickPayload.times)) {
                    ensureLiveTicksAfterHistory();
                }
                return;
            }

            if (data.msg_type === 'ohlc' && data.ohlc) {
                const ohlcSym = (data.ohlc as { symbol?: string }).symbol ?? data.echo_req?.ticks_history;
                if (ohlcSym && ohlcSym !== expected) return;
                if (!chartHistoryReadyRef.current) return;
                const ohlc = data.ohlc as Record<string, unknown>;
                const close = Number(ohlc.close);
                const epochSec = normalizeTickEpochSec(Number(ohlc.open_time ?? ohlc.epoch));
                if (Number.isFinite(close) && Number.isFinite(epochSec)) {
                    applyLiveTick(close, epochSec);
                }
                return;
            }

            if (data.msg_type === 'tick' && data.tick) {
                const tickSym = (data.tick as { symbol?: string }).symbol ?? data.echo_req?.ticks;
                if (tickSym && tickSym !== expected) return;
                const tick = data.tick as { quote?: number; epoch?: number };
                const quote = Number(tick.quote);
                const epoch = Number(tick.epoch);
                if (!Number.isFinite(quote) || !Number.isFinite(epoch)) return;
                if (!chartHistoryReadyRef.current) return;
                applyLiveTick(quote, epoch);
            }
        });

        const subscribeChart = async () => {
            if (chartSubscribeInFlightRef.current || historyApplied || !isActiveStream()) return;
            chartSubscribeInFlightRef.current = true;
            subscribeAttempts += 1;
            try {
                const prior = chartSubscriptionIdRef.current;
                chartSubscriptionIdRef.current = null;
                if (prior) await forgetChartSubscription(prior);
                if (!isActiveStream() || historyApplied) return;

                if (await fetchChartHistoryOnly()) return;

                let subscribed = false;

                const tickPlotReq = buildChartTicksHistoryReq(expected, 1, { plotWindow: true });
                try {
                    const resp = await tickApi.send(tickPlotReq);
                    if (!isActiveStream()) return;

                    if (resp?.error && isAlreadySubscribedTickError(resp.error)) {
                        const ok = await fetchChartHistoryOnly();
                        if (ok || historyApplied) ensureLiveTicksAfterHistory();
                        else await attachLiveTickStream(true);
                        return;
                    }

                    if (!resp?.error) {
                        const newSubId = resp?.subscription?.id ? String(resp.subscription.id) : null;
                        chartSubscriptionIdRef.current = newSubId;
                        subscribed = Boolean(newSubId);

                        const tickPayload = extractTickHistoryPayload(resp);
                        if (tickPayload && applyTickHistoryOnce(tickPayload.prices, tickPayload.times)) {
                            ensureLiveTicksAfterHistory();
                            return;
                        }

                        const candlePayload = extractCandleHistoryPayload(resp);
                        if (candlePayload?.length && applyCandleHistoryOnce(candlePayload)) {
                            ensureLiveTicksAfterHistory();
                            return;
                        }

                        if (newSubId) return;
                    }
                } catch (err) {
                    if (isAlreadySubscribedTickError(err)) {
                        const ok = await fetchChartHistoryOnly();
                        if (ok || historyApplied) ensureLiveTicksAfterHistory();
                        else await attachLiveTickStream(true);
                        return;
                    }
                }

                if (historyApplied) return;

                const candleReq = buildChartCandlesHistoryReq(expected, subscribed ? 0 : 1);
                try {
                    const resp = await tickApi.send(candleReq);
                    if (!isActiveStream()) return;

                    if (resp?.error && isAlreadySubscribedTickError(resp.error)) {
                        const ok = await fetchChartHistoryOnly();
                        if (ok || historyApplied) ensureLiveTicksAfterHistory();
                        else await attachLiveTickStream(true);
                        return;
                    }

                    if (!resp?.error) {
                        if (!subscribed) {
                            const newSubId = resp?.subscription?.id ? String(resp.subscription.id) : null;
                            chartSubscriptionIdRef.current = newSubId;
                            subscribed = Boolean(newSubId);
                        }
                        const candlePayload = extractCandleHistoryPayload(resp);
                        if (candlePayload?.length && applyCandleHistoryOnce(candlePayload)) {
                            ensureLiveTicksAfterHistory();
                            return;
                        }
                        if (subscribed && !historyApplied) return;
                    }
                } catch (err) {
                    if (isAlreadySubscribedTickError(err)) {
                        const ok = await fetchChartHistoryOnly();
                        if (ok || historyApplied) ensureLiveTicksAfterHistory();
                        else await attachLiveTickStream(true);
                        return;
                    }
                }

                if (!historyApplied) {
                    const ok = await fetchChartHistoryOnly();
                    if (ok || historyApplied) ensureLiveTicksAfterHistory();
                }

                if (!historyApplied && subscribeAttempts < CHART_SUBSCRIBE_MAX_ATTEMPTS) {
                    window.setTimeout(() => void subscribeChart(), 800);
                }
            } finally {
                chartSubscribeInFlightRef.current = false;
            }
        };

        void subscribeChart();

        const retryTimer = window.setTimeout(() => {
            if (!historyApplied && isActiveStream() && subscribeAttempts < CHART_SUBSCRIBE_MAX_ATTEMPTS) {
                void subscribeChart();
            }
        }, CHART_LOAD_RETRY_MS);

        const tickWatchTimer = window.setInterval(() => {
            if (!isActiveStream() || !historyApplied || chartSubscribeInFlightRef.current || recoverInFlight) {
                return;
            }
            if (Date.now() - lastLiveTickAt < CHART_TICK_STALL_RECOVER_MS) return;
            void attachLiveTickStream(true);
        }, CHART_TICK_WATCH_INTERVAL_MS);

        return () => {
            window.clearTimeout(retryTimer);
            window.clearInterval(tickWatchTimer);
            clearFailTimer();
            sub.unsubscribe();
            subscribedChartSymbolRef.current = null;
            chartSubscribeInFlightRef.current = false;
            chartHistoryReadyRef.current = false;
            const subId = chartSubscriptionIdRef.current;
            chartSubscriptionIdRef.current = null;
            void forgetChartSubscription(subId);
        };
    }, [
        symbol,
        visualTickApi,
        visualTickReady,
        resetCandles,
        updateCandle,
        forgetChartSubscription,
    ]);

    return {
        chartWrapRef,
        isConnected,
        chartHistoryLoading,
        chartLoadMessage,
        liveTick,
        maEnabled,
        setMaEnabled,
        chartIndicatorsExpanded,
        setChartIndicatorsExpanded,
    };
}
