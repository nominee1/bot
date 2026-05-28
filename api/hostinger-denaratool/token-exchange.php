<?php
/**
 * Deriv OAuth2 token exchange (authorization_code + PKCE).
 * Place on Hostinger under: https://denaratool.com/api/token-exchange.php
 *
 * Expects POST JSON:
 * {
 *   "code": "...",
 *   "code_verifier": "...",
 *   "redirect_uri": "https://www.denarapro.com" | "https://www.denaradigitpro.com"
 * }
 *
 * On successful exchange, this endpoint also attempts server-side
 * GET /trading/v1/options/accounts and returns it as `accounts`.
 * This keeps frontend login resilient when browser CORS blocks direct calls.
 *
 * Docs: https://developers.deriv.com/docs/intro/oauth/
 */

declare(strict_types=1);

$configPath = __DIR__ . '/config.php';
if (!is_readable($configPath)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'error' => 'server_misconfigured',
        'error_description' => 'Copy config.example.php to config.php on the server.',
    ]);
    exit;
}

require $configPath;

if (!defined('DERIV_OAUTH_CLIENT_ID_DENARATOOL')) {
    define('DERIV_OAUTH_CLIENT_ID_DENARATOOL', '33b2X6gZpNYQHiIMC2Zd6');
}

// --- CORS (browser calls from your React app)
$allowed_origins = [
    'https://www.denarapro.com',
    'https://denarapro.com',
    'https://www.denaradigitpro.com',
    'https://denaradigitpro.com',
    'https://app.denaratool.com',
    'https://denaratool.com',
    'http://nikokardi.com',
    'https://nikokardi.com',
    'http://www.nikokardi.com',
    'https://www.nikokardi.com',
    'http://localhost:8443',
    'http://127.0.0.1:8443',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
];

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && in_array($origin, $allowed_origins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}

header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Max-Age: 86400');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'method_not_allowed']);
    exit;
}

$raw = file_get_contents('php://input');
$input = json_decode($raw ?: 'null', true);

if (!is_array($input)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_json']);
    exit;
}

$code = isset($input['code']) ? trim((string) $input['code']) : '';
$code_verifier = isset($input['code_verifier']) ? trim((string) $input['code_verifier']) : '';
$redirect_uri = isset($input['redirect_uri']) ? trim((string) $input['redirect_uri']) : DERIV_DEFAULT_REDIRECT_URI;

if ($code === '' || $code_verifier === '') {
    http_response_code(400);
    echo json_encode([
        'error' => 'invalid_request',
        'error_description' => 'Missing code or code_verifier.',
    ]);
    exit;
}

if ($redirect_uri === '') {
    $redirect_uri = DERIV_DEFAULT_REDIRECT_URI;
}

// Same Hostinger script serves Digit Pro + DenaraPro: OAuth client must match the app that issued `code`.
// Check Digit Pro host first — `denarapro.com` is a substring of `denaradigitpro.com` host matching order matters.
$oauth_client_id = DERIV_OAUTH_CLIENT_ID;
if (str_contains($redirect_uri, 'denaradigitpro.com')) {
    $oauth_client_id = DERIV_OAUTH_CLIENT_ID_DENARADIGITPRO;
} elseif (str_contains($redirect_uri, 'denarapro.com')) {
    $oauth_client_id = DERIV_OAUTH_CLIENT_ID_DENARAPRO;
} elseif (str_contains($redirect_uri, 'app.denaratool.com')) {
    $oauth_client_id = DERIV_OAUTH_CLIENT_ID_DENARATOOL;
} elseif (str_contains($redirect_uri, 'nikokardi.com')) {
    $oauth_client_id = defined('DERIV_OAUTH_CLIENT_ID_NIKOKARDI')
        ? DERIV_OAUTH_CLIENT_ID_NIKOKARDI
        : '33l7uBqbaXBfDbITxfbjX';
}
/** Options REST uses the OAuth2 client id — not legacy numeric WS app_id (71070, 66945, …). */
$options_deriv_app_id = $oauth_client_id;

$body = http_build_query([
    'grant_type' => 'authorization_code',
    'client_id' => $oauth_client_id,
    'code' => $code,
    'code_verifier' => $code_verifier,
    'redirect_uri' => $redirect_uri,
], '', '&', PHP_QUERY_RFC3986);

$ch = curl_init(DERIV_TOKEN_URL);
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/x-www-form-urlencoded',
        'Accept: application/json',
    ],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 30,
]);

$responseBody = curl_exec($ch);
$curlErr = curl_error($ch);
$status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($responseBody === false) {
    http_response_code(502);
    echo json_encode([
        'error' => 'token_request_failed',
        'error_description' => $curlErr ?: 'empty response',
    ]);
    exit;
}

http_response_code($status >= 100 && $status < 600 ? $status : 502);

$tokenJson = json_decode($responseBody, true);
if (!is_array($tokenJson)) {
    header('Content-Type: application/json; charset=utf-8');
    echo $responseBody;
    exit;
}

if ($status < 200 || $status >= 300) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($tokenJson, JSON_UNESCAPED_SLASHES);
    exit;
}

$access_token = isset($tokenJson['access_token']) ? trim((string) $tokenJson['access_token']) : '';
if ($access_token === '') {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($tokenJson, JSON_UNESCAPED_SLASHES);
    exit;
}

// Best-effort: attach options accounts for frontend hydration.
$accountsUrl = 'https://api.derivws.com/trading/v1/options/accounts';
$accCh = curl_init($accountsUrl);
curl_setopt_array($accCh, [
    CURLOPT_HTTPGET => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $access_token,
        'Deriv-App-ID: ' . (string) $options_deriv_app_id,
        'Accept: application/json',
    ],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 20,
]);
$accBody = curl_exec($accCh);
$accStatus = (int) curl_getinfo($accCh, CURLINFO_HTTP_CODE);
curl_close($accCh);

if ($accBody !== false && $accStatus >= 200 && $accStatus < 300) {
    $accJson = json_decode($accBody, true);
    if (is_array($accJson)) {
        // Accept both {data:[...]} and {data:{data:[...]}} patterns.
        $rows = [];
        if (isset($accJson['data']) && is_array($accJson['data'])) {
            $isList = array_keys($accJson['data']) === range(0, count($accJson['data']) - 1);
            if ($isList) {
                $rows = $accJson['data'];
            } elseif (isset($accJson['data']['data']) && is_array($accJson['data']['data'])) {
                $rows = $accJson['data']['data'];
            }
        } elseif (isset($accJson['accounts']) && is_array($accJson['accounts'])) {
            $rows = $accJson['accounts'];
        }
        if ($rows) {
            $tokenJson['accounts'] = $rows;
        }
    }
}

header('Content-Type: application/json; charset=utf-8');
echo json_encode($tokenJson, JSON_UNESCAPED_SLASHES);
