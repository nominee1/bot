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

    $challengeId = isset($_GET['challenge_id']) && is_numeric($_GET['challenge_id']) ? (int)$_GET['challenge_id'] : 0;
    if ($challengeId <= 0) fail('Valid challenge_id required');

    $challengeStmt = $pdo->prepare("
        SELECT *
        FROM challenges
        WHERE id = :id
        LIMIT 1
    ");
    $challengeStmt->execute([':id' => $challengeId]);
    $challenge = $challengeStmt->fetch(PDO::FETCH_ASSOC);

    if (!$challenge) fail('Challenge not found', 404);

    $status = derive_challenge_status(
        $challenge['start_time'],
        $challenge['end_time'],
        (int)$challenge['join_cutoff_hours_before_end'],
        $challenge['manual_status']
    );

    // Join competition trader table — INNER JOIN traders omitted paid rows whose trader_id is not in `traders`.
    $tradersTable = CHALLENGE_TRADERS_TABLE;
    $stmt = $pdo->prepare("
        SELECT
            cp.id,
            cp.challenge_id,
            cp.trader_id,
            cp.username,
            cp.join_status,
            cp.entry_fee_paid,
            cp.minimum_balance_required,
            cp.total_required,
            cp.balance_checked,
            cp.joined_at,
            cp.updated_at,
            t.email
        FROM challenge_participants cp
        INNER JOIN `{$tradersTable}` t ON t.id = cp.trader_id
        WHERE cp.challenge_id = :challenge_id
        ORDER BY cp.joined_at ASC, cp.id ASC
    ");
    $stmt->execute([':challenge_id' => $challengeId]);

    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $participants = array_map(static function(array $row): array {
        return [
            'id' => (int)$row['id'],
            'challenge_id' => (int)$row['challenge_id'],
            'trader_id' => (int)$row['trader_id'],
            'username' => $row['username'],
            'email' => $row['email'],
            'join_status' => $row['join_status'],
            'entry_fee_paid' => (float)$row['entry_fee_paid'],
            'minimum_balance_required' => (float)$row['minimum_balance_required'],
            'total_required' => (float)$row['total_required'],
            'balance_checked' => $row['balance_checked'] !== null ? (float)$row['balance_checked'] : null,
            'joined_at' => (new DateTimeImmutable($row['joined_at'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM),
            'updated_at' => (new DateTimeImmutable($row['updated_at'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM),
        ];
    }, $rows);

    echo json_encode([
        'ok' => true,
        'challenge' => [
            'id' => (int)$challenge['id'],
            'name' => $challenge['name'],
            'created_by_username' => $challenge['created_by_username'],
            'challenge_type' => $challenge['challenge_type'],
            'entry_fee' => (float)$challenge['entry_fee'],
            'minimum_balance' => (float)$challenge['minimum_balance'],
            'participant_count' => (int)$challenge['participant_count'],
            'prize_pool' => (float)$challenge['prize_pool'],
            'start_time' => (new DateTimeImmutable($challenge['start_time'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM),
            'end_time' => (new DateTimeImmutable($challenge['end_time'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM),
            'join_cutoff_hours_before_end' => (int)$challenge['join_cutoff_hours_before_end'],
            'status' => $status,
            'payout_status' => $challenge['payout_status'] ?? 'not_applicable',
            'payout_status_display' => denara_challenge_payout_display_status(
                (string) $challenge['challenge_type'],
                $status,
                (string) ($challenge['payout_status'] ?? 'not_applicable')
            ),
        ],
        'participants' => $participants,
        'count' => count($participants),
    ], JSON_UNESCAPED_SLASHES);

} catch (Throwable $e) {
    fail($e->getMessage(), 500);
}