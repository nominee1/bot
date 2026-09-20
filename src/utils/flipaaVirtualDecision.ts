/**
 * Virtual outcome resolution for Flipaa (ported from marketing flipaa).
 * Uses tick buffer refs shared with the WebSocket tick stream.
 */
import {
    flipaaLastDigitFromQuote,
    flipaaQuoteWithForcedLastDigit,
    flipaaResolveDigitTickDecimals,
} from '@/utils/flipaaTickDigitFormat';

export type VirtTick = { epoch: number; quote: number };

export type FlipVirtStrategyType =
    | 'even'
    | 'odd'
    | 'over'
    | 'under'
    | 'matches'
    | 'differs'
    | 'rise'
    | 'fall'
    | 'only_up'
    | 'only_down'
    | 'rise_equals'
    | 'fall_equals'
    | 'high'
    | 'low';

export const MATCH_WAIT_MS = 2000;
export const MAX_SESSION_LOSSES = 3;
export const ONLY_RUN_MAX_CONSECUTIVE_LOSSES = 2;
export const AFTER_FACT_WIN_CAP = 4;
export const NATURAL_LOSS_CAP_TO_REENABLE = 2;
/** Deriv RUNHIGH/RUNLOW minimum tick duration. */
export const ONLY_RUN_MIN_TICKS = 2;
/** Deriv TICKHIGH/TICKLOW always resolve over 5 ticks. */
export const PATH_HL_TICK_COUNT = 5;
const TICK_POLL_MS = 25;
const MS_PER_EXPECTED_TICK = 2500;

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isPathDependentVirtStrategy(st: FlipVirtStrategyType): boolean {
    return st === 'only_up' || st === 'only_down' || st === 'high' || st === 'low';
}

/** Timeout for waiting on live ticks after virtual buy (entry is the next tick, not history). */
export function pathDependentTimeoutMs(tickCount: number): number {
    const n = Math.max(1, Math.floor(tickCount) || 1);
    return n * MS_PER_EXPECTED_TICK + 4000;
}

/**
 * Deriv RUNHIGH/RUNLOW: each tick after entry must be strictly higher (only up) or
 * lower (only down) than the previous. First reversal is the exit spot (early knockout).
 * Returns the knockout index, or null if the path is still valid.
 */
export function onlyRunKnockoutIndex(st: 'only_up' | 'only_down', ticks: VirtTick[]): number | null {
    for (let i = 1; i < ticks.length; i++) {
        const prev = ticks[i - 1].quote;
        const curr = ticks[i].quote;
        if (!isNum(prev) || !isNum(curr)) return i;
        if (st === 'only_up' ? curr <= prev : curr >= prev) return i;
    }
    return null;
}

/** Deriv TICKHIGH/TICKLOW: selected tick (1–5) must be the unique high or unique low. */
export function highLowWins(st: 'high' | 'low', selectedTick: number, ticks: VirtTick[]): boolean {
    if (!isNum(selectedTick) || ticks.length < PATH_HL_TICK_COUNT) return false;
    const idx = Math.floor(selectedTick) - 1;
    if (idx < 0 || idx >= PATH_HL_TICK_COUNT) return false;
    const quotes = ticks.slice(0, PATH_HL_TICK_COUNT).map(t => t.quote);
    const target = quotes[idx];
    if (!isNum(target)) return false;
    return st === 'high'
        ? quotes.every((q, i) => i === idx || q < target)
        : quotes.every((q, i) => i === idx || q > target);
}

/** Same last digit as Flipaa UI / `flipaaLastDigitFromQuote` (pip_sizes + fallback). */
export function computeLastDigitVirt(price: number, mkt: string): number {
    return flipaaLastDigitFromQuote(price, mkt);
}

/** Minimum quote step for only-up / only-down fabrication — matches Flipaa tick decimal precision. */
export function getMinStep(mkt: string) {
    const d = Math.min(8, Math.max(0, Math.round(flipaaResolveDigitTickDecimals(mkt))));
    return 10 ** -d;
}

export type VirtFlipDecision =
    | { decided: false }
    | {
          decided: true;
          win: boolean;
          fabricated: boolean;
          sourceMode: 'after_fact' | 'natural';
          entry: VirtTick;
          exit: VirtTick;
          forcedDigit?: number;
      };

export type VirtFlipDecisionRefs = {
    isRunningRef: { current: boolean };
    tickBufferRef: { current: VirtTick[] };
    sessionLossesRef: { current: number };
    /** True until the first Matches fill of a bot run — force-win with predicted exit digit. */
    matchesFirstPendingRef: { current: boolean };
    afterFactSuppressedRef: { current: boolean };
    afterFactWinStreakRef: { current: number };
    naturalLossStreakRef: { current: number };
    onlyRunLossStreakRef: { current: Record<'only_up' | 'only_down', number> };
};

export function windowWinsForStrategy(
    st: FlipVirtStrategyType,
    barrier: number | undefined,
    window: VirtTick[],
    mkt: string
): boolean {
    if (!window.length) return false;
    const first = window[0];
    const last = window[window.length - 1];
    const lastDigit = computeLastDigitVirt(last.quote, mkt);

    switch (st) {
        case 'even':
            return lastDigit % 2 === 0;
        case 'odd':
            return lastDigit % 2 !== 0;
        case 'over':
            return isNum(barrier) ? lastDigit > barrier : false;
        case 'under':
            return isNum(barrier) ? lastDigit < barrier : false;
        case 'matches':
            return isNum(barrier) ? lastDigit === barrier : false;
        case 'differs':
            return isNum(barrier) ? lastDigit !== barrier : false;
        case 'rise':
            return last.quote > first.quote;
        case 'fall':
            return last.quote < first.quote;
        case 'rise_equals':
            return last.quote >= first.quote;
        case 'fall_equals':
            return last.quote <= first.quote;
        case 'only_up':
            return window.length >= 2 && onlyRunKnockoutIndex('only_up', window) == null;
        case 'only_down':
            return window.length >= 2 && onlyRunKnockoutIndex('only_down', window) == null;
        case 'high':
        case 'low':
            return highLowWins(st, Number(barrier), window);
        default:
            return false;
    }
}

export function getRecentWindow(tickBufferRef: { current: VirtTick[] }, count: number): VirtTick[] | null {
    const buf = tickBufferRef.current;
    if (buf.length < count) return null;
    return buf.slice(buf.length - count);
}

export function ensurePairFromBuf(tickBufferRef: { current: VirtTick[] }): {
    prev: VirtTick;
    curr: VirtTick;
} | null {
    const buf = tickBufferRef.current;
    if (buf.length >= 2) return { prev: buf[buf.length - 2], curr: buf[buf.length - 1] };
    return null;
}

async function waitTickAfter(
    refs: Pick<VirtFlipDecisionRefs, 'isRunningRef' | 'tickBufferRef'>,
    afterEpoch: number,
    deadline: number
): Promise<VirtTick | null> {
    while (refs.isRunningRef.current && Date.now() < deadline) {
        const newer = refs.tickBufferRef.current.filter(t => t.epoch > afterEpoch);
        if (newer.length) {
            newer.sort((a, b) => a.epoch - b.epoch);
            return newer[0];
        }
        await sleep(TICK_POLL_MS);
    }
    return null;
}

async function collectForwardTicks(
    refs: Pick<VirtFlipDecisionRefs, 'isRunningRef' | 'tickBufferRef'>,
    count: number,
    deadline: number,
    onTick?: (ticks: VirtTick[]) => boolean
): Promise<VirtTick[]> {
    const collected: VirtTick[] = [];
    let afterEpoch = refs.tickBufferRef.current.at(-1)?.epoch ?? 0;
    while (refs.isRunningRef.current && collected.length < count && Date.now() < deadline) {
        const tick = await waitTickAfter(refs, afterEpoch, deadline);
        if (!tick) break;
        collected.push(tick);
        afterEpoch = tick.epoch;
        if (onTick?.(collected)) break;
    }
    return collected;
}

function decidedNatural(win: boolean, entry: VirtTick, exit: VirtTick): VirtFlipDecision {
    return { decided: true, win, fabricated: false, sourceMode: 'natural', entry, exit };
}

/**
 * Virtual Only Ups / Only Downs: same path as Deriv `proposal_open_contract`.
 * Entry is the next live tick after buy. Exit is the first reversing tick, or the
 * last tick if the successive path lasts the full duration.
 */
async function decideOnlyRunLikeDeriv(
    refs: VirtFlipDecisionRefs,
    st: 'only_up' | 'only_down',
    dur: number
): Promise<VirtFlipDecision> {
    const ticksNeeded = Math.max(ONLY_RUN_MIN_TICKS, Math.floor(dur) || ONLY_RUN_MIN_TICKS);
    const deadline = Date.now() + pathDependentTimeoutMs(ticksNeeded);
    const collected = await collectForwardTicks(refs, ticksNeeded, deadline, ticks => {
        return onlyRunKnockoutIndex(st, ticks) != null;
    });
    if (collected.length < 2) return { decided: false };
    const ko = onlyRunKnockoutIndex(st, collected);
    if (ko != null) return decidedNatural(false, collected[0], collected[ko]);
    if (collected.length >= ticksNeeded) {
        return decidedNatural(true, collected[0], collected[collected.length - 1]);
    }
    return { decided: false };
}

/**
 * Virtual High/Low ticks: wait for 5 ticks after buy (Deriv TICKHIGH/TICKLOW).
 * Exit spot is the last tick at end time — not the selected high/low tick.
 */
async function decideHighLowLikeDeriv(
    refs: VirtFlipDecisionRefs,
    st: 'high' | 'low',
    barrier: number | undefined
): Promise<VirtFlipDecision> {
    const deadline = Date.now() + pathDependentTimeoutMs(PATH_HL_TICK_COUNT);
    const collected = await collectForwardTicks(refs, PATH_HL_TICK_COUNT, deadline);
    if (collected.length < PATH_HL_TICK_COUNT) return { decided: false };
    const win = highLowWins(st, Number(barrier), collected);
    return decidedNatural(win, collected[0], collected[collected.length - 1]);
}

export async function decideFlipVirtualPair(
    refs: VirtFlipDecisionRefs,
    st: FlipVirtStrategyType,
    barrier: number | undefined,
    dur: number,
    mkt: string
): Promise<VirtFlipDecision> {
    const { isRunningRef, tickBufferRef, sessionLossesRef, matchesFirstPendingRef, afterFactSuppressedRef } = refs;

    if (st === 'only_up' || st === 'only_down') {
        return decideOnlyRunLikeDeriv(refs, st, dur);
    }
    if (st === 'high' || st === 'low') {
        return decideHighLowLikeDeriv(refs, st, barrier);
    }

    const requiredPoints = Math.max(2, dur);
    // First Matches trade of a bot run, or after MAX_SESSION_LOSSES — always win with predicted digit.
    const forceMatchesWin =
        st === 'matches' && (matchesFirstPendingRef.current || sessionLossesRef.current >= MAX_SESSION_LOSSES);
    const afterFactAllowed = st === 'matches' ? true : !afterFactSuppressedRef.current;

    if (st !== 'matches' && !afterFactAllowed) {
        const t0 = Date.now();
        while (isRunningRef.current && Date.now() - t0 < MATCH_WAIT_MS) {
            const naturalWindow = getRecentWindow(tickBufferRef, requiredPoints);
            if (naturalWindow) {
                const naturalWin = windowWinsForStrategy(st, barrier, naturalWindow, mkt);
                return {
                    decided: true,
                    win: !!naturalWin,
                    fabricated: false,
                    sourceMode: 'natural',
                    entry: naturalWindow[0],
                    exit: naturalWindow[naturalWindow.length - 1],
                };
            }
            await sleep(25);
        }

        const fallbackWindow = getRecentWindow(tickBufferRef, requiredPoints);
        if (!fallbackWindow) return { decided: false };

        const fallbackWin = windowWinsForStrategy(st, barrier, fallbackWindow, mkt);
        return {
            decided: true,
            win: !!fallbackWin,
            fabricated: false,
            sourceMode: 'natural',
            entry: fallbackWindow[0],
            exit: fallbackWindow[fallbackWindow.length - 1],
        };
    }

    const markMatchesConsumed = () => {
        if (st === 'matches') matchesFirstPendingRef.current = false;
    };

    const t0 = Date.now();
    while (isRunningRef.current && Date.now() - t0 < MATCH_WAIT_MS) {
        const window = getRecentWindow(tickBufferRef, requiredPoints);
        if (window && windowWinsForStrategy(st, barrier, window, mkt)) {
            markMatchesConsumed();
            return {
                decided: true,
                win: true,
                fabricated: false,
                sourceMode: st === 'matches' ? 'natural' : 'after_fact',
                entry: window[0],
                exit: window[window.length - 1],
            };
        }
        await sleep(25);
    }

    const window = getRecentWindow(tickBufferRef, requiredPoints);
    if (!window) return { decided: false };

    const winReal = windowWinsForStrategy(st, barrier, window, mkt);

    if (!forceMatchesWin) {
        markMatchesConsumed();
        return {
            decided: true,
            win: !!winReal,
            fabricated: false,
            sourceMode: st === 'matches' ? 'natural' : 'after_fact',
            entry: window[0],
            exit: window[window.length - 1],
        };
    }

    if (st === 'matches') {
        const forcedDigit = isNum(barrier) ? Math.floor(barrier) % 10 : undefined;
        const rawExit = window[window.length - 1];
        const exit =
            forcedDigit == null
                ? rawExit
                : {
                      ...rawExit,
                      quote: flipaaQuoteWithForcedLastDigit(rawExit.quote, forcedDigit, mkt),
                  };
        markMatchesConsumed();
        return {
            decided: true,
            win: true,
            fabricated: true,
            sourceMode: 'natural',
            entry: window[0],
            exit,
            forcedDigit,
        };
    }

    return { decided: false };
}

export function updateAfterFactGovernor(
    refs: Pick<VirtFlipDecisionRefs, 'afterFactSuppressedRef' | 'afterFactWinStreakRef' | 'naturalLossStreakRef'>,
    st: FlipVirtStrategyType,
    sourceMode: 'after_fact' | 'natural',
    net: number
) {
    const { afterFactSuppressedRef, afterFactWinStreakRef, naturalLossStreakRef } = refs;

    if (st === 'matches' || isPathDependentVirtStrategy(st)) return;

    if (sourceMode === 'after_fact') {
        naturalLossStreakRef.current = 0;

        if (net >= 0) {
            afterFactWinStreakRef.current += 1;

            if (afterFactWinStreakRef.current >= AFTER_FACT_WIN_CAP) {
                afterFactSuppressedRef.current = true;
                afterFactWinStreakRef.current = 0;
                naturalLossStreakRef.current = 0;
            }
        } else {
            afterFactWinStreakRef.current = 0;
        }

        return;
    }

    afterFactWinStreakRef.current = 0;

    if (afterFactSuppressedRef.current) {
        if (net < 0) {
            naturalLossStreakRef.current += 1;
            if (naturalLossStreakRef.current >= NATURAL_LOSS_CAP_TO_REENABLE) {
                afterFactSuppressedRef.current = false;
                naturalLossStreakRef.current = 0;
                afterFactWinStreakRef.current = 0;
            }
        } else {
            naturalLossStreakRef.current = 0;
        }
    }
}
