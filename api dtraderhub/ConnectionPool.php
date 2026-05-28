<?php
declare(strict_types=1);

namespace Denara;

final class ConnectionPool {
    /** @var array<int, array{ws: DerivClient, authed_at:int, last_used:int}> */
    private static array $map = [];
    private const TTL_SEC = 120; // keep an authed socket alive for ~2 minutes

    public static function get(int $traderId, string $token, int $appId): DerivClient {
        $now = time();
        // reap stale
        foreach (self::$map as $id => $entry) {
            if ($now - $entry['last_used'] > self::TTL_SEC) {
                $entry['ws']->close();
                unset(self::$map[$id]);
            }
        }
        if (isset(self::$map[$traderId])) {
            self::$map[$traderId]['last_used'] = $now;
            return self::$map[$traderId]['ws'];
        }
        $ws = new DerivClient($appId);
        $ws->authorize($token); // authorize ONCE
        self::$map[$traderId] = [
            'ws'        => $ws,
            'authed_at' => $now,
            'last_used' => $now,
        ];
        return $ws;
    }

    public static function closeAll(): void {
        foreach (self::$map as $entry) {
            $entry['ws']->close();
        }
        self::$map = [];
    }
}
