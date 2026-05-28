<?php
declare(strict_types=1);

namespace Denara;

use PDO;
use RuntimeException;

final class DomainsPaymentsService
{
    private PDO $pdo;
    private int $derivAppId;
    private string $paymentAgentLoginId;

    public function __construct(PDO $pdo, int $derivAppId, string $paymentAgentLoginId)
    {
        $this->pdo = $pdo;
        $this->derivAppId = $derivAppId;
        $this->paymentAgentLoginId = $paymentAgentLoginId;
    }

    /** Server-side plan truth */
    public static function getPlan(string $planId): array
    {
        $plans = [
            'standard_6m'  => ['plan_id' => 'standard_6m',  'months' => 6,  'amount' => 15.0, 'currency' => 'USD'],
            'standard_12m' => ['plan_id' => 'standard_12m', 'months' => 12, 'amount' => 25.0, 'currency' => 'USD'],
        ];
        if (!isset($plans[$planId])) {
            throw new RuntimeException('Invalid plan_id');
        }
        return $plans[$planId];
    }

    public static function isValidDomain(string $domain): bool
    {
        $domain = strtolower(trim($domain));
        if ($domain === '' || strlen($domain) > 253) return false;
        // simple safe check (good enough for payment stage)
        return (bool)preg_match('/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})+$/', $domain);
    }

    /** PREPARE: authorize + balance + send OTP + create invoice */
    public function prepare(int $userId, string $domain, string $planId, ?int $appId): array
    {
        $domain = strtolower(trim($domain));
        if (!self::isValidDomain($domain)) throw new RuntimeException('Invalid domain format');

        $plan = self::getPlan($planId);
        $amount = (float)$plan['amount'];
        $currency = (string)$plan['currency']; // USD

        $user = $this->getUser($userId);
        $derivToken = trim((string)($user['deriv_token_enc'] ?? ''));
        if ($derivToken === '') throw new RuntimeException('User Deriv token missing in users table');

        $ws = new DerivClient($this->derivAppId);
        try {
            $auth = $ws->authorize($derivToken);
            $email = (string)($auth['authorize']['email'] ?? '');
            $loginid = (string)($auth['authorize']['loginid'] ?? '');
            if ($email === '') throw new RuntimeException('Could not read email from Deriv authorize');

            $bal = $ws->balance(['account' => 'current']);
            [$balance, $balCur] = $this->extractBalanceAndCurrency($bal);

            if ($balCur !== 'USD') throw new RuntimeException('Please switch to a USD account to pay.');
            if ($balance < $amount) throw new RuntimeException('Insufficient balance to pay.');

            // Send OTP email (Deriv verify_email)
            // NOTE: verify_email does not return the code; it sends to user email.
            $ws->verifyEmail($email, 'paymentagent_withdraw');

            // Create or reuse pending invoice (idempotent-ish)
            $inv = $this->createOrReusePendingInvoice($userId, $domain, $planId, $appId, $amount, $currency);

            return [
                'success' => true,
                'invoice' => [
                    'id' => (int)$inv['id'],
                    'domain' => $domain,
                    'plan_id' => $planId,
                    'amount' => $amount,
                    'currency' => $currency,
                    'requires_otp' => 1,
                    'status' => (string)$inv['status'],
                ],
                'payer' => [
                    'loginid' => $loginid,
                    'email' => $email,
                    'balance' => $balance,
                    'currency' => $balCur,
                ],
                'otp' => ['sent' => true, 'to' => $email],
                'next_step' => 'POST /domains/payments/confirm with invoice_id and verification_code',
                'note' => 'Domain purchase is paused (payment-only mode).',
            ];
        } finally {
            $ws->close();
        }
    }

    /** CONFIRM: paymentagent_withdraw + mark paid + audit (NO Namecheap) */
    public function confirm(int $userId, int $invoiceId, string $verificationCode): array
    {
        if ($invoiceId <= 0) throw new RuntimeException('Missing invoice_id');
        $verificationCode = trim($verificationCode);
        if ($verificationCode === '') throw new RuntimeException('Missing verification_code');

        $inv = $this->getInvoice($invoiceId);
        if ((int)$inv['user_id'] !== $userId) throw new RuntimeException('Invoice does not belong to you');

        // idempotent response if already paid
        if ((string)$inv['status'] !== 'pending') {
            return [
                'success' => true,
                'mode' => 'payment_only',
                'message' => 'Invoice already settled.',
                'payment' => [
                    'invoice_id' => (int)$inv['id'],
                    'status' => (string)$inv['status'],
                    'txid' => $inv['deriv_txid'] ?? null,
                    'amount' => (float)$inv['amount_usd'],
                    'currency' => (string)$inv['currency'],
                    'paid_at' => $inv['paid_at'] ?? null,
                ],
            ];
        }

        $user = $this->getUser($userId);
        $derivToken = trim((string)($user['deriv_token_enc'] ?? ''));
        if ($derivToken === '') throw new RuntimeException('User Deriv token missing in users table');

        // serialize to prevent double-charge
        $lockKey = 'binaryke:domain_invoice:' . $invoiceId;
        $this->getLock($lockKey, 12);

        try {
            // re-read within lock
            $inv = $this->getInvoice($invoiceId);
            if ((string)$inv['status'] !== 'pending') {
                $this->releaseLock($lockKey);
                return [
                    'success' => true,
                    'mode' => 'payment_only',
                    'message' => 'Invoice already settled.',
                    'payment' => [
                        'invoice_id' => (int)$inv['id'],
                        'status' => (string)$inv['status'],
                        'txid' => $inv['deriv_txid'] ?? null,
                        'amount' => (float)$inv['amount_usd'],
                        'currency' => (string)$inv['currency'],
                        'paid_at' => $inv['paid_at'] ?? null,
                    ],
                ];
            }

            $amount = (float)$inv['amount_usd'];
            $currency = (string)$inv['currency'];

            $payload = [
                'paymentagent_loginid' => $this->paymentAgentLoginId,
                'amount' => $amount,
                'currency' => $currency,
                'verification_code' => $verificationCode,
            ];

            $ws = new DerivClient($this->derivAppId);
            $response = null;
            $txid = null;

            try {
                $ws->authorize($derivToken);

                $response = $ws->paymentAgentWithdraw(
                    $this->paymentAgentLoginId,
                    $amount,
                    $currency,
                    $verificationCode
                );

                $txid = $response['paymentagent_withdraw']['transaction_id'] ?? null;
            } finally {
                $ws->close();
            }

            // mark paid + audit
            $this->pdo->beginTransaction();
            try {
                $this->audit($invoiceId, $payload, is_array($response) ? $response : ['raw' => $response]);

                $st = $this->pdo->prepare("
                    UPDATE domain_invoices
                    SET status='paid', deriv_txid=?, paid_at=NOW()
                    WHERE id=? AND status='pending'
                ");
                $st->execute([$txid ? (string)$txid : null, $invoiceId]);

                if ($st->rowCount() === 0) {
                    throw new RuntimeException('Invoice not updated (already settled?)');
                }

                $this->pdo->commit();
            } catch (\Throwable $e) {
                $this->pdo->rollBack();
                throw $e;
            }

            $inv2 = $this->getInvoice($invoiceId);

            return [
                'success' => true,
                'mode' => 'payment_only',
                'message' => 'Payment received and saved. Domain purchase is disabled (no Namecheap charge).',
                'txid' => $inv2['deriv_txid'] ?? null,
                'payment' => [
                    'invoice_id' => (int)$inv2['id'],
                    'status' => (string)$inv2['status'],
                    'amount' => (float)$inv2['amount_usd'],
                    'currency' => (string)$inv2['currency'],
                    'paid_at' => $inv2['paid_at'] ?? null,
                ],
            ];
        } catch (\Throwable $e) {
            try { $this->audit($invoiceId, ['error_stage' => 'confirm'], ['error' => $e->getMessage()]); } catch (\Throwable $x) {}
            throw $e;
        } finally {
            $this->releaseLock($lockKey);
        }
    }

    /* ===================== DB helpers ===================== */

    private function getUser(int $userId): array
    {
        $st = $this->pdo->prepare("SELECT id, email, deriv_loginid, deriv_token_enc FROM users WHERE id=? LIMIT 1");
        $st->execute([$userId]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('User not found');
        return $row;
    }

    private function createOrReusePendingInvoice(int $userId, string $domain, string $planId, ?int $appId, float $amount, string $currency): array
    {
        // reuse any pending invoice for same user+domain+plan
        $sel = $this->pdo->prepare("
            SELECT * FROM domain_invoices
            WHERE user_id=? AND domain=? AND plan_id=? AND status='pending'
            ORDER BY id DESC
            LIMIT 1
        ");
        $sel->execute([$userId, $domain, $planId]);
        $row = $sel->fetch(PDO::FETCH_ASSOC);
        if ($row) return $row;

        $meta = [
            'app_id' => $appId,
            'note' => 'payment-only mode (no namecheap)',
        ];

        $ins = $this->pdo->prepare("
            INSERT INTO domain_invoices (user_id, domain, plan_id, app_id, amount_usd, currency, status, meta_json)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
        ");
        $ins->execute([
            $userId,
            $domain,
            $planId,
            $appId,
            $amount,
            $currency,
            json_encode($meta, JSON_UNESCAPED_SLASHES),
        ]);

        $id = (int)$this->pdo->lastInsertId();
        return $this->getInvoice($id);
    }

    private function getInvoice(int $invoiceId): array
    {
        $st = $this->pdo->prepare("SELECT * FROM domain_invoices WHERE id=? LIMIT 1");
        $st->execute([$invoiceId]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Invoice not found');
        return $row;
    }

    private function audit(int $invoiceId, array $payload, array $response): void
    {
        $ins = $this->pdo->prepare("
          INSERT INTO domain_payments_audit (invoice_id, payload_json, response_json)
          VALUES (?, ?, ?)
        ");
        $ins->execute([
            $invoiceId,
            json_encode($payload, JSON_UNESCAPED_SLASHES),
            json_encode($response, JSON_UNESCAPED_SLASHES),
        ]);
    }

    private function extractBalanceAndCurrency(array $bal): array
    {
        $simple_balance  = $bal['balance']['balance']  ?? null;
        $simple_currency = $bal['balance']['currency'] ?? null;
        if (is_numeric($simple_balance) && is_string($simple_currency) && $simple_currency !== '') {
            return [(float)$simple_balance, (string)$simple_currency];
        }

        $accounts = $bal['balance']['accounts'] ?? null;
        if (is_array($accounts) && !empty($accounts)) {
            $current = null;
            foreach ($accounts as $acc) {
                if (!empty($acc['is_virtual'])) continue;
                if (!empty($acc['is_default'])) { $current = $acc; break; }
                if ($current === null) $current = $acc;
            }
            if ($current && isset($current['balance'], $current['currency'])) {
                return [(float)$current['balance'], (string)$current['currency']];
            }
        }

        throw new RuntimeException('Could not read balance/currency');
    }

    private function getLock(string $key, int $timeoutSeconds): void
    {
        $st = $this->pdo->prepare("SELECT GET_LOCK(?, ?) AS got");
        $st->execute([$key, $timeoutSeconds]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (!isset($row['got']) || (int)$row['got'] !== 1) {
            throw new RuntimeException('Busy: payment is already being processed. Try again.');
        }
    }

    private function releaseLock(string $key): void
    {
        try {
            $st = $this->pdo->prepare("SELECT RELEASE_LOCK(?)");
            $st->execute([$key]);
        } catch (\Throwable $e) {
            // ignore
        }
    }
}
