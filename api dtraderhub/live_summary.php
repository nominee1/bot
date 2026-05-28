<?php
// api/live_summary.php
declare(strict_types=1);

use WebSocket\Client;

header('Content-Type: application/json; charset=utf-8');

// --- CONFIG ---
const APP_ID = 36300;
const NAIROBI_OFFSET = 3 * 3600; // +03:00
const PAGE_SIZE = 100;
const APCU_TTL_SEC = 60; // short cache for repeated calls

// --- DB (adjust if you keep tokens elsewhere) ---
function db(): PDO {
  static $pdo = null;
  if ($pdo) return $pdo;
  $dsn = 'mysql:host=localhost;dbname=u822822525_copytrading;charset=utf8mb4';
  $pdo = new PDO($dsn, 'u822822525_unchained', 'bebina1@N', [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ]);
  return $pdo;
}
function get_trader_by_username(string $username): ?array {
  $st = db()->prepare('SELECT id, username, token FROM traders WHERE username = ? LIMIT 1');
  $st->execute([$username]);
  return $st->fetch() ?: null;
}
function get_trader_by_id(int $id): ?array {
  $st = db()->prepare('SELECT id, username, token FROM traders WHERE id = ? LIMIT 1');
  $st->execute([$id]);
  return $st->fetch() ?: null;
}

// --- helpers: time window (month start Nairobi -> now) ---
function month_window_epoch(): array {
  $now = time();
  // build month start at Nairobi local 00:00
  $dt = new DateTime('now', new DateTimeZone('Africa/Nairobi'));
  $dt->setDate((int)$dt->format('Y'), (int)$dt->format('m'), 1);
  $dt->setTime(0,0,0);
  $from = $dt->getTimestamp();        // Nairobi midnight
  $to   = $now;                        // current epoch (server)
  return [$from, $to];
}

// --- WS client with retry/backoff ---
class DerivWS {
  private Client $ws;
  private bool $authed = false;

  public function __construct() {
    $this->ws = new Client('wss://ws.binaryws.com/websockets/v3?app_id=' . APP_ID, ['timeout' => 20]);
  }
  public function close(): void {
    try { $this->ws->close(); } catch (\Throwable $e) {}
  }
  private function sendWithRetry(array $payload, int $retries = 5) {
    $attempt = 0;
    $base = 250; // ms
    while (true) {
      try {
        $this->ws->send(json_encode($payload, JSON_UNESCAPED_SLASHES));
        $raw = $this->ws->receive();
        $res = json_decode($raw, true);
        if (isset($res['error'])) {
          $code = strtolower((string)($res['error']['code'] ?? ''));
          $msg  = (string)($res['error']['message'] ?? 'Error');
          $isRate = str_contains($code, 'ratelimit') || str_contains(strtolower($msg), 'rate limit') || str_contains(strtolower($msg), 'throttle');
          if ($isRate) throw new RuntimeException('RATE_LIMIT:' . $msg);
          throw new RuntimeException($msg);
        }
        return $res;
      } catch (\Throwable $e) {
        $attempt++;
        $isRate = str_starts_with($e->getMessage(), 'RATE_LIMIT:');
        if (!$isRate || $attempt > $retries) throw $e;
        $sleepMs = (int)( $base * (2 ** ($attempt - 1)) + random_int(30, 120) );
        usleep($sleepMs * 1000);
      }
    }
  }
  public function authorize(string $token): array {
    $res = $this->sendWithRetry(['authorize' => $token, 'app_id' => APP_ID]);
    if (!isset($res['authorize']['loginid'])) throw new RuntimeException('Authorization failed');
    $this->authed = true;
    return $res;
  }
  public function statement(array $args): array {
    if (!$this->authed) throw new RuntimeException('Not authorized');
    $payload = array_merge(['statement' => 1, 'description' => 0, 'limit' => PAGE_SIZE, 'offset' => 0], $args);
    return $this->sendWithRetry($payload);
  }
}

// --- metrics compute (mirrors your React computeWindowMetrics) ---
function compute_mtd_metrics(string $username, ?int $traderId = null): array {
  [$from, $to] = month_window_epoch();

  // tiny APCu guard
  $cacheKey = "mtd:{$username}:{$from}:{$to}";
  if (function_exists('apcu_fetch')) {
    $hit = apcu_fetch($cacheKey, $ok);
    if ($ok && is_array($hit)) return $hit + ['cached' => true];
  }

  $row = $traderId ? get_trader_by_id($traderId) : get_trader_by_username($username);
  if (!$row || empty($row['token'])) throw new RuntimeException('Trader/token not found');

  $ws = new DerivWS();
  try {
    $auth = $ws->authorize($row['token']);
    $acct = $auth['authorize'] ?? [];
    $currency = $acct['currency'] ?? 'USD';
    if ($currency !== 'USD') throw new RuntimeException("Non-USD ($currency)");

    // find baseline: first CASH_FLOW (deposit/withdraw/transfer) after month start; else balance just before window
    $cash = ['deposit' => true, 'withdrawal' => true, 'transfer' => true];

    $baselineTime = null;
    $baselineBal  = null;
    $closedTrades = 0;

    $offset = 0;
    $hasMore = true;

    // pass 1: scan window for first cashflow to set baseline
    while ($hasMore && $baselineTime === null) {
      $res = $ws->statement([
        'date_from' => $from,
        'date_to'   => $to,
        'limit'     => PAGE_SIZE,
        'offset'    => $offset,
      ]);
      $list = $res['statement']['transactions'] ?? [];
      $cnt = count($list);
      $hasMore = ($cnt === PAGE_SIZE);
      $offset += $cnt;

      foreach ($list as $t) {
        $act = strtolower(str_replace('_',' ', (string)($t['action_type'] ?? '')));
        $tms = (int)(($t['transaction_time'] ?? $t['time'] ?? 0) * 1000);
        if (isset($cash[$act])) {
          $baselineTime = $tms;
          if (isset($t['balance_after']) && is_numeric($t['balance_after'])) {
            $baselineBal = (float)$t['balance_after'];
          } else {
            // fetch balance just after this tx
            $rs = $ws->statement(['limit' => 1, 'offset' => 0, 'date_to' => (int)floor(($tms/1000) + 1)]);
            $tx0 = $rs['statement']['transactions'][0] ?? null;
            $baselineBal = isset($tx0['balance_after']) ? (float)$tx0['balance_after'] : null;
          }
          break;
        }
      }
    }

    if ($baselineTime === null) {
      // No cashflow this month; take balance just before window
      $rs = $ws->statement(['limit' => 1, 'offset' => 0, 'date_to' => $from]);
      $t0 = $rs['statement']['transactions'][0] ?? null;
      $baselineBal = isset($t0['balance_after']) ? (float)$t0['balance_after'] : null;
      $baselineTime = (int)$from * 1000;
    }

    // end balance at 'to'
    $endBal = null;
    try {
      $rs = $ws->statement(['limit' => 1, 'offset' => 0, 'date_to' => $to]);
      $txE = $rs['statement']['transactions'][0] ?? null;
      $endBal = isset($txE['balance_after']) ? (float)$txE['balance_after'] : null;
    } catch (\Throwable $e) {}

    // pass 2: from baseline -> to, count closed trades + ensure last baseline if later cashflow occurs
    $res2 = $ws->statement([
      'date_from' => (int)floor(($baselineTime ?? ($from*1000))/1000),
      'date_to'   => $to,
      'limit'     => PAGE_SIZE,
      'offset'    => 0,
    ]);
    $list2 = $res2['statement']['transactions'] ?? [];
    $win = 0; $trades = 0;

    foreach ($list2 as $t) {
      $act = strtolower(str_replace('_',' ', (string)($t['action_type'] ?? '')));
      $tms = (int)(($t['transaction_time'] ?? $t['time'] ?? 0) * 1000);

      if (isset($cash[$act]) && $tms > ($baselineTime ?? 0)) {
        // move baseline forward to latest cashflow
        $baselineTime = $tms;
        if (isset($t['balance_after'])) $baselineBal = (float)$t['balance_after'];
        else {
          $rs = $ws->statement(['limit' => 1, 'offset' => 0, 'date_to' => (int)floor(($tms/1000) + 1)]);
          $tx0 = $rs['statement']['transactions'][0] ?? null;
          $baselineBal = isset($tx0['balance_after']) ? (float)$tx0['balance_after'] : $baselineBal;
        }
      } elseif ($act === 'sell') {
        $trades++;
        $amt = (float)($t['amount'] ?? 0.0);
        if ($amt > 0) $win++;
      }
    }

    $netPL = (is_numeric($endBal) && is_numeric($baselineBal)) ? ($endBal - $baselineBal) : 0.0;
    $growth = (is_numeric($baselineBal) && $baselineBal > 0) ? ($netPL / $baselineBal * 100.0) : null;
    $winRate = $trades > 0 ? ($win / $trades * 100.0) : 0.0;

    $out = [
      'ok'            => true,
      'username'      => $row['username'],
      'currency'      => $currency,
      'period_start'  => $from,
      'period_end'    => $to,
      'baseline_time' => $baselineTime,
      'start_balance' => $baselineBal,
      'end_balance'   => $endBal,
      'net_pl'        => $netPL,
      'growth_pct'    => $growth,
      'trades'        => $trades,
      'wins'          => $win,
      'win_rate'      => $winRate,
    ];

    if (function_exists('apcu_store')) apcu_store($cacheKey, $out, APCU_TTL_SEC);
    return $out;

  } finally {
    $ws->close();
  }
}

// --- routing ---
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
  // GET /api/live/summary?username=:u or ?id=:id
  if ($method === 'GET' && preg_match('~/api/live/summary$~', $path)) {
    $u = $_GET['username'] ?? '';
    $id = isset($_GET['id']) ? (int)$_GET['id'] : null;
    if (!$u && !$id) throw new RuntimeException('username or id is required');
    $res = compute_mtd_metrics($u ?: '', $id);
    echo json_encode($res, JSON_PRETTY_PRINT); exit;
  }

  // GET /api/live/statements?username=:u&from=..&to=..&limit=&offset=
  if ($method === 'GET' && preg_match('~/api/live/statements$~', $path)) {
    $u = $_GET['username'] ?? '';
    $id = isset($_GET['id']) ? (int)$_GET['id'] : null;
    if (!$u && !$id) throw new RuntimeException('username or id is required');

    $row = $id ? get_trader_by_id($id) : get_trader_by_username($u);
    if (!$row || empty($row['token'])) throw new RuntimeException('Trader/token not found');

    [$defFrom, $defTo] = month_window_epoch();
    $from = isset($_GET['from']) ? (int)$_GET['from'] : $defFrom;
    $to   = isset($_GET['to'])   ? (int)$_GET['to']   : $defTo;
    $limit = max(1, min(100, (int)($_GET['limit'] ?? 100)));
    $offset = max(0, (int)($_GET['offset'] ?? 0));

    $ws = new DerivWS();
    try {
      $ws->authorize($row['token']);
      $res = $ws->statement([
        'date_from' => $from,
        'date_to'   => $to,
        'limit'     => $limit,
        'offset'    => $offset,
        'description' => 0,
      ]);
      echo json_encode($res, JSON_PRETTY_PRINT); exit;
    } catch (\Throwable $e) {
      if (str_starts_with($e->getMessage(), 'RATE_LIMIT:')) {
        header('Retry-After: 2', true, 429);
        echo json_encode(['error' => 'rate_limited', 'message' => substr($e->getMessage(), 11)], JSON_PRETTY_PRINT); exit;
      }
      throw $e;
    } finally {
      $ws->close();
    }
  }

  http_response_code(404);
  echo json_encode(['error' => 'Not found']);
} catch (\Throwable $e) {
  http_response_code(400);
  echo json_encode(['error' => $e->getMessage()]);
}
