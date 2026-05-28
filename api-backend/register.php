<?php
// public_html/ttt/api/register.php
declare(strict_types=1);

/**
 * Tournament Registration (copy-trading style)
 * - Uses util.php helpers (cors/json/fail/pdo/body_json/token_encrypt_if_needed)
 * - Authorizes token against Deriv (REAL USD only)
 * - Stores encrypted token in single `token` column (same as traders/copiers)
 * - Uses tournaments.slug from .env (TOURNAMENT_SLUG) or body override
 */

// ---- BOOTSTRAP ----
$vendor_autoload = __DIR__ . '/vendor/autoload.php';
if (is_file($vendor_autoload)) require_once $vendor_autoload;

@ini_set('display_errors', '0');
@ini_set('log_errors', '1');
@ini_set('error_log', __DIR__ . '/php-error.log');

// Reuse your existing libs (same folder as index.php)
require_once __DIR__ . '/util.php';
require_once __DIR__ . '/DerivClient.php';

// ---- CORS / preflight ----
cors();
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')     fail('Method not allowed', 405);

try {
    // ---- Input ----
    $in = body_json();
    $username = trim((string)($in['username'] ?? ''));
    $token_raw = trim((string)($in['token'] ?? ''));
    $email = trim((string)($in['email'] ?? ''));
    $whatsapp = trim((string)($in['whatsapp'] ?? ''));
    // Optional: allow override of tournament via body (falls back to .env)
    $tournament_slug = trim((string)($in['tournament_slug'] ?? '')) ?: env('TOURNAMENT_SLUG');

    if ($username === '' || $token_raw === '') {
        fail('username and token are required', 422);
    }
    if (!is_valid_username($username)) {
        fail('invalid username format (letters, numbers, _ or -, length 3–32)', 422);
    }
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail('invalid email', 422);
    }
    if ($whatsapp !== '') {
        $w = preg_replace('/[()\-\s]/', '', $whatsapp);
        if (!preg_match('/^\+?\d{7,15}$/', $w)) fail('invalid phone', 422);
        $whatsapp = $w;
    }
    if ($tournament_slug === '') {
        fail('server not configured: TOURNAMENT_SLUG missing', 500);
    }

    $pdo = pdo();

    // ---- Resolve tournament & check window ----
    $q = $pdo->prepare("SELECT id, reg_start_utc, reg_end_utc FROM tournaments WHERE slug = ? LIMIT 1");
    $q->execute([$tournament_slug]);
    $t = $q->fetch(\PDO::FETCH_ASSOC);
    if (!$t) fail('tournament not found', 500);

    $tournament_id = (int)$t['id'];
    $now_utc = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $reg_start = new DateTimeImmutable($t['reg_start_utc'], new DateTimeZone('UTC'));
    $reg_end   = new DateTimeImmutable($t['reg_end_utc'],   new DateTimeZone('UTC'));
    if ($now_utc < $reg_start) fail('Registration has not opened', 403);
    if ($now_utc >= $reg_end)  fail('Registration closed', 403);

    // ---- Verify token with Deriv (REAL, USD) ----
    $app_id = (int)env('DERIV_APP_ID', 36300);
    $ws = new \Denara\DerivClient($app_id);
    try {
        $res  = $ws->authorize($token_raw);
        $auth = $res['authorize'] ?? [];
        $loginid   = (string)($auth['loginid'] ?? '');
        $isVirtual = (int)($auth['is_virtual'] ?? 0) === 1;
        $currency  = strtoupper((string)($auth['currency'] ?? ''));

        if ($loginid === '') {
            fail('Unable to authorize token (no loginid)', 400);
        }
        if ($isVirtual || str_starts_with($loginid, 'VRTC')) {
            fail('Real account token required (not VRTC)', 422);
        }
        if ($currency !== 'USD') {
            fail('Only USD accounts allowed', 422);
        }
    } finally {
        $ws->close();
    }

    // ---- Encrypt token using the SAME helper as copy-trading ----
    // util.php handles key mgmt & fallback, so no sodium requirement here.
    $token_enc = token_encrypt_if_needed($token_raw);

    // ---- Uniqueness helpers ----
    $token_hash = hash('sha256', $token_raw, true); // per-tournament uniqueness
    $token_last4 = substr($token_raw, -4);
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $ip_hash = hash('sha256', $ip, true);

    // ---- Insert / Update ----
    $sql = "
        INSERT INTO tournament_participants
            (tournament_id, username, loginid, is_virtual, currency,
             email, whatsapp, token, token_hash_sha256, token_last4, ip_hash_sha256)
        VALUES
            (:tid, :username, :loginid, 0, :currency,
             :email, :whatsapp, :token, :thash, :last4, :iphash)
        ON DUPLICATE KEY UPDATE
            email = VALUES(email),
            whatsapp = VALUES(whatsapp),
            token = VALUES(token),
            updated_at = CURRENT_TIMESTAMP
    ";
    $st = $pdo->prepare($sql);
    $st->execute([
        ':tid'      => $tournament_id,
        ':username' => $username,
        ':loginid'  => $loginid,
        ':currency' => $currency,
        ':email'    => ($email !== '') ? $email : null,
        ':whatsapp' => ($whatsapp !== '') ? $whatsapp : null,
        ':token'    => $token_enc,
        ':thash'    => $token_hash,
        ':last4'    => $token_last4,
        ':iphash'   => $ip_hash,
    ]);

    json([
        'ok'       => true,
        'username' => $username,
        'loginid'  => $loginid,
        'currency' => $currency,
    ], 200);

} catch (\PDOException $e) {
    $em = $e->getMessage();
    // map common unique-constraint collisions
    if (str_contains($em, 'uq_tour_username')) fail('Username already registered', 409);
    if (str_contains($em, 'uq_tour_loginid'))  fail('This Deriv account is already registered', 409);
    if (str_contains($em, 'uq_tour_token'))    fail('This token is already registered', 409);
    error_log($em);
    fail('Registration failed', 400);
} catch (\Throwable $e) {
    error_log((string)$e);
    fail('Server error', 500);
}
