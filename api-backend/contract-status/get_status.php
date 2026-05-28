<?php
require __DIR__ . '/config.php';
allow_cors();

header('Content-Type: application/json');
header('Cache-Control: no-cache, no-store, must-revalidate');

if (!file_exists($STORE_FILE)) {
    echo json_encode(['status'=>'ok','updated_at'=>gmdate('c')]);
    exit;
}

$raw = @file_get_contents($STORE_FILE);
$data = json_decode($raw ?: '', true);
if (!is_array($data) || !isset($data['status'])) {
    $data = ['status'=>'ok','updated_at'=>gmdate('c')];
}
echo json_encode($data);
