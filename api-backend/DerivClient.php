<?php
declare(strict_types=1);

namespace Denara;

use WebSocket\Client;

class DerivClient {
    private Client $ws;
    private string $endpoint;
    private int $appId;

    /**
     * @param int    $appId    Must match the Deriv app used to create the API token(s)
     * @param string $endpoint Official Deriv WebSocket base (same host as browser/clients)
     */
    public function __construct(
        int $appId = 87874,
        string $endpoint = 'wss://ws.derivws.com/websockets/v3'
    ) {
        $this->appId = $appId;

        // Normalize endpoint and build URL with ?app_id=...
        $ep = rtrim($endpoint);
        // remove any existing app_id query param if present
        $ep = preg_replace('~([?&])app_id=[^&]*~', '$1', $ep);
        $ep = rtrim($ep, '?&');

        $sep = str_contains($ep, '?') ? '&' : '?';
        $url = $ep . $sep . 'app_id=' . $this->appId;

        $this->endpoint = $ep;

        if (!class_exists(\WebSocket\Client::class, true)) {
            throw new \RuntimeException(
                'Missing Composer package textalk/websocket (class WebSocket\\Client). '
                . 'SSH into the API directory, run `composer install`, and deploy the `vendor` folder next to util.php. '
                . 'Ensure util.php loads vendor/autoload.php (see top of util.php).'
            );
        }

        $this->ws = new Client($url, ['timeout' => 12]);
    }

    /** Close socket (safe) */
    public function close(): void {
        try { $this->ws->close(); } catch (\Throwable $e) {}
    }

    /** ---- Low-level request/response helper ---- */
    private function send(array $payload): array {
        $this->ws->send(json_encode($payload, JSON_UNESCAPED_SLASHES));
        $raw  = $this->ws->receive();
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw new \RuntimeException('Bad WS JSON');
        }
        if (!empty($data['error'])) {
            $code = $data['error']['code']    ?? 'DerivError';
            $msg  = $data['error']['message'] ?? 'Deriv error';
            throw new \RuntimeException("$code: $msg");
        }
        return $data;
    }

    /** ====================== Generic API helpers ====================== */

    /** Authorize the session with a token. Returns the authorize payload. */
    public function authorize(string $token): array {
        return $this->send(['authorize' => $token]);
    }

    /** Account balance snapshot for current authorized account. */
    public function balance(array $args = []): array {
        $args['balance'] = 1;
        $args['account'] = $args['account'] ?? 'current';
        return $this->send($args);
    }

    /** Fetch statement for the current authorized account. */
    public function statement(array $args): array {
        $args['statement']   = 1;
        $args['description'] = $args['description'] ?? 0;
        return $this->send($args);
    }

    /** Trigger email OTP (e.g., for paymentagent_withdraw). */
    public function verifyEmail(string $email, string $type = 'paymentagent_withdraw'): array {
        return $this->send([
            'verify_email' => $email,
            'type'         => $type,
        ]);
    }

    /** ====================== Settings helpers ====================== */

    /** Get account settings for the authorized session. */
    public function getSettings(): array {
        return $this->send(['get_settings' => 1]);
    }

    /**
     * Set allow_copiers.
     * - true  => account is a LEADER (others can copy you)
     * - false => account is a FOLLOWER (you can copy others)
     */
    public function setAllowCopiers(bool $allow = true): array {
        return $this->send([
            'set_settings'  => 1,
            'allow_copiers' => $allow ? 1 : 0,
        ]);
    }

    /** Ensure this session is a FOLLOWER (allow_copiers = 0). */
    public function ensureFollower(): void {
        $settings = $this->getSettings();
        $current  = $settings['get_settings']['allow_copiers'] ?? null;
        if ($current !== 0) {
            $this->setAllowCopiers(false);
        }
    }

    /** Ensure this session is a LEADER (allow_copiers = 1). */
    public function ensureLeader(): void {
        $settings = $this->getSettings();
        $current  = $settings['get_settings']['allow_copiers'] ?? null;
        if ($current !== 1) {
            $this->setAllowCopiers(true);
        }
    }

    /** ====================== Copy trading helpers ====================== */

    /**
     * Start copying the trader specified by $traderToken.
     * Preferred modern form is with "trader_token", but some stacks reject it.
     * We try modern first; on InputValidationFailed we fall back to legacy shape.
     */
    public function copyStart(string $traderToken): array {
        try {
            // Attempt modern payload
            return $this->send([
                'copy_start'   => 1,
                'trader_token' => $traderToken,
            ]);
        } catch (\RuntimeException $e) {
            if ($this->isInputValidation($e)) {
                // Fallback to legacy: {"copy_start":"<token>"}
                return $this->send([
                    'copy_start' => $traderToken,
                ]);
            }
            throw $e;
        }
    }

    /**
     * Stop copying the trader specified by $traderToken.
     * Same dual-shape logic as copyStart.
     */
    public function copyStop(string $traderToken): array {
        try {
            // Attempt modern payload
            return $this->send([
                'copy_stop'    => 1,
                'trader_token' => $traderToken,
            ]);
        } catch (\RuntimeException $e) {
            if ($this->isInputValidation($e)) {
                // Fallback to legacy: {"copy_stop":"<token>"}
                return $this->send([
                    'copy_stop' => $traderToken,
                ]);
            }
            throw $e;
        }
    }

    /** ====================== Payment Agent ====================== */

    /** Payment agent withdraw (run on the account that is withdrawing). */
    public function paymentAgentWithdraw(
        string $paymentagent_loginid,
        float $amount,
        string $currency,
        string $verification_code
    ): array {
        return $this->send([
            'paymentagent_withdraw' => 1,
            'paymentagent_loginid'  => $paymentagent_loginid,
            'amount'                => $amount,
            'currency'              => $currency,
            'verification_code'     => $verification_code,
        ]);
    }

    /**
     * Send funds from the authorized payment-agent account to a client loginid (WS `paymentagent_transfer`).
     * Payload matches the Denara HTML test page: paymentagent_transfer, transfer_to, amount, currency, description;
     * optional dry_run; optional loginid only when multi-wallet PA needs it.
     *
     * @see https://legacy-api.deriv.com/api-explorer#paymentagent_transfer
     */
    public function paymentAgentTransfer(
        string $transferToLoginid,
        float $amount,
        string $currency,
        string $description = 'Payment Agent transfer',
        ?string $paymentAgentLoginid = null,
        bool $dryRun = false
    ): array {
        // Same shape as browser test: description always sent (default when textarea empty in HTML).
        $payload = [
            'paymentagent_transfer' => 1,
            'transfer_to'           => $transferToLoginid,
            'amount'                => $amount,
            'currency'              => $currency,
            'description'           => $description,
        ];
        if ($dryRun) {
            $payload['dry_run'] = 1;
        }
        if ($paymentAgentLoginid !== null && $paymentAgentLoginid !== '') {
            $payload['loginid'] = $paymentAgentLoginid;
        }

        return $this->send($payload);
    }

    /** ====================== Utility ====================== */

    /** Recognize the validation error you just saw so we can auto-fallback. */
    private function isInputValidation(\RuntimeException $e): bool {
        $m = $e->getMessage();
        // Typical patterns:
        // "InputValidationFailed: Properties not allowed: trader_token"
        // "InputValidationFailed: ..."
        return str_contains($m, 'InputValidationFailed')
            || str_contains($m, 'Properties not allowed')
            || (str_contains($m, 'not allowed') && str_contains($m, 'trader_token'));
    }

    /** Convenience: detect REAL account from authorize payload. */
    public static function isRealFromAuthorizePayload(array $authorize): bool {
        $loginid   = (string)($authorize['loginid'] ?? '');
        $isVirtual = (int)($authorize['is_virtual'] ?? 0) === 1;
        if ($loginid === '' || $isVirtual) return false;
        if (str_starts_with($loginid, 'VRTC')) return false;
        return true;
    }

    /**
     * NEW: One-shot helper to get balance for a given token.
     * Reuses this socket: authorize(token) → balance().
     * Returns ['balance'=>float|null, 'currency'=>string|null].
     */
    public function getBalanceForToken(string $token): array {
        $auth = $this->authorize($token);
        if (!isset($auth['authorize']['loginid'])) {
            throw new \RuntimeException('Authorize failed');
        }
        $bresp = $this->balance();
        $b = $bresp['balance'] ?? null;
        return [
            'balance'  => isset($b['balance']) ? (float)$b['balance'] : null,
            'currency' => isset($b['currency']) ? (string)$b['currency'] : null,
        ];
    }
}
