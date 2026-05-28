<?php
// public_html/ttt/api/index.php
declare(strict_types=1);

/**
 * Tournament API (standalone router)
 * - Reuses copy-trading helpers by requiring util.php + DerivClient.php (same folder).
 * - POST /register : register trader into current tournament
 * - GET  /debug/ping : health
 *
 * Requires DB tables:
 *   - tournaments
 *   - tournament_participants (single encrypted token column)
 *
 * Expects .env with: DB_HOST, DB_NAME, DB_USER, DB_PASS, DERIV_APP_ID, TOURNAMENT_SLUG
 */

/* ===== Bootstrap & Logging ===== */
$vendor_autoload = __DIR__ . '/vendor/autoload.php';
if (is_file($vendor_autoload)) { require_once $vendor_autoload; }

@ini_set('display_errors', '0');
@ini_set('log_errors', '1');
@ini_set('error_log', __DIR__ . '/php-error.log');

/* ===== Copy-trading helpers (REUSED) =====
   Copy these two files from your copy-trading project into this folder. */
require_once __DIR__ . '/util.php';         // must provide: cors(), json(), fail(), pdo(), env(), body_json(), is_valid_username(), token_encrypt_if_needed()
require_once __DIR__ . '/DerivClient.php';  // must provide: \Denara\DerivClient

/* ===== CORS / Common Headers ===== */
cors();
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

/* ===== Mini Router ===== */
$path = (function (): string {
    $uri = $_SERVER['REQUEST_URI'] ?? '/';
    $qpos = strpos($uri, '?');
    if ($qpos !== false) $uri = substr($uri, 0, $qpos);
    // Normalize base to /api/index.php style:
    // If called directly as /api/index.php/register keep suffix after index.php
    if (str_contains($uri, '/index.php')) {
        $uri = substr($uri, strpos($uri, '/index.php') + strlen('/index.php'));
        if ($uri === '') $uri = '/';
    }
    return rtrim($uri, '/') ?: '/';
})();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if ($path === '/debug/ping' && $method === 'GET') {
        json(['ok' => true, 'php' => PHP_VERSION], 200);
    }

    elseif ($path === '/register' && $method === 'POST') {
        handle_register();
    }

    else {
        fail('Not Found', 404);
    }

} catch (Throwable $e) {
    // Never leak internals
    error_log((string)$e);
    $debug = isset($_GET['debug']) && $_GET['debug'] == '1';
    if ($debug) json(['ok'=>false, 'error'=>'Server error', 'detail'=>$e->getMessage()], 500);
    fail('Server error', 500);
}

/* =======================================================================
   Handlers
   ======================================================================= */

function handle_register(): void {
    $in = body_json();

    $username = trim((string)($in['username'] ?? ''));
    $token_raw = trim((string)($in['token'] ?? ''));
    $email = trim((string)($in['email'] ?? ''));
    $whatsapp = trim((string)($in['whatsapp'] ?? ''));
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

    // Resolve tournament
    $q = $pdo->prepare("SELECT id, reg_start_utc, reg_end_utc FROM tournaments WHERE slug = ? LIMIT 1");
    $q->execute([$tournament_slug]);
    $t = $q->fetch(PDO::FETCH_ASSOC);
    if (!$t) { fail('tournament not found', 500); }

    $tournament_id = (int)$t['id'];
    $now_utc = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $reg_start = new DateTimeImmutable($t['reg_start_utc'], new DateTimeZone('UTC'));
    $reg_end   = new DateTimeImmutable($t['reg_end_utc'],   new DateTimeZone('UTC'));
    if ($now_utc < $reg_start) fail('Registration has not opened', 403);
    if ($now_utc >= $reg_end)  fail('Registration closed', 403);

    // Verify token with Deriv (REAL + USD)
    $app_id = (int)env('DERIV_APP_ID', 36300);
    $ws = new \Denara\DerivClient($app_id);
    try {
        $res  = $ws->authorize($token_raw);
        $auth = $res['authorize'] ?? [];
        $loginid   = (string)($auth['loginid'] ?? '');
        $isVirtual = (int)($auth['is_virtual'] ?? 0) === 1;
        $currency  = strtoupper((string)($auth['currency'] ?? ''));

        if ($loginid === '')            fail('Unable to authorize token (no loginid)', 400);
        if ($isVirtual || str_starts_with($loginid, 'VRTC')) fail('Real account token required (not VRTC)', 422);
        if ($currency !== 'USD')        fail('Only USD accounts allowed', 422);
    } finally {
        $ws->close();
    }

    // Same encryption as copy-trading:
    $token_enc  = token_encrypt_if_needed($token_raw);
    $token_hash = hash('sha256', $token_raw, true);
    $token_last4 = substr($token_raw, -4);
    $ip_hash = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0', true);

    // Insert / Update
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
    try {
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
    } catch (PDOException $e) {
        $em = $e->getMessage();
        if (str_contains($em, 'uq_tour_username')) fail('Username already registered', 409);
        if (str_contains($em, 'uq_tour_loginid'))  fail('This Deriv account is already registered', 409);
        if (str_contains($em, 'uq_tour_token'))    fail('This token is already registered', 409);
        throw $e;
    }

    json([
        'ok'       => true,
        'username' => $username,
        'loginid'  => $loginid,
        'currency' => $currency,
    ], 200);
}
