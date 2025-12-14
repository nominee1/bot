<?php
// public_html/ttt/api/register.php
declare(strict_types=1);

/**
 * Denara Tournament Registration @ /ttt/api/register.php
 * - Resolves tournament by slug from .env
 * - Validates window (UTC)
 * - Authorizes Deriv token (REAL USD only)
 * - Encrypts token (sodium XChaCha20-Poly1305)
 * - Inserts/updates tournament_participants row
 * - Always replies JSON (handles fatals)
 */

/* ---------- JSON + CORS ---------- */
header('Content-Type: application/json; charset=utf-8');
$allowed_origins = [
  'https://www.denarapro.com',
  'https://denarapro.com',
  'https://site.denaratool.com',
  'https://localhost:8443',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin && in_array($origin, $allowed_origins, true)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

/* ---------- Output buffering & error normalization ---------- */
ini_set('display_errors', '0');
error_reporting(E_ALL);
ob_start();

$__json_error_sent = false;
function __send_json_error(int $code, string $msg): void {
    global $__json_error_sent;
    if ($__json_error_sent) return;
    $__json_error_sent = true;
    if (ob_get_length()) { ob_clean(); }
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_SLASHES);
    ob_end_flush();
    exit;
}
set_exception_handler(fn(Throwable $e) => __send_json_error(500, 'Server error: '.$e->getMessage()));
set_error_handler(function ($no, $str) { __send_json_error(500, 'Server error: '.$str); return true; });
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && !in_array($e['type'], [E_NOTICE, E_WARNING, E_USER_NOTICE, E_USER_WARNING], true)) {
        __send_json_error(500, 'Server crashed before responding');
    }
});

/* ---------- Optional file debug logging (not echoed) ---------- */
function dbg_log(string $line): void {
    $log = __DIR__ . '/../logs/tournament_register.log';
    if (!is_dir(dirname($log))) { @mkdir(dirname($log), 0775, true); }
    @file_put_contents($log, '['.date('c')."] ".$line.PHP_EOL, FILE_APPEND);
}

/* ---------- Only POST ---------- */
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    __send_json_error(405, 'Method not allowed');
}

/* ---------- Load .env (expected at /public_html/ttt/.env or /public_html/.env) ---------- */
$env = [];
$envCandidates = [
    __DIR__ . '/../.env',       // /public_html/ttt/.env
    __DIR__ . '/../../.env',    // /public_html/.env
];
$envPath = null;
foreach ($envCandidates as $cand) {
    if (is_readable($cand)) { $envPath = $cand; break; }
}
if (!$envPath) { __send_json_error(500, '.env missing'); }

foreach (file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    if ($line === '' || $line[0] === '#') continue;
    $pos = strpos($line, '=');
    if ($pos === false) continue;
    $k = trim(substr($line, 0, $pos));
    $v = trim(substr($line, $pos+1));
    $env[$k] = $v;
}

$DB_HOST = $env['DB_HOST'] ?? '';
$DB_NAME = $env['DB_NAME'] ?? '';
$DB_USER = $env['DB_USER'] ?? '';
$DB_PASS = $env['DB_PASS'] ?? '';
$DERIV_APP_ID = (int)($env['DERIV_APP_ID'] ?? '0');
$TOURNAMENT_SLUG = $env['TOURNAMENT_SLUG'] ?? '';
$SODIUM_KEY_B64 = $env['SODIUM_KEY_BASE64'] ?? '';

if (!$DB_HOST || !$DB_NAME || !$DB_USER || !$DERIV_APP_ID || !$TOURNAMENT_SLUG || !$SODIUM_KEY_B64) {
    __send_json_error(500, 'Server env not configured');
}

/* ---------- Includes (robust path resolution) ---------- */
function require_first(array $candidates, string $what): void {
    foreach ($candidates as $p) {
        if (is_readable($p)) { require_once $p; return; }
    }
    $joined = implode("\n - ", array_map(function($p){ $rp=@realpath($p); return $rp!==false?$rp:$p; }, $candidates));
    throw new RuntimeException("Missing {$what}. Tried:\n - {$joined}");
}
$lib_candidates = [
    __DIR__ . '/../../lib',   // /public_html/lib
    __DIR__ . '/../lib',      // /public_html/ttt/lib
    __DIR__ . '/../../../lib' // /public_html/../lib (fallback)
];
$crypto_candidates = array_map(fn($d) => $d . '/crypto.php', $lib_candidates);
$deriv_candidates  = array_map(fn($d) => $d . '/DerivClient.php', $lib_candidates);

require_first($crypto_candidates, 'crypto.php');
require_first($deriv_candidates,  'DerivClient.php');

/* ---------- Parse JSON body ---------- */
$raw = file_get_contents('php://input') ?: '';
if ($raw === '') __send_json_error(400, 'Empty body');
$data = json_decode($raw, true);
if (!is_array($data)) __send_json_error(400, 'Invalid JSON');

$username = trim((string)($data['username'] ?? ''));
$token    = trim((string)($data['token'] ?? ''));
$email    = trim((string)($data['email'] ?? ''));
$whatsapp = trim((string)($data['whatsapp'] ?? ''));

if ($username === '' || $token === '') __send_json_error(422, 'Username and token are required');
if (strlen($username) < 3 || strlen($username) > 64) __send_json_error(422, 'Username length invalid');
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) __send_json_error(422, 'Invalid email');
if ($whatsapp !== '') {
    $w = preg_replace('/[()\-\s]/', '', $whatsapp);
    if (!preg_match('/^\+?\d{7,15}$/', $w)) __send_json_error(422, 'Invalid phone');
}

/* ---------- DB connect ---------- */
try {
    $pdo = new PDO(
        "mysql:host=$DB_HOST;dbname=$DB_NAME;charset=utf8mb4",
        $DB_USER,
        $DB_PASS,
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]
    );
} catch (Throwable $e) {
    dbg_log('DB connect failed: '.$e->getMessage());
    __send_json_error(500, 'DB connect failed');
}

/* ---------- Load tournament by slug ---------- */
$st = $pdo->prepare("SELECT id, reg_start_utc, reg_end_utc FROM tournaments WHERE slug = :slug LIMIT 1");
$st->execute([':slug' => $TOURNAMENT_SLUG]);
$t = $st->fetch();
if (!$t) __send_json_error(500, 'Tournament not found');

$tournament_id = (int)$t['id'];
$regStart = new DateTimeImmutable($t['reg_start_utc'], new DateTimeZone('UTC'));
$regEnd   = new DateTimeImmutable($t['reg_end_utc'],   new DateTimeZone('UTC'));
$nowUtc   = new DateTimeImmutable('now', new DateTimeZone('UTC'));
if ($nowUtc < $regStart) __send_json_error(403, 'Registration has not opened');
if ($nowUtc >= $regEnd)  __send_json_error(403, 'Registration closed');

/* ---------- Rate limit helper (hashed IP) ---------- */
$ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$ip_hash = hash('sha256', $ip, true);

/* ---------- Authorize token with Deriv ---------- */
try {
    $dc = new DerivClient($DERIV_APP_ID);
    $auth = $dc->authorize($token); // ['loginid'=>..., 'is_virtual'=>0|1, 'currency'=>'USD'|null]
} catch (Throwable $e) {
    dbg_log('Deriv authorize failed: '.$e->getMessage());
    __send_json_error(400, 'Token authorization failed');
}
$loginid    = (string)($auth['loginid'] ?? '');
$is_virtual = (int)($auth['is_virtual'] ?? 0);
$currency   = strtoupper((string)($auth['currency'] ?? ''));

if ($loginid === '' || $is_virtual === 1 || str_starts_with($loginid, 'VRTC')) {
    __send_json_error(422, 'Real account token required');
}
if ($currency !== 'USD') {
    __send_json_error(422, 'Only USD accounts allowed');
}

/* ---------- Encrypt token & compute hashes ---------- */
$key = base64_decode($SODIUM_KEY_B64, true);
if ($key === false || strlen($key) !== SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_KEYBYTES) {
    __send_json_error(500, 'Sodium key invalid');
}
$nonce  = null;  // will be filled by crypto_encrypt_token
$cipher = crypto_encrypt_token($token, $key, $nonce);
$thash  = hash('sha256', $token, true);
$last4  = substr($token, -4);

/* ---------- Insert / Update participant ---------- */
$phone_norm = ($whatsapp !== '') ? preg_replace('/[()\-\s]/', '', $whatsapp) : null;

try {
    $sql = "
        INSERT INTO tournament_participants
           (tournament_id, username, loginid, is_virtual, currency,
            email, whatsapp, token_ciphertext, token_nonce, token_hash_sha256, token_last4, ip_hash_sha256)
        VALUES
           (:tid, :username, :loginid, :is_virtual, :currency,
            :email, :whatsapp, :cipher, :nonce, :thash, :last4, :iphash)
        ON DUPLICATE KEY UPDATE
            email = VALUES(email),
            whatsapp = VALUES(whatsapp),
            token_ciphertext = VALUES(token_ciphertext),
            token_nonce = VALUES(token_nonce),
            updated_at = CURRENT_TIMESTAMP
    ";
    $ins = $pdo->prepare($sql);
    $ins->execute([
        ':tid'      => $tournament_id,
        ':username' => $username,
        ':loginid'  => $loginid,
        ':is_virtual'=> $is_virtual,
        ':currency' => $currency,
        ':email'    => ($email !== '') ? $email : null,
        ':whatsapp' => $phone_norm,
        ':cipher'   => $cipher,
        ':nonce'    => $nonce,
        ':thash'    => $thash,
        ':last4'    => $last4,
        ':iphash'   => $ip_hash,
    ]);
} catch (PDOException $e) {
    $em = $e->getMessage();
    dbg_log('Insert failed: '.$em);
    $msg = 'Registration failed';
    if (str_contains($em, 'uq_tour_username')) $msg = 'Username already registered';
    if (str_contains($em, 'uq_tour_loginid'))  $msg = 'This Deriv account is already registered';
    if (str_contains($em, 'uq_tour_token'))    $msg = 'This token is already registered';
    __send_json_error(409, $msg);
}

/* ---------- Success ---------- */
http_response_code(200);
$out = [
  'ok'       => true,
  'username' => $username,
  'loginid'  => $loginid,
  'currency' => $currency,
];
if (ob_get_length()) { ob_clean(); }
echo json_encode($out, JSON_UNESCAPED_SLASHES);
ob_end_flush();
exit;
