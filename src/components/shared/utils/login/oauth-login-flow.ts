import { getDerivOidcRedirectCallbackUri } from '../config/config';
import { clearDerivOptionsOAuthSession } from './deriv-oauth-storage';

/** Canonical OAuth callback origin when redirect URI differs from current (e.g. www vs apex). */
export const getOAuthCanonicalOrigin = (): string | null => {
    try {
        const redirectUri = getDerivOidcRedirectCallbackUri();
        const origin = new URL(redirectUri).origin;
        return origin !== window.location.origin ? origin : null;
    } catch {
        return null;
    }
};

export const isOnOAuthCanonicalOrigin = (): boolean => {
    const canonical = getOAuthCanonicalOrigin();
    if (!canonical) return true;
    return window.location.origin === canonical;
};

/**
 * Redirect to canonical origin before OAuth so PKCE storage matches callback.
 * @returns true if a navigation was started (caller must abort login).
 */
export const ensureOAuthCanonicalOriginBeforeLogin = (): boolean => {
    const canonical = getOAuthCanonicalOrigin();
    if (!canonical || window.location.origin === canonical) return false;

    const target = new URL(window.location.href);
    const canonicalUrl = new URL(canonical);
    target.protocol = canonicalUrl.protocol;
    target.host = canonicalUrl.host;
    window.location.replace(target.toString());
    return true;
};

/** OAuth callback on wrong origin — move query to registered redirect origin. */
export const redirectOAuthCallbackToCanonicalOriginIfNeeded = (): boolean => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('code') && !params.has('error')) return false;

    const canonical = getOAuthCanonicalOrigin();
    if (!canonical || window.location.origin === canonical) return false;

    const target = new URL(canonical);
    target.pathname = window.location.pathname || '/';
    target.search = window.location.search;
    target.hash = window.location.hash;
    window.location.replace(target.toString());
    return true;
};

/** Remove stale legacy WS tokens so they do not block Options OAuth on callback. */
export const clearLegacySessionBeforeOAuth = (): void => {
    clearDerivOptionsOAuthSession();
    ['authToken', 'accountsList', 'clientAccounts'].forEach(key => {
        try {
            localStorage.removeItem(key);
        } catch {
            /* noop */
        }
    });
};

/** Stale Deriv Hydra logout flag can immediately undo a fresh PKCE login. */
export const clearLoggedStateCookie = (): void => {
    const expires = 'Thu, 01 Jan 1970 00:00:00 GMT';
    const paths = ['/', ''];
    const hosts = [window.location.hostname, `.${window.location.hostname.split('.').slice(-2).join('.')}`];

    paths.forEach(path => {
        document.cookie = `logged_state=; path=${path}; expires=${expires}`;
        hosts.forEach(domain => {
            if (domain && domain !== '.') {
                document.cookie = `logged_state=; path=${path}; domain=${domain}; expires=${expires}`;
            }
        });
    });
};

export const hasOAuthCallbackQuery = (): boolean => {
    const params = new URLSearchParams(window.location.search);
    return params.has('code') || params.has('error');
};
