import type ClientStore from '@/stores/client-store';

import {
    ALLOWED_BOT_IFRAME_LOGINID,
    applyCrShadowDeltaLocked,
    getCrShadow,
    isCrVirtualShadowLogin,
} from '@/utils/crVirtualBalanceShadow';

/** Same endpoint as marketing accumulators — appends rows to `chance_virtual_statements`. */
export const SAVE_CHANCE_STATEMENT_URL = 'https://ttt.binaryke.com/api/save_chance_virtual_statement.php';

/** Ledger username used by PHP + leaderboard (virtual wallet separate from Deriv loginid). */
export const CHANCE_LEDGER_USERNAME = 'chance';

export type ChanceStatementPayload = {
    username: string;
    loginid?: string | null;
    transaction_time: number;
    action_type: 'buy' | 'sell';
    reference_id: string;
    reference_type: 'buy' | 'sell';
    amount: number;
    balance_after: number;
};

/** Deriv-style synthetic reference ids (matches marketing `BotIframe`). */
export function generateChanceDbReferenceId(): string {
    const prefix = '148';
    const middle = Math.floor(1000000 + Math.random() * 9000000).toString();
    const endings = ['01', '21', '61', '81'];
    const ending = endings[Math.floor(Math.random() * endings.length)];
    return `${prefix}${middle}${ending}`;
}

export async function saveChanceVirtualStatement(payload: ChanceStatementPayload): Promise<void> {
    try {
        const res = await fetch(SAVE_CHANCE_STATEMENT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !(data as { ok?: boolean })?.ok) {
            throw new Error((data as { error?: string })?.error || 'Failed to save Chance statement');
        }
    } catch (err) {
        console.error('saveChanceVirtualStatement error:', err);
    }
}

/**
 * Persist buy/sell rows for CR7557018 shadow round-trips only (same pattern as marketing BotIframe).
 * Buy row fires immediately after debit; sell row after 800ms once settlement credit is applied (if any).
 */
export function scheduleCrChanceLedgerRoundTrip(params: {
    client: ClientStore;
    walletLoginId: string | undefined | null;
    ask: number;
    settlementCredit: number;
    entryEpochSec: number;
    exitEpochSec: number;
}): void {
    const { client, walletLoginId, ask, settlementCredit, entryEpochSec, exitEpochSec } = params;
    if (!isCrVirtualShadowLogin(walletLoginId)) return;

    const loginKey = ALLOWED_BOT_IFRAME_LOGINID;
    const buyRef = generateChanceDbReferenceId();
    const sellRef = generateChanceDbReferenceId();

    const rawBuy = getCrShadow(loginKey);
    const balanceAfterBuy =
        typeof rawBuy === 'number' && Number.isFinite(rawBuy) ? rawBuy : 0;

    void saveChanceVirtualStatement({
        username: CHANCE_LEDGER_USERNAME,
        loginid: loginKey,
        transaction_time: entryEpochSec,
        action_type: 'buy',
        reference_id: buyRef,
        reference_type: 'buy',
        amount: Number((-ask).toFixed(2)),
        balance_after: Number(balanceAfterBuy.toFixed(2)),
    });

    window.setTimeout(() => {
        void (async () => {
            if (settlementCredit > 0) {
                await applyCrShadowDeltaLocked(client, loginKey, settlementCredit);
            }
            const rawSell = getCrShadow(loginKey);
            const balanceAfterSell =
                typeof rawSell === 'number' && Number.isFinite(rawSell)
                    ? rawSell
                    : Number((balanceAfterBuy + settlementCredit).toFixed(2));

            void saveChanceVirtualStatement({
                username: CHANCE_LEDGER_USERNAME,
                loginid: loginKey,
                transaction_time: exitEpochSec,
                action_type: 'sell',
                reference_id: sellRef,
                reference_type: 'sell',
                amount: Number(settlementCredit.toFixed(2)),
                balance_after: Number(balanceAfterSell.toFixed(2)),
            });
        })();
    }, 800);
}
