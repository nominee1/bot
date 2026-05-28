/**
 * Legacy `websockets/v3` often accepts `buy: 1` + `parameters.symbol`.
 * Options trading WebSocket validates strictly — use `proposal` + `buy(proposal_id)` with `underlying_symbol` on proposal.
 *
 * @see https://developers.deriv.com/docs/trading/buy/
 */

import { isDerivOptionsOAuthSession } from '@/components/shared/utils/login/deriv-oauth-storage';
import {
    isDualAccountTradeEnabled,
} from '@/components/shared/utils/trading/dual-account-trade';
import {
    executeMirrorSessionContractPurchaseConcurrent,
    extractBuyContractId,
    runWithSessionPurchaseLock,
} from '@/components/shared/utils/trading/dual-account-mirror';
import { registerMirrorContractPair } from '@/components/shared/utils/trading/dual-account-contract-registry';

export type TDerivBuyIntentBase = {
    contract_type: string;
    market: string;
    /** Omitted for non-tick contracts (e.g. ACCU) */
    duration?: number;
    stake: number;
    currency?: string;
    basis?: 'stake' | 'payout';
    barrier?: number | string;
    /** Tick duration by default */
    duration_unit?: string;
    /** Merged into proposal / legacy `parameters` (e.g. `growth_rate` for ACCU). */
    extras?: Record<string, unknown>;
};

/**
 * Set `symbol` (legacy) or `underlying_symbol` (Options WS) on an existing proposal payload.
 * Removes the other key to avoid sending both.
 */
export function applyDerivSessionMarketField(payload: Record<string, unknown>, market: string) {
    delete payload.symbol;
    delete payload.underlying_symbol;
    if (isDerivOptionsOAuthSession()) {
        payload.underlying_symbol = market;
    } else {
        payload.symbol = market;
    }
}

/**
 * One-shot `proposal: 1` payload (omit `proposal` / use `proposal: 0` for callers that override).
 */
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

    applyDerivSessionMarketField(payload, intent.market);

    return payload;
}

type TSendWire = (data: Record<string, unknown>) => Promise<unknown>;

/**
 * Executes contract purchase suitable for active session — Options: proposal → `buy`; legacy: direct `buy: 1`.
 */
export async function executeDerivSessionContractPurchase(send: TSendWire, intent: TDerivBuyIntentBase): Promise<unknown> {
    if (isDerivOptionsOAuthSession()) {
        const propResp = (await send(buildDerivSessionProposalPayload(intent))) as {
            proposal?: { id?: string; ask_price?: unknown };
            error?: unknown;
        };
        if (propResp?.error) throw propResp;
        const pid = propResp?.proposal?.id;
        if (!pid) throw new Error('No proposal id from Deriv');
        const ask = Number(propResp.proposal?.ask_price ?? intent.stake);
        return send({
            buy: String(pid),
            price: Math.max(intent.stake, Number.isFinite(ask) ? ask : intent.stake),
        });
    }

    return send({
        buy: 1,
        price: intent.stake,
        parameters: {
            amount: intent.stake,
            basis: intent.basis ?? 'stake',
            currency: intent.currency ?? 'USD',
            contract_type: intent.contract_type,
            duration_unit: intent.duration_unit ?? 't',
            symbol: intent.market,
            ...(typeof intent.duration === 'number' && Number.isFinite(intent.duration)
                ? { duration: intent.duration }
                : {}),
            ...(intent.barrier !== undefined && intent.barrier !== null
                ? {
                      barrier: typeof intent.barrier === 'number' ? String(intent.barrier) : intent.barrier,
                  }
                : {}),
            ...(intent.extras ?? {}),
        },
    });
}

/**
 * Executes contract purchase suitable for active session — Options: proposal → `buy`; legacy: direct `buy: 1`.
 * When dual-account mode is on, mirrors the same trade on the paired demo/real account.
 */
export async function sendDerivSessionContractPurchase(send: TSendWire, intent: TDerivBuyIntentBase): Promise<unknown> {
    return runWithSessionPurchaseLock(intent, async () => {
        const dualMirrorPromise = isDualAccountTradeEnabled()
            ? executeMirrorSessionContractPurchaseConcurrent(intent)
            : Promise.resolve(null);

        const copierMirrorPromise = import('@/utils/parallel-copiers/parallel-copiers-mirror').then(
            ({ executeSessionContractPurchaseToAllCopiersConcurrent }) =>
                executeSessionContractPurchaseToAllCopiersConcurrent(intent)
        );

        const [primary, dualMirrorId, copierResults] = await Promise.all([
            executeDerivSessionContractPurchase(send, intent),
            dualMirrorPromise,
            copierMirrorPromise,
        ]);

        const primaryId = extractBuyContractId(primary);
        if (primaryId && dualMirrorId) {
            registerMirrorContractPair(primaryId, dualMirrorId);
        }
        if (primaryId && copierResults?.length) {
            const { linkSessionCopierMirrorsToPrimary } = await import('@/utils/parallel-copiers/parallel-copiers-mirror');
            linkSessionCopierMirrorsToPrimary(primaryId, copierResults);
        }

        return primary;
    });
}

/** Normalize proposal_open_contract entry quote when API omits `entry_tick` (e.g. Options stream). */
export function coerceProposalOpenContractEntrySpot(c: Record<string, unknown>): number | undefined {
    const n = (v: unknown): number | undefined => {
        if (v === undefined || v === null) return undefined;
        const x = typeof v === 'number' ? v : parseFloat(String(v));
        return Number.isFinite(x) ? x : undefined;
    };

    const d = (c.contract_details ?? {}) as Record<string, unknown>;

    return (
        n(c.entry_tick) ??
        n(c.entry_spot) ??
        n(c.spot) ??
        n(d.entry_tick) ??
        n(d.entry_spot) ??
        n(c.entry_quote) ??
        n(c.entrySpot) ??
        n(c.open_quote)
    );
}

export function coerceProposalOpenContractEntryTimeSec(c: Record<string, unknown>): number | undefined {
    const pick = (v: unknown): number | undefined => {
        if (v === undefined || v === null) return undefined;
        const x = typeof v === 'number' ? v : parseFloat(String(v));
        return Number.isFinite(x) ? x : undefined;
    };

    return (
        pick(c.entry_tick_time) ??
        pick(c.entry_tick_epoch) ??
        pick(c.entry_time) ??
        pick(c.date_start) ??
        pick(c.purchase_time) ??
        pick(c.buy_transaction_time)
    );
}
