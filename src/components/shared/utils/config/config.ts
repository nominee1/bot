import { isStaging } from '../url/helpers';

/**
 * OAuth2 **public client id** (`auth.deriv.com`) — [Denara Digit Pro](https://www.denaradigitpro.com/).
 * Do **not** store this string in `localStorage.config.app_id` (numeric WS app id only).
 */
export const DERIV_OAUTH_CLIENT_ID_DENARADIGITPRO = '338uZhEQvtvjW0owDLMF8';

/**
 * OAuth2 **public client id** — [DenaraPro](https://www.denarapro.com/) (numeric app id {@link DENARAPRO_WS_APP_ID}).
 */
export const DERIV_OAUTH_CLIENT_ID_DENARAPRO = '338uXogGNM7InyU3NbJUl';

/** OAuth2 public client id — app.denaratool.com */
export const DERIV_OAUTH_CLIENT_ID_DENARATOOL = '33b2X6gZpNYQHiIMC2Zd6';

/** @deprecated use {@link DERIV_OAUTH_CLIENT_ID_DENARADIGITPRO} — legacy export name */
export const DERIV_NEW_API_OAUTH_CLIENT_ID = DERIV_OAUTH_CLIENT_ID_DENARADIGITPRO;

/** Stored `config.app_id` must never be these OAuth client strings (Hydra rejects them as WS app ids). */
const OAUTH_CLIENT_IDS_NOT_WS_APP = new Set([
    DERIV_OAUTH_CLIENT_ID_DENARADIGITPRO,
    DERIV_OAUTH_CLIENT_ID_DENARAPRO,
    DERIV_OAUTH_CLIENT_ID_DENARATOOL,
]);

/** Denara Digit Pro — WebSocket / OIDC numeric `app_id` (Deriv dashboard). */
export const DENARA_DIGITPRO_WS_APP_ID = '66945';

/** DenaraPro — WebSocket / OIDC numeric `app_id` (Deriv dashboard). */
export const DENARAPRO_WS_APP_ID = '71070';

/** Legacy default numeric id naming — Digit Pro host mapping uses {@link DENARA_DIGITPRO_WS_APP_ID}. */
export const DERIV_OIDC_APP_ID_DEFAULT = DENARA_DIGITPRO_WS_APP_ID;

const DENARA_DIGITPRO_HOSTS = new Set(['denaradigitpro.com', 'www.denaradigitpro.com']);

const DENARAPRO_HOSTS = new Set(['denarapro.com', 'www.denarapro.com']);

/**
 * OAuth2 `redirect_uri` must match Deriv **exactly** for each OAuth app. Canonical **www** origins so apex + www
 * visitors send one registered URI per product. PKCE bridge cookies use `Domain=.denaradigitpro.com` /
 * `Domain=.denarapro.com`.
 *
 * Override with `DERIV_OAUTH_REDIRECT_URI` when your dashboard uses a different registered URL.
 */
export const DENARA_DIGITPRO_OAUTH_REDIRECT_ORIGIN = 'https://www.denaradigitpro.com';

export const DENARAPRO_OAUTH_REDIRECT_ORIGIN = 'https://www.denarapro.com';

export const isDenaraDigitProDomain = () => DENARA_DIGITPRO_HOSTS.has(window.location.hostname);

/** Production deploy at [denarapro.com](https://www.denarapro.com). */
export const isDenaraProDomain = () => DENARAPRO_HOSTS.has(window.location.hostname);

/** OAuth `client_id` for the current hostname (Digit Pro vs DenaraPro). */
export const getDerivOAuthClientId = (): string => {
    if (isDenaraProDomain()) return DERIV_OAUTH_CLIENT_ID_DENARAPRO;
    if (isDenaraDigitProDomain()) return DERIV_OAUTH_CLIENT_ID_DENARADIGITPRO;
    return DERIV_OAUTH_CLIENT_ID_DENARAPRO;
};

/** Numeric Deriv `app_id` for OIDC authorize + WS on Denara hosts. */
export const getDenaraOidNumericAppId = (): string => {
    if (isDenaraProDomain()) return DENARAPRO_WS_APP_ID;
    if (isDenaraDigitProDomain()) return DENARA_DIGITPRO_WS_APP_ID;
    return DENARAPRO_WS_APP_ID;
};

/** app.denaratool.com — legacy WebSocket `app_id` only (not for Options REST / `pat_`). */
export const DENARATOOL_WS_APP_ID = '84662';

/**
 * Legacy V1 numeric app ids for `wss://ws.derivws.com/websockets/v3` (`authorize` with `a1-…` tokens).
 * Do **not** use these as `Deriv-App-ID` for Options REST or `pat_` tokens — Deriv rejects them (401).
 */
export const getLegacyDerivWsAppIds = (): number[] => {
    const ids = [
        Number(getDenaraOidNumericAppId()),
        Number(DENARAPRO_WS_APP_ID),
        Number(DENARA_DIGITPRO_WS_APP_ID),
        Number(DENARATOOL_WS_APP_ID),
    ];
    return [...new Set(ids.filter(id => Number.isFinite(id) && id > 0))];
};

/**
 * App ids for `GET /trading/v1/options/accounts` (`pat_…`, OAuth Bearer / JWT).
 * Per Deriv docs: use the **new** app id from developers.deriv.com (OAuth `client_id` or PAT app id) —
 * **not** legacy numeric WS ids (71070, 66945, …).
 */
export const getDerivOptionsRestAppIds = (): string[] => {
    const ordered: string[] = [
        getDerivOAuthClientId(),
        DERIV_OAUTH_CLIENT_ID_DENARAPRO,
        DERIV_OAUTH_CLIENT_ID_DENARADIGITPRO,
        DERIV_OAUTH_CLIENT_ID_DENARATOOL,
    ];

    const fromEnv = [
        typeof process.env.DERIV_PAT_APP_ID === 'string' ? process.env.DERIV_PAT_APP_ID.trim() : '',
        ...(typeof process.env.DERIV_OPTIONS_REST_APP_IDS === 'string'
            ? process.env.DERIV_OPTIONS_REST_APP_IDS.split(',').map(s => s.trim())
            : []),
    ].filter(Boolean);

    const seen = new Set<string>();
    return [...ordered, ...fromEnv].filter(id => {
        if (!id || !/^[0-9a-zA-Z_-]+$/.test(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
};

/**
 * OAuth2 redirect_uri for new API (`auth.deriv.com`). Per-product defaults match each Deriv app’s registered redirect.
 *
 * Set `DERIV_OAUTH_REDIRECT_URI` at build time to override (single deploy testing another URI).
 */
/**
 * Browser → PHP token exchange (`token-exchange.php`). Override with `DERIV_TOKEN_EXCHANGE_URL`.
 */
export const getDerivTokenExchangeUrl = (): string => {
    const fromEnv =
        typeof process.env.DERIV_TOKEN_EXCHANGE_URL === 'string' ? process.env.DERIV_TOKEN_EXCHANGE_URL.trim() : '';
    return fromEnv.length > 0 ? fromEnv : 'https://api.denaradigitpro.com/token-exchange.php';
};

export const getDerivOidcRedirectCallbackUri = (): string => {
    const fromEnv =
        typeof process.env.DERIV_OAUTH_REDIRECT_URI === 'string' ? process.env.DERIV_OAUTH_REDIRECT_URI.trim() : '';

    if (fromEnv.length > 0) {
        return fromEnv;
    }

    if (isDenaraProDomain()) {
        return DENARAPRO_OAUTH_REDIRECT_ORIGIN;
    }

    if (isDenaraDigitProDomain()) {
        return DENARA_DIGITPRO_OAUTH_REDIRECT_ORIGIN;
    }

    return window.location.origin;
};

export const APP_IDS = {
    /** Same WS app as production [denarapro.com](https://www.denarapro.com) — {@link DENARAPRO_WS_APP_ID}. */
    LOCALHOST: Number(DENARAPRO_WS_APP_ID),
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
    'denaradigitpro.com': Number(DENARA_DIGITPRO_WS_APP_ID),
    'www.denaradigitpro.com': Number(DENARA_DIGITPRO_WS_APP_ID),
    'denarapro.com': Number(DENARAPRO_WS_APP_ID),
    'www.denarapro.com': Number(DENARAPRO_WS_APP_ID),
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

    return { app_id: getAppId(), server_url };
};


export const getAppId = (): string | number => {
    let config_app_id = window.localStorage.getItem('config.app_id');

    /** Stored id was an OAuth client string, not a numeric WS app id. */
    if (config_app_id && OAUTH_CLIENT_IDS_NOT_WS_APP.has(config_app_id)) {
        window.localStorage.removeItem('config.app_id');
        config_app_id = null;
    }

    /** Local dev previously defaulted to 36300; align with DenaraPro WS app. */
    if (config_app_id === '36300' && isLocal()) {
        window.localStorage.removeItem('config.app_id');
        config_app_id = null;
    }

    const env_oidc_app_id =
        typeof process.env.DERIV_OIDC_APP_ID === 'string' && process.env.DERIV_OIDC_APP_ID.length > 0
            ? process.env.DERIV_OIDC_APP_ID
            : '';

    if (config_app_id) {
        return config_app_id;
    }

    if (env_oidc_app_id) {
        window.localStorage.setItem('config.app_id', env_oidc_app_id);
        return env_oidc_app_id;
    }

    if (isDenaraProDomain()) {
        window.localStorage.setItem('config.app_id', DENARAPRO_WS_APP_ID);
        return DENARAPRO_WS_APP_ID;
    }

    if (isDenaraDigitProDomain()) {
        window.localStorage.setItem('config.app_id', DENARA_DIGITPRO_WS_APP_ID);
        return DENARA_DIGITPRO_WS_APP_ID;
    }

    const current_domain = getCurrentProductionDomain() ?? '';

    if (isStaging()) {
        return APP_IDS.STAGING;
    }
    if (isTestLink()) {
        return APP_IDS.LOCALHOST;
    }

    return domain_app_ids[current_domain as keyof typeof domain_app_ids] ?? APP_IDS.PRODUCTION;
};

export const getSocketURL = () => {
    const local_storage_server_url = window.localStorage.getItem('config.server_url');
    window.localStorage.setItem('config.server_url', 'ws.derivws.com');
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

            if (/^(^(www\.)?qa[0-9]{1,4}\.deriv.dev|(.*)\.derivws\.com)$/.test(qa_server) && /^[0-9a-zA-Z_-]+$/.test(app_id)) {
                localStorage.setItem('config.app_id', app_id);
                localStorage.setItem('config.server_url', qa_server);
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
