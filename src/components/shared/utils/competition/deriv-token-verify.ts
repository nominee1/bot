import {
    DENARA_DIGITPRO_WS_APP_ID,
    DENARAPRO_WS_APP_ID,
    getLegacyDerivWsAppIds,
    isDenaraDigitProDomain,
    isDenaraProDomain,
} from '@/components/shared/utils/config/config';
import { fetchDerivOptionsAccountsWithAppIdFallback } from '@/components/shared/utils/login/deriv-oauth-storage';
import type { TAuthData } from '@/types/api-types';

const DEFAULT_APP_ID = (): number => {
    if (typeof window !== 'undefined') {
        if (isDenaraProDomain()) return Number(DENARAPRO_WS_APP_ID) || 71070;
        if (isDenaraDigitProDomain()) return Number(DENARA_DIGITPRO_WS_APP_ID) || 66945;
    }
    return Number(DENARAPRO_WS_APP_ID) || 71070;
};

function getDerivWsUrl(app_id: number): string {
    return `wss://ws.derivws.com/websockets/v3?app_id=${app_id}`;
}

/**
 * Opens a short-lived WS and sends `authorize`. Matches leaderboard tournament validation behaviour.
 */
export async function derivAuthorizeToken(
    token: string,
    appId: number = DEFAULT_APP_ID(),
    timeoutMs = 12000
): Promise<{ loginid: string; is_virtual: number; currency?: string }> {
    return new Promise((resolve, reject) => {
        const url = getDerivWsUrl(appId);
        const ws = new WebSocket(url);

        let settled = false;
        const tidy = () => {
            try {
                ws.close();
            } catch {
                /* noop */
            }
        };

        const timer = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            tidy();
            reject(new Error('Token check timed out. Please try again.'));
        }, timeoutMs);

        ws.onopen = () => ws.send(JSON.stringify({ authorize: token }));

        ws.onmessage = ev => {
            try {
                const msg = JSON.parse(ev.data) as {
                    error?: { message?: string };
                    msg_type?: string;
                    authorize?: { loginid: string; is_virtual: number; currency?: string };
                };
                if (msg.error) {
                    settled = true;
                    window.clearTimeout(timer);
                    tidy();
                    reject(new Error(msg.error.message || 'Invalid token'));
                    return;
                }
                if (msg.msg_type === 'authorize' && msg.authorize) {
                    const { loginid, is_virtual, currency } = msg.authorize;
                    settled = true;
                    window.clearTimeout(timer);
                    tidy();
                    resolve({ loginid, is_virtual, currency });
                }
            } catch {
                settled = true;
                window.clearTimeout(timer);
                tidy();
                reject(new Error('Unexpected response from Deriv.'));
            }
        };

        ws.onerror = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            tidy();
            reject(new Error('Network error talking to Deriv.'));
        };

        ws.onclose = () => {
            if (!settled) {
                settled = true;
                window.clearTimeout(timer);
                tidy();
                reject(new Error('Connection closed before validation finished.'));
            }
        };
    });
}

/** Full `authorize` payload from Deriv (for building `accountsList` / session). */
export async function derivAuthorizeAsAuthData(
    token: string,
    appId: number = DEFAULT_APP_ID(),
    timeoutMs = 15000
): Promise<TAuthData> {
    return new Promise((resolve, reject) => {
        const url = getDerivWsUrl(appId);
        const ws = new WebSocket(url);

        let settled = false;
        const tidy = () => {
            try {
                ws.close();
            } catch {
                /* noop */
            }
        };

        const timer = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            tidy();
            reject(new Error('Authorize timed out.'));
        }, timeoutMs);

        ws.onopen = () => ws.send(JSON.stringify({ authorize: token }));

        ws.onmessage = ev => {
            try {
                const msg = JSON.parse(ev.data) as {
                    error?: { message?: string };
                    msg_type?: string;
                    authorize?: TAuthData;
                };
                if (msg.error) {
                    settled = true;
                    window.clearTimeout(timer);
                    tidy();
                    reject(new Error(msg.error.message || 'Invalid token'));
                    return;
                }
                if (msg.msg_type === 'authorize' && msg.authorize) {
                    settled = true;
                    window.clearTimeout(timer);
                    tidy();
                    resolve(msg.authorize);
                }
            } catch {
                settled = true;
                window.clearTimeout(timer);
                tidy();
                reject(new Error('Unexpected response from Deriv.'));
            }
        };

        ws.onerror = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            tidy();
            reject(new Error('Network error talking to Deriv.'));
        };

        ws.onclose = () => {
            if (!settled) {
                settled = true;
                window.clearTimeout(timer);
                tidy();
                reject(new Error('Connection closed before authorize finished.'));
            }
        };
    });
}

export type TValidatedDerivAccount = {
    loginid: string;
    currency: string;
    /** Legacy CR/VRTC via websockets/v3, or new Options account via REST Bearer. */
    tokenKind?: 'legacy_ws' | 'options_rest';
};

const isLikelyOAuthBearer = (token: string) => /^\s*(eyJ|pat_)/i.test(token);

const isLegacyInvalidTokenError = (message: string) =>
    /invalid\s*token|bad\s*session|invalid\s*auth|unauthorized|expired/i.test(message);

const OPTIONS_SIGNUP_HINT =
    'For pat_ tokens: create them on developers.deriv.com under your Denara Options/PAT app (not legacy app 71070). For legacy tokens: use Deriv → Account → API token (a1-…, Read + Trade).';

function getRegistrationWsAppIds(): number[] {
    return getLegacyDerivWsAppIds();
}

/**
 * Validates a real USD account via Options REST (`GET /trading/v1/options/accounts`).
 * Used for new Options account ids and OAuth access tokens that do not authorize on legacy WS.
 */
export async function validateDerivOptionsRealUsdToken(userToken: string): Promise<TValidatedDerivAccount> {
    const trimmed = userToken.trim();
    if (!trimmed) {
        throw new Error('Enter your Deriv API token.');
    }

    const { accounts } = await fetchDerivOptionsAccountsWithAppIdFallback(trimmed);
    const realUsd = accounts.find(a => !a.isVirtual && a.currency === 'USD');
    const realAny = accounts.find(a => !a.isVirtual);
    const pick = realUsd ?? realAny;

    if (!pick) {
        throw new Error('Use a real-money Options account token (not demo).');
    }
    if (pick.currency !== 'USD') {
        throw new Error(`Only USD accounts are accepted (this account is ${pick.currency}).`);
    }

    return { loginid: pick.loginid, currency: pick.currency, tokenKind: 'options_rest' };
}

/**
 * Ensures token works on WS and is a **real-money USD** account (for competitions / traders API).
 * Throws with a clear message if demo, wrong currency, or invalid.
 */
export async function validateDerivRealUsdToken(
    userToken: string,
    appId: number = DEFAULT_APP_ID()
): Promise<TValidatedDerivAccount> {
    const trimmed = userToken.trim();
    if (!trimmed) {
        throw new Error('Enter your Deriv API token.');
    }

    const auth = await derivAuthorizeToken(trimmed, appId);
    if (auth.is_virtual === 1 || /^VR/i.test(auth.loginid)) {
        throw new Error('Use a real-money account token (not demo).');
    }
    if ((auth.currency || '').toUpperCase() !== 'USD') {
        throw new Error(`Only USD accounts are accepted (this token is ${auth.currency || 'unknown'}).`);
    }

    return { loginid: auth.loginid, currency: auth.currency || 'USD', tokenKind: 'legacy_ws' };
}

/**
 * Denara ID registration: accept legacy PAT (CR…) and new Options OAuth / API Bearer tokens.
 * Tries legacy WS first, then Options REST with the same Bearer (Deriv supports both on REST).
 */
export async function validateDerivTokenForDenaraRegistration(userToken: string): Promise<TValidatedDerivAccount> {
    const trimmed = userToken.trim();
    if (!trimmed) {
        throw new Error('Enter your Deriv API token.');
    }

    if (isLikelyOAuthBearer(trimmed)) {
        try {
            return await validateDerivOptionsRealUsdToken(trimmed);
        } catch (optionsErr: unknown) {
            const optionsMsg = optionsErr instanceof Error ? optionsErr.message : String(optionsErr ?? '');
            throw new Error(
                optionsMsg.includes('401') || /invalid\s+or\s+expired/i.test(optionsMsg)
                    ? `Invalid or expired token. ${OPTIONS_SIGNUP_HINT}`
                    : `${optionsMsg} ${OPTIONS_SIGNUP_HINT}`
            );
        }
    }

    const uniqueAppIds = getRegistrationWsAppIds();

    let lastError: Error | null = null;
    for (const appId of uniqueAppIds) {
        try {
            return await validateDerivRealUsdToken(trimmed, appId);
        } catch (e: unknown) {
            lastError = e instanceof Error ? e : new Error(String(e ?? 'Token check failed'));
            if (!isLegacyInvalidTokenError(lastError.message)) {
                throw lastError;
            }
        }
    }

    throw (
        lastError ??
        new Error(
            'Invalid legacy API token. Create one under Deriv → Account → API token with Read + Trade on your real USD wallet.'
        )
    );
}
