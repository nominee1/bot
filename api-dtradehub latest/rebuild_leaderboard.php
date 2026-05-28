<?php
declare(strict_types=1);

header('Content-Type: application/json');

require_once __DIR__ . '/util.php';

const DERIV_APP_ID = 36300;
const PAGE_SIZE = 100;
const DEFAULT_USERS_LIMIT = 500;
const OPTIONS_ORACLE_USERNAME = 'options_oracle';
const MIN_RANKING_START_BALANCE = 10;

// Wed 8 Apr 2026 09:00 EAT = 06:00 UTC
const TOURNAMENT_START_UTC_MS = 1775628000000;
// Wed 22 Apr 2026 09:00 EAT = 06:00 UTC
const TOURNAMENT_END_UTC_MS = 1776837600000;

function clampToTournament(int $ms): int {
    return min(max($ms, TOURNAMENT_START_UTC_MS), TOURNAMENT_END_UTC_MS);
}

function normalize(?string $s): string {
    return $s ? strtolower(str_replace('_', ' ', trim($s))) : '';
}

function epochMs($t): int {
    return is_numeric($t) ? ((int)$t * 1000) : 0;
}

function txMs(array $tx): int {
    return epochMs($tx['transaction_time'] ?? $tx['time'] ?? 0);
}

function txId(array $tx): string {
    return (string)($tx['id'] ?? $tx['transaction_id'] ?? $tx['contract_id'] ?? '');
}

function calcTurnoverFromTx(array $tx): float {
    $action = normalize($tx['action_type'] ?? '');
    $amt = isset($tx['amount']) && is_numeric($tx['amount']) ? (float)$tx['amount'] : 0.0;
    if ($action === 'buy' || $action === 'sell') return round(abs($amt), 2);
    return 0.0;
}

function getBalanceAfter(array $tx): ?float {
    if (isset($tx['balance_after']) && is_numeric($tx['balance_after'])) return (float)$tx['balance_after'];
    if (isset($tx['balance']) && is_numeric($tx['balance'])) return (float)$tx['balance'];
    return null;
}

function getDerivWsUrl(int $appId): string {
    return "wss://ws.derivws.com/websockets/v3?app_id={$appId}";
}

function wsSend(array $messages, int $timeoutSec = 20): array {
    $url = getDerivWsUrl(DERIV_APP_ID);

    $parts = parse_url($url);
    if (!$parts || empty($parts['host']) || empty($parts['path'])) {
        throw new RuntimeException('Bad websocket URL');
    }

    $scheme = $parts['scheme'] ?? 'wss';
    $host = $parts['host'];
    $port = ($scheme === 'wss') ? 443 : 80;
    $path = ($parts['path'] ?? '/') . (isset($parts['query']) ? '?' . $parts['query'] : '');

    $transport = ($scheme === 'wss') ? 'ssl' : 'tcp';
    $fp = stream_socket_client(
        "{$transport}://{$host}:{$port}",
        $errno,
        $errstr,
        $timeoutSec,
        STREAM_CLIENT_CONNECT
    );

    if (!$fp) {
        throw new RuntimeException("WebSocket connect failed: {$errstr} ({$errno})");
    }

    stream_set_timeout($fp, $timeoutSec);

    $key = base64_encode(random_bytes(16));
    $headers =
        "GET {$path} HTTP/1.1\r\n" .
        "Host: {$host}\r\n" .
        "Upgrade: websocket\r\n" .
        "Connection: Upgrade\r\n" .
        "Sec-WebSocket-Key: {$key}\r\n" .
        "Sec-WebSocket-Version: 13\r\n\r\n";

    fwrite($fp, $headers);

    $response = '';
    while (!str_contains($response, "\r\n\r\n")) {
        $chunk = fread($fp, 1024);
        if ($chunk === false || $chunk === '') break;
        $response .= $chunk;
    }

    if (!preg_match('#^HTTP/1\.[01] 101#', $response)) {
        fclose($fp);
        throw new RuntimeException('WebSocket handshake failed: ' . trim($response));
    }

    $out = [];

    foreach ($messages as $msg) {
        $payload = json_encode($msg, JSON_UNESCAPED_SLASHES);
        if ($payload === false) {
            fclose($fp);
            throw new RuntimeException('Failed to encode websocket payload');
        }

        fwrite($fp, wsEncodeFrame($payload));
        $reply = wsReadFrame($fp);

        if ($reply === null) {
            fclose($fp);
            throw new RuntimeException('No websocket response');
        }

        $json = json_decode($reply, true);
        if (!is_array($json)) {
            fclose($fp);
            throw new RuntimeException('Invalid websocket JSON: ' . substr($reply, 0, 200));
        }

        if (!empty($json['error'])) {
            $message = is_array($json['error']) ? ($json['error']['message'] ?? 'Unknown websocket error') : 'Unknown websocket error';
            fclose($fp);
            throw new RuntimeException($message);
        }

        $out[] = $json;
    }

    fclose($fp);
    return $out;
}

function wsEncodeFrame(string $payload): string {
    $length = strlen($payload);
    $mask = random_bytes(4);
    $frame = chr(0x81);

    if ($length <= 125) {
        $frame .= chr(0x80 | $length);
    } elseif ($length <= 65535) {
        $frame .= chr(0x80 | 126) . pack('n', $length);
    } else {
        $frame .= chr(0x80 | 127) . pack('NN', 0, $length);
    }

    $masked = '';
    for ($i = 0; $i < $length; $i++) {
        $masked .= $payload[$i] ^ $mask[$i % 4];
    }

    return $frame . $mask . $masked;
}

function wsReadBytes($fp, int $length): ?string {
    $data = '';
    while (strlen($data) < $length) {
        $chunk = fread($fp, $length - strlen($data));
        if ($chunk === false || $chunk === '') {
            $meta = stream_get_meta_data($fp);
            if (!empty($meta['timed_out'])) return null;
            return null;
        }
        $data .= $chunk;
    }
    return $data;
}

function wsReadFrame($fp): ?string {
    $header = wsReadBytes($fp, 2);
    if ($header === null || strlen($header) < 2) return null;

    $b1 = ord($header[0]);
    $b2 = ord($header[1]);

    $opcode = $b1 & 0x0F;
    $masked = ($b2 & 0x80) === 0x80;
    $length = $b2 & 0x7F;

    if ($length === 126) {
        $ext = wsReadBytes($fp, 2);
        if ($ext === null) return null;
        $length = unpack('n', $ext)[1];
    } elseif ($length === 127) {
        $ext = wsReadBytes($fp, 8);
        if ($ext === null) return null;
        $unpacked = unpack('N2', $ext);
        $length = ($unpacked[1] << 32) | $unpacked[2];
    }

    $mask = $masked ? wsReadBytes($fp, 4) : null;
    $payload = $length > 0 ? wsReadBytes($fp, $length) : '';
    if ($payload === null) return null;

    if ($masked && $mask !== null) {
        $decoded = '';
        for ($i = 0; $i < $length; $i++) {
            $decoded .= $payload[$i] ^ $mask[$i % 4];
        }
        $payload = $decoded;
    }

    if ($opcode === 0x8) return null; // close
    if ($opcode === 0x9) return wsReadFrame($fp); // ping
    return $payload;
}

function getTokenFromDB(string $baseUrl, string $username): array {
    $base = rtrim($baseUrl, '/');
    $url = $base . '/get_token.php?username=' . urlencode($username);
    $txt = file_get_contents($url);
    if ($txt === false) throw new RuntimeException("Failed to load token for {$username}");

    $data = json_decode($txt, true);
    if (!is_array($data) || empty($data['ok'])) {
        throw new RuntimeException($data['error'] ?? "Bad token response for {$username}");
    }
    return $data;
}

function listParticipantsFromApi(string $baseUrl, int $limit = DEFAULT_USERS_LIMIT, int $offset = 0): array {
    $base = rtrim($baseUrl, '/');
    $url = $base . '/list_participants.php?limit=' . $limit . '&offset=' . $offset;

    $txt = file_get_contents($url);
    if ($txt === false) throw new RuntimeException('Failed to load participants');

    $data = json_decode($txt, true);
    if (!is_array($data) || empty($data['ok'])) {
        throw new RuntimeException($data['error'] ?? 'Bad participants response');
    }

    return [
        'results' => $data['results'] ?? [],
        'total' => $data['total'] ?? 0,
    ];
}

function getOptionsOracleStatements(string $baseUrl, int $limit = 1000): array {
    $base = rtrim($baseUrl, '/');
    $url = $base . '/get_chance_statements.php?username=' . urlencode(OPTIONS_ORACLE_USERNAME) . '&limit=' . $limit;

    $txt = file_get_contents($url);
    if ($txt === false) throw new RuntimeException('Failed to load options_oracle statements');

    $data = json_decode($txt, true);
    if (!is_array($data) || empty($data['ok'])) {
        throw new RuntimeException($data['error'] ?? 'Bad options_oracle response');
    }

    return $data;
}

function promoteBaselineToMinBalance(array $rowsAsc, int $currentBaselineTime, ?float $currentBaselineBal, float $minBalance): array {
    if ($currentBaselineBal !== null && $currentBaselineBal >= $minBalance) {
        return [
            'baselineTime' => $currentBaselineTime,
            'baselineBal' => round($currentBaselineBal, 2),
        ];
    }

    foreach ($rowsAsc as $tx) {
        $tms = txMs($tx);
        if ($tms < $currentBaselineTime) continue;

        $bal = getBalanceAfter($tx);
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

function buildOptionsOracleMetricsFromRows(array $rows, int $startMs, int $endMs): array {
    $startClamped = clampToTournament($startMs);
    $endClamped = clampToTournament($endMs);

    $filtered = array_values(array_filter($rows, function ($tx) use ($startClamped, $endClamped) {
        $tms = txMs($tx);
        return $tms >= $startClamped && $tms <= $endClamped;
    }));

    usort($filtered, fn($a, $b) => txMs($a) <=> txMs($b));

    if (!$filtered) {
        return [
            'baselineTime' => $startClamped,
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

    $baselineBal = null;
    $baselineTime = txMs($first);

    $firstBal = isset($first['balance_after']) && is_numeric($first['balance_after']) ? (float)$first['balance_after'] : null;
    $firstAmt = isset($first['amount']) && is_numeric($first['amount']) ? (float)$first['amount'] : 0.0;
    $firstAction = normalize($first['action_type'] ?? '');

    if ($firstBal !== null) {
        $baselineBal = $firstAction === 'buy'
            ? round($firstBal - $firstAmt, 2)
            : round($firstBal, 2);
    }

    $promoted = promoteBaselineToMinBalance($filtered, $baselineTime, $baselineBal, MIN_RANKING_START_BALANCE);
    $baselineTime = $promoted['baselineTime'];
    $baselineBal = $promoted['baselineBal'];

    $trades = 0;
    $turnover = 0.0;

    foreach ($filtered as $tx) {
        $tms = txMs($tx);
        if ($tms <= $baselineTime) continue;

        $action = normalize($tx['action_type'] ?? '');
        if ($action === 'sell') $trades++;
        $turnover += calcTurnoverFromTx($tx);
    }

    $endBal = isset($last['balance_after']) && is_numeric($last['balance_after']) ? round((float)$last['balance_after'], 2) : null;
    $netPL = ($baselineBal !== null && $endBal !== null) ? round($endBal - $baselineBal, 2) : 0.0;

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

function fetchAllStatementsForToken(string $token, int $startMs, int $endMs): array {
    $dateFrom = (int)floor($startMs / 1000);
    $dateTo = (int)floor($endMs / 1000);

    $responses = wsSend([
        ['authorize' => $token]
    ]);

    $auth = $responses[0]['authorize'] ?? null;
    if (!$auth || empty($auth['loginid'])) {
        throw new RuntimeException('Authorization failed');
    }

    $currency = strtoupper((string)($auth['currency'] ?? 'USD'));
    if ($currency !== 'USD') {
        throw new RuntimeException("Non-USD ({$currency})");
    }

    $all = [];
    $offset = 0;

    while (true) {
        $res = wsSend([
            [
                'authorize' => $token
            ],
            [
                'statement' => 1,
                'description' => 0,
                'limit' => PAGE_SIZE,
                'offset' => $offset,
                'date_from' => $dateFrom,
                'date_to' => $dateTo,
            ]
        ]);

        $list = $res[1]['statement']['transactions'] ?? [];
        if (!is_array($list)) $list = [];

        foreach ($list as $tx) {
            $all[] = $tx;
        }

        $count = count($list);
        if ($count < PAGE_SIZE) break;
        $offset += $count;
    }

    usort($all, fn($a, $b) => txMs($a) <=> txMs($b));
    return $all;
}

function computeWindowMetrics(string $username, string $baseUrl, int $startMs, int $endMs): array {
    $startClamped = clampToTournament($startMs);
    $endClamped = clampToTournament($endMs);

    $tokenData = getTokenFromDB($baseUrl, $username);
    $token = (string)($tokenData['token'] ?? '');
    if ($token === '') throw new RuntimeException("No token for {$username}");

    $allRowsAsc = fetchAllStatementsForToken($token, $startClamped, $endClamped);

    if (!$allRowsAsc) {
        return [
            'baselineTime' => $startClamped,
            'baselineBal' => null,
            'netPL' => 0.0,
            'trades' => 0,
            'endBal' => null,
            'currency' => 'USD',
            'turnover' => 0.0,
        ];
    }

    $baselineTime = null;
    $baselineBal = null;

    foreach ($allRowsAsc as $tx) {
        $action = normalize($tx['action_type'] ?? '');
        $tms = txMs($tx);

        if ($action === 'deposit' || $action === 'withdrawal' || $action === 'transfer') {
            $baselineTime = $tms;
            $baselineBal = getBalanceAfter($tx);
            break;
        }
    }

    if ($baselineTime === null) {
        $baselineTime = $startClamped;
        $baselineBal = getBalanceAfter($allRowsAsc[0]);
    }

    $workingBaselineTime = $baselineTime;
    $workingBaselineBal = $baselineBal;

    foreach ($allRowsAsc as $tx) {
        $tms = txMs($tx);
        if ($tms <= $workingBaselineTime) continue;

        $action = normalize($tx['action_type'] ?? '');
        if ($action === 'deposit' || $action === 'withdrawal' || $action === 'transfer') {
            $workingBaselineTime = $tms;
            $workingBaselineBal = getBalanceAfter($tx);
        }
    }

    $promoted = promoteBaselineToMinBalance(
        $allRowsAsc,
        $workingBaselineTime,
        $workingBaselineBal,
        MIN_RANKING_START_BALANCE
    );

    $workingBaselineTime = $promoted['baselineTime'];
    $workingBaselineBal = $promoted['baselineBal'];

    $closedTrades = 0;
    $turnover = 0.0;

    foreach ($allRowsAsc as $tx) {
        $tms = txMs($tx);
        if ($tms <= $workingBaselineTime) continue;

        $action = normalize($tx['action_type'] ?? '');
        if ($action === 'deposit' || $action === 'withdrawal' || $action === 'transfer') {
            break;
        }

        if ($action === 'sell') $closedTrades++;
        $turnover += calcTurnoverFromTx($tx);
    }

    $last = $allRowsAsc[count($allRowsAsc) - 1];
    $endBal = getBalanceAfter($last);
    $endBal = $endBal !== null ? round($endBal, 2) : null;

    $netPL = ($workingBaselineBal !== null && $endBal !== null)
        ? round($endBal - $workingBaselineBal, 2)
        : 0.0;

    return [
        'baselineTime' => $workingBaselineTime,
        'baselineBal' => $workingBaselineBal,
        'netPL' => $netPL,
        'trades' => $closedTrades,
        'endBal' => $endBal,
        'currency' => 'USD',
        'turnover' => round($turnover, 2),
    ];
}

function saveLeaderboard(PDO $pdo, array $rows): void {
    $pdo->beginTransaction();

    try {
        $stmt = $pdo->prepare("
            INSERT INTO leaderboard_current
            (
                username,
                rank_position,
                start_balance,
                end_balance,
                net_pl,
                return_pct,
                trades,
                turnover,
                baseline_time,
                is_rank_eligible,
                reason
            )
            VALUES
            (
                :username,
                :rank_position,
                :start_balance,
                :end_balance,
                :net_pl,
                :return_pct,
                :trades,
                :turnover,
                :baseline_time,
                :is_rank_eligible,
                :reason
            )
            ON DUPLICATE KEY UPDATE
                rank_position = VALUES(rank_position),
                start_balance = VALUES(start_balance),
                end_balance = VALUES(end_balance),
                net_pl = VALUES(net_pl),
                return_pct = VALUES(return_pct),
                trades = VALUES(trades),
                turnover = VALUES(turnover),
                baseline_time = VALUES(baseline_time),
                is_rank_eligible = VALUES(is_rank_eligible),
                reason = VALUES(reason),
                updated_at = CURRENT_TIMESTAMP
        ");

        $seen = [];

        foreach ($rows as $row) {
            $seen[] = $row['username'];

            $stmt->execute([
                ':username' => $row['username'],
                ':rank_position' => $row['rank_position'],
                ':start_balance' => $row['start_balance'],
                ':end_balance' => $row['end_balance'],
                ':net_pl' => $row['net_pl'],
                ':return_pct' => $row['return_pct'],
                ':trades' => $row['trades'],
                ':turnover' => $row['turnover'],
                ':baseline_time' => $row['baseline_time'],
                ':is_rank_eligible' => $row['is_rank_eligible'],
                ':reason' => $row['reason'],
            ]);
        }

        if ($seen) {
            $placeholders = implode(',', array_fill(0, count($seen), '?'));
            $del = $pdo->prepare("DELETE FROM leaderboard_current WHERE username NOT IN ({$placeholders})");
            $del->execute($seen);
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

try {
    $pdo = pdo();

    $baseUrl = 'https://ttt.binaryke.com/api';
    $startMs = TOURNAMENT_START_UTC_MS;
    $endMs = TOURNAMENT_END_UTC_MS;

    $usersRes = listParticipantsFromApi($baseUrl, DEFAULT_USERS_LIMIT, 0);
    $users = $usersRes['results'];

    $hasOptionsOracle = false;
    foreach ($users as $u) {
        if (normalize($u['username'] ?? '') === OPTIONS_ORACLE_USERNAME) {
            $hasOptionsOracle = true;
            break;
        }
    }

    if (!$hasOptionsOracle) {
        array_unshift($users, [
            'id' => -999,
            'username' => OPTIONS_ORACLE_USERNAME,
        ]);
    }

    $stats = [];

    foreach ($users as $u) {
        $username = (string)($u['username'] ?? '');
        if ($username === '') continue;

        try {
            if (normalize($username) === OPTIONS_ORACLE_USERNAME) {
                $oracle = getOptionsOracleStatements($baseUrl, 1000);
                $metrics = buildOptionsOracleMetricsFromRows($oracle['statements'] ?? [], $startMs, $endMs);
            } else {
                $metrics = computeWindowMetrics($username, $baseUrl, $startMs, $endMs);
            }

            $isRankEligible =
                $metrics['baselineBal'] !== null &&
                $metrics['baselineBal'] >= MIN_RANKING_START_BALANCE &&
                $metrics['trades'] > 0;

            $returnPct = ($isRankEligible && $metrics['baselineBal'] > 0)
                ? round(($metrics['netPL'] / $metrics['baselineBal']) * 100, 6)
                : null;

            $stats[] = [
                'username' => $username,
                'rank_position' => null,
                'start_balance' => $metrics['baselineBal'],
                'end_balance' => $metrics['endBal'],
                'net_pl' => $metrics['netPL'],
                'return_pct' => $returnPct,
                'trades' => $metrics['trades'],
                'turnover' => $metrics['turnover'],
                'baseline_time' => $metrics['baselineTime'],
                'is_rank_eligible' => $isRankEligible ? 1 : 0,
                'reason' => $isRankEligible ? null : ('Minimum qualifying balance for ranking is ' . MIN_RANKING_START_BALANCE . ' USD'),
            ];
        } catch (Throwable $e) {
            $stats[] = [
                'username' => $username,
                'rank_position' => null,
                'start_balance' => null,
                'end_balance' => null,
                'net_pl' => 0.0,
                'return_pct' => null,
                'trades' => 0,
                'turnover' => 0.0,
                'baseline_time' => null,
                'is_rank_eligible' => 0,
                'reason' => $e->getMessage(),
            ];
        }
    }

    $eligible = array_values(array_filter($stats, fn($s) => (int)$s['is_rank_eligible'] === 1));

    usort($eligible, function ($a, $b) {
        $ra = $a['return_pct'] ?? -INF;
        $rb = $b['return_pct'] ?? -INF;
        if ($rb != $ra) return $rb <=> $ra;

        $na = $a['net_pl'] ?? -INF;
        $nb = $b['net_pl'] ?? -INF;
        if ($nb != $na) return $nb <=> $na;

        $ta = $a['trades'] ?? -INF;
        $tb = $b['trades'] ?? -INF;
        if ($tb != $ta) return $tb <=> $ta;

        return strcmp($a['username'], $b['username']);
    });

    $rankMap = [];
    foreach ($eligible as $i => $row) {
        $rankMap[$row['username']] = $i + 1;
    }

    foreach ($stats as &$row) {
        $row['rank_position'] = $rankMap[$row['username']] ?? null;
    }
    unset($row);

    saveLeaderboard($pdo, $stats);

    echo json_encode([
        'ok' => true,
        'count' => count($stats),
        'ranked_count' => count($eligible),
        'message' => 'Leaderboard rebuilt successfully',
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage(),
    ]);
}