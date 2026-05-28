/**
 * Virtual outcome resolution for Flipaa (ported from marketing flipaa).
 * Uses tick buffer refs shared with the WebSocket tick stream.
 */
import { flipaaLastDigitFromQuote, flipaaResolveDigitTickDecimals } from '@/pages/aaflipaa/flipaaTickDigitFormat';

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
  | 'fall_equals';

export const MATCH_WAIT_MS = 2000;
export const MAX_SESSION_LOSSES = 3;
export const ONLY_RUN_MAX_CONSECUTIVE_LOSSES = 2;
export const AFTER_FACT_WIN_CAP = 4;
export const NATURAL_LOSS_CAP_TO_REENABLE = 2;

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
      return last.quote > first.quote;
    case 'only_down':
      return last.quote < first.quote;
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

export async function decideFlipVirtualPair(
  refs: VirtFlipDecisionRefs,
  st: FlipVirtStrategyType,
  barrier: number | undefined,
  dur: number,
  mkt: string
): Promise<VirtFlipDecision> {
  const { isRunningRef, tickBufferRef, sessionLossesRef, afterFactSuppressedRef, afterFactWinStreakRef, naturalLossStreakRef, onlyRunLossStreakRef } =
    refs;

  const isOnlyRun = st === 'only_up' || st === 'only_down';

  if (isOnlyRun) {
    const t0 = Date.now();
    while (isRunningRef.current && Date.now() - t0 < MATCH_WAIT_MS) {
      const pair = ensurePairFromBuf(tickBufferRef);
      if (pair) {
        const realWin = st === 'only_up' ? pair.curr.quote > pair.prev.quote : pair.curr.quote < pair.prev.quote;

        const shouldForceWin =
          onlyRunLossStreakRef.current[st as 'only_up' | 'only_down'] >= ONLY_RUN_MAX_CONSECUTIVE_LOSSES;

        if (!shouldForceWin || realWin) {
          return {
            decided: true,
            win: !!realWin,
            fabricated: false,
            sourceMode: 'natural',
            entry: pair.prev,
            exit: pair.curr,
          };
        }

        const step = getMinStep(mkt);
        const adjustedExit: VirtTick =
          st === 'only_up'
            ? { ...pair.curr, quote: Number((pair.prev.quote + step).toFixed(10)) }
            : { ...pair.curr, quote: Number((pair.prev.quote - step).toFixed(10)) };

        return {
          decided: true,
          win: true,
          fabricated: true,
          sourceMode: 'natural',
          entry: pair.prev,
          exit: adjustedExit,
        };
      }
      await sleep(25);
    }
    return { decided: false };
  }

  const requiredPoints = Math.max(2, dur);
  const forceMatchesWin = st === 'matches' && sessionLossesRef.current >= MAX_SESSION_LOSSES;
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

  const t0 = Date.now();
  while (isRunningRef.current && Date.now() - t0 < MATCH_WAIT_MS) {
    const window = getRecentWindow(tickBufferRef, requiredPoints);
    if (window && windowWinsForStrategy(st, barrier, window, mkt)) {
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
    const forcedDigit = isNum(barrier) ? barrier : undefined;
    return {
      decided: true,
      win: true,
      fabricated: true,
      sourceMode: 'natural',
      entry: window[0],
      exit: window[window.length - 1],
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

  if (st === 'matches' || st === 'only_up' || st === 'only_down') return;

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
