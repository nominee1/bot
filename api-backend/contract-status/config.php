<?php
// Allow your local dev and your prod
$allowed_origins = [
    'https://localhost:8444',
    'https://denarapro.com',
];

function allow_cors() {
    global $allowed_origins;
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (in_array($origin, $allowed_origins, true)) {
        header("Access-Control-Allow-Origin: $origin");
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

$STORE_FILE = __DIR__ . '/status_store.json';
$SECRET = 'bebina1@N'; // set the same in your caller/tool
