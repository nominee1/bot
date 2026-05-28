import {
    getAppId,
    getSocketURL,
    isDenaraDigitProDomain,
    isDenaraProDomain,
} from '@/components/shared/utils/config/config';
import { isDerivOptionsOAuthSession } from '@/components/shared/utils/login/deriv-oauth-storage';

type TClientAccountRow = {
    loginid?: string;
    token?: string;
    currency?: string;
};

/**
 * Maps Denarabot legacy storage → Deriv core keys so same-origin `/dtrader/` iframe can authorize.
 * Legacy WS sessions only; Options OAuth uses a different API surface and may not load DTrader.
 */
export function syncDTraderSession(): boolean {
    if (typeof window === 'undefined') return false;

    try {
        // Match Denarabot WS / api_base — same resolution as getAppId() (domain, env, localStorage).
        const app_id = String(getAppId());
        localStorage.setItem('config.app_id', app_id);
        localStorage.setItem('config.server_url', getSocketURL());
    } catch {
        /* noop */
    }

    const active_loginid = localStorage.getItem('active_loginid');
    if (!active_loginid || active_loginid === 'null') {
        return false;
    }

    if (isDerivOptionsOAuthSession()) {
        return true;
    }

    const accounts_list_raw = localStorage.getItem('accountsList');
    if (!accounts_list_raw) {
        return false;
    }

    try {
        const accounts_list = JSON.parse(accounts_list_raw) as Record<string, string>;
        let client_accounts_raw: Record<string, TClientAccountRow> = {};
        try {
            client_accounts_raw = JSON.parse(localStorage.getItem('clientAccounts') ?? '{}') as Record<
                string,
                TClientAccountRow
            >;
        } catch {
            client_accounts_raw = {};
        }

        const client_object: Record<string, Record<string, unknown>> = {};

        Object.keys(accounts_list).forEach(loginid => {
            const token = accounts_list[loginid];
            if (!token) return;

            const row = client_accounts_raw[loginid];
            const is_virtual = /^(VR|VRT)/i.test(loginid);

            client_object[loginid] = {
                loginid,
                token,
                currency: row?.currency ?? (is_virtual ? 'USD' : 'USD'),
                is_virtual,
            };
        });

        if (!Object.keys(client_object).length) {
            return false;
        }

        localStorage.setItem('client.accounts', JSON.stringify(client_object));
        localStorage.setItem('active_loginid', active_loginid);

        const active_token = accounts_list[active_loginid];
        if (active_token) {
            localStorage.setItem('authToken', active_token);
        }

        return true;
    } catch {
        return false;
    }
}

/** Same-origin `/dtrader/` on Denara production hosts; env override otherwise. */
export function getDTraderEmbedUrl(): string {
    const from_env = process.env.DTRADER_EMBED_URL;
    if (typeof from_env === 'string' && from_env.trim().length > 0) {
        const trimmed = from_env.trim();
        if (/^https?:\/\//i.test(trimmed)) {
            return trimmed;
        }
        const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
        return `${window.location.origin}${path.endsWith('/') ? path : `${path}/`}`;
    }

    if (isDenaraProDomain() || isDenaraDigitProDomain()) {
        return `${window.location.origin}/dtrader/`;
    }

    return 'https://app.denaratool.com/dtrader';
}

export function usesSameOriginDTraderEmbed(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        const url = new URL(getDTraderEmbedUrl());
        return url.origin === window.location.origin;
    } catch {
        return false;
    }
}
