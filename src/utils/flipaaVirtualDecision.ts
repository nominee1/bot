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
/** Never allow a 4th consecutive loss on any virtual contract type — force-win instead. */
export const MAX_CONSECUTIVE_LOSSES = 3;
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
          /** Full Only Ups / Only Downs path. A break in the run loses both sides. */
          path?: VirtTick[];
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
    /** Per-strategy consecutive loss streak — force-win at MAX_CONSECUTIVE_LOSSES. */
    consecutiveLossStreakRef: { current: Partial<Record<FlipVirtStrategyType, number>> };
};

/**
 * Adjust exit (and optionally paint a digit) so `windowWinsForStrategy` would pass.
 * Used to break a long losing streak without waiting for a natural win window.
 */
export function fabricateWinningExit(
    st: FlipVirtStrategyType,
    barrier: number | string | undefined,
    entry: VirtTick,
    exit: VirtTick,
    mkt: string
): { exit: VirtTick; forcedDigit?: number } {
    const step = getMinStep(mkt);
    const offset = Number(barrier);

    switch (st) {
        case 'rise': {
            const need = Number.isFinite(offset) ? entry.quote + offset + step : entry.quote + step;
            return { exit: { ...exit, quote: Math.max(exit.quote, need) } };
        }
        case 'fall': {
            const limit = Number.isFinite(offset) ? entry.quote + offset - step : entry.quote - step;
            return { exit: { ...exit, quote: Math.min(exit.quote, limit) } };
        }
        case 'rise_equals':
            return { exit: { ...exit, quote: Math.max(exit.quote, entry.quote) } };
        case 'fall_equals':
            return { exit: { ...exit, quote: Math.min(exit.quote, entry.quote) } };
        case 'only_up':
            return { exit: { ...exit, quote: Number((entry.quote + step).toFixed(10)) } };
        case 'only_down':
            return { exit: { ...exit, quote: Number((entry.quote - step).toFixed(10)) } };
        case 'high':
            return { exit: { ...exit, quote: entry.quote - step } };
        case 'low':
            return { exit: { ...exit, quote: entry.quote + step } };
        case 'even': {
            const d = computeLastDigitVirt(exit.quote, mkt);
            const forcedDigit = d % 2 === 0 ? d : (d + 1) % 10;
            return {
                exit: { ...exit, quote: flipaaQuoteWithForcedLastDigit(exit.quote, forcedDigit, mkt) },
                forcedDigit,
            };
        }
        case 'odd': {
            const d = computeLastDigitVirt(exit.quote, mkt);
            const forcedDigit = d % 2 !== 0 ? d : (d + 1) % 10;
            return {
                exit: { ...exit, quote: flipaaQuoteWithForcedLastDigit(exit.quote, forcedDigit, mkt) },
                forcedDigit,
            };
        }
        case 'over': {
            const forcedDigit = isNum(barrier) ? Math.min(9, Math.floor(barrier) + 1) : 5;
            return {
                exit: { ...exit, quote: flipaaQuoteWithForcedLastDigit(exit.quote, forcedDigit, mkt) },
                forcedDigit,
            };
        }
        case 'under': {
            const forcedDigit = isNum(barrier) ? Math.max(0, Math.floor(barrier) - 1) : 4;
            return {
                exit: { ...exit, quote: flipaaQuoteWithForcedLastDigit(exit.quote, forcedDigit, mkt) },
                forcedDigit,
            };
        }
        case 'matches': {
            const forcedDigit = isNum(barrier) ? Math.floor(barrier) % 10 : 0;
            return {
                exit: { ...exit, quote: flipaaQuoteWithForcedLastDigit(exit.quote, forcedDigit, mkt) },
                forcedDigit,
            };
        }
        case 'differs': {
            const avoid = isNum(barrier) ? Math.floor(barrier) % 10 : 0;
            const forcedDigit = (avoid + 1) % 10;
            return {
                exit: { ...exit, quote: flipaaQuoteWithForcedLastDigit(exit.quote, forcedDigit, mkt) },
                forcedDigit,
            };
        }
        default:
            return { exit: { ...exit, quote: entry.quote + step } };
    }
}

/** If this strategy already lost MAX_CONSECUTIVE_LOSSES times, force the next fill to win. */
export function applyConsecutiveLossForceWin(
    decision: VirtFlipDecision,
    st: FlipVirtStrategyType,
    barrier: number | string | undefined,
    mkt: string,
    consecutiveLossStreakRef: { current: Partial<Record<FlipVirtStrategyType, number>> }
): VirtFlipDecision {
    if (!decision.decided || decision.win) return decision;
    const streak = consecutiveLossStreakRef.current[st] ?? 0;
    // Flipaa Only Ups / Only Downs force a win after 2 losses; other types after 3.
    const lossCap = st === 'only_up' || st === 'only_down' ? ONLY_RUN_MAX_CONSECUTIVE_LOSSES : MAX_CONSECUTIVE_LOSSES;
    if (streak < lossCap) return decision;

    const { exit, forcedDigit } = fabricateWinningExit(st, barrier, decision.entry, decision.exit, mkt);
    return {
        decided: true,
        win: true,
        fabricated: true,
        sourceMode: 'natural',
        entry: decision.entry,
        exit,
        forcedDigit,
    };
}

export function windowWinsForStrategy(
    st: FlipVirtStrategyType,
    barrier: number | string | undefined,
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
            // Higher: barrier is relative offset (e.g. "+0.37") or absolute; Rise: no barrier.
            if (barrier !== undefined && barrier !== null && `${barrier}` !== '') {
                const offset = Number(barrier);
                if (Number.isFinite(offset)) {
                    return last.quote > first.quote + offset;
                }
            }
            return last.quote > first.quote;
        case 'fall':
            if (barrier !== undefined && barrier !== null && `${barrier}` !== '') {
                const offset = Number(barrier);
                if (Number.isFinite(offset)) {
                    return last.quote < first.quote + offset;
                }
            }
            return last.quote < first.quote;
        case 'rise_equals':
            return last.quote >= first.quote;
        case 'fall_equals':
            return last.quote <= first.quote;
        case 'only_up':
            return onlyRunPathWins('only_up', window);
        case 'only_down':
            return onlyRunPathWins('only_down', window);
        case 'high':
        case 'low':
            return highLowWins(st, Number(barrier), window);
        default:
            return false;
    }
}

/**
 * Only Ups wins only when every step is strictly higher.
 * Only Downs wins only when every step is strictly lower.
 * A flat step or a reversal loses that side — so a chop loses both.
 */
export function onlyRunPathWins(st: 'only_up' | 'only_down', ticks: VirtTick[]): boolean {
    if (ticks.length < 2) return false;
    for (let i = 1; i < ticks.length; i += 1) {
        const prev = ticks[i - 1].quote;
        const curr = ticks[i].quote;
        if (st === 'only_up' ? !(curr > prev) : !(curr < prev)) return false;
    }
    return true;
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

function decidedNatural(win: boolean, entry: VirtTick, exit: VirtTick, path?: VirtTick[]): VirtFlipDecision {
    return { decided: true, win, fabricated: false, sourceMode: 'natural', entry, exit, path };
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
    barrier: number | string | undefined,
    dur: number,
    mkt: string
): Promise<VirtFlipDecision> {
    const { isRunningRef, tickBufferRef, sessionLossesRef, matchesFirstPendingRef, afterFactSuppressedRef } = refs;

    if (st === 'only_up' || st === 'only_down') {
        // At least 3 ticks so the shared hedge path can break. A clean run wins one
        // side. A flat step or a reversal loses Only Ups and Only Downs together.
        const ticksNeeded = Math.max(3, Math.floor(dur) || 3);
        const t0 = Date.now();
        while (isRunningRef.current && Date.now() - t0 < MATCH_WAIT_MS) {
            const path = getRecentWindow(tickBufferRef, ticksNeeded);
            if (path) {
                const win = onlyRunPathWins(st, path);
                return decidedNatural(win, path[0], path[path.length - 1], path);
            }
            await sleep(25);
        }
        return { decided: false };
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
