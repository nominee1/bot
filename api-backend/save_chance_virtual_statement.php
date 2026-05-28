<?php
declare(strict_types=1);

require_once __DIR__ . '/util.php';

cors();

if (method() !== 'POST') {
    fail('Method not allowed', 405);
}

try {
    $pdo = pdo();
    $data = body_json();

    $username = trim((string)($data['username'] ?? 'options_oracle'));
    $transaction_time = (int)($data['transaction_time'] ?? 0);
    $action_type = trim((string)($data['action_type'] ?? ''));
    $reference_id = trim((string)($data['reference_id'] ?? ''));
    $reference_type = trim((string)($data['reference_type'] ?? ''));
    $amount = isset($data['amount']) && is_numeric($data['amount']) ? (float)$data['amount'] : null;
    $balance_after = isset($data['balance_after']) && is_numeric($data['balance_after']) ? (float)$data['balance_after'] : null;

    if ($username === '') fail('username required');
    if (!in_array($action_type, ['buy','sell'], true)) fail('invalid action_type');
    if ($reference_id === '') fail('reference_id required');
    if ($reference_type === '') fail('reference_type required');
    if ($transaction_time <= 0) fail('invalid transaction_time');
    if ($amount === null) fail('amount required');
    if ($balance_after === null) fail('balance_after required');

    $stmt = $pdo->prepare("
        INSERT INTO chance_virtual_statements
        (username, transaction_time, action_type, reference_id, reference_type, amount, balance_after)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ");

    $stmt->execute([
        $username,
        $transaction_time,
        $action_type,
        $reference_id,
        $reference_type,
        $amount,
        $balance_after
    ]);

    json(['ok' => true]);

} catch (Throwable $e) {
    error_log($e->getMessage());
    fail($e->getMessage(), 400);
}