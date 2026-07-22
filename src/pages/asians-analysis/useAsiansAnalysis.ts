import { useCallback, useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { extractTicksHistoryPrices } from '@/pages/aaaDigitBarReady/digitBarMarketScanner';
import {
    ASIANS_HISTORY_TICK_COUNT,
    ASIANS_SCAN_SYMBOLS,
    getContractDef,
    type TAsiansContractId,
    type TAsiansSide,
} from './asiansContractCatalog';
import { AsiansPublicTicksClient } from './asiansPublicTicks';
import { analyzeAsiansMarket, type TAsiansMarketScore } from './asiansTickAnalysis';

const SCAN_GAP_MS = 80;
const REFRESH_MS = 45_000;
const API_REPLY_TIMEOUT_MS = 12_000;

type TickSend = (payload: Record<string, unknown>) => Promise<unknown>;

async function sendWithTimeout(send: TickSend, payload: Record<string, unknown>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            send(payload),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('timeout')), API_REPLY_TIMEOUT_MS);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchViaSessionApi(symbol: string, count: number): Promise<number[]> {
    if (!api_base.api || api_base.api.connection?.readyState !== 1) {
        await api_base.init(true);
    }
    const send = api_base.api?.send?.bind(api_base.api) as TickSend | undefined;
    if (!send || api_base.api?.connection?.readyState !== 1) {
        throw new Error('session ws not ready');
    }
    const hist = await sendWithTimeout(send, {
        ticks_history: symbol,
        style: 'ticks',
        count,
        end: 'latest',
        adjust_start_time: 1,
    });
    const prices = extractTicksHistoryPrices(hist);
    if (!prices.length) {
        const err = (hist as { error?: { message?: string } })?.error?.message;
        throw new Error(err || `no ticks for ${symbol}`);
    }
    return prices;
}

export type TAsiansAnalysisState = {
    scanning: boolean;
    rows: TAsiansMarketScore[];
    progress: { done: number; total: number; symbol: string | null };
    error: string | null;
    updatedAt: string | null;
    source: 'public' | 'session' | null;
};

export function useAsiansAnalysis(
    active: boolean,
    contractId: TAsiansContractId,
    side: TAsiansSide,
    durationTicks: number
) {
    const [state, setState] = useState<TAsiansAnalysisState>({
        scanning: false,
        rows: [],
        progress: { done: 0, total: ASIANS_SCAN_SYMBOLS.length, symbol: null },
        error: null,
        updatedAt: null,
        source: null,
    });
    const abortRef = useRef(0);
    const def = getContractDef(contractId);

    const runScan = useCallback(async () => {
        const token = ++abortRef.current;
        const duration = Math.max(2, durationTicks || def.defaultDurationTicks);
        const publicClient = new AsiansPublicTicksClient();
        let source: 'public' | 'session' = 'public';
        let publicOk = false;

        setState(prev => ({
            ...prev,
            scanning: true,
            error: null,
            rows: [],
            progress: { done: 0, total: ASIANS_SCAN_SYMBOLS.length, symbol: ASIANS_SCAN_SYMBOLS[0] },
        }));

        try {
            await publicClient.connect();
            publicOk = true;
        } catch {
            source = 'session';
        }

        const rows: TAsiansMarketScore[] = [];
        let failures = 0;
        let lastFail = '';

        for (let i = 0; i < ASIANS_SCAN_SYMBOLS.length; i += 1) {
            if (abortRef.current !== token) {
                publicClient.close();
                return;
            }
            const symbol = ASIANS_SCAN_SYMBOLS[i];
            setState(prev => ({
                ...prev,
                progress: { done: i, total: ASIANS_SCAN_SYMBOLS.length, symbol },
            }));

            try {
                let prices: number[] = [];
                if (publicOk) {
                    try {
                        prices = await publicClient.fetchHistory(symbol, ASIANS_HISTORY_TICK_COUNT);
                        source = 'public';
                    } catch (err) {
                        prices = await fetchViaSessionApi(symbol, ASIANS_HISTORY_TICK_COUNT);
                        source = 'session';
                        lastFail = err instanceof Error ? err.message : 'public fetch failed';
                    }
                } else {
                    prices = await fetchViaSessionApi(symbol, ASIANS_HISTORY_TICK_COUNT);
                    source = 'session';
                }

                if (prices.length >= duration + 2) {
                    rows.push(analyzeAsiansMarket(symbol, prices, contractId, side, duration));
                    rows.sort((a, b) => b.score - a.score);
                    if (abortRef.current === token) {
                        setState(prev => ({
                            ...prev,
                            rows: [...rows],
                            source,
                            progress: { done: i + 1, total: ASIANS_SCAN_SYMBOLS.length, symbol },
                        }));
                    }
                } else {
                    failures += 1;
                    lastFail = `${symbol}: only ${prices.length} ticks`;
                }
            } catch (err) {
                failures += 1;
                lastFail = err instanceof Error ? err.message : String(err);
            }

            if (i < ASIANS_SCAN_SYMBOLS.length - 1 && abortRef.current === token) {
                await sleep(SCAN_GAP_MS);
            }
        }

        publicClient.close();
        if (abortRef.current !== token) return;

        rows.sort((a, b) => b.score - a.score);
        setState({
            scanning: false,
            rows,
            progress: { done: ASIANS_SCAN_SYMBOLS.length, total: ASIANS_SCAN_SYMBOLS.length, symbol: null },
            error: rows.length
                ? null
                : `No market readings (${failures}/${ASIANS_SCAN_SYMBOLS.length} failed${lastFail ? `: ${lastFail}` : ''}). Tap Refresh.`,
            updatedAt: new Date().toISOString(),
            source,
        });
    }, [contractId, side, durationTicks, def.defaultDurationTicks]);

    useEffect(() => {
        if (!active) {
            abortRef.current += 1;
            return undefined;
        }
        runScan();
        const id = window.setInterval(runScan, REFRESH_MS);
        return () => {
            abortRef.current += 1;
            window.clearInterval(id);
        };
    }, [active, runScan]);

    return { ...state, refresh: runScan, contractDef: def };
}
