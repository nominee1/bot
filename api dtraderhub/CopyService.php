<?php
declare(strict_types=1);

namespace Denara;

use PDO;
use RuntimeException;

class CopyService {
    private PDO $pdo;
    private int $appId;

    public function __construct(PDO $pdo, int $appId = 36300) {
        $this->pdo   = $pdo;
        $this->appId = $appId;
    }

    /**
     * Start copying:
     *  - Authorize as COPIER and force FOLLOWER (allow_copiers = 0)
     *  - (Best-effort) Authorize TRADER and ensure LEADER (allow_copiers = 1)
     *  - copy_start on COPIER session with trader's token
     *  - Upsert relationship active
     */
    public function startCopy(int $traderId, string $copierUsername): array {
        $copierUsername = trim($copierUsername);
        if ($traderId <= 0 || $copierUsername === '') {
            throw new RuntimeException('trader_id and copier_username are required');
        }

        $trader = $this->getTraderRow($traderId);           // id, username, token (plaintext via lazy decrypt/upgrade)
        $copier = $this->getCopierRow($copierUsername);     // id, username, token (plaintext via lazy decrypt/upgrade)

        $ws_trader = new DerivClient($this->appId);
        $ws_copier = new DerivClient($this->appId);

        try {
            // 1) COPIER: authorize + force follower (allow_copiers = 0)
            $ws_copier->authorize($copier['token']);
            try {
                $ws_copier->ensureFollower();
            } catch (\Throwable $e) {
                // Non-fatal; if still in leader mode, Deriv will block copy_start with clear error.
                error_log('[copy_start] ensureFollower failed for copier: ' . $e->getMessage());
            }

            // 2) (Optional) TRADER: authorize + ensure leader (allow_copiers = 1)
            try {
                $ws_trader->authorize($trader['token']);
                $ws_trader->ensureLeader();
            } catch (\Throwable $e) {
                // Not fatal; trader may already be set at registration time.
                error_log('[copy_start] ensureLeader failed for trader: ' . $e->getMessage());
            }

            // 3) COPIER: start following TRADER
            $ws_copier->copyStart($trader['token']);

            // 4) Persist relationship (ID-based to satisfy FK)
            $this->upsertRelationshipById($traderId, (int)$copier['id'], true);

            return [
                'ok'              => true,
                'trader_id'       => $traderId,
                'copier_id'       => (int)$copier['id'],
                'copier_username' => $copier['username'],
                'message'         => 'Copy started',
            ];
        } finally {
            $ws_trader->close();
            $ws_copier->close();
        }
    }

    /**
     * Stop copying: copier stops following trader, and mark relationship inactive.
     */
    public function stopCopy(int $traderId, string $copierUsername): array {
        $copierUsername = trim($copierUsername);
        if ($traderId <= 0 || $copierUsername === '') {
            throw new RuntimeException('trader_id and copier_username are required');
        }

        $trader = $this->getTraderRow($traderId);
        $copier = $this->getCopierRow($copierUsername);

        $ws = new DerivClient($this->appId);
        try {
            // Authorize as copier then stop copying this trader
            $ws->authorize($copier['token']);
            $ws->copyStop($trader['token']);

            // Persist relationship inactive
            $this->upsertRelationshipById($traderId, (int)$copier['id'], false);

            return [
                'ok'              => true,
                'trader_id'       => $traderId,
                'copier_id'       => (int)$copier['id'],
                'copier_username' => $copier['username'],
                'message'         => 'Copy stopped',
            ];
        } finally {
            $ws->close();
        }
    }

    /**
     * List relationships for a trader, joined with copier usernames.
     */
    public function listRelationships(int $traderId): array {
        $stmt = $this->pdo->prepare("
          SELECT
            r.id,
            r.trader_id,
            r.copier_id,
            c.username AS copier_username,
            r.active,
            r.created_at
          FROM relationships r
          JOIN copiers c ON c.id = r.copier_id
          WHERE r.trader_id = ?
          ORDER BY r.created_at DESC
          LIMIT 500
        ");
        $stmt->execute([$traderId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /** ---- internals ---- */

    private function getTraderRow(int $traderId): array {
        $stmt = $this->pdo->prepare("SELECT id, username, token FROM traders WHERE id = ?");
        $stmt->execute([$traderId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Trader not found');

        $tok = trim((string)$row['token']);
        if ($tok === '') throw new RuntimeException('Trader token missing');

        // 🔐 Decrypt or lazy-upgrade plaintext -> encrypted, return plaintext
        $plain = \token_lazy_upgrade($this->pdo, 'traders', 'id', $traderId, $tok);
        $row['token'] = $plain;
        return $row;
    }

    private function getCopierRow(string $username): array {
        $stmt = $this->pdo->prepare("SELECT id, username, token FROM copiers WHERE username = ?");
        $stmt->execute([$username]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Copier not found');

        $tok = trim((string)$row['token']);
        if ($tok === '') throw new RuntimeException('Copier token missing');

        // 🔐 Decrypt or lazy-upgrade plaintext -> encrypted, return plaintext
        $plain = \token_lazy_upgrade($this->pdo, 'copiers', 'id', (int)$row['id'], $tok);
        $row['token'] = $plain;
        return $row;
    }

    /**
     * Insert or set active/inactive by (trader_id, copier_id).
     * relationships table should have:
     *   UNIQUE KEY uniq_trader_copier (trader_id, copier_id)
     */
    private function upsertRelationshipById(int $traderId, int $copierId, bool $active): void {
        $stmt = $this->pdo->prepare("
            INSERT INTO relationships (trader_id, copier_id, active, created_at)
            VALUES (?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE active = VALUES(active)
        ");
        $stmt->execute([$traderId, $copierId, $active ? 1 : 0]);
    }
}
