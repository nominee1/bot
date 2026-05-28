<?php
declare(strict_types=1);

require_once __DIR__ . '/util.php';

// CORS
$allowed_origins = [
  'https://www.denarapro.com',
  'https://denarapro.com',
  'https://site.denaratool.com',
  'https://www.denaradigitpro.com',
  'https://marketing-tawny-ten.vercel.app',
  'https://localhost:8443',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin && in_array($origin, $allowed_origins, true)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function traders_competition_select_cols(): string {
    return 'id, username, token, password_hash';
}

function respond_token_json(array $row, ?array $lookup): void {
    $stored_token = (string)($row['token'] ?? '');
    if ($stored_token === '') {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'No token stored']);
        exit;
    }

    [$plain_token, ] = token_decrypt_or_plain($stored_token);

    echo json_encode([
        'ok'       => true,
        'id'       => (int)$row['id'],
        'username' => $row['username'],
        'token'    => $plain_token,
        'updated'  => null,
        'lookup'   => $lookup,
    ]);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    $pdo = pdo();
    $cols = traders_competition_select_cols();

    if ($method === 'POST') {
        $raw = file_get_contents('php://input');
        $in  = is_string($raw) ? json_decode($raw, true) : null;
        $in  = is_array($in) ? $in : [];

        $username = trim((string)($in['username'] ?? ''));
        $password = (string)($in['password'] ?? '');

        if ($username === '') {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'username is required']);
            exit;
        }

        $stmt = $pdo->prepare("
            SELECT {$cols}
            FROM traders_competition_2
            WHERE TRIM(LOWER(username)) = TRIM(LOWER(:u))
            LIMIT 1
        ");
        $stmt->execute([':u' => $username]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            http_response_code(401);
            echo json_encode(['ok' => false, 'error' => 'Invalid username or password.']);
            exit;
        }

        $hash = isset($row['password_hash']) ? trim((string)$row['password_hash']) : '';

        if ($hash !== '') {
            if (!password_verify($password, $hash)) {
                http_response_code(401);
                echo json_encode(['ok' => false, 'error' => 'Invalid username or password.']);
                exit;
            }
        }

        respond_token_json($row, ['by' => 'username', 'value' => $username]);
        exit;
    }

    if ($method !== 'GET') {
        http_response_code(405);
        echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
        exit;
    }

    $id       = isset($_GET['id']) ? trim($_GET['id']) : null;
    $username = isset($_GET['username']) ? trim($_GET['username']) : null;
    $latest   = isset($_GET['latest']) ? (int)$_GET['latest'] : 0;

    $row    = null;
    $lookup = null;

    if ($id !== null && $id !== '') {
        if (!ctype_digit($id)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Invalid id']);
            exit;
        }
        $stmt = $pdo->prepare("
            SELECT {$cols}
            FROM traders_competition_2
            WHERE id = :id
            LIMIT 1
        ");
        $stmt->execute([':id' => (int)$id]);
        $row    = $stmt->fetch();
        $lookup = ['by' => 'id', 'value' => (int)$id];
    }

    if (!$row && $username !== null && $username !== '') {
        $stmt = $pdo->prepare("
            SELECT {$cols}
            FROM traders_competition_2
            WHERE TRIM(LOWER(username)) = TRIM(LOWER(:u))
            LIMIT 1
        ");
        $stmt->execute([':u' => $username]);
        $row    = $stmt->fetch();
        $lookup = ['by' => 'username', 'value' => $username];
    }

    if (!$row && $latest === 1) {
        $stmt = $pdo->query("
            SELECT {$cols}
            FROM traders_competition_2
            ORDER BY id DESC
            LIMIT 1
        ");
        $row    = $stmt->fetch();
        $lookup = ['by' => 'latest', 'value' => 1];
    }

    if (!$row) {
        http_response_code(404);
        echo json_encode([
            'ok'     => false,
            'error'  => 'User not found',
            'lookup' => $lookup,
        ]);
        exit;
    }

    respond_token_json($row, $lookup);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'ok'    => false,
        'error' => 'DB error: ' . $e->getMessage(),
    ]);
}
