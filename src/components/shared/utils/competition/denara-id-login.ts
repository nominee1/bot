import {
    applyDerivOAuthAccessTokenToFirstUsd,
    clearDerivOptionsOAuthSession,
    upsertAccountQueryInBrowser,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import { api_base } from '@/external/bot-skeleton';
import type { TAuthData } from '@/types/api-types';
import {
    DENARA_DIGITPRO_WS_APP_ID,
    DENARAPRO_WS_APP_ID,
    isDenaraDigitProDomain,
    isDenaraProDomain,
} from '../config/config';
import { getCompetitionGetTokenLookupBases, setDenaraCompetitionUsername } from './denara-competition-profile';
import { derivAuthorizeAsAuthData } from './deriv-token-verify';

const isLegacyInvalidTokenError = (message: string) =>
    /invalid\s*token|bad\s*session|invalid\s*auth|unauthorized|expired/i.test(message);
const isPatToken = (token: string) => /^\s*pat_/i.test(token);

type GetTokenResponse = {
    ok?: boolean;
    error?: string;
    token?: string;
    username?: string;
};

/** User-facing only — never include API hosts, paths, or server internals */
const TOKEN_LOOKUP_FAILED_MESSAGE =
    'Could not verify this Denara ID. Check username and password, use “Log in” with Deriv, or try again later.';

export async function fetchTraderTokenByDenaraCredentials(username: string, password: string): Promise<string> {
    const u = username.trim();
    if (!u) {
        throw new Error('Enter your Denara username.');
    }

    const bases = getCompetitionGetTokenLookupBases();
    if (bases.length === 0) {
        throw new Error(TOKEN_LOOKUP_FAILED_MESSAGE);
    }

    const devHints: string[] = [];

    for (const baseRaw of bases) {
        const base = baseRaw.replace(/\/+$/, '');
        const url = `${base}/get_token.php`;

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u, password }),
            });
            const txt = await res.text();
            let data: GetTokenResponse;
            try {
                data = JSON.parse(txt) as GetTokenResponse;
            } catch {
                if (process.env.NODE_ENV === 'development') {
                    devHints.push(`non-JSON response (HTTP ${res.status})`);
                }
                continue;
            }

            if (res.ok && data?.ok && data.token?.trim()) {
                return data.token.trim();
            }

            if (process.env.NODE_ENV === 'development') {
                devHints.push(data?.error || `HTTP ${res.status}`);
            }
        } catch (e) {
            if (process.env.NODE_ENV === 'development') {
                devHints.push(e instanceof Error ? e.message : String(e));
            }
        }
    }

    if (process.env.NODE_ENV === 'development' && devHints.length > 0) {
        // eslint-disable-next-line no-console
        console.warn('[denara-id-login] token lookup failed (details hidden from UI):', devHints);
    }

    throw new Error(TOKEN_LOOKUP_FAILED_MESSAGE);
}

/** Writes legacy DBot keys used by `api_base` / account switcher. */
export function persistLegacySessionFromAuthorize(patToken: string, authorize: TAuthData): void {
    const token = patToken.trim();
    const accountsList: Record<string, string> = {};
    const clientAccounts: Record<string, { loginid: string; token: string; currency: string }> = {};

    const rows = authorize.account_list?.length ? authorize.account_list : [];

    if (rows.length) {
        for (const a of rows) {
            if (!a?.loginid) continue;
            accountsList[a.loginid] = token;
            clientAccounts[a.loginid] = {
                loginid: a.loginid,
                token,
                currency: a.currency || '',
            };
        }
    } else {
        accountsList[authorize.loginid] = token;
        clientAccounts[authorize.loginid] = {
            loginid: authorize.loginid,
            token,
            currency: authorize.currency || '',
        };
    }

    if (isDenaraProDomain()) {
        try {
            localStorage.setItem('config.app_id', DENARAPRO_WS_APP_ID);
        } catch {
            /* noop */
        }
    } else if (isDenaraDigitProDomain()) {
        try {
            localStorage.setItem('config.app_id', DENARA_DIGITPRO_WS_APP_ID);
        } catch {
            /* noop */
        }
    }

    localStorage.setItem('accountsList', JSON.stringify(accountsList));
    localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
    localStorage.setItem('authToken', token);
    localStorage.setItem('active_loginid', authorize.loginid);

    const lid = String(authorize.loginid);
    const cur = clientAccounts[lid]?.currency || authorize.currency || 'USD';
    const account_param = /^VR/i.test(lid) ? 'demo' : cur;
    upsertAccountQueryInBrowser(lid, account_param, 'replace');
}

/**
 * Loads PAT from competition API (POST username + password), authorizes on Deriv, persists legacy session, re-inits WS.
 */
export async function loginWithDenaraId(username: string, password: string): Promise<void> {
    const token = (await fetchTraderTokenByDenaraCredentials(username, password)).trim();

    if (isPatToken(token)) {
        const optionsResult = await applyDerivOAuthAccessTokenToFirstUsd(token);
        if (!optionsResult.ok) {
            throw new Error(
                optionsResult.error ||
                    'This Denara ID token could not be verified as an Options account token. Ensure it is active and has Read + Trade permissions on Deriv.'
            );
        }
        const active = optionsResult.accounts.find(a => a.loginid === optionsResult.activeLoginid);
        if (active?.isVirtual) {
            throw new Error('Linked token is a demo Options account. Update your saved token to a real account.');
        }
        setDenaraCompetitionUsername(username.trim());
        await api_base.init(true);
        return;
    }

    try {
        const authorize = await derivAuthorizeAsAuthData(token);

        if (authorize.is_virtual === 1 || /^VR/i.test(authorize.loginid)) {
            throw new Error('Linked token is a demo account. Update your saved token to a real account.');
        }

        clearDerivOptionsOAuthSession();
        persistLegacySessionFromAuthorize(token, authorize);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e ?? '');
        if (!isLegacyInvalidTokenError(msg) && !/^\s*eyJ/i.test(token)) {
            throw e;
        }

        const optionsResult = await applyDerivOAuthAccessTokenToFirstUsd(token);
        if (!optionsResult.ok) {
            throw new Error(
                optionsResult.error ||
                    'This Denara ID uses a new Options account token. Create an API token on Deriv (Read + Trade) for your real USD Options wallet, or use “Log in” with Deriv OAuth.'
            );
        }

        const active = optionsResult.accounts.find(a => a.loginid === optionsResult.activeLoginid);
        if (active?.isVirtual) {
            throw new Error('Linked token is a demo Options account. Update your saved token to a real account.');
        }
    }

    setDenaraCompetitionUsername(username.trim());
    await api_base.init(true);
}
