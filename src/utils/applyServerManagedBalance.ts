import type ClientStore from '@/stores/client-store';
import type { Balance } from '@deriv/api-types';

const SERVER_MANAGED_LOGINID_KEY = 'fury_server_managed_loginid';

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

export function shouldSuppressDerivBalanceForServerManaged(loginid: string | undefined | null): boolean {
    const id = String(loginid ?? '')
        .trim()
        .toUpperCase();
    if (!id) return false;
    try {
        return sessionStorage.getItem(SERVER_MANAGED_LOGINID_KEY)?.toUpperCase() === id;
    } catch {
        return false;
    }
}

/**
 * Push a Railway-authoritative Options balance into the header account switcher.
 * No user-facing labels — looks like a normal account balance.
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

    try {
        const existingRoot = client.all_accounts_balance;
        const existingAccounts = existingRoot?.accounts ? { ...existingRoot.accounts } : {};
        const prevEntry = existingAccounts[id] ?? { loginid: id, currency: cur };
        if (prevEntry.balance === rounded && (prevEntry as { currency?: string }).currency === cur) {
            return;
        }
        existingAccounts[id] = {
            ...prevEntry,
            balance: rounded,
            currency: cur,
        };
        client.setAllAccountsBalance({
            ...(existingRoot ?? {}),
            accounts: existingAccounts,
        } as Balance);

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
