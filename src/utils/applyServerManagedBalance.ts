import type ClientStore from '@/stores/client-store';
import {
    OPTIONS_VIRTUAL_SHADOW_LOGINID,
    resolveVirtualShadowLedgerKey,
    writeCrShadow,
} from '@/utils/crVirtualBalanceShadow';
import type { Balance } from '@deriv/api-types';

const SERVER_MANAGED_LOGINID_KEY = 'fury_server_managed_loginid';
const SERVER_MANAGED_BALANCE_KEY = 'fury_server_managed_balance';

/** Remember which Options loginid is Railway-ledgered (session only). */
export function markServerManagedLoginid(loginid: string | null | undefined): void {
    const id = String(loginid ?? '')
        .trim()
        .toUpperCase();
    try {
        if (id) sessionStorage.setItem(SERVER_MANAGED_LOGINID_KEY, id);
        else sessionStorage.removeItem(SERVER_MANAGED_LOGINID_KEY);
    } catch {
        /* ignore */
    }
}

/**
 * Railway-owned Options wallet (same role as CR7557018 local shadow — Deriv WS must not win).
 * Always prefer backend `balance_cached` for this loginid.
 */
export function isRailwayManagedOptionsLoginid(loginid: string | null | undefined): boolean {
    const id = String(loginid ?? '')
        .trim()
        .toUpperCase();
    return Boolean(id) && id === OPTIONS_VIRTUAL_SHADOW_LOGINID.toUpperCase();
}

export function shouldSuppressDerivBalanceForServerManaged(loginid: string | undefined | null): boolean {
    const id = String(loginid ?? '')
        .trim()
        .toUpperCase();
    if (!id) return false;
    if (isRailwayManagedOptionsLoginid(id)) return true;
    try {
        return sessionStorage.getItem(SERVER_MANAGED_LOGINID_KEY)?.toUpperCase() === id;
    } catch {
        return false;
    }
}

function readCachedServerManagedBalance(): number | null {
    try {
        const raw = sessionStorage.getItem(SERVER_MANAGED_BALANCE_KEY);
        if (raw == null) return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    } catch {
        return null;
    }
}

function writeCachedServerManagedBalance(balance: number): void {
    try {
        sessionStorage.setItem(SERVER_MANAGED_BALANCE_KEY, String(balance));
    } catch {
        /* ignore */
    }
}

/**
 * Push a Railway-authoritative Options balance into the header account switcher.
 * Also mirrors into the CR/ROT shadow map (like CR7557018) so WS sync cannot reseed from Deriv.
 */
export function applyServerManagedBalance(
    client: ClientStore | null | undefined,
    loginid: string | null | undefined,
    balance: number | null | undefined,
    currency?: string | null
): void {
    if (!client) return;
    const id = String(loginid ?? '').trim();
    if (!id) return;
    const amount = Number(balance);
    if (!Number.isFinite(amount)) return;
    const cur = String(currency ?? 'USD').trim() || 'USD';
    const rounded = Math.round(amount * 100) / 100;

    markServerManagedLoginid(id);
    writeCachedServerManagedBalance(rounded);

    try {
        const ledgerKey = resolveVirtualShadowLedgerKey(id);
        writeCrShadow(ledgerKey, rounded);
    } catch {
        /* ignore */
    }

    try {
        const existingRoot = client.all_accounts_balance;
        const existingAccounts = existingRoot?.accounts ? { ...existingRoot.accounts } : {};
        const prevEntry = existingAccounts[id] ?? { loginid: id, currency: cur };
        if (prevEntry.balance === rounded && (prevEntry as { currency?: string }).currency === cur) {
            // Still refresh active wallet string if needed
        } else {
            existingAccounts[id] = {
                ...prevEntry,
                balance: rounded,
                currency: cur,
            };
            client.setAllAccountsBalance({
                ...(existingRoot ?? {}),
                accounts: existingAccounts,
            } as Balance);
        }

        const active = String(client.loginid ?? '')
            .trim()
            .toUpperCase();
        if (active && active === id.toUpperCase()) {
            client.setBalance(rounded.toFixed(2));
            client.setCurrency(cur);
        }
    } catch {
        /* ignore */
    }
}

/** Re-apply last known Railway balance after a Deriv WS push (no network). */
export function reapplyCachedServerManagedBalance(
    client: ClientStore | null | undefined,
    loginid: string | null | undefined
): void {
    if (!shouldSuppressDerivBalanceForServerManaged(loginid)) return;
    const cached = readCachedServerManagedBalance();
    if (cached == null) return;
    applyServerManagedBalance(client, loginid, cached);
}
