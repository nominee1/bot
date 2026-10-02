import { buildDerivSessionProposalPayload } from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import { api_base } from '@/external/bot-skeleton';
import { isBotEmbed } from '@/utils/bot-embed';
import { scheduleCrChanceLedgerRoundTrip } from '@/utils/chanceVirtualStatements';
import { isCrVirtualShadowLogin, runWithCrShadowLock, tryDebitCrShadowSync } from '@/utils/crVirtualBalanceShadow';
import { DERIV1_DEMO_LOGINID, getHandoffShadowLoginid, isDeriv1DemoLoginid } from '@/utils/deriv1SessionHandoff';
import { flipaaQuoteWithForcedLastDigit } from '@/utils/flipaaTickDigitFormat';
import {
    applyConsecutiveLossForceWin,
    decideFlipVirtualPair,
    type FlipVirtStrategyType,
    MAX_CONSECUTIVE_LOSSES,
    MAX_SESSION_LOSSES,
    ONLY_RUN_MAX_CONSECUTIVE_LOSSES,
    updateAfterFactGovernor,
    type VirtFlipDecision,
    type VirtFlipDecisionRefs,
    type VirtTick,
    windowWinsForStrategy,
} from '@/utils/flipaaVirtualDecision';

/** Shared tick path for stacked hedge purchases (both sides of one round). */
let hedgeWindowCache: {
    key: string;
    entry: VirtTick;
    exit: VirtTick;
    ticks: VirtTick[];
    at: number;
} | null = null;

type HedgeSharedPath = { entry: VirtTick; exit: VirtTick; ticks: VirtTick[] };

/** In-flight path so Only Ups and Only Downs started together share one window. */
let hedgeWindowInflight: {
    key: string;
    promise: Promise<HedgeSharedPath | null>;
} | null = null;

const HEDGE_WINDOW_REUSE_MS = 8000;

function hedgeWindowKey(market: string, duration: number, barrier: number | string | undefined): string {
    return `${market}|${duration}|${barrier ?? ''}`;
}

function decisionFromSharedPair(
    st: FlipVirtStrategyType,
    barrier: number | string | undefined,
    market: string,
    shared: HedgeSharedPath
): VirtFlipDecision {
    const ticks = shared.ticks.length >= 2 ? shared.ticks : [shared.entry, shared.exit];
    const win = windowWinsForStrategy(st, barrier, ticks, market);
    return {
        decided: true,
        win: !!win,
        fabricated: false,
        sourceMode: 'natural',
        entry: shared.entry,
        exit: shared.exit,
        path: ticks,
    };
}

async function decideFlipVirtualPairWithHedgeReuse(
    refs: VirtFlipDecisionRefs,
    st: FlipVirtStrategyType,
    barrier: number | string | undefined,
    duration: number,
    market: string
): Promise<VirtFlipDecision> {
    const key = hedgeWindowKey(market, duration, barrier);
    const cached = hedgeWindowCache;
    if (cached && cached.key === key && Date.now() - cached.at < HEDGE_WINDOW_REUSE_MS) {
        return decisionFromSharedPair(st, barrier, market, cached);
    }

    if (hedgeWindowInflight && hedgeWindowInflight.key === key) {
        const shared = await hedgeWindowInflight.promise;
        if (shared) return decisionFromSharedPair(st, barrier, market, shared);
    }

    let resolveShared: (value: HedgeSharedPath | null) => void = () => undefined;
    const promise = new Promise<HedgeSharedPath | null>(resolve => {
        resolveShared = resolve;
    });
    hedgeWindowInflight = { key, promise };

    try {
        const decision = await decideFlipVirtualPair(refs, st, barrier, duration, market);
        if (decision.decided) {
            const ticks = decision.path && decision.path.length >= 2 ? decision.path : [decision.entry, decision.exit];
            const shared = { entry: decision.entry, exit: decision.exit, ticks };
            hedgeWindowCache = {
                key,
                ...shared,
                at: Date.now(),
            };
            resolveShared(shared);
        } else {
            resolveShared(null);
        }
        return decision;
    } catch (err) {
        resolveShared(null);
        throw err;
    } finally {
        if (hedgeWindowInflight?.promise === promise) hedgeWindowInflight = null;
    }
}

/**
 * Wallet loginid for CR shadow virtual fills — same resolution as Manual Trader.
 * auth activeLoginid → MobX client.loginid → WS session → stored active_loginid.
 * Demo UI (VRTC*) maps to the fixed demo ledger; handoff Real uses the shadow loginid.
 */
export function resolveCrShadowWalletLoginid(activeLoginid?: string | null, clientLoginid?: string | null): string {
    for (const raw of [activeLoginid, clientLoginid]) {
        const id = String(raw ?? '').trim();
        if (id && isDeriv1DemoLoginid(id)) return DERIV1_DEMO_LOGINID;
        if (id) return id;
    }
    const handoff = getHandoffShadowLoginid();
    if (handoff) return handoff;
    try {
        const fromApi = String(api_base?.account_info?.loginid ?? '').trim();
        if (fromApi) return fromApi;
    } catch {
        /* ignore */
    }
    try {
        const stored = String(localStorage.getItem('active_loginid') ?? '').trim();
        if (stored) {
            if (isDeriv1DemoLoginid(stored)) return DERIV1_DEMO_LOGINID;
            return stored;
        }
    } catch {
        /* ignore */
    }
    return '';
}

/** CR7557018 / ROT90381442 / deriv-1 embed handoff — shadow-ledger fills; never live Deriv buy. */
export const shouldUseCrShadowLiveFills = (activeLoginid?: string | null, clientLoginid?: string | null): boolean => {
    if (getHandoffShadowLoginid() || isBotEmbed()) return true;
    return isCrVirtualShadowLogin(resolveCrShadowWalletLoginid(activeLoginid, clientLoginid));
};

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

// Options public API uses HIGHER/LOWER (not CALL/PUT) for Higher/Lower contracts.
CONTRACT_TO_FLIP_STRATEGY.HIGHER = 'rise';
CONTRACT_TO_FLIP_STRATEGY.LOWER = 'fall';

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
    barrier?: number | string;
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
    // Hedge legs in one commit (Higher+Lower, Only Ups+Only Downs) reuse the same entry/exit window.
    let decision = await decideFlipVirtualPairWithHedgeReuse(refs, st, barrier, duration, market);

    if (!decision.decided) throw new Error('virtual-timeout');

    // Cap consecutive losses: never allow a 4th loss in a row on any contract type.
    decision = applyConsecutiveLossForceWin(decision, st, barrier, market, refs.consecutiveLossStreakRef);

    // Ensure fabricated Matches exits paint the predicted last digit on the settlement spot.
    if (
        decision.decided &&
        st === 'matches' &&
        decision.fabricated &&
        typeof decision.forcedDigit === 'number' &&
        Number.isFinite(decision.forcedDigit)
    ) {
        decision.exit = {
            ...decision.exit,
            quote: flipaaQuoteWithForcedLastDigit(decision.exit.quote, decision.forcedDigit, market),
        };
    }

    // Digits need barrier; High/Low Ticks need selected_tick (barrier → BarrierNotAllowed).
    // Higher/Lower (HIGHER/LOWER or legacy CALL/PUT+offset) need barrier on the proposal.
    const digitBarrierTypes = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'];
    const tickTypes = ['TICKHIGH', 'TICKLOW'];
    const hlTypes = ['HIGHER', 'LOWER'];
    const isHl = hlTypes.includes(contractType);
    // Always send Higher/Lower barrier as a signed relative offset ("+0.37"), never a bare number.
    let proposalBarrier: number | string | undefined;
    if (digitBarrierTypes.includes(contractType)) {
        proposalBarrier =
            barrier !== undefined && barrier !== null && Number.isFinite(Number(barrier)) ? barrier : undefined;
    } else if (isHl) {
        if (barrier !== undefined && barrier !== null && Number.isFinite(Number(barrier))) {
            if (typeof barrier === 'string' && /^[+-]/.test(barrier.trim())) {
                proposalBarrier = barrier.trim();
            } else {
                const n = Number(barrier);
                proposalBarrier = n === 0 ? '+0' : n > 0 ? `+${n}` : `${n}`;
            }
        }
    } else if (
        !tickTypes.includes(contractType) &&
        barrier !== undefined &&
        barrier !== null &&
        Number.isFinite(Number(barrier))
    ) {
        proposalBarrier = barrier;
    }
    const selectedTick =
        tickTypes.includes(contractType) &&
        barrier !== undefined &&
        barrier !== null &&
        Number.isFinite(Number(barrier))
            ? Number(barrier)
            : undefined;

    const proposalResp = await api_base.api!.send(
        buildDerivSessionProposalPayload({
            contract_type: contractType,
            market,
            stake,
            duration: tickTypes.includes(contractType) ? Math.max(5, duration || 5) : duration,
            barrier: proposalBarrier,
            currency: currency || 'USD',
            basis: 'stake',
            extras: selectedTick !== undefined ? { selected_tick: selectedTick } : undefined,
        })
    );
    if (proposalResp?.error) throw proposalResp.error;

    const pr = proposalResp.proposal as {
        ask_price?: number;
        payout?: number;
        longcode?: string;
        shortcode?: string;
    };
    // Hedge / virtual fills must debit the configured stake on both legs (never drift to 1 vs 2).
    const rawAsk = Number(pr.ask_price ?? stake);
    const rawPayout = Number(pr.payout ?? stake * 1.95);
    const ask = stake;
    const payout =
        Number.isFinite(rawAsk) && rawAsk > 0
            ? Number(((rawPayout / rawAsk) * stake).toFixed(2))
            : Number(rawPayout.toFixed(2));
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
        if (refs.sessionLossesVirtRef && typeof refs.sessionLossesVirtRef === 'object') {
            refs.sessionLossesVirtRef.current = nextLosses;
        }
        // Flipaa Matches: force-win after MAX_SESSION_LOSSES reads sessionLossesRef.
        if (
            refs.sessionLossesRef &&
            typeof refs.sessionLossesRef === 'object' &&
            refs.sessionLossesRef !== refs.sessionLossesVirtRef
        ) {
            refs.sessionLossesRef.current = nextLosses;
        }
    } else {
        refs.sessionLossesVirtRef.current = 0;
        if (
            refs.sessionLossesRef &&
            typeof refs.sessionLossesRef === 'object' &&
            refs.sessionLossesRef !== refs.sessionLossesVirtRef
        ) {
            refs.sessionLossesRef.current = 0;
        }
    }

    // Track per-strategy consecutive losses for all virtual contract types.
    if (!refs.consecutiveLossStreakRef.current) {
        refs.consecutiveLossStreakRef.current = {};
    }
    if (net >= 0) {
        refs.consecutiveLossStreakRef.current[st] = 0;
    } else {
        refs.consecutiveLossStreakRef.current[st] = Math.min(
            MAX_CONSECUTIVE_LOSSES,
            (refs.consecutiveLossStreakRef.current[st] ?? 0) + 1
        );
    }

    if (st === 'only_up' || st === 'only_down') {
        const next =
            net >= 0
                ? 0
                : Math.min(ONLY_RUN_MAX_CONSECUTIVE_LOSSES, (refs.onlyRunLossStreakVirtRef.current[st] ?? 0) + 1);
        refs.onlyRunLossStreakVirtRef.current[st] = next;
        if (refs.onlyRunLossStreakRef?.current) refs.onlyRunLossStreakRef.current[st] = next;
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
