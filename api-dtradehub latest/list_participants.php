<?php
declare(strict_types=1);

// ---- CORS ----
$allowed_origins = [
  'https://www.denarapro.com',
  'https://denarapro.com',
  'https://site.denaratool.com',
  'https://www.denaradigitpro.com',
  'https://marketing-tawny-ten.vercel.app',
  'https://localhost:8443',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed_origins, true)) {
  header("Access-Control-Allow-Origin: $origin");
  header('Vary: Origin');
}
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

// ---- Load .env (from same dir) ----
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

// ---- DB config from .env ----
$db_host = $env['DB_HOST'] ?? 'localhost';
$db_name = $env['DB_NAME'] ?? '';
$db_user = $env['DB_USER'] ?? '';
$db_pass = $env['DB_PASS'] ?? '';

// ---- Query params ----
$limit  = isset($_GET['limit'])  ? max(1, min(200, (int)$_GET['limit'])) : 50;
$offset = isset($_GET['offset']) ? max(0, (int)$_GET['offset']) : 0;
$q      = trim($_GET['q'] ?? '');

try {
  $pdo = new PDO(
    "mysql:host={$db_host};dbname={$db_name};charset=utf8mb4",
    $db_user,
    $db_pass,
    [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]
  );

  $where  = '';
  $params = [];
  if ($q !== '') {
    $where = 'WHERE username LIKE :q';
    $params[':q'] = '%' . $q . '%';
  }

  $countSql = "SELECT COUNT(*) AS c FROM traders_competition_2 {$where}";
  $countStmt = $pdo->prepare($countSql);
  $countStmt->execute($params);
  $total = (int)($countStmt->fetch()['c'] ?? 0);

  $sql = "SELECT id, username, created_at
          FROM traders_competition_2
          {$where}
          ORDER BY created_at DESC, username ASC
          LIMIT :limit OFFSET :offset";

  $stmt = $pdo->prepare($sql);
  foreach ($params as $k => $v) {
    $stmt->bindValue($k, $v, PDO::PARAM_STR);
  }
  $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
  $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
  $stmt->execute();

  $rows = $stmt->fetchAll();

  echo json_encode([
    'ok'     => true,
    'results'=> $rows,
    'total'  => $total,
    'limit'  => $limit,
    'offset' => $offset,
  ]);
} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode([
    'ok'    => false,
    'error' => 'DB error: ' . $e->getMessage(),
  ]);
}