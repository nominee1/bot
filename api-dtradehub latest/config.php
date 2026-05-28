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
    'https://site.denaratool.com',
    'https://app.denaratool.com',
    'https://www.denaradigitpro.com',
    'https://www.denarapro.com',
    'https://denarapro.com',
    'https://marketing-tawny-ten.vercel.app',
    'https://verify.binaryke.com',
    'https://localhost:8443',
    // add your apps here (e.g., site.denaratool.com) if needed
]);

// ✅ Add this line to expose your encryption key to PHP
// Generate a new one using:  openssl rand -base64 32
putenv('TOKEN_MASTER_KEY=kbdJx5mWnHe0S4g0tPbSW0Mv5wr97RW3uuwxSgXxKp8=');

/** Payout: same app + WebSocket as Payment Agent transfer test (PA token + user tokens). */
define('CHALLENGE_PAYOUT_DERIV_APP_ID', 76100);
define('CHALLENGE_PAYOUT_WS_ENDPOINT', 'wss://ws.derivws.com/websockets/v3');

define('RELEASE_CHALLENGE_PAYOUT_SKIP_PASSWORD', false);
define('RELEASE_CHALLENGE_PAYOUT_TEST_SKIP_STATUS', false);
define('CHALLENGE_PAYOUT_SKIP_DB_STATUS_GATES', false);
