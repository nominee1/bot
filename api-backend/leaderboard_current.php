<?php
declare(strict_types=1);

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

require_once __DIR__ . '/util.php';

try {
    $pdo = pdo();

    $stmt = $pdo->query("
        SELECT
            username,
            rank_position,
            start_balance,
            end_balance,
            net_pl,
            return_pct,
            trades,
            turnover,
            baseline_time,
            is_rank_eligible,
            reason,
            updated_at
        FROM leaderboard_current
        ORDER BY
            CASE WHEN rank_position IS NULL THEN 1 ELSE 0 END,
            rank_position ASC,
            username ASC
    ");

    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'ok' => true,
        'results' => $rows,
        'count' => count($rows),
        'updated_at' => $rows[0]['updated_at'] ?? null,
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage(),
    ]);
}