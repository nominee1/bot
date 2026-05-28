import { upsertAccountQueryInBrowser } from '@/components/shared/utils/login/deriv-oauth-storage';

type TClientAccountRow = { loginid: string; token: string; currency: string };

function updateAccountParamInURL(account_data: { loginid: string; currency?: string }, fallback_currency = '') {
    const account_param = account_data.loginid.startsWith('VR')
        ? 'demo'
        : account_data.currency || fallback_currency;
    upsertAccountQueryInBrowser(String(account_data.loginid), account_param, 'push');
}

/**
 * Apply `?account=` + optional `loginid=` to legacy `authToken` / `active_loginid` and back-fill the URL.
 * Run in useLayoutEffect (or synchronously before `api_base.init`) so routing matches persisted account.
 */
export function applyLegacyAccountUrlToStorage(): void {
    const accounts_list = localStorage.getItem('accountsList');
    const client_accounts = localStorage.getItem('clientAccounts');
    const active_loginid = localStorage.getItem('active_loginid');
    const url_params = new URLSearchParams(window.location.search);
    const account_currency = url_params.get('account');
    const url_loginid = url_params.get('loginid')?.trim() ?? '';

    if (!account_currency) {
        try {
            if (!client_accounts) return;
            const parsed_client_accounts = JSON.parse(client_accounts) as Record<string, TClientAccountRow>;
            const selected_account = Object.entries(parsed_client_accounts).find(
                ([, account]) => account.loginid === active_loginid
            );
            if (!selected_account) return;
            const [, account] = selected_account;
            updateAccountParamInURL(account);
        } catch {
            /* noop */
        }
    }

    if (!accounts_list || !client_accounts) return;

    try {
        const parsed_accounts = JSON.parse(accounts_list) as Record<string, string>;
        const parsed_client_accounts = JSON.parse(client_accounts) as Record<string, TClientAccountRow>;

        const is_valid_currency = account_currency
            ? Object.values(parsed_client_accounts).some(
                  account => account.currency.toUpperCase() === account_currency.toUpperCase()
              )
            : false;

        const updateLocalStorage = (token: string, loginid: string) => {
            localStorage.setItem('authToken', token);
            localStorage.setItem('active_loginid', loginid);
        };

        if (url_loginid && parsed_accounts[url_loginid] !== undefined) {
            const row = parsed_client_accounts[url_loginid];
            if (row?.token !== undefined) {
                updateLocalStorage(String(row.token), url_loginid);
            } else {
                updateLocalStorage(String(parsed_accounts[url_loginid]), url_loginid);
            }
            return;
        }

        if (account_currency?.toUpperCase() === 'DEMO') {
            if (active_loginid?.startsWith('VR') && parsed_accounts[active_loginid]) {
                updateLocalStorage(String(parsed_accounts[active_loginid]), active_loginid);
                return;
            }
            const demo_account = Object.entries(parsed_accounts).find(([key]) => key.startsWith('VR'));

            if (demo_account) {
                const [loginid, token] = demo_account;
                updateLocalStorage(String(token), loginid);
                return;
            }
        }

        if (account_currency?.toUpperCase() !== 'DEMO' && is_valid_currency) {
            if (
                active_loginid &&
                !active_loginid.startsWith('VR') &&
                parsed_client_accounts[active_loginid]?.currency?.toUpperCase() === account_currency?.toUpperCase()
            ) {
                const account = parsed_client_accounts[active_loginid];
                if (account?.token !== undefined) {
                    updateLocalStorage(String(account.token), active_loginid);
                }
                return;
            }

            const real_account = Object.entries(parsed_client_accounts).find(
                ([loginid, account]) =>
                    !loginid.startsWith('VR') && account.currency.toUpperCase() === account_currency?.toUpperCase()
            );

            if (real_account) {
                const [loginid, account] = real_account;
                if (account?.token !== undefined) {
                    updateLocalStorage(String(account.token), loginid);
                }
                return;
            }
        }

        if (!is_valid_currency) {
            const selected_account = Object.entries(parsed_client_accounts).find(
                ([, account]) => account.loginid === active_loginid
            );
            if (!selected_account) return;
            const [, account] = selected_account;
            updateAccountParamInURL(account, 'USD');
        }
    } catch {
        /* noop */
    }
}
