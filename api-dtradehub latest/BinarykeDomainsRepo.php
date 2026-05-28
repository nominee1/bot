<?php
// api/BinarykeDomainsRepo.php
declare(strict_types=1);

final class BinarykeDomainsRepo {

    public static function upsertDomain(PDO $pdo, int $userId, string $domain, ?int $appId): array {
        // table: user_domains (recommended)
        $sel = $pdo->prepare("SELECT * FROM user_domains WHERE user_id=? AND domain=? LIMIT 1");
        $sel->execute([$userId, $domain]);
        $row = $sel->fetch();
        if ($row) {
            // update app_id if provided
            if ($appId !== null) {
                $u = $pdo->prepare("UPDATE user_domains SET app_id=? WHERE id=?");
                $u->execute([$appId, (int)$row['id']]);
                $row['app_id'] = $appId;
            }
            return $row;
        }

        $ins = $pdo->prepare("INSERT INTO user_domains (user_id, domain, app_id, status, created_at)
                              VALUES (?, ?, ?, 'pending_payment', NOW())");
        $ins->execute([$userId, $domain, $appId]);

        $id = (int)$pdo->lastInsertId();
        $get = $pdo->prepare("SELECT * FROM user_domains WHERE id=?");
        $get->execute([$id]);
        return $get->fetch();
    }

    public static function createPendingInvoice(PDO $pdo, int $userId, int $domainId, string $planId, float $amountUsd, string $currency): array {
        // idempotent: reuse pending invoice for same user+domain
        $sel = $pdo->prepare("SELECT * FROM domain_invoices WHERE user_id=? AND domain_id=? AND status='pending' LIMIT 1");
        $sel->execute([$userId, $domainId]);
        $row = $sel->fetch();
        if ($row) return $row;

        $ins = $pdo->prepare("INSERT INTO domain_invoices (user_id, domain_id, plan_id, amount_usd, currency, status, created_at)
                              VALUES (?, ?, ?, ?, ?, 'pending', NOW())");
        $ins->execute([$userId, $domainId, $planId, $amountUsd, $currency]);

        $id = (int)$pdo->lastInsertId();
        return self::getInvoice($pdo, $id);
    }

    public static function getInvoice(PDO $pdo, int $invoiceId): array {
        $st = $pdo->prepare("SELECT * FROM domain_invoices WHERE id=? LIMIT 1");
        $st->execute([$invoiceId]);
        $row = $st->fetch();
        if (!$row) throw new RuntimeException('Invoice not found');
        return $row;
    }

    public static function markPaid(PDO $pdo, int $invoiceId, ?string $txid, array $payload, array $response): void {
        self::audit($pdo, $invoiceId, $payload, $response);

        $st = $pdo->prepare("UPDATE domain_invoices SET status='paid', deriv_txid=?, paid_at=NOW()
                             WHERE id=? AND status='pending'");
        $st->execute([$txid, $invoiceId]);
        if ($st->rowCount() === 0) {
            throw new RuntimeException('Invoice not updated (already settled?)');
        }
    }

    public static function audit(PDO $pdo, int $invoiceId, array $payload, array $response): void {
        try {
            $ins = $pdo->prepare("INSERT INTO domain_payments_audit (invoice_id, payload, response, created_at)
                                  VALUES (?, ?, ?, NOW())");
            $ins->execute([
                $invoiceId,
                json_encode($payload, JSON_UNESCAPED_SLASHES),
                json_encode($response, JSON_UNESCAPED_SLASHES),
            ]);
        } catch (Throwable $e) {
            // never break flow because of audit
        }
    }
}
