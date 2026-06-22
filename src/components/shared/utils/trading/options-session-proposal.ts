import { isDerivOptionsOAuthSession } from '@/components/shared/utils/login/deriv-oauth-storage';
import { applyDerivSessionMarketField } from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import { resolveTradableDigitMarket } from '@/components/shared/utils/trading/deriv-session-markets';

/** Patch proposal payloads for Options OAuth (`underlying_symbol`) vs legacy WS (`symbol`). */
export function patchProposalPayloadForSession(payload: Record<string, unknown>): Record<string, unknown> {
    if (!payload || typeof payload !== 'object') return payload;
    const rawMarket = payload.symbol ?? payload.underlying_symbol;
    if (rawMarket == null) return payload;
    const market = resolveTradableDigitMarket(String(rawMarket));
    applyDerivSessionMarketField(payload, market);
    return payload;
}

export { isDerivOptionsOAuthSession };
