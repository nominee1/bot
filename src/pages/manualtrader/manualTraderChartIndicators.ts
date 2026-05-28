import type { CandlestickData, LineData, Time, UTCTimestamp } from 'lightweight-charts';

/** Simple moving average line on the price chart. */
export type ChartMaSpec = { period: number; color: string; label: string };

/**
 * Intraday MAs on 1-minute candles (chart uses 1m OHLC).
 * 9 / 21 / 50 ≈ TradingView-style fast / medium / trend for a 24h window.
 * 200 ≈ ~3.3h — slower filter within the same day.
 */
export const CHART_MA_SPECS: ChartMaSpec[] = [
  { period: 9, color: '#2962FF', label: 'MA 9' },
  { period: 21, color: '#f59e0b', label: 'MA 21' },
  { period: 50, color: '#e11d48', label: 'MA 50' },
  { period: 200, color: '#7c3aed', label: 'MA 200' },
];

export const CHART_MA_DEFAULT_ENABLED: Record<number, boolean> = {
  9: true,
  21: true,
  50: false,
  200: false,
};

export function computeSmaFromCandles(
  candles: CandlestickData[],
  period: number
): LineData<Time>[] {
  if (period < 1 || candles.length < period) return [];

  const out: LineData<Time>[] = [];
  let sum = 0;

  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) {
      out.push({
        time: candles[i].time as UTCTimestamp,
        value: sum / period,
      });
    }
  }

  return out;
}
