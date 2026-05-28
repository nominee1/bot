<?php
// api/binaryke_config.php
declare(strict_types=1);

/**
 * This file is ONLY for Binaryke domain payments DB.
 * It does NOT affect the copytrading DB config.php / pdo().
 *
 * Put your Binaryke DB credentials here (different DB).
 */
define('BINARYKE_DB_HOST', 'localhost');
define('BINARYKE_DB_NAME', 'u822822525_DenaraSites');   // <-- change
define('BINARYKE_DB_USER', 'u822822525_baki'); // <-- change
define('BINARYKE_DB_PASS', 'bebina1@N');         // <-- change

/**
 * IMPORTANT:
 * JWT must be verified with the SAME secret used to SIGN the JWT on verify.binaryke.com backend.
 * If you use a different secret here, this backend will always say "JWT invalid".
 */
putenv('BINARYKE_JWT_SECRET=CHANGE_ME_TO_SAME_SECRET_AS_ISSUER');

/**
 * If your Binaryke users table stores deriv_token_enc encrypted using the SAME AES-GCM helper,
 * set the same TOKEN_MASTER_KEY here.
 */
putenv('TOKEN_MASTER_KEY=CHANGE_ME_32BYTES_BASE64');

/** Deriv config used for payment agent withdraw */
putenv('DERIV_APP_ID=36300');
putenv('PAYMENT_AGENT_LOGINID=CR5373440');
