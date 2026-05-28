<?php
// api/index.php
declare(strict_types=1);

/** ---- BOOTSTRAP (autoload + logging) ---- */
$vendor_autoload = __DIR__ . '/vendor/autoload.php';
if (is_file($vendor_autoload)) {
    require_once $vendor_autoload;
}

@ini_set('display_errors', '0');
@ini_set('log_errors', '1');
@ini_set('error_log', __DIR__ . '/php-error.log');

require_once __DIR__ . '/util.php';
require_once __DIR__ . '/MetricsService.php';
require_once __DIR__ . '/DerivClient.php';
require_once __DIR__ . '/CopyService.php';
require_once __DIR__ . '/PaymentService.php';
require_once __DIR__ . '/ChallengePaymentService.php';
require_once __DIR__ . '/CopiersBalancesController.php';

// Binaryke domain payment-only
require_once __DIR__ . '/BinarykePlans.php';
require_once __DIR__ . '/BinarykeDomainsRepo.php';

use Denara\MetricsService;
use Denara\CopyService;

cors();

$path   = path();
$method = method();

try {
    // ---------- ROUTES ----------

    if ($path === '/traders' && $method === 'GET') {
        list_traders();
    }

    elseif ($path === '/traders' && $method === 'POST') {
        create_trader();
    }

    elseif ($path === '/copiers' && $method === 'POST') {
        create_copier();
    }

    elseif ($path === '/traders/with-metrics' && $method === 'GET') {
        traders_with_metrics();
    }

    elseif (preg_match('#^/traders/(\d+)/summary$#', $path, $m) && $method === 'GET') {
        trader_summary((int)$m[1]);
    }

    elseif (preg_match('#^/traders/(\d+)/statements$#', $path, $m) && $method === 'GET') {
        statements_proxy((int)$m[1]);
    }

    // Copy control + relationships
    elseif ($path === '/copy/start' && $method === 'POST') {
        copy_start_handler();
    }

    elseif ($path === '/copy/stop' && $method === 'POST') {
        copy_stop_handler();
    }

    elseif ($path === '/relationships' && $method === 'GET') {
        list_relationships_handler();
    }

    // Existing copyservice payments
    elseif ($path === '/payments/prepare' && $method === 'POST') {
        payments_prepare_handler();
    }

    elseif ($path === '/payments/confirm' && $method === 'POST') {
        payments_confirm_handler();
    }

    // New paid challenge join payments
    elseif ($path === '/challenge/payments/prepare' && $method === 'POST') {
        challenge_payments_prepare_handler();
    }

    elseif ($path === '/challenge/payments/confirm' && $method === 'POST') {
        challenge_payments_confirm_handler();
    }

    // Binaryke domain payments
    elseif ($path === '/domains/payments/prepare' && $method === 'POST') {
        domains_payments_prepare_handler();
    }

    elseif ($path === '/domains/payments/confirm' && $method === 'POST') {
        domains_payments_confirm_handler();
    }

    // Active copiers live balances
    elseif (preg_match('#^/traders/(\d+)/copiers/balances$#', $path, $m) && $method === 'GET') {
        balances_handler((int)$m[1]);
    }

    // Health check
    elseif ($path === '/debug/ping' && $method === 'GET') {
        json([
            'ok' => true,
            'php' => PHP_VERSION,
            'autoloader' => is_file($vendor_autoload),
            'path' => $path,
        ]);
    }

    else {
        fail('Not Found', 404);
    }

} catch (Throwable $e) {
    $debug = isset($_GET['debug']) && $_GET['debug'] == '1';

    if ($debug) {
        json([
            'ok' => false,
            'error' => 'Server error',
            'detail' => $e->getMessage(),
        ], 500);
    }

    error_log((string)$e);
    fail('Server error', 500);
}

/** ===================== Helpers ===================== **/

function verify_token_is_real(string $token, int $appId = 76100): array {
    $ws = new \Denara\DerivClient($appId);

    try {
        $res  = $ws->authorize($token);
        $auth = $res['authorize'] ?? [];

        $loginid   = (string)($auth['loginid'] ?? '');
        $isVirtual = (int)($auth['is_virtual'] ?? 0) === 1;
        $looksDemo = str_starts_with($loginid, 'VRTC');

        if ($loginid === '') {
            throw new RuntimeException('Unable to authorize token. No loginid returned.');
        }

        if ($isVirtual || $looksDemo) {
            fail('Token must be a REAL account, not a demo/VRTC token.', 422);
        }

        return [
            'loginid'    => $loginid,
            'currency'   => $auth['currency'] ?? null,
            'is_virtual' => (bool)$isVirtual,
        ];
    } finally {
        $ws->close();
    }
}

/** ===================== Traders / Copiers ===================== **/

function list_traders(): void {
    $sql = "
        SELECT
          t.id,
          t.username,
          t.email,
          t.min_balance,
          t.price_usd,
          t.created_at,
          COALESCE(SUM(CASE WHEN r.active = 1 THEN 1 ELSE 0 END), 0) AS active_copiers
        FROM traders t
        LEFT JOIN relationships r ON r.trader_id = t.id
        GROUP BY t.id
        ORDER BY t.id DESC
        LIMIT 500
    ";

    $rows = pdo()->query($sql)->fetchAll();

    json($rows);
}

function create_trader(): void {
    $in = body_json();

    $username    = trim((string)($in['username'] ?? ''));
    $email       = trim((string)($in['email'] ?? ''));
    $min_balance = $in['min_balance'] ?? 0;
    $token_raw   = trim((string)($in['token'] ?? ''));
    $price_usd   = $in['price_usd'] ?? null;
    $password    = (string)($in['password'] ?? '');

    if ($username === '' || $token_raw === '') {
        fail('username and token are required', 422);
    }

    if (strlen($password) < 8) {
        fail('password must be at least 8 characters', 422);
    }

    if (strlen($password) > 72) {
        fail('password must be at most 72 characters', 422);
    }

    $password_hash = password_hash($password, PASSWORD_DEFAULT);

    if (!is_valid_username($username)) {
        fail('invalid username format. Use letters, numbers, _ or -, length 3–32.', 422);
    }

    if (!is_numeric($min_balance) || (float)$min_balance < 0) {
        fail('min_balance must be a number ≥ 0', 422);
    }

    if ($price_usd !== null) {
        if (!is_numeric($price_usd)) {
            fail('price_usd must be a number', 422);
        }

        $p = (float)$price_usd;

        if ($p < 0 || $p > 5) {
            fail('price_usd must be between 0 and 5, or null for free.', 422);
        }
    }

    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail('invalid email', 422);
    }

    $acct = verify_token_is_real($token_raw, 76100);
    $token_enc = token_encrypt_if_needed($token_raw);

    $pdo = pdo();

    try {
        $stmt = $pdo->prepare("
            INSERT INTO traders_competition_2
                (username, email, min_balance, token, price_usd, password_hash)
            VALUES
                (?, ?, ?, ?, ?, ?)
        ");

        $stmt->execute([
            $username,
            $email !== '' ? $email : null,
            (float)$min_balance,
            $token_enc,
            decimal_or_null($price_usd),
            $password_hash,
        ]);

    } catch (PDOException $e) {
        if (($e->errorInfo[1] ?? null) === 1062) {
            $msg = $e->getMessage();

            if (str_contains($msg, 'uq_traders_email')) {
                fail('email already exists', 409);
            }

            fail('username already exists', 409);
        }

        throw $e;
    }

    $id = (int)$pdo->lastInsertId();

    $row = $pdo->prepare("
        SELECT
          t.id,
          t.username,
          t.email,
          t.min_balance,
          t.price_usd,
          t.created_at,
          0 AS active_copiers
        FROM traders_competition_2 t
        WHERE t.id = ?
        LIMIT 1
    ");

    $row->execute([$id]);
    $out = $row->fetch();

    $out['account'] = $acct;

    json($out, 201);
}

function create_copier(): void {
    $in = body_json();

    $username  = trim((string)($in['username'] ?? ''));
    $token_raw = trim((string)($in['token'] ?? ''));

    if ($username === '' || $token_raw === '') {
        fail('username and token are required', 422);
    }

    if (!is_valid_username($username)) {
        fail('invalid username format. Use letters, numbers, _ or -, length 3–32.', 422);
    }

    $acct = verify_token_is_real($token_raw, 36300);
    $token_enc = token_encrypt_if_needed($token_raw);

    $pdo = pdo();

    try {
        $stmt = $pdo->prepare("
            INSERT INTO copiers
                (username, token)
            VALUES
                (?, ?)
        ");
        $stmt->execute([$username, $token_enc]);
    } catch (PDOException $e) {
        if (($e->errorInfo[1] ?? null) === 1062) {
            fail('username already exists', 409);
        }

        throw $e;
    }

    json([
        'ok' => true,
        'id' => (int)$pdo->lastInsertId(),
        'account' => $acct,
    ], 201);
}

/** ===================== Metrics ===================== **/

function traders_with_metrics(): void {
    $pdo = pdo();
    $svc = new MetricsService($pdo, 36300);

    [$from, $to] = $svc->monthWindow();
    $recompute = isset($_GET['recompute']) && $_GET['recompute'] == '1';

    $rows = $pdo->query("
        SELECT
          t.id,
          t.username,
          t.email,
          t.min_balance,
          t.price_usd,
          t.created_at,
          COALESCE(SUM(CASE WHEN r.active = 1 THEN 1 ELSE 0 END), 0) AS active_copiers
        FROM traders t
        LEFT JOIN relationships r ON r.trader_id = t.id
        GROUP BY t.id
        ORDER BY t.id DESC
        LIMIT 500
    ")->fetchAll(PDO::FETCH_ASSOC);

    foreach ($rows as &$r) {
        try {
            $m = $svc->getMetricsForTrader((int)$r['id'], $from, $to, $recompute);

            $r['kpi'] = [
                'currency'      => $m['currency'],
                'baseline_time' => $m['baseline_time'],
                'start_balance' => $m['start_balance'],
                'end_balance'   => $m['end_balance'],
                'net_pl'        => $m['net_pl'],
                'trades'        => $m['trades'],
                'wins'          => $m['wins'],
                'win_rate'      => $m['win_rate'],
                'growth_pct'    => $m['growth_pct'],
                'period_start'  => $m['period_start'],
                'period_end'    => $m['period_end'],
            ];
        } catch (Throwable $e) {
            $r['kpi'] = [
                'error'        => $e->getMessage(),
                'period_start' => $from,
                'period_end'   => $to,
            ];
        }

        usleep((120 + random_int(0, 100)) * 1000);
    }

    json($rows);
}

function trader_summary(int $trader_id): void {
    $pdo = pdo();
    $svc = new MetricsService($pdo, 36300);

    [$from, $to] = $svc->monthWindow();
    $recompute = isset($_GET['recompute']) && $_GET['recompute'] == '1';

    try {
        $m = $svc->getMetricsForTrader($trader_id, $from, $to, $recompute);

        json([
            'ok' => true,
            'summary' => $m,
        ]);
    } catch (Throwable $e) {
        fail($e->getMessage(), 400);
    }
}

function statements_proxy(int $trader_id): void {
    $pdo = pdo();

    $q = $pdo->prepare("
        SELECT token
        FROM traders
        WHERE id = ?
        LIMIT 1
    ");
    $q->execute([$trader_id]);

    $row = $q->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        fail('Trader not found', 404);
    }

    $plaintext_token = token_lazy_upgrade(
        $pdo,
        'traders',
        'id',
        $trader_id,
        trim((string)$row['token'])
    );

    $from   = isset($_GET['from'])   ? (int)$_GET['from']   : 0;
    $to     = isset($_GET['to'])     ? (int)$_GET['to']     : time();
    $limit  = isset($_GET['limit'])  ? max(1, min(100, (int)$_GET['limit'])) : 100;
    $offset = isset($_GET['offset']) ? max(0, (int)$_GET['offset']) : 0;

    $ws = new \Denara\DerivClient(36300);

    try {
        $ws->authorize($plaintext_token);

        $res = $ws->statement([
            'date_from'   => $from,
            'date_to'     => $to,
            'limit'       => $limit,
            'offset'      => $offset,
            'description' => 0,
        ]);

        json($res);
    } catch (Throwable $e) {
        fail($e->getMessage(), 400);
    } finally {
        $ws->close();
    }
}

/** ===================== Copy control + relationships ===================== */

function copy_start_handler(): void {
    $in = body_json();

    $trader_id       = (int)($in['trader_id'] ?? 0);
    $copier_username = trim((string)($in['copier_username'] ?? ''));

    if ($trader_id <= 0 || $copier_username === '') {
        fail('trader_id and copier_username are required', 422);
    }

    $svc = new CopyService(pdo(), 76100);

    try {
        $res = $svc->startCopy($trader_id, $copier_username);
        json($res, 200);
    } catch (Throwable $e) {
        fail($e->getMessage(), 400);
    }
}

function copy_stop_handler(): void {
    $in = body_json();

    $trader_id       = (int)($in['trader_id'] ?? 0);
    $copier_username = trim((string)($in['copier_username'] ?? ''));

    if ($trader_id <= 0 || $copier_username === '') {
        fail('trader_id and copier_username are required', 422);
    }

    $svc = new CopyService(pdo(), 76100);

    try {
        $res = $svc->stopCopy($trader_id, $copier_username);
        json($res, 200);
    } catch (Throwable $e) {
        fail($e->getMessage(), 400);
    }
}

function list_relationships_handler(): void {
    $trader_id = isset($_GET['trader_id']) ? (int)$_GET['trader_id'] : 0;

    if ($trader_id <= 0) {
        fail('trader_id is required', 422);
    }

    $svc = new CopyService(pdo(), 76100);

    try {
        $rows = $svc->listRelationships($trader_id);
        json($rows, 200);
    } catch (Throwable $e) {
        fail($e->getMessage(), 400);
    }
}

/** ===================== Existing Copyservice Payments ===================== */

function payments_prepare_handler(): void {
    $in = body_json();

    $trader_id       = (int)($in['trader_id'] ?? 0);
    $copier_username = trim((string)($in['copier_username'] ?? ''));

    if ($trader_id <= 0 || $copier_username === '') {
        fail('trader_id and copier_username are required', 422);
    }

    $svc = new \Denara\PaymentService(
        pdo(),
        76100,
        'CR5373440'
    );

    try {
        $res = $svc->prepare($trader_id, $copier_username);
        json($res, 200);
    } catch (Throwable $e) {
        fail($e->getMessage(), 400);
    }
}

function payments_confirm_handler(): void {
    $in = body_json();

    $invoice_id        = (int)($in['invoice_id'] ?? 0);
    $verification_code = trim((string)($in['verification_code'] ?? ''));

    if ($invoice_id <= 0 || $verification_code === '') {
        fail('invoice_id and verification_code are required', 422);
    }

    $svc = new \Denara\PaymentService(
        pdo(),
        76100,
        'CR5373440'
    );

    try {
        $res = $svc->confirmAndStart($invoice_id, $verification_code);
        json($res, 200);
    } catch (Throwable $e) {
        fail($e->getMessage(), 400);
    }
}

/** ===================== Paid Challenge Join Payments ===================== */

function challenge_payments_prepare_handler(): void {
    $in = body_json();

    $challenge_id = (int)($in['challenge_id'] ?? 0);
    $username = trim((string)($in['username'] ?? ''));

    if ($challenge_id <= 0) {
        fail('challenge_id is required', 422);
    }

    if ($username === '') {
        fail('username is required', 422);
    }

    $svc = new \Denara\ChallengePaymentService(
        pdo(),
        76100,
        'CR5373440'
    );

    try {
        $res = $svc->prepare($challenge_id, $username);
        json($res, 200);
    } catch (Throwable $e) {
        fail($e->getMessage(), 400);
    }
}

function challenge_payments_confirm_handler(): void {
    $in = body_json();

    $join_payment_id = (int)($in['join_payment_id'] ?? 0);
    $verification_code = trim((string)($in['verification_code'] ?? ''));

    if ($join_payment_id <= 0) {
        fail('join_payment_id is required', 422);
    }

    if ($verification_code === '') {
        fail('verification_code is required', 422);
    }

    $svc = new \Denara\ChallengePaymentService(
        pdo(),
        76100,
        'CR5373440'
    );

    try {
        $res = $svc->confirmAndJoin($join_payment_id, $verification_code);
        json($res, 200);
    } catch (Throwable $e) {
        fail($e->getMessage(), 400);
    }
}

/** ===================== Binaryke Domain Payments ===================== */

function domains_payments_prepare_handler(): void {
    $pdo2 = pdo_binaryke();
    $user = require_binaryke_user($pdo2);
    $in   = body_json();

    $domain = strtolower(trim((string)($in['domain'] ?? '')));
    $planId = trim((string)($in['plan_id'] ?? ''));
    $appId  = isset($in['app_id']) ? (int)$in['app_id'] : null;

    if ($domain === '') {
        fail('Missing domain', 422);
    }

    if (!is_valid_domain_name($domain)) {
        fail('Invalid domain format', 422);
    }

    try {
        $plan = BinarykePlans::get($planId);
    } catch (Throwable $e) {
        fail($e->getMessage(), 422);
    }

    $pdo2->beginTransaction();

    try {
        $ud = BinarykeDomainsRepo::upsertDomain($pdo2, (int)$user['id'], $domain, $appId);

        $inv = BinarykeDomainsRepo::createPendingInvoice(
            $pdo2,
            (int)$user['id'],
            (int)$ud['id'],
            (string)$plan['plan_id'],
            (float)$plan['amount'],
            (string)$plan['currency']
        );

        $pdo2->commit();
    } catch (Throwable $e) {
        $pdo2->rollBack();
        fail($e->getMessage(), 400);
    }

    $tokenEnc = trim((string)($user['deriv_token_enc'] ?? ''));

    if ($tokenEnc === '') {
        fail('User deriv token missing in Binaryke users table', 400);
    }

    [$derivToken, $wasPlain] = token_decrypt_or_plain($tokenEnc);

    $derivAppId = (int)(getenv('DERIV_APP_ID') ?: 76100);

    $ws = new \Denara\DerivClient($derivAppId);

    try {
        $auth = $ws->authorize($derivToken);

        $email = (string)($auth['authorize']['email'] ?? '');
        $loginid = (string)($auth['authorize']['loginid'] ?? '');

        if ($email === '') {
            fail('Could not read email from Deriv authorize.', 400);
        }

        $bal = $ws->balance(['account' => 'current']);

        $b = $bal['balance']['balance'] ?? null;
        $c = $bal['balance']['currency'] ?? null;

        if (!is_numeric($b) || !is_string($c) || $c === '') {
            fail('Could not read balance', 400);
        }

        $balance = (float)$b;
        $currency = (string)$c;

        if ($currency !== 'USD') {
            fail('Please switch to a USD account to pay.', 400);
        }

        if ($balance < (float)$plan['amount']) {
            fail('Insufficient balance to pay.', 400);
        }

        $ws->verifyEmail($email, 'paymentagent_withdraw');

        json([
            'success' => true,
            'invoice' => [
                'id' => (int)$inv['id'],
                'domain_id' => (int)$ud['id'],
                'domain' => $domain,
                'plan_id' => (string)$plan['plan_id'],
                'amount' => (float)$plan['amount'],
                'currency' => 'USD',
                'requires_otp' => 1,
                'status' => 'pending',
            ],
            'payer' => [
                'loginid' => $loginid,
                'email' => $email,
                'balance' => $balance,
                'currency' => $currency,
            ],
            'otp' => [
                'sent' => true,
                'to' => $email,
            ],
            'next_step' => 'POST /domains/payments/confirm with invoice_id and verification_code',
        ], 200);

    } finally {
        $ws->close();
    }
}

function domains_payments_confirm_handler(): void {
    $pdo2 = pdo_binaryke();
    $user = require_binaryke_user($pdo2);
    $in   = body_json();

    $invoiceId = (int)($in['invoice_id'] ?? 0);
    $code      = trim((string)($in['verification_code'] ?? ''));

    if ($invoiceId <= 0) {
        fail('Missing invoice_id', 422);
    }

    if ($code === '') {
        fail('Missing verification_code', 422);
    }

    $inv = BinarykeDomainsRepo::getInvoice($pdo2, $invoiceId);

    if ((int)$inv['user_id'] !== (int)$user['id']) {
        fail('Invoice does not belong to you', 403);
    }

    if ((string)$inv['status'] !== 'pending') {
        json([
            'success' => true,
            'mode' => 'payment_only',
            'message' => 'Invoice already settled.',
            'payment' => [
                'invoice_id' => (int)$inv['id'],
                'status' => (string)$inv['status'],
                'txid' => $inv['deriv_txid'] ?? null,
                'amount' => (float)$inv['amount_usd'],
                'currency' => (string)$inv['currency'],
                'paid_at' => $inv['paid_at'] ?? null,
            ],
        ], 200);
    }

    $tokenEnc = trim((string)($user['deriv_token_enc'] ?? ''));

    if ($tokenEnc === '') {
        fail('User deriv token missing in Binaryke users table', 400);
    }

    [$derivToken, $wasPlain] = token_decrypt_or_plain($tokenEnc);

    $derivAppId = (int)(getenv('DERIV_APP_ID') ?: 36300);
    $paLoginId  = (string)(getenv('PAYMENT_AGENT_LOGINID') ?: 'CR5373440');

    $lockKey = 'binaryke:domain_invoice:' . $invoiceId;

    $payload = [
        'paymentagent_loginid' => $paLoginId,
        'amount' => (float)$inv['amount_usd'],
        'currency' => (string)$inv['currency'],
        'verification_code' => $code,
    ];

    $response = null;
    $txid = null;

    try {
        $st = $pdo2->prepare("SELECT GET_LOCK(?, 12) AS got");
        $st->execute([$lockKey]);

        $row = $st->fetch();

        if (!isset($row['got']) || (int)$row['got'] !== 1) {
            fail('Busy: payment is already being processed. Try again.', 409);
        }

        $inv = BinarykeDomainsRepo::getInvoice($pdo2, $invoiceId);

        if ((string)$inv['status'] !== 'pending') {
            json([
                'success' => true,
                'mode' => 'payment_only',
                'message' => 'Invoice already settled.',
                'payment' => [
                    'invoice_id' => (int)$inv['id'],
                    'status' => (string)$inv['status'],
                    'txid' => $inv['deriv_txid'] ?? null,
                    'amount' => (float)$inv['amount_usd'],
                    'currency' => (string)$inv['currency'],
                    'paid_at' => $inv['paid_at'] ?? null,
                ],
            ], 200);
        }

        $ws = new \Denara\DerivClient($derivAppId);

        try {
            $ws->authorize($derivToken);

            $response = $ws->paymentAgentWithdraw(
                $paLoginId,
                (float)$inv['amount_usd'],
                (string)$inv['currency'],
                $code
            );

            $txid = $response['paymentagent_withdraw']['transaction_id'] ?? null;
        } finally {
            $ws->close();
        }

        $pdo2->beginTransaction();

        BinarykeDomainsRepo::markPaid(
            $pdo2,
            $invoiceId,
            $txid ? (string)$txid : null,
            $payload,
            is_array($response) ? $response : ['raw' => $response]
        );

        $pdo2->commit();

        try {
            $pdo2->prepare("SELECT RELEASE_LOCK(?)")->execute([$lockKey]);
        } catch (Throwable $x) {}

        $inv2 = BinarykeDomainsRepo::getInvoice($pdo2, $invoiceId);

        json([
            'success' => true,
            'mode' => 'payment_only',
            'message' => 'Payment received and saved. Domain purchase is disabled for testing.',
            'txid' => $inv2['deriv_txid'] ?? null,
            'payment' => [
                'invoice_id' => (int)$inv2['id'],
                'status' => (string)$inv2['status'],
                'amount' => (float)$inv2['amount_usd'],
                'currency' => (string)$inv2['currency'],
                'paid_at' => $inv2['paid_at'] ?? null,
            ],
        ], 200);

    } catch (Throwable $e) {
        if ($pdo2->inTransaction()) {
            try {
                $pdo2->rollBack();
            } catch (Throwable $x) {}
        }

        try {
            $pdo2->prepare("SELECT RELEASE_LOCK(?)")->execute([$lockKey]);
        } catch (Throwable $x) {}

        try {
            BinarykeDomainsRepo::audit($pdo2, $invoiceId, $payload, [
                'error' => $e->getMessage(),
            ]);
        } catch (Throwable $x) {}

        fail($e->getMessage(), 400);
    }
}

/** ===================== Active Copiers Balances ===================== */

function balances_handler(int $trader_id): void {
    if ($trader_id <= 0) {
        fail('trader_id is required', 422);
    }

    $onlyActive = (($_GET['active'] ?? '1') === '1');

    $pdo = pdo();
    $ws  = new \Denara\DerivClient(87874);

    try {
        $ctrl = new \Denara\CopiersBalancesController($pdo, $ws);
        $rows = $ctrl->listBalances($trader_id, $onlyActive);

        json($rows, 200);
    } catch (Throwable $e) {
        fail($e->getMessage(), 400);
    } finally {
        $ws->close();
    }
}