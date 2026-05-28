<?php
// ttt.binaryke.com/api/oauth_register.php
declare(strict_types=1);

// ---- CORS ----
$allowed_origins = [
  'https://www.denarapro.com',
  'https://denarapro.com',
  'https://site.denaratool.com',
  'https://www.denaradigitpro.com',
  'https://localhost:8443',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed_origins, true)) {
    header("Access-Control-Allow-Origin: $origin");
    header("Vary: Origin");
}
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ---- load .env from same dir as this file (you said it’s inside /api) ----
$env = [];
$envPath = __DIR__ . '/.env';
if (is_readable($envPath)) {
    foreach (file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (strpos($line, '=') !== false && strpos(ltrim($line), '#') !== 0) {
            [$k, $v] = array_map('trim', explode('=', $line, 2));
            $env[$k] = $v;
        }
    }
} else {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Missing .env']);
    exit;
}

// ---- DB & ENC key ----
$db_host = $env['DB_HOST'] ?? 'localhost';
$db_name = $env['DB_NAME'] ?? '';
$db_user = $env['DB_USER'] ?? '';
$db_pass = $env['DB_PASS'] ?? '';

$enc_key = '';
if (!empty($env['ENC_KEY_B64'])) {
  $enc_key = base64_decode($env['ENC_KEY_B64'], true) ?: '';
} else {
  $enc_key = $env['ENC_KEY'] ?? '';
}
if (strlen($enc_key) !== 32) {
  http_response_code(500);
  echo json_encode(['ok' => false, 'error' => 'Invalid ENC_KEY']);
  exit;
}

// ---- input JSON: { user_key?, accounts: [{loginid, token, currency}], active_loginid } ----
$raw = file_get_contents('php://input') ?: '';
$body = json_decode($raw, true);
$accounts = $body['accounts'] ?? [];
$active_loginid = trim((string)($body['active_loginid'] ?? ''));
$user_key = trim((string)($body['user_key'] ?? 'deriv-oauth'));

if (!is_array($accounts) || empty($accounts)) {
  http_response_code(400);
  echo json_encode(['ok' => false, 'error' => 'No accounts provided']);
  exit;
}

try {
  $pdo = new PDO("mysql:host={$db_host};dbname={$db_name};charset=utf8mb4", $db_user, $db_pass, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ]);

  $sql = "INSERT INTO users
            (user_key, loginid, currency, token_cipher, token_iv, token_tag, is_active, last_login_at)
          VALUES
            (:user_key, :loginid, :currency, :cipher, :iv, :tag, :is_active, NOW())
          ON DUPLICATE KEY UPDATE
            currency = VALUES(currency),
            token_cipher = VALUES(token_cipher),
            token_iv = VALUES(token_iv),
            token_tag = VALUES(token_tag),
            is_active = VALUES(is_active),
            last_login_at = NOW(),
            updated_at = CURRENT_TIMESTAMP";

  $stmt = $pdo->prepare($sql);

  $saved = [];
  foreach ($accounts as $acc) {
    $loginid = trim((string)($acc['loginid'] ?? ''));
    $token   = trim((string)($acc['token'] ?? ''));
    $currency= trim((string)($acc['currency'] ?? ''));

    if ($loginid === '' || $token === '') continue;

    $iv = random_bytes(16);
    $tag = '';
    $cipher = openssl_encrypt($token, 'aes-256-gcm', $enc_key, OPENSSL_RAW_DATA, $iv, $tag);
    if ($cipher === false) continue;

    $stmt->execute([
      ':user_key' => $user_key,
      ':loginid'  => $loginid,
      ':currency' => $currency ?: null,
      ':cipher'   => $cipher,
      ':iv'       => $iv,
      ':tag'      => $tag,
      ':is_active'=> ($active_loginid === $loginid) ? 1 : 1, // mark all active for now
    ]);

    $saved[] = $loginid;
  }

  echo json_encode(['ok' => true, 'saved' => $saved, 'count' => count($saved)]);
} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode(['ok' => false, 'error' => 'DB error']);
}
