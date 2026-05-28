<?php
declare(strict_types=1);

/**
 * Auto-payout paid challenge prize pools after end_time:
 * - Exactly one participant: full prize_pool → that trader's Deriv loginid (refund / sole winner).
 * - Multiple participants: pays when winner_trader_id is set (ranking / admin sets winner first).
 *
 * Requires PAYMENT_AGENT_API_TOKEN: Deriv PAT for the payment-agent wallet.
 * Set via server env, or in config.php: putenv('PAYMENT_AGENT_API_TOKEN=...') or define('PAYMENT_AGENT_API_TOKEN', '...').
 * WebSocket + app_id must match your working PA test: CHALLENGE_PAYOUT_WS_ENDPOINT, CHALLENGE_PAYOUT_DERIV_APP_ID in config.php.
 * Auto/cron flow: paid + non-paid payout_status → pending (normalize) → claim processing → Deriv transfer → paid.
 * Founder `release_challenge_payout.php` passes bypassDbStatusGates: skip claim, transfer, then mark paid (broad WHERE).
 * Set CHALLENGE_PAYOUT_SKIP_DB_STATUS_GATES to treat all runs like bypass (emergency debug only; double-pay risk).
 * Invoked from list_challenges.php / get_challenge.php (lazy) and optional finalize_challenge_payouts.php (cron).
 */

require_once __DIR__ . '/DerivClient.php';

/** Same app_id as in WebSocket URL when creating PAYMENT_AGENT_API_TOKEN / winner tokens (see Payment Agent HTML test). */
function denara_challenge_payout_deriv_app_id(): int {
    if (defined('CHALLENGE_PAYOUT_DERIV_APP_ID')) {
        return (int) CHALLENGE_PAYOUT_DERIV_APP_ID;
    }
    $e = getenv('CHALLENGE_PAYOUT_DERIV_APP_ID');

    return is_string($e) && ctype_digit(trim($e)) ? (int) trim($e) : 87874;
}

/** Must match working clients (e.g. wss://ws.derivws.com/websockets/v3 — not legacy binaryws). */
function denara_challenge_payout_ws_endpoint(): string {
    if (defined('CHALLENGE_PAYOUT_WS_ENDPOINT') && is_string(CHALLENGE_PAYOUT_WS_ENDPOINT) && CHALLENGE_PAYOUT_WS_ENDPOINT !== '') {
        return CHALLENGE_PAYOUT_WS_ENDPOINT;
    }
    $e = getenv('CHALLENGE_PAYOUT_WS_ENDPOINT');

    return is_string($e) && trim($e) !== '' ? trim($e) : 'wss://ws.derivws.com/websockets/v3';
}

function denara_payment_agent_api_token(): string {
    $t = getenv('PAYMENT_AGENT_API_TOKEN');
    if (is_string($t) && trim($t) !== '') {
        return trim($t);
    }

    if (isset($_ENV['PAYMENT_AGENT_API_TOKEN']) && is_string($_ENV['PAYMENT_AGENT_API_TOKEN'])) {
        $e = trim($_ENV['PAYMENT_AGENT_API_TOKEN']);
        if ($e !== '') {
            return $e;
        }
    }

    if (defined('PAYMENT_AGENT_API_TOKEN')) {
        $c = constant('PAYMENT_AGENT_API_TOKEN');

        return is_string($c) ? trim($c) : '';
    }

    return '';
}

/**
 * When true: skip normalize + claim; run transfer then best-effort paid row (emergency debug only; double-pay risk).
 */
function denara_challenge_payout_skip_db_status_gates(): bool {
    if (defined('CHALLENGE_PAYOUT_SKIP_DB_STATUS_GATES') && CHALLENGE_PAYOUT_SKIP_DB_STATUS_GATES === true) {
        return true;
    }

    return getenv('CHALLENGE_PAYOUT_SKIP_DB_STATUS_GATES') === '1';
}

function denara_challenge_payout_mark_failed(PDO $pdo, int $challengeId, string $message, bool $broadNonPaidLock = false): void {
    error_log('[challenge_payout] challenge ' . $challengeId . ' failed: ' . $message);

    $skip = denara_challenge_payout_skip_db_status_gates() || $broadNonPaidLock;

    try {
        if ($skip) {
            $stmt = $pdo->prepare('
                UPDATE challenges
                SET payout_status = ?,
                    payout_last_error = ?,
                    updated_at = UTC_TIMESTAMP()
                WHERE id = ?
                  AND LOWER(TRIM(COALESCE(payout_status, \'\'))) NOT IN (\'paid\')
            ');
        } else {
            $stmt = $pdo->prepare('
                UPDATE challenges
                SET payout_status = ?,
                    payout_last_error = ?,
                    updated_at = UTC_TIMESTAMP()
                WHERE id = ?
                  AND payout_status IN (\'pending\', \'processing\')
            ');
        }
        $stmt->execute(['failed', $message, $challengeId]);
    } catch (Throwable $e) {
        try {
            if ($skip) {
                $stmt = $pdo->prepare('
                    UPDATE challenges
                    SET payout_status = \'failed\', updated_at = UTC_TIMESTAMP()
                    WHERE id = ?
                      AND LOWER(TRIM(COALESCE(payout_status, \'\'))) NOT IN (\'paid\')
                ');
            } else {
                $stmt = $pdo->prepare('
                    UPDATE challenges
                    SET payout_status = \'failed\', updated_at = UTC_TIMESTAMP()
                    WHERE id = ?
                      AND payout_status IN (\'pending\', \'processing\')
                ');
            }
            $stmt->execute([$challengeId]);
        } catch (Throwable $e2) {
            error_log('[challenge_payout] mark_failed fallback: ' . $e2->getMessage());
        }
    }
}

/**
 * @return array{0: string, 1: string} [plain_token, loginid preview]
 */
function denara_trader_plain_token(PDO $pdo, int $traderId): array {
    $tbl = defined('CHALLENGE_TRADERS_TABLE') ? CHALLENGE_TRADERS_TABLE : 'traders_competition_2';

    $stmt = $pdo->prepare("SELECT id, username, token FROM `{$tbl}` WHERE id = ? LIMIT 1");
    $stmt->execute([$traderId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        throw new RuntimeException('Winner trader row not found.');
    }

    $tok = trim((string)($row['token'] ?? ''));
    if ($tok === '') {
        throw new RuntimeException('Winner trader token missing.');
    }

    if (function_exists('token_lazy_upgrade')) {
        $tok = token_lazy_upgrade($pdo, $tbl, 'id', $traderId, $tok);
    }

    if (!function_exists('token_decrypt_or_plain')) {
        throw new RuntimeException('token_decrypt_or_plain not available.');
    }

    [$plain] = token_decrypt_or_plain($tok);

    return [$plain, (string)($row['username'] ?? '')];
}

function denara_resolve_winner_trader_id(PDO $pdo, array $challenge): ?int {
    $wid = $challenge['winner_trader_id'] ?? null;
    if ($wid !== null && $wid !== '' && (int)$wid > 0) {
        return (int)$wid;
    }

    $pc = (int)($challenge['participant_count'] ?? 0);
    if ($pc !== 1) {
        return null;
    }

    $cid = (int)$challenge['id'];
    $stmt = $pdo->prepare('
        SELECT trader_id
        FROM challenge_participants
        WHERE challenge_id = ?
          AND join_status = \'joined\'
        ORDER BY joined_at ASC, id ASC
        LIMIT 1
    ');
    $stmt->execute([$cid]);
    $r = $stmt->fetch(PDO::FETCH_ASSOC);

    return $r ? (int)$r['trader_id'] : null;
}

/**
 * Resolve winner and authorize once on Deriv to show the receiver login ID (paymentagent_transfer `transfer_to`).
 * Used by release_challenge_payout.php for UI; payout flow may authorize again separately.
 *
 * @return array{winner_trader_id: ?int, deriv_loginid: ?string, winner_username: ?string, is_virtual: ?bool, error: ?string, participant_count: int}
 */
function denara_challenge_payout_preview_transfer_target(PDO $pdo, array $c): array {
    $out = [
        'winner_trader_id' => null,
        'deriv_loginid' => null,
        'winner_username' => null,
        'is_virtual' => null,
        'error' => null,
        'participant_count' => (int) ($c['participant_count'] ?? 0),
    ];

    $wid = denara_resolve_winner_trader_id($pdo, $c);
    if ($wid === null || $wid <= 0) {
        $out['error'] = 'no_winner_trader_id';

        return $out;
    }

    $out['winner_trader_id'] = $wid;

    try {
        [$tok, $uname] = denara_trader_plain_token($pdo, $wid);
    } catch (Throwable $e) {
        $out['error'] = $e->getMessage();

        return $out;
    }

    $out['winner_username'] = $uname;

    $ws = new \Denara\DerivClient(denara_challenge_payout_deriv_app_id(), denara_challenge_payout_ws_endpoint());

    try {
        $auth = $ws->authorize($tok);
        $loginid = (string) (($auth['authorize'] ?? [])['loginid'] ?? '');
        $isVirtual = (int) (($auth['authorize'] ?? [])['is_virtual'] ?? 0) === 1;
        $out['deriv_loginid'] = $loginid !== '' ? $loginid : null;
        $out['is_virtual'] = $isVirtual;
    } catch (Throwable $e) {
        $out['error'] = $e->getMessage();
    } finally {
        $ws->close();
    }

    return $out;
}

/**
 * When $diagOut is passed (by reference), it is filled with transfer diagnostics for testing / debugging
 * (winner loginid, Deriv paymentagent_transfer echo fields like client_to_loginid).
 *
 * @param array|null $diagOut Populated only when caller passes an array by reference
 * @param bool $bypassDbStatusGates Founder release only: skip pending→processing claim (same as CHALLENGE_PAYOUT_SKIP_DB_STATUS_GATES for this run). Cron/auto payouts should leave false.
 */
function denara_try_payout_one_challenge(PDO $pdo, array $c, ?array &$diagOut = null, bool $bypassDbStatusGates = false): void {
    $challengeId = (int)$c['id'];
    $pool = (float)($c['prize_pool'] ?? 0);

    if ($diagOut !== null) {
        $diagOut = [
            'challenge_id' => $challengeId,
            'step' => 'init',
        ];
    }

    if ($pool <= 0) {
        if ($diagOut !== null) {
            $diagOut['step'] = 'skipped';
            $diagOut['reason'] = 'prize_pool_empty';
        }

        return;
    }

    $skipDb = denara_challenge_payout_skip_db_status_gates() || $bypassDbStatusGates;
    if ($diagOut !== null && $skipDb) {
        $diagOut['db_status_gates_skipped'] = true;
    }
    if ($diagOut !== null && $bypassDbStatusGates) {
        $diagOut['founder_release_bypass_status_gates'] = true;
    }

    if (!$skipDb) {
        // Same rule as release_challenge_payout: any non-paid state → pending so the claim (pending→processing) can run.
        try {
            $norm = $pdo->prepare('
                UPDATE challenges
                SET payout_status = \'pending\',
                    updated_at = UTC_TIMESTAMP()
                WHERE id = ?
                  AND LOWER(TRIM(COALESCE(challenge_type, \'\'))) = \'paid\'
                  AND LOWER(TRIM(COALESCE(payout_status, \'\'))) NOT IN (\'paid\')
            ');
            $norm->execute([$challengeId]);
        } catch (Throwable $e) {
            error_log('[challenge_payout] normalize payout_status: ' . $e->getMessage());
        }
    }

    $winnerTraderId = denara_resolve_winner_trader_id($pdo, $c);
    if ($winnerTraderId === null || $winnerTraderId <= 0) {
        if ($diagOut !== null) {
            $diagOut['step'] = 'skipped';
            $diagOut['reason'] = 'no_winner_trader_id';
            $diagOut['participant_count'] = (int)($c['participant_count'] ?? 0);
        }

        return;
    }

    if ($diagOut !== null) {
        $diagOut['winner_trader_id'] = $winnerTraderId;
    }

    $agentTok = denara_payment_agent_api_token();
    if ($agentTok === '') {
        if ($diagOut !== null) {
            $diagOut['step'] = 'skipped';
            $diagOut['reason'] = 'payment_agent_token_missing';
        }

        return;
    }

    if (!$skipDb) {
        // Match pending case-insensitively (ENUM/VARCHAR quirks); do not trust PDO rowCount() for UPDATE with emulate_prepares off.
        $claim = $pdo->prepare('
            UPDATE challenges
            SET payout_status = \'processing\',
                payout_last_error = NULL,
                updated_at = UTC_TIMESTAMP()
            WHERE id = ?
              AND LOWER(TRIM(COALESCE(payout_status, \'\'))) = \'pending\'
        ');
        $claim->execute([$challengeId]);

        $chk = $pdo->prepare('SELECT payout_status FROM challenges WHERE id = ? LIMIT 1');
        $chk->execute([$challengeId]);
        $claimedRow = $chk->fetch(PDO::FETCH_ASSOC);
        $claimedPs = is_array($claimedRow)
            ? strtolower(trim((string) ($claimedRow['payout_status'] ?? '')))
            : '';
        if ($claimedPs !== 'processing') {
            if ($diagOut !== null) {
                $diagOut['step'] = 'skipped';
                $diagOut['reason'] = 'could_not_claim_processing_row_not_pending';
                $rawObs = is_array($claimedRow) ? ($claimedRow['payout_status'] ?? null) : null;
                if (!is_array($claimedRow)) {
                    $diagOut['payout_status_observed'] = '(challenge_row_missing)';
                } elseif ($rawObs === null) {
                    $diagOut['payout_status_observed'] = '(null)';
                } elseif ($rawObs === '') {
                    $diagOut['payout_status_observed'] = '(empty_string)';
                } else {
                    $diagOut['payout_status_observed'] = (string) $rawObs;
                }
                $diagOut['hint'] = 'Row was not pending when claim ran (e.g. stuck processing, or column empty). '
                    . 'Release endpoint normalizes first; cron/list uses this same broad normalize now.';
            }

            return;
        }
    }

    try {
        [$winnerToken, $winnerUsername] = denara_trader_plain_token($pdo, $winnerTraderId);
    } catch (Throwable $e) {
        denara_challenge_payout_mark_failed($pdo, $challengeId, $e->getMessage(), $skipDb);
        if ($diagOut !== null) {
            $diagOut['step'] = 'failed';
            $diagOut['phase'] = 'winner_token';
            $diagOut['error'] = $e->getMessage();
        }

        return;
    }

    $wsWinner = new \Denara\DerivClient(denara_challenge_payout_deriv_app_id(), denara_challenge_payout_ws_endpoint());
    $loginid = '';

    try {
        $auth = $wsWinner->authorize($winnerToken);
        $loginid = (string)(($auth['authorize'] ?? [])['loginid'] ?? '');
        $isVirtual = (int)(($auth['authorize'] ?? [])['is_virtual'] ?? 0) === 1;

        if ($diagOut !== null) {
            $diagOut['winner_authorize_loginid'] = $loginid;
            $diagOut['winner_is_virtual'] = $isVirtual ? 1 : 0;
            $diagOut['winner_username_db'] = $winnerUsername;
        }

        if ($loginid === '') {
            throw new RuntimeException('Could not read winner loginid from Deriv.');
        }

        if ($isVirtual || str_starts_with($loginid, 'VRTC')) {
            throw new RuntimeException('Winner account must be a real (non-demo) Deriv account for payout.');
        }
    } catch (Throwable $e) {
        $wsWinner->close();
        denara_challenge_payout_mark_failed($pdo, $challengeId, $e->getMessage(), $skipDb);
        if ($diagOut !== null) {
            $diagOut['step'] = 'failed';
            $diagOut['phase'] = 'winner_authorize';
            $diagOut['error'] = $e->getMessage();
        }

        return;
    } finally {
        $wsWinner->close();
    }

    $amount = round($pool, 2);
    if ($amount <= 0) {
        denara_challenge_payout_mark_failed($pdo, $challengeId, 'Prize pool rounds to zero.', $skipDb);
        if ($diagOut !== null) {
            $diagOut['step'] = 'failed';
            $diagOut['reason'] = 'amount_rounds_to_zero';
            $diagOut['amount_rounded'] = $amount;
        }

        return;
    }

    $wsAgent = new \Denara\DerivClient(denara_challenge_payout_deriv_app_id(), denara_challenge_payout_ws_endpoint());
    $txid = null;

    try {
        $authAgent = $wsAgent->authorize($agentTok);
        $agentLoginid = (string)(($authAgent['authorize'] ?? [])['loginid'] ?? '');

        if ($diagOut !== null) {
            $diagOut['step'] = 'transferring';
            $diagOut['payment_agent_authorize_loginid'] = $agentLoginid;
            $diagOut['transfer_amount'] = $amount;
            $diagOut['transfer_currency'] = 'USD';
            $diagOut['transfer_to'] = $loginid;
        }

        // Same WebSocket payload as payment agent transfer HTML test (description default, no dry_run on release).
        // Optional loginid only if multi-wallet PA requires it — HTML never sends loginid.
        $sendAgentLoginidOnTransfer = getenv('CHALLENGE_PAYOUT_SEND_AGENT_LOGINID_ON_TRANSFER') === '1'
            || (defined('CHALLENGE_PAYOUT_SEND_AGENT_LOGINID_ON_TRANSFER') && CHALLENGE_PAYOUT_SEND_AGENT_LOGINID_ON_TRANSFER === true);

        $resp = $wsAgent->paymentAgentTransfer(
            $loginid,
            $amount,
            'USD',
            'Payment Agent transfer',
            ($sendAgentLoginidOnTransfer && $agentLoginid !== '') ? $agentLoginid : null,
            false
        );

        if ($diagOut !== null) {
            $diagOut['deriv_raw_paymentagent_transfer'] = [
                'paymentagent_transfer' => $resp['paymentagent_transfer'] ?? null,
                'transaction_id' => $resp['transaction_id'] ?? null,
                'client_to_loginid' => $resp['client_to_loginid'] ?? null,
                'client_to_full_name' => $resp['client_to_full_name'] ?? null,
                'transfer_to_echo' => $resp['echo_req']['transfer_to'] ?? null,
            ];
        }

        // Success: paymentagent_transfer is 1 (transfer) or 2 (dry-run); transaction_id is top-level, not nested.
        // @see https://legacy-api.deriv.com/api-explorer#paymentagent_transfer
        $pta = $resp['paymentagent_transfer'] ?? null;
        if ($pta !== 1 && $pta !== 2) {
            throw new RuntimeException(
                'Deriv paymentagent_transfer did not return success (expected 1 or 2): ' . json_encode($resp, JSON_UNESCAPED_SLASHES)
            );
        }

        $txid = (string)($resp['transaction_id'] ?? '');
        if ($txid === '') {
            $txid = (string)($resp['transfer_id'] ?? '');
        }

        if ($diagOut !== null) {
            $diagOut['transfer_ok'] = true;
            $diagOut['transaction_id'] = $txid !== '' ? $txid : null;
            $diagOut['client_to_loginid'] = isset($resp['client_to_loginid']) ? (string)$resp['client_to_loginid'] : null;
            $diagOut['client_to_full_name'] = isset($resp['client_to_full_name']) ? (string)$resp['client_to_full_name'] : null;
            $diagOut['transfer_loginid_matches_winner'] =
                isset($resp['client_to_loginid'])
                && strcasecmp((string)$resp['client_to_loginid'], $loginid) === 0;
        }
    } catch (Throwable $e) {
        denara_challenge_payout_mark_failed($pdo, $challengeId, $e->getMessage(), $skipDb);
        if ($diagOut !== null) {
            $diagOut['step'] = 'failed';
            $diagOut['phase'] = 'paymentagent_transfer';
            $diagOut['transfer_ok'] = false;
            $diagOut['error'] = $e->getMessage();
        }

        return;
    } finally {
        $wsAgent->close();
    }

    try {
        if ($skipDb) {
            $fin = $pdo->prepare('
                UPDATE challenges
                SET payout_status = \'paid\',
                    payout_deriv_txid = ?,
                    payout_paid_at = UTC_TIMESTAMP(),
                    payout_last_error = NULL,
                    winner_trader_id = ?,
                    winner_username = ?,
                    updated_at = UTC_TIMESTAMP()
                WHERE id = ?
                  AND LOWER(TRIM(COALESCE(payout_status, \'\'))) NOT IN (\'paid\')
            ');
        } else {
            $fin = $pdo->prepare('
                UPDATE challenges
                SET payout_status = \'paid\',
                    payout_deriv_txid = ?,
                    payout_paid_at = UTC_TIMESTAMP(),
                    payout_last_error = NULL,
                    winner_trader_id = ?,
                    winner_username = ?,
                    updated_at = UTC_TIMESTAMP()
                WHERE id = ?
                  AND payout_status = \'processing\'
            ');
        }
        $fin->execute([
            $txid !== '' ? $txid : null,
            $winnerTraderId,
            $winnerUsername,
            $challengeId,
        ]);
    } catch (Throwable $e) {
        try {
            if ($skipDb) {
                $fin2 = $pdo->prepare('
                    UPDATE challenges
                    SET payout_status = \'paid\',
                        winner_trader_id = ?,
                        winner_username = ?,
                        updated_at = UTC_TIMESTAMP()
                    WHERE id = ?
                      AND LOWER(TRIM(COALESCE(payout_status, \'\'))) NOT IN (\'paid\')
                ');
            } else {
                $fin2 = $pdo->prepare('
                    UPDATE challenges
                    SET payout_status = \'paid\',
                        winner_trader_id = ?,
                        winner_username = ?,
                        updated_at = UTC_TIMESTAMP()
                    WHERE id = ?
                      AND payout_status = \'processing\'
                ');
            }
            $fin2->execute([$winnerTraderId, $winnerUsername, $challengeId]);
        } catch (Throwable $e2) {
            error_log('[challenge_payout] paid but DB update failed challenge=' . $challengeId . ' ' . $e->getMessage() . ' | ' . $e2->getMessage());
        }
    }

    if ($diagOut !== null) {
        $diagOut['step'] = 'completed';
        $diagOut['payout_deriv_txid_stored'] = $txid !== '' ? $txid : null;
    }
}

/**
 * Process all due challenges (ended, paid type, pending payout, pool &gt; 0).
 */
function denara_finalize_challenge_payouts(PDO $pdo): void {
    if (denara_payment_agent_api_token() === '') {
        return;
    }

    try {
        $stmt = $pdo->query("
            SELECT *
            FROM challenges
            WHERE LOWER(TRIM(COALESCE(challenge_type, ''))) = 'paid'
              AND LOWER(TRIM(COALESCE(manual_status, ''))) <> 'cancelled'
              AND end_time < UTC_TIMESTAMP()
              AND LOWER(TRIM(COALESCE(payout_status, ''))) = 'pending'
              AND prize_pool > 0
              AND participant_count > 0
            ORDER BY end_time ASC
            LIMIT 20
        ");
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        error_log('[challenge_payout] list due: ' . $e->getMessage());

        return;
    }

    foreach ($rows as $c) {
        try {
            denara_try_payout_one_challenge($pdo, $c);
        } catch (Throwable $e) {
            error_log('[challenge_payout] challenge ' . ($c['id'] ?? '?') . ': ' . $e->getMessage());
        }
    }
}
