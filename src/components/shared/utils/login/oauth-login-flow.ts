import {
    DENARA_DIGITPRO_OAUTH_REDIRECT_ORIGIN,
    DENARAPRO_OAUTH_REDIRECT_ORIGIN,
    isDenaraDigitProDomain,
    isDenaraProDomain,
} from '../config/config';
import { clearDerivOptionsOAuthSession } from './deriv-oauth-storage';

/** Canonical OAuth callback origin (registered on Deriv). Apex hosts redirect here before login and on callback. */
export const getOAuthCanonicalOrigin = (): string | null => {
    if (isDenaraProDomain()) return DENARAPRO_OAUTH_REDIRECT_ORIGIN;
    if (isDenaraDigitProDomain()) return DENARA_DIGITPRO_OAUTH_REDIRECT_ORIGIN;
    return null;
};

export const isOnOAuthCanonicalOrigin = (): boolean => {
    const canonical = getOAuthCanonicalOrigin();
    if (!canonical) return true;
    return window.location.origin === canonical;
};

/**
 * Redirect apex → www (or non-canonical → canonical) before starting OAuth so PKCE storage matches callback.
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

/**
 * OAuth callback landed on apex while redirect_uri is www — move query/hash to canonical origin (one hop).
 * @returns true if redirect started.
 */
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
