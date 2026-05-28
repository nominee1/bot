<?php
declare(strict_types=1);

/**
 * Set ranked winner for a paid challenge (call from statement ranking job or admin).
 * POST JSON: { "challenge_id": 123, "winner_trader_id": 45, "winner_return_pct": 12.34 }
 * Header: X-Challenge-Admin-Key must match env CHALLENGE_ADMIN_SET_WINNER_KEY (non-empty).
 */

require_once __DIR__ . '/util.php';

cors();
header('Content-Type: application/json; charset=utf-8');

if (method() !== 'POST') {
    fail('Method not allowed', 405);
}

function derive_challenge_status(string $startTime, string $endTime, int $joinCutoffHours, string $manualStatus): string {
    if ($manualStatus === 'cancelled') {
        return 'cancelled';
    }

    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $start = new DateTimeImmutable($startTime, new DateTimeZone('UTC'));
    $end = new DateTimeImmutable($endTime, new DateTimeZone('UTC'));

    if ($now >= $end) {
        return 'ended';
    }

    if ($now < $start) {
        return 'upcoming';
    }

    if ($joinCutoffHours > 0) {
        $joinClosesAt = $end->modify("-{$joinCutoffHours} hours");
        if ($now >= $joinClosesAt) {
            return 'live_locked';
        }
    }

    return 'live_open';
}

try {
    $expected = getenv('CHALLENGE_ADMIN_SET_WINNER_KEY');
    $expected = is_string($expected) ? trim($expected) : '';
    if ($expected === '') {
        fail('Server is not configured for winner updates (CHALLENGE_ADMIN_SET_WINNER_KEY).', 503);
    }

    $hdr = $_SERVER['HTTP_X_CHALLENGE_ADMIN_KEY'] ?? '';
    if (!is_string($hdr) || !hash_equals($expected, $hdr)) {
        fail('Unauthorized', 401);
    }

    $in = body_json();
    $challengeId = isset($in['challenge_id']) && is_numeric($in['challenge_id']) ? (int)$in['challenge_id'] : 0;
    $winnerTraderId = isset($in['winner_trader_id']) && is_numeric($in['winner_trader_id']) ? (int)$in['winner_trader_id'] : 0;
    $returnPct = isset($in['winner_return_pct']) && is_numeric($in['winner_return_pct']) ? (float)$in['winner_return_pct'] : null;

    if ($challengeId <= 0 || $winnerTraderId <= 0) {
        fail('challenge_id and winner_trader_id required', 422);
    }

    $pdo = pdo();
    $stmt = $pdo->prepare('SELECT * FROM challenges WHERE id = ? LIMIT 1');
    $stmt->execute([$challengeId]);
    $ch = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$ch) {
        fail('Challenge not found', 404);
    }

    if ((string)($ch['challenge_type'] ?? '') !== 'paid') {
        fail('Only paid challenges use ranked winner payout.', 422);
    }

    $status = derive_challenge_status(
        (string)$ch['start_time'],
        (string)$ch['end_time'],
        (int)$ch['join_cutoff_hours_before_end'],
        (string)($ch['manual_status'] ?? '')
    );

    if ($status !== 'ended') {
        fail('Challenge must be ended before setting winner.', 422);
    }

    $tbl = defined('CHALLENGE_TRADERS_TABLE') ? CHALLENGE_TRADERS_TABLE : 'traders_competition_2';
    $tstmt = $pdo->prepare("SELECT id, username FROM `{$tbl}` WHERE id = ? LIMIT 1");
    $tstmt->execute([$winnerTraderId]);
    $tr = $tstmt->fetch(PDO::FETCH_ASSOC);

    if (!$tr) {
        fail('winner_trader_id not found in traders table.', 404);
    }

    $pstmt = $pdo->prepare('
        SELECT id FROM challenge_participants
        WHERE challenge_id = ? AND trader_id = ? AND join_status = \'joined\'
        LIMIT 1
    ');
    $pstmt->execute([$challengeId, $winnerTraderId]);

    if (!$pstmt->fetch(PDO::FETCH_ASSOC)) {
        fail('Winner is not a joined participant in this challenge.', 422);
    }

    $upd = $pdo->prepare('
        UPDATE challenges
        SET winner_trader_id = ?,
            winner_username = ?,
            winner_return_pct = ?,
            updated_at = UTC_TIMESTAMP()
        WHERE id = ?
          AND payout_status = \'pending\'
    ');
    $upd->execute([
        $winnerTraderId,
        (string)$tr['username'],
        $returnPct !== null ? number_format($returnPct, 4, '.', '') : null,
        $challengeId,
    ]);

    if ($upd->rowCount() === 0) {
        fail('Challenge not updated (wrong state or already paid?).', 409);
    }

    require_once __DIR__ . '/challenge_payout_lib.php';
    denara_finalize_challenge_payouts($pdo);

    echo json_encode([
        'ok' => true,
        'challenge_id' => $challengeId,
        'winner_trader_id' => $winnerTraderId,
        'winner_username' => (string)$tr['username'],
    ], JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
    fail($e->getMessage(), 500);
}
