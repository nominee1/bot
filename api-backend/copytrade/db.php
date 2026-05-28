
<?php
declare(strict_types=1);

// 🔧 Make sure these match your Hostinger DB
const DB_HOST = 'localhost';
const DB_NAME = 'u822822525_Tounament';
const DB_USER = 'u822822525_mkuu';
const DB_PASS = 'bebina1@N';
const DB_CHARSET = 'utf8mb4';

$ALLOWED_ORIGINS = [
  'https://denarapro.com',
  'https://www.denarapro.com',
  'https://site.denaratool.com',
  'https://ttt.binaryke.com',
  'https://localhost:8443',
  'http://localhost:5173',
];

function cors(): void {
    global $ALLOWED_ORIGINS;

    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin && in_array($origin, $ALLOWED_ORIGINS, true)) {
        header("Access-Control-Allow-Origin: $origin");
        header("Vary: Origin");
        header("Access-Control-Allow-Credentials: true");
    } else {
        // Fallback if no origin (e.g., curl tests)
        header("Access-Control-Allow-Origin: https://ttt.binaryke.com");
    }

    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Content-Type: application/json; charset=utf-8');

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function pdo(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;

    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', DB_HOST, DB_NAME, DB_CHARSET);
    try {
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        return $pdo;
    } catch (Throwable $e) {
        error_log('DB connect error: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['error' => 'DB connection failed']);
        exit;
    }
}

function json_out(int $code, $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

