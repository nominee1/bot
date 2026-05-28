<?php
declare(strict_types=1);
require __DIR__ . '/db.php';
require __DIR__ . '/helpers.php';

cors();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$request_uri = $_SERVER['REQUEST_URI'] ?? '/';

// Detect base path more flexibly (works whether you have trailing slash or not)
$BASE = '/api/copytrade';
if (strpos($request_uri, $BASE) !== 0) {
    json_out(404, ['error' => 'Not found']);
}
$route = rtrim(substr($request_uri, strlen($BASE)), '/');
if ($route === '') $route = '/';

try {
    if ($method === 'GET' && $route === '/') {
        json_out(200, ['ok' => true, 'service' => 'copytrade', 'ts' => time()]);
    }

    // POST /traders
    if ($method === 'POST' && $route === '/traders') {
        $data = body_json();
        $username = trim($data['username'] ?? '');
        $token = trim($data['token'] ?? '');
        $min_balance = positive_amount($data['min_balance'] ?? 0);
        $price = sanitize_price($data['price_usd'] ?? '');

        if ($username === '' || $token === '' || $min_balance === 'ERR' || $price === 'ERR') {
            json_out(422, ['error' => 'Invalid input']);
        }

        $pdo = pdo();
        try {
            $stmt = $pdo->prepare("INSERT INTO copy_traders (username, min_balance, token, price_usd) VALUES (?,?,?,?)");
            $stmt->execute([$username, $min_balance, $token, $price]);
        } catch (PDOException $e) {
            // MySQL duplicate key
            if ($e->errorInfo[1] === 1062) {
                json_out(409, ['error' => 'Username already exists']);
            }
            error_log('INSERT trader error: ' . $e->getMessage());
            json_out(500, ['error' => 'Insert failed']);
        }

        $id = (int)$pdo->lastInsertId();
        $row = $pdo->prepare("SELECT id, username, min_balance, price_usd, created_at FROM copy_traders WHERE id = ?");
        $row->execute([$id]);
        $res = $row->fetch();
        $res['active_copiers'] = 0;
        json_out(201, $res);
    }

    // POST /copiers
    if ($method === 'POST' && $route === '/copiers') {
        $data = body_json();
        $username = trim($data['username'] ?? '');
        $token = trim($data['token'] ?? '');
        if ($username === '' || $token === '') {
            json_out(422, ['error' => 'Invalid input']);
        }

        $pdo = pdo();
        try {
            $stmt = $pdo->prepare("INSERT INTO copy_copiers (username, token) VALUES (?,?)");
            $stmt->execute([$username, $token]);
        } catch (PDOException $e) {
            if ($e->errorInfo[1] === 1062) {
                json_out(409, ['error' => 'Username already exists']);
            }
            error_log('INSERT copier error: ' . $e->getMessage());
            json_out(500, ['error' => 'Insert failed']);
        }

        $id = (int)$pdo->lastInsertId();
        $row = $pdo->prepare("SELECT id, username, created_at FROM copy_copiers WHERE id = ?");
        $row->execute([$id]);
        json_out(201, $row->fetch());
    }

    // GET /traders
    if ($method === 'GET' && $route === '/traders') {
        $pdo = pdo();
        $sql = "
          SELECT t.id, t.username, t.min_balance, t.price_usd, t.created_at,
                 COALESCE(SUM(r.status='active'),0) AS active_copiers
          FROM copy_traders t
          LEFT JOIN copy_relationships r ON r.trader_id = t.id
          GROUP BY t.id
          ORDER BY t.created_at DESC
        ";
        $rows = $pdo->query($sql)->fetchAll();
        json_out(200, $rows);
    }

    json_out(404, ['error' => 'Unknown route', 'route' => $route]);
} catch (Throwable $e) {
    error_log('Router error: ' . $e->getMessage());
    json_out(500, ['error' => 'Server error']);
}
