<?php
// helpers.php
declare(strict_types=1);

function body_json(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function sanitize_price($v) {
    if ($v === '' || $v === null) return null;
    $n = floatval($v);
    if ($n < 0 || $n > 5) return 'ERR';
    return number_format($n, 2, '.', '');
}

function positive_amount($v) {
    if ($v === '' || $v === null) return 0;
    $n = floatval($v);
    return $n >= 0 ? number_format($n, 2, '.', '') : 'ERR';
}
