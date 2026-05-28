<?php
declare(strict_types=1);

namespace Denara;

use PDO;
use RuntimeException;

class PaymentService {
    private PDO $pdo;
    private int $appId;
    private string $paymentAgentLoginId;

    public function __construct(PDO $pdo, int $appId = 87874, string $paymentAgentLoginId = 'CR5373440') {
        $this->pdo = $pdo;
        $this->appId = $appId;
        $this->paymentAgentLoginId = $paymentAgentLoginId;
    }

    /**
     * PREPARE:
     * - authorize as copier; read email from authorize payload
     * - (fee > 0) send OTP email via verify_email(type=paymentagent_withdraw)
     * - read balance and currency
     * - enforce min_balance and funds checks
     * - create or reuse a pending invoice (idempotent)
     */
    public function prepare(int $traderId, string $copierUsername): array {
        $trader = $this->getTraderRow($traderId);           // token PLAINTEXT
        $copier = $this->getCopierRow($copierUsername);     // token PLAINTEXT

        $ws = new DerivClient($this->appId);
        $auth = $bal = $otp = null;
        $email = '';

        try {
            // 1) Authorize as copier and read email
            $auth = $ws->authorize($copier['token']);
            $email = (string)($auth['authorize']['email'] ?? '');
            if ($email === '') {
                throw new RuntimeException('Could not read copier email from authorization.');
            }

            // 2) Snapshot balance for the current account
            $bal = $ws->balance(['account' => 'current']);

        } finally {
            $ws->close();
        }

        // 3) Robust balance parsing
        [$copier_balance, $copier_currency] = $this->extractBalanceAndCurrency($bal);

        // 4) Fee logic (USD-only MVP if trader->price_usd is set)
        $price_usd    = $trader['price_usd'];
        $fee_amount   = $price_usd === null ? 0.00 : (float)$price_usd;
        $fee_currency = $price_usd === null ? $copier_currency : 'USD';

        if ($price_usd !== null && $copier_currency !== 'USD') {
            throw new RuntimeException('This trader charges in USD. Please switch to a USD account for payment.');
        }

        // 5) Min balance and funds for fee
        if ($copier_balance < (float)$trader['min_balance']) {
            throw new RuntimeException('Copier balance is below trader minimum requirement.');
        }
        if ($fee_amount > 0 && $copier_balance < $fee_amount) {
            throw new RuntimeException('Insufficient balance to pay the fee.');
        }

        // 6) Create or reuse a pending invoice
        $invoice = $this->createPendingInvoice((int)$trader['id'], (int)$copier['id'], $fee_amount, $fee_currency);

        // 7) Send OTP only when fee > 0
        $otp_payload = ['sent' => false, 'to' => null];
        if ($fee_amount > 0) {
            $ws2 = new DerivClient($this->appId);
            try {
                $ws2->authorize($copier['token']);
                $otp = $ws2->verifyEmail($email, 'paymentagent_withdraw');
                $otp_payload = ['sent' => true, 'to' => $email];
            } finally {
                $ws2->close();
            }
        }

        return [
            'ok' => true,
            'invoice' => [
                'id' => (int)$invoice['id'],
                'amount' => (float)$invoice['amount'],
                'currency' => (string)$invoice['currency'],
                'requires_otp' => $fee_amount > 0 ? 1 : 0,
                'copier_currency' => $copier_currency,
                'copier_balance' => $copier_balance,
            ],
            'otp' => $otp_payload,
            'next_step' => $fee_amount > 0
                ? 'Ask user for the verification code and call /payments/confirm'
                : 'No fee required; proceed to start copy directly (or call /payments/confirm to mark invoice as paid=free).',
        ];
    }

    /**
     * CONFIRM:
     * - authorize as copier
     * - if fee > 0: run paymentagent_withdraw(...)
     * - mark invoice paid
     * - start copy via CopyService->startCopy(...)
     */
    public function confirmAndStart(int $invoiceId, string $verificationCode): array {
        $inv = $this->getInvoice($invoiceId);
        if ($inv['status'] !== 'pending') {
            throw new RuntimeException('Invoice is not pending');
        }

        $trader = $this->getTraderRow((int)$inv['trader_id']);
        $copier = $this->getCopierById((int)$inv['copier_id']);

        $payload = [
            'paymentagent_loginid' => $this->paymentAgentLoginId,
            'amount' => (float)$inv['amount'],
            'currency' => (string)$inv['currency'],
            'verification_code' => $verificationCode,
        ];

        $response = null;
        $ws = new DerivClient($this->appId);
        try {
            $ws->authorize($copier['token']);

            if ((float)$inv['amount'] > 0) {
                $response = $ws->paymentAgentWithdraw(
                    $payload['paymentagent_loginid'],
                    $payload['amount'],
                    $payload['currency'],
                    $payload['verification_code']
                );
            } else {
                $response = ['paymentagent_withdraw' => ['skipped' => true, 'reason' => 'free']];
            }

            $txid = $response['paymentagent_withdraw']['transaction_id'] ?? null;
            $this->markInvoicePaid((int)$inv['id'], $txid, $payload, $response);

        } catch (\Throwable $e) {
            $this->audit((int)$inv['id'], $payload, ['error' => $e->getMessage()]);
            throw $e;
        } finally {
            $ws->close();
        }

        $copy = new CopyService($this->pdo, $this->appId);
        $res = $copy->startCopy((int)$trader['id'], (string)$copier['username']);

        return [
            'ok' => true,
            'payment' => [
                'invoice_id' => (int)$inv['id'],
                'amount' => (float)$inv['amount'],
                'currency' => (string)$inv['currency'],
                'txid' => $response['paymentagent_withdraw']['transaction_id'] ?? null,
            ],
            'copy' => $res,
        ];
    }

    /* ======================= internals ======================= */

    private function extractBalanceAndCurrency(array $bal): array {
        $simple_balance  = $bal['balance']['balance']  ?? null;
        $simple_currency = $bal['balance']['currency'] ?? null;
        if (is_numeric($simple_balance) && is_string($simple_currency) && $simple_currency !== '') {
            return [(float)$simple_balance, (string)$simple_currency];
        }

        $accounts = $bal['balance']['accounts'] ?? null;
        if (is_array($accounts) && !empty($accounts)) {
            $current = null;
            foreach ($accounts as $acc) {
                if (!empty($acc['is_virtual'])) continue; // skip demo
                if (!empty($acc['is_default'])) { $current = $acc; break; }
                if ($current === null) $current = $acc;
            }
            if ($current && isset($current['balance'], $current['currency'])) {
                return [(float)$current['balance'], (string)$current['currency']];
            }
        }

        throw new RuntimeException('Could not read copier balance');
    }

    private function getTraderRow(int $traderId): array {
        $stmt = $this->pdo->prepare("SELECT id, username, min_balance, price_usd, token FROM traders WHERE id = ?");
        $stmt->execute([$traderId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Trader not found');
        $tok = trim((string)$row['token']);
        if ($tok === '') throw new RuntimeException('Trader token missing');

        $row['token'] = \token_lazy_upgrade($this->pdo, 'traders', 'id', $traderId, $tok);
        return $row;
    }

    private function getCopierRow(string $username): array {
        $stmt = $this->pdo->prepare("SELECT id, username, token FROM copiers WHERE username = ?");
        $stmt->execute([$username]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Copier not found');
        $tok = trim((string)$row['token']);
        if ($tok === '') throw new RuntimeException('Copier token missing');

        $row['token'] = \token_lazy_upgrade($this->pdo, 'copiers', 'id', (int)$row['id'], $tok);
        return $row;
    }

    private function getCopierById(int $copierId): array {
        $stmt = $this->pdo->prepare("SELECT id, username, token FROM copiers WHERE id = ?");
        $stmt->execute([$copierId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Copier not found');
        $tok = trim((string)$row['token']);
        if ($tok === '') throw new RuntimeException('Copier token missing');

        $row['token'] = \token_lazy_upgrade($this->pdo, 'copiers', 'id', (int)$row['id'], $tok);
        return $row;
    }

    private function getInvoice(int $invoiceId): array {
        $stmt = $this->pdo->prepare("SELECT * FROM invoices WHERE id = ?");
        $stmt->execute([$invoiceId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Invoice not found');
        return $row;
    }

    private function createPendingInvoice(int $traderId, int $copierId, float $amount, string $currency): array {
        $sel = $this->pdo->prepare("SELECT * FROM invoices WHERE trader_id=? AND copier_id=? AND status='pending' LIMIT 1");
        $sel->execute([$traderId, $copierId]);
        $row = $sel->fetch(PDO::FETCH_ASSOC);
        if ($row) return $row;

        $ins = $this->pdo->prepare("
            INSERT INTO invoices (trader_id, copier_id, amount, currency, status, otp_required)
            VALUES (?, ?, ?, ?, 'pending', ?)
        ");
        $otp_required = $amount > 0 ? 1 : 0;
        $ins->execute([$traderId, $copierId, $amount, $currency, $otp_required]);

        $id = (int)$this->pdo->lastInsertId();
        $get = $this->pdo->prepare("SELECT * FROM invoices WHERE id=?");
        $get->execute([$id]);
        return $get->fetch(PDO::FETCH_ASSOC);
    }

    private function markInvoicePaid(int $invoiceId, ?string $txid, array $payload, array $response): void {
        $this->audit($invoiceId, $payload, $response);

        $stmt = $this->pdo->prepare("UPDATE invoices SET status='paid', deriv_txid=?, paid_at=NOW() WHERE id=? AND status='pending'");
        $stmt->execute([$txid, $invoiceId]);
        if ($stmt->rowCount() === 0) {
            throw new RuntimeException('Invoice state not updated (already settled?)');
        }
    }

    private function audit(int $invoiceId, array $payload, array $response = []): void {
        try {
            $ins = $this->pdo->prepare(
                "INSERT INTO payments_audit (invoice_id, payload, response) VALUES (?, ?, ?)"
            );
            $ins->execute([
                $invoiceId,
                json_encode($payload, JSON_UNESCAPED_SLASHES),
                json_encode($response, JSON_UNESCAPED_SLASHES),
            ]);
        } catch (\Throwable $e) {
            error_log("[payments_audit] ".$e->getMessage());
        }
    }
}
