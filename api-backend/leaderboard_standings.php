<?php
// ttt.binaryke.com/api/leaderboard_standings.php
declare(strict_types=1);

/*
  Returns a paged leaderboard with per-user balances & P/L for a given window.
  Query:
    start_ts (required, epoch seconds)
    end_ts   (required, epoch seconds)
    limit    (default 20, max 100)
    offset   (default 0)
    q        (optional username search)
*/

header('Content-Type: application/json; charset=utf-8');

// ---- CORS ----
$allowed = ['https://www.denarapro.com','https://denarapro.com','https://www.denaradigitpro.com','https://site.denaratool.com','https://localhost:8443'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed, true)) {
  header("Access-Control-Allow-Origin: $origin");
  header('Vary: Origin');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ---- Load .env from /api or parent ----
$env = [];
$envPaths = [__DIR__.'/.env', __DIR__.'/../.env'];
$envPathFound = null;
foreach ($envPaths as $p) if (is_readable($p)) { $envPathFound = $p; break; }
if (!$envPathFound) { http_response_code(500); echo json_encode(['ok'=>false,'error'=>'Missing .env']); exit; }
foreach (file($envPathFound, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
  if (strpos($line,'=')!==false && strpos(ltrim($line),'#')!==0) { [$k,$v]=array_map('trim',explode('=',$line,2)); $env[$k]=$v; }
}

// ---- DB config & ENC key ----
$db_host = $env['DB_HOST'] ?? 'localhost';
$db_name = $env['DB_NAME'] ?? '';
$db_user = $env['DB_USER'] ?? '';
$db_pass = $env['DB_PASS'] ?? '';
$enc_key = !empty($env['ENC_KEY_B64']) ? (base64_decode($env['ENC_KEY_B64'], true) ?: '') : ($env['ENC_KEY'] ?? '');
if (strlen($enc_key) !== 32) { http_response_code(500); echo json_encode(['ok'=>false,'error'=>'Invalid ENC key']); exit; }

// ---- Params ----
$start_ts = isset($_GET['start_ts']) ? (int)$_GET['start_ts'] : 0;
$end_ts   = isset($_GET['end_ts'])   ? (int)$_GET['end_ts']   : 0;
if ($start_ts <= 0 || $end_ts <= 0 || $end_ts <= $start_ts) {
  http_response_code(400); echo json_encode(['ok'=>false,'error'=>'start_ts and end_ts required (epoch seconds)']); exit;
}
$limit  = isset($_GET['limit'])  ? max(1, min(100, (int)$_GET['limit'])) : 20;
$offset = isset($_GET['offset']) ? max(0, (int)$_GET['offset']) : 0;
$q      = trim($_GET['q'] ?? '');

// ---- Helpers ----
function deriv_request(string $token, array $payload): array {
  $ch = curl_init('https://api.deriv.com/binary');
  $headers = ['Content-Type: application/json'];
  $payload['req_id'] = $payload['req_id'] ?? random_int(100000, 999999);
  $payload['token']  = $token;
  curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 20,
  ]);
  $res = curl_exec($ch);
  if ($res === false) return ['error'=>['message'=>'curl error']];
  return json_decode($res, true) ?: ['error'=>['message'=>'bad json']];
}

function decrypt_token(string $cipher, string $iv, string $tag, string $key): ?string {
  $pt = openssl_decrypt($cipher, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
  return $pt === false ? null : $pt;
}

// Counted vs excluded actions for competition P/L
$COUNTED = ['buy','sell','adjustment','hold','release','virtual_credit'];
$EXCLUDED= ['deposit','withdrawal','transfer'];

// ---- DB connection ----
try {
  $pdo = new PDO("mysql:host={$db_host};dbname={$db_name};charset=utf8mb4",$db_user,$db_pass,[
    PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,
  ]);

  $params = [];
  $where  = '';
  if ($q !== '') { $where = 'WHERE username LIKE :q'; $params[':q'] = "%$q%"; }

  $countStmt = $pdo->prepare("SELECT COUNT(*) AS c FROM participants {$where}");
  $countStmt->execute($params);
  $total = (int)($countStmt->fetch()['c'] ?? 0);

  $sql = "SELECT id, username, token_cipher, token_iv, token_tag FROM participants {$where}
          ORDER BY created_at DESC, username ASC
          LIMIT :limit OFFSET :offset";
  $stmt = $pdo->prepare($sql);
  foreach ($params as $k=>$v) $stmt->bindValue($k,$v,PDO::PARAM_STR);
  $stmt->bindValue(':limit',$limit,PDO::PARAM_INT);
  $stmt->bindValue(':offset',$offset,PDO::PARAM_INT);
  $stmt->execute();
  $rows = $stmt->fetchAll();

  $out = [];
  foreach ($rows as $r) {
    $cipher = $r['token_cipher']; $iv = $r['token_iv']; $tag = $r['token_tag'];
    $token = decrypt_token($cipher, $iv, $tag, $enc_key);
    if (!$token) { $out[] = ['username'=>$r['username'],'error'=>'token_decrypt_failed']; continue; }

    // A) start balance (last tx <= start_ts)
    $startRes = deriv_request($token, [
      'statement'=>1, 'description'=>0, 'limit'=>1, 'offset'=>0, 'date_to'=>$start_ts
    ]);
    $startBal = null;
    if (!empty($startRes['statement']['transactions'][0])) {
      $t = $startRes['statement']['transactions'][0];
      $startBal = $t['balance_after'] ?? ($t['balance'] ?? null);
    }

    // B) end balance (last tx <= end_ts)
    $endRes = deriv_request($token, [
      'statement'=>1, 'description'=>0, 'limit'=>1, 'offset'=>0, 'date_to'=>$end_ts
    ]);
    $endBal = null;
    if (!empty($endRes['statement']['transactions'][0])) {
      $t = $endRes['statement']['transactions'][0];
      $endBal = $t['balance_after'] ?? ($t['balance'] ?? null);
    }

    // C) net P/L + trades in window [start_ts, end_ts]
    $netPL = 0.0; $trades = 0; $offsetWin = 0; $PAGE = 250;
    while (true) {
      $winRes = deriv_request($token, [
        'statement'=>1, 'description'=>0, 'limit'=>$PAGE, 'offset'=>$offsetWin,
        'date_from'=>$start_ts, 'date_to'=>$end_ts
      ]);
      $list = $winRes['statement']['transactions'] ?? [];
      if (!$list) break;
      foreach ($list as $tx) {
        $a = strtolower((string)($tx['action_type'] ?? ''));
        $amt = (float)($tx['amount'] ?? 0);
        if (in_array($a, $COUNTED, true)) {
          $netPL += $amt;
          if ($a === 'buy' || $a === 'sell') $trades++;
        }
      }
      if (count($list) < $PAGE) break;
      $offsetWin += count($list);
    }

    $out[] = [
      'username' => $r['username'],
      'starting_balance' => is_numeric($startBal) ? (float)$startBal : null,
      'current_balance'  => is_numeric($endBal)   ? (float)$endBal   : null,
      'net_pl'  => round($netPL, 2),
      'trades'  => $trades,
    ];
  }

  echo json_encode(['ok'=>true,'total'=>$total,'limit'=>$limit,'offset'=>$offset,'results'=>$out]);

} catch
