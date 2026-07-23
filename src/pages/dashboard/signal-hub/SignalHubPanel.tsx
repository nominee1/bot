import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
    openDenaraIdLoginDialog,
    openDenaraIdSignupDialog,
} from '@/components/shared/utils/competition/denara-competition-profile';
import {
    getStoredDerivOptionsAccounts,
    type TDerivOptionsAccount,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import { isOptionsTradingLoginid } from '@/constants/deriv-transfer';
import { useApiBase } from '@/hooks/useApiBase';
import { useDisplayCurrencyStore } from '@/hooks/useDisplayCurrencyStore';
import { useStore } from '@/hooks/useStore';
import { readAccountBalanceEntry } from '@/utils/account-balance-display';
import { applyServerManagedBalance } from '@/utils/applyServerManagedBalance';
import {
    ensureSignalsRunning,
    fetchMySignalSubscription,
    fetchPublicSignalsFeed,
    formatEngineRecoveryLine,
    formatEngineStrategyLine,
    formatSignalLabel,
    isSignalsAuthenticated,
    setContinueAfterSessionTp,
    startServerSignals,
    stopServerSignals,
    type TEngineSnapshot,
    type TPublicFlipaaSignal,
    type TSignalExecution,
    type TSignalSubscription,
} from './signal-feed';
import './signal-hub.scss';

const POLL_MS = 2500;
const CONTINUE_AFTER_TP_KEY = 'fury_continue_after_session_tp';

/** Launch: Monday 20 Jul 2026, 19:00 East Africa Time (UTC+3). */
const FURY_LAUNCH_AT_MS = Date.parse('2026-07-20T19:00:00+03:00');

type TCountdownParts = {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    totalMs: number;
};

/** e.g. ROT90381442 → ROT***42 */
function maskLoginid(loginid: string | null | undefined): string {
    const id = String(loginid ?? '').trim();
    if (!id) return '';
    const match = id.match(/^([A-Za-z]+)(\d+)$/);
    if (!match) {
        if (id.length <= 5) return id;
        return `${id.slice(0, 3)}***${id.slice(-2)}`;
    }
    const [, prefix, digits] = match;
    const last2 = digits.length >= 2 ? digits.slice(-2) : digits;
    return `${prefix.toUpperCase()}***${last2}`;
}

function getCountdownParts(nowMs: number, targetMs: number): TCountdownParts {
    const totalMs = Math.max(0, targetMs - nowMs);
    const totalSec = Math.floor(totalMs / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    return { days, hours, minutes, seconds, totalMs };
}

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

function readContinueAfterTpPref(): boolean {
    try {
        return localStorage.getItem(CONTINUE_AFTER_TP_KEY) === '1';
    } catch {
        return false;
    }
}

function writeContinueAfterTpPref(value: boolean) {
    try {
        localStorage.setItem(CONTINUE_AFTER_TP_KEY, value ? '1' : '0');
    } catch {
        /* ignore */
    }
}

function isLoggedInWithToken(): boolean {
    return isSignalsAuthenticated();
}

function pickRealOptionsAccount(accounts: TDerivOptionsAccount[]): TDerivOptionsAccount | null {
    const real = accounts.filter(a => !a.isVirtual && /^ROT/i.test(String(a.loginid ?? '').trim()));
    return (
        real.find(a => a.currency === 'USD' && isOptionsTradingLoginid(a.loginid)) ??
        real.find(a => isOptionsTradingLoginid(a.loginid)) ??
        real.find(a => a.currency === 'USD') ??
        real[0] ??
        null
    );
}

/** Prefer stored Options accounts; also scan MobX account list / balance map for ROT ids. */
function resolveRealOptionsLoginid(client: {
    account_list?: Array<{ loginid?: string; is_virtual?: boolean; currency?: string }> | null;
    all_accounts_balance?: { accounts?: Record<string, unknown> } | null;
}): string | null {
    const fromStored = pickRealOptionsAccount(getStoredDerivOptionsAccounts() ?? []);
    if (fromStored?.loginid) return String(fromStored.loginid).trim().toUpperCase();

    const listRot = (client.account_list ?? []).find(
        a => !a.is_virtual && /^ROT/i.test(String(a.loginid ?? '').trim())
    );
    if (listRot?.loginid) return String(listRot.loginid).trim().toUpperCase();

    const balanceIds = Object.keys(client.all_accounts_balance?.accounts ?? {});
    const rotFromBalance = balanceIds.find(id => /^ROT/i.test(id.trim()));
    return rotFromBalance ? rotFromBalance.trim().toUpperCase() : null;
}

function isDemoLoginid(loginid: string | null | undefined): boolean {
    const id = String(loginid ?? '')
        .trim()
        .toUpperCase();
    return !id || /^DOT/i.test(id) || /^VR/i.test(id);
}

function denaraUsername(): string | undefined {
    try {
        return localStorage.getItem('denara_competition_username')?.trim() || undefined;
    } catch {
        return undefined;
    }
}

type Props = {
    onClose?: () => void;
};

export default observer(function SignalHubPanel({ onClose }: Props) {
    const { client } = useStore();
    const { activeLoginid } = useApiBase();
    const display_currency = useDisplayCurrencyStore();
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [signals, setSignals] = useState<TPublicFlipaaSignal[]>([]);
    const [running, setRunning] = useState(false);
    const [feedError, setFeedError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [realLoginid, setRealLoginid] = useState<string | null>(null);
    const [subscription, setSubscription] = useState<TSignalSubscription | null>(null);
    const [executions, setExecutions] = useState<TSignalExecution[]>([]);
    const [snapshot, setSnapshot] = useState<TEngineSnapshot | null>(null);
    const [continueAfterTp, setContinueAfterTp] = useState(readContinueAfterTpPref);

    const launchAtMs = Number.isFinite(FURY_LAUNCH_AT_MS) ? FURY_LAUNCH_AT_MS : 0;
    const countdown = useMemo(() => getCountdownParts(nowMs, launchAtMs), [nowMs, launchAtMs]);
    const isLaunched = countdown.totalMs <= 0;

    const loggedIn = isLoggedInWithToken();
    const active = subscription?.status === 'active';
    const tpHit = Boolean(subscription?.tpHitAt);
    const tpAmount = Number(subscription?.sessionTakeProfit ?? 4);

    // Prefer Railway-managed balance when server says so (same source as header switcher patch).
    const balanceLoginid = subscription?.loginid || realLoginid || activeLoginid || null;
    const liveEntry = readAccountBalanceEntry(client, balanceLoginid);
    const useServerBal =
        Boolean(subscription?.serverBalance) &&
        subscription?.balance != null &&
        Number.isFinite(Number(subscription.balance)) &&
        String(subscription.loginid ?? '')
            .trim()
            .toUpperCase() ===
            String(balanceLoginid ?? '')
                .trim()
                .toUpperCase();
    const uiBalance = useServerBal ? Number(subscription!.balance) : liveEntry.balance;
    const uiCurrency = useServerBal ? subscription?.balanceCurrency || liveEntry.currency || 'USD' : liveEntry.currency;
    const balanceLabel = balanceLoginid ? display_currency.formatCommaBalance(uiBalance, uiCurrency) : null;
    const recoveryLine = useMemo(() => formatEngineRecoveryLine(snapshot), [snapshot]);

    const openDenaraLogin = useCallback(() => {
        onClose?.();
        window.setTimeout(() => openDenaraIdLoginDialog(), 0);
    }, [onClose]);

    const openDenaraSignup = useCallback(() => {
        onClose?.();
        window.setTimeout(() => openDenaraIdSignupDialog(), 0);
    }, [onClose]);

    useEffect(() => {
        if (isLaunched) return undefined;
        const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [isLaunched]);

    const refreshLocalReal = useCallback(() => {
        const realId = resolveRealOptionsLoginid(client);
        setRealLoginid(realId);
        return realId;
    }, [client]);

    const refreshSubscription = useCallback(async () => {
        if (!loggedIn) {
            setSubscription(null);
            setExecutions([]);
            return;
        }
        try {
            const me = await fetchMySignalSubscription();
            if (!me.ok) return;
            // Only trust a real ROT subscriber id from the server — never adopt a demo loginid.
            if (me.subscriber?.loginid && !isDemoLoginid(me.subscriber.loginid)) {
                setRealLoginid(me.subscriber.loginid.trim().toUpperCase());
            }
            setSubscription(me.subscriber ?? null);
            setExecutions(me.executions ?? []);
            setRunning(Boolean(me.running));
            if (typeof me.subscriber?.continueAfterTp === 'boolean') {
                setContinueAfterTp(me.subscriber.continueAfterTp);
                writeContinueAfterTpPref(me.subscriber.continueAfterTp);
            }
            if (
                me.subscriber?.serverBalance &&
                me.subscriber.loginid &&
                me.subscriber.balance != null &&
                Number.isFinite(Number(me.subscriber.balance))
            ) {
                applyServerManagedBalance(
                    client,
                    me.subscriber.loginid,
                    Number(me.subscriber.balance),
                    me.subscriber.balanceCurrency ?? 'USD'
                );
            }
        } catch {
            /* feed poll still works */
        }
    }, [loggedIn, client]);

    const loadFeed = useCallback(async () => {
        try {
            const data = await fetchPublicSignalsFeed(30);
            if (!data.ok) {
                setFeedError(data.error ?? 'Failed to load signals');
                return;
            }
            setFeedError(null);
            setSignals(data.items ?? []);
            setRunning(Boolean(data.running));
            if (data.snapshot && typeof data.snapshot === 'object') {
                setSnapshot(data.snapshot as TEngineSnapshot);
            }
        } catch (err) {
            setFeedError(err instanceof Error ? err.message : 'Failed to load signals');
        } finally {
            setLoading(false);
        }
    }, []);

    const ensureEngine = useCallback(async () => {
        try {
            const result = await ensureSignalsRunning();
            if (result.ok) {
                setRunning(Boolean(result.running ?? result.started));
                if (result.snapshot && typeof result.snapshot === 'object') {
                    setSnapshot(result.snapshot as TEngineSnapshot);
                }
            }
        } catch {
            /* feed poll still works */
        }
    }, []);

    useEffect(() => {
        if (!isLaunched) return undefined;
        refreshLocalReal();
        void ensureEngine().then(() => loadFeed());
        void refreshSubscription();
        const timer = window.setInterval(() => {
            void loadFeed();
            void refreshSubscription();
        }, POLL_MS);
        return () => window.clearInterval(timer);
    }, [ensureEngine, isLaunched, loadFeed, refreshLocalReal, refreshSubscription]);

    const onStart = async () => {
        if (!loggedIn) {
            openDenaraLogin();
            return;
        }
        setBusy(true);
        setActionError(null);
        try {
            // Always resolve ROT at click time — UI may still be on demo.
            const rotLoginid = refreshLocalReal();
            const result = await startServerSignals({
                // Omit demo; omit missing — server picks ROT from the same Denara/Options token.
                loginid: rotLoginid && !isDemoLoginid(rotLoginid) ? rotLoginid : undefined,
                username: denaraUsername(),
                continueAfterTp,
            });
            if (!result.ok) {
                throw new Error(result.error ?? 'Failed to start signals');
            }
            setActionError(null);
            setSubscription(result.subscriber ?? null);
            if (result.subscriber?.loginid && !isDemoLoginid(result.subscriber.loginid)) {
                setRealLoginid(result.subscriber.loginid.trim().toUpperCase());
            }
            setRunning(Boolean(result.running));
            await loadFeed();
            await refreshSubscription();
        } catch (err) {
            // API business errors (demo rejected, invalid token, …) stay as-is.
            // Only replace true browser "Failed to fetch" with the calm network copy.
            setActionError(err instanceof Error ? err.message : 'Failed to start signals');
        } finally {
            setBusy(false);
        }
    };

    const onStop = async () => {
        setBusy(true);
        setActionError(null);
        try {
            const result = await stopServerSignals(subscription?.loginid || realLoginid || undefined);
            if (!result.ok) {
                throw new Error(result.error ?? 'Failed to stop trading');
            }
            setSubscription(result.subscriber ?? { loginid: subscription?.loginid ?? '', status: 'paused' });
            if (typeof result.running === 'boolean') {
                setRunning(result.running);
            }
            await loadFeed();
            await refreshSubscription();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Failed to stop trading');
        } finally {
            setBusy(false);
        }
    };

    const onToggleContinueAfterTp = async (next: boolean) => {
        setContinueAfterTp(next);
        writeContinueAfterTpPref(next);
        if (!loggedIn || !subscription?.loginid) return;
        try {
            const result = await setContinueAfterSessionTp({
                continueAfterTp: next,
                loginid: subscription.loginid,
            });
            if (result.ok && result.subscriber) {
                setSubscription(result.subscriber);
            }
        } catch {
            /* preference kept locally; applied on next Start */
        }
    };

    if (!isLaunched) {
        return (
            <div className='signal-hub-panel signal-hub-panel--launch'>
                <div className='signal-hub-panel__launch'>
                    <div className='signal-hub-panel__eyebrow'>Fury AI</div>
                    <h2 className='signal-hub-panel__launch-title'>Opens 7:00 PM EAT</h2>
                    <p className='signal-hub-panel__launch-sub'>Monday, 20 Jul 2026 · East Africa Time</p>

                    <div className='signal-hub-panel__countdown' role='timer' aria-live='polite'>
                        {[
                            { label: 'Days', value: countdown.days },
                            { label: 'Hours', value: countdown.hours },
                            { label: 'Min', value: countdown.minutes },
                            { label: 'Sec', value: countdown.seconds, shake: true },
                        ].map(unit => (
                            <div key={unit.label} className='signal-hub-panel__countdown-unit'>
                                <span
                                    className={`signal-hub-panel__countdown-value${
                                        unit.shake ? ' signal-hub-panel__countdown-value--shake' : ''
                                    }`}
                                >
                                    {pad2(unit.value)}
                                </span>
                                <span className='signal-hub-panel__countdown-label'>{unit.label}</span>
                            </div>
                        ))}
                    </div>

                    <div className='signal-hub-panel__launch-howto'>
                        <p className='signal-hub-panel__launch-howto-title'>Get ready with Denara ID</p>
                        <ol className='signal-hub-panel__launch-steps'>
                            <li>Create a Denara ID (username + password + Deriv Options API token).</li>
                            <li>Log in with that Denara ID when Fury AI opens.</li>
                            <li>Fury trades 24/7 even when you are offline. Your trading assistant.</li>
                        </ol>
                        <button type='button' className='signal-hub-panel__launch-signup' onClick={openDenaraSignup}>
                            Create Denara ID
                        </button>
                        <p className='signal-hub-panel__launch-hint'>
                            Already have one?{' '}
                            <button type='button' className='signal-hub-panel__login-link' onClick={openDenaraLogin}>
                                Login with Denara ID
                            </button>
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className='signal-hub-panel signal-hub-panel--docked'>
            <nav className='signal-hub-panel__navbar' aria-label='Fury AI status'>
                <div className='signal-hub-panel__navbar-row signal-hub-panel__navbar-row--top'>
                    <div className='signal-hub-panel__navbar-brand'>
                        <span className='signal-hub-panel__navbar-title'>Fury AI</span>
                        <span className='signal-hub-panel__navbar-chip'>TP $4 / session</span>
                    </div>

                    <div className='signal-hub-panel__navbar-status'>
                        <span className={`signal-hub-panel__dot ${running ? 'is-live' : 'is-idle'}`} aria-hidden />
                        <span className='signal-hub-panel__navbar-status-text'>
                            {running ? 'Engine connected' : 'Connecting…'}
                            {balanceLoginid ? ` · ${maskLoginid(balanceLoginid)}` : ''}
                            {balanceLabel ? ` · ${balanceLabel}` : ''}
                        </span>
                    </div>

                    <div className='signal-hub-panel__navbar-actions'>
                        {!active ? (
                            <button
                                type='button'
                                className='signal-hub-panel__trade-btn'
                                disabled={!loggedIn || busy}
                                onClick={() => void onStart()}
                            >
                                {busy ? 'Starting…' : 'Start trading'}
                            </button>
                        ) : (
                            <button
                                type='button'
                                className='signal-hub-panel__trade-btn signal-hub-panel__trade-btn--stop'
                                disabled={busy}
                                onClick={() => void onStop()}
                            >
                                {busy ? 'Stopping…' : 'Stop trading'}
                            </button>
                        )}
                        <label
                            className={`signal-hub-panel__tp-mini${continueAfterTp ? ' is-on' : ''}`}
                            title='Continue trading after session TP'
                        >
                            <input
                                type='checkbox'
                                checked={continueAfterTp}
                                disabled={!loggedIn || busy}
                                onChange={e => void onToggleContinueAfterTp(e.target.checked)}
                            />
                            <span className='signal-hub-panel__tp-mini-switch' aria-hidden>
                                <span className='signal-hub-panel__tp-mini-knob' />
                            </span>
                            <span className='signal-hub-panel__tp-mini-label'>After TP</span>
                        </label>
                    </div>
                </div>
            </nav>

            {!loggedIn ? (
                <p className='signal-hub-panel__banner'>
                    <button type='button' className='signal-hub-panel__login-link' onClick={openDenaraLogin}>
                        Login with Denara ID
                    </button>{' '}
                    to unlock Fury AI. Trades for free 24/7 even when offline!
                </p>
            ) : null}

            {tpHit ? (
                <p className='signal-hub-panel__congrats' role='status'>
                    Congratulations — session TP hit
                    {Number.isFinite(tpAmount) ? ` ($${tpAmount.toFixed(0)})` : ''}.
                    {active || continueAfterTp ? ' Trading continues.' : ' Start again for a new session.'}
                </p>
            ) : null}

            {actionError ? <p className='signal-hub-panel__error'>{actionError}</p> : null}

            <div className='signal-hub-panel__body'>
                {executions.length > 0 ? (
                    <div className='signal-hub-panel__list signal-hub-panel__list--exec'>
                        {executions.slice(0, 6).map((ex, i) => {
                            const staleBulk = typeof ex.error === 'string' && /bulk response/i.test(ex.error);
                            const isOk = ex.status === 'ok';
                            const outcome =
                                isOk && ex.won === true
                                    ? 'Won'
                                    : isOk && ex.won === false
                                      ? 'Lost'
                                      : isOk
                                        ? 'Open'
                                        : null;
                            const outcomeClass =
                                ex.won === true
                                    ? ' signal-hub-panel__outcome--won'
                                    : ex.won === false
                                      ? ' signal-hub-panel__outcome--lost'
                                      : '';
                            return (
                                <div key={`${ex.at}-${i}`} className='signal-hub-panel__row'>
                                    <div className='signal-hub-panel__row-main'>
                                        <span className='signal-hub-panel__badge signal-hub-panel__badge--with-status'>
                                            <span>{String(ex.contractType ?? 'BUY')}</span>
                                            {outcome ? (
                                                <span
                                                    className={`signal-hub-panel__outcome${outcomeClass}`}
                                                    title={outcome}
                                                    aria-label={outcome}
                                                >
                                                    {outcome}
                                                </span>
                                            ) : (
                                                <span className='signal-hub-panel__status-text'>
                                                    · {ex.status}
                                                    {staleBulk ? ' (old)' : ''}
                                                </span>
                                            )}
                                        </span>
                                        <span className={`signal-hub-panel__meta${outcomeClass}`}>
                                            {isOk
                                                ? [
                                                      ex.stake != null ? `$${Number(ex.stake).toFixed(2)}` : null,
                                                      ex.pnl != null && ex.won != null
                                                          ? `${ex.pnl >= 0 ? '+' : ''}$${Number(ex.pnl).toFixed(2)}`
                                                          : null,
                                                  ]
                                                      .filter(Boolean)
                                                      .join(' · ') || '—'
                                                : staleBulk
                                                  ? 'Stale bulk-path error — ignore after redeploy'
                                                  : ex.error || 'no detail'}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : null}

                {feedError ? <p className='signal-hub-panel__error'>{feedError}</p> : null}

                <div className='signal-hub-panel__strategy signal-hub-panel__strategy--before-feed'>
                    <span className='signal-hub-panel__strategy-label'>Strategy</span>
                    <span className='signal-hub-panel__strategy-value' title={formatEngineStrategyLine(snapshot)}>
                        {formatEngineStrategyLine(snapshot)}
                    </span>
                </div>
                {recoveryLine ? (
                    <div className='signal-hub-panel__strategy signal-hub-panel__strategy--rc'>
                        <span className='signal-hub-panel__strategy-label'>Capital</span>
                        <span
                            className='signal-hub-panel__strategy-value'
                            title='Minimum balance to cover the longest martingale losing streak'
                        >
                            {recoveryLine}
                        </span>
                    </div>
                ) : null}

                <div
                    className={`signal-hub-panel__list signal-hub-panel__list--feed${
                        active ? ' signal-hub-panel__list--feed-trading' : ''
                    }`}
                >
                    {loading && !signals.length ? (
                        <div className='signal-hub-panel__empty'>Loading engine trades…</div>
                    ) : null}
                    {!loading && !signals.length ? (
                        <div className='signal-hub-panel__empty'>
                            {running ? 'Waiting for the next Fury AI signal…' : 'Connecting to Fury engine…'}
                        </div>
                    ) : null}
                    {signals.map(signal => (
                        <div key={signal.id} className='signal-hub-panel__row'>
                            <div className='signal-hub-panel__row-main'>
                                <span className='signal-hub-panel__badge'>{formatSignalLabel(signal)}</span>
                                <span className='signal-hub-panel__meta'>
                                    {signal.blend_label
                                        ? `${signal.blend_label}${signal.blend_risk ? ` · ${signal.blend_risk}` : ''}`
                                        : 'Fury AI'}
                                    {' · '}
                                    {signal.market} · {signal.duration}t · ${Number(signal.stake).toFixed(2)}
                                    {signal.martingale_multiplier != null && Number(signal.martingale_multiplier) > 1
                                        ? ` · ×${Number(signal.martingale_multiplier).toFixed(2)}`
                                        : ''}
                                </span>
                                <span className='signal-hub-panel__time'>
                                    {signal.created_at ? new Date(signal.created_at).toLocaleTimeString() : ''}
                                </span>
                            </div>
                            <span className='signal-hub-panel__meta'>{active ? 'Trading' : 'Feed'}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});
