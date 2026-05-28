<?php
// api/config.php

// Hostinger typically: localhost
define('DB_HOST', 'localhost');
define('DB_NAME', 'u822822525_copytrading');
define('DB_USER', 'u822822525_unchained');
define('DB_PASS', 'bebina1@N');

/** Must match challenge_participants.trader_id (competition registrations). */
define('CHALLENGE_TRADERS_TABLE', 'traders_competition_2');

// CORS origins allowed (adjust to your domains)
define('CORS_ALLOW_ORIGINS', [
    'https://dtraderhub.com',
    'https://www.dtraderhub.com',
    'https://denaradigitpro.com',
    'https://www.denaradigitpro.com',
    'https://site.denaratool.com',
    'https://app.denaratool.com',
    'https://www.denarapro.com',
    'https://denarapro.com',
    'https://marketing-tawny-ten.vercel.app',
    'https://localhost:8443',
    'https://127.0.0.1:8443',
    'http://localhost:8443',
    'http://127.0.0.1:8443',
    // add your apps here (e.g., site.denaratool.com) if needed
]);

// ✅ Add this line to expose your encryption key to PHP
// Generate a new one using:  openssl rand -base64 32
putenv('TOKEN_MASTER_KEY=kbdJx5mWnHe0S4g0tPbSW0Mv5wr97RW3uuwxSgXxKp8=');

// Challenge prize payouts (release funds + automatic): Deriv API token for the **payment-agent** wallet only.
// In Deriv, switch to that account → Settings → API token → create token (payment / transfers as required).
// Replace the placeholder below with your real token (do not commit real tokens to git).
putenv('PAYMENT_AGENT_API_TOKEN=PASTE_DERIV_PAYMENT_AGENT_TOKEN_HERE');

/**
 * Prize payouts use Deriv WebSocket + app_id — must match your Payment Agent HTML test (same token app registration).
 * Example HTML uses app_id 76100 and wss://ws.derivws.com/websockets/v3.
 */
define('CHALLENGE_PAYOUT_DERIV_APP_ID', 76100);
define('CHALLENGE_PAYOUT_WS_ENDPOINT', 'wss://ws.derivws.com/websockets/v3');

/** When true, founder release skips password check (local dev only). */
define('RELEASE_CHALLENGE_PAYOUT_SKIP_PASSWORD', false);

/**
 * When true, release always returns HTTP 200 after attempt even if payout_status ≠ paid (debugging).
 * Production: false so failed/incomplete payouts return 422.
 */
define('RELEASE_CHALLENGE_PAYOUT_TEST_SKIP_STATUS', false);

/**
 * When true, skip DB normalize + pending→processing claim (debug only; risk of double transfer). Production: false.
 */
define('CHALLENGE_PAYOUT_SKIP_DB_STATUS_GATES', false);
