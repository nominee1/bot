import type ClientStore from '@/stores/client-store';
import {
    ALLOWED_BOT_IFRAME_LOGINID,
    applyCrShadowDeltaLocked,
    getCrShadow,
    getCrShadowForWallet,
    getMoonLeadVirtualLedgerKey,
    isCrVirtualShadowLogin,
    isMoonLeadVirtualTradeLoginid,
    isOptionsVirtualShadowLoginid,
    isTenantVirtualShadowLoginid,
    MOON_COPY_LEAD_LOGINID,
    resolveVirtualShadowLedgerKey,
} from '@/utils/crVirtualBalanceShadow';
import { endVirtualSettlementHold } from '@/utils/sharedVirtualLedgerSync';

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
 * Buy row fires immediately after debit; sell/credit waits for `creditDelayMs` (default 800ms).
 * Bot Builder passes the run-panel settle delay so P/L hits the balance with the sold row.
 * Do NOT snap to Railway absolute here — that races the next trade and makes the header bounce.
 */
export function scheduleCrChanceLedgerRoundTrip(params: {
    client: ClientStore;
    walletLoginId: string | undefined | null;
    ask: number;
    settlementCredit: number;
    entryEpochSec: number;
    exitEpochSec: number;
    /** ms until sell credit — match UI settle (e.g. 5s contract → 5000). Default 800. */
    creditDelayMs?: number;
}): void {
    const { client, walletLoginId, ask, settlementCredit, entryEpochSec, exitEpochSec } = params;
    const creditDelayMs = Math.max(0, Number(params.creditDelayMs) || 800);
    if (!isCrVirtualShadowLogin(walletLoginId)) return;

    const debitLoginKey = isMoonLeadVirtualTradeLoginid(walletLoginId)
        ? MOON_COPY_LEAD_LOGINID
        : isOptionsVirtualShadowLoginid(walletLoginId) || isTenantVirtualShadowLoginid(walletLoginId)
          ? String(walletLoginId).trim()
          : ALLOWED_BOT_IFRAME_LOGINID;
    const ledgerKey = isMoonLeadVirtualTradeLoginid(walletLoginId)
        ? getMoonLeadVirtualLedgerKey()
        : resolveVirtualShadowLedgerKey(walletLoginId);
    const buyRef = generateChanceDbReferenceId();
    const sellRef = generateChanceDbReferenceId();

    const rawBuy = getCrShadowForWallet(walletLoginId) ?? getCrShadow(ledgerKey);
    const balanceAfterBuy = typeof rawBuy === 'number' && Number.isFinite(rawBuy) ? rawBuy : 0;

    void saveChanceVirtualStatement({
        username: CHANCE_LEDGER_USERNAME,
        loginid: debitLoginKey,
        transaction_time: entryEpochSec,
        action_type: 'buy',
        reference_id: buyRef,
        reference_type: 'buy',
        amount: Number((-ask).toFixed(2)),
        balance_after: Number(balanceAfterBuy.toFixed(2)),
    });

    window.setTimeout(() => {
        void (async () => {
            try {
                if (settlementCredit > 0) {
                    await applyCrShadowDeltaLocked(client, String(walletLoginId ?? debitLoginKey), settlementCredit);
                }
                const rawSell = getCrShadowForWallet(walletLoginId) ?? getCrShadow(ledgerKey);
                const balanceAfterSell =
                    typeof rawSell === 'number' && Number.isFinite(rawSell)
                        ? rawSell
                        : Number((balanceAfterBuy + settlementCredit).toFixed(2));

                void saveChanceVirtualStatement({
                    username: CHANCE_LEDGER_USERNAME,
                    loginid: debitLoginKey,
                    transaction_time: exitEpochSec,
                    action_type: 'sell',
                    reference_id: sellRef,
                    reference_type: 'sell',
                    amount: Number(settlementCredit.toFixed(2)),
                    balance_after: Number(balanceAfterSell.toFixed(2)),
                });
            } finally {
                endVirtualSettlementHold();
            }
        })();
    }, creditDelayMs);
}
