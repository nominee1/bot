/**
 * Options OAuth trading: proposal → buy(proposal_id) with `underlying_symbol`.
 * Legacy WS uses `buy: 1` + `parameters.symbol`.
 */

import { isDerivOptionsOAuthSession } from '@/components/shared/utils/login/deriv-oauth-storage';
import { resolveTradableDigitMarket } from '@/components/shared/utils/trading/deriv-session-markets';
import { logDerivTradeFailure, logDerivTradeWire } from '@/components/shared/utils/trading/deriv-trade-debug';

export type TDerivBuyIntentBase = {
    contract_type: string;
    market: string;
    duration?: number;
    stake: number;
    currency?: string;
    basis?: 'stake' | 'payout';
    barrier?: number | string;
    duration_unit?: string;
    extras?: Record<string, unknown>;
};

type TSendWire = (data: Record<string, unknown>) => Promise<unknown>;

export function applyDerivSessionMarketField(payload: Record<string, unknown>, market: string) {
    delete payload.symbol;
    delete payload.underlying_symbol;
    if (isDerivOptionsOAuthSession()) {
        payload.underlying_symbol = market;
    } else {
        payload.symbol = market;
    }
}

export function buildDerivSessionProposalPayload(
    intent: TDerivBuyIntentBase & { proposal?: number },
    opts?: {
        subscribe?: boolean;
        extra?: Record<string, unknown>;
    }
): Record<string, unknown> {
    const proposal = intent.proposal ?? 1;
    const currency = intent.currency ?? 'USD';
    const basis = intent.basis ?? 'stake';
    const duration_unit = intent.duration_unit ?? 't';
    const market = resolveTradableDigitMarket(intent.market);

    const payload: Record<string, unknown> = {
        proposal,
        amount: intent.stake,
        basis,
        currency,
        contract_type: intent.contract_type,
    };

    if (typeof intent.duration === 'number' && Number.isFinite(intent.duration)) {
        payload.duration = intent.duration;
        payload.duration_unit = duration_unit;
    }

    if (intent.barrier !== undefined && intent.barrier !== null) {
        payload.barrier = typeof intent.barrier === 'number' ? String(intent.barrier) : intent.barrier;
    }

    if (opts?.subscribe) {
        payload.subscribe = 1;
    }

    const extraMerged = { ...(intent.extras ?? {}), ...(opts?.extra ?? {}) };
    if (Object.keys(extraMerged).length) {
        Object.assign(payload, extraMerged);
    }

    applyDerivSessionMarketField(payload, market);

    return payload;
}

export function tradeOptionsToDerivBuyIntent(
    contract_type: string,
    tradeOptions: Record<string, unknown>
): TDerivBuyIntentBase {
    const intent: TDerivBuyIntentBase = {
        contract_type,
        market: String(tradeOptions.symbol ?? ''),
        stake: Number(tradeOptions.amount ?? 0),
        currency: typeof tradeOptions.currency === 'string' ? tradeOptions.currency : 'USD',
        basis: (tradeOptions.basis as TDerivBuyIntentBase['basis']) ?? 'stake',
        duration_unit: typeof tradeOptions.duration_unit === 'string' ? tradeOptions.duration_unit : 't',
    };

    if (typeof tradeOptions.duration === 'number' && Number.isFinite(tradeOptions.duration)) {
        intent.duration = tradeOptions.duration;
    }

    if (tradeOptions.prediction !== undefined && tradeOptions.prediction !== null) {
        intent.barrier = tradeOptions.prediction as number | string;
    } else if (tradeOptions.barrierOffset !== undefined && tradeOptions.barrierOffset !== null) {
        intent.barrier = tradeOptions.barrierOffset as number | string;
    }

    if (tradeOptions.growth_rate !== undefined && tradeOptions.growth_rate !== null) {
        intent.extras = { growth_rate: tradeOptions.growth_rate };
    }

    return intent;
}

export async function executeDerivSessionContractPurchase(
    send: TSendWire,
    intent: TDerivBuyIntentBase
): Promise<unknown> {
    const market = resolveTradableDigitMarket(intent.market);
    const normalizedIntent = market === intent.market ? intent : { ...intent, market };
    const debugBase = {
        source: 'deriv-session' as const,
        contractType: normalizedIntent.contract_type,
        market: normalizedIntent.market,
        stake: normalizedIntent.stake,
        barrier: normalizedIntent.barrier,
        ...(market !== intent.market ? { extra: { requestedMarket: intent.market } } : {}),
    };

    if (isDerivOptionsOAuthSession()) {
        const proposalPayload = buildDerivSessionProposalPayload(normalizedIntent);
        logDerivTradeWire({ ...debugBase, phase: 'proposal_request' }, proposalPayload);

        const propResp = (await send(proposalPayload)) as {
            proposal?: { id?: string; ask_price?: unknown };
            error?: unknown;
        };
        logDerivTradeWire({ ...debugBase, phase: 'proposal_response' }, propResp);

        if (propResp?.error) {
            logDerivTradeFailure(debugBase, propResp, { step: 'proposal' });
            throw propResp;
        }
        const pid = propResp?.proposal?.id;
        if (!pid) {
            const err = new Error('No proposal id from Deriv');
            logDerivTradeFailure(debugBase, err, { step: 'proposal', propResp });
            throw err;
        }
        const ask = Number(propResp.proposal?.ask_price ?? normalizedIntent.stake);
        const buyPayload = {
            buy: String(pid),
            price: Math.max(normalizedIntent.stake, Number.isFinite(ask) ? ask : normalizedIntent.stake),
        };
        logDerivTradeWire({ ...debugBase, phase: 'buy_request' }, buyPayload);

        const buyResp = await send(buyPayload);
        logDerivTradeWire({ ...debugBase, phase: 'buy_response' }, buyResp);

        const buyErr = (buyResp as { error?: unknown } | null)?.error;
        if (buyErr) {
            logDerivTradeFailure(debugBase, buyResp, { step: 'buy' });
            throw buyResp;
        }

        return buyResp;
    }

    const legacyPayload = {
        buy: 1,
        price: normalizedIntent.stake,
        parameters: {
            amount: normalizedIntent.stake,
            basis: normalizedIntent.basis ?? 'stake',
            currency: normalizedIntent.currency ?? 'USD',
            contract_type: normalizedIntent.contract_type,
            duration_unit: normalizedIntent.duration_unit ?? 't',
            symbol: market,
            ...(typeof normalizedIntent.duration === 'number' && Number.isFinite(normalizedIntent.duration)
                ? { duration: normalizedIntent.duration }
                : {}),
            ...(normalizedIntent.barrier !== undefined && normalizedIntent.barrier !== null
                ? {
                      barrier:
                          typeof normalizedIntent.barrier === 'number'
                              ? String(normalizedIntent.barrier)
                              : normalizedIntent.barrier,
                  }
                : {}),
            ...(normalizedIntent.extras ?? {}),
        },
    };
    logDerivTradeWire({ ...debugBase, phase: 'buy_request' }, legacyPayload);
    const legacyResp = await send(legacyPayload);
    logDerivTradeWire({ ...debugBase, phase: 'buy_response' }, legacyResp);
    const legacyErr = (legacyResp as { error?: unknown } | null)?.error;
    if (legacyErr) {
        logDerivTradeFailure(debugBase, legacyResp, { step: 'legacy_buy' });
        throw legacyResp;
    }
    return legacyResp;
}

export const sendDerivSessionContractPurchase = executeDerivSessionContractPurchase;
