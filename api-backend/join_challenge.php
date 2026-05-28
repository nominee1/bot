<?php
declare(strict_types=1);

require_once __DIR__ . '/util.php';

cors();
header('Content-Type: application/json');

if (method() !== 'POST') {
    fail('Method not allowed', 405);
}

const DERIV_APP_ID = 36300;

function getDerivWsUrl(int $appId): string {
    return "wss://ws.derivws.com/websockets/v3?app_id={$appId}";
}

function derivAuthorize(string $token, int $appId, int $timeoutMs = 12000): array {
    $url = getDerivWsUrl($appId);

    $ws = new WebSocket\Client($url, ['timeout' => $timeoutMs / 1000]);
    $ws->send(json_encode(['authorize' => $token]));

    $start = microtime(true);
    while ((microtime(true) - $start) * 1000 < $timeoutMs) {
        $msg = json_decode($ws->receive(), true);
        if (!$msg) continue;
        if (!empty($msg['error'])) {
            throw new RuntimeException($msg['error']['message'] ?? 'Authorize failed');
        }
        if (($msg['msg_type'] ?? '') === 'authorize' && !empty($msg['authorize'])) {
            return $msg['authorize'];
        }
    }

    throw new RuntimeException('Deriv authorize timed out');
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
    $data = body_json();

    $challengeId = isset($data['challenge_id']) && is_numeric($data['challenge_id']) ? (int)$data['challenge_id'] : 0;
    $username = trim((string)($data['username'] ?? ''));

    if ($challengeId <= 0) fail('Valid challenge_id required');
    if ($username === '') fail('username required');

    $challengeStmt = $pdo->prepare("
        SELECT *
        FROM challenges
        WHERE id = :id
        LIMIT 1
    ");
    $challengeStmt->execute([':id' => $challengeId]);
    $challenge = $challengeStmt->fetch(PDO::FETCH_ASSOC);

    if (!$challenge) fail('Challenge not found', 404);

    $challengeStatus = derive_challenge_status(
        $challenge['start_time'],
        $challenge['end_time'],
        (int)$challenge['join_cutoff_hours_before_end'],
        $challenge['manual_status']
    );

    if (!in_array($challengeStatus, ['upcoming', 'live_open'], true)) {
        fail('Joining is closed for this challenge');
    }

    $traderStmt = $pdo->prepare("
        SELECT id, username, token, email
        FROM traders_competition_2
        WHERE username = :username
        LIMIT 1
    ");
    $traderStmt->execute([':username' => $username]);
    $trader = $traderStmt->fetch(PDO::FETCH_ASSOC);

    if (!$trader) fail('Trader not found. Please register first.');

    $checkJoinedStmt = $pdo->prepare("
        SELECT id
        FROM challenge_participants
        WHERE challenge_id = :challenge_id
          AND trader_id = :trader_id
        LIMIT 1
    ");
    $checkJoinedStmt->execute([
        ':challenge_id' => $challengeId,
        ':trader_id' => (int)$trader['id'],
    ]);

    if ($checkJoinedStmt->fetch(PDO::FETCH_ASSOC)) {
        fail('Trader already joined this challenge');
    }

    if (empty($trader['token'])) {
        fail('Trader token missing');
    }

    // NOTE:
    // This requires a PHP websocket client library if you want live Deriv validation on the backend.
    // If you do not have one yet, you can temporarily replace this with your existing token validation path.
    $auth = derivAuthorize((string)$trader['token'], DERIV_APP_ID);

    $loginid = (string)($auth['loginid'] ?? '');
    $currency = strtoupper((string)($auth['currency'] ?? ''));
    $isVirtual = (int)($auth['is_virtual'] ?? 0);
    $balance = isset($auth['balance']) && is_numeric($auth['balance']) ? (float)$auth['balance'] : null;

    if ($isVirtual === 1 || preg_match('/^VRTC/i', $loginid)) {
        fail('Only real accounts can join challenges');
    }
    if ($currency !== 'USD') {
        fail('Only USD accounts are allowed');
    }
    if ($balance === null) {
        fail('Could not verify account balance');
    }

    $entryFee = (float)$challenge['entry_fee'];
    $minimumBalance = (float)$challenge['minimum_balance'];
    $totalRequired = $minimumBalance + ($challenge['challenge_type'] === 'paid' ? $entryFee : 0.0);

    if ($balance < $totalRequired) {
        fail("Not enough funds to join challenge. Required: " . number_format($totalRequired, 2, '.', '') . " USD");
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
            balance_checked
        ) VALUES (
            :challenge_id,
            :trader_id,
            :username,
            'joined',
            :entry_fee_paid,
            :minimum_balance_required,
            :total_required,
            :balance_checked
        )
    ");

    $insertParticipant->execute([
        ':challenge_id' => $challengeId,
        ':trader_id' => (int)$trader['id'],
        ':username' => $trader['username'],
        ':entry_fee_paid' => $challenge['challenge_type'] === 'paid' ? number_format($entryFee, 2, '.', '') : '0.00',
        ':minimum_balance_required' => number_format($minimumBalance, 2, '.', ''),
        ':total_required' => number_format($totalRequired, 2, '.', ''),
        ':balance_checked' => number_format($balance, 2, '.', ''),
    ]);

    $updateChallenge = $pdo->prepare("
        UPDATE challenges
        SET
            participant_count = (
                SELECT COUNT(*)
                FROM challenge_participants cp
                WHERE cp.challenge_id = :challenge_id
                  AND cp.join_status = 'joined'
            ),
            prize_pool = (
                SELECT COALESCE(SUM(cp.entry_fee_paid), 0.00)
                FROM challenge_participants cp
                WHERE cp.challenge_id = :challenge_id
                  AND cp.join_status = 'joined'
            )
        WHERE id = :challenge_id2
    ");
    $updateChallenge->execute([
        ':challenge_id' => $challengeId,
        ':challenge_id2' => $challengeId,
    ]);

    $pdo->commit();

    echo json_encode([
        'ok' => true,
        'participant' => [
            'challenge_id' => $challengeId,
            'trader_id' => (int)$trader['id'],
            'username' => $trader['username'],
            'entry_fee_paid' => $challenge['challenge_type'] === 'paid' ? round($entryFee, 2) : 0.0,
            'minimum_balance_required' => round($minimumBalance, 2),
            'total_required' => round($totalRequired, 2),
            'balance_checked' => round($balance, 2),
        ],
    ], JSON_UNESCAPED_SLASHES);

} catch (Throwable $e) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fail($e->getMessage(), 500);
}