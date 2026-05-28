<?php
declare(strict_types=1);

namespace Denara;

final class Backoff {
    public static function with(callable $fn, int $maxTries = 4, int $baseMs = 250) {
        $attempt = 0;
        $delay = $baseMs;
        while (true) {
            try {
                return $fn();
            } catch (\Throwable $e) {
                $msg = strtolower($e->getMessage() ?? '');
                $maybeRate = (
                    strpos($msg, 'rate') !== false ||
                    strpos($msg, 'throttle') !== false ||
                    strpos($msg, 'too many') !== false ||
                    strpos($msg, 'limit') !== false
                );
                if (!$maybeRate || $attempt >= $maxTries - 1) {
                    throw $e;
                }
                usleep(($delay + random_int(0, 100)) * 1000); // jitter
                $delay *= 2;
                $attempt++;
            }
        }
    }
}
