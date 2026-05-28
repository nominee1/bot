<?php
declare(strict_types=1);

require_once __DIR__ . '/util.php';

cors();
header('Content-Type: application/json');

if (method() !== 'GET') {
    fail('Method not allowed', 405);
}

function derive_challenge_status(string $startTime, string $endTime, int $joinCutoffHours, string $manualStatus): string {
    if ($manualStatus === 'cancelled') return 'cancelled';

    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $start = new DateTimeImmutable($startTime, new DateTimeZone('UTC'));
    $end = new DateTimeImmutable($endTime, new DateTimeZone('UTC'));
    $joinClosesAt = $end->modify("-{$joinCutoffHours} hours");

    if ($now >= $end) return 'ended';
    if ($now < $start) return 'upcoming';
    if ($now >= $joinClosesAt) return 'live_locked';
    return 'live_open';
}

try {
    $pdo = pdo();

    require_once __DIR__ . '/challenge_payout_lib.php';
    denara_finalize_challenge_payouts($pdo);

    $statusFilter = trim((string)($_GET['status'] ?? ''));
    $limit = isset($_GET['limit']) && is_numeric($_GET['limit']) ? max(1, min(200, (int)$_GET['limit'])) : 50;

    $stmt = $pdo->prepare("
        SELECT
            id,
            name,
            created_by_trader_id,
            created_by_username,
            challenge_type,
            entry_fee,
            minimum_balance,
            start_time,
            end_time,
            join_cutoff_hours_before_end,
            participant_count,
            prize_pool,
            winner_trader_id,
            winner_username,
            winner_return_pct,
            payout_status,
            payout_deriv_txid,
            payout_paid_at,
            payout_last_error,
            manual_status,
            created_at,
            updated_at
        FROM challenges
        ORDER BY start_time DESC
        LIMIT :lim
    ");
    $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
    $stmt->execute();

    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $results = [];
    foreach ($rows as $row) {
        $status = derive_challenge_status(
            $row['start_time'],
            $row['end_time'],
            (int)$row['join_cutoff_hours_before_end'],
            $row['manual_status']
        );

        if ($statusFilter !== '') {
            if ($statusFilter === 'live') {
                if (!in_array($status, ['live_open', 'live_locked', 'upcoming'], true)) continue;
            } elseif ($status !== $statusFilter) {
                continue;
            }
        }

        $results[] = [
            'id' => (int)$row['id'],
            'name' => $row['name'],
            'created_by_trader_id' => (int)$row['created_by_trader_id'],
            'created_by_username' => $row['created_by_username'],
            'challenge_type' => $row['challenge_type'],
            'entry_fee' => (float)$row['entry_fee'],
            'minimum_balance' => (float)$row['minimum_balance'],
            'start_time' => (new DateTimeImmutable($row['start_time'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM),
            'end_time' => (new DateTimeImmutable($row['end_time'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM),
            'join_cutoff_hours_before_end' => (int)$row['join_cutoff_hours_before_end'],
            'participant_count' => (int)$row['participant_count'],
            'prize_pool' => (float)$row['prize_pool'],
            'winner_trader_id' => $row['winner_trader_id'] !== null ? (int)$row['winner_trader_id'] : null,
            'winner_username' => $row['winner_username'],
            'winner_return_pct' => $row['winner_return_pct'] !== null ? (float)$row['winner_return_pct'] : null,
            'payout_status' => $row['payout_status'],
            'payout_deriv_txid' => $row['payout_deriv_txid'] ?? null,
            'payout_paid_at' => isset($row['payout_paid_at']) && $row['payout_paid_at']
                ? (new DateTimeImmutable($row['payout_paid_at'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM)
                : null,
            'payout_last_error' => $row['payout_last_error'] ?? null,
            'status' => $status,
            'created_at' => (new DateTimeImmutable($row['created_at'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM),
            'updated_at' => (new DateTimeImmutable($row['updated_at'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM),
        ];
    }

    echo json_encode([
        'ok' => true,
        'results' => $results,
        'count' => count($results),
    ], JSON_UNESCAPED_SLASHES);

} catch (Throwable $e) {
    fail($e->getMessage(), 500);
}