<?php
// save_deriv_user.php  (e.g. public_html/api/save_deriv_user.php)
require __DIR__ . '/../db.php';


/* -------- basic API hygiene -------- */
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: https://denarapro.com');  // tighten!
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST only']);  exit;
}

/* -------- read & validate JSON body -------- */
$data = json_decode(file_get_contents('php://input'), true);

$email     = filter_var($data['email']      ?? '', FILTER_VALIDATE_EMAIL);
$login_id  = preg_replace('/[^A-Za-z0-9]/', '', $data['login_id']  ?? '');
$full_name = trim(filter_var($data['full_name'] ?? '', FILTER_SANITIZE_STRING));

if (!$email || !$login_id || $full_name === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid payload']);  exit;
}

/* -------- insert or update -------- */
$stmt = $pdo->prepare(
    "INSERT INTO deriv_users (login_id, email, full_name, first_seen, last_seen)
     VALUES (:login_id, :email, :full_name, NOW(), NOW())
     ON DUPLICATE KEY
     UPDATE email = VALUES(email),
            full_name = VALUES(full_name),
            last_seen = NOW()"
);
$stmt->execute([
    ':login_id'  => $login_id,
    ':email'     => $email,
    ':full_name' => $full_name,
]);

echo json_encode(['status' => 'ok']);
