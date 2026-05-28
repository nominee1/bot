import type { LineData, SeriesMarker, Time, UTCTimestamp } from 'lightweight-charts';
import { computeLiveBarrierFromOffset } from './riseFallBarrierUtils';

export type RiseFallActiveContract = {
    id: string;
    tradeMode: 'rise_fall' | 'higher_lower';
    contractType: string;
    durationMin: number;
    entryEpoch?: number;
    entryPrice?: number;
    strike?: number;
    expiryEpoch?: number;
    purchaseEpoch?: number;
    barrierOffset?: string;
};

function toUtc(sec: number): UTCTimestamp {
    return Math.floor(sec) as UTCTimestamp;
}

/** Ensures chart line times are strictly ascending (live tick can trail purchase/entry by 1s). */
export function normalizeBracketSpan(
    t0: number,
    nowSec: number,
    tExpiry: number
): { tStart: number; tEnd: number } | null {
    const tStart = Math.floor(t0);
    const expiry = Math.floor(tExpiry);
    const now = Math.floor(nowSec);
    if (!Number.isFinite(tStart) || !Number.isFinite(expiry) || expiry < tStart) {
        return null;
    }

    let tEnd = Math.min(Math.max(now, tStart), expiry);
    if (tEnd <= tStart) {
        tEnd = Math.min(tStart + 1, expiry);
    }
    if (tEnd <= tStart) return null;

    return { tStart, tEnd };
}

export function resolveContractExpiryEpoch(c: RiseFallActiveContract, nowSec: number): number | null {
    if (c.expiryEpoch != null && Number.isFinite(c.expiryEpoch)) return Math.floor(c.expiryEpoch);
    if (c.entryEpoch != null && Number.isFinite(c.entryEpoch)) {
        return Math.floor(c.entryEpoch) + Math.max(1, c.durationMin) * 60;
    }
    return nowSec + Math.max(1, c.durationMin) * 60;
}

export function resolveContractStartEpoch(c: RiseFallActiveContract, nowSec: number): number {
    if (c.entryEpoch != null && Number.isFinite(c.entryEpoch)) return Math.floor(c.entryEpoch);
    if (c.purchaseEpoch != null && Number.isFinite(c.purchaseEpoch)) return Math.floor(c.purchaseEpoch);
    return nowSec;
}

export function resolveBracketPrice(
    c: RiseFallActiveContract,
    liveQuote?: number
): number | null {
    if (c.tradeMode === 'higher_lower') {
        if (c.strike != null && Number.isFinite(c.strike)) return c.strike;
        if (
            liveQuote != null &&
            Number.isFinite(liveQuote) &&
            c.barrierOffset &&
            c.entryEpoch == null
        ) {
            return computeLiveBarrierFromOffset(liveQuote, c.barrierOffset);
        }
        if (c.entryPrice != null && Number.isFinite(c.entryPrice)) return c.entryPrice;
        return null;
    }
    if (c.entryPrice != null && Number.isFinite(c.entryPrice)) return c.entryPrice;
    return null;
}

/** Horizontal bracket + vertical guides for one active contract. */
export function buildContractBracketLines(
    c: RiseFallActiveContract,
    nowSec: number,
    pricePad: number
): { horizontal: LineData<Time>[]; entryGuide: LineData<Time>[]; endGuide: LineData<Time>[] } {
    const t0 = resolveContractStartEpoch(c, nowSec);
    const tExpiry = resolveContractExpiryEpoch(c, nowSec);
    if (tExpiry == null) return { horizontal: [], entryGuide: [], endGuide: [] };

    const span = normalizeBracketSpan(t0, nowSec, tExpiry);
    const price = resolveBracketPrice(c);
    if (span == null || price == null || !Number.isFinite(price)) {
        return { horizontal: [], entryGuide: [], endGuide: [] };
    }

    const pad = Math.max(pricePad, 1e-9);
    const { tStart, tEnd } = span;

    return {
        horizontal: [
            { time: toUtc(tStart), value: price },
            { time: toUtc(tEnd), value: price },
        ],
        /* Vertical guides need distinct times — same-second pairs crash lightweight-charts. */
        entryGuide: [
            { time: toUtc(tStart), value: price - pad },
            { time: toUtc(tStart + 1), value: price + pad },
        ],
        endGuide: [
            { time: toUtc(tEnd - 1), value: price - pad },
            { time: toUtc(tEnd), value: price + pad },
        ],
    };
}

export function buildContractBracketMarkers(
    c: RiseFallActiveContract,
    nowSec: number
): SeriesMarker<Time>[] {
    const t0 = resolveContractStartEpoch(c, nowSec);
    const tExpiry = resolveContractExpiryEpoch(c, nowSec);
    if (tExpiry == null) return [];

    const span = normalizeBracketSpan(t0, nowSec, tExpiry);
    if (span == null) return [];
    const { tStart, tEnd } = span;
    const entry = c.entryPrice;
    const price = resolveBracketPrice(c);
    const markers: SeriesMarker<Time>[] = [];

    if (entry != null && Number.isFinite(entry)) {
        markers.push({
            id: `${c.id}-entry`,
            time: toUtc(tStart),
            position: 'aboveBar',
            shape: 'arrowUp',
            color: '#22c55e',
            price: entry,
            size: 0.5,
        });
    }

    if (price != null && Number.isFinite(price)) {
        markers.push({
            id: `${c.id}-end`,
            time: toUtc(tEnd),
            position: 'aboveBar',
            shape: 'square',
            color: '#22c55e',
            price,
            size: 0.45,
        });
    }

    return markers;
}

export function buildSettledTradeMarkers(
    trades: Array<{
        id: string;
        status: string;
        entryEpoch?: number;
        exitEpoch?: number;
        entryPrice?: number;
        exitPrice?: number;
    }>,
    colors: { win: string; lose: string }
): SeriesMarker<Time>[] {
    const out: SeriesMarker<Time>[] = [];
    trades
        .filter(t => (t.status === 'won' || t.status === 'lost') && t.exitEpoch != null)
        .forEach(t => {
            const won = t.status === 'won';
            const time = Math.floor(Number(t.exitEpoch)) as UTCTimestamp;
            if (won && t.entryEpoch != null && t.entryPrice != null) {
                out.push({
                    id: t.id,
                    time: Math.floor(Number(t.entryEpoch)) as UTCTimestamp,
                    position: 'belowBar',
                    shape: 'arrowUp',
                    color: colors.win,
                    price: t.entryPrice,
                    size: 0.42,
                });
                return;
            }
            out.push({
                id: t.id,
                time,
                position: won ? 'belowBar' : 'aboveBar',
                shape: won ? 'arrowUp' : 'arrowDown',
                color: won ? colors.win : colors.lose,
                price: t.exitPrice,
                size: 0.4,
            });
        });
    return out;
}
