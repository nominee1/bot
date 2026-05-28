import {
    DERIV_OPTIONS_ACCOUNTS_KEY,
    getDerivOAuthAccessToken,
    isDerivOptionsOAuthSession,
    type TDerivOptionsAccount,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import { isVirtualLoginid } from '@/components/shared/utils/login/pick-default-account';
import { resolveLoginidCurrency } from '@/utils/parallel-copiers/resolve-loginid-currency';

/** Sentinel token for session rows backed by Options OAuth OTP sockets (not PAT). */
export const OPTIONS_OAUTH_SESSION_TOKEN = '__deriv_options_oauth__';

export type TParallelSessionAccount = {
    loginid: string;
    token: string;
    currency: string;
    is_virtual: boolean;
};

export function isOptionsOAuthSessionToken(token: string | null | undefined): boolean {
    return token === OPTIONS_OAUTH_SESSION_TOKEN;
}

function readStoredOptionsAccounts(): TDerivOptionsAccount[] {
    try {
        const raw = localStorage.getItem(DERIV_OPTIONS_ACCOUNTS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as TDerivOptionsAccount[];
        return Array.isArray(parsed) ? parsed.filter(a => a?.loginid) : [];
    } catch {
        return [];
    }
}

/**
 * All accounts in the current login session (legacy PAT `accountsList` + Options OAuth).
 */
export function readAllSessionAccounts(
    accountList?: Array<{ loginid: string; currency?: string; is_virtual?: number }> | null
): TParallelSessionAccount[] {
    const byLoginid = new Map<string, TParallelSessionAccount>();

    try {
        const raw = localStorage.getItem('accountsList');
        if (raw) {
            const map = JSON.parse(raw) as Record<string, string>;
            Object.entries(map).forEach(([loginid, token]) => {
                if (!loginid || !token) return;
                byLoginid.set(loginid, {
                    loginid,
                    token,
                    currency: resolveLoginidCurrency(loginid, accountList),
                    is_virtual: isVirtualLoginid(loginid),
                });
            });
        }
    } catch {
        /* noop */
    }

    const addOptionsRow = (loginid: string, currency: string, isVirtual: boolean) => {
        if (!loginid) return;
        byLoginid.set(loginid, {
            loginid,
            token: OPTIONS_OAUTH_SESSION_TOKEN,
            currency: currency || resolveLoginidCurrency(loginid, accountList),
            is_virtual: isVirtual,
        });
    };

    const hasOptionsOAuth =
        isDerivOptionsOAuthSession() || Boolean(getDerivOAuthAccessToken());

    if (hasOptionsOAuth) {
        readStoredOptionsAccounts().forEach(acc => {
            addOptionsRow(acc.loginid, acc.currency, Boolean(acc.isVirtual));
        });
    }

    accountList?.forEach(acc => {
        if (!acc?.loginid || byLoginid.has(acc.loginid)) return;
        if (!hasOptionsOAuth) return;
        addOptionsRow(
            acc.loginid,
            acc.currency ?? 'USD',
            acc.is_virtual === 1 || isVirtualLoginid(acc.loginid)
        );
    });

    return [...byLoginid.values()];
}

export function readSessionAccountMap(
    accountList?: Array<{ loginid: string; currency?: string; is_virtual?: number }> | null
): Map<string, { token: string; currency: string; is_virtual: boolean }> {
    const out = new Map<string, { token: string; currency: string; is_virtual: boolean }>();
    readAllSessionAccounts(accountList).forEach(acc => {
        out.set(acc.loginid, {
            token: acc.token,
            currency: acc.currency,
            is_virtual: acc.is_virtual,
        });
    });
    return out;
}

export function isOptionsOAuthSessionLoginid(loginid: string): boolean {
    if (!loginid) return false;
    if (!isDerivOptionsOAuthSession() && !getDerivOAuthAccessToken()) return false;
    if (readStoredOptionsAccounts().some(a => a.loginid === loginid)) return true;
    return readAllSessionAccounts().some(
        a => a.loginid === loginid && isOptionsOAuthSessionToken(a.token)
    );
}
