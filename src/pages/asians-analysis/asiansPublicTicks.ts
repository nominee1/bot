import { extractTicksHistoryPrices } from '@/pages/aaaDigitBarReady/digitBarMarketScanner';
import { buildDerivTickWsUrl, createDerivRawTickClient, type DerivRawTickClient } from '@/utils/derivRawTickSocket';

const OPEN_TIMEOUT_MS = 10_000;

function waitForOpen(ws: WebSocket, timeoutMs = OPEN_TIMEOUT_MS): Promise<void> {
    if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('tick ws open timeout')), timeoutMs);
        ws.addEventListener(
            'open',
            () => {
                window.clearTimeout(timer);
                resolve();
            },
            { once: true }
        );
        ws.addEventListener(
            'error',
            () => {
                window.clearTimeout(timer);
                reject(new Error('tick ws open failed'));
            },
            { once: true }
        );
    });
}

/**
 * Dedicated public market-data socket (no authorize) for Path Lab scans.
 * Uses the same V3 endpoint as the rest of Denarabot.
 */
export class AsiansPublicTicksClient {
    private socket: WebSocket | null = null;
    private client: DerivRawTickClient | null = null;

    async connect(): Promise<void> {
        if (this.client && this.socket?.readyState === WebSocket.OPEN) return;
        this.close();
        this.socket = new WebSocket(buildDerivTickWsUrl());
        await waitForOpen(this.socket);
        this.client = createDerivRawTickClient(this.socket);
    }

    async fetchHistory(symbol: string, count: number): Promise<number[]> {
        await this.connect();
        if (!this.client) throw new Error('tick client not ready');
        // Do not send subscribe:0 — V3 rejects it ("Input validation failed: subscribe").
        const hist = await this.client.send({
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

    close(): void {
        try {
            this.client?.disconnect();
        } catch {
            /* noop */
        }
        this.client = null;
        this.socket = null;
    }
}
