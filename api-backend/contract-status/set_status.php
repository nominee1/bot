<?php
require __DIR__ . '/config.php';
allow_cors();

if (($_POST['key'] ?? '') !== $SECRET) {
    http_response_code(401);
    echo json_encode(['ok'=>false,'error'=>'unauthorized']);
    exit;
}

$status = strtolower(trim($_POST['status'] ?? ''));
if (!in_array($status, ['ok','breached'], true)) {
    http_response_code(422);
    echo json_encode(['ok'=>false,'error'=>'status must be ok|breached']);
    exit;
}

$payload = [
    'status' => $status,
    'updated_at' => gmdate('c'),
];

file_put_contents($STORE_FILE, json_encode($payload, JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES));
header('Content-Type: application/json');
echo json_encode(['ok'=>true] + $payload);
