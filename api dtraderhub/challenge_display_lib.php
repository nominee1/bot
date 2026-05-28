<?php
declare(strict_types=1);

/**
 * User-facing payout status: DB `payout_status` is `pending` for all paid challenges until
 * they end and payout runs — that is confusing when the challenge is still "up".
 * This maps raw DB + derived challenge phase to clearer labels.
 *
 * @return string scheduled|pending|processing|paid|failed|not_applicable
 */
function denara_challenge_payout_display_status(string $challengeType, string $derivedChallengeStatus, string $dbPayoutStatus): string {
    if ($challengeType !== 'paid') {
        return 'not_applicable';
    }

    if ($derivedChallengeStatus === 'cancelled') {
        return 'not_applicable';
    }

    if (!in_array($derivedChallengeStatus, ['ended'], true)) {
        return 'scheduled';
    }

    $db = strtolower(trim($dbPayoutStatus));

    // Paid challenges should use pending/processing/paid/failed. If DB still says not_applicable, show it — do not
    // map unknown values to pending (that made DB `not_applicable` appear as "Queued" in the UI).
    if ($db === 'not_applicable') {
        return 'not_applicable';
    }

    return in_array($db, ['pending', 'processing', 'paid', 'failed'], true) ? $db : 'pending';
}
