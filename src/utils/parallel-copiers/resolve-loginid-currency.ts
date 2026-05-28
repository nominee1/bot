import {
    DERIV_OPTIONS_ACCOUNTS_KEY,
    type TDerivOptionsAccount,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import { isVirtualLoginid } from '@/components/shared/utils/login/pick-default-account';
import { authData$ } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
type TAccountCurrencyRef = { loginid: string; currency?: string };

function readClientAccountCurrency(loginid: string): string | null {
    try {
        const raw = localStorage.getItem('clientAccounts');
        if (!raw) return null;
        const client = JSON.parse(raw) as Record<string, { currency?: string }>;
        const cur = client[loginid]?.currency;
        return cur && String(cur).trim() ? String(cur).trim() : null;
    } catch {
        return null;
    }
}

function readOptionsAccountCurrency(loginid: string): string | null {
    try {
        const raw = localStorage.getItem(DERIV_OPTIONS_ACCOUNTS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as TDerivOptionsAccount[];
        if (!Array.isArray(parsed)) return null;
        const cur = parsed.find(a => a.loginid === loginid)?.currency;
        return cur && String(cur).trim() ? String(cur).trim() : null;
    } catch {
        return null;
    }
}

/** Resolve account currency from authorize list, client storage, or options OAuth data. */
export function resolveLoginidCurrency(
    loginid: string,
    accountList?: TAccountCurrencyRef[] | null
): string {
    if (!loginid) return 'USD';

    const from_list = accountList?.find(a => a.loginid === loginid)?.currency;
    if (from_list) return from_list;

    const from_auth = authData$.getValue()?.account_list?.find(a => a.loginid === loginid)?.currency;
    if (from_auth) return from_auth;

    const from_client = readClientAccountCurrency(loginid);
    if (from_client) return from_client;

    const from_options = readOptionsAccountCurrency(loginid);
    if (from_options) return from_options;

    return isVirtualLoginid(loginid) ? 'USD' : 'USD';
}
