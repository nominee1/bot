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

    $username = trim((string)($_GET['username'] ?? ''));
    if ($username === '') fail('username required');

    $stmt = $pdo->prepare("
        SELECT
            cp.id AS participant_id,
            cp.challenge_id,
            cp.trader_id,
            cp.username,
            cp.join_status,
            cp.entry_fee_paid,
            cp.minimum_balance_required,
            cp.total_required,
            cp.balance_checked,
            cp.joined_at,
            c.name,
            c.created_by_username,
            c.challenge_type,
            c.entry_fee,
            c.minimum_balance,
            c.participant_count,
            c.prize_pool,
            c.start_time,
            c.end_time,
            c.join_cutoff_hours_before_end,
            c.manual_status
        FROM challenge_participants cp
        INNER JOIN challenges c ON c.id = cp.challenge_id
        WHERE cp.username = :username
        ORDER BY cp.joined_at DESC
    ");
    $stmt->execute([':username' => $username]);

    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $results = [];
    foreach ($rows as $row) {
        $results[] = [
            'participant_id' => (int)$row['participant_id'],
            'challenge_id' => (int)$row['challenge_id'],
            'trader_id' => (int)$row['trader_id'],
            'username' => $row['username'],
            'join_status' => $row['join_status'],
            'entry_fee_paid' => (float)$row['entry_fee_paid'],
            'minimum_balance_required' => (float)$row['minimum_balance_required'],
            'total_required' => (float)$row['total_required'],
            'balance_checked' => $row['balance_checked'] !== null ? (float)$row['balance_checked'] : null,
            'joined_at' => (new DateTimeImmutable($row['joined_at'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM),

            'challenge' => [
                'id' => (int)$row['challenge_id'],
                'name' => $row['name'],
                'created_by_username' => $row['created_by_username'],
                'challenge_type' => $row['challenge_type'],
                'entry_fee' => (float)$row['entry_fee'],
                'minimum_balance' => (float)$row['minimum_balance'],
                'participant_count' => (int)$row['participant_count'],
                'prize_pool' => (float)$row['prize_pool'],
                'start_time' => (new DateTimeImmutable($row['start_time'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM),
                'end_time' => (new DateTimeImmutable($row['end_time'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM),
                'join_cutoff_hours_before_end' => (int)$row['join_cutoff_hours_before_end'],
                'status' => derive_challenge_status(
                    $row['start_time'],
                    $row['end_time'],
                    (int)$row['join_cutoff_hours_before_end'],
                    $row['manual_status']
                ),
            ],
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