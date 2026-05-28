<?php
declare(strict_types=1);

require_once __DIR__ . '/util.php';

header('Content-Type: application/json; charset=utf-8');

// CORS
$allowed_origins = [
  'https://www.denarapro.com',
  'https://denarapro.com',
  'https://site.denaratool.com',
  'https://www.denaradigitpro.com',
  'https://localhost:8443',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin && in_array($origin, $allowed_origins, true)) {
    header("Access-Control-Allow-Origin: $origin");
    header("Vary: Origin");
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$raw  = file_get_contents('php://input');
$body = json_decode($raw ?: '[]', true);
$pin  = isset($body['pin']) ? trim((string)$body['pin']) : '';

if ($pin === '') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Missing pin']);
    exit;
}

try {
    $pdo = pdo();

    $stmt = $pdo->prepare('
        SELECT id, username
        FROM traders_competition_2
        WHERE CONCAT(username, id) = :pin
        LIMIT 1
    ');
    $stmt->execute([':pin' => $pin]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Invalid PIN']);
        exit;
    }

    echo json_encode([
        'ok'         => true,
        'participant'=> [
            'id'       => (int)$row['id'],
            'username' => $row['username'],
        ],
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'ok'    => false,
        'error' => 'Server error: ' . $e->getMessage(),
    ]);
}