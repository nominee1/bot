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
const PAYMENT_AGENT_LOGINID = 'CR5373440';

function get_pending_join_payment(PDO $pdo, int $joinPaymentId): array {
    $stmt = $pdo->prepare("
        SELECT *
        FROM challenge_join_payments
        WHERE id = ?
        LIMIT 1
    ");
    $stmt->execute([$joinPaymentId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        throw new RuntimeException('Join payment not found.');
    }

    if (($row['status'] ?? '') !== 'pending') {
        throw new RuntimeException('Join payment is not pending.');
    }

    return $row;
}

function get_trader_by_id(PDO $pdo, int $traderId): array {
    $stmt = $pdo->prepare("
        SELECT id, username, email, token
        FROM traders_competition_2
        WHERE id = ?
        LIMIT 1
    ");
    $stmt->execute([$traderId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        throw new RuntimeException('Trader not found.');
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

function get_challenge_by_id(PDO $pdo, int $challengeId): array {
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

function audit_join_payment(PDO $pdo, int $joinPaymentId, array $payload, array $response = []): void {
    try {
        $stmt = $pdo->prepare("
            INSERT INTO payments_audit (invoice_id, payload, response)
            VALUES (?, ?, ?)
        ");
        $stmt->execute([
            $joinPaymentId,
            json_encode($payload, JSON_UNESCAPED_SLASHES),
            json_encode($response, JSON_UNESCAPED_SLASHES),
        ]);
    } catch (Throwable $e) {
        error_log('[challenge_join_payment_audit] ' . $e->getMessage());
    }
}

function mark_join_payment_paid(PDO $pdo, int $joinPaymentId, ?string $txid): void {
    $stmt = $pdo->prepare("
        UPDATE challenge_join_payments
        SET
            status = 'paid',
            deriv_txid = ?,
            paid_at = NOW()
        WHERE id = ?
          AND status = 'pending'
    ");
    $stmt->execute([$txid, $joinPaymentId]);

    if ($stmt->rowCount() === 0) {
        throw new RuntimeException('Join payment state not updated.');
    }
}

function insert_challenge_participant(PDO $pdo, array $joinPayment, array $challenge, array $trader): void {
    $minimumBalance = (float)$challenge['minimum_balance'];
    $entryFee = (float)$challenge['entry_fee'];
    $totalRequired = $minimumBalance + $entryFee;

    $stmt = $pdo->prepare("
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
            NULL
        )
    ");

    $stmt->execute([
        ':challenge_id' => (int)$challenge['id'],
        ':trader_id' => (int)$trader['id'],
        ':username' => (string)$trader['username'],
        ':entry_fee_paid' => number_format((float)$joinPayment['amount'], 2, '.', ''),
        ':minimum_balance_required' => number_format($minimumBalance, 2, '.', ''),
        ':total_required' => number_format($totalRequired, 2, '.', ''),
    ]);
}

function refresh_challenge_totals(PDO $pdo, int $challengeId): void {
    $stmt = $pdo->prepare("
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
    $stmt->execute([
        ':challenge_id' => $challengeId,
        ':challenge_id2' => $challengeId,
    ]);
}

try {
    $pdo = pdo();
    $data = body_json();

    $joinPaymentId = isset($data['join_payment_id']) && is_numeric($data['join_payment_id']) ? (int)$data['join_payment_id'] : 0;
    $verificationCode = trim((string)($data['verification_code'] ?? ''));

    if ($joinPaymentId <= 0) fail('Valid join_payment_id required');
    if ($verificationCode === '') fail('verification_code required');

    $joinPayment = get_pending_join_payment($pdo, $joinPaymentId);
    $trader = get_trader_by_id($pdo, (int)$joinPayment['trader_id']);
    $challenge = get_challenge_by_id($pdo, (int)$joinPayment['challenge_id']);

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

    ensure_not_already_joined($pdo, (int)$challenge['id'], (int)$trader['id']);

    $payload = [
        'paymentagent_loginid' => PAYMENT_AGENT_LOGINID,
        'amount' => (float)$joinPayment['amount'],
        'currency' => (string)$joinPayment['currency'],
        'verification_code' => $verificationCode,
        'join_payment_id' => $joinPaymentId,
        'challenge_id' => (int)$challenge['id'],
        'trader_id' => (int)$trader['id'],
    ];

    $response = null;
    $ws = new \Denara\DerivClient(DERIV_APP_ID);

    try {
        $ws->authorize((string)$trader['token']);

        $response = $ws->paymentAgentWithdraw(
            PAYMENT_AGENT_LOGINID,
            (float)$joinPayment['amount'],
            (string)$joinPayment['currency'],
            $verificationCode
        );

        $txid = $response['paymentagent_withdraw']['transaction_id'] ?? null;

        $pdo->beginTransaction();

        audit_join_payment($pdo, $joinPaymentId, $payload, $response);
        mark_join_payment_paid($pdo, $joinPaymentId, $txid);
        insert_challenge_participant($pdo, $joinPayment, $challenge, $trader);
        refresh_challenge_totals($pdo, (int)$challenge['id']);

        $pdo->commit();

    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        audit_join_payment($pdo, $joinPaymentId, $payload, ['error' => $e->getMessage()]);
        throw $e;
    } finally {
        $ws->close();
    }

    echo json_encode([
        'ok' => true,
        'join_payment' => [
            'id' => (int)$joinPayment['id'],
            'challenge_id' => (int)$joinPayment['challenge_id'],
            'trader_id' => (int)$joinPayment['trader_id'],
            'username' => $joinPayment['username'],
            'amount' => (float)$joinPayment['amount'],
            'currency' => (string)$joinPayment['currency'],
            'status' => 'paid',
            'deriv_txid' => $response['paymentagent_withdraw']['transaction_id'] ?? null,
        ],
        'participant' => [
            'challenge_id' => (int)$challenge['id'],
            'trader_id' => (int)$trader['id'],
            'username' => (string)$trader['username'],
        ],
        'challenge' => [
            'id' => (int)$challenge['id'],
            'name' => (string)$challenge['name'],
            'status' => $status,
        ],
    ], JSON_UNESCAPED_SLASHES);

} catch (Throwable $e) {
    fail($e->getMessage(), 500);
}