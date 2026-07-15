import { getDerivOAuthClientId } from '@/components/shared/utils/config/config';
import { getDerivOAuthAccessToken, getDerivOptionsRestBase } from '@/components/shared/utils/login/deriv-oauth-storage';

const PA_API_BASE = 'https://api.derivws.com/payment-agents/v1';

/** Otas Cash — override with BOT_STUDIO_PA_AGENT_ID at build time. */
export function getPaymentAgentAgentId(): number {
    const fromEnv = Number(
        (process.env.BOT_STUDIO_PA_AGENT_ID as string | undefined)?.trim() ||
            (process.env.PA_AGENT_ID as string | undefined)?.trim() ||
            681
    );
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 681;
}

export function getPaWithdrawAuthHeaders(accessToken?: string): HeadersInit | null {
    const token = (accessToken ?? getDerivOAuthAccessToken() ?? '').trim();
    if (!token) return null;
    return {
        Authorization: `Bearer ${token}`,
        'Deriv-App-ID': getDerivOAuthClientId(),
        Accept: 'application/json',
        'Content-Type': 'application/json',
    };
}

type DerivErrorBody = {
    errors?: Array<{ code?: string; detail?: { message?: string }; message?: string }>;
    data?: unknown;
};

function formatDerivPaError(body: DerivErrorBody, fallback: string): string {
    const first = body.errors?.[0];
    const code = first?.code ?? '';
    const detail = first?.detail?.message || first?.message || '';
    if (code === 'InsufficientScope' || /insufficient scope/i.test(detail) || /scope/i.test(fallback)) {
        return 'Your Deriv login is missing Payments permission. Log out and log in again after enabling Payments on the Deriv app.';
    }
    if (code === 'InvalidOTP' || code === 'OTPValidationFailed') {
        return 'Invalid verification code. Request a new code and try again.';
    }
    if (code === 'WalletFundsInsufficient') {
        return 'Insufficient balance in your Deriv wallet.';
    }
    if (code === 'WithdrawalAmountMinimum') {
        return 'Amount is below the payment agent minimum withdrawal.';
    }
    if (code === 'WithdrawalAmountMaximum') {
        return 'Amount is above the payment agent maximum withdrawal.';
    }
    if (code === 'ClientWithdrawDisabled') {
        return 'Withdrawals through payment agents are disabled on your Deriv account.';
    }
    if (detail) return detail;
    if (code) return code;
    return fallback;
}

async function parseJson(res: Response): Promise<DerivErrorBody> {
    return (await res.json().catch(() => ({}))) as DerivErrorBody;
}

export type PaWithdrawVerificationResult = {
    expiresAt?: number;
    nextRequestAt?: number;
};

/** Request 6-digit OTP for PA withdrawal (sent to Deriv email/phone). */
export async function requestPaWithdrawVerificationCode(input: {
    amountUsd: number;
    currency?: string;
    agentId?: number;
    accessToken?: string;
}): Promise<PaWithdrawVerificationResult> {
    const headers = getPaWithdrawAuthHeaders(input.accessToken);
    if (!headers) {
        throw new Error('Log in with Deriv (Payments permission) before withdrawing.');
    }

    const agentId = input.agentId ?? getPaymentAgentAgentId();
    const currency = (input.currency ?? 'USD').toUpperCase();
    const amount = Number(input.amountUsd).toFixed(2);

    const res = await fetch(`${PA_API_BASE}/withdraw/verification_code`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            data: {
                agent_id: agentId,
                amount,
                currency,
            },
        }),
    });
    const body = await parseJson(res);
    if (!res.ok) {
        throw new Error(formatDerivPaError(body, `Could not send verification code (${res.status}).`));
    }

    const data = (body.data ?? {}) as Record<string, unknown>;
    return {
        expiresAt: typeof data.expires_at === 'number' ? data.expires_at : undefined,
        nextRequestAt: typeof data.next_request_at === 'number' ? data.next_request_at : undefined,
    };
}

export type PaWithdrawResult = {
    status: string;
    transactionId: number | null;
    requestId?: string;
};

/** Submit PA withdrawal with OTP. Money moves client wallet → payment agent. */
export async function submitPaWithdraw(input: {
    amountUsd: number;
    verificationCode: string;
    currency?: string;
    agentId?: number;
    accessToken?: string;
    requestId?: string;
}): Promise<PaWithdrawResult> {
    const headers = getPaWithdrawAuthHeaders(input.accessToken);
    if (!headers) {
        throw new Error('Log in with Deriv (Payments permission) before withdrawing.');
    }

    const agentId = input.agentId ?? getPaymentAgentAgentId();
    const currency = (input.currency ?? 'USD').toUpperCase();
    const amount = Number(input.amountUsd).toFixed(2);
    const code = input.verificationCode.trim();
    if (!/^\d{6}$/.test(code)) {
        throw new Error('Enter the 6-digit verification code from Deriv.');
    }

    const requestId =
        input.requestId?.trim() ||
        (typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `wd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

    const res = await fetch(`${PA_API_BASE}/withdraw`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            data: {
                agent_id: agentId,
                amount,
                currency,
                verification_code: code,
                request_id: requestId,
                notes: 'Denara bot withdrawal',
            },
        }),
    });
    const body = await parseJson(res);
    if (!res.ok) {
        throw new Error(formatDerivPaError(body, `Withdrawal failed (${res.status}).`));
    }

    const data = (body.data ?? {}) as Record<string, unknown>;
    return {
        status: String(data.status ?? 'requested'),
        transactionId: typeof data.transaction_id === 'number' ? data.transaction_id : null,
        requestId,
    };
}

/** Optional: confirm token can hit payment-agents clients/me. */
export async function checkPaClientWithdrawEnabled(accessToken?: string): Promise<{
    ok: boolean;
    withdrawEnabled: boolean;
    message?: string;
}> {
    const headers = getPaWithdrawAuthHeaders(accessToken);
    if (!headers) {
        return {
            ok: false,
            withdrawEnabled: false,
            message: 'Log in with Deriv first.',
        };
    }

    try {
        const res = await fetch(`${PA_API_BASE}/clients/me`, { headers, method: 'GET' });
        const body = await parseJson(res);
        if (!res.ok) {
            return {
                ok: false,
                withdrawEnabled: false,
                message: formatDerivPaError(body, 'Could not verify payment permissions.'),
            };
        }
        const data = (body.data ?? {}) as Record<string, unknown>;
        const withdrawEnabled = data.withdraw_enabled !== false;
        return {
            ok: true,
            withdrawEnabled,
            message: withdrawEnabled
                ? undefined
                : 'Withdrawals through payment agents are disabled on your Deriv account.',
        };
    } catch {
        // Fall back — OTP request will surface the real error
        return { ok: true, withdrawEnabled: true };
    }
}

/** Keep Options REST base reference available for future wallet checks. */
export function getOptionsAccountsUrl(): string {
    return `${getDerivOptionsRestBase()}/accounts`;
}
