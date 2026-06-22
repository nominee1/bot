import { isDerivOptionsOAuthSession } from '@/components/shared/utils/login/deriv-oauth-storage';

/** Underlyings that accept digit proposals on the Options trading WebSocket (`underlying_symbol`). */
export const DERIV_OPTIONS_DIGIT_UNDERLYINGS = [
    'R_10',
    '1HZ10V',
    'R_25',
    '1HZ25V',
    'R_50',
    '1HZ50V',
    'R_75',
    '1HZ75V',
    'R_100',
    '1HZ100V',
] as const;

export const DERIV_OPTIONS_DEFAULT_DIGIT_MARKET = '1HZ10V';

/** 1s vol indices offered on legacy WS but rejected by Options API (`InvalidInputAsset`). */
export const LEGACY_ONLY_1S_VOL_UNDERLYINGS = ['1HZ15V', '1HZ30V', '1HZ90V'] as const;

const OPTIONS_DIGIT_SET = new Set<string>(DERIV_OPTIONS_DIGIT_UNDERLYINGS);

export function isDerivOptionsDigitUnderlying(symbol: string): boolean {
    return OPTIONS_DIGIT_SET.has(String(symbol ?? '').trim());
}

export function isOptionsSessionActive(options?: { optionsSession?: boolean }): boolean {
    return options?.optionsSession ?? isDerivOptionsOAuthSession();
}

/** Map legacy-only markets to the closest Options-supported symbol when on Options OAuth. */
export function resolveTradableDigitMarket(market: string, options?: { optionsSession?: boolean }): string {
    const m = String(market ?? '').trim();
    const isOptions = isOptionsSessionActive(options);
    if (!m) return DERIV_OPTIONS_DEFAULT_DIGIT_MARKET;
    if (!isOptions) return m;
    return isDerivOptionsDigitUnderlying(m) ? m : DERIV_OPTIONS_DEFAULT_DIGIT_MARKET;
}

export function filterMarketOptionsForSession<T extends { value: string }>(
    marketOptions: readonly T[],
    options?: { optionsSession?: boolean }
): T[] {
    if (!isOptionsSessionActive(options)) return [...marketOptions];
    return marketOptions.filter(row => isDerivOptionsDigitUnderlying(row.value));
}

export function getTradableDigitMarketsForSession(options?: { optionsSession?: boolean }): string[] {
    if (!isOptionsSessionActive(options)) {
        return [...DERIV_OPTIONS_DIGIT_UNDERLYINGS, ...LEGACY_ONLY_1S_VOL_UNDERLYINGS];
    }
    return [...DERIV_OPTIONS_DIGIT_UNDERLYINGS];
}

export function formatDerivTradeErrorMessage(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') {
        return error instanceof Error ? error.message : error != null ? String(error) : undefined;
    }
    const row = error as Record<string, unknown>;
    const nested = row.error;
    const code =
        (typeof row.code === 'string' && row.code) ||
        (nested && typeof nested === 'object' && typeof (nested as { code?: string }).code === 'string'
            ? (nested as { code: string }).code
            : '');
    const message =
        (typeof row.message === 'string' && row.message) ||
        (nested && typeof nested === 'object' && typeof (nested as { message?: string }).message === 'string'
            ? (nested as { message: string }).message
            : '');

    if (code === 'InvalidInputAsset' || /not offered for this asset/i.test(message)) {
        return 'This market is not available on Options accounts. Use Vol 10, 25, 50, 75, or 100 (1s or standard).';
    }

    return message || undefined;
}
