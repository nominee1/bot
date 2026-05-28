import type { CandlestickData, LineData, Time } from 'lightweight-charts';
import { computeSmaFromCandles } from '@/pages/manualtrader/manualTraderChartIndicators';

export type ForecastDirection = 'up' | 'down';

export type MaCrossEvent = {
  type: 'bullish' | 'bearish';
  /** Completed bars since the cross (0 = cross on the latest closed bar). */
  barsAgo: number;
};

export type ForecastCandleSlot = {
  minuteOffset: 1 | 2 | 3;
  direction: ForecastDirection;
  /** 0–1 conviction for UI emphasis. */
  strength: number;
};

export type ForecastEntryHint = {
  /** Suggested spot to enter before the forecast window plays out. */
  price: number;
  contractType: 'CALL' | 'PUT';
  label: 'Rise' | 'Fall';
};

export type PositionForecastResult = {
  cross: MaCrossEvent | null;
  mode: 'ma_cross' | 'alternatives';
  slots: ForecastCandleSlot[];
  entry: ForecastEntryHint;
};

export type PositionForecastConfig = {
  useRsiSignal?: boolean;
  useStructureSignal?: boolean;
};

export const MA_FORECAST_FAST_PERIOD = 9;
export const MA_FORECAST_SLOW_PERIOD = 21;
/** Forecast stays armed for this many 1m bars after a 9/21 cross. */
export const MA_CROSS_MAX_BARS_AGO = 8;
export const FORECAST_HORIZON_MINUTES = 3;

const MOMENTUM_LOOKBACK_BARS = 5;
const RSI_PERIOD = 7;
const STRUCTURE_LOOKBACK_BARS = 4;

function smaLookup(candles: CandlestickData[], period: number): Map<number, number> {
  const line = computeSmaFromCandles(candles, period);
  return new Map(line.map(p => [Number(p.time), p.value]));
}

function maValueAt(lookup: Map<number, number>, candle: CandlestickData): number | null {
  const v = lookup.get(Number(candle.time));
  return v !== undefined && Number.isFinite(v) ? v : null;
}

/** Most recent MA 9 / 21 cross within the lookback window, if any. */
export function detectRecentMaCross(
  candles: CandlestickData[],
  fastPeriod = MA_FORECAST_FAST_PERIOD,
  slowPeriod = MA_FORECAST_SLOW_PERIOD,
  maxBarsAgo = MA_CROSS_MAX_BARS_AGO
): MaCrossEvent | null {
  if (candles.length < slowPeriod + 2) return null;

  const fastMap = smaLookup(candles, fastPeriod);
  const slowMap = smaLookup(candles, slowPeriod);
  const lastIdx = candles.length - 1;
  const startIdx = Math.max(1, lastIdx - maxBarsAgo);

  for (let i = lastIdx; i >= startIdx; i--) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const f0 = maValueAt(fastMap, prev);
    const s0 = maValueAt(slowMap, prev);
    const f1 = maValueAt(fastMap, curr);
    const s1 = maValueAt(slowMap, curr);
    if (f0 === null || s0 === null || f1 === null || s1 === null) continue;

    if (f0 <= s0 && f1 > s1) {
      return { type: 'bullish', barsAgo: lastIdx - i };
    }
    if (f0 >= s0 && f1 < s1) {
      return { type: 'bearish', barsAgo: lastIdx - i };
    }
  }

  return null;
}

/** Signed short-term momentum from recent 1m bodies and close drift. */
export function computeShortTermMomentum(candles: CandlestickData[], lookback = MOMENTUM_LOOKBACK_BARS): number {
  const n = candles.length;
  if (n < 2) return 0;

  const lb = Math.min(lookback, n - 1);
  let bodyScore = 0;
  for (let i = n - lb; i < n; i++) {
    bodyScore += candles[i].close - candles[i].open;
  }

  const closeDrift = candles[n - 1].close - candles[n - 1 - lb].close;
  const combined = bodyScore + closeDrift;
  if (combined === 0) return 0;
  return Math.sign(combined);
}

/** RSI sign for reversal tendency: overbought -> down, oversold -> up, neutral -> 0. */
export function computeRsiReversalSignal(candles: CandlestickData[], period = RSI_PERIOD): number {
  if (candles.length < period + 1) return 0;
  let gains = 0;
  let losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    const delta = candles[i].close - prevClose;
    if (delta > 0) gains += delta;
    else losses += Math.abs(delta);
  }
  if (gains === 0 && losses === 0) return 0;
  if (losses === 0) return -1;
  const rs = gains / losses;
  const rsi = 100 - 100 / (1 + rs);
  if (rsi >= 68) return -1;
  if (rsi <= 32) return 1;
  return 0;
}

/** Micro structure sign from recent 1m highs/lows. */
export function computeMicroStructureSignal(
  candles: CandlestickData[],
  lookbackBars = STRUCTURE_LOOKBACK_BARS
): number {
  if (candles.length < lookbackBars + 1) return 0;
  let upVotes = 0;
  let downVotes = 0;
  for (let i = candles.length - lookbackBars + 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    if (curr.high > prev.high && curr.low > prev.low) upVotes += 1;
    if (curr.high < prev.high && curr.low < prev.low) downVotes += 1;
  }
  if (upVotes === downVotes) return 0;
  return upVotes > downVotes ? 1 : -1;
}

/**
 * After a 9/21 cross, bias toward a short reversal while still respecting momentum.
 * Returns null when no qualifying cross is in the lookback window.
 */
export function buildPositionForecast(
  candles: CandlestickData[],
  fastPeriod = MA_FORECAST_FAST_PERIOD,
  slowPeriod = MA_FORECAST_SLOW_PERIOD,
  config: PositionForecastConfig = {}
): PositionForecastResult | null {
  const cross = detectRecentMaCross(candles, fastPeriod, slowPeriod);
  const useAltOnly = !cross && !!(config.useRsiSignal || config.useStructureSignal);
  if (!cross && !useAltOnly) return null;

  const momentumSign = computeShortTermMomentum(candles);
  const rsiSignal = config.useRsiSignal ? computeRsiReversalSignal(candles) : 0;
  const structureSignal = config.useStructureSignal ? computeMicroStructureSignal(candles) : 0;
  const reversalDir: ForecastDirection = cross?.type === 'bullish' ? 'down' : 'up';
  const momentumDir: ForecastDirection = momentumSign >= 0 ? 'up' : 'down';

  const slots: ForecastCandleSlot[] = [];
  for (let k = 1; k <= FORECAST_HORIZON_MINUTES; k++) {
    const reversalWeight = cross ? 0.78 - 0.11 * (k - 1) : 0;
    const optionalSignalWeight = cross ? 0.17 + 0.08 * (k - 1) : 0.52 + 0.12 * (k - 1);
    const momWeight = Math.max(cross ? 0.14 : 0.28, 1 - reversalWeight - optionalSignalWeight);
    const extraWeight = 1 - reversalWeight - momWeight;
    const revScore = reversalDir === 'up' ? reversalWeight : -reversalWeight;
    const momScore =
      momentumSign === 0 ? 0 : momentumDir === 'up' ? momWeight : -momWeight;
    let extraScore = 0;
    if (config.useRsiSignal && config.useStructureSignal) {
      const avg = (rsiSignal + structureSignal) / 2;
      extraScore = avg * extraWeight;
    } else if (config.useRsiSignal) {
      extraScore = rsiSignal * extraWeight;
    } else if (config.useStructureSignal) {
      extraScore = structureSignal * extraWeight;
    }

    const total = revScore + momScore + extraScore;
    const direction: ForecastDirection = total >= 0 ? 'up' : 'down';
    slots.push({
      minuteOffset: k as 1 | 2 | 3,
      direction,
      strength: Math.min(1, Math.abs(total)),
    });
  }

  const entry = buildForecastEntryHint(candles, slots);
  return { cross, mode: cross ? 'ma_cross' : 'alternatives', slots, entry };
}

/** Favourable entry vs last close: dip before predicted rise, rally before predicted fall. */
export function buildForecastEntryHint(
  candles: CandlestickData[],
  slots: ForecastCandleSlot[]
): ForecastEntryHint {
  const last = candles[candles.length - 1];
  const upVotes = slots.filter(s => s.direction === 'up').length;
  const biasUp = upVotes >= 2 || (upVotes === 1 && slots[0]?.direction === 'up');
  const contractType = biasUp ? 'CALL' : 'PUT';

  const ranges = candles.slice(-5).map(c => c.high - c.low);
  const avgRange =
    ranges.length > 0
      ? ranges.reduce((a, b) => a + b, 0) / ranges.length
      : Math.abs(last.close) * 0.0003;
  const step = Math.max(avgRange * 0.35, Number.EPSILON);
  const pull = step * 0.5;

  const price =
    contractType === 'CALL'
      ? Math.min(last.close, last.low + pull * 0.25, last.close - pull)
      : Math.max(last.close, last.high - pull * 0.25, last.close + pull);

  return {
    price,
    contractType,
    label: contractType === 'CALL' ? 'Rise' : 'Fall',
  };
}

/** Projected close path for chart overlay (3 future 1m steps). */
export function buildForecastProjectionLine(
  candles: CandlestickData[],
  forecast: PositionForecastResult,
  bucketSec = 60
): LineData<Time>[] {
  if (!candles.length || !forecast.slots.length) return [];

  const last = candles[candles.length - 1];
  const lastTime = Number(last.time);
  if (!Number.isFinite(lastTime)) return [];

  const ranges = candles.slice(-5).map(c => c.high - c.low);
  const avgRange =
    ranges.length > 0 ? ranges.reduce((a, b) => a + b, 0) / ranges.length : Math.abs(last.close) * 0.0003;
  const step = Math.max(avgRange * 0.35, Number.EPSILON);

  const out: LineData<Time>[] = [{ time: last.time, value: last.close }];
  let price = last.close;

  for (const slot of forecast.slots) {
    price += slot.direction === 'up' ? step : -step;
    out.push({
      time: (lastTime + slot.minuteOffset * bucketSec) as Time,
      value: price,
    });
  }

  return out;
}
