import type ClientStore from '@/stores/client-store';
import { isCrVirtualShadowLogin } from '@/utils/crVirtualBalanceShadow';
import { getHandoffShadowLoginid } from '@/utils/deriv1SessionHandoff';
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

function ledgerLoginid(): string {
    return getHandoffShadowLoginid();
}

export async function fetchSharedVirtualLedgerBalance(): Promise<number | null> {
    const loginid = ledgerLoginid();
    const query = loginid ? `?loginid=${encodeURIComponent(loginid)}` : '';
    try {
        const fromRailway = await fetchCapitalFrom(`${getPaApiBaseUrl()}/v1/signals/capital${query}`);
        if (fromRailway != null) return fromRailway;
    } catch {
        /* try same-origin deriv-1 proxy */
    }
    try {
        const proxy = getDeriv1LedgerProxyUrl();
        const proxyUrl = loginid ? `${proxy}?loginid=${encodeURIComponent(loginid)}` : proxy;
        return await fetchCapitalFrom(proxyUrl);
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
            body: JSON.stringify({ pnlDelta: delta, loginid: ledgerLoginid() || undefined }),
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
            body: JSON.stringify({ pnlDelta: delta, loginid: ledgerLoginid() || undefined }),
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
            // Local shadow already includes this delta. Do not write the server absolute
            // back — that races the capital poll and flashes a second balance.
            await pushSharedVirtualLedgerPnl(delta);
        })
        .catch(() => undefined)
        .finally(() => {
            pendingSharedVirtualLedgerSyncs = Math.max(0, pendingSharedVirtualLedgerSyncs - 1);
        });
}
