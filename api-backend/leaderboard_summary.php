<?php
declare(strict_types=1);

// CORS
$allowed = ['https://www.denarapro.com','https://denarapro.com','https://www.denaradigitpro.com','https://site.denaratool.com/','https://localhost:8443'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowed, true)) { header("Access-Control-Allow-Origin: $origin"); header('Vary: Origin'); }
header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$env = [];
foreach ([__DIR__.'/.env', __DIR__.'/../.env'] as $p) if (is_readable($p)) { foreach (file($p, FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line) {
  if (strpos($line,'=')!==false && strpos(ltrim($line),'#')!==0) { [$k,$v]=array_map('trim',explode('=',$line,2)); $env[$k]=$v; }
}} 
try {
  $pdo = new PDO("mysql:host={$env['DB_HOST']};dbname={$env['DB_NAME']};charset=utf8mb4", $env['DB_USER'], $env['DB_PASS'], [
    PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC
  ]);

  $limit  = isset($_GET['limit']) ? max(1,min(200,(int)$_GET['limit'])) : 50;
  $offset = isset($_GET['offset'])? max(0,(int)$_GET['offset']) : 0;
  $q = trim($_GET['q'] ?? '');

  $where = 'WHERE competition_id=1';
  $params = [];

  if ($q !== '') { $where .= ' AND username LIKE :q'; $params[':q'] = "%$q%"; }

  $count = $pdo->prepare("SELECT COUNT(*) c FROM user_comp_aggregates $where");
  $count->execute($params);
  $total = (int)$count->fetch()['c'];

  $sql = "SELECT username, loginid, start_balance, end_balance, net_pl, trades_count, updated_at
          FROM user_comp_aggregates
          $where
          ORDER BY net_pl DESC, trades_count DESC, username ASC
          LIMIT :limit OFFSET :offset";
  $stmt = $pdo->prepare($sql);
  foreach ($params as $k=>$v) $stmt->bindValue($k,$v,PDO::PARAM_STR);
  $stmt->bindValue(':limit',$limit,PDO::PARAM_INT);
  $stmt->bindValue(':offset',$offset,PDO::PARAM_INT);
  $stmt->execute();

  echo json_encode(['ok'=>true,'results'=>$stmt->fetchAll(),'total'=>$total,'limit'=>$limit,'offset'=>$offset]);
} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode(['ok'=>false,'error'=>'DB error']);
}
