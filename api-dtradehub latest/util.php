<?php
// api/util.php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

/** Composer (textalk/websocket for DerivClient, etc.). Required for scripts hit directly, not only index.php. */
if (is_file(__DIR__ . '/vendor/autoload.php')) {
    require_once __DIR__ . '/vendor/autoload.php';
}

function cors() {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allow = in_array($origin, CORS_ALLOW_ORIGINS, true) ? $origin : '';
    if ($allow) {
        header("Access-Control-Allow-Origin: $allow");
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Credentials: false');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function pdo(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    return $pdo;
}

function json($data, int $code = 200): void {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $msg, int $code = 400): void {
    json(['error' => $msg], $code);
}

function body_json(): array {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function path(): string {
    $uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/';
    // If the API is mounted at /api, trim that prefix
    $script_dir = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/');
    if ($script_dir && str_starts_with($uri, $script_dir)) {
        $uri = substr($uri, strlen($script_dir));
    }
    return '/' . ltrim($uri, '/');
}

function method(): string {
    return $_SERVER['REQUEST_METHOD'] ?? 'GET';
}

function is_valid_username(string $u): bool {
    // letters, numbers, underscores, hyphens; 3–32 chars
    return (bool)preg_match('/^[a-zA-Z0-9_-]{3,32}$/', $u);
}

function decimal_or_null($v) {
    if ($v === null) return null;
    if ($v === '') return null;
    if (!is_numeric($v)) return null;
    return (float)$v;
}

/* ============================================================
 *               TOKEN ENCRYPTION HELPERS (AES-GCM)
 *   Format stored in DB (same 'token' column):
 *      enc:v1:gcm:<iv_b64url>:<cipher_b64url>:<tag_b64url>
 * ============================================================ */

/** base64url encode/decode (no padding) */
function b64u_enc(string $bin): string {
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}
function b64u_dec(string $b64): string {
    $b64 = strtr($b64, '-_', '+/');
    $pad = strlen($b64) % 4;
    if ($pad) $b64 .= str_repeat('=', 4 - $pad);
    $out = base64_decode($b64, true);
    if ($out === false) throw new RuntimeException('Base64 decode failed');
    return $out;
}

/** 32-byte key from env (accepts raw 32 bytes or base64/base64url) */
function token_master_key(): string {
    $env = getenv('TOKEN_MASTER_KEY');
    if (!$env) {
        throw new RuntimeException('TOKEN_MASTER_KEY not set');
    }
    // if looks like base64/base64url, decode; else treat as raw
    if (preg_match('#^[A-Za-z0-9\-_+/=]{43,44}$#', $env)) {
        // normalize url-safe to standard base64 then decode
        $std = strtr($env, '-_', '+/');
        $key = base64_decode($std, true);
    } else {
        $key = $env;
    }
    if ($key === false || strlen($key) !== 32) {
        throw new RuntimeException('TOKEN_MASTER_KEY must be exactly 32 bytes (use base64/base64url for transport)');
    }
    return $key;
}

function token_is_encrypted(string $s): bool {
    return strncmp($s, 'enc:v1:gcm:', 11) === 0;
}

/** Encrypt plaintext token into enc:v1:gcm:<iv>:<cipher>:<tag> (b64url parts) */
function token_encrypt(string $plaintext): string {
    $key = token_master_key();
    $iv  = random_bytes(12); // 96-bit IV for GCM
    $tag = '';
    $cipher = openssl_encrypt($plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, '', 16);
    if ($cipher === false || $tag === '') {
        throw new RuntimeException('Token encryption failed');
    }
    return 'enc:v1:gcm:' . b64u_enc($iv) . ':' . b64u_enc($cipher) . ':' . b64u_enc($tag);
}

/**
 * Decrypt if encrypted; otherwise return plaintext as-is.
 * Returns [string $plaintext, bool $was_plain]
 */
function token_decrypt_or_plain(string $maybe): array {
    if (!token_is_encrypted($maybe)) {
        return [$maybe, true];
    }
    $rest = substr($maybe, 11); // after 'enc:v1:gcm:'
    $parts = explode(':', $rest);
    if (count($parts) !== 3) {
        throw new RuntimeException('Bad token format (gcm)');
    }
    [$iv_b64, $cipher_b64, $tag_b64] = $parts;
    $iv     = b64u_dec($iv_b64);
    $cipher = b64u_dec($cipher_b64);
    $tag    = b64u_dec($tag_b64);
    $key    = token_master_key();
    $plain = openssl_decrypt($cipher, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, '');
    if ($plain === false) {
        throw new RuntimeException('Token decryption failed');
    }
    return [$plain, false];
}

/** Convenience—encrypt if not already encrypted */
function token_encrypt_if_needed(string $s): string {
    return token_is_encrypted($s) ? $s : token_encrypt($s);
}

/**
 * Lazy upgrade helper: if token was plaintext, write back encrypted.
 * Returns plaintext token.
 */
function token_lazy_upgrade(PDO $pdo, string $table, string $idField, $idValue, string $currentToken): string {
    [$plain, $was_plain] = token_decrypt_or_plain($currentToken);
    if ($was_plain) {
        $enc = token_encrypt($plain);
        $stmt = $pdo->prepare("UPDATE {$table} SET token=? WHERE {$idField}=?");
        $stmt->execute([$enc, $idValue]);
    }
    return $plain;
}

/* ============================================================
 *          ✅ BINARYKE: SECOND DATABASE CONNECTION
 * ============================================================ */

function pdo_binaryke(): PDO {
    static $pdo2 = null;
    if ($pdo2) return $pdo2;

    // Only load Binaryke DB config when needed
    require_once __DIR__ . '/binaryke_config.php';

    $dsn = 'mysql:host=' . BINARYKE_DB_HOST . ';dbname=' . BINARYKE_DB_NAME . ';charset=utf8mb4';
    $pdo2 = new PDO($dsn, BINARYKE_DB_USER, BINARYKE_DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    return $pdo2;
}

/* ============================================================
 *          ✅ JWT (HS256) — NO COMPOSER REQUIRED
 * ============================================================ */

function jwt_b64u_dec(string $s): string {
    $s = strtr($s, '-_', '+/');
    $pad = strlen($s) % 4;
    if ($pad) $s .= str_repeat('=', 4 - $pad);
    $out = base64_decode($s, true);
    if ($out === false) throw new RuntimeException('JWT base64 decode failed');
    return $out;
}

function jwt_verify_hs256(string $jwt, string $secret): array {
    $parts = explode('.', $jwt);
    if (count($parts) !== 3) throw new RuntimeException('Bad JWT format');

    [$h64, $p64, $s64] = $parts;

    $headerJson  = jwt_b64u_dec($h64);
    $payloadJson = jwt_b64u_dec($p64);

    $header  = json_decode($headerJson, true);
    $payload = json_decode($payloadJson, true);

    if (!is_array($header) || !is_array($payload)) throw new RuntimeException('Bad JWT JSON');

    $alg = (string)($header['alg'] ?? '');
    if ($alg !== 'HS256') throw new RuntimeException('JWT alg not supported');

    $sig  = jwt_b64u_dec($s64);
    $data = $h64 . '.' . $p64;
    $calc = hash_hmac('sha256', $data, $secret, true);

    if (!hash_equals($calc, $sig)) throw new RuntimeException('JWT signature invalid');

    if (isset($payload['exp']) && is_numeric($payload['exp'])) {
        if (time() >= (int)$payload['exp']) throw new RuntimeException('JWT expired');
    }

    return $payload;
}

function bearer_token(): string {
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if ($h === '') return '';
    if (stripos($h, 'Bearer ') !== 0) return '';
    return trim(substr($h, 7));
}

/**
 * Load Binaryke user using JWT and Binaryke DB.
 * Expects Binaryke DB table: users(id, deriv_token_enc, ...)
 */
function require_binaryke_user(PDO $pdo2): array {
    require_once __DIR__ . '/binaryke_config.php';

    $jwt = bearer_token();
    if ($jwt === '') fail('Missing Authorization Bearer token', 401);

    $secret = getenv('BINARYKE_JWT_SECRET') ?: '';
    if ($secret === '' || $secret === 'CHANGE_ME_TO_SAME_SECRET_AS_ISSUER') {
        fail('BINARYKE_JWT_SECRET not configured on backend', 500);
    }

    try {
        $payload = jwt_verify_hs256($jwt, $secret);
    } catch (Throwable $e) {
        fail('Invalid JWT: ' . $e->getMessage(), 401);
    }

    $uid = 0;
    foreach (['uid', 'user_id', 'id', 'sub'] as $k) {
        if (isset($payload[$k]) && is_numeric($payload[$k])) {
            $uid = (int)$payload[$k];
            break;
        }
    }
    if ($uid <= 0) fail('JWT missing user id (uid/sub)', 401);

    $st = $pdo2->prepare("SELECT * FROM users WHERE id=? LIMIT 1");
    $st->execute([$uid]);
    $u = $st->fetch();
    if (!$u) fail('User not found in Binaryke DB', 401);

    $u['_jwt'] = $payload; // optional debug
    return $u;
}

/* ============================================================
 *          ✅ DOMAIN FORMAT CHECK (basic)
 * ============================================================ */
function is_valid_domain_name(string $d): bool {
    // basic: something.tld (no spaces), allows hyphen
    return (bool)preg_match('/^(?!-)[a-z0-9-]{1,63}(?<!-)\.[a-z]{2,24}$/i', $d);
}
