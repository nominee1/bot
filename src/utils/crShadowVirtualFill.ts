import { buildDerivSessionProposalPayload } from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import { api_base } from '@/external/bot-skeleton';
import { scheduleCrChanceLedgerRoundTrip } from '@/utils/chanceVirtualStatements';
import { isCrVirtualShadowLogin, runWithCrShadowLock, tryDebitCrShadowSync } from '@/utils/crVirtualBalanceShadow';
import {
    decideFlipVirtualPair,
    type FlipVirtStrategyType,
    MAX_SESSION_LOSSES,
    ONLY_RUN_MAX_CONSECUTIVE_LOSSES,
    updateAfterFactGovernor,
    type VirtFlipDecisionRefs,
    type VirtTick,
} from '@/utils/flipaaVirtualDecision';

/**
 * Wallet loginid for CR shadow virtual fills — same resolution as Manual Trader.
 * auth activeLoginid → MobX client.loginid → WS session → stored active_loginid.
 */
export function resolveCrShadowWalletLoginid(activeLoginid?: string | null, clientLoginid?: string | null): string {
    for (const raw of [activeLoginid, clientLoginid]) {
        const id = String(raw ?? '').trim();
        if (id) return id;
    }
    try {
        const fromApi = String(api_base?.account_info?.loginid ?? '').trim();
        if (fromApi) return fromApi;
    } catch {
        /* ignore */
    }
    try {
        const stored = String(localStorage.getItem('active_loginid') ?? '').trim();
        if (stored) return stored;
    } catch {
        /* ignore */
    }
    return '';
}

/** CR7557018 / ROT90381442 — shadow-ledger fills; never profit=0 simulated virtual hooks. */
export const shouldUseCrShadowLiveFills = (activeLoginid?: string | null, clientLoginid?: string | null): boolean =>
    isCrVirtualShadowLogin(resolveCrShadowWalletLoginid(activeLoginid, clientLoginid));

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

const STRATEGY_KEYS: FlipVirtStrategyType[] = [
    'even',
    'odd',
    'over',
    'under',
    'matches',
    'differs',
    'rise',
    'fall',
    'only_up',
    'only_down',
    'rise_equals',
    'fall_equals',
    'high',
    'low',
];

const contractForStrategy = (st: FlipVirtStrategyType): string => {
    switch (st) {
        case 'even':
            return 'DIGITEVEN';
        case 'odd':
            return 'DIGITODD';
        case 'over':
            return 'DIGITOVER';
        case 'under':
            return 'DIGITUNDER';
        case 'matches':
            return 'DIGITMATCH';
        case 'differs':
            return 'DIGITDIFF';
        case 'rise':
            return 'CALL';
        case 'fall':
            return 'PUT';
        case 'only_up':
            return 'RUNHIGH';
        case 'only_down':
            return 'RUNLOW';
        case 'rise_equals':
            return 'CALLE';
        case 'fall_equals':
            return 'PUTE';
        case 'high':
            return 'TICKHIGH';
        case 'low':
            return 'TICKLOW';
        default:
            return '';
    }
};

export const CONTRACT_TO_FLIP_STRATEGY: Record<string, FlipVirtStrategyType> = STRATEGY_KEYS.reduce(
    (acc, sk) => {
        const ct = contractForStrategy(sk);
        if (ct) acc[ct] = sk;
        return acc;
    },
    {} as Record<string, FlipVirtStrategyType>
);

/** Rise/fall-style contracts show different entry vs exit; digit contracts show one settlement spot. */
export function isDirectionalVirtStrategy(st: FlipVirtStrategyType): boolean {
    return (
        st === 'rise' ||
        st === 'fall' ||
        st === 'rise_equals' ||
        st === 'fall_equals' ||
        st === 'only_up' ||
        st === 'only_down' ||
        st === 'high' ||
        st === 'low'
    );
}

export function normalizeVirtDisplayTicks(
    st: FlipVirtStrategyType,
    entry: VirtTick,
    exit: VirtTick,
    duration = 1
): { entry: VirtTick; exit: VirtTick } {
    if (isDirectionalVirtStrategy(st)) {
        return { entry, exit };
    }
    // Flipaa digit Matches/etc: 1-tick paints the settlement spot on both; longer duration keeps entry vs exit.
    if (Math.max(1, Number(duration) || 1) === 1) {
        return { entry: exit, exit };
    }
    return { entry, exit };
}

export type CrShadowVirtFillRefs = VirtFlipDecisionRefs & {
    sessionLossesVirtRef: { current: number };
    onlyRunLossStreakVirtRef: { current: Record<'only_up' | 'only_down', number> };
};

export type CrShadowVirtFillResult = {
    virtId: string;
    net: number;
    ask: number;
    payout: number;
    win: boolean;
    entry: VirtTick;
    exit: VirtTick;
    /** From Deriv proposal — used for journal Bought: … lines. */
    longcode?: string;
    shortcode?: string;
};

export type CrShadowVirtWsHandle = {
    close: () => void;
};

/** Open a dedicated Deriv tick stream for CR shadow fills. */
export function openCrShadowVirtTickWs(
    symbol: string,
    bufferRef: { current: VirtTick[] },
    epochRef: { current: number | null },
    marketRef: { current: string },
    wsRef: { current: WebSocket | null },
    isActive: () => boolean = () => true
): CrShadowVirtWsHandle {
    try {
        wsRef.current?.close();
    } catch {
        /* ignore */
    }
    wsRef.current = null;
    bufferRef.current = [];
    marketRef.current = symbol;
    epochRef.current = null;

    const ws = new WebSocket(`wss://api.derivws.com/trading/v1/options/ws/public`);
    wsRef.current = ws;

    ws.onopen = async () => {
        try {
            const seed = await api_base.api?.send({
                ticks_history: symbol,
                count: 2,
                end: 'latest',
                start: 1,
                adjust_start_time: 1,
            });
            if (seed?.history?.prices?.length && seed?.history?.times?.length) {
                const prices = seed.history.prices.map(Number);
                const times = seed.history.times.map(Number);
                for (let i = 0; i < prices.length; i++) {
                    bufferRef.current.push({ epoch: times[i], quote: prices[i] });
                }
                epochRef.current = times[times.length - 1] ?? null;
            }
        } catch {
            /* ignore */
        }
        try {
            ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        } catch {
            /* ignore */
        }
    };

    ws.onmessage = (evt: MessageEvent) => {
        if (!isActive()) return;
        try {
            const d = JSON.parse(evt.data);
            if (d?.error || !d?.tick?.quote || !d?.tick?.epoch) return;
            const q = Number(d.tick.quote);
            const ep = Number(d.tick.epoch);
            if (epochRef.current === ep) return;
            epochRef.current = ep;
            bufferRef.current.push({ epoch: ep, quote: q });
            const buf = bufferRef.current;
            if (buf.length > 600) buf.splice(0, buf.length - 600);
        } catch {
            /* ignore */
        }
    };
    ws.onerror = () => {};
    ws.onclose = () => {};

    return {
        close: () => {
            try {
                ws.onopen = null;
                ws.onmessage = null;
                ws.onerror = null;
                ws.onclose = null;
                ws.close();
            } catch {
                /* ignore */
            }
            if (wsRef.current === ws) wsRef.current = null;
        },
    };
}

/** Seed tick buffer from authenticated Deriv API (same path Manual Trader uses). */
async function seedCrShadowVirtTickBufferFromApi(
    symbol: string,
    bufferRef: { current: VirtTick[] },
    epochRef: { current: number | null },
    marketRef: { current: string }
): Promise<boolean> {
    try {
        const OPEN = 1 as const;
        if (!api_base.api || api_base.api.connection.readyState !== OPEN) {
            await api_base.init(true);
        }
        const seed = await api_base.api!.send({
            ticks_history: symbol,
            count: 2,
            end: 'latest',
            start: 1,
            adjust_start_time: 1,
        });
        if (!seed?.history?.prices?.length || !seed?.history?.times?.length) return false;
        const prices = seed.history.prices.map(Number);
        const times = seed.history.times.map(Number);
        bufferRef.current = [];
        for (let i = 0; i < prices.length; i++) {
            bufferRef.current.push({ epoch: times[i], quote: prices[i] });
        }
        epochRef.current = times[times.length - 1] ?? null;
        marketRef.current = symbol;
        return bufferRef.current.length >= 2;
    } catch {
        return false;
    }
}

export async function ensureCrShadowVirtTickBuffer(
    symbol: string,
    bufferRef: { current: VirtTick[] },
    epochRef: { current: number | null },
    marketRef: { current: string },
    wsRef: { current: WebSocket | null },
    isActive: () => boolean = () => true,
    timeoutMs = 10000
): Promise<void> {
    const wsDead =
        !wsRef.current ||
        wsRef.current.readyState === WebSocket.CLOSING ||
        wsRef.current.readyState === WebSocket.CLOSED;
    const marketChanged = marketRef.current !== symbol;

    // Always keep a live tick WS — after-fact needs fresh ticks during MATCH_WAIT_MS.
    // Seeding alone is not enough (stale history → permanent natural losses).
    if (marketChanged || wsDead) {
        openCrShadowVirtTickWs(symbol, bufferRef, epochRef, marketRef, wsRef, isActive);
    }

    if (bufferRef.current.length < 2) {
        await seedCrShadowVirtTickBufferFromApi(symbol, bufferRef, epochRef, marketRef);
    }

    const wsLive =
        !!wsRef.current &&
        (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN);

    // Live stream already up and buffer warm — ready for after-fact.
    if (wsLive && bufferRef.current.length >= 2 && !marketChanged) {
        return;
    }

    const t0 = Date.now();
    let retriedSeed = false;
    while (Date.now() - t0 < timeoutMs) {
        if (bufferRef.current.length >= 2) return;
        if (!retriedSeed && Date.now() - t0 > 400) {
            retriedSeed = true;
            await seedCrShadowVirtTickBufferFromApi(symbol, bufferRef, epochRef, marketRef);
        }
        await sleep(25);
    }
    if (bufferRef.current.length >= 2) return;
    throw new Error('virtual-tick-timeout');
}

export async function executeCrShadowVirtualFill(args: {
    client: { loginid?: string; all_accounts_balance?: { accounts?: Record<string, { balance?: number }> } };
    walletLoginId: string;
    contractType: string;
    stake: number;
    market: string;
    duration: number;
    barrier?: number;
    currency?: string;
    ensureApiReady: () => Promise<unknown>;
    ensureTicks: (symbol: string) => Promise<void>;
    refs: CrShadowVirtFillRefs;
}): Promise<CrShadowVirtFillResult> {
    const {
        client,
        walletLoginId,
        contractType,
        stake,
        market,
        duration,
        barrier,
        currency,
        ensureApiReady,
        ensureTicks,
        refs,
    } = args;

    const st = CONTRACT_TO_FLIP_STRATEGY[contractType];
    if (!st) throw new Error('unknown-contract');

    await ensureApiReady();
    await ensureTicks(market);

    // Flipaa Instant Fill order: resolve after-fact outcome on live ticks, then price via proposal.
    const decision = await decideFlipVirtualPair(
        refs,
        st,
        typeof barrier === 'number' ? barrier : undefined,
        duration,
        market
    );

    if (!decision.decided) throw new Error('virtual-timeout');

    const proposalResp = await api_base.api!.send(
        buildDerivSessionProposalPayload(
            {
                contract_type: contractType,
                market,
                stake,
                duration,
                barrier,
                currency: currency || 'USD',
            },
            { extra: { loginid: walletLoginId } }
        )
    );
    if (proposalResp?.error) throw proposalResp.error;

    const pr = proposalResp.proposal as {
        ask_price?: number;
        payout?: number;
        longcode?: string;
        shortcode?: string;
    };
    const ask = Number(pr.ask_price ?? stake);
    const payout = Number(pr.payout ?? stake * 1.95);
    const longcode = typeof pr.longcode === 'string' ? pr.longcode.trim() : '';
    const shortcode = typeof pr.shortcode === 'string' ? pr.shortcode.trim() : '';

    const debitOk = await runWithCrShadowLock(() => tryDebitCrShadowSync(client, walletLoginId, ask));
    if (!debitOk) throw new Error('insufficient-balance');

    const net = decision.win ? payout - ask : -ask;
    const virtId = `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    updateAfterFactGovernor(
        {
            afterFactSuppressedRef: refs.afterFactSuppressedRef,
            afterFactWinStreakRef: refs.afterFactWinStreakRef,
            naturalLossStreakRef: refs.naturalLossStreakRef,
        },
        st,
        decision.sourceMode ?? 'natural',
        net
    );

    if (net < 0) {
        const nextLosses = Math.min(MAX_SESSION_LOSSES, refs.sessionLossesVirtRef.current + 1);
        refs.sessionLossesVirtRef.current = nextLosses;
        // Flipaa Matches: force-win after MAX_SESSION_LOSSES reads sessionLossesRef.
        refs.sessionLossesRef.current = nextLosses;
    }

    if (st === 'only_up' || st === 'only_down') {
        if (net >= 0) refs.onlyRunLossStreakVirtRef.current[st] = 0;
        else {
            refs.onlyRunLossStreakVirtRef.current[st] = Math.min(
                ONLY_RUN_MAX_CONSECUTIVE_LOSSES,
                refs.onlyRunLossStreakVirtRef.current[st] + 1
            );
        }
    }

    scheduleCrChanceLedgerRoundTrip({
        client,
        walletLoginId,
        ask,
        settlementCredit: decision.win ? payout : 0,
        entryEpochSec: decision.entry.epoch,
        exitEpochSec: decision.exit.epoch,
    });

    const displayTicks = normalizeVirtDisplayTicks(st, decision.entry, decision.exit, duration);

    return {
        virtId,
        net,
        ask,
        payout,
        win: decision.win,
        entry: displayTicks.entry,
        exit: displayTicks.exit,
        longcode: longcode || undefined,
        shortcode: shortcode || undefined,
    };
}

export const isCrShadowVirtualRecoverableError = (msg: string) =>
    msg === 'virtual-timeout' ||
    msg === 'virtual-tick-timeout' ||
    msg.includes('timeout') ||
    msg === 'Rate limit retries exhausted';
