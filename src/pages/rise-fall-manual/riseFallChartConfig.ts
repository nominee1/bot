import type { CandlestickData, IChartApi, UTCTimestamp } from 'lightweight-charts';

/** Rolling chart window: 72 hours of 1-minute candles (full history loaded). */
export const RISE_FALL_CHART_WINDOW_SEC = 72 * 60 * 60;
/** Default viewport: recent 42h visible; pan/zoom to see the rest of the 72h series. */
export const RISE_FALL_CHART_INITIAL_VISIBLE_SEC = 42 * 60 * 60;
export const RISE_FALL_CANDLE_GRANULARITY_SEC = 60;
export const RISE_FALL_CANDLES_PER_WINDOW = 72 * 60;
export const RISE_FALL_CANDLE_COUNT_FALLBACKS = (): number[] => [
    RISE_FALL_CANDLES_PER_WINDOW,
    4320,
    3600,
    2880,
    1440,
];

export const chartHistoryStartEpochSec = () => Math.floor(Date.now() / 1000) - RISE_FALL_CHART_WINDOW_SEC;

/** Zoom viewport to the latest N hours while keeping older candles loaded for scroll-back. */
export function applyRiseFallChartVisibleRange(chart: IChartApi, candles: CandlestickData[]): void {
    if (!candles.length) return;
    const lastTime = Number(candles[candles.length - 1].time);
    const firstTime = Number(candles[0].time);
    if (!Number.isFinite(lastTime) || !Number.isFinite(firstTime)) return;

    const from = Math.max(firstTime, lastTime - RISE_FALL_CHART_INITIAL_VISIBLE_SEC);
    chart.timeScale().setVisibleRange({
        from: from as UTCTimestamp,
        to: lastTime as UTCTimestamp,
    });
}

export const isOneSecondVolatilitySymbol = (symbol: string) => /^1HZ\d+V$/i.test(symbol);

export const normalizeTickEpochSec = (epoch: number): number => {
    if (!Number.isFinite(epoch)) return NaN;
    if (epoch > 1e12) return Math.floor(epoch / 1000);
    return Math.floor(epoch);
};

export const extractTickHistoryPayload = (data: unknown): { prices: number[]; times: number[] } | null => {
    if (!data || typeof data !== 'object') return null;
    const root = data as { error?: unknown; history?: { prices?: unknown; times?: unknown } };
    if (root.error) return null;
    const hist = root.history;
    if (!hist || !Array.isArray(hist.prices) || !hist.prices.length) return null;
    if (!Array.isArray(hist.times) || hist.times.length !== hist.prices.length) return null;

    const prices: number[] = [];
    const times: number[] = [];
    for (let i = 0; i < hist.prices.length; i++) {
        const p = Number(hist.prices[i]);
        const t = Number(hist.times[i]);
        if (Number.isFinite(p) && Number.isFinite(t)) {
            prices.push(p);
            times.push(t);
        }
    }
    return prices.length ? { prices, times } : null;
};

export const trimTicksToChartWindow = (prices: number[], times: number[]): { prices: number[]; times: number[] } => {
    const start = chartHistoryStartEpochSec();
    const outP: number[] = [];
    const outT: number[] = [];
    for (let i = 0; i < prices.length; i++) {
        const ep = normalizeTickEpochSec(Number(times[i]));
        const q = Number(prices[i]);
        if (Number.isFinite(q) && Number.isFinite(ep) && ep >= start) {
            outP.push(q);
            outT.push(ep);
        }
    }
    if (outP.length) return { prices: outP, times: outT };
    return { prices, times };
};

export const buildChartTicksHistoryReq = (
    symbol: string,
    subscribe: 0 | 1,
    opts?: { count?: number; end?: number | 'latest'; plotWindow?: boolean }
): Record<string, unknown> => {
    if (opts?.plotWindow) {
        const req: Record<string, unknown> = {
            ticks_history: symbol,
            style: 'ticks',
            start: chartHistoryStartEpochSec(),
            end: 'latest',
            count: opts.count ?? 50000,
            subscribe,
        };
        if (!isOneSecondVolatilitySymbol(symbol)) {
            req.adjust_start_time = 1;
        }
        return req;
    }

    const req: Record<string, unknown> = {
        ticks_history: symbol,
        style: 'ticks',
        count: opts?.count ?? 5000,
        end: opts?.end ?? 'latest',
        subscribe,
    };
    if (!isOneSecondVolatilitySymbol(symbol)) {
        req.adjust_start_time = 1;
    }
    return req;
};

export const buildChartCandlesHistoryReq = (
    symbol: string,
    subscribe: 0 | 1,
    opts?: { count?: number }
): Record<string, unknown> => {
    if (opts?.count != null) {
        return {
            ticks_history: symbol,
            style: 'candles',
            granularity: RISE_FALL_CANDLE_GRANULARITY_SEC,
            count: opts.count,
            end: 'latest',
            subscribe,
        };
    }
    return {
        ticks_history: symbol,
        style: 'candles',
        granularity: RISE_FALL_CANDLE_GRANULARITY_SEC,
        start: chartHistoryStartEpochSec(),
        end: 'latest',
        subscribe,
    };
};

export const extractCandleHistoryPayload = (data: unknown): CandlestickData[] | null => {
    if (!data || typeof data !== 'object') return null;
    const root = data as {
        error?: unknown;
        candles?: Array<Record<string, unknown>>;
        history?: { candles?: Array<Record<string, unknown>> };
    };
    if (root.error) return null;
    const raw = root.candles ?? root.history?.candles;
    if (!Array.isArray(raw) || !raw.length) return null;

    const out: CandlestickData[] = [];
    for (const c of raw) {
        const epoch = normalizeTickEpochSec(Number(c.open_time ?? c.epoch));
        const open = Number(c.open);
        const high = Number(c.high);
        const low = Number(c.low);
        const close = Number(c.close);
        if (![open, high, low, close, epoch].every(Number.isFinite)) continue;
        out.push({ time: epoch as UTCTimestamp, open, high, low, close });
    }
    return out.length ? out : null;
};

export const trimCandlesToChartWindow = (candles: CandlestickData[]): CandlestickData[] => {
    const start = chartHistoryStartEpochSec();
    const trimmed = candles.filter(c => Number(c.time) >= start);
    return trimmed.length ? trimmed : candles;
};

export const buildMinuteCandlesFromTicks = (
    prices: number[],
    times: number[],
    bucketSizeSec: number
): CandlestickData[] => {
    const candles: CandlestickData[] = [];
    let cur: CandlestickData | null = null;

    for (let i = 0; i < prices.length; i++) {
        const quote = Number(prices[i]);
        const epoch = normalizeTickEpochSec(Number(times[i]));
        if (!Number.isFinite(quote) || !Number.isFinite(epoch)) continue;

        const bucket = Math.floor(epoch / bucketSizeSec) * bucketSizeSec;
        if (!cur || Number(cur.time) !== bucket) {
            if (cur) candles.push(cur);
            cur = {
                time: bucket as UTCTimestamp,
                open: quote,
                high: quote,
                low: quote,
                close: quote,
            };
        } else {
            cur.high = Math.max(cur.high, quote);
            cur.low = Math.min(cur.low, quote);
            cur.close = quote;
        }
    }
    if (cur) candles.push(cur);
    return candles;
};
