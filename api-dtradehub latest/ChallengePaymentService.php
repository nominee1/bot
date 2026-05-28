<?php
declare(strict_types=1);

namespace Denara;

use PDO;
use RuntimeException;
use DateTimeImmutable;
use DateTimeZone;

class ChallengePaymentService {
    private PDO $pdo;
    private int $appId;
    private string $paymentAgentLoginId;

    public function __construct(PDO $pdo, int $appId = 76100, string $paymentAgentLoginId = 'CR5373440') {
        $this->pdo = $pdo;
        $this->appId = $appId;
        $this->paymentAgentLoginId = $paymentAgentLoginId;
    }

    /**
     * PREPARE:
     * - Get challenge
     * - Get registered trader by username from traders_competition_2
     * - Authorize trader token using DerivClient, same style as PaymentService
     * - Check real account, USD account, enough balance
     * - Create/reuse pending challenge join payment
     * - Send Deriv OTP
     */
    public function prepare(int $challengeId, string $username): array {
        $challenge = $this->getChallengeRow($challengeId);
        $this->ensureChallengeJoinable($challenge);

        if ((string)$challenge['challenge_type'] !== 'paid') {
            throw new RuntimeException('This challenge is free. Use the normal join challenge endpoint.');
        }

        $entryFee = (float)$challenge['entry_fee'];
        $minimumBalance = (float)$challenge['minimum_balance'];
        $totalRequired = $entryFee + $minimumBalance;

        if ($entryFee <= 0) {
            throw new RuntimeException('Invalid challenge entry fee.');
        }

        $trader = $this->getTraderRowByUsername($username);

        $this->ensureNotAlreadyJoined((int)$challenge['id'], (int)$trader['id']);

        $ws = new DerivClient($this->appId);

        $email = '';
        $loginid = '';
        $balanceResponse = null;

        try {
            $auth = $ws->authorize($trader['token']);
            $authPayload = $auth['authorize'] ?? [];

            $email = (string)($authPayload['email'] ?? '');
            $loginid = (string)($authPayload['loginid'] ?? '');
            $isVirtual = (int)($authPayload['is_virtual'] ?? 0) === 1;

            if ($loginid === '') {
                throw new RuntimeException('Could not authorize trader account.');
            }

            if ($isVirtual || str_starts_with($loginid, 'VRTC')) {
                throw new RuntimeException('Only real Deriv accounts can join paid challenges.');
            }

            if ($email === '') {
                throw new RuntimeException('Could not read trader email from authorization.');
            }

            $balanceResponse = $ws->balance([
                'account' => 'current',
            ]);
        } finally {
            $ws->close();
        }

        [$balance, $currency] = $this->extractBalanceAndCurrency($balanceResponse);

        if ($currency !== 'USD') {
            throw new RuntimeException('Please switch to a USD account to join this challenge.');
        }

        if ($balance < $totalRequired) {
            throw new RuntimeException(
                'Not enough funds to join challenge. Required: ' .
                number_format($totalRequired, 2, '.', '') .
                ' USD.'
            );
        }

        $payment = $this->createPendingChallengePayment(
            (int)$challenge['id'],
            (int)$trader['id'],
            (string)$trader['username'],
            $entryFee,
            'USD',
            $email,
            $balance,
            [
                'challenge_id' => (int)$challenge['id'],
                'challenge_name' => (string)$challenge['name'],
                'username' => (string)$trader['username'],
                'entry_fee' => $entryFee,
                'minimum_balance' => $minimumBalance,
                'total_required' => $totalRequired,
                'currency' => 'USD',
            ]
        );

        $ws2 = new DerivClient($this->appId);

        try {
            $ws2->authorize($trader['token']);
            $ws2->verifyEmail($email, 'paymentagent_withdraw');
        } finally {
            $ws2->close();
        }

        return [
            'ok' => true,
            'join_payment' => [
                'id' => (int)$payment['id'],
                'challenge_id' => (int)$challenge['id'],
                'trader_id' => (int)$trader['id'],
                'username' => (string)$trader['username'],
                'amount' => $entryFee,
                'currency' => 'USD',
                'status' => (string)$payment['status'],
                'otp_required' => 1,
            ],
            'otp' => [
                'sent' => true,
                'to' => $email,
            ],
            'account' => [
                'balance' => $balance,
                'currency' => 'USD',
            ],
            'challenge' => [
                'id' => (int)$challenge['id'],
                'name' => (string)$challenge['name'],
                'entry_fee' => $entryFee,
                'minimum_balance' => $minimumBalance,
                'status' => (string)$challenge['status'],
            ],
            'next_step' => 'Ask user for the verification code and call /challenge/payments/confirm',
        ];
    }

    /**
     * CONFIRM:
     * - Get pending join payment
     * - Authorize trader from traders_competition_2
     * - Run paymentagent_withdraw
     * - Mark payment paid
     * - Add user to challenge_participants
     */
    public function confirmAndJoin(int $joinPaymentId, string $verificationCode): array {
        $payment = $this->getJoinPayment($joinPaymentId);

        if ((string)$payment['status'] !== 'pending') {
            throw new RuntimeException('Join payment is not pending.');
        }

        $challenge = $this->getChallengeRow((int)$payment['challenge_id']);
        $this->ensureChallengeJoinable($challenge);

        $trader = $this->getTraderRowById((int)$payment['trader_id']);

        $payload = [
            'paymentagent_loginid' => $this->paymentAgentLoginId,
            'amount' => (float)$payment['amount_usd'],
            'currency' => (string)$payment['currency'],
            'verification_code' => $verificationCode,
        ];

        $response = null;
        $txid = null;
        $lockKey = 'challenge_join_payment:' . $joinPaymentId;

        try {
            $lock = $this->pdo->prepare("SELECT GET_LOCK(?, 12) AS got");
            $lock->execute([$lockKey]);
            $lockRow = $lock->fetch(PDO::FETCH_ASSOC);

            if (!isset($lockRow['got']) || (int)$lockRow['got'] !== 1) {
                throw new RuntimeException('Busy: payment is already being processed. Try again.');
            }

            $payment = $this->getJoinPayment($joinPaymentId);

            if ((string)$payment['status'] !== 'pending') {
                throw new RuntimeException('Join payment is not pending.');
            }

            $ws = new DerivClient($this->appId);

            try {
                $ws->authorize($trader['token']);

                $response = $ws->paymentAgentWithdraw(
                    $payload['paymentagent_loginid'],
                    $payload['amount'],
                    $payload['currency'],
                    $payload['verification_code']
                );

                $txid = $response['paymentagent_withdraw']['transaction_id'] ?? null;
            } finally {
                $ws->close();
            }

            $this->pdo->beginTransaction();

            $this->markJoinPaymentPaid(
                (int)$payment['id'],
                $txid ? (string)$txid : null,
                $payload,
                is_array($response) ? $response : ['raw' => $response]
            );

            $participant = $this->joinParticipantAfterPayment($payment, $challenge);

            $this->pdo->commit();

            try {
                $this->pdo->prepare("SELECT RELEASE_LOCK(?)")->execute([$lockKey]);
            } catch (\Throwable $x) {}

            return [
                'ok' => true,
                'join_payment' => [
                    'id' => (int)$payment['id'],
                    'challenge_id' => (int)$payment['challenge_id'],
                    'trader_id' => (int)$payment['trader_id'],
                    'username' => (string)$payment['username'],
                    'amount' => (float)$payment['amount_usd'],
                    'currency' => (string)$payment['currency'],
                    'status' => 'paid',
                    'deriv_txid' => $txid,
                ],
                'participant' => [
                    'challenge_id' => (int)$payment['challenge_id'],
                    'trader_id' => (int)$payment['trader_id'],
                    'username' => (string)$payment['username'],
                ],
                'challenge' => [
                    'id' => (int)$challenge['id'],
                    'name' => (string)$challenge['name'],
                    'status' => (string)$challenge['status'],
                ],
            ];

        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                try {
                    $this->pdo->rollBack();
                } catch (\Throwable $x) {}
            }

            try {
                $this->auditJoinPayment($joinPaymentId, $payload, [
                    'error' => $e->getMessage(),
                ]);
            } catch (\Throwable $x) {}

            try {
                $this->pdo->prepare("SELECT RELEASE_LOCK(?)")->execute([$lockKey]);
            } catch (\Throwable $x) {}

            throw $e;
        }
    }

    private function extractBalanceAndCurrency(array $bal): array {
        $simpleBalance = $bal['balance']['balance'] ?? null;
        $simpleCurrency = $bal['balance']['currency'] ?? null;

        if (is_numeric($simpleBalance) && is_string($simpleCurrency) && $simpleCurrency !== '') {
            return [(float)$simpleBalance, strtoupper((string)$simpleCurrency)];
        }

        $accounts = $bal['balance']['accounts'] ?? null;

        if (is_array($accounts) && !empty($accounts)) {
            $current = null;

            foreach ($accounts as $acc) {
                if (!empty($acc['is_virtual'])) {
                    continue;
                }

                if (!empty($acc['is_default'])) {
                    $current = $acc;
                    break;
                }

                if ($current === null) {
                    $current = $acc;
                }
            }

            if ($current && isset($current['balance'], $current['currency'])) {
                return [
                    (float)$current['balance'],
                    strtoupper((string)$current['currency']),
                ];
            }
        }

        throw new RuntimeException('Could not read trader balance.');
    }

    private function getChallengeRow(int $challengeId): array {
        $stmt = $this->pdo->prepare("
            SELECT
                id,
                name,
                created_by_trader_id,
                created_by_username,
                challenge_type,
                entry_fee,
                minimum_balance,
                participant_count,
                prize_pool,
                start_time,
                end_time,
                join_cutoff_hours_before_end,
                manual_status
            FROM challenges
            WHERE id = ?
            LIMIT 1
        ");

        $stmt->execute([$challengeId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            throw new RuntimeException('Challenge not found.');
        }

        $row['status'] = $this->deriveChallengeStatus(
            (string)$row['start_time'],
            (string)$row['end_time'],
            (int)$row['join_cutoff_hours_before_end'],
            (string)($row['manual_status'] ?? '')
        );

        return $row;
    }

    private function deriveChallengeStatus(
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

    private function ensureChallengeJoinable(array $challenge): void {
        $status = (string)($challenge['status'] ?? '');

        if (!in_array($status, ['upcoming', 'live_open'], true)) {
            throw new RuntimeException('Joining is closed for this challenge.');
        }
    }

    private function getTraderRowByUsername(string $username): array {
        $stmt = $this->pdo->prepare("
            SELECT id, username, email, token
            FROM traders_competition_2
            WHERE username = ?
            LIMIT 1
        ");

        $stmt->execute([$username]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            throw new RuntimeException('Trader not found. Register first before joining this challenge.');
        }

        $tok = trim((string)$row['token']);

        if ($tok === '') {
            throw new RuntimeException('Trader token missing.');
        }

        $row['token'] = \token_lazy_upgrade(
            $this->pdo,
            'traders_competition_2',
            'id',
            (int)$row['id'],
            $tok
        );

        return $row;
    }

    private function getTraderRowById(int $traderId): array {
        $stmt = $this->pdo->prepare("
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

        $tok = trim((string)$row['token']);

        if ($tok === '') {
            throw new RuntimeException('Trader token missing.');
        }

        $row['token'] = \token_lazy_upgrade(
            $this->pdo,
            'traders_competition_2',
            'id',
            (int)$row['id'],
            $tok
        );

        return $row;
    }

    private function ensureNotAlreadyJoined(int $challengeId, int $traderId): void {
        $stmt = $this->pdo->prepare("
            SELECT id, join_status
            FROM challenge_participants
            WHERE challenge_id = ?
              AND trader_id = ?
              AND join_status = 'joined'
            LIMIT 1
        ");

        $stmt->execute([$challengeId, $traderId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($row) {
            throw new RuntimeException('You have already joined this challenge.');
        }
    }

    private function createPendingChallengePayment(
        int $challengeId,
        int $traderId,
        string $username,
        float $amount,
        string $currency,
        string $payerEmail,
        float $balanceChecked,
        array $requestPayload
    ): array {
        $sel = $this->pdo->prepare("
            SELECT *
            FROM challenge_join_payments
            WHERE challenge_id = ?
              AND trader_id = ?
              AND status = 'pending'
            LIMIT 1
        ");

        $sel->execute([$challengeId, $traderId]);
        $existing = $sel->fetch(PDO::FETCH_ASSOC);

        if ($existing) {
            return $existing;
        }

        $ins = $this->pdo->prepare("
            INSERT INTO challenge_join_payments
                (
                    challenge_id,
                    trader_id,
                    username,
                    amount_usd,
                    currency,
                    status,
                    payer_email,
                    balance_checked,
                    request_payload
                )
            VALUES
                (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        ");

        $ins->execute([
            $challengeId,
            $traderId,
            $username,
            $amount,
            $currency,
            $payerEmail,
            $balanceChecked,
            json_encode($requestPayload, JSON_UNESCAPED_SLASHES),
        ]);

        $id = (int)$this->pdo->lastInsertId();

        $get = $this->pdo->prepare("
            SELECT *
            FROM challenge_join_payments
            WHERE id = ?
            LIMIT 1
        ");

        $get->execute([$id]);

        $row = $get->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            throw new RuntimeException('Could not create join payment.');
        }

        return $row;
    }

    private function getJoinPayment(int $joinPaymentId): array {
        $stmt = $this->pdo->prepare("
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

        return $row;
    }

    private function markJoinPaymentPaid(
        int $joinPaymentId,
        ?string $txid,
        array $payload,
        array $response
    ): void {
        $this->auditJoinPayment($joinPaymentId, $payload, $response);

        $stmt = $this->pdo->prepare("
            UPDATE challenge_join_payments
            SET
                status = 'paid',
                deriv_txid = ?,
                response_payload = ?,
                paid_at = NOW()
            WHERE id = ?
              AND status = 'pending'
            LIMIT 1
        ");

        $stmt->execute([
            $txid,
            json_encode($response, JSON_UNESCAPED_SLASHES),
            $joinPaymentId,
        ]);

        if ($stmt->rowCount() === 0) {
            throw new RuntimeException('Join payment state not updated. It may already be settled.');
        }
    }

    private function joinParticipantAfterPayment(array $payment, array $challenge): array {
        $challengeId = (int)$payment['challenge_id'];
        $traderId = (int)$payment['trader_id'];
        $username = (string)$payment['username'];
        $amount = (float)$payment['amount_usd'];
        $minimumBalance = (float)$challenge['minimum_balance'];
        $totalRequired = $minimumBalance + $amount;
        $balanceChecked = isset($payment['balance_checked']) ? (float)$payment['balance_checked'] : null;

        $sel = $this->pdo->prepare("
            SELECT id, join_status
            FROM challenge_participants
            WHERE challenge_id = ?
              AND trader_id = ?
            LIMIT 1
        ");

        $sel->execute([$challengeId, $traderId]);
        $existing = $sel->fetch(PDO::FETCH_ASSOC);

        if ($existing) {
            $up = $this->pdo->prepare("
                UPDATE challenge_participants
                SET
                    username = ?,
                    join_status = 'joined',
                    entry_fee_paid = ?,
                    minimum_balance_required = ?,
                    total_required = ?,
                    balance_checked = ?,
                    updated_at = NOW()
                WHERE id = ?
                LIMIT 1
            ");

            $up->execute([
                $username,
                $amount,
                $minimumBalance,
                $totalRequired,
                $balanceChecked,
                (int)$existing['id'],
            ]);

            $this->recalculateChallengeTotals($challengeId);

            return [
                'id' => (int)$existing['id'],
                'challenge_id' => $challengeId,
                'trader_id' => $traderId,
                'username' => $username,
            ];
        }

        $ins = $this->pdo->prepare("
            INSERT INTO challenge_participants
                (
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
                )
            VALUES
                (?, ?, ?, 'joined', ?, ?, ?, ?, NOW(), NOW())
        ");

        $ins->execute([
            $challengeId,
            $traderId,
            $username,
            $amount,
            $minimumBalance,
            $totalRequired,
            $balanceChecked,
        ]);

        $participantId = (int)$this->pdo->lastInsertId();

        $this->recalculateChallengeTotals($challengeId);

        return [
            'id' => $participantId,
            'challenge_id' => $challengeId,
            'trader_id' => $traderId,
            'username' => $username,
        ];
    }

    private function recalculateChallengeTotals(int $challengeId): void {
        $stmt = $this->pdo->prepare("
            UPDATE challenges
            SET
                participant_count = (
                    SELECT COUNT(*)
                    FROM challenge_participants cp
                    WHERE cp.challenge_id = ?
                      AND cp.join_status = 'joined'
                ),
                prize_pool = (
                    SELECT COALESCE(SUM(cp.entry_fee_paid), 0.00)
                    FROM challenge_participants cp
                    WHERE cp.challenge_id = ?
                      AND cp.join_status = 'joined'
                )
            WHERE id = ?
            LIMIT 1
        ");

        $stmt->execute([
            $challengeId,
            $challengeId,
            $challengeId,
        ]);
    }

    private function auditJoinPayment(int $joinPaymentId, array $payload, array $response = []): void {
        try {
            $stmt = $this->pdo->prepare("
                UPDATE challenge_join_payments
                SET
                    request_payload = COALESCE(request_payload, ?),
                    response_payload = ?
                WHERE id = ?
                LIMIT 1
            ");

            $stmt->execute([
                json_encode($payload, JSON_UNESCAPED_SLASHES),
                json_encode($response, JSON_UNESCAPED_SLASHES),
                $joinPaymentId,
            ]);
        } catch (\Throwable $e) {
            error_log('[challenge_join_payment_audit] ' . $e->getMessage());
        }
    }
}