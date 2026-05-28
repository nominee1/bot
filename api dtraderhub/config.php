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

// Challenge prize payouts (manual "release funds" + automatic after ranking): Deriv PAT for the payment-agent wallet.
// Create at Deriv → Settings → API token (scopes needed for payment agent transfers). Hostinger often has no OS env — use putenv here like TOKEN_MASTER_KEY:
// putenv('PAYMENT_AGENT_API_TOKEN=your_deriv_pat_here');
// Alternative: define('PAYMENT_AGENT_API_TOKEN', 'your_deriv_pat_here');
