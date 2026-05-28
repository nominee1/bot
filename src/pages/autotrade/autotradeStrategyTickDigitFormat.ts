/**
 * Last-digit tick formatting for `Strategy.tsx` (autotrade) only (`autotradeStrategy*` prefix).
 */
import { api_base } from '@/external/bot-skeleton';

function autotradeStrategyFallbackDigitDecimals(market: string): number {
  if (['JD10', 'JD25', 'JD50', 'JD75', 'JD100'].includes(market)) return 2;
  if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(market)) return 3;
  if (['R_50', 'R_75'].includes(market)) return 4;
  return 2;
}

export function autotradeStrategyResolveDigitTickDecimals(market: string): number {
  const pipSizes = api_base.pip_sizes as Record<string, number> | undefined;
  const pip = pipSizes?.[market];
  if (typeof pip === 'number' && Number.isFinite(pip) && pip >= 0 && pip <= 16) {
    return Math.round(pip);
  }
  return autotradeStrategyFallbackDigitDecimals(market);
}

export function autotradeStrategyFormatQuoteForDigitContract(price: number, market: string): string {
  return price.toFixed(autotradeStrategyResolveDigitTickDecimals(market));
}

export function autotradeStrategyLastDigitFromQuote(price: number, market: string): number {
  return parseInt(autotradeStrategyFormatQuoteForDigitContract(price, market).slice(-1), 10);
}
