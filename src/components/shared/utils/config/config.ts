import { LocalStorageConstants, LocalStorageUtils, URLUtils } from '@deriv-com/utils';
import { isStaging } from '../url/helpers';

export const APP_IDS = {
    LOCALHOST: 36300,
    TMP_STAGING: 64584,
    STAGING: 29934,
    STAGING_BE: 29934,
    STAGING_ME: 29934,
    PRODUCTION: 65555,
    PRODUCTION_BE: 65556,
    PRODUCTION_ME: 65557,
};

export const livechat_license_id = 12049137;
export const livechat_client_id = '66aa088aad5a414484c1fd1fa8a5ace7';

export const domain_app_ids = {
    'master.bot-standalone.pages.dev': APP_IDS.TMP_STAGING,
    'staging-dbot.deriv.com': APP_IDS.STAGING,
    'staging-dbot.deriv.be': APP_IDS.STAGING_BE,
    'staging-dbot.deriv.me': APP_IDS.STAGING_ME,
    'dbot.deriv.com': APP_IDS.PRODUCTION,
    'dbot.deriv.be': APP_IDS.PRODUCTION_BE,
    'dbot.deriv.me': APP_IDS.PRODUCTION_ME,
};

export const getCurrentProductionDomain = () =>
    !/^staging\./.test(window.location.hostname) &&
    Object.keys(domain_app_ids).find(domain => window.location.hostname === domain);

export const isProduction = () => {
    const all_domains = Object.keys(domain_app_ids).map(domain => `(www\\.)?${domain.replace('.', '\\.')}`);
    return new RegExp(`^(${all_domains.join('|')})$`, 'i').test(window.location.hostname);
};

export const isTestLink = () => {
    return (
        window.location.origin?.includes('.binary.sx') ||
        window.location.origin?.includes('bot-65f.pages.dev') ||
        isLocal()
    );
};

export const isLocal = () => /localhost(:\d+)?$/i.test(window.location.hostname);

const getDefaultServerURL = () => {
    if (isTestLink()) {
        return 'ws.derivws.com';
    }

    let active_loginid_from_url;
    const search = window.location.search;
    if (search) {
        const params = new URLSearchParams(document.location.search.substring(1));
        active_loginid_from_url = params.get('acct1');
    }

    const loginid = window.localStorage.getItem('active_loginid') ?? active_loginid_from_url;
    const is_real = loginid && !/^(VRT|VRW)/.test(loginid);

    const server = is_real ? 'green' : 'blue';
    const server_url = `${server}.derivws.com`;

    return server_url;
};

export const getDefaultAppIdAndUrl = () => {
    const server_url = getDefaultServerURL();

    if (isTestLink()) {
        return { app_id: APP_IDS.LOCALHOST, server_url };
    }

    const current_domain = getCurrentProductionDomain() ?? '';
    const app_id = domain_app_ids[current_domain as keyof typeof domain_app_ids] ?? APP_IDS.PRODUCTION;

    return { app_id, server_url };
};

export const getAppId = () => {
    let app_id = null;
    const config_app_id = window.localStorage.getItem('config.app_id');
    const current_domain = getCurrentProductionDomain() ?? '';

    if (config_app_id) {
        app_id = config_app_id;
    } else if (isStaging()) {
        app_id = APP_IDS.STAGING;
    } else if (isTestLink()) {
        app_id = APP_IDS.LOCALHOST;
    } else {
        app_id = domain_app_ids[current_domain as keyof typeof domain_app_ids] ?? APP_IDS.PRODUCTION;
    }

    return app_id;
};

export const getSocketURL = () => {
    const local_storage_server_url = window.localStorage.getItem('config.server_url');
    if (local_storage_server_url) return local_storage_server_url;

    const server_url = getDefaultServerURL();

    return server_url;
};

export const checkAndSetEndpointFromUrl = () => {
    if (isTestLink()) {
        const url_params = new URLSearchParams(location.search.slice(1));

        if (url_params.has('qa_server') && url_params.has('app_id')) {
            const qa_server = url_params.get('qa_server') || '';
            const app_id = url_params.get('app_id') || '';

            url_params.delete('qa_server');
            url_params.delete('app_id');

            if (/^(^(www\.)?qa[0-9]{1,4}\.deriv.dev|(.*)\.derivws\.com)$/.test(qa_server) && /^[0-9]+$/.test(app_id)) {
                localStorage.setItem('config.app_id', app_id);
                localStorage.setItem('config.server_url', qa_server.replace(/"/g, ''));
            }

            const params = url_params.toString();
            const hash = location.hash;

            location.href = `${location.protocol}//${location.hostname}${location.pathname}${
                params ? `?${params}` : ''
            }${hash || ''}`;

            return true;
        }
    }

    return false;
};

export const getDebugServiceWorker = () => {
    const debug_service_worker_flag = window.localStorage.getItem('debug_service_worker');
    if (debug_service_worker_flag) return !!parseInt(debug_service_worker_flag);

    return false;
};

export const generateOAuthURL = () => {
    const { getOauthURL } = URLUtils;
    const oauth_url = getOauthURL();
    const original_url = new URL(oauth_url);
    const hostname = window.location.hostname;

    // First priority: Check for configured server URLs (for QA/testing environments)
    const configured_server_url = (LocalStorageUtils.getValue(LocalStorageConstants.configServerURL) ||
        localStorage.getItem('config.server_url')) as string;

    const valid_server_urls = ['green.derivws.com', 'red.derivws.com', 'blue.derivws.com', 'canary.derivws.com'];

    if (
        configured_server_url &&
        (typeof configured_server_url === 'string'
            ? !valid_server_urls.includes(configured_server_url)
            : !valid_server_urls.includes(JSON.stringify(configured_server_url)))
    ) {
        original_url.hostname = configured_server_url;
    } else if (original_url.hostname.includes('oauth.deriv.')) {
        // Second priority: Domain-based OAuth URL setting for .me and .be domains
        if (hostname.includes('.deriv.me')) {
            original_url.hostname = 'oauth.deriv.me';
        } else if (hostname.includes('.deriv.be')) {
            original_url.hostname = 'oauth.deriv.be';
        } else {
            // Fallback to original logic for other domains
            const current_domain = getCurrentProductionDomain();
            if (current_domain) {
                const domain_suffix = current_domain.replace(/^[^.]+\./, '');
                original_url.hostname = `oauth.${domain_suffix}`;
            }
        }
    }
    return original_url.toString() || oauth_url;
};

const readBuildEnv = (key: string): string => {
    const value = typeof process.env[key] === 'string' ? process.env[key].trim() : '';
    return value;
};

/** Deriv Sites / App Builder deploy — redirect URI is always injected at build time. */
export const isBotStudioDeploy = (): boolean => Boolean(readBuildEnv('DERIV_OAUTH_REDIRECT_URI'));

export const PLATFORM_SITE_OAUTH_CALLBACK_URL = 'https://undasite.com/auth/callback';
/** Same-tab start: sets the PKCE cookie on undasite.com then 302s to Deriv. */
export const PLATFORM_SITE_OAUTH_START_URL = 'https://undasite.com/api/auth/site-oauth/start';
export const SITE_OAUTH_MESSAGE_TYPE = 'undasite_site_oauth';

function isPlatformSharedCallbackUri(uri: string): boolean {
    try {
        const url = new URL(uri);
        const path = url.pathname.replace(/\/$/, '');
        if (path !== '/auth/callback') return false;
        const host = url.hostname.toLowerCase();
        return host === 'undasite.com' || host === 'www.undasite.com' || host === 'localhost';
    } catch {
        return false;
    }
}

/** Shared callback is used when deploy baked `DERIV_OAUTH_REDIRECT_URI` to undasite.com/auth/callback. */
export const usesPlatformSiteOAuthCallback = (): boolean =>
    isPlatformSharedCallbackUri(readBuildEnv('DERIV_OAUTH_REDIRECT_URI'));

export const getSiteOAuthHandoffUrl = (): string => {
    try {
        return new URL('/api/auth/site-oauth/handoff', PLATFORM_SITE_OAUTH_CALLBACK_URL).toString();
    } catch {
        return 'https://undasite.com/api/auth/site-oauth/handoff';
    }
};

/** True when Bot Studio injected OAuth client, redirect URI, and token exchange URL at build time. */
export const hasBotStudioOAuthConfig = (): boolean =>
    Boolean(
        readBuildEnv('DERIV_OAUTH_CLIENT_ID') &&
        readBuildEnv('DERIV_OAUTH_REDIRECT_URI') &&
        readBuildEnv('DERIV_TOKEN_EXCHANGE_URL')
    );

/** OAuth `client_id` for PKCE login (Bot Studio build or env override). */
export const getDerivOAuthClientId = (): string => {
    if (usesPlatformSiteOAuthCallback()) {
        const pooled = readBuildEnv('DERIV_OAUTH_CLIENT_ID') || readBuildEnv('NEXT_PUBLIC_DERIV_APP_ID');
        if (pooled) return pooled;
    }
    return readBuildEnv('DERIV_OAUTH_CLIENT_ID');
};

/** Numeric WS `app_id` for OAuth authorize + legacy WS. */
export const getDenaraOidNumericAppId = (): string => {
    const fromEnv = readBuildEnv('DERIV_WS_APP_ID') || readBuildEnv('DERIV_OIDC_APP_ID');
    if (fromEnv) return fromEnv;
    if (isBotStudioDeploy()) return '';
    return String(getAppId());
};

/** Bot Studio token exchange endpoint. */
const DERIV_SITES_TOKEN_EXCHANGE_PATH = '/api/auth/token-exchange';

/** Preview Deriv Sites deploy URLs must not be used at runtime — route to production host. */
function normalizeBakedTokenExchangeUrl(url: string): string {
    try {
        const parsed = new URL(url);
        if (
            parsed.pathname === DERIV_SITES_TOKEN_EXCHANGE_PATH &&
            /^denara-sites-[a-z0-9]+\.vercel\.app$/i.test(parsed.hostname)
        ) {
            return `https://denara-sites.vercel.app${DERIV_SITES_TOKEN_EXCHANGE_PATH}`;
        }
    } catch {
        // ignore
    }
    return url;
}

export const getDerivTokenExchangeUrl = (): string => {
    const fromEnv = readBuildEnv('DERIV_TOKEN_EXCHANGE_URL');
    if (!fromEnv) return '';
    return normalizeBakedTokenExchangeUrl(fromEnv);
};

/** Registered OAuth redirect URI (must match Deriv dashboard). */
export const getDerivOidcRedirectCallbackUri = (): string => {
    if (usesPlatformSiteOAuthCallback()) return PLATFORM_SITE_OAUTH_CALLBACK_URL;

    const fromEnv = readBuildEnv('DERIV_OAUTH_REDIRECT_URI');
    if (fromEnv) return fromEnv;
    return window.location.origin;
};

/** White-label Trader's Hub / main platform URL (Options users leave bot via account switcher). */
export const getWhiteLabelTradersHubUrl = (): string => 'https://www.denarapro.com';

/** App ids for Options REST (`GET /trading/v1/options/accounts`). */
export const getDerivOptionsRestAppIds = (): string[] => {
    const clientId = getDerivOAuthClientId();
    return clientId ? [clientId] : [];
};
