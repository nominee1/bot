<?php
// public_html/api/pubkey.php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$env = [];
$envPath = __DIR__ . '/../.env';
if (!is_readable($envPath)) { http_response_code(500); echo json_encode(['ok'=>false,'error'=>'Missing .env']); exit; }
foreach (file($envPath, FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line) {
  if (strpos($line,'=')!==false && strpos(ltrim($line),'#')!==0) { [$k,$v]=array_map('trim',explode('=', $line,2)); $env[$k]=$v; }
}

// Prefer explicit public key; otherwise derive from private
$pub_pem = '';
if (!empty($env['RSA_PUB_PEM_PATH']) && is_readable($env['RSA_PUB_PEM_PATH'])) {
  $pub_pem = file_get_contents($env['RSA_PUB_PEM_PATH']) ?: '';
} elseif (!empty($env['RSA_PUB_PEM'])) {
  $pub_pem = $env['RSA_PUB_PEM'];
} else {
  $priv_pem = '';
  if (!empty($env['RSA_PRIV_PEM_PATH']) && is_readable($env['RSA_PRIV_PEM_PATH'])) {
    $priv_pem = file_get_contents($env['RSA_PRIV_PEM_PATH']) ?: '';
  } elseif (!empty($env['RSA_PRIV_PEM'])) {
    $priv_pem = $env['RSA_PRIV_PEM'];
  }
  if ($priv_pem !== '') {
    $pk = openssl_pkey_get_private($priv_pem);
    if ($pk) {
      $det = openssl_pkey_get_details($pk);
      if ($det && !empty($det['key'])) $pub_pem = $det['key']; // PEM (SPKI)
      openssl_free_key($pk);
    }
  }
}

if ($pub_pem === '') { http_response_code(500); echo json_encode(['ok'=>false,'error'=>'Missing RSA public key']); exit; }

echo json_encode([
  'ok' => true,
  'alg' => 'RSA-OAEP', // Use OAEP (SHA-1) in frontend for PHP compatibility
  'pem' => $pub_pem,
]);
