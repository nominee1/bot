<?php
declare(strict_types=1);

require_once __DIR__ . '/util.php';

cors();
header('Content-Type: application/json');

if (method() !== 'POST') {
    fail('Method not allowed', 405);
}

function derive_challenge_status(
    string $startTime,
    string $endTime,
    int $joinCutoffHours,
    string $manualStatus
): string {
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
    $pdo = pdo();
    $data = body_json();

    $challengeId = isset($data['challenge_id']) && is_numeric($data['challenge_id'])
        ? (int)$data['challenge_id']
        : 0;

    $username = trim((string)($data['username'] ?? ''));

    $balanceChecked = isset($data['balance_checked']) && is_numeric($data['balance_checked'])
        ? (float)$data['balance_checked']
        : null;

    $currency = strtoupper(trim((string)($data['currency'] ?? '')));
    $isVirtual = isset($data['is_virtual']) ? (int)$data['is_virtual'] : 1;

    if ($challengeId <= 0) {
        fail('Valid challenge_id required', 422);
    }

    if ($username === '') {
        fail('username required', 422);
    }

    if ($balanceChecked === null) {
        fail('balance_checked required', 422);
    }

    if ($currency === '') {
        fail('currency required', 422);
    }

    if ($isVirtual === 1) {
        fail('Only real accounts can join challenges', 400);
    }

    if ($currency !== 'USD') {
        fail('Only USD accounts are allowed', 400);
    }

    $challengeStmt = $pdo->prepare("
        SELECT *
        FROM challenges
        WHERE id = :id
        LIMIT 1
    ");
    $challengeStmt->execute([
        ':id' => $challengeId,
    ]);

    $challenge = $challengeStmt->fetch(PDO::FETCH_ASSOC);

    if (!$challenge) {
        fail('Challenge not found', 404);
    }

    $challengeType = (string)($challenge['challenge_type'] ?? 'free');

    if ($challengeType === 'paid') {
        fail('Paid challenges must use payment confirmation before joining.', 400);
    }

    $manualStatus = (string)($challenge['manual_status'] ?? $challenge['status'] ?? '');

    $challengeStatus = derive_challenge_status(
        (string)$challenge['start_time'],
        (string)$challenge['end_time'],
        (int)$challenge['join_cutoff_hours_before_end'],
        $manualStatus
    );

    if (!in_array($challengeStatus, ['upcoming', 'live_open'], true)) {
        fail('Joining is closed for this challenge', 400);
    }

    /*
     * If your registered challenge traders are stored in traders_competition_2,
     * change FROM traders to FROM traders_competition_2.
     */
    $traderStmt = $pdo->prepare("
        SELECT id, username, email
        FROM traders_competition_2
        WHERE username = :username
        LIMIT 1
    ");
    $traderStmt->execute([
        ':username' => $username,
    ]);

    $trader = $traderStmt->fetch(PDO::FETCH_ASSOC);

    if (!$trader) {
        fail('Trader not found. Please register first.', 404);
    }

    $traderId = (int)$trader['id'];
    $storedUsername = (string)$trader['username'];

    $checkJoinedStmt = $pdo->prepare("
        SELECT id
        FROM challenge_participants
        WHERE challenge_id = :challenge_id
          AND trader_id = :trader_id
          AND join_status = 'joined'
        LIMIT 1
    ");
    $checkJoinedStmt->execute([
        ':challenge_id' => $challengeId,
        ':trader_id' => $traderId,
    ]);

    if ($checkJoinedStmt->fetch(PDO::FETCH_ASSOC)) {
        fail('Trader already joined this challenge', 409);
    }

    $entryFee = 0.00;
    $minimumBalance = (float)$challenge['minimum_balance'];
    $totalRequired = $minimumBalance;

    if ($balanceChecked < $totalRequired) {
        fail(
            'Not enough funds to join challenge. Required: ' .
            number_format($totalRequired, 2, '.', '') .
            ' USD',
            400
        );
    }

    $pdo->beginTransaction();

    $insertParticipant = $pdo->prepare("
        INSERT INTO challenge_participants (
            challenge_id,
            trader_id,
            username,
            join_status,
            entry_fee_paid,
            minimum_balance_required,
            total_required,
            balance_checked,
            joined_at,
            updated_at
        ) VALUES (
            :challenge_id,
            :trader_id,
            :username,
            'joined',
            :entry_fee_paid,
            :minimum_balance_required,
            :total_required,
            :balance_checked,
            NOW(),
            NOW()
        )
    ");

    $insertParticipant->execute([
        ':challenge_id' => $challengeId,
        ':trader_id' => $traderId,
        ':username' => $storedUsername,
        ':entry_fee_paid' => number_format($entryFee, 2, '.', ''),
        ':minimum_balance_required' => number_format($minimumBalance, 2, '.', ''),
        ':total_required' => number_format($totalRequired, 2, '.', ''),
        ':balance_checked' => number_format($balanceChecked, 2, '.', ''),
    ]);

    $updateChallenge = $pdo->prepare("
        UPDATE challenges
        SET
            participant_count = (
                SELECT COUNT(*)
                FROM challenge_participants cp
                WHERE cp.challenge_id = :challenge_id_count
                  AND cp.join_status = 'joined'
            ),
            prize_pool = (
                SELECT COALESCE(SUM(cp.entry_fee_paid), 0.00)
                FROM challenge_participants cp
                WHERE cp.challenge_id = :challenge_id_pool
                  AND cp.join_status = 'joined'
            )
        WHERE id = :challenge_id_update
    ");

    $updateChallenge->execute([
        ':challenge_id_count' => $challengeId,
        ':challenge_id_pool' => $challengeId,
        ':challenge_id_update' => $challengeId,
    ]);

    $pdo->commit();

    echo json_encode([
        'ok' => true,
        'participant' => [
            'challenge_id' => $challengeId,
            'trader_id' => $traderId,
            'username' => $storedUsername,
            'entry_fee_paid' => 0.00,
            'minimum_balance_required' => round($minimumBalance, 2),
            'total_required' => round($totalRequired, 2),
            'balance_checked' => round($balanceChecked, 2),
            'challenge_status' => $challengeStatus,
            'currency' => $currency,
        ],
    ], JSON_UNESCAPED_SLASHES);

} catch (Throwable $e) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }

    fail($e->getMessage(), 500);
}