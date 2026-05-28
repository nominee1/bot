<?php
declare(strict_types=1);

require_once __DIR__ . '/util.php';
require_once __DIR__ . '/challenge_display_lib.php';

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

    require_once __DIR__ . '/challenge_ranking_lib.php';
    denara_finalize_challenge_rankings($pdo);

    require_once __DIR__ . '/challenge_payout_lib.php';
    denara_finalize_challenge_payouts($pdo);

    $id = isset($_GET['id']) && is_numeric($_GET['id']) ? (int)$_GET['id'] : 0;
    if ($id <= 0) fail('Valid challenge id required');

    $stmt = $pdo->prepare("
        SELECT *
        FROM challenges
        WHERE id = :id
        LIMIT 1
    ");
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) fail('Challenge not found', 404);

    $status = derive_challenge_status(
        $row['start_time'],
        $row['end_time'],
        (int)$row['join_cutoff_hours_before_end'],
        $row['manual_status']
    );

    $rankingPayload = null;
    if (!empty($row['ranking_json'])) {
        $decoded = json_decode((string) $row['ranking_json'], true);
        $rankingPayload = is_array($decoded) ? $decoded : null;
    }

    echo json_encode([
        'ok' => true,
        'challenge' => [
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
            'ranking_status' => $row['ranking_status'] ?? null,
            'ranking_computed_at' => isset($row['ranking_computed_at']) && $row['ranking_computed_at']
                ? (new DateTimeImmutable($row['ranking_computed_at'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM)
                : null,
            'ranking_last_error' => $row['ranking_last_error'] ?? null,
            'ranking' => $rankingPayload,
            'payout_status' => $row['payout_status'],
            'payout_status_display' => denara_challenge_payout_display_status(
                (string) $row['challenge_type'],
                $status,
                (string) $row['payout_status']
            ),
            'payout_deriv_txid' => $row['payout_deriv_txid'] ?? null,
            'payout_paid_at' => isset($row['payout_paid_at']) && $row['payout_paid_at']
                ? (new DateTimeImmutable($row['payout_paid_at'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM)
                : null,
            'payout_last_error' => $row['payout_last_error'] ?? null,
            'status' => $status,
            'created_at' => (new DateTimeImmutable($row['created_at'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM),
            'updated_at' => (new DateTimeImmutable($row['updated_at'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM),
        ],
    ], JSON_UNESCAPED_SLASHES);

} catch (Throwable $e) {
    fail($e->getMessage(), 500);
}