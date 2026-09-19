/**
 * Last-digit tick formatting for `flipaa.tsx` only (`flipaa*` prefix).
 */
import { api_base } from '@/external/bot-skeleton';

function flipaaFallbackDigitDecimals(market: string): number {
    if (['JD10', 'JD25', 'JD50', 'JD75', 'JD100'].includes(market)) return 2;
    if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(market)) return 3;
    if (['R_50', 'R_75'].includes(market)) return 4;
    return 2;
}

export function flipaaResolveDigitTickDecimals(market: string): number {
    const pipSizes = api_base.pip_sizes as Record<string, number> | undefined;
    const pip = pipSizes?.[market];
    if (typeof pip === 'number' && Number.isFinite(pip) && pip >= 0 && pip <= 16) {
        return Math.round(pip);
    }
    return flipaaFallbackDigitDecimals(market);
}

export function flipaaFormatQuoteForDigitContract(price: number, market: string): string {
    return price.toFixed(flipaaResolveDigitTickDecimals(market));
}

export function flipaaLastDigitFromQuote(price: number, market: string): number {
    return parseInt(flipaaFormatQuoteForDigitContract(price, market).slice(-1), 10);
}

function resolveTickNumber(value?: number | null, display?: string | null): number | null {
    if (value != null && Number.isFinite(value)) return value;
    if (display == null || display === '') return null;
    const n = Number.parseFloat(String(display));
    return Number.isFinite(n) ? n : null;
}

/** Pad to market pip decimals — never trust raw Deriv display for last-digit UI. */
export function flipaaFormatTickForDisplay(value?: number | null, market?: string, display?: string | null): string {
    const n = resolveTickNumber(value, display);
    if (n == null) return display?.trim() || '—';
    return flipaaFormatQuoteForDigitContract(n, market || '');
}

export function flipaaLastDigitFromTick(
    value?: number | null,
    market?: string,
    display?: string | null
): number | null {
    const n = resolveTickNumber(value, display);
    if (n == null) return null;
    const d = flipaaLastDigitFromQuote(n, market || '');
    return Number.isFinite(d) ? d : null;
}
