/**
 * Deriv Options REST bulk purchase — V2 successor to WS `buy_contract_for_multiple_accounts`.
 * @see https://developers.deriv.com/docs/trading/bulk-purchase/
 *
 * POST /trading/v1/options/contracts/bulk-purchase/{real|demo}
 * Same contract params for up to 100 accounts per request.
 */
import { getDerivOAuthClientId } from '@/components/shared/utils/config/config';
import {
    getDerivOptionsRestBase,
    isDerivOptionsBearerToken,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import { isVirtualLoginid } from '@/components/shared/utils/login/pick-default-account';
import {
    buildDerivSessionDirectBuyPayloadForLoginid,
    type TDerivBuyIntentBase,
} from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import { extractBuyContractId } from '@/components/shared/utils/trading/dual-account-mirror';
import { adjustTradeOptionsForLoginid } from '@/components/shared/utils/trading/dual-account-trade';
import {
    getCopierDerivAppId,
    getCopierToken,
    resolveOptionsDerivAppIdForLoginid,
    type TParallelCopier,
} from '@/utils/parallel-copiers/parallel-copiers-storage';

export const BULK_PURCHASE_MAX_ACCOUNTS = 100;

export type TBulkPurchaseAccountResult = {
    loginid: string;
    mirrorId: string | null;
    error?: string;
};

type TBulkPurchaseAccount = {
    token: string;
    account: string;
};

function chunkArray<T>(items: T[], size: number): T[][] {
    if (size <= 0) return [items];
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

function resolveBulkAppId(copiers: TParallelCopier[]): string {
    for (const c of copiers) {
        const fromCopier = getCopierDerivAppId(c.loginid) ?? resolveOptionsDerivAppIdForLoginid(c.loginid);
        if (fromCopier?.trim()) return fromCopier.trim();
    }
    return getDerivOAuthClientId();
}

function isDemoCopier(copier: TParallelCopier): boolean {
    return copier.is_virtual || isVirtualLoginid(copier.loginid);
}

function resolveCopierBearerToken(copier: TParallelCopier): string | null {
    const token = (getCopierToken(copier.loginid) ?? copier.token ?? '').trim();
    if (!token || token === 'MOON_VIRTUAL' || token === 'MOON_LEAD_VIRTUAL') return null;
    if (!isDerivOptionsBearerToken(token)) return null;
    return token;
}

function buildBulkParameters(
    intent: TDerivBuyIntentBase,
    sampleLoginid: string
): {
    price: number;
    parameters: Record<string, unknown>;
} {
    const currency =
        adjustTradeOptionsForLoginid({ currency: intent.currency ?? 'USD' }, sampleLoginid).currency ??
        intent.currency ??
        'USD';
    const payload = buildDerivSessionDirectBuyPayloadForLoginid({ ...intent, currency }, sampleLoginid);
    const parameters = (payload.parameters ?? {}) as Record<string, unknown>;
    // Bulk REST expects Options-style market field.
    if (!parameters.underlying_symbol && typeof parameters.symbol === 'string') {
        parameters.underlying_symbol = parameters.symbol;
        delete parameters.symbol;
    }
    const price = Number(payload.price ?? intent.stake);
    return {
        price: Number.isFinite(price) && price > 0 ? price : intent.stake,
        parameters,
    };
}

function parseTransactionLoginid(row: Record<string, unknown>, fallback: string): string {
    const candidates = [row.account, row.loginid, row.account_id, row.accountId];
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return fallback;
}

function parseTransactionContractId(row: Record<string, unknown>): string | null {
    const coerce = (value: unknown): string | null => {
        if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
        if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim();
        return null;
    };
    // Official bulk-purchase success shape: top-level contract_id
    // @see https://developers.deriv.com/schemas/bulk_purchase_response.schema.json
    const nested = [row.buy, row.result, row.purchase, row.contract, row.data];
    const candidates: unknown[] = [row.contract_id, row.contractId];
    for (const n of nested) {
        if (n && typeof n === 'object' && !Array.isArray(n)) {
            const o = n as Record<string, unknown>;
            candidates.push(o.contract_id, o.contractId);
        }
    }
    for (const c of candidates) {
        const id = coerce(c);
        if (id) return id;
    }
    const fromBuy = extractBuyContractId({ buy: row.buy });
    if (fromBuy) return fromBuy;
    return extractBuyContractId(row);
}

function parseTransactionError(row: Record<string, unknown>): string | undefined {
    const err = row.error;
    if (!err) return undefined;
    if (typeof err === 'string') return err;
    if (typeof err === 'object' && err !== null) {
        const msg = (err as { message?: unknown }).message;
        if (typeof msg === 'string' && msg.trim()) return msg.trim();
    }
    return 'Bulk purchase failed for account';
}

async function postBulkPurchaseChunk(input: {
    accountType: 'real' | 'demo';
    appId: string;
    accounts: TBulkPurchaseAccount[];
    price: number;
    parameters: Record<string, unknown>;
}): Promise<TBulkPurchaseAccountResult[]> {
    const url = `${getDerivOptionsRestBase()}/contracts/bulk-purchase/${input.accountType}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Deriv-App-ID': input.appId,
        },
        body: JSON.stringify({
            accounts: input.accounts.map(a => ({
                token: a.token,
                account_id: a.account,
            })),
            // Deriv REST schema requires `contract_parameters` (not `parameters` / top-level `price`).
            // @see https://developers.deriv.com/docs/trading/bulk-purchase/
            contract_parameters: (() => {
                const params: Record<string, unknown> = {
                    ...input.parameters,
                    amount: input.parameters.amount ?? input.price,
                };
                delete params.price;
                return params;
            })(),
        }),
    });

    const text = await res.text();
    let body: unknown = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = null;
    }

    if (!res.ok) {
        const msg =
            body && typeof body === 'object' && Array.isArray((body as { errors?: unknown }).errors)
                ? String(
                      (body as { errors: Array<{ message?: string }> }).errors[0]?.message ??
                          `Bulk purchase HTTP ${res.status}`
                  )
                : `Bulk purchase HTTP ${res.status}`;
        throw new Error(msg);
    }

    const root = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const dataObj =
        root.data && typeof root.data === 'object' && !Array.isArray(root.data)
            ? (root.data as Record<string, unknown>)
            : null;
    const transactions = Array.isArray(root.transactions)
        ? root.transactions
        : Array.isArray(dataObj?.transactions)
          ? dataObj!.transactions
          : Array.isArray(root.data)
            ? root.data
            : Array.isArray(root.results)
              ? root.results
              : [];

    const byIndexFallback = input.accounts.map(a => a.account);
    return transactions.map((item, index) => {
        const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        const loginid = parseTransactionLoginid(row, byIndexFallback[index] ?? `unknown_${index}`);
        const error = parseTransactionError(row);
        if (error) {
            return { loginid, mirrorId: null, error };
        }
        return { loginid, mirrorId: parseTransactionContractId(row) };
    });
}

/**
 * Buy the same Options contract for many armed copier accounts via REST bulk-purchase.
 * Splits real/demo and chunks of 100. Returns per-loginid results (null mirrorId on failure).
 */
export async function executeOptionsBulkPurchaseForCopiers(
    copiers: TParallelCopier[],
    intent: TDerivBuyIntentBase
): Promise<TBulkPurchaseAccountResult[]> {
    const eligible: Array<TParallelCopier & { token: string }> = [];
    for (const copier of copiers) {
        const token = resolveCopierBearerToken(copier);
        if (!token) continue;
        eligible.push({ ...copier, token });
    }
    if (!eligible.length) return [];

    const appId = resolveBulkAppId(eligible);
    const sampleLoginid = eligible[0].loginid;
    const { price, parameters } = buildBulkParameters(intent, sampleLoginid);

    const real = eligible.filter(c => !isDemoCopier(c));
    const demo = eligible.filter(c => isDemoCopier(c));
    const results: TBulkPurchaseAccountResult[] = [];

    const runGroup = async (group: Array<TParallelCopier & { token: string }>, accountType: 'real' | 'demo') => {
        for (const chunk of chunkArray(group, BULK_PURCHASE_MAX_ACCOUNTS)) {
            const accounts: TBulkPurchaseAccount[] = chunk.map(c => ({
                token: c.token,
                account: c.loginid,
            }));
            const chunkResults = await postBulkPurchaseChunk({
                accountType,
                appId,
                accounts,
                price,
                parameters,
            });
            // Prefer API loginids; fill any missing accounts as failed so callers see full set.
            const seen = new Set(chunkResults.map(r => r.loginid.toUpperCase()));
            results.push(...chunkResults);
            for (const c of chunk) {
                if (!seen.has(c.loginid.toUpperCase())) {
                    results.push({ loginid: c.loginid, mirrorId: null, error: 'No bulk purchase result' });
                }
            }
        }
    };

    if (real.length) await runGroup(real, 'real');
    if (demo.length) await runGroup(demo, 'demo');

    return results;
}
