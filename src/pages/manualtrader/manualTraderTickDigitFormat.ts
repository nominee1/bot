/**
 * Last-digit tick formatting for `ManualTrader.tsx` only (`manualTrader*` prefix).
 */
import { api_base } from '@/external/bot-skeleton';

function manualTraderFallbackDigitDecimals(market: string): number {
  if (['JD10', 'JD25', 'JD50', 'JD75', 'JD100'].includes(market)) return 2;
  if (['R_10', 'R_25', '1HZ10V', '1HZ15V', '1HZ25V', '1HZ30V', '1HZ90V'].includes(market)) return 3;
  if (['R_50', 'R_75'].includes(market)) return 4;
  return 2;
}

export function manualTraderResolveDigitTickDecimals(market: string): number {
  const pipSizes = api_base.pip_sizes as Record<string, number> | undefined;
  const pip = pipSizes?.[market];
  if (typeof pip === 'number' && Number.isFinite(pip) && pip >= 0 && pip <= 16) {
    return Math.round(pip);
  }
  return manualTraderFallbackDigitDecimals(market);
}

export function manualTraderFormatQuoteForDigitContract(price: number, market: string): string {
  return price.toFixed(manualTraderResolveDigitTickDecimals(market));
}

export function manualTraderLastDigitFromQuote(price: number, market: string): number {
  return parseInt(manualTraderFormatQuoteForDigitContract(price, market).slice(-1), 10);
}
