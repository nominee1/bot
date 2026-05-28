<?php
declare(strict_types=1);

/**
 * Run prize-payout processing once (for cron: wget/curl this URL every minute).
 * Optional: ?key=... must match env CHALLENGE_PAYOUT_CRON_KEY if set.
 */

require_once __DIR__ . '/util.php';
require_once __DIR__ . '/challenge_payout_lib.php';

cors();
header('Content-Type: application/json; charset=utf-8');

if (method() !== 'GET') {
    fail('Method not allowed', 405);
}

$cronKey = getenv('CHALLENGE_PAYOUT_CRON_KEY');
$cronKey = is_string($cronKey) ? trim($cronKey) : '';
if ($cronKey !== '') {
    $q = isset($_GET['key']) ? trim((string)$_GET['key']) : '';
    if (!hash_equals($cronKey, $q)) {
        fail('Unauthorized', 401);
    }
}

try {
    $pdo = pdo();
    denara_finalize_challenge_payouts($pdo);

    echo json_encode(['ok' => true, 'ran' => true], JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
    fail($e->getMessage(), 500);
}
