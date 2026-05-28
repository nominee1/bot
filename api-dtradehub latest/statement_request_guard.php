<?php
declare(strict_types=1);

/**
 * Short-lived response cache + MySQL GET_LOCK for get_challenge_participant_statements.
 * - Reduces duplicate Deriv WebSocket/statement traffic when many viewers refresh the same participant.
 * - Concurrent builds for the same target serialize on one Deriv pull; others wait briefly or get 429.
 */

/** How long to reuse an identical cached JSON payload (seconds). */
const DENARA_STMT_CACHE_TTL_SEC = 60;

/** Max seconds to wait for another request to finish building the same payload. */
const DENARA_STMT_LOCK_TIMEOUT_SEC = 12;

/** Prefix for MySQL GET_LOCK names (must stay ≤64 chars total on older MySQL). */
const DENARA_STMT_LOCK_PREFIX = 'den_stmt_';

function denara_stmt_cache_dir(): string {
    $dir = __DIR__ . '/cache/statements';
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    if (is_dir($dir) && is_writable($dir)) {
        return $dir;
    }
    $fallback = rtrim(sys_get_temp_dir(), '/') . '/denara_stmt_cache';
    if (!is_dir($fallback)) {
        @mkdir($fallback, 0755, true);
    }

    return $fallback;
}

/**
 * Stable key for one challenge participant + window + limit + branch (virtual|deriv).
 */
function denara_stmt_cache_key(
    int $challengeId,
    int $traderId,
    int $startMs,
    int $endMs,
    float $minRankBal,
    int $limit,
    string $branch
): string {
    return hash(
        'sha256',
        $challengeId . '|' . $traderId . '|' . $startMs . '|' . $endMs . '|' . $minRankBal . '|' . $limit . '|' . $branch
    );
}

function denara_stmt_cache_file(string $hashKey): string {
    return denara_stmt_cache_dir() . '/' . $hashKey . '.json';
}

/**
 * @return array<string,mixed>|null Full successful JSON body including ok/source/...
 */
function denara_stmt_cache_get(string $hashKey): ?array {
    $path = denara_stmt_cache_file($hashKey);
    if (!is_file($path)) {
        return null;
    }
    $raw = @file_get_contents($path);
    if ($raw === false || $raw === '') {
        return null;
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded) || !isset($decoded['exp'], $decoded['data']) || !is_array($decoded['data'])) {
        return null;
    }
    if (time() >= (int) $decoded['exp']) {
        @unlink($path);

        return null;
    }

    return $decoded['data'];
}

function denara_stmt_cache_set(string $hashKey, array $payload): void {
    $path = denara_stmt_cache_file($hashKey);
    $wrapped = [
        'exp'  => time() + DENARA_STMT_CACHE_TTL_SEC,
        'data' => $payload,
    ];
    $json = json_encode($wrapped, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return;
    }
    $dir = dirname($path);
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    $tmp = $path . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($tmp, $json, LOCK_EX) !== false) {
        @rename($tmp, $path);
    } else {
        @unlink($tmp);
    }
}

/** Server-wide mutex per challenge + trader (same viewer storm hits one Deriv pull). */
function denara_stmt_lock_name(int $challengeId, int $traderId): string {
    $name = DENARA_STMT_LOCK_PREFIX . $challengeId . '_' . $traderId;

    return strlen($name) <= 64 ? $name : substr(hash('sha256', $name), 0, 64);
}

function denara_stmt_lock_acquire(PDO $pdo, string $lockName): bool {
    $stmt = $pdo->prepare('SELECT GET_LOCK(?, ?)');
    $stmt->execute([$lockName, DENARA_STMT_LOCK_TIMEOUT_SEC]);

    return (int) $stmt->fetchColumn() === 1;
}

function denara_stmt_lock_release(PDO $pdo, string $lockName): void {
    try {
        $stmt = $pdo->prepare('SELECT RELEASE_LOCK(?)');
        $stmt->execute([$lockName]);
    } catch (Throwable $e) {
        // ignore
    }
}
