<?php
declare(strict_types=1);

namespace Denara;

use PDO;
use RuntimeException;

class MetricsService {
    private PDO $pdo;
    private int $appId;
    private int $pageSize = 100;
    private int $ttlSeconds = 300; // cache TTL: 5 minutes

    public function __construct(PDO $pdo, int $appId = 36300) {
        $this->pdo = $pdo;
        $this->appId = $appId;
    }

    /** Return Nairobi month-start (epoch sec) and now (epoch sec). */
    public function monthWindow(): array {
        // Africa/Nairobi is UTC+3 (no DST)
        $tz = new \DateTimeZone('Africa/Nairobi');
        $now = new \DateTime('now', $tz);
        $start = new \DateTime($now->format('Y-m-01 00:00:00'), $tz);
        return [ (int)floor($start->getTimestamp()), (int)floor($now->getTimestamp()) ];
    }

    /** Fetch or compute metrics for a trader for [from,to] (epoch sec). */
    public function getMetricsForTrader(int $traderId, int $from, int $to, bool $recompute = false): array {
        if (!$recompute) {
            $row = $this->pdo->prepare("SELECT * FROM trader_metrics WHERE trader_id=? AND period_start=? AND period_end=?");
            $row->execute([$traderId, $from, $to]);
            $cached = $row->fetch(PDO::FETCH_ASSOC);
            if ($cached && (time() - strtotime($cached['computed_at'])) <= $this->ttlSeconds) {
                return $this->serializeMetricsRow($cached);
            }
        }

        // Load trader + token (supports encrypted/legacy with lazy upgrade)
        $q = $this->pdo->prepare("SELECT id, username, token FROM traders WHERE id = ?");
        $q->execute([$traderId]);
        $t = $q->fetch(PDO::FETCH_ASSOC);
        if (!$t) throw new RuntimeException('Trader not found');

        $stored = trim((string)$t['token']);
        if ($stored === '') throw new RuntimeException('Trader token missing');

        // 🔐 Decrypt or lazily upgrade plaintext -> encrypted, return plaintext token
        $token = \token_lazy_upgrade($this->pdo, 'traders', 'id', (int)$t['id'], $stored);

        // Compute fresh via WS
        $computed = $this->computeWindow((int)$t['id'], $token, $from, $to);

        // Upsert cache
        $ins = $this->pdo->prepare("
          INSERT INTO trader_metrics
          (trader_id, period_start, period_end, currency, baseline_time, start_balance, end_balance, net_pl, trades, wins, win_rate, growth_pct, computed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            currency=VALUES(currency),
            baseline_time=VALUES(baseline_time),
            start_balance=VALUES(start_balance),
            end_balance=VALUES(end_balance),
            net_pl=VALUES(net_pl),
            trades=VALUES(trades),
            wins=VALUES(wins),
            win_rate=VALUES(win_rate),
            growth_pct=VALUES(growth_pct),
            computed_at=NOW()
        ");
        $ins->execute([
            $traderId, $from, $to,
            $computed['currency'],
            (int)floor($computed['baseline_time'] / 1000),
            $computed['start_balance'],
            $computed['end_balance'],
            $computed['net_pl'],
            $computed['trades'],
            $computed['wins'],
            $computed['win_rate'],
            $computed['growth_pct'],
        ]);

        return $computed;
    }

    /**
     * Compute metrics with baseline logic using Deriv WS.
     * Baseline = the **latest** cash-flow (deposit/withdrawal/transfer) in [from,to].
     * If none exist in the window, baseline = balance just before 'from'.
     */
    private function computeWindow(int $traderId, string $token, int $from, int $to): array {
        $ws = new DerivClient($this->appId);
        try {
            $auth = $ws->authorize($token);
            $acct = $auth['authorize'] ?? [];
            if (!isset($acct['loginid'])) throw new RuntimeException('Authorization failed');
            $currency = $acct['currency'] ?? 'USD';
            if ($currency !== 'USD') throw new RuntimeException("Non-USD ($currency)");

            $pageSize = $this->pageSize;

            $normalize = function($s) { return $s ? strtolower(str_replace('_', ' ', (string)$s)) : ''; };
            $isCashFlow = function(string $action) {
                return $action === 'deposit' || $action === 'withdrawal' || $action === 'transfer';
            };

            // Helper: last balance_before_or_at(epochSec)
            $balanceAtOrBefore = function(int $epochSec) use ($ws): ?float {
                $res = $ws->statement(['limit'=>1,'offset'=>0,'date_to'=>$epochSec,'description'=>0]);
                $tx = $res['statement']['transactions'][0] ?? null;
                if ($tx && isset($tx['balance_after'])) return (float)$tx['balance_after'];
                return null;
            };

            // --------------------------------------------------------------------------------
            // (1) Scan the window to find the **latest** cash-flow (max timestamp).
            // --------------------------------------------------------------------------------
            $latestCashMs = null;   // ms
            $latestCashBal = null;  // number|null

            $offset = 0;
            while (true) {
                $res = $ws->statement([
                    'limit'       => $pageSize,
                    'offset'      => $offset,
                    'date_from'   => $from,
                    'date_to'     => $to,
                    'description' => 0,
                ]);

                $list = $res['statement']['transactions'] ?? [];
                $count = count($list);
                if ($count === 0) break;

                foreach ($list as $t) {
                    $action = $normalize($t['action_type'] ?? '');
                    if ($isCashFlow($action)) {
                        $tsMs = (int)(($t['transaction_time'] ?? $t['time'] ?? 0) * 1000);
                        if ($latestCashMs === null || $tsMs > $latestCashMs) {
                            $latestCashMs = $tsMs;
                            $latestCashBal = isset($t['balance_after']) ? (float)$t['balance_after'] : null;
                        }
                    }
                }

                if ($count < $pageSize) break;
                $offset += $count;
            }

            // Derive baseline time/balance
            $baselineTimeMs = null;
            $baselineBal = null;

            if ($latestCashMs !== null) {
                // latest cash-flow inside window wins
                $baselineTimeMs = $latestCashMs;
                if ($latestCashBal !== null) {
                    $baselineBal = $latestCashBal;
                } else {
                    // fetch balance just after that cash-flow if not present on tx
                    $baselineBal = $balanceAtOrBefore((int)floor($baselineTimeMs/1000) + 1);
                }
            } else {
                // No cash-flows in window: baseline = balance before window start
                $prior = $ws->statement(['limit'=>1,'offset'=>0,'date_to'=>$from,'description'=>0]);
                $t0 = $prior['statement']['transactions'][0] ?? null;
                $baselineBal = isset($t0['balance_after']) ? (float)$t0['balance_after'] : null;
                $baselineTimeMs = (int)$from * 1000;
            }

            // --------------------------------------------------------------------------------
            // (2) End balance at 'to'
            // --------------------------------------------------------------------------------
            $endRes = $ws->statement(['limit'=>1,'offset'=>0,'date_to'=>$to,'description'=>0]);
            $txE = $endRes['statement']['transactions'][0] ?? null;
            $endBal = isset($txE['balance_after']) ? (float)$txE['balance_after'] : null;

            // --------------------------------------------------------------------------------
            // (3) Count trades + wins **after** baseline
            // --------------------------------------------------------------------------------
            $trades = 0;
            $wins   = 0;

            $offset2 = 0;
            while (true) {
                $res2 = $ws->statement([
                    'limit'       => $pageSize,
                    'offset'      => $offset2,
                    'date_from'   => (int)floor($baselineTimeMs/1000),
                    'date_to'     => $to,
                    'description' => 0,
                ]);

                $list2 = $res2['statement']['transactions'] ?? [];
                $count2 = count($list2);
                if ($count2 === 0) break;

                foreach ($list2 as $t) {
                    $tms = (int)(($t['transaction_time'] ?? $t['time'] ?? 0) * 1000);
                    if ($tms <= $baselineTimeMs) continue;
                    $action = $normalize($t['action_type'] ?? '');
                    if ($action === 'sell') {
                        $trades++;
                        $amt = isset($t['amount']) ? (float)$t['amount'] : 0.0;
                        if ($amt > 0) $wins++;
                    }
                }

                if ($count2 < $pageSize) break;
                $offset2 += $count2; // advance correctly
            }

            $netPL = (is_numeric($endBal) && is_numeric($baselineBal)) ? ($endBal - $baselineBal) : 0.0;
            $growth = (is_numeric($baselineBal) && $baselineBal > 0)
                ? ($netPL / $baselineBal) * 100.0
                : null;
            $winRate = $trades > 0 ? ($wins / $trades) * 100.0 : 0.0;

            return [
                'trader_id'     => $traderId,
                'currency'      => $currency,
                'baseline_time' => $baselineTimeMs,
                'start_balance' => $baselineBal,
                'end_balance'   => $endBal,
                'net_pl'        => $netPL,
                'trades'        => $trades,
                'wins'          => $wins,
                'win_rate'      => $winRate,
                'growth_pct'    => $growth,
                'period_start'  => $from,
                'period_end'    => $to,
            ];
        } finally {
            $ws->close();
        }
    }

    private function serializeMetricsRow(array $r): array {
        return [
            'trader_id'     => (int)$r['trader_id'],
            'currency'      => $r['currency'],
            'baseline_time' => (int)$r['baseline_time'] * 1000,
            'start_balance' => isset($r['start_balance']) ? (float)$r['start_balance'] : null,
            'end_balance'   => isset($r['end_balance']) ? (float)$r['end_balance'] : null,
            'net_pl'        => (float)$r['net_pl'],
            'trades'        => (int)$r['trades'],
            'wins'          => (int)$r['wins'],
            'win_rate'      => (float)$r['win_rate'],
            'growth_pct'    => isset($r['growth_pct']) ? (float)$r['growth_pct'] : null,
            'period_start'  => (int)$r['period_start'],
            'period_end'    => (int)$r['period_end'],
        ];
    }
}
