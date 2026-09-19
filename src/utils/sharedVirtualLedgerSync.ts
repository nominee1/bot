import type ClientStore from '@/stores/client-store';
import { isCrVirtualShadowLogin, syncCrShadowBalanceIfNeeded, writeCrShadow } from '@/utils/crVirtualBalanceShadow';
import { postVirtualBalanceToDeriv1 } from '@/utils/deriv1SessionHandoff';
import { getDeriv1LedgerProxyUrl, getPaApiBaseUrl } from '@/utils/pa-api-base';

let pendingSharedVirtualLedgerSyncs = 0;
let ledgerAdjustChain: Promise<void> = Promise.resolve();

function bearer(): string {
    try {
        return (
            localStorage.getItem('fury-token') ||
            localStorage.getItem('deriv_oauth_access_token') ||
            localStorage.getItem('deriv-oauth-token') ||
            'deriv-1'
        );
    } catch {
        return 'deriv-1';
    }
}

export function hasPendingSharedVirtualLedgerSync(): boolean {
    return pendingSharedVirtualLedgerSyncs > 0;
}

function parseManagedBalance(data: { ok?: boolean; managedVirtualBalance?: number; balance?: number }): number | null {
    if (!data.ok) return null;
    const n = Number(data.managedVirtualBalance ?? data.balance);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

async function fetchCapitalFrom(url: string): Promise<number | null> {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        managedVirtualBalance?: number;
        balance?: number;
    };
    if (!res.ok) return null;
    return parseManagedBalance(data);
}

export async function fetchSharedVirtualLedgerBalance(): Promise<number | null> {
    try {
        const fromRailway = await fetchCapitalFrom(`${getPaApiBaseUrl()}/v1/signals/capital`);
        if (fromRailway != null) return fromRailway;
    } catch {
        /* try deriv-1 CORS proxy */
    }
    try {
        return await fetchCapitalFrom(getDeriv1LedgerProxyUrl());
    } catch {
        return null;
    }
}

export async function pushSharedVirtualLedgerPnl(pnlDelta: number): Promise<number | null> {
    const delta = Math.round(Number(pnlDelta) * 100) / 100;
    if (!Number.isFinite(delta) || delta === 0) return null;

    const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer()}`,
    };
    try {
        const res = await fetch(`${getPaApiBaseUrl()}/v1/signals/ledger-adjust`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ pnlDelta: delta }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; balance?: number };
        if (res.ok && data.ok) {
            const bal = Number(data.balance);
            if (Number.isFinite(bal)) return Math.round(bal * 100) / 100;
        }
    } catch {
        /* try deriv-1 CORS proxy */
    }
    try {
        const res = await fetch(getDeriv1LedgerProxyUrl(), {
            method: 'POST',
            headers,
            body: JSON.stringify({ pnlDelta: delta }),
        });
        const data = (await res.json().catch(() => ({}))) as {
            ok?: boolean;
            managedVirtualBalance?: number;
            balance?: number;
        };
        if (!res.ok || !data.ok) return null;
        const bal = Number(data.managedVirtualBalance ?? data.balance);
        return Number.isFinite(bal) ? Math.round(bal * 100) / 100 : null;
    } catch {
        return null;
    }
}

export function scheduleSharedVirtualLedgerPnlSync(
    client: ClientStore | null | undefined,
    walletLoginId: string | undefined | null,
    pnlDelta: number
): void {
    if (!client || !isCrVirtualShadowLogin(walletLoginId)) return;
    const delta = Math.round(Number(pnlDelta) * 100) / 100;
    if (!Number.isFinite(delta) || delta === 0) return;

    pendingSharedVirtualLedgerSyncs += 1;
    ledgerAdjustChain = ledgerAdjustChain
        .then(async () => {
            const next = await pushSharedVirtualLedgerPnl(delta);
            if (next == null) return;
            writeCrShadow(String(walletLoginId), next);
            syncCrShadowBalanceIfNeeded(client, String(walletLoginId), next);
            postVirtualBalanceToDeriv1(next, String(walletLoginId));
        })
        .catch(() => undefined)
        .finally(() => {
            pendingSharedVirtualLedgerSyncs = Math.max(0, pendingSharedVirtualLedgerSyncs - 1);
        });
}
