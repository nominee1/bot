<?php
// api/CopiersBalancesController.php
declare(strict_types=1);

namespace Denara;

use PDO;

class CopiersBalancesController {
    private PDO $pdo;
    private DerivClient $deriv;
    private int $ttlSeconds = 60; // APCu cache window per copier

    public function __construct(PDO $pdo, DerivClient $deriv) {
        $this->pdo   = $pdo;
        $this->deriv = $deriv;
    }

    /**
     * Return balances for a trader's copiers.
     * @param int  $traderId
     * @param bool $onlyActive  true => filter active=1, false => include all
     * @return array of rows: username, balance, currency, active, fetched_at (ms)
     */
    public function listBalances(int $traderId, bool $onlyActive = true): array {
        // 1) Get copier rows + encrypted tokens
        $sql = "SELECT r.copier_username, r.active, c.token
                  FROM relationships r
                  JOIN copiers c ON c.username = r.copier_username
                 WHERE r.trader_id = :tid" . ($onlyActive ? " AND r.active = 1" : "");
        $st = $this->pdo->prepare($sql);
        $st->execute([':tid' => $traderId]);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);

        $out = [];
        foreach ($rows as $row) {
            $username = (string)$row['copier_username'];
            $active   = (bool)$row['active'];
            $tokenEnc = (string)$row['token'];

            // 2) Decrypt/lazy-upgrade to plaintext token
            $tokenPlain = token_lazy_upgrade($this->pdo, 'copiers', 'username', $username, $tokenEnc);

            // 3) Optional APCu cache to avoid hitting rate limits
            $cacheKey = "cbal:{$username}";
            $cached = function_exists('apcu_fetch') ? apcu_fetch($cacheKey) : false;
            if ($cached && isset($cached['until']) && $cached['until'] >= time()) {
                $out[] = [
                    'username'   => $username,
                    'balance'    => $cached['balance'],
                    'currency'   => $cached['currency'],
                    'active'     => $active,
                    'fetched_at' => (int)($cached['fetched_at'] ?? (time() * 1000)),
                ];
                continue;
            }

            // 4) Live fetch via WS: authorize → balance
            $bal = null; $cur = null; $ts = (int)(microtime(true) * 1000);
            try {
                $info = $this->deriv->getBalanceForToken($tokenPlain); // ['balance'=>..., 'currency'=>...]
                $bal = $info['balance'] ?? null;
                $cur = $info['currency'] ?? null;
            } catch (\Throwable $e) {
                // Keep nulls if something fails; still include the row
            }

            $rowOut = [
                'username'   => $username,
                'balance'    => $bal,
                'currency'   => $cur,
                'active'     => $active,
                'fetched_at' => $ts,
            ];
            $out[] = $rowOut;

            if (function_exists('apcu_store')) {
                apcu_store($cacheKey, [
                    'balance'    => $rowOut['balance'],
                    'currency'   => $rowOut['currency'],
                    'fetched_at' => $rowOut['fetched_at'],
                    'until'      => time() + $this->ttlSeconds,
                ], $this->ttlSeconds);
            }

            // Gentle pacing (optional)
            usleep(80_000); // 80ms between copiers
        }

        return $out;
    }
}
