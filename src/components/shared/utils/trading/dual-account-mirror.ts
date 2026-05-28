import { api_base } from '@/external/bot-skeleton';
import {
    adjustTradeOptionsForLoginid,
    getMirrorLoginidForActive,
    isDualAccountTradeEnabled,
} from '@/components/shared/utils/trading/dual-account-trade';
import {
    registerMirrorContractPair,
    getMirrorContractId,
} from '@/components/shared/utils/trading/dual-account-contract-registry';
import {
    mirrorLegacyDirectBuyToAllCopiers,
    mirrorSellAllCopiersForPrimary,
} from '@/utils/parallel-copiers/parallel-copiers-mirror';
import {
    executeDerivSessionContractPurchase,
    type TDerivBuyIntentBase,
} from '@/components/shared/utils/trading/deriv-session-contract-purchase';

/** Set while `sendDerivSessionContractPurchase` runs — avoids double mirror from `api.send` wrapper. */
let sessionPurchaseIntentLock: TDerivBuyIntentBase | null = null;

export function isSessionPurchaseMirrorLocked(): boolean {
    return sessionPurchaseIntentLock !== null;
}

export function runWithSessionPurchaseLock<T>(intent: TDerivBuyIntentBase, fn: () => Promise<T>): Promise<T> {
    sessionPurchaseIntentLock = intent;
    return fn().finally(() => {
        sessionPurchaseIntentLock = null;
    });
}

export function extractBuyContractId(response: unknown): string | null {
    if (!response || typeof response !== 'object') return null;
    const buy = (response as { buy?: { contract_id?: unknown } }).buy;
    const id = buy?.contract_id;
    if (id == null || id === '') return null;
    return String(id);
}

function adjustLegacyBuyParameters(
    parameters: Record<string, unknown>,
    mirrorLoginid: string
): Record<string, unknown> {
    const adjusted = adjustTradeOptionsForLoginid(
        { currency: typeof parameters.currency === 'string' ? parameters.currency : 'USD' },
        mirrorLoginid
    );
    return { ...parameters, currency: adjusted.currency ?? parameters.currency };
}

/** Mirror buy on paired account — runs in parallel with primary (same timing as copytrading). */
export async function executeMirrorSessionContractPurchaseConcurrent(
    intent: TDerivBuyIntentBase
): Promise<string | null> {
    if (!isDualAccountTradeEnabled()) return null;

    const mirrorLoginid = getMirrorLoginidForActive(api_base.account_id);
    if (!mirrorLoginid) return null;

    const mirrorApi = await api_base.getMirrorTradingApi();
    if (!mirrorApi) return null;

    const mirrorIntent: TDerivBuyIntentBase = {
        ...intent,
        currency:
            adjustTradeOptionsForLoginid({ currency: intent.currency ?? 'USD' }, mirrorLoginid).currency ??
            intent.currency,
    };

    try {
        const mirrorResp = await executeDerivSessionContractPurchase(
            d => mirrorApi.send(d) as Promise<unknown>,
            mirrorIntent
        );
        return extractBuyContractId(mirrorResp);
    } catch {
        return null;
    }
}

/** Mirror buy using the same session flow as flipaa / BotIframe / etc. */
export async function mirrorSessionContractPurchase(
    intent: TDerivBuyIntentBase,
    primaryResponse: unknown
): Promise<string | null> {
    const primaryId = extractBuyContractId(primaryResponse);
    const mirrorId = await executeMirrorSessionContractPurchaseConcurrent(intent);
    if (primaryId && mirrorId) {
        registerMirrorContractPair(primaryId, mirrorId);
    }
    return mirrorId;
}

/** Start legacy mirror buy immediately (do not wait for primary response). */
export async function executeMirrorLegacyDirectBuyConcurrent(
    request: Record<string, unknown>
): Promise<string | null> {
    if (!isDualAccountTradeEnabled() || sessionPurchaseIntentLock) return null;

    const mirrorLoginid = getMirrorLoginidForActive(api_base.account_id);
    if (!mirrorLoginid) return null;

    const mirrorApi = await api_base.getMirrorTradingApi();
    if (!mirrorApi) return null;

    const parameters = request.parameters;
    if (request.buy !== 1 || !parameters || typeof parameters !== 'object') return null;

    const adjustedParams = adjustLegacyBuyParameters(parameters as Record<string, unknown>, mirrorLoginid);
    const mirrorRequest: Record<string, unknown> = {
        buy: 1,
        price: request.price,
        parameters: adjustedParams,
    };

    try {
        const mirrorResp = await mirrorApi.send(mirrorRequest);
        return extractBuyContractId(mirrorResp);
    } catch {
        return null;
    }
}

/** Mirror legacy `buy: 1` + `parameters` payloads from custom components. */
export async function mirrorLegacyDirectBuy(
    request: Record<string, unknown>,
    primaryResponse: unknown
): Promise<void> {
    const primaryId = extractBuyContractId(primaryResponse);
    const mirrorId = await executeMirrorLegacyDirectBuyConcurrent(request);
    if (primaryId && mirrorId) {
        registerMirrorContractPair(primaryId, mirrorId);
    }
}

/** Mirror sell for a primary contract_id (uses registry). */
export async function mirrorSellForPrimaryContract(primaryContractId: string, price = 0): Promise<void> {
    if (!isDualAccountTradeEnabled() || !primaryContractId) return;

    const mirrorContractId = getMirrorContractId(primaryContractId);
    if (!mirrorContractId) return;

    const mirrorApi = await api_base.getMirrorTradingApi();
    if (!mirrorApi) return;

    try {
        await mirrorApi.send({ sell: mirrorContractId, price });
    } catch {
        /* noop */
    }
}

/**
 * Wrap `api.send` on the primary trading socket so custom pages get dual trades automatically.
 */
export function wrapApiSendForDualTrade(api: {
    send: (data: unknown) => unknown;
}): void {
    const tagged = api as { __dualSendWrapped?: boolean };
    if (tagged.__dualSendWrapped) return;
    tagged.__dualSendWrapped = true;

    const originalSend = api.send.bind(api);

    api.send = (data: unknown) => {
        const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
        const isLegacyBuy =
            payload &&
            payload.buy === 1 &&
            payload.parameters &&
            typeof payload.parameters === 'object' &&
            !sessionPurchaseIntentLock;

        let dualMirrorPromise: Promise<string | null> | null = null;
        let copierMirrorPromise: Promise<import('@/utils/parallel-copiers/parallel-copiers-mirror').TCopierMirrorResult[]> | null =
            null;

        if (isLegacyBuy) {
            dualMirrorPromise = executeMirrorLegacyDirectBuyConcurrent(payload);
            copierMirrorPromise = import('@/utils/parallel-copiers/parallel-copiers-mirror').then(
                ({ executeLegacyDirectBuyToAllCopiersConcurrent }) =>
                    executeLegacyDirectBuyToAllCopiersConcurrent(payload)
            );
        }

        const result = originalSend(data);

        const linkBuyMirrors = (response: unknown) => {
            if (!payload || (response && typeof response === 'object' && (response as { error?: unknown }).error)) {
                return;
            }
            const primaryId = extractBuyContractId(response);
            if (!primaryId) return;

            if (dualMirrorPromise) {
                void dualMirrorPromise.then(mirrorId => {
                    if (mirrorId) registerMirrorContractPair(primaryId, mirrorId);
                });
            }
            if (copierMirrorPromise) {
                void copierMirrorPromise.then(results => {
                    void import('@/utils/parallel-copiers/parallel-copiers-mirror').then(
                        ({ linkLegacyCopierMirrorsToPrimary }) => linkLegacyCopierMirrorsToPrimary(primaryId, results)
                    );
                });
            }
        };

        const handleSell = (response: unknown) => {
            if (!payload || (response && typeof response === 'object' && (response as { error?: unknown }).error)) {
                return;
            }
            if ('sell' in payload && payload.sell != null && payload.sell !== '') {
                const contractId = String(payload.sell);
                const price = Number(payload.price ?? 0);
                void mirrorSellForPrimaryContract(contractId, price);
                void mirrorSellAllCopiersForPrimary(contractId, price);
            }
        };

        if (result && typeof (result as Promise<unknown>).then === 'function') {
            return (result as Promise<unknown>).then(response => {
                if (isLegacyBuy) linkBuyMirrors(response);
                else handleSell(response);
                return response;
            });
        }

        if (isLegacyBuy) linkBuyMirrors(result);
        else handleSell(result);
        return result;
    };
}

