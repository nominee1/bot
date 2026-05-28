<?php
declare(strict_types=1);

// CORS
$allowed = ['https://www.denarapro.com','https://site.denaratool.com/','https://denarapro.com','https://localhost:8443'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed, true)) { header("Access-Control-Allow-Origin: $origin"); header('Vary: Origin'); }
header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$loginid = trim($_GET['loginid'] ?? '');
if ($loginid === '') { http_response_code(400); echo json_encode(['ok'=>false,'error'=>'loginid required']); exit; }

$limit  = isset($_GET['limit']) ? max(1,min(200,(int)$_GET['limit'])) : 50;
$offset = isset($_GET['offset'])? max(0,(int)$_GET['offset']) : 0;

$env = [];
foreach ([__DIR__.'/.env', __DIR__.'/../.env'] as $p) if (is_readable($p)) { foreach (file($p, FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line) {
  if (strpos($line,'=')!==false && strpos(ltrim($line),'#')!==0) { [$k,$v]=array_map('trim',explode('=',$line,2)); $env[$k]=$v; }
}} 

try {
  $pdo = new PDO("mysql:host={$env['DB_HOST']};dbname={$env['DB_NAME']};charset=utf8mb4", $env['DB_USER'], $env['DB_PASS'], [
    PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC
  ]);

  // metrics
  $meta = $pdo->prepare("SELECT username, start_ts, end_ts, start_balance, end_balance, net_pl, trades_count, updated_at
                         FROM user_comp_aggregates WHERE competition_id=1 AND loginid=?");
  $meta->execute([$loginid]);
  $summary = $meta->fetch();

  if (!$summary) { echo json_encode(['ok'=>true,'summary'=>null,'transactions'=>[],'total'=>0]); exit; }

  // statements inside window (newest first)
  $txSql = "SELECT transaction_id, action_type, amount, balance_after, transaction_time, reference_id, app_id
            FROM statements_raw
            WHERE loginid=? AND transaction_time BETWEEN ? AND ?
            ORDER BY transaction_time DESC, transaction_id DESC
            LIMIT ? OFFSET ?";
  $txStmt = $pdo->prepare($txSql);
  $txStmt->bindValue(1, $loginid, PDO::PARAM_STR);
  $txStmt->bindValue(2, (int)$summary['start_ts'], PDO::PARAM_INT);
  $txStmt->bindValue(3, (int)$summary['end_ts'], PDO::PARAM_INT);
  $txStmt->bindValue(4, (int)$limit, PDO::PARAM_INT);
  $txStmt->bindValue(5, (int)$offset, PDO::PARAM_INT);
  $txStmt->execute();
  $rows = $txStmt->fetchAll();

  $countStmt = $pdo->prepare("SELECT COUNT(*) c FROM statements_raw WHERE loginid=? AND transaction_time BETWEEN ? AND ?");
  $countStmt->execute([$loginid, (int)$summary['start_ts'], (int)$summary['end_ts']]);
  $total = (int)$countStmt->fetch()['c'];

  echo json_encode(['ok'=>true,'summary'=>$summary,'transactions'=>$rows,'total'=>$total,'limit'=>$limit,'offset'=>$offset]);
} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode(['ok'=>false,'error'=>'DB error']);
}
