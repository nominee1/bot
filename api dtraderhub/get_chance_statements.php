<?php
declare(strict_types=1);

require_once __DIR__ . '/util.php';

cors();

if (method() !== 'GET') {
    fail('Method not allowed', 405);
}

try {
    $pdo = pdo();

    $username = trim((string)($_GET['username'] ?? 'options_oracle'));
    $limit = isset($_GET['limit']) ? max(1, min(1000, (int)$_GET['limit'])) : 300;

    if ($username === '') {
        fail('username required');
    }

    $stmt = $pdo->prepare("
        SELECT
            id,
            username,
            transaction_time,
            action_type,
            reference_id,
            reference_type,
            amount,
            balance_after
        FROM chance_virtual_statements
        WHERE username = ?
        ORDER BY transaction_time DESC, id DESC
        LIMIT ?
    ");
    $stmt->bindValue(1, $username, PDO::PARAM_STR);
    $stmt->bindValue(2, $limit, PDO::PARAM_INT);
    $stmt->execute();

    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $countStmt = $pdo->prepare("
        SELECT COUNT(*) AS total_rows
        FROM chance_virtual_statements
        WHERE username = ?
    ");
    $countStmt->execute([$username]);
    $countRow = $countStmt->fetch(PDO::FETCH_ASSOC) ?: ['total_rows' => 0];
    $totalRows = (int)($countRow['total_rows'] ?? 0);

    $oldestStmt = $pdo->prepare("
        SELECT
            id,
            username,
            transaction_time,
            action_type,
            reference_id,
            reference_type,
            amount,
            balance_after
        FROM chance_virtual_statements
        WHERE username = ?
        ORDER BY transaction_time ASC, id ASC
        LIMIT 1
    ");
    $oldestStmt->execute([$username]);
    $oldest = $oldestStmt->fetch(PDO::FETCH_ASSOC) ?: null;

    $latestStmt = $pdo->prepare("
        SELECT
            id,
            username,
            transaction_time,
            action_type,
            reference_id,
            reference_type,
            amount,
            balance_after
        FROM chance_virtual_statements
        WHERE username = ?
        ORDER BY transaction_time DESC, id DESC
        LIMIT 1
    ");
    $latestStmt->execute([$username]);
    $latest = $latestStmt->fetch(PDO::FETCH_ASSOC) ?: null;

    $buys = 0;
    $sells = 0;
    $turnover = 0.0;

    foreach ($rows as $r) {
        $action = strtolower(trim((string)($r['action_type'] ?? '')));
        $amount = isset($r['amount']) ? (float)$r['amount'] : 0.0;

        if ($action === 'buy') {
            $buys++;
            $turnover += abs($amount);
        } elseif ($action === 'sell') {
            $sells++;
            $turnover += abs($amount);
        }
    }

    $startBalance = null;
    $currentBalance = null;
    $firstTime = null;
    $lastTime = null;

    if ($oldest) {
        $oldAmount = isset($oldest['amount']) ? (float)$oldest['amount'] : 0.0;
        $oldBalance = isset($oldest['balance_after']) ? (float)$oldest['balance_after'] : null;
        $oldAction = strtolower(trim((string)($oldest['action_type'] ?? '')));

        if ($oldBalance !== null) {
            $startBalance = $oldAction === 'buy'
                ? round($oldBalance - $oldAmount, 2)
                : round($oldBalance, 2);
        }

        $firstTime = isset($oldest['transaction_time']) ? (int)$oldest['transaction_time'] : null;
    }

    if ($latest) {
        $currentBalance = isset($latest['balance_after']) ? round((float)$latest['balance_after'], 2) : null;
        $lastTime = isset($latest['transaction_time']) ? (int)$latest['transaction_time'] : null;
    }

    $netPL = 0.0;
    if ($startBalance !== null && $currentBalance !== null) {
        $netPL = round($currentBalance - $startBalance, 2);
    }

    json([
        'ok' => true,
        'summary' => [
            'username' => $username,
            'total_rows' => $totalRows,
            'buys' => $buys,
            'sells' => $sells,
            'trades' => $sells,
            'turnover' => round($turnover, 2),
            'start_balance' => $startBalance,
            'current_balance' => $currentBalance,
            'net_pl' => $netPL,
            'first_time' => $firstTime,
            'last_time' => $lastTime,
        ],
        'statements' => array_map(static function(array $r): array {
            return [
                'id' => isset($r['id']) ? (int)$r['id'] : null,
                'username' => $r['username'] ?? null,
                'transaction_time' => isset($r['transaction_time']) ? (int)$r['transaction_time'] : null,
                'action_type' => $r['action_type'] ?? null,
                'reference_id' => $r['reference_id'] ?? null,
                'reference_type' => $r['reference_type'] ?? null,
                'amount' => isset($r['amount']) ? (float)$r['amount'] : null,
                'balance_after' => isset($r['balance_after']) ? (float)$r['balance_after'] : null,
            ];
        }, $rows),
    ]);

} catch (Throwable $e) {
    error_log($e->getMessage());
    fail($e->getMessage(), 400);
}
