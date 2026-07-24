import { getDerivOAuthClientId } from '@/components/shared/utils/config/config';
import { getDerivOAuthAccessToken } from '@/components/shared/utils/login/deriv-oauth-storage';
import { getPaApiBaseUrl } from '@/utils/pa-api-base';

export type TPublicFlipaaSignal = {
    id: string;
    strategy_key: string;
    contract_type: string;
    market: string;
    duration: number;
    barrier: string | null;
    stake: number;
    mode: string;
    created_at: string;
    blend_id?: string | null;
    blend_label?: string | null;
    blend_risk?: string | null;
    active_strategy_label?: string | null;
    martingale_multiplier?: number | null;
};

export type TSignalsFeedResponse = {
    ok: boolean;
    error?: string;
    items?: TPublicFlipaaSignal[];
    /** Server count of feed signals in the last feedTradeWindowHours. */
    feedTradeCount?: number;
    feedTradeWindowHours?: number;
    enabled?: boolean;
    started?: boolean;
    running?: boolean;
    snapshot?: Record<string, unknown> | null;
    dryRun?: boolean;
    martingaleMultiplier?: number;
    sessionTakeProfit?: number;
};

export type TEngineSnapshot = {
    mode?: string;
    market?: string;
    blendId?: string;
    blendLabel?: string;
    blendRisk?: string;
    activeStrategyKey?: string | null;
    activeStrategyLabel?: string | null;
    activeStrategySummary?: string | null;
    martingaleMultiplier?: number;
    runtimeStake?: number;
    lossStreak?: number;
    sessionLossStreak?: number;
    maxSessionLossStreak?: number;
    /** Minimum balance advice from longest losing streak (accrued martingale stakes). */
    rcCapital?: number;
    strategies?: Array<{ key: string; barrier?: number; duration?: number }>;
};

export type TSignalSubscription = {
    loginid: string;
    status: string;
    stake?: number;
    mode?: string;
    balance?: number | null;
    balanceCurrency?: string | null;
    balanceUpdatedAt?: string | null;
    /** Prefer Railway balance over live Deriv for this loginid (account switcher). */
    serverBalance?: boolean;
    sessionPnl?: number;
    sessionTakeProfit?: number;
    tpHitAt?: string | null;
    continueAfterTp?: boolean;
    denaraTraderId?: number | null;
    statusLabel?: string;
};

export type TMySignalAccount = TSignalSubscription;

function signalsBaseUrl(): string {
    return getPaApiBaseUrl().replace(/\/+$/, '');
}

function readLocalAuthToken(): string | null {
    try {
        return localStorage.getItem('authToken')?.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Single trading Bearer for Fury / Signal Hub.
 * Prefer Options OAuth PAT (actual trade token); fall back to Denara ID authToken.
 */
export function getSignalsTradingToken(): string | null {
    return getDerivOAuthAccessToken()?.trim() || readLocalAuthToken();
}

export function isSignalsAuthenticated(): boolean {
    return Boolean(getSignalsTradingToken());
}

function denaraUsernameHint(): string | undefined {
    try {
        return localStorage.getItem('denara_competition_username')?.trim() || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Authenticated Fury API headers.
 * - Always require Bearer (Options PAT or Denara token) — never username-only.
 * - Do not send X-Denara-Username (spoofable until backend binds identity to Bearer).
 */
function authHeaders(requireBearer = true): HeadersInit {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
    const token = getSignalsTradingToken();
    if (!token) {
        if (requireBearer) {
            throw new Error('Sign in with Denara ID (Options trading token) before using Fury AI.');
        }
        return headers;
    }
    headers.Authorization = `Bearer ${token}`;
    const appId = getDerivOAuthClientId()?.trim();
    if (appId) headers['Deriv-App-ID'] = appId;
    return headers;
}

async function parseJsonResponse<T extends { ok?: boolean; error?: string }>(res: Response): Promise<T> {
    const text = await res.text();
    try {
        return JSON.parse(text) as T;
    } catch {
        throw new Error(
            res.ok
                ? 'Signals API returned non-JSON'
                : `Signals API unavailable (HTTP ${res.status}). Deploy Railway /v1/signals routes.`
        );
    }
}

/** Max window the Railway `/recent` count accepts (hours). */
export const FEED_TRADE_WINDOW_HOURS_MAX = 168;

export async function fetchPublicSignalsFeed(
    limit = 30,
    feedHours = FEED_TRADE_WINDOW_HOURS_MAX
): Promise<TSignalsFeedResponse> {
    const hours = Math.min(
        FEED_TRADE_WINDOW_HOURS_MAX,
        Math.max(1, Math.floor(Number(feedHours) || FEED_TRADE_WINDOW_HOURS_MAX))
    );
    const url = `${signalsBaseUrl()}/v1/signals/recent?limit=${Math.min(100, Math.max(1, limit))}&feedHours=${hours}`;
    const res = await fetch(url);
    const data = await parseJsonResponse<TSignalsFeedResponse>(res);
    if (!res.ok || !data.ok) {
        return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return data;
}

export type TSignalExecution = {
    status: string;
    contractId?: string | null;
    error?: string | null;
    contractType?: string | null;
    stake?: number | null;
    won?: boolean | null;
    pnl?: number | null;
    at?: string;
};

export async function fetchMySignalSubscription(): Promise<{
    ok: boolean;
    error?: string;
    demoLoginid?: string | null;
    demoBalance?: number | null;
    subscriber?: TSignalSubscription | null;
    lastBuy?: TSignalExecution | null;
    executions?: TSignalExecution[];
    running?: boolean;
    started?: boolean;
    sessionTakeProfit?: number;
}> {
    if (!getSignalsTradingToken()) {
        return { ok: false, error: 'Not signed in' };
    }
    const res = await fetch(`${signalsBaseUrl()}/v1/signals/me`, { headers: authHeaders() });
    return parseJsonResponse(res);
}

export async function startServerSignals(input: {
    loginid?: string;
    /** @deprecated Ignored — stake is server-controlled. */
    stake?: number;
    username?: string;
    email?: string;
    continueAfterTp?: boolean;
}): Promise<{
    ok: boolean;
    error?: string;
    subscriber?: TSignalSubscription;
    running?: boolean;
    warning?: string;
}> {
    if (!getSignalsTradingToken()) {
        return { ok: false, error: 'Sign in with Denara ID before starting Fury AI.' };
    }
    // Username is a display/link hint only; identity is the Bearer PAT.
    // Backend must stop trusting username alone — FE no longer sends X-Denara-Username.
    const username = input.username?.trim() || denaraUsernameHint();
    const res = await fetch(`${signalsBaseUrl()}/v1/signals/start`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
            loginid: input.loginid || undefined,
            // stake / takeProfit intentionally omitted — server config only
            username: username || undefined,
            displayName: username || undefined,
            email: input.email || undefined,
            continueAfterTp: Boolean(input.continueAfterTp),
        }),
    });
    return parseJsonResponse(res);
}

export async function setContinueAfterSessionTp(input: { continueAfterTp: boolean; loginid?: string }): Promise<{
    ok: boolean;
    error?: string;
    subscriber?: TSignalSubscription;
}> {
    if (!getSignalsTradingToken()) {
        return { ok: false, error: 'Not signed in' };
    }
    const res = await fetch(`${signalsBaseUrl()}/v1/signals/continue-after-tp`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
            continueAfterTp: Boolean(input.continueAfterTp),
            loginid: input.loginid,
        }),
    });
    return parseJsonResponse(res);
}

export async function fetchMySignalAccounts(): Promise<{
    ok: boolean;
    error?: string;
    username?: string;
    accounts?: TMySignalAccount[];
    running?: boolean;
}> {
    if (!getSignalsTradingToken()) {
        return { ok: false, error: 'Not signed in' };
    }
    const res = await fetch(`${signalsBaseUrl()}/v1/signals/my-accounts`, {
        headers: authHeaders(),
    });
    return parseJsonResponse(res);
}

export async function refreshMySignalAccountBalances(): Promise<{
    ok: boolean;
    error?: string;
    username?: string;
    accounts?: TMySignalAccount[];
    results?: Array<{
        loginid: string;
        ok: boolean;
        balance?: number | null;
        currency?: string | null;
        error?: string;
        revoked?: boolean;
    }>;
}> {
    if (!getSignalsTradingToken()) {
        return { ok: false, error: 'Not signed in' };
    }
    const res = await fetch(`${signalsBaseUrl()}/v1/signals/my-accounts/refresh-balances`, {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
    });
    return parseJsonResponse(res);
}

export async function stopServerSignals(loginid?: string): Promise<{
    ok: boolean;
    error?: string;
    subscriber?: TSignalSubscription;
    running?: boolean;
    started?: boolean;
}> {
    if (!getSignalsTradingToken()) {
        return { ok: false, error: 'Not signed in' };
    }
    const res = await fetch(`${signalsBaseUrl()}/v1/signals/stop`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(loginid ? { loginid } : {}),
    });
    return parseJsonResponse(res);
}

/**
 * Keep the shared engine warm when signed in.
 * Backend requires Bearer; anonymous callers skip this (feed still works via /recent).
 */
export async function ensureSignalsRunning(): Promise<TSignalsFeedResponse> {
    const token = getSignalsTradingToken();
    if (!token) {
        return { ok: false, error: 'Not signed in' };
    }
    const res = await fetch(`${signalsBaseUrl()}/v1/signals/ensure-running`, {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
    });
    return parseJsonResponse(res);
}

export function formatSignalLabel(signal: TPublicFlipaaSignal): string {
    const type = String(signal.contract_type || '').toUpperCase();
    if (type === 'CALL') return 'RISE';
    if (type === 'PUT') return 'FALL';
    if (type === 'CALLE') return 'RISE =';
    if (type === 'PUTE') return 'FALL =';
    if (type === 'RUNHIGH') return 'ONLY UPS';
    if (type === 'RUNLOW') return 'ONLY DOWNS';
    if (type === 'RANGE') return 'STAYS BETWEEN';
    if (type === 'UPORDOWN') return 'GOES OUTSIDE';
    if (type === 'DIGITMATCH') {
        const barrier = signal.barrier != null && String(signal.barrier).length ? ` ${signal.barrier}` : '';
        return `MATCH${barrier}`.trim();
    }
    const barrier = signal.barrier != null && String(signal.barrier).length ? ` ${signal.barrier}` : '';
    return `${type.replace(/^DIGIT/, '')}${barrier}`.trim();
}

export function formatEngineStrategyLine(
    snapshot: TEngineSnapshot | Record<string, unknown> | null | undefined
): string {
    if (!snapshot || typeof snapshot !== 'object') return 'No active blend yet';
    const s = snapshot as TEngineSnapshot;
    const summary = typeof s.activeStrategySummary === 'string' ? s.activeStrategySummary.trim() : '';
    const blend = typeof s.blendLabel === 'string' ? s.blendLabel : 'Blend';
    const active = typeof s.activeStrategyLabel === 'string' ? s.activeStrategyLabel : '—';
    const risk = typeof s.blendRisk === 'string' ? s.blendRisk : '';
    const market = typeof s.market === 'string' ? s.market.trim() : '';
    let line = summary || `${blend} · ${active}${risk ? ` · ${risk}` : ''}`;
    if (market && !line.includes(market)) {
        line = `${line} · ${market}`;
    }
    const mult = s.martingaleMultiplier;
    if (mult != null && Number(mult) > 1) {
        const tag = `×${Number(mult).toFixed(2)}`;
        if (!line.includes(tag)) {
            line = `${line} · ${tag}`;
        }
    }
    return line;
}

/** Rc.capital + longest consecutive-loss streak from engine snapshot. */
export function formatEngineRecoveryLine(
    snapshot: TEngineSnapshot | Record<string, unknown> | null | undefined
): string | null {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const s = snapshot as TEngineSnapshot;
    const maxLosses = Number(s.maxSessionLossStreak);
    const rc = Number(s.rcCapital);
    if (!Number.isFinite(maxLosses) || maxLosses <= 0) {
        return 'Rc.capital — · most consecutive losses 0';
    }
    const capital = Number.isFinite(rc) ? rc : 0;
    return `Rc.capital $${capital.toFixed(2)} · most consecutive losses ${Math.floor(maxLosses)}`;
}
