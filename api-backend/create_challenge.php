<?php
declare(strict_types=1);

require_once __DIR__ . '/util.php';

cors();

header('Content-Type: application/json');

if (method() !== 'POST') {
    fail('Method not allowed', 405);
}

const MAX_CHALLENGE_HOURS = 72;
/** Minimum span from start_time to end_time (challenge length). */
const MIN_CHALLENGE_MINUTES = 30;
const MAX_CHALLENGES_PER_DAY = 10;

function parse_iso_datetime(string $value): DateTimeImmutable {
    try {
        return new DateTimeImmutable($value);
    } catch (Throwable $e) {
        fail('Invalid datetime format');
    }
}

function challenge_status_for(DateTimeImmutable $start, DateTimeImmutable $end, int $joinCutoffHours, string $manualStatus): string {
    if ($manualStatus === 'cancelled') return 'cancelled';

    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $joinClosesAt = $end->modify("-{$joinCutoffHours} hours");

    if ($now >= $end) return 'ended';
    if ($now < $start) return 'upcoming';
    if ($now >= $joinClosesAt) return 'live_locked';
    return 'live_open';
}

try {
    $pdo = pdo();
    $data = body_json();

    $createdByUsername = trim((string)($data['created_by_username'] ?? ''));
    $name = trim((string)($data['name'] ?? ''));
    $challengeType = trim((string)($data['challenge_type'] ?? 'free'));
    $entryFee = isset($data['entry_fee']) && is_numeric($data['entry_fee']) ? (float)$data['entry_fee'] : 0.0;
    $minimumBalance = isset($data['minimum_balance']) && is_numeric($data['minimum_balance']) ? (float)$data['minimum_balance'] : -1.0;
    $startTimeRaw = trim((string)($data['start_time'] ?? ''));
    $endTimeRaw = trim((string)($data['end_time'] ?? ''));
    $joinCutoffHours = isset($data['join_cutoff_hours_before_end']) && is_numeric($data['join_cutoff_hours_before_end'])
        ? (int)$data['join_cutoff_hours_before_end']
        : 0;

    if ($createdByUsername === '') fail('created_by_username required');
    if ($name === '') fail('Challenge name is required');
    if (mb_strlen($name) < 3) fail('Challenge name must be at least 3 characters');
    if (!in_array($challengeType, ['free', 'paid'], true)) fail('challenge_type must be free or paid');
    if ($minimumBalance <= 0) fail('minimum_balance must be above 0');
    if ($joinCutoffHours < 0) fail('join_cutoff_hours_before_end cannot be negative');

    if ($challengeType === 'paid' && $entryFee <= 0) {
        fail('Paid challenges must have an entry fee above 0');
    }

    if ($challengeType === 'free') {
        $entryFee = 0.0;
    }

    $startDt = parse_iso_datetime($startTimeRaw)->setTimezone(new DateTimeZone('UTC'));
    $endDt = parse_iso_datetime($endTimeRaw)->setTimezone(new DateTimeZone('UTC'));

    if ($endDt <= $startDt) {
        fail('End time must be later than start time');
    }

    $durationSeconds = $endDt->getTimestamp() - $startDt->getTimestamp();
    if ($durationSeconds < MIN_CHALLENGE_MINUTES * 60) {
        fail('Challenge duration must be at least ' . MIN_CHALLENGE_MINUTES . ' minutes');
    }
    if ($durationSeconds > MAX_CHALLENGE_HOURS * 3600) {
        fail('Challenge duration cannot exceed 3 days');
    }

    $joinClosesAt = $endDt->modify("-{$joinCutoffHours} hours");
    if ($joinClosesAt < $startDt) {
        fail('Join cutoff cannot close before the challenge starts');
    }

    // Limit to 10 created per UTC day
    $todayStart = (new DateTimeImmutable('now', new DateTimeZone('UTC')))->setTime(0, 0, 0);
    $todayEnd = $todayStart->modify('+1 day');

    $countStmt = $pdo->prepare("
        SELECT COUNT(*) 
        FROM challenges
        WHERE created_at >= :day_start
          AND created_at < :day_end
    ");
    $countStmt->execute([
        ':day_start' => $todayStart->format('Y-m-d H:i:s'),
        ':day_end' => $todayEnd->format('Y-m-d H:i:s'),
    ]);

    $createdToday = (int)$countStmt->fetchColumn();
    if ($createdToday >= MAX_CHALLENGES_PER_DAY) {
        fail('Daily challenge limit reached');
    }

    $tbl = defined('CHALLENGE_TRADERS_TABLE') ? CHALLENGE_TRADERS_TABLE : 'traders_competition_2';

    $traderStmt = $pdo->prepare("
        SELECT id, username
        FROM `{$tbl}`
        WHERE TRIM(LOWER(username)) = TRIM(LOWER(:username))
        LIMIT 1
    ");
    $traderStmt->execute([':username' => $createdByUsername]);
    $creator = $traderStmt->fetch(PDO::FETCH_ASSOC);

    if (!$creator) {
        fail('Creator must be a registered trader');
    }

    $insert = $pdo->prepare("
        INSERT INTO challenges (
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
            payout_status,
            manual_status
        ) VALUES (
            :name,
            :created_by_trader_id,
            :created_by_username,
            :challenge_type,
            :entry_fee,
            :minimum_balance,
            :start_time,
            :end_time,
            :join_cutoff_hours_before_end,
            0,
            0.00,
            :payout_status,
            'active'
        )
    ");

    $insert->execute([
        ':name' => $name,
        ':created_by_trader_id' => (int)$creator['id'],
        ':created_by_username' => $creator['username'],
        ':challenge_type' => $challengeType,
        ':entry_fee' => number_format($entryFee, 2, '.', ''),
        ':minimum_balance' => number_format($minimumBalance, 2, '.', ''),
        ':start_time' => $startDt->format('Y-m-d H:i:s'),
        ':end_time' => $endDt->format('Y-m-d H:i:s'),
        ':join_cutoff_hours_before_end' => $joinCutoffHours,
        ':payout_status' => $challengeType === 'paid' ? 'pending' : 'not_applicable',
    ]);

    $challengeId = (int)$pdo->lastInsertId();

    echo json_encode([
        'ok' => true,
        'challenge' => [
            'id' => $challengeId,
            'name' => $name,
            'created_by_username' => $creator['username'],
            'challenge_type' => $challengeType,
            'entry_fee' => round($entryFee, 2),
            'minimum_balance' => round($minimumBalance, 2),
            'start_time' => $startDt->format(DateTimeInterface::ATOM),
            'end_time' => $endDt->format(DateTimeInterface::ATOM),
            'join_cutoff_hours_before_end' => $joinCutoffHours,
            'status' => challenge_status_for($startDt, $endDt, $joinCutoffHours, 'active'),
        ],
    ], JSON_UNESCAPED_SLASHES);

} catch (Throwable $e) {
    fail($e->getMessage(), 500);
}