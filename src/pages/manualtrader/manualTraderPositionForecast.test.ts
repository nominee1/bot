import type { CandlestickData } from 'lightweight-charts';
import {
  buildPositionForecast,
  detectRecentMaCross,
  FORECAST_HORIZON_MINUTES,
} from '@/pages/manualtrader/manualTraderPositionForecast';

function candle(time: number, close: number, open = close): CandlestickData {
  return { time: time as CandlestickData['time'], open, high: close + 1, low: close - 1, close };
}

/** Drift lower then sharp rally so MA 9 crosses above MA 21 on a recent bar. */
function buildRecentBullishCrossCandles(): CandlestickData[] {
  const out: CandlestickData[] = [];
  const base = 1_700_000_000;
  for (let i = 0; i < 32; i++) {
    const close = 120 - i * 0.35;
    out.push(candle(base + i * 60, close, close + 0.1));
  }
  for (let i = 0; i < 14; i++) {
    const close = 108.8 + i * 1.6;
    out.push(candle(base + (32 + i) * 60, close, close - 0.4));
  }
  return out;
}

describe('manualTraderPositionForecast', () => {
  it('returns null when history is too short for MA 21', () => {
    const short: CandlestickData[] = [];
    for (let i = 0; i < 10; i++) short.push(candle(1_700_000_000 + i * 60, 100 + i));
    expect(buildPositionForecast(short)).toBeNull();
  });

  it('arms forecast after a detectable 9/21 cross', () => {
    const candles = buildRecentBullishCrossCandles();
    const cross = detectRecentMaCross(candles);
    expect(cross).not.toBeNull();
    const forecast = buildPositionForecast(candles);
    expect(forecast).not.toBeNull();
    expect(forecast?.slots).toHaveLength(FORECAST_HORIZON_MINUTES);
    forecast?.slots.forEach(slot => {
      expect(['up', 'down']).toContain(slot.direction);
      expect(slot.strength).toBeGreaterThan(0);
    });
    expect(Number.isFinite(forecast?.entry.price)).toBe(true);
    expect(['CALL', 'PUT']).toContain(forecast?.entry.contractType);
  });

  it('biases bullish cross toward down on the first projected minute', () => {
    const forecast = buildPositionForecast(buildRecentBullishCrossCandles());
    expect(forecast?.cross.type).toBe('bullish');
    expect(forecast?.slots[0].direction).toBe('down');
  });
});
