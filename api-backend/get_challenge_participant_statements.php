<?php
declare(strict_types=1);

/**
 * Statements + ranking-style metrics for one challenge participant.
 * - Virtual usernames (options_oracle, chance): rows from chance_virtual_statements in challenge window;
 *   metrics use the same model as ParticipantsLeaderboard buildOptionsOracleMetricsFromRows.
 * - options_oracle: JSON `source` is `deriv` (UI parity with Deriv traders); data is still the virtual ledger.
 * - chance: JSON `source` remains `virtual`.
 * - Everyone else: Deriv statements in challenge window + same metrics as computeWindowMetrics (challenge_ranking_lib).
 *
 * Throttling: short-lived file cache + MySQL GET_LOCK per (challenge_id, trader_id) to avoid Deriv stampedes.
 */

require_once __DIR__ . '/util.php';
require_once __DIR__ . '/statement_request_guard.php';
require_once __DIR__ . '/challenge_ranking_lib.php';
require_once __DIR__ . '/challenge_payout_lib.php';

cors();

if (method() !== 'GET') {
    fail('Method not allowed', 405);
}

try {
    $pdo = pdo();

    $challengeId = isset($_GET['challenge_id']) && is_numeric($_GET['challenge_id']) ? (int) $_GET['challenge_id'] : 0;
    $username = trim((string) ($_GET['username'] ?? ''));
    $limit = isset($_GET['limit']) ? max(1, min(1000, (int) $_GET['limit'])) : 400;

    if ($challengeId <= 0) {
        fail('challenge_id required');
    }
    if ($username === '') {
        fail('username required');
    }

    $stmt = $pdo->prepare('
        SELECT cp.trader_id
        FROM challenge_participants cp
        WHERE cp.challenge_id = ?
          AND LOWER(TRIM(cp.username)) = LOWER(TRIM(?))
          AND cp.join_status = \'joined\'
        LIMIT 1
    ');
    $stmt->execute([$challengeId, $username]);
    $part = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$part) {
        fail('Participant not found for this challenge', 404);
    }

    $traderId = (int) ($part['trader_id'] ?? 0);
    if ($traderId <= 0) {
        fail('Invalid participant', 400);
    }

    $chStmt = $pdo->prepare('SELECT * FROM challenges WHERE id = ? LIMIT 1');
    $chStmt->execute([$challengeId]);
    $challenge = $chStmt->fetch(PDO::FETCH_ASSOC);

    if (!$challenge) {
        fail('Challenge not found', 404);
    }

    $startMs = denara_challenge_datetime_to_ms((string) $challenge['start_time']);
    $endMs = denara_challenge_datetime_to_ms((string) $challenge['end_time']);
    $tStart = (int) floor($startMs / 1000);
    $tEnd = (int) floor($endMs / 1000);
    $minRankBal = denara_challenge_min_rank_balance($challenge);

    $branch = denara_rank_is_virtual_statement_username($username) ? 'virtual' : 'deriv';
    $cacheKey = denara_stmt_cache_key($challengeId, $traderId, $startMs, $endMs, $minRankBal, $limit, $branch);

    $minRankBalUsd = round($minRankBal, 2);

    $cachedFast = denara_stmt_cache_get($cacheKey);
    if ($cachedFast !== null) {
        header('X-Denara-Stmt-Cache: HIT');
        json(array_merge($cachedFast, [
            'cached' => true,
            'min_rank_balance_usd' => $minRankBalUsd,
        ]));
    }

    $lockName = denara_stmt_lock_name($challengeId, $traderId);
    if (!denara_stmt_lock_acquire($pdo, $lockName)) {
        header('Retry-After: 5');
        fail(
            'Statements are being refreshed for this participant. Please try again in a few seconds.',
            429
        );
    }

    try {
        $cachedAfterWait = denara_stmt_cache_get($cacheKey);
        if ($cachedAfterWait !== null) {
            denara_stmt_lock_release($pdo, $lockName);
            header('X-Denara-Stmt-Cache: HIT');
            json(array_merge($cachedAfterWait, [
                'cached' => true,
                'min_rank_balance_usd' => $minRankBalUsd,
            ]));
        }

        if ($branch === 'virtual') {
            $vStmt = $pdo->prepare('
                SELECT
                    id,
                    username,
                    transaction_time,
                    action_type,
                    reference_id,
                    reference_type,
                    amount,
                    balance_after
                FROM chance_virtual_statements
                WHERE LOWER(TRIM(username)) = LOWER(TRIM(?))
                  AND transaction_time >= ?
                  AND transaction_time <= ?
                ORDER BY transaction_time DESC, id DESC
                LIMIT ?
            ');
            $vStmt->bindValue(1, $username, PDO::PARAM_STR);
            $vStmt->bindValue(2, $tStart, PDO::PARAM_INT);
            $vStmt->bindValue(3, $tEnd, PDO::PARAM_INT);
            $vStmt->bindValue(4, $limit, PDO::PARAM_INT);
            $vStmt->execute();
            $dbRows = $vStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

            $metrics = denara_virtual_oracle_window_metrics($dbRows, $startMs, $endMs, $minRankBal);
            [$returnPct, $isRankEligible, $reason] = denara_rank_return_pct_and_eligibility($metrics, $minRankBal);

            $statements = [];
            foreach ($dbRows as $r) {
                $sec = isset($r['transaction_time']) ? (int) $r['transaction_time'] : 0;
                $iso = (new DateTimeImmutable('@' . $sec, new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM);
                $statements[] = [
                    'id' => isset($r['id']) ? (string) $r['id'] : $sec . '-' . ($r['action_type'] ?? ''),
                    'time' => $iso,
                    'action_type' => (string) ($r['action_type'] ?? ''),
                    'reference_id' => (string) ($r['reference_id'] ?? ''),
                    'contract_type' => trim((string) ($r['reference_type'] ?? '')) !== ''
                        ? (string) $r['reference_type']
                        : '-',
                    'amount' => isset($r['amount']) ? (float) $r['amount'] : 0.0,
                    'balance_after' => isset($r['balance_after']) ? round((float) $r['balance_after'], 2) : 0.0,
                ];
            }

            $out = [
                'ok' => true,
                'source' => denara_stmt_display_source_for_virtual_username($username),
                'challenge_id' => $challengeId,
                'username' => $username,
                'min_rank_balance_usd' => $minRankBalUsd,
                'statements' => $statements,
                'metrics' => $metrics,
                'rank' => [
                    'return_pct' => $returnPct,
                    'is_rank_eligible' => $isRankEligible,
                    'reason' => $reason,
                ],
            ];
            denara_stmt_cache_set($cacheKey, $out);
            denara_stmt_lock_release($pdo, $lockName);
            header('X-Denara-Stmt-Cache: MISS');
            json($out);
        }

        [$plain] = denara_trader_plain_token($pdo, $traderId);

        $ws = new \Denara\DerivClient(CHALLENGE_RANK_DERIV_APP_ID, CHALLENGE_RANK_WS_ENDPOINT);
        try {
            $auth = $ws->authorize($plain);
            $acct = $auth['authorize'] ?? null;
            if (!is_array($acct) || empty($acct['loginid'])) {
                throw new RuntimeException('Authorization failed');
            }
            $currency = strtoupper((string) ($acct['currency'] ?? 'USD'));
            if ($currency !== 'USD') {
                throw new RuntimeException('Non-USD (' . $currency . ')');
            }

            $analysis = denara_rank_statement_window_analysis($ws, $startMs, $endMs, $minRankBal);
            $metrics = $analysis['metrics'];
            [$returnPct, $isRankEligible, $reason] = denara_rank_return_pct_and_eligibility($metrics, $minRankBal);

            $statements = denara_rank_format_display_rows_challenge_window(
                $analysis['all_rows_asc'],
                $startMs,
                $endMs
            );
        } finally {
            $ws->close();
        }

        $out = [
            'ok' => true,
            'source' => 'deriv',
            'challenge_id' => $challengeId,
            'username' => $username,
            'min_rank_balance_usd' => $minRankBalUsd,
            'statements' => $statements,
            'metrics' => $metrics,
            'rank' => [
                'return_pct' => $returnPct,
                'is_rank_eligible' => $isRankEligible,
                'reason' => $reason,
            ],
        ];
        denara_stmt_cache_set($cacheKey, $out);
        denara_stmt_lock_release($pdo, $lockName);
        header('X-Denara-Stmt-Cache: MISS');
        json($out);
    } finally {
        denara_stmt_lock_release($pdo, $lockName);
    }
} catch (Throwable $e) {
    fail($e->getMessage(), 400);
}
