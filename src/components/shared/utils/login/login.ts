import {
    getDenaraOidNumericAppId,
    getDerivOAuthClientId,
    getDerivOidcRedirectCallbackUri,
    hasBotStudioOAuthConfig,
    isBotStudioDeploy,
} from '../config/config';
import { isStorageSupported } from '../storage/storage';
import { getStaticUrl } from '../url';
import { clearLegacySessionBeforeOAuth, ensureOAuthCanonicalOriginBeforeLogin } from './oauth-login-flow';
import { setOAuthUserMessage, showOAuthToast } from './oauth-user-feedback';

/**
 * New Deriv OAuth2 PKCE login redirect.
 * https://developers.deriv.com/docs/intro/oauth/
 */
const PKCE_VERIFIER_KEY = 'pkce_code_verifier';
const OAUTH_STATE_KEY = 'oauth_state';
const DERIV_SCOPE = 'trade account_manage';

const COOKIE_VERIFIER = 'deriv_pkce_verifier';
const COOKIE_STATE = 'deriv_oauth_state';
const PKCE_COOKIE_MAX_AGE_SEC = 600;
/** Same TTL as cookies — mobile-friendly fallback when sessionStorage is cleared on redirect. */
const PKCE_LS_KEY = 'deriv_pkce_bridge_v1';
const PKCE_LS_MAX_AGE_MS = PKCE_COOKIE_MAX_AGE_SEC * 1000;

type TPkceBridgePayload = { v: string; s: string; t: number };

const setPkceLocalStorageFallback = (codeVerifier: string, state: string) => {
    try {
        if (!isStorageSupported(localStorage)) return;
        const payload: TPkceBridgePayload = { v: codeVerifier, s: state, t: Date.now() };
        localStorage.setItem(PKCE_LS_KEY, JSON.stringify(payload));
    } catch {
        /* quota / private mode */
    }
};

const readPkceLocalStorageFallback = (): { codeVerifier: string; state: string } | null => {
    try {
        if (!isStorageSupported(localStorage)) return null;
        const raw = localStorage.getItem(PKCE_LS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as TPkceBridgePayload;
        if (!parsed?.v || !parsed?.s || typeof parsed.t !== 'number') return null;
        if (Date.now() - parsed.t > PKCE_LS_MAX_AGE_MS) {
            localStorage.removeItem(PKCE_LS_KEY);
            return null;
        }
        return { codeVerifier: parsed.v, state: parsed.s };
    } catch {
        return null;
    }
};

const clearPkceLocalStorageFallback = () => {
    try {
        localStorage.removeItem(PKCE_LS_KEY);
    } catch {
        /* noop */
    }
};

const setPkceBridgeCookies = (codeVerifier: string, state: string) => {
    const host = window.location.hostname;
    const secure = window.location.protocol === 'https:';
    const base = `path=/; max-age=${PKCE_COOKIE_MAX_AGE_SEC}; SameSite=Lax${secure ? '; Secure' : ''}`;
    const encV = encodeURIComponent(codeVerifier);
    const encS = encodeURIComponent(state);

    document.cookie = `${COOKIE_VERIFIER}=${encV}; ${base}`;
    document.cookie = `${COOKIE_STATE}=${encS}; ${base}`;

    if (host.endsWith('denaradigitpro.com')) {
        document.cookie = `${COOKIE_VERIFIER}=${encV}; ${base}; Domain=.denaradigitpro.com`;
        document.cookie = `${COOKIE_STATE}=${encS}; ${base}; Domain=.denaradigitpro.com`;
    }
    if (host.endsWith('denarapro.com')) {
        document.cookie = `${COOKIE_VERIFIER}=${encV}; ${base}; Domain=.denarapro.com`;
        document.cookie = `${COOKIE_STATE}=${encS}; ${base}; Domain=.denarapro.com`;
    }
    if (host === 'app.denaratool.com' || host.endsWith('.denaratool.com')) {
        document.cookie = `${COOKIE_VERIFIER}=${encV}; ${base}`;
        document.cookie = `${COOKIE_STATE}=${encS}; ${base}`;
    }
    if (host.endsWith('.vercel.app')) {
        document.cookie = `${COOKIE_VERIFIER}=${encV}; ${base}`;
        document.cookie = `${COOKIE_STATE}=${encS}; ${base}`;
    }
};

const readCookie = (name: string): string | null => {
    const prefix = `${name}=`;
    const parts = document.cookie.split(';').map(c => c.trim());
    const hit = parts.find(p => p.startsWith(prefix));
    if (!hit) return null;
    return decodeURIComponent(hit.slice(prefix.length));
};

const clearPkceBridgeCookies = () => {
    const host = window.location.hostname;
    const secure = window.location.protocol === 'https:';
    const base = `path=/; max-age=0${secure ? '; Secure' : ''}`;
    document.cookie = `${COOKIE_VERIFIER}=; ${base}`;
    document.cookie = `${COOKIE_STATE}=; ${base}`;
    if (host.endsWith('denaradigitpro.com')) {
        document.cookie = `${COOKIE_VERIFIER}=; ${base}; Domain=.denaradigitpro.com`;
        document.cookie = `${COOKIE_STATE}=; ${base}; Domain=.denaradigitpro.com`;
    }
    if (host.endsWith('denarapro.com')) {
        document.cookie = `${COOKIE_VERIFIER}=; ${base}; Domain=.denarapro.com`;
        document.cookie = `${COOKIE_STATE}=; ${base}; Domain=.denarapro.com`;
    }
    if (host === 'app.denaratool.com' || host.endsWith('.denaratool.com')) {
        document.cookie = `${COOKIE_VERIFIER}=; ${base}`;
        document.cookie = `${COOKIE_STATE}=; ${base}`;
    }
    if (host.endsWith('.vercel.app')) {
        document.cookie = `${COOKIE_VERIFIER}=; ${base}`;
        document.cookie = `${COOKIE_STATE}=; ${base}`;
    }
};

const generateCodeVerifier = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const array = crypto.getRandomValues(new Uint8Array(64));
    return Array.from(array)
        .map(value => chars[value % chars.length])
        .join('');
};

const generateState = () => {
    const array = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(array)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
};

const base64UrlEncode = (arrayBuffer: ArrayBuffer) => {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    bytes.forEach(byte => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const createCodeChallenge = async (codeVerifier: string) => {
    const encoded = new TextEncoder().encode(codeVerifier);
    const hash = await crypto.subtle.digest('SHA-256', encoded);
    return base64UrlEncode(hash);
};

const stripStaleOAuthQueryParams = () => {
    try {
        const url = new URL(window.location.href);
        const had =
            url.searchParams.has('code') ||
            url.searchParams.has('state') ||
            url.searchParams.has('scope') ||
            url.searchParams.has('error') ||
            url.searchParams.has('error_description');
        if (!had) return;
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        url.searchParams.delete('scope');
        url.searchParams.delete('error');
        url.searchParams.delete('error_description');
        const search = url.searchParams.toString();
        window.history.replaceState({}, '', `${url.pathname}${search ? `?${search}` : ''}${url.hash}`);
    } catch {
        /* noop */
    }
};

export const requestDerivOAuthAuthentication = async () => {
    if (ensureOAuthCanonicalOriginBeforeLogin()) {
        return;
    }

    const redirectUri = getDerivOidcRedirectCallbackUri();
    const clientId = getDerivOAuthClientId();
    const numericAppId = getDenaraOidNumericAppId();

    if (isBotStudioDeploy() && !hasBotStudioOAuthConfig()) {
        const message =
            'OAuth is not fully configured for this site. In Deriv Sites, open Registered apps, paste your Options App ID, then Save IDs & redeploy.';
        setOAuthUserMessage(message, 'retry');
        showOAuthToast(message, 'warning');
        return;
    }

    if (!clientId) {
        const message =
            'Missing Options App ID (OAuth client id). Register the site on Deriv, paste the App ID in Deriv Sites, and redeploy.';
        setOAuthUserMessage(message, 'retry');
        showOAuthToast(message, 'error');
        return;
    }

    if (!redirectUri) {
        const message = 'Missing OAuth redirect URL for this deployment. Redeploy from Deriv Sites.';
        setOAuthUserMessage(message, 'retry');
        showOAuthToast(message, 'error');
        return;
    }

    clearLegacySessionBeforeOAuth();
    stripStaleOAuthQueryParams();

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await createCodeChallenge(codeVerifier);
    const state = generateState();

    sessionStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
    setPkceBridgeCookies(codeVerifier, state);
    setPkceLocalStorageFallback(codeVerifier, state);

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: DERIV_SCOPE,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    });

    if (numericAppId) {
        params.set('app_id', numericAppId);
    }

    if (import.meta.env.DEV) {
        console.info('[Deriv OAuth] authorize', { clientId, redirectUri, numericAppId: numericAppId || '(none)' });
    }

    window.location.assign(`https://auth.deriv.com/oauth2/auth?${params.toString()}`);
};

export const redirectToLogin = (is_logged_in: boolean, _language: string, has_params = true, redirect_delay = 0) => {
    if (!is_logged_in && isStorageSupported(sessionStorage)) {
        const l = window.location;
        const redirect_url = has_params ? window.location.href : `${l.protocol}//${l.host}${l.pathname}`;
        sessionStorage.setItem('redirect_url', redirect_url);
        setTimeout(() => {
            void requestDerivOAuthAuthentication();
        }, redirect_delay);
    }
};

export type TDerivOAuthCallbackResult =
    | {
          status: 'success';
          code: string;
          state: string;
          hasCodeVerifier: boolean;
          codeVerifier?: string;
          redirectUri: string;
          scope: string;
      }
    | {
          status: 'error';
          error: string;
          errorDescription: string;
          scope: string;
      }
    | {
          status: 'state_mismatch';
          code: string;
          state: string;
          storedState: string;
          hasCodeVerifier: boolean;
          scope: string;
      };

export const handleDerivOAuthCallback = (): TDerivOAuthCallbackResult | undefined => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state') ?? '';
    const error = params.get('error');
    const errorDescription = params.get('error_description') ?? '';

    if (!code && !error) return;

    if (error) {
        console.error('Deriv OAuth error:', error, params.get('error_description') ?? '');
        return {
            status: 'error',
            error,
            errorDescription,
            scope: DERIV_SCOPE,
        };
    }

    if (!code) {
        return undefined;
    }

    let storedState = sessionStorage.getItem(OAUTH_STATE_KEY) ?? '';
    let codeVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
    if (!storedState || !codeVerifier) {
        storedState = readCookie(COOKIE_STATE) ?? '';
        codeVerifier = readCookie(COOKIE_VERIFIER);
    }
    if (!storedState || !codeVerifier) {
        const ls = readPkceLocalStorageFallback();
        if (ls) {
            storedState = ls.state;
            codeVerifier = ls.codeVerifier;
        }
    }
    if (!storedState || state !== storedState || !codeVerifier) {
        console.error('Deriv OAuth state/verifier mismatch. Retry login in the same tab.', {
            urlHasState: Boolean(state),
            storedStateLen: storedState.length,
            hasVerifier: Boolean(codeVerifier),
        });
        if (codeVerifier) {
            const redirectUri = getDerivOidcRedirectCallbackUri();
            sessionStorage.setItem('deriv_oauth_code', code);
            sessionStorage.setItem('deriv_oauth_redirect_uri', redirectUri);
            sessionStorage.removeItem(PKCE_VERIFIER_KEY);
            sessionStorage.removeItem(OAUTH_STATE_KEY);
            clearPkceBridgeCookies();
            clearPkceLocalStorageFallback();
            return {
                status: 'success',
                code,
                state,
                hasCodeVerifier: true,
                codeVerifier,
                redirectUri,
                scope: DERIV_SCOPE,
            };
        }
        /**
         * Some mobile/in-app browsers clear session/cookie bridge during OAuth redirect.
         * If verifier is gone but code exists, let backend exchange attempt proceed.
         */
        if (!codeVerifier) {
            const redirectUri = getDerivOidcRedirectCallbackUri();
            sessionStorage.setItem('deriv_oauth_code', code);
            sessionStorage.setItem('deriv_oauth_redirect_uri', redirectUri);
            clearPkceBridgeCookies();
            clearPkceLocalStorageFallback();
            return {
                status: 'success',
                code,
                state,
                hasCodeVerifier: false,
                redirectUri,
                scope: DERIV_SCOPE,
            };
        }
        return {
            status: 'state_mismatch',
            code,
            state,
            storedState,
            hasCodeVerifier: Boolean(codeVerifier),
            scope: DERIV_SCOPE,
        };
    }

    const verifierForExchange = codeVerifier;

    sessionStorage.setItem('deriv_oauth_code', code);
    const redirectUri = getDerivOidcRedirectCallbackUri();
    sessionStorage.setItem('deriv_oauth_redirect_uri', redirectUri);
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    clearPkceBridgeCookies();
    clearPkceLocalStorageFallback();
    return {
        status: 'success',
        code,
        state,
        hasCodeVerifier: true,
        codeVerifier: verifierForExchange,
        redirectUri,
        scope: DERIV_SCOPE,
    };
};

export const redirectToSignUp = () => {
    window.open(getStaticUrl('/signup/'));
};
