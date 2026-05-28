<?php
declare(strict_types=1);

require_once __DIR__ . '/util.php';
require_once __DIR__ . '/DerivClient.php';

cors();
header('Content-Type: application/json');

if (method() !== 'POST') {
    fail('Method not allowed', 405);
}

const DERIV_APP_ID = 87874;

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

function get_trader_row(PDO $pdo, string $username): array {
    $stmt = $pdo->prepare("
        SELECT id, username, email, token
        FROM traders
        WHERE username = ?
        LIMIT 1
    ");
    $stmt->execute([$username]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        throw new RuntimeException('Trader not found. Please register first.');
    }

    $tok = trim((string)($row['token'] ?? ''));
    if ($tok === '') {
        throw new RuntimeException('Trader token missing.');
    }

    if (function_exists('token_lazy_upgrade')) {
        $row['token'] = token_lazy_upgrade($pdo, 'traders', 'id', (int)$row['id'], $tok);
    } else {
        $row['token'] = $tok;
    }

    return $row;
}

function get_challenge_row(PDO $pdo, int $challengeId): array {
    $stmt = $pdo->prepare("
        SELECT *
        FROM challenges
        WHERE id = ?
        LIMIT 1
    ");
    $stmt->execute([$challengeId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        throw new RuntimeException('Challenge not found.');
    }

    return $row;
}

function ensure_not_already_joined(PDO $pdo, int $challengeId, int $traderId): void {
    $stmt = $pdo->prepare("
        SELECT id
        FROM challenge_participants
        WHERE challenge_id = ?
          AND trader_id = ?
        LIMIT 1
    ");
    $stmt->execute([$challengeId, $traderId]);

    if ($stmt->fetch(PDO::FETCH_ASSOC)) {
        throw new RuntimeException('Trader already joined this challenge.');
    }
}

function get_existing_paid_join_payment(PDO $pdo, int $challengeId, int $traderId): ?array {
    $stmt = $pdo->prepare("
        SELECT *
        FROM challenge_join_payments
        WHERE challenge_id = ?
          AND trader_id = ?
          AND status = 'paid'
        ORDER BY id DESC
        LIMIT 1
    ");
    $stmt->execute([$challengeId, $traderId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    return $row ?: null;
}

function get_or_create_pending_join_payment(
    PDO $pdo,
    int $challengeId,
    int $traderId,
    string $username,
    float $amount,
    string $currency
): array {
    $select = $pdo->prepare("
        SELECT *
        FROM challenge_join_payments
        WHERE challenge_id = ?
          AND trader_id = ?
          AND status = 'pending'
        ORDER BY id DESC
        LIMIT 1
    ");
    $select->execute([$challengeId, $traderId]);
    $existing = $select->fetch(PDO::FETCH_ASSOC);

    if ($existing) {
        return $existing;
    }

    $insert = $pdo->prepare("
        INSERT INTO challenge_join_payments (
            challenge_id,
            trader_id,
            username,
            amount,
            currency,
            status,
            otp_required
        ) VALUES (?, ?, ?, ?, ?, 'pending', 1)
    ");
    $insert->execute([
        $challengeId,
        $traderId,
        $username,
        number_format($amount, 2, '.', ''),
        $currency,
    ]);

    $id = (int)$pdo->lastInsertId();

    $get = $pdo->prepare("
        SELECT *
        FROM challenge_join_payments
        WHERE id = ?
        LIMIT 1
    ");
    $get->execute([$id]);

    $row = $get->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        throw new RuntimeException('Failed to create pending join payment.');
    }

    return $row;
}

function extract_balance_and_currency(array $balanceResponse): array {
    $simpleBalance = $balanceResponse['balance']['balance'] ?? null;
    $simpleCurrency = $balanceResponse['balance']['currency'] ?? null;

    if (is_numeric($simpleBalance) && is_string($simpleCurrency) && $simpleCurrency !== '') {
        return [(float)$simpleBalance, strtoupper($simpleCurrency)];
    }

    $accounts = $balanceResponse['balance']['accounts'] ?? null;
    if (is_array($accounts) && !empty($accounts)) {
        $current = null;
        foreach ($accounts as $acc) {
            if (!empty($acc['is_virtual'])) continue;
            if (!empty($acc['is_default'])) {
                $current = $acc;
                break;
            }
            if ($current === null) $current = $acc;
        }

        if ($current && isset($current['balance'], $current['currency'])) {
            return [(float)$current['balance'], strtoupper((string)$current['currency'])];
        }
    }

    throw new RuntimeException('Could not read trader balance.');
}

try {
    $pdo = pdo();
    $data = body_json();

    $challengeId = isset($data['challenge_id']) && is_numeric($data['challenge_id']) ? (int)$data['challenge_id'] : 0;
    $username = trim((string)($data['username'] ?? ''));

    if ($challengeId <= 0) fail('Valid challenge_id required');
    if ($username === '') fail('username required');

    $trader = get_trader_row($pdo, $username);
    $challenge = get_challenge_row($pdo, $challengeId);

    if (($challenge['challenge_type'] ?? '') !== 'paid') {
        fail('This challenge is not a paid challenge.');
    }

    $status = derive_challenge_status(
        (string)$challenge['start_time'],
        (string)$challenge['end_time'],
        (int)$challenge['join_cutoff_hours_before_end'],
        (string)$challenge['manual_status']
    );

    if (!in_array($status, ['upcoming', 'live_open'], true)) {
        fail('Joining is closed for this challenge.');
    }

    ensure_not_already_joined($pdo, $challengeId, (int)$trader['id']);

    $alreadyPaid = get_existing_paid_join_payment($pdo, $challengeId, (int)$trader['id']);
    if ($alreadyPaid) {
        fail('Join payment for this challenge was already completed.');
    }

    $ws = new \Denara\DerivClient(DERIV_APP_ID);
    $auth = null;
    $balanceRes = null;

    try {
        $auth = $ws->authorize((string)$trader['token']);
        $emailFromAuth = (string)($auth['authorize']['email'] ?? '');
        $loginid = (string)($auth['authorize']['loginid'] ?? '');
        $isVirtual = (int)($auth['authorize']['is_virtual'] ?? 1);

        if ($emailFromAuth === '') {
            throw new RuntimeException('Could not read trader email from Deriv authorization.');
        }

        if ($isVirtual === 1 || preg_match('/^VRTC/i', $loginid)) {
            throw new RuntimeException('Only real accounts can join paid challenges.');
        }

        $balanceRes = $ws->balance(['account' => 'current']);
        [$balance, $currency] = extract_balance_and_currency($balanceRes);

        if ($currency !== 'USD') {
            throw new RuntimeException('Only USD accounts are allowed for paid challenges.');
        }

        $entryFee = (float)$challenge['entry_fee'];
        $minimumBalance = (float)$challenge['minimum_balance'];
        $totalRequired = $entryFee + $minimumBalance;

        if ($balance < $minimumBalance) {
            throw new RuntimeException('Trader balance is below the minimum balance required for this challenge.');
        }

        if ($balance < $totalRequired) {
            throw new RuntimeException(
                'Insufficient balance. Required total is ' . number_format($totalRequired, 2, '.', '') . ' USD.'
            );
        }

        $payment = get_or_create_pending_join_payment(
            $pdo,
            $challengeId,
            (int)$trader['id'],
            (string)$trader['username'],
            $entryFee,
            'USD'
        );

        $otp = $ws->verifyEmail($emailFromAuth, 'paymentagent_withdraw');

    } finally {
        $ws->close();
    }

    echo json_encode([
        'ok' => true,
        'join_payment' => [
            'id' => (int)$payment['id'],
            'challenge_id' => (int)$payment['challenge_id'],
            'trader_id' => (int)$payment['trader_id'],
            'username' => $payment['username'],
            'amount' => (float)$payment['amount'],
            'currency' => $payment['currency'],
            'status' => $payment['status'],
            'otp_required' => (int)$payment['otp_required'],
        ],
        'otp' => [
            'sent' => true,
            'to' => (string)($auth['authorize']['email'] ?? ''),
        ],
        'account' => [
            'loginid' => (string)($auth['authorize']['loginid'] ?? ''),
            'balance' => $balance,
            'currency' => $currency,
        ],
        'challenge' => [
            'id' => (int)$challenge['id'],
            'name' => $challenge['name'],
            'entry_fee' => (float)$challenge['entry_fee'],
            'minimum_balance' => (float)$challenge['minimum_balance'],
            'status' => $status,
        ],
        'next_step' => 'Ask user for the verification code and call confirm_join_challenge_payment.php',
    ], JSON_UNESCAPED_SLASHES);

} catch (Throwable $e) {
    fail($e->getMessage(), 500);
}