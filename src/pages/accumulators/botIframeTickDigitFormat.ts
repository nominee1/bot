/**
 * Digit tick formatting used ONLY by `BotIframe.tsx` (last-digit contracts / analysis).
 * Names are prefixed so shared `@/utils/*` tick helpers cannot be mistaken for this logic.
 */
import { api_base } from '@/external/bot-skeleton';

function botIframeFallbackDigitDecimals(market: string): number {
  if (['JD10', 'JD25', 'JD50', 'JD75', 'JD100'].includes(market)) return 2;
  if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(market)) return 3;
  if (['R_50', 'R_75'].includes(market)) return 4;
  return 2;
}

/** Pip decimals from Deriv `active_symbols` (`api_base.pip_sizes`), same idea as DBot `getPipSize()`. */
export function botIframeResolveDigitTickDecimals(market: string): number {
  const pipSizes = api_base.pip_sizes as Record<string, number> | undefined;
  const pip = pipSizes?.[market];
  if (typeof pip === 'number' && Number.isFinite(pip) && pip >= 0 && pip <= 16) {
    return Math.round(pip);
  }
  return botIframeFallbackDigitDecimals(market);
}

/** Round quote like DBot before taking last digit: `tick.toFixed(pipSize)`. */
export function botIframeFormatQuoteForDigitContract(price: number, market: string): string {
  return price.toFixed(botIframeResolveDigitTickDecimals(market));
}

export function botIframeLastDigitFromQuote(price: number, market: string): number {
  return parseInt(botIframeFormatQuoteForDigitContract(price, market).slice(-1), 10);
}
