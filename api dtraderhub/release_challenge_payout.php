<?php
declare(strict_types=1);

/**
 * Founder-triggered payout for an ended paid challenge (POST JSON).
 * Body: { "challenge_id": 123, "username": "founder_denara_id", "password": "..." }
 *
 * Verifies password against CHALLENGE_TRADERS_TABLE unless RELEASE_CHALLENGE_PAYOUT_SKIP_PASSWORD is enabled (testing).
 * Requires PAYMENT_AGENT_API_TOKEN (same as automatic payout).
 *
 * Optional: RELEASE_CHALLENGE_PAYOUT_TEST_SKIP_STATUS=1 returns HTTP 200 after attempt even when DB ≠ paid (debug).
 *
 * Payout: only hard gate is `payout_status = paid` (no second release). Founder flow calls the transfer with
 * `bypassDbStatusGates` so pending/processing/empty column quirks do not block payment; auto/cron payouts still
 * use strict DB gates unless CHALLENGE_PAYOUT_SKIP_DB_STATUS_GATES is set.
 */

require_once __DIR__ . '/util.php';
require_once __DIR__ . '/challenge_payout_lib.php';

/** Fresh SELECT each call avoids PDO reuse quirks when reading `payout_status` after updates. */
function denara_release_fetch_challenge(PDO $pdo, int $challengeId): ?array {
    $st = $pdo->prepare('SELECT * FROM challenges WHERE id = ? LIMIT 1');
    $st->execute([$challengeId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    $st->closeCursor();

    return $row ?: null;
}

function denara_release_challenge_skip_password_for_testing(): bool {
    if (defined('RELEASE_CHALLENGE_PAYOUT_SKIP_PASSWORD') && RELEASE_CHALLENGE_PAYOUT_SKIP_PASSWORD === true) {
        return true;
    }
    $t = getenv('RELEASE_CHALLENGE_PAYOUT_SKIP_PASSWORD');

    return is_string($t) && trim($t) === '1';
}

/** When true, release returns HTTP 200 with payout row + transfer diagnostics even if DB payout_status is not yet `paid`. */
function denara_release_challenge_payout_test_skip_status(): bool {
    if (defined('RELEASE_CHALLENGE_PAYOUT_TEST_SKIP_STATUS') && RELEASE_CHALLENGE_PAYOUT_TEST_SKIP_STATUS === true) {
        return true;
    }
    $t = getenv('RELEASE_CHALLENGE_PAYOUT_TEST_SKIP_STATUS');

    return is_string($t) && trim($t) === '1';
}

/** Merge preview authorize + payout diagnostics for the frontend (receiver Deriv login ID). */
function denara_release_transfer_target_payload(array $preview, array $transferDiag): array {
    $deriv = $transferDiag['winner_authorize_loginid'] ?? $transferDiag['transfer_to'] ?? $transferDiag['client_to_loginid'] ?? null;
    if ($deriv === null || $deriv === '') {
        $deriv = isset($preview['deriv_loginid']) && is_string($preview['deriv_loginid']) && $preview['deriv_loginid'] !== ''
            ? $preview['deriv_loginid']
            : null;
    }

    return [
        'deriv_loginid' => $deriv,
        'winner_trader_id' => $transferDiag['winner_trader_id'] ?? $preview['winner_trader_id'] ?? null,
        'winner_username' => $preview['winner_username'] ?? null,
        'is_virtual' => $preview['is_virtual'] ?? null,
        'preview_error' => isset($preview['error']) && is_string($preview['error']) && $preview['error'] !== '' ? $preview['error'] : null,
        'deriv_recipient_confirmed' => isset($transferDiag['client_to_loginid']) ? $transferDiag['client_to_loginid'] : null,
    ];
}

cors();
header('Content-Type: application/json; charset=utf-8');

if (method() !== 'POST') {
    fail('Method not allowed', 405);
}

try {
    if (denara_payment_agent_api_token() === '') {
        fail('Server is not configured for payouts (PAYMENT_AGENT_API_TOKEN).', 503);
    }

    $in = body_json();
    $challengeId = isset($in['challenge_id']) && is_numeric($in['challenge_id']) ? (int)$in['challenge_id'] : 0;
    $username = trim((string)($in['username'] ?? ''));
    $password = (string)($in['password'] ?? '');

    if ($challengeId <= 0 || $username === '') {
        fail('challenge_id and username required', 422);
    }

    $pdo = pdo();
    $tbl = defined('CHALLENGE_TRADERS_TABLE') ? CHALLENGE_TRADERS_TABLE : 'traders_competition_2';

    $stmt = $pdo->prepare("
        SELECT id, username, password_hash
        FROM `{$tbl}`
        WHERE TRIM(LOWER(username)) = TRIM(LOWER(:u))
        LIMIT 1
    ");
    $stmt->execute([':u' => $username]);
    $trader = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$trader) {
        fail('Invalid username or password.', 401);
    }

    if (!denara_release_challenge_skip_password_for_testing()) {
        // Match get_token.php POST: if password_hash is empty, login is allowed without verify (legacy rows).
        $hash = isset($trader['password_hash']) ? trim((string)$trader['password_hash']) : '';
        if ($hash !== '') {
            if (!password_verify($password, $hash)) {
                fail('Invalid username or password.', 401);
            }
        }
    }

    $traderId = (int)$trader['id'];
    $traderUsernameNorm = strtolower(trim((string)($trader['username'] ?? '')));

    $ch = denara_release_fetch_challenge($pdo, $challengeId);

    if (!$ch) {
        fail('Challenge not found', 404);
    }

    // created_by_trader_id often comes from legacy `traders.id` at challenge creation; release auth uses
    // CHALLENGE_TRADERS_TABLE ids — they can differ for the same username. Allow founder when id matches OR
    // stored created_by_username matches the authenticated competition trader (username + password when not in test-skip mode).
    $createdId = (int)($ch['created_by_trader_id'] ?? 0);
    $createdUsernameNorm = strtolower(trim((string)($ch['created_by_username'] ?? '')));
    $isFounderById = $createdId === $traderId;
    $isFounderByUsername = $createdUsernameNorm !== '' && $createdUsernameNorm === $traderUsernameNorm;

    if (!$isFounderById && !$isFounderByUsername) {
        fail('Only the challenge founder can release funds.', 403);
    }

    $ctype = strtolower(trim((string)($ch['challenge_type'] ?? '')));
    if ($ctype !== 'paid') {
        fail('Only paid challenges have prize payouts.', 422);
    }

    if (strtolower(trim((string)($ch['manual_status'] ?? ''))) === 'cancelled') {
        fail('Challenge was cancelled.', 422);
    }

    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $end = new DateTimeImmutable((string)$ch['end_time'], new DateTimeZone('UTC'));
    if ($now < $end) {
        fail('Challenge has not ended yet.', 422);
    }

    // Normalize every non-paid payout row to pending so founder release can claim (processing/failed/empty/not_applicable/…).
    try {
        $normAll = $pdo->prepare('
            UPDATE challenges
            SET payout_status = \'pending\',
                updated_at = UTC_TIMESTAMP()
            WHERE id = ?
              AND LOWER(TRIM(COALESCE(payout_status, \'\'))) NOT IN (\'paid\')
        ');
        $normAll->execute([$challengeId]);
    } catch (Throwable $e) {
        fail('Could not normalize payout_status for release: ' . $e->getMessage(), 500);
    }

    $ch = denara_release_fetch_challenge($pdo, $challengeId);
    if (!$ch) {
        fail('Challenge not found', 404);
    }

    $ps = strtolower(trim((string) ($ch['payout_status'] ?? '')));

    if ($ps === 'paid') {
        if (denara_release_challenge_payout_test_skip_status()) {
            $previewDone = denara_challenge_payout_preview_transfer_target($pdo, $ch);
            echo json_encode([
                'ok' => true,
                'already_paid' => true,
                'test_skip_status' => true,
                'payout_completed_in_db' => true,
                'challenge' => [
                    'id' => $challengeId,
                    'payout_status' => $ch['payout_status'] ?? null,
                    'payout_deriv_txid' => $ch['payout_deriv_txid'] ?? null,
                    'payout_paid_at' => isset($ch['payout_paid_at']) && $ch['payout_paid_at']
                        ? (new DateTimeImmutable((string) $ch['payout_paid_at'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM)
                        : null,
                    'payout_last_error' => $ch['payout_last_error'] ?? null,
                ],
                'transfer_target' => denara_release_transfer_target_payload($previewDone, []),
                'transfer' => [
                    'step' => 'skipped',
                    'reason' => 'already_paid_in_db',
                ],
            ], JSON_UNESCAPED_SLASHES);

            return;
        }
        fail('Payout already completed.', 422);
    }

    // (1) Ended (2) pool (3) participants — do not require a specific non-paid status string.
    if ((float)($ch['prize_pool'] ?? 0) <= 0) {
        fail('Prize pool is empty.', 422);
    }

    if ((int)($ch['participant_count'] ?? 0) <= 0) {
        fail('No participants.', 422);
    }

    // Fresh row so payout sees current pending state and prize_pool (not a stale $ch snapshot).
    $chFresh = denara_release_fetch_challenge($pdo, $challengeId);
    if (!$chFresh || !is_array($chFresh)) {
        fail('Challenge not found', 404);
    }

    $previewTarget = denara_challenge_payout_preview_transfer_target($pdo, $chFresh);
    if (isset($previewTarget['error']) && is_string($previewTarget['error']) && $previewTarget['error'] !== '') {
        fail('Cannot resolve winner for payout: ' . $previewTarget['error'] . ' (set winner or ensure single participant).', 422);
    }

    // Founder release: bypass pending→processing claim; transfer then mark paid with broad DB update (see challenge_payout_lib).
    $transferDiag = [];
    denara_try_payout_one_challenge($pdo, $chFresh, $transferDiag, true);

    $transferTarget = denara_release_transfer_target_payload($previewTarget, $transferDiag);

    $after = denara_release_fetch_challenge($pdo, $challengeId);
    if (!$after || !is_array($after)) {
        fail('Could not reload challenge after payout attempt.', 500);
    }

    $finalPs = strtolower(trim((string)($after['payout_status'] ?? '')));
    $lastErr = trim((string)($after['payout_last_error'] ?? ''));

    if (denara_release_challenge_payout_test_skip_status()) {
        echo json_encode([
            'ok' => true,
            'test_skip_status' => true,
            'payout_completed_in_db' => $finalPs === 'paid',
            'challenge' => [
                'id' => $challengeId,
                'payout_status' => $after['payout_status'] ?? null,
                'payout_deriv_txid' => $after['payout_deriv_txid'] ?? null,
                'payout_paid_at' => isset($after['payout_paid_at']) && $after['payout_paid_at']
                    ? (new DateTimeImmutable((string)$after['payout_paid_at'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM)
                    : null,
                'payout_last_error' => $after['payout_last_error'] ?? null,
            ],
            'transfer_target' => $transferTarget,
            'transfer' => $transferDiag,
        ], JSON_UNESCAPED_SLASHES);

        return;
    }

    if ($finalPs !== 'paid') {
        if ($finalPs === 'failed') {
            fail($lastErr !== '' ? $lastErr : 'Payout failed (Deriv or validation error).', 422);
        }
        $diag = $transferDiag !== [] ? ' ' . json_encode($transferDiag, JSON_UNESCAPED_SLASHES) : '';
        fail(
            $lastErr !== ''
                ? 'Payout did not complete: ' . $lastErr . $diag
                : 'Payout did not complete (winner token, Deriv transfer, or DB update). Current status: '
                . json_encode($after['payout_status'] ?? '', JSON_UNESCAPED_SLASHES)
                . '.'
                . $diag,
            422
        );
    }

    echo json_encode([
        'ok' => true,
        'challenge' => [
            'id' => $challengeId,
            'payout_status' => $after['payout_status'] ?? null,
            'payout_deriv_txid' => $after['payout_deriv_txid'] ?? null,
            'payout_paid_at' => isset($after['payout_paid_at']) && $after['payout_paid_at']
                ? (new DateTimeImmutable((string)$after['payout_paid_at'], new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM)
                : null,
            'payout_last_error' => $after['payout_last_error'] ?? null,
        ],
        'transfer_target' => $transferTarget,
        'transfer' => $transferDiag,
    ], JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
    fail($e->getMessage(), 500);
}
