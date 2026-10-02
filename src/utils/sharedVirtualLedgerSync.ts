import type ClientStore from '@/stores/client-store';
import { isCrVirtualShadowLogin, syncCrShadowBalanceIfNeeded, writeCrShadow } from '@/utils/crVirtualBalanceShadow';
import { getHandoffShadowLoginid } from '@/utils/deriv1SessionHandoff';
import { getDeriv1LedgerProxyUrl, getPaApiBaseUrl } from '@/utils/pa-api-base';

let pendingSharedVirtualLedgerSyncs = 0;
let ledgerAdjustChain: Promise<void> = Promise.resolve();
/** Covers debit → delayed credit → ledger-adjust so capital poll cannot flash a mixed balance. */
let settlementHoldCount = 0;
let lastServerManagedBalance: number | null = null;

export function beginVirtualSettlementHold(): void {
    settlementHoldCount += 1;
}

export function endVirtualSettlementHold(): void {
    settlementHoldCount = Math.max(0, settlementHoldCount - 1);
}

/** True while a virtual trade is settling or a Railway ledger-adjust is in flight. */
export function hasVirtualSettlementHold(): boolean {
    return settlementHoldCount > 0 || pendingSharedVirtualLedgerSyncs > 0;
}

export function cacheServerManagedBalanceOnly(balance: number | null | undefined): void {
    const n = Number(balance);
    if (!Number.isFinite(n)) return;
    lastServerManagedBalance = Math.round(n * 100) / 100;
}

export function getCachedServerManagedBalance(): number | null {
    return lastServerManagedBalance;
}

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
    // No loginid must not hit the platform wallet (another user's Options balance).
    if (!loginid) return null;
    const query = `?loginid=${encodeURIComponent(loginid)}`;
    try {
        const fromRailway = await fetchCapitalFrom(`${getPaApiBaseUrl()}/v1/signals/capital${query}`);
        if (fromRailway != null) return fromRailway;
    } catch {
        /* try same-origin deriv-1 proxy */
    }
    try {
        const proxy = getDeriv1LedgerProxyUrl();
        const proxyUrl = `${proxy}?loginid=${encodeURIComponent(loginid)}`;
        return await fetchCapitalFrom(proxyUrl);
    } catch {
        return null;
    }
}

export async function pushSharedVirtualLedgerPnl(pnlDelta: number): Promise<number | null> {
    const delta = Math.round(Number(pnlDelta) * 100) / 100;
    if (!Number.isFinite(delta) || delta === 0) return null;
    const loginid = ledgerLoginid();
    if (!loginid) return null;

    const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer()}`,
    };
    try {
        const res = await fetch(`${getPaApiBaseUrl()}/v1/signals/ledger-adjust`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ pnlDelta: delta, loginid }),
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
            body: JSON.stringify({ pnlDelta: delta, loginid }),
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
            // Local shadow already includes this delta. Cache server absolute only —
            // re-writing via writeCrShadow races capital poll and flashes a mixed balance.
            const next = await pushSharedVirtualLedgerPnl(delta);
            if (next != null) cacheServerManagedBalanceOnly(next);
        })
        .catch(() => undefined)
        .finally(() => {
            pendingSharedVirtualLedgerSyncs = Math.max(0, pendingSharedVirtualLedgerSyncs - 1);
        });
}

export async function waitSharedVirtualLedgerIdle(timeoutMs = 8000): Promise<void> {
    const start = Date.now();
    while (pendingSharedVirtualLedgerSyncs > 0 && Date.now() - start < timeoutMs) {
        await new Promise<void>(resolve => {
            window.setTimeout(resolve, 40);
        });
    }
}

/**
 * After a virtual round-trip, snap header + shadow to Railway (single source of truth).
 * Notifies the parent once with the backend absolute so it cannot bounce on stale local.
 */
export async function reconcileDisplayToBackendBalance(
    client: ClientStore,
    walletLoginId: string | undefined | null
): Promise<number | null> {
    if (!client || !isCrVirtualShadowLogin(walletLoginId)) return null;
    await waitSharedVirtualLedgerIdle();
    const bal = await fetchSharedVirtualLedgerBalance();
    if (bal == null) {
        const cached = getCachedServerManagedBalance();
        if (cached == null) return null;
        writeCrShadow(String(walletLoginId), cached, { notifyParent: true });
        syncCrShadowBalanceIfNeeded(client, String(walletLoginId), cached);
        return cached;
    }
    cacheServerManagedBalanceOnly(bal);
    writeCrShadow(String(walletLoginId), bal, { notifyParent: true });
    syncCrShadowBalanceIfNeeded(client, String(walletLoginId), bal);
    return bal;
}
