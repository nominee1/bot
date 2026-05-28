<?php
declare(strict_types=1);

/**
 * Per-challenge statement ranking (mirrors ParticipantsLeaderboard.tsx computeWindowMetrics + eligibility).
 * Uses challenge start_time / end_time as the ranking window (not global tournament dates).
 * Runs before payouts so winner_trader_id is set for multi-participant paid challenges.
 */

require_once __DIR__ . '/DerivClient.php';
require_once __DIR__ . '/challenge_payout_lib.php';

const CHALLENGE_RANK_DERIV_APP_ID = 36300;
const CHALLENGE_RANK_PAGE_SIZE = 100;
/** Default when challenge row has no usable minimum_balance. */
const CHALLENGE_RANK_MIN_START_BALANCE = 10.0;
const CHALLENGE_RANK_WS_ENDPOINT = 'wss://ws.derivws.com/websockets/v3';

/**
 * Minimum account balance used for baseline promotion and rank eligibility (matches challenge registration).
 *
 * @param array<string,mixed> $challenge Row from challenges (expects minimum_balance).
 */
function denara_challenge_min_rank_balance(array $challenge): float {
    $v = $challenge['minimum_balance'] ?? null;
    if ($v !== null && is_numeric($v) && (float) $v > 0) {
        return (float) $v;
    }

    return CHALLENGE_RANK_MIN_START_BALANCE;
}

function denara_rank_normalize_action(?string $actionType): string {
    $s = $actionType !== null ? str_replace('_', ' ', strtolower($actionType)) : '';

    return $s;
}

/**
 * One "closed trade" for rank eligibility: exact sell, Deriv variants (e.g. sell contract), or binary settlement rows.
 * Registration "checks" are separate; ranking still needs a completed trade in the window per statement data.
 */
function denara_rank_action_counts_as_closed_trade(string $normalizedAction): bool {
    if ($normalizedAction === '') {
        return false;
    }
    if ($normalizedAction === 'sell') {
        return true;
    }
    $parts = preg_split('/\s+/', $normalizedAction);
    if (isset($parts[0]) && $parts[0] === 'sell') {
        return true;
    }

    return in_array($normalizedAction, ['won', 'lost', 'expiry', 'expired'], true);
}

function denara_rank_tx_ms(array $tx): int {
    $t = $tx['transaction_time'] ?? $tx['time'] ?? 0;

    return (int) round(((is_numeric($t) ? (float) $t : 0.0)) * 1000.0);
}

function denara_rank_calc_turnover(array $tx): float {
    $action = denara_rank_normalize_action(isset($tx['action_type']) ? (string) $tx['action_type'] : null);
    $amt = isset($tx['amount']) && is_numeric($tx['amount']) ? (float) $tx['amount'] : 0.0;
    $parts = preg_split('/\s+/', $action);
    $head = $parts[0] ?? '';
    if ($head === 'buy' || $head === 'sell') {
        return abs($amt);
    }

    return 0.0;
}

function denara_rank_balance_after(array $tx): ?float {
    if (isset($tx['balance_after']) && is_numeric($tx['balance_after'])) {
        return (float) $tx['balance_after'];
    }
    if (isset($tx['balance']) && is_numeric($tx['balance'])) {
        return (float) $tx['balance'];
    }

    return null;
}

function denara_rank_clamp_window(int $ms, int $winStartMs, int $winEndMs): int {
    return min(max($ms, $winStartMs), $winEndMs);
}

/**
 * @param array<int, array<string,mixed>> $rowsAsc
 * @return array{baselineTime:int,baselineBal:float|null}
 */
function denara_rank_promote_baseline_to_min_balance(
    array $rowsAsc,
    int $currentBaselineTime,
    ?float $currentBaselineBal,
    float $minBalance
): array {
    if ($currentBaselineBal !== null && $currentBaselineBal >= $minBalance) {
        return [
            'baselineTime' => $currentBaselineTime,
            'baselineBal' => round($currentBaselineBal, 2),
        ];
    }

    foreach ($rowsAsc as $tx) {
        $tms = denara_rank_tx_ms($tx);
        if ($tms < $currentBaselineTime) {
            continue;
        }
        $bal = denara_rank_balance_after($tx);
        if ($bal !== null && $bal >= $minBalance) {
            return [
                'baselineTime' => $tms,
                'baselineBal' => round($bal, 2),
            ];
        }
    }

    return [
        'baselineTime' => $currentBaselineTime,
        'baselineBal' => $currentBaselineBal !== null ? round($currentBaselineBal, 2) : null,
    ];
}

/**
 * @param array<string,mixed> $stmtResp full WS response
 * @return array<int, array<string,mixed>>
 */
function denara_rank_statement_transactions(array $stmtResp): array {
    $list = $stmtResp['statement']['transactions'] ?? null;

    return is_array($list) ? $list : [];
}

/**
 * Full Deriv statement window analysis: metrics (same as leaderboard computeWindowMetrics for the window)
 * plus raw rows for API display.
 *
 * @return array{
 *   metrics: array{baselineTime:int,baselineBal:float|null,netPL:float,trades:int,endBal:float|null,currency:string,turnover:float},
 *   all_rows_asc: array<int, array<string,mixed>>,
 *   segment_baseline_time: int,
 *   segment_end_time: int,
 *   start_clamped: int,
 *   end_clamped: int
 * }
 */
function denara_rank_statement_window_analysis(
    \Denara\DerivClient $client,
    int $startMs,
    int $endMs,
    float $minBaselineBalance = CHALLENGE_RANK_MIN_START_BALANCE
): array {
    $startClamped = denara_rank_clamp_window($startMs, $startMs, $endMs);
    $endClamped = denara_rank_clamp_window($endMs, $startMs, $endMs);

    $fetchBalanceAfterAtOrBefore = static function (int $epochSec) use ($client): ?float {
        $res = $client->statement([
            'limit' => 1,
            'offset' => 0,
            'date_to' => $epochSec,
        ]);
        $txs = denara_rank_statement_transactions($res);
        $tx = $txs[0] ?? null;

        return is_array($tx) ? denara_rank_balance_after($tx) : null;
    };

    $baselineTime = null;
    $baselineBal = null;
    $allRowsAsc = [];

    $off = 0;
    $hasMorePage = true;

    while ($hasMorePage) {
        $res = $client->statement([
            'limit' => CHALLENGE_RANK_PAGE_SIZE,
            'offset' => $off,
            'date_from' => (int) floor($startClamped / 1000),
            'date_to' => (int) floor($endClamped / 1000),
        ]);

        $list = denara_rank_statement_transactions($res);
        $ascList = $list;
        usort($ascList, static function (array $a, array $b): int {
            return denara_rank_tx_ms($a) <=> denara_rank_tx_ms($b);
        });
        foreach ($ascList as $t) {
            $allRowsAsc[] = $t;
        }

        $count = count($list);
        $hasMorePage = $count === CHALLENGE_RANK_PAGE_SIZE;
        $off += $count;

        if ($baselineTime === null) {
            foreach ($ascList as $t) {
                $action = denara_rank_normalize_action(isset($t['action_type']) ? (string) $t['action_type'] : null);
                $tms = denara_rank_tx_ms($t);
                if ($action === 'deposit' || $action === 'withdrawal' || $action === 'transfer') {
                    $baselineTime = $tms;
                    $bb = denara_rank_balance_after($t);
                    if ($bb !== null) {
                        $baselineBal = $bb;
                    } else {
                        $baselineBal = $fetchBalanceAfterAtOrBefore((int) floor($tms / 1000) + 1);
                    }
                    break;
                }
            }
        }
    }

    usort($allRowsAsc, static function (array $a, array $b): int {
        return denara_rank_tx_ms($a) <=> denara_rank_tx_ms($b);
    });

    if ($baselineTime === null) {
        $rs = $client->statement([
            'limit' => 1,
            'offset' => 0,
            'date_to' => (int) floor($startClamped / 1000),
        ]);
        $txs = denara_rank_statement_transactions($rs);
        $t0 = $txs[0] ?? null;
        $baselineBal = is_array($t0) ? denara_rank_balance_after($t0) : null;
        $baselineTime = $startClamped;
    }

    $segmentBaselineTime = $baselineTime;
    $segmentBaselineBal = $baselineBal;

    foreach ($allRowsAsc as $t) {
        $tms = denara_rank_tx_ms($t);
        if ($tms <= $segmentBaselineTime) {
            continue;
        }
        $action = denara_rank_normalize_action(isset($t['action_type']) ? (string) $t['action_type'] : null);
        if ($action === 'deposit' || $action === 'withdrawal' || $action === 'transfer') {
            $segmentBaselineTime = $tms;
            $bal = denara_rank_balance_after($t);
            $segmentBaselineBal = $bal !== null ? $bal : $fetchBalanceAfterAtOrBefore((int) floor($tms / 1000) + 1);
        }
    }

    $promoted = denara_rank_promote_baseline_to_min_balance(
        $allRowsAsc,
        $segmentBaselineTime,
        $segmentBaselineBal,
        $minBaselineBalance
    );
    $segmentBaselineTime = $promoted['baselineTime'];
    $segmentBaselineBal = $promoted['baselineBal'];

    $segmentEndTime = $endClamped;
    foreach ($allRowsAsc as $t) {
        $tms = denara_rank_tx_ms($t);
        if ($tms <= $segmentBaselineTime) {
            continue;
        }
        $action = denara_rank_normalize_action(isset($t['action_type']) ? (string) $t['action_type'] : null);
        if ($action === 'deposit' || $action === 'withdrawal' || $action === 'transfer') {
            $segmentEndTime = $tms;
            break;
        }
    }

    $closedTrades = 0;
    $turnover = 0.0;
    foreach ($allRowsAsc as $t) {
        $tms = denara_rank_tx_ms($t);
        if ($tms <= $segmentBaselineTime) {
            continue;
        }
        if ($tms > $segmentEndTime) {
            break;
        }
        $action = denara_rank_normalize_action(isset($t['action_type']) ? (string) $t['action_type'] : null);
        if ($action === 'deposit' || $action === 'withdrawal' || $action === 'transfer') {
            break;
        }
        if (denara_rank_action_counts_as_closed_trade($action)) {
            $closedTrades++;
        }
        $turnover += denara_rank_calc_turnover($t);
    }

    $endBal = null;
    try {
        $resEnd = $client->statement([
            'limit' => 1,
            'offset' => 0,
            'date_to' => (int) floor($segmentEndTime / 1000),
        ]);
        $txsE = denara_rank_statement_transactions($resEnd);
        $txE = $txsE[0] ?? null;
        $endBal = is_array($txE) ? denara_rank_balance_after($txE) : null;
    } catch (Throwable $e) {
        // same as TS empty catch
    }

    $netPL = 0.0;
    if ($endBal !== null && $segmentBaselineBal !== null) {
        $netPL = round($endBal - $segmentBaselineBal, 2);
    }

    $metrics = [
        'baselineTime' => $segmentBaselineTime,
        'baselineBal' => $segmentBaselineBal !== null ? round($segmentBaselineBal, 2) : null,
        'netPL' => $netPL,
        'trades' => $closedTrades,
        'endBal' => $endBal !== null ? round($endBal, 2) : null,
        'currency' => 'USD',
        'turnover' => round($turnover, 2),
    ];

    return [
        'metrics' => $metrics,
        'all_rows_asc' => $allRowsAsc,
        'segment_baseline_time' => $segmentBaselineTime,
        'segment_end_time' => $segmentEndTime,
        'start_clamped' => $startClamped,
        'end_clamped' => $endClamped,
    ];
}

/**
 * @return array{baselineTime:int,baselineBal:float|null,netPL:float,trades:int,endBal:float|null,currency:string,turnover:float}
 */
function denara_rank_compute_window_metrics(
    \Denara\DerivClient $client,
    string $_username,
    int $startMs,
    int $endMs,
    float $minBaselineBalance = CHALLENGE_RANK_MIN_START_BALANCE
): array {
    return denara_rank_statement_window_analysis($client, $startMs, $endMs, $minBaselineBalance)['metrics'];
}

/** Matches ParticipantsLeaderboard buildOptionsOracleMetricsFromRows (virtual ledger / buy-sell only). */
function denara_virtual_oracle_window_metrics(
    array $dbRows,
    int $startMs,
    int $endMs,
    float $minBaselineBalance = CHALLENGE_RANK_MIN_START_BALANCE
): array {
    $txs = [];
    foreach ($dbRows as $r) {
        if (!is_array($r)) {
            continue;
        }
        $ts = isset($r['transaction_time']) ? (int) $r['transaction_time'] : 0;
        $txs[] = [
            'transaction_time' => $ts,
            'action_type' => (string) ($r['action_type'] ?? ''),
            'amount' => isset($r['amount']) ? (float) $r['amount'] : 0.0,
            'balance_after' => isset($r['balance_after']) && is_numeric($r['balance_after']) ? (float) $r['balance_after'] : null,
        ];
    }

    $startC = denara_rank_clamp_window($startMs, $startMs, $endMs);
    $endC = denara_rank_clamp_window($endMs, $startMs, $endMs);

    $filtered = array_values(array_filter(
        $txs,
        static function (array $t) use ($startC, $endC): bool {
            $m = denara_rank_tx_ms($t);

            return $m >= $startC && $m <= $endC;
        }
    ));
    usort($filtered, static function (array $a, array $b): int {
        return denara_rank_tx_ms($a) <=> denara_rank_tx_ms($b);
    });

    if ($filtered === []) {
        return [
            'baselineTime' => $startC,
            'baselineBal' => null,
            'netPL' => 0.0,
            'trades' => 0,
            'endBal' => null,
            'currency' => 'USD',
            'turnover' => 0.0,
        ];
    }

    $first = $filtered[0];
    $last = $filtered[count($filtered) - 1];

    $baselineTime = denara_rank_tx_ms($first);
    $firstBal = denara_rank_balance_after($first);
    $firstAmt = isset($first['amount']) && is_numeric($first['amount']) ? (float) $first['amount'] : 0.0;
    $firstAction = denara_rank_normalize_action(isset($first['action_type']) ? (string) $first['action_type'] : null);

    $baselineBal = null;
    if ($firstBal !== null) {
        $baselineBal = $firstAction === 'buy'
            ? round($firstBal - $firstAmt, 2)
            : round($firstBal, 2);
    }

    $promoted = denara_rank_promote_baseline_to_min_balance(
        $filtered,
        $baselineTime,
        $baselineBal,
        $minBaselineBalance
    );
    $baselineTime = $promoted['baselineTime'];
    $baselineBal = $promoted['baselineBal'];

    $trades = 0;
    $turnover = 0.0;
    foreach ($filtered as $tx) {
        $tms = denara_rank_tx_ms($tx);
        if ($tms <= $baselineTime) {
            continue;
        }
        $action = denara_rank_normalize_action(isset($tx['action_type']) ? (string) $tx['action_type'] : null);
        if (denara_rank_action_counts_as_closed_trade($action)) {
            $trades++;
        }
        $turnover += denara_rank_calc_turnover($tx);
    }

    $endBal = denara_rank_balance_after($last);
    $endBal = $endBal !== null ? round($endBal, 2) : null;

    $netPL = 0.0;
    if ($endBal !== null && $baselineBal !== null) {
        $netPL = round($endBal - $baselineBal, 2);
    }

    return [
        'baselineTime' => $baselineTime,
        'baselineBal' => $baselineBal,
        'netPL' => $netPL,
        'trades' => $trades,
        'endBal' => $endBal,
        'currency' => 'USD',
        'turnover' => round($turnover, 2),
    ];
}

/**
 * Deriv statement rows in challenge window, newest first, shaped for JSON / ongoing UI.
 *
 * @param array<int, array<string,mixed>> $allRowsAsc
 * @return array<int, array<string, mixed>>
 */
function denara_rank_format_display_rows_challenge_window(array $allRowsAsc, int $windowStartMs, int $windowEndMs): array {
    $filtered = [];
    foreach ($allRowsAsc as $tx) {
        $tms = denara_rank_tx_ms($tx);
        if ($tms < $windowStartMs || $tms > $windowEndMs) {
            continue;
        }
        $filtered[] = $tx;
    }

    usort($filtered, static function (array $a, array $b): int {
        return denara_rank_tx_ms($b) <=> denara_rank_tx_ms($a);
    });

    $out = [];
    foreach ($filtered as $tx) {
        $tms = denara_rank_tx_ms($tx);
        $sec = (int) floor($tms / 1000);
        $iso = (new DateTimeImmutable('@' . $sec, new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM);

        $idRaw = $tx['id'] ?? $tx['transaction_id'] ?? $tx['contract_id'] ?? null;
        $idStr = $idRaw !== null && $idRaw !== '' ? (string) $idRaw : $sec . '-' . ($tx['action_type'] ?? '');

        $ref = (string) ($tx['reference_id'] ?? '');
        $ctype = (string) ($tx['contract_type'] ?? $tx['shortcode'] ?? $tx['reference_type'] ?? '-');
        $amt = isset($tx['amount']) && is_numeric($tx['amount']) ? (float) $tx['amount'] : 0.0;
        $bal = denara_rank_balance_after($tx);

        $out[] = [
            'id' => $idStr,
            'time' => $iso,
            'action_type' => (string) ($tx['action_type'] ?? ''),
            'reference_id' => $ref,
            'contract_type' => $ctype !== '' ? $ctype : '-',
            'amount' => $amt,
            'balance_after' => $bal !== null ? round($bal, 2) : 0.0,
        ];
    }

    return $out;
}

function denara_rank_is_virtual_statement_username(string $username): bool {
    $n = strtolower(preg_replace('/_+/', ' ', trim($username)));

    return $n === 'options oracle' || $n === 'chance';
}

/**
 * Statements for options_oracle still come from chance_virtual_statements; UI shows the same source chip as Deriv traders.
 *
 * @return 'deriv'|'virtual'
 */
function denara_stmt_display_source_for_virtual_username(string $username): string
{
    $n = strtolower(preg_replace('/_+/', ' ', trim($username)));

    return $n === 'options oracle' ? 'deriv' : 'virtual';
}

function denara_challenge_datetime_to_ms(string $mysqlUtcDatetime): int {
    $dt = new DateTimeImmutable($mysqlUtcDatetime, new DateTimeZone('UTC'));

    return (int) ($dt->format('U') * 1000);
}

/**
 * @return array{0: ?float, 1: bool, 2: string|null}
 */
function denara_rank_return_pct_and_eligibility(array $metrics, float $minQualifyingBalance): array {
    $baselineBal = $metrics['baselineBal'] ?? null;
    $trades = (int) ($metrics['trades'] ?? 0);
    $netPL = (float) ($metrics['netPL'] ?? 0.0);

    $isRankEligible = $baselineBal !== null && is_numeric($baselineBal)
        && (float) $baselineBal >= $minQualifyingBalance && $trades > 0;

    $returnPct = null;
    if ($isRankEligible && is_numeric($baselineBal) && (float) $baselineBal > 0) {
        $returnPct = round(($netPL / (float) $baselineBal) * 100.0, 6);
    }

    $minStr = number_format($minQualifyingBalance, 2, '.', '');
    $reason = null;
    if (!$isRankEligible) {
        if ($baselineBal === null || ! is_numeric($baselineBal)) {
            $reason = 'Could not establish a baseline balance from your Deriv statements in this challenge window.';
        } elseif ((float) $baselineBal < $minQualifyingBalance) {
            $reason = sprintf(
                'Baseline balance %.2f USD is below the minimum %s USD required for ranking (challenge rule).',
                (float) $baselineBal,
                $minStr
            );
        } elseif ($trades <= 0) {
            $reason = 'At least one closed trade is required for ranking — Deriv must show a completed trade '
                . '(e.g. sell / settlement such as won or lost) in the segment after your baseline. '
                . 'Open positions alone do not count.';
        } else {
            $reason = 'Minimum qualifying balance for ranking is ' . $minStr . ' USD and at least one closed trade.';
        }
    }

    return [$returnPct, $isRankEligible, $reason];
}

/**
 * Exactly one joined participant: they are the provisional winner; compute return % when Deriv metrics succeed.
 */
function denara_rank_finalize_solo_participant(
    PDO $pdo,
    int $challengeId,
    array $challenge,
    array $participantRow,
    int $startMs,
    int $endMs
): void {
    $traderId = (int) $participantRow['trader_id'];
    $username = (string) $participantRow['username'];
    $minRankBal = denara_challenge_min_rank_balance($challenge);

    $entry = [
        'trader_id' => $traderId,
        'username' => $username,
        'join_order' => 1,
        'status' => 'ok',
        'error' => null,
        'metrics' => null,
        'return_pct' => null,
        'is_rank_eligible' => false,
        'reason' => null,
    ];

    $winnerReturnPct = null;

    try {
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

            $metrics = denara_rank_compute_window_metrics($ws, $username, $startMs, $endMs, $minRankBal);
            [$returnPct, $isEligible, $reason] = denara_rank_return_pct_and_eligibility($metrics, $minRankBal);

            $entry['metrics'] = $metrics;
            $entry['return_pct'] = $returnPct;
            $entry['is_rank_eligible'] = $isEligible;
            $entry['reason'] = $reason;
            $winnerReturnPct = $returnPct;
        } finally {
            $ws->close();
        }
    } catch (Throwable $e) {
        $msg = $e->getMessage();
        if (str_starts_with($msg, 'Non-USD')) {
            $entry['status'] = 'skip';
        } else {
            $entry['status'] = 'error';
        }
        $entry['error'] = $msg;
    }

    $payload = [
        'challenge_id' => $challengeId,
        'solo' => true,
        'window' => ['start_ms' => $startMs, 'end_ms' => $endMs],
        'participants' => [$entry],
        'winner' => [
            'trader_id' => $traderId,
            'username' => $username,
            'return_pct' => $winnerReturnPct,
        ],
    ];

    $upd = $pdo->prepare('
        UPDATE challenges
        SET ranking_status = \'done\',
            ranking_json = ?,
            ranking_computed_at = UTC_TIMESTAMP(),
            ranking_last_error = NULL,
            winner_trader_id = ?,
            winner_username = ?,
            winner_return_pct = ?,
            updated_at = UTC_TIMESTAMP()
        WHERE id = ?
          AND ranking_status = \'processing\'
    ');
    $upd->execute([
        json_encode($payload, JSON_UNESCAPED_SLASHES),
        $traderId,
        $username,
        $winnerReturnPct,
        $challengeId,
    ]);
}

function denara_try_rank_one_challenge(PDO $pdo, array $challenge): void {
    $challengeId = (int) $challenge['id'];
    $participantCount = (int) ($challenge['participant_count'] ?? 0);
    $winnerPreset = $challenge['winner_trader_id'] ?? null;
    if ($winnerPreset !== null && $winnerPreset !== '' && (int) $winnerPreset > 0) {
        $u = $pdo->prepare('
            UPDATE challenges
            SET ranking_status = ?,
                ranking_computed_at = UTC_TIMESTAMP(),
                ranking_last_error = NULL,
                updated_at = UTC_TIMESTAMP()
            WHERE id = ?
              AND (ranking_status IS NULL OR ranking_status IN (\'pending\', \'failed\'))
        ');
        $u->execute(['skipped', $challengeId]);

        return;
    }

    if ($participantCount === 0) {
        $u = $pdo->prepare('
            UPDATE challenges
            SET ranking_status = ?,
                ranking_computed_at = UTC_TIMESTAMP(),
                ranking_json = ?,
                ranking_last_error = NULL,
                updated_at = UTC_TIMESTAMP()
            WHERE id = ?
              AND (ranking_status IS NULL OR ranking_status IN (\'pending\', \'failed\'))
        ');
        $u->execute([
            'skipped',
            json_encode(['note' => 'no_participants', 'participant_count' => 0], JSON_UNESCAPED_SLASHES),
            $challengeId,
        ]);

        return;
    }

    $claim = $pdo->prepare('
        UPDATE challenges
        SET ranking_status = \'processing\',
            ranking_last_error = NULL,
            updated_at = UTC_TIMESTAMP()
        WHERE id = ?
          AND (ranking_status IS NULL OR ranking_status IN (\'pending\', \'failed\'))
    ');
    $claim->execute([$challengeId]);
    if ($claim->rowCount() === 0) {
        return;
    }

    $startMs = denara_challenge_datetime_to_ms((string) $challenge['start_time']);
    $endMs = denara_challenge_datetime_to_ms((string) $challenge['end_time']);

    $tbl = defined('CHALLENGE_TRADERS_TABLE') ? CHALLENGE_TRADERS_TABLE : 'traders_competition_2';
    $stmt = $pdo->prepare("
        SELECT cp.trader_id, cp.username, cp.joined_at, cp.id AS cp_id
        FROM challenge_participants cp
        INNER JOIN `{$tbl}` t ON t.id = cp.trader_id
        WHERE cp.challenge_id = ?
          AND cp.join_status = 'joined'
        ORDER BY cp.joined_at ASC, cp.id ASC
    ");
    $stmt->execute([$challengeId]);
    $participants = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $joinedCount = count($participants);

    if ($joinedCount === 0) {
        $fin = $pdo->prepare('
            UPDATE challenges
            SET ranking_status = \'skipped\',
                ranking_json = ?,
                ranking_computed_at = UTC_TIMESTAMP(),
                updated_at = UTC_TIMESTAMP()
            WHERE id = ? AND ranking_status = \'processing\'
        ');
        $fin->execute([
            json_encode(['note' => 'no_joined_participant_rows'], JSON_UNESCAPED_SLASHES),
            $challengeId,
        ]);

        return;
    }

    if ($joinedCount === 1) {
        denara_rank_finalize_solo_participant(
            $pdo,
            $challengeId,
            $challenge,
            $participants[0],
            $startMs,
            $endMs
        );

        return;
    }

    $rowsOut = [];
    $eligibleForWinner = [];
    $order = 0;
    $minRankBal = denara_challenge_min_rank_balance($challenge);

    foreach ($participants as $p) {
        $order++;
        $traderId = (int) $p['trader_id'];
        $username = (string) $p['username'];
        $entry = [
            'trader_id' => $traderId,
            'username' => $username,
            'join_order' => $order,
            'status' => 'ok',
            'error' => null,
            'metrics' => null,
            'return_pct' => null,
            'is_rank_eligible' => false,
            'reason' => null,
        ];

        try {
            [$plain] = denara_trader_plain_token($pdo, $traderId);
        } catch (Throwable $e) {
            $entry['status'] = 'error';
            $entry['error'] = $e->getMessage();
            $rowsOut[] = $entry;

            continue;
        }

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

            $metrics = denara_rank_compute_window_metrics($ws, $username, $startMs, $endMs, $minRankBal);
            [$returnPct, $isEligible, $reason] = denara_rank_return_pct_and_eligibility($metrics, $minRankBal);

            $entry['metrics'] = $metrics;
            $entry['return_pct'] = $returnPct;
            $entry['is_rank_eligible'] = $isEligible;
            $entry['reason'] = $reason;

            if ($isEligible && $returnPct !== null) {
                $eligibleForWinner[] = [
                    'trader_id' => $traderId,
                    'username' => $username,
                    'return_pct' => $returnPct,
                    'net_pl' => (float) ($metrics['netPL'] ?? 0.0),
                    'join_order' => $order,
                ];
            }
        } catch (Throwable $e) {
            $msg = $e->getMessage();
            if (str_starts_with($msg, 'Non-USD')) {
                $entry['status'] = 'skip';
                $entry['error'] = $msg;
            } else {
                $entry['status'] = 'error';
                $entry['error'] = $msg;
            }
        } finally {
            $ws->close();
        }

        $rowsOut[] = $entry;
    }

    usort($eligibleForWinner, static function (array $a, array $b): int {
        $c = ($b['return_pct'] <=> $a['return_pct']);
        if ($c !== 0) {
            return $c;
        }
        $c = ($b['net_pl'] <=> $a['net_pl']);
        if ($c !== 0) {
            return $c;
        }

        return $a['join_order'] <=> $b['join_order'];
    });

    $top = $eligibleForWinner[0] ?? null;
    $winnerTraderId = $top['trader_id'] ?? null;
    $winnerUsername = $top['username'] ?? null;
    $winnerReturnPct = $top['return_pct'] ?? null;

    $payload = [
        'challenge_id' => $challengeId,
        'window' => ['start_ms' => $startMs, 'end_ms' => $endMs],
        'participants' => $rowsOut,
        'winner' => $top,
    ];

    $upd = $pdo->prepare('
        UPDATE challenges
        SET ranking_status = \'done\',
            ranking_json = ?,
            ranking_computed_at = UTC_TIMESTAMP(),
            ranking_last_error = NULL,
            winner_trader_id = ?,
            winner_username = ?,
            winner_return_pct = ?,
            updated_at = UTC_TIMESTAMP()
        WHERE id = ?
          AND ranking_status = \'processing\'
    ');
    $upd->execute([
        json_encode($payload, JSON_UNESCAPED_SLASHES),
        $winnerTraderId,
        $winnerUsername,
        $winnerReturnPct,
        $challengeId,
    ]);
}

function denara_rank_mark_failed(PDO $pdo, int $challengeId, string $message): void {
    error_log('[challenge_ranking] challenge ' . $challengeId . ' failed: ' . $message);
    try {
        $stmt = $pdo->prepare('
            UPDATE challenges
            SET ranking_status = \'failed\',
                ranking_last_error = ?,
                updated_at = UTC_TIMESTAMP()
            WHERE id = ?
              AND ranking_status = \'processing\'
        ');
        $stmt->execute([$message, $challengeId]);
    } catch (Throwable $e) {
        error_log('[challenge_ranking] mark_failed: ' . $e->getMessage());
    }
}

/**
 * Rank ended multi-participant challenges that still need ranking (before payouts).
 */
function denara_finalize_challenge_rankings(PDO $pdo): void {
    try {
        $pdo->exec("
            UPDATE challenges
            SET ranking_status = 'skipped',
                ranking_computed_at = COALESCE(ranking_computed_at, UTC_TIMESTAMP()),
                updated_at = UTC_TIMESTAMP()
            WHERE LOWER(TRIM(COALESCE(manual_status, ''))) <> 'cancelled'
              AND end_time < UTC_TIMESTAMP()
              AND participant_count = 0
              AND (ranking_status IS NULL OR ranking_status = 'pending')
            LIMIT 40
        ");
    } catch (Throwable $e) {
        if (!str_contains($e->getMessage(), 'ranking_status') && !str_contains($e->getMessage(), 'Unknown column')) {
            error_log('[challenge_ranking] zero-participant skip: ' . $e->getMessage());
        }
    }

    try {
        $stmt = $pdo->query("
            SELECT *
            FROM challenges
            WHERE LOWER(TRIM(COALESCE(manual_status, ''))) <> 'cancelled'
              AND end_time < UTC_TIMESTAMP()
              AND participant_count >= 1
              AND (ranking_status IS NULL OR ranking_status IN ('pending', 'failed'))
            ORDER BY end_time ASC
            LIMIT 5
        ");
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        // e.g. unknown column ranking_status before migration
        if (str_contains($e->getMessage(), 'ranking_status') || str_contains($e->getMessage(), 'Unknown column')) {
            return;
        }
        error_log('[challenge_ranking] list due: ' . $e->getMessage());

        return;
    }

    foreach ($rows as $c) {
        $cid = (int) ($c['id'] ?? 0);
        try {
            denara_try_rank_one_challenge($pdo, $c);
        } catch (Throwable $e) {
            denara_rank_mark_failed($pdo, $cid, $e->getMessage());
        }
    }
}
