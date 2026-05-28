<?php
/**
 * Copy this file to `config.php` on the server and edit values.
 * Do not commit `config.php` if it contains secrets (add to .gitignore if needed).
 *
 * ---
 * Denara has two production frontends (separate Deriv OAuth2 **public client** apps):
 *
 * | Product           | Host(s)                         | OAuth client id        | WS app id |
 * |-------------------|----------------------------------|-------------------------|-----------|
 * | Denara Digit Pro  | denaradigitpro.com, www          | {@see DERIV_OAUTH_CLIENT_ID_DENARADIGITPRO} | 66945     |
 * | Denara Pro        | denarapro.com, www               | {@see DERIV_OAUTH_CLIENT_ID_DENARAPRO}        | 71070     |
 *
 * Register **redirect_uri** values in the Deriv dashboard for each OAuth app (exact string match):
 *
 * **Digit Pro** — typically fixed redirect (SPA loads at origin root):
 *   - https://www.denaradigitpro.com
 *   - https://denaradigitpro.com  (if you use apex)
 *
 * **Denara Pro** — typically the site origin only (see `getDerivOidcRedirectCallbackUri` in the React app):
 *   - https://denarapro.com
 *   - https://www.denarapro.com
 *
 * Token exchange (`token-exchange.php`) must use the **client_id** that matches the app that issued the
 * authorization `code` (same OAuth app as `redirect_uri`). Defaults below match this repo’s **DenaraPro**
 * frontend; for Denara Digit Pro, point {@see DERIV_OAUTH_CLIENT_ID} and {@see DERIV_DEFAULT_REDIRECT_URI}
 * at the Digit Pro constants instead.
 */

declare(strict_types=1);

// --- Denara Digit Pro (66945)
const DERIV_OAUTH_CLIENT_ID_DENARADIGITPRO = '338uZhEQvtvjW0owDLMF8';

/** Primary Digit Pro redirect (must match authorize + Deriv app settings). */
const DERIV_REDIRECT_URI_DENARADIGITPRO_WWW = 'https://www.denaradigitpro.com';

/** Use if traffic hits apex and authorize uses this origin. */
const DERIV_REDIRECT_URI_DENARADIGITPRO_APEX = 'https://denaradigitpro.com';

// --- app.denaratool.com (WS app_id 84662) — dTrader / Denaratool
const DERIV_OAUTH_CLIENT_ID_DENARATOOL = '33b2X6gZpNYQHiIMC2Zd6';

/** Register in Deriv dashboard for this client (must match SPA `getDerivOidcRedirectCallbackUri`). */
const DERIV_REDIRECT_URI_DENARATOOL = 'https://app.denaratool.com';

// --- Denara Pro (71070)
const DERIV_OAUTH_CLIENT_ID_DENARAPRO = '338uXogGNM7InyU3NbJUl';

const DERIV_REDIRECT_URI_DENARAPRO_WWW = 'https://www.denarapro.com';

const DERIV_REDIRECT_URI_DENARAPRO_APEX = 'https://denarapro.com';

// --- Defaults for token-exchange.php (DenaraPro — matches React app in this repo)
/** OAuth2 public client id. */
const DERIV_OAUTH_CLIENT_ID = DERIV_OAUTH_CLIENT_ID_DENARAPRO;

/** Default when POST body omits `redirect_uri` (should match what the SPA sent to authorize). */
const DERIV_DEFAULT_REDIRECT_URI = DERIV_REDIRECT_URI_DENARAPRO_WWW;

/** Deriv token endpoint — see https://developers.deriv.com/docs/intro/oauth/ */
const DERIV_TOKEN_URL = 'https://auth.deriv.com/oauth2/token';
