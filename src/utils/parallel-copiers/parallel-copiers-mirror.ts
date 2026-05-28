import { api_base } from '@/external/bot-skeleton';
import { adjustTradeOptionsForLoginid } from '@/components/shared/utils/trading/dual-account-trade';
import { extractBuyContractId } from '@/components/shared/utils/trading/dual-account-mirror';
import { isDerivOptionsOAuthSession } from '@/components/shared/utils/login/deriv-oauth-storage';
import {
    getParallelCopiersForMirror,
    isParallelCopyTradeEnabled,
} from '@/utils/parallel-copiers/parallel-copiers-storage';
import {
    getCopierContractMap,
    registerCopierContractPair,
} from '@/utils/parallel-copiers/parallel-copiers-contract-registry';
import { tradeOptionToBuy } from '@/external/bot-skeleton/services/tradeEngine/utils/helpers';
import {
    buildDerivSessionProposalPayload,
    type TDerivBuyIntentBase,
} from '@/components/shared/utils/trading/deriv-session-contract-purchase';

function adjustLegacyBuyParameters(
    parameters: Record<string, unknown>,
    loginid: string
): Record<string, unknown> {
    const adjusted = adjustTradeOptionsForLoginid(
        { currency: typeof parameters.currency === 'string' ? parameters.currency : 'USD' },
        loginid
    );
    return { ...parameters, currency: adjusted.currency ?? parameters.currency };
}

export type TCopierMirrorResult = { loginid: string; mirrorId: string | null };

async function executeLegacyBuyOnCopier(
    copier: { loginid: string },
    request: Record<string, unknown>
): Promise<TCopierMirrorResult> {
    const copierApi = await api_base.getCopierTradingApi(copier.loginid);
    if (!copierApi) return { loginid: copier.loginid, mirrorId: null };

    const parameters = request.parameters;
    if (request.buy !== 1 || !parameters || typeof parameters !== 'object') {
        return { loginid: copier.loginid, mirrorId: null };
    }

    const adjustedParams = adjustLegacyBuyParameters(parameters as Record<string, unknown>, copier.loginid);
    const mirrorRequest: Record<string, unknown> = {
        buy: 1,
        price: request.price,
        parameters: adjustedParams,
    };

    try {
        const mirrorResp = await copierApi.send(mirrorRequest);
        return { loginid: copier.loginid, mirrorId: extractBuyContractId(mirrorResp) };
    } catch {
        return { loginid: copier.loginid, mirrorId: null };
    }
}

/** Fire legacy mirror buys on all copiers at the same time as the primary (no wait for primary). */
export async function executeLegacyDirectBuyToAllCopiersConcurrent(
    request: Record<string, unknown>
): Promise<TCopierMirrorResult[]> {
    if (!isParallelCopyTradeEnabled() || isDerivOptionsOAuthSession()) return [];

    const parameters = request.parameters;
    if (request.buy !== 1 || !parameters || typeof parameters !== 'object') return [];

    const copiers = getParallelCopiersForMirror(api_base.account_id);
    if (!copiers.length) return [];

    return Promise.all(copiers.map(copier => executeLegacyBuyOnCopier(copier, request)));
}

export function linkLegacyCopierMirrorsToPrimary(primaryId: string, results: TCopierMirrorResult[]): void {
    if (!primaryId) return;
    for (const { loginid, mirrorId } of results) {
        if (mirrorId) registerCopierContractPair(primaryId, loginid, mirrorId);
    }
}

/** Mirror a legacy `buy` to every configured copier account. */
export async function mirrorLegacyDirectBuyToAllCopiers(
    request: Record<string, unknown>,
    primaryResponse: unknown
): Promise<void> {
    if (!isParallelCopyTradeEnabled() || isDerivOptionsOAuthSession()) return;

    const parameters = request.parameters;
    if (request.buy !== 1 || !parameters || typeof parameters !== 'object') return;

    const primaryId = extractBuyContractId(primaryResponse);
    const copiers = getParallelCopiersForMirror(api_base.account_id);
    if (!copiers.length) return;

    const results = await executeLegacyDirectBuyToAllCopiersConcurrent(request);
    if (primaryId) linkLegacyCopierMirrorsToPrimary(primaryId, results);
}

async function executeSessionBuyOnCopier(
    copier: { loginid: string },
    intent: TDerivBuyIntentBase
): Promise<TCopierMirrorResult> {
    const copierApi = await api_base.getCopierTradingApi(copier.loginid);
    if (!copierApi) return { loginid: copier.loginid, mirrorId: null };

    const mirrorIntent: TDerivBuyIntentBase = {
        ...intent,
        currency:
            adjustTradeOptionsForLoginid({ currency: intent.currency ?? 'USD' }, copier.loginid).currency ??
            intent.currency,
    };

    try {
        const send = (data: Record<string, unknown>) => copierApi.send(data) as Promise<unknown>;
        let mirrorResp: unknown;
        if (isDerivOptionsOAuthSession()) {
            const propResp = (await send(buildDerivSessionProposalPayload(mirrorIntent))) as {
                proposal?: { id?: string; ask_price?: unknown };
                error?: unknown;
            };
            if (propResp?.error) return { loginid: copier.loginid, mirrorId: null };
            const pid = propResp?.proposal?.id;
            if (!pid) return { loginid: copier.loginid, mirrorId: null };
            const ask = Number(propResp.proposal?.ask_price ?? mirrorIntent.stake);
            mirrorResp = await send({
                buy: String(pid),
                price: Math.max(mirrorIntent.stake, Number.isFinite(ask) ? ask : mirrorIntent.stake),
            });
        } else {
            mirrorResp = await send({
                buy: 1,
                price: mirrorIntent.stake,
                parameters: {
                    amount: mirrorIntent.stake,
                    basis: mirrorIntent.basis ?? 'stake',
                    currency: mirrorIntent.currency ?? 'USD',
                    contract_type: mirrorIntent.contract_type,
                    duration_unit: mirrorIntent.duration_unit ?? 't',
                    symbol: mirrorIntent.market,
                    ...(typeof mirrorIntent.duration === 'number' && Number.isFinite(mirrorIntent.duration)
                        ? { duration: mirrorIntent.duration }
                        : {}),
                    ...(mirrorIntent.barrier !== undefined && mirrorIntent.barrier !== null
                        ? {
                              barrier:
                                  typeof mirrorIntent.barrier === 'number'
                                      ? String(mirrorIntent.barrier)
                                      : mirrorIntent.barrier,
                          }
                        : {}),
                    ...(mirrorIntent.extras ?? {}),
                },
            });
        }
        return { loginid: copier.loginid, mirrorId: extractBuyContractId(mirrorResp) };
    } catch {
        return { loginid: copier.loginid, mirrorId: null };
    }
}

/** Fire session mirror buys on all copiers concurrently with the primary trade. */
export async function executeSessionContractPurchaseToAllCopiersConcurrent(
    intent: TDerivBuyIntentBase
): Promise<TCopierMirrorResult[]> {
    if (!isParallelCopyTradeEnabled()) return [];

    const copiers = getParallelCopiersForMirror(api_base.account_id);
    if (!copiers.length) return [];

    return Promise.all(copiers.map(copier => executeSessionBuyOnCopier(copier, intent)));
}

export function linkSessionCopierMirrorsToPrimary(primaryId: string, results: TCopierMirrorResult[]): void {
    linkLegacyCopierMirrorsToPrimary(primaryId, results);
}

/** Mirror session-style buys (Manual Trader, BotIframe, etc.) to all copiers. */
export async function mirrorSessionContractPurchaseToAllCopiers(
    intent: TDerivBuyIntentBase,
    primaryResponse: unknown
): Promise<void> {
    if (!isParallelCopyTradeEnabled()) return;

    const primaryId = extractBuyContractId(primaryResponse);
    const results = await executeSessionContractPurchaseToAllCopiersConcurrent(intent);
    if (primaryId) linkSessionCopierMirrorsToPrimary(primaryId, results);
}

/** Mirror bot-engine buys to all copiers. */
export async function mirrorTradeOptionBuyToAllCopiers(
    contract_type: string,
    tradeOptions: Record<string, unknown>,
    primaryContractId: string | null
): Promise<void> {
    if (!isParallelCopyTradeEnabled() || isDerivOptionsOAuthSession() || !tradeOptions) return;

    const copiers = getParallelCopiersForMirror(api_base.account_id);
    if (!copiers.length) return;

    await Promise.all(
        copiers.map(async copier => {
            const copierApi = await api_base.getCopierTradingApi(copier.loginid);
            if (!copierApi) return;

            const adjusted = adjustTradeOptionsForLoginid(tradeOptions, copier.loginid);
            const payload = tradeOptionToBuy(contract_type, adjusted);

            try {
                const response = await copierApi.send(payload);
                const mirrorId = extractBuyContractId(response);
                if (primaryContractId && mirrorId) {
                    registerCopierContractPair(primaryContractId, copier.loginid, mirrorId);
                }
            } catch {
                /* noop */
            }
        })
    );
}

/** Sell all copier contracts linked to a primary contract. */
export async function mirrorSellAllCopiersForPrimary(primaryContractId: string, price = 0): Promise<void> {
    if (!isParallelCopyTradeEnabled() || !primaryContractId) return;

    const copierContracts = getCopierContractMap(primaryContractId);
    if (!copierContracts.size) return;

    await Promise.all(
        [...copierContracts.entries()].map(async ([loginid, contractId]) => {
            const copierApi = await api_base.getCopierTradingApi(loginid);
            if (!copierApi) return;
            try {
                await copierApi.send({ sell: contractId, price });
            } catch {
                /* noop */
            }
        })
    );
}
