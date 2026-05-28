import { useCallback, useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import ToggleSwitch from '@/components/shared_ui/toggle-switch';
import { api_base } from '@/external/bot-skeleton';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { authorizeCopierToken } from '@/utils/parallel-copiers/parallel-copiers-auth';
import { readAllSessionAccounts } from '@/utils/parallel-copiers/parallel-session-accounts';
import { resolveLoginidCurrency } from '@/utils/parallel-copiers/resolve-loginid-currency';
import {
    isDerivOptionsOAuthSession,
    restoreDerivOptionsOAuthSessionFromStorage,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import {
    addParallelCopier,
    getClientMainLoginid,
    getPersonalMainLoginid,
    isParallelCopyPersonalEnabled,
    readParallelCopiers,
    readPersonalActiveCopiers,
    removeParallelCopier,
    setClientCopying,
    setClientMainLoginid,
    setPersonalMainLoginid,
    setParallelCopyPersonalEnabled,
    subscribeParallelCopiers,
    syncCopiersToAccountsList,
    togglePersonalActiveCopier,
    type TParallelCopier,
    updateCopierBalance,
} from '@/utils/parallel-copiers/parallel-copiers-storage';
import { localize } from '@deriv-com/translations';
import './ParallelCopyTrading.scss';

type TSessionAccount = { loginid: string; token: string; currency: string; is_virtual: boolean };

/** Display suffix only (last 3 characters of login ID). */
function formatLoginidShort(loginid: string): string {
    const id = loginid.trim();
    if (id.length <= 3) return id;
    return id.slice(-3);
}

function PersonalAccountRow({
    accounts,
    personal_main,
    personal_active,
    balances,
    on_set_lead,
    on_toggle_copier,
}: {
    accounts: TSessionAccount[];
    personal_main: string | null;
    personal_active: string[];
    balances: Record<string, { balance: number; currency: string }>;
    on_set_lead: (loginid: string) => void;
    on_toggle_copier: (loginid: string) => void;
}) {
    return (
        <div className='parallel-copy__account-row'>
            {accounts.map(acc => {
                const is_lead = personal_main === acc.loginid;
                const is_copier = personal_active.includes(acc.loginid);
                const bal = balances[acc.loginid];

                return (
                    <div
                        key={acc.loginid}
                        className={classNames('parallel-copy__account-tile', {
                            'parallel-copy__account-tile--lead': is_lead,
                            'parallel-copy__account-tile--copier': is_copier && !is_lead,
                        })}
                    >
                        <div className='parallel-copy__account-tile-top'>
                            <span className='parallel-copy__account-tile-id' title={acc.loginid}>
                                {formatLoginidShort(acc.loginid)}
                            </span>
                            <div className='parallel-copy__account-tile-badges'>
                                {is_copier && !is_lead && (
                                    <span className='parallel-copy__status-badge parallel-copy__status-badge--copier'>
                                        {localize('Copying')}
                                    </span>
                                )}
                                <span
                                    className={classNames('parallel-copy__chip-tag', {
                                        'parallel-copy__chip-tag--demo': acc.is_virtual,
                                        'parallel-copy__chip-tag--real': !acc.is_virtual,
                                    })}
                                >
                                    {acc.is_virtual ? localize('Demo') : localize('Real')}
                                </span>
                            </div>
                        </div>
                        <p className='parallel-copy__account-tile-balance'>
                            {bal != null ? (
                                <>
                                    {bal.balance.toFixed(2)}{' '}
                                    <span>{bal.currency || acc.currency}</span>
                                </>
                            ) : (
                                <span className='parallel-copy__account-tile-balance--muted'>—</span>
                            )}
                        </p>
                        <div className='parallel-copy__account-tile-actions'>
                            <button
                                type='button'
                                className='parallel-copy__account-lead-radio'
                                onClick={() => on_set_lead(acc.loginid)}
                            >
                                <input
                                    type='radio'
                                    name='parallel_personal_lead'
                                    value={acc.loginid}
                                    checked={is_lead}
                                    readOnly
                                    tabIndex={-1}
                                    aria-hidden
                                />
                                <span>
                                    {localize('Trading')}
                                    {is_lead ? ' ✅' : ''}
                                </span>
                            </button>
                            {!is_lead && (
                                <button
                                    type='button'
                                    className={classNames('parallel-copy__btn parallel-copy__btn--copier-toggle', {
                                        'parallel-copy__btn--copier-on': is_copier,
                                    })}
                                    onClick={e => {
                                        e.stopPropagation();
                                        on_toggle_copier(acc.loginid);
                                    }}
                                >
                                    {is_copier ? localize('Stop copying') : localize('Start copy')}
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function ClientCards({
    clients,
    busy,
    client_lead_active,
    accountList,
    onRefresh,
    onRemove,
    onToggleCopying,
}: {
    clients: TParallelCopier[];
    busy: boolean;
    client_lead_active: boolean;
    accountList?: Array<{ loginid: string; currency: string }>;
    onRefresh: () => void;
    onRemove: (id: string, loginid: string) => void;
    onToggleCopying: (id: string, copying: boolean) => void;
}) {
    if (!clients.length) {
        return (
            <p className='parallel-copy__empty'>
                {localize('Add a client token(read, trade & trading infomation permissions) to start copytrading.')}
            </p>
        );
    }

    return (
        <>
            <div className='parallel-copy__cards-head'>
                <button
                    type='button'
                    className='parallel-copy__btn parallel-copy__btn--ghost'
                    disabled={!clients.length || busy}
                    onClick={onRefresh}
                >
                    {localize('Refresh balances')}
                </button>
            </div>
            <div className='parallel-copy__grid parallel-copy__grid--clients'>
                {clients.map(c => (
                    <article
                        key={c.id}
                        className={classNames('parallel-copy__card', {
                            'parallel-copy__card--demo': c.is_virtual,
                            'parallel-copy__card--real': !c.is_virtual,
                            'parallel-copy__card--copying': c.copying,
                        })}
                    >
                        <div className='parallel-copy__card-top'>
                            <h3 className='parallel-copy__card-name'>{c.label}</h3>
                            <div className='parallel-copy__account-tile-badges'>
                                <span
                                    className={classNames('parallel-copy__badge', {
                                        'parallel-copy__badge--demo': c.is_virtual,
                                        'parallel-copy__badge--real': !c.is_virtual,
                                    })}
                                >
                                    {c.is_virtual ? localize('Demo') : localize('Real')}
                                </span>
                            </div>
                        </div>
                        <p className='parallel-copy__card-login' title={c.loginid}>
                            {formatLoginidShort(c.loginid)}
                        </p>
                        <p className='parallel-copy__card-balance'>
                            {Number(c.balance).toFixed(2)}{' '}
                            <span className='parallel-copy__card-currency'>
                                {resolveLoginidCurrency(c.loginid, accountList)}
                            </span>
                        </p>
                        <div className='parallel-copy__card-actions'>
                            <button
                                type='button'
                                className={classNames('parallel-copy__btn', {
                                    'parallel-copy__btn--start': !c.copying,
                                    'parallel-copy__btn--stop': c.copying,
                                })}
                                disabled={busy || !client_lead_active}
                                title={
                                    !client_lead_active
                                        ? localize('Trade on the lead account to start copying')
                                        : undefined
                                }
                                onClick={() => onToggleCopying(c.id, !c.copying)}
                            >
                                {c.copying ? localize('Stop copying') : localize('Start copy')}
                            </button>
                            <button
                                type='button'
                                className='parallel-copy__btn parallel-copy__btn--danger'
                                onClick={() => onRemove(c.id, c.loginid)}
                            >
                                {localize('Remove')}
                            </button>
                        </div>
                    </article>
                ))}
            </div>
        </>
    );
}

const ParallelCopyTrading = observer(() => {
    const { activeLoginid, isAuthorized, accountList, authData } = useApiBase();
    const { client } = useStore() ?? {};
    const optionsOAuthSession = isDerivOptionsOAuthSession();
    const sessionLoggedIn =
        isAuthorized ||
        Boolean(client?.is_logged_in) ||
        (optionsOAuthSession && Boolean(activeLoginid));

    const [client_copiers, setClientCopiers] = useState(() => readParallelCopiers('client'));
    const [personal_on, setPersonalOn] = useState(isParallelCopyPersonalEnabled);
    const [personal_main, setPersonalMain] = useState<string | null>(() => getPersonalMainLoginid());
    const [personal_active, setPersonalActive] = useState<string[]>(() => readPersonalActiveCopiers());
    const [client_main, setClientMain] = useState<string | null>(() => getClientMainLoginid());
    const [client_token_input, setClientTokenInput] = useState('');
    const [session_balances, setSessionBalances] = useState<
        Record<string, { balance: number; currency: string }>
    >({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(() => {
        setClientCopiers(readParallelCopiers('client'));
        setPersonalMain(getPersonalMainLoginid());
        setPersonalActive(readPersonalActiveCopiers());
        setClientMain(getClientMainLoginid());
    }, []);

    useEffect(() => subscribeParallelCopiers(reload), [reload]);

    const session_accounts = useMemo(() => {
        const list = accountList?.length ? accountList : authData?.account_list;
        return readAllSessionAccounts(list) as TSessionAccount[];
    }, [accountList, authData?.account_list, activeLoginid, optionsOAuthSession]);

    useEffect(() => {
        if (!optionsOAuthSession || session_accounts.length > 0) return;
        void restoreDerivOptionsOAuthSessionFromStorage();
    }, [optionsOAuthSession, session_accounts.length]);

    const store_balances = useMemo(() => {
        const out: Record<string, { balance: number; currency: string }> = {};
        const accounts = client?.all_accounts_balance?.accounts;
        if (!accounts) return out;
        Object.entries(accounts).forEach(([loginid, data]) => {
            if (data?.balance != null) {
                out[loginid] = {
                    balance: Number(data.balance),
                    currency: resolveLoginidCurrency(loginid, accountList),
                };
            }
        });
        return out;
    }, [client?.all_accounts_balance, accountList]);

    const display_balances = useMemo(() => {
        const out: Record<string, { balance: number; currency: string }> = {
            ...store_balances,
        };
        session_accounts.forEach(acc => {
            const fetched = session_balances[acc.loginid];
            const currency = resolveLoginidCurrency(acc.loginid, accountList);
            if (fetched) {
                out[acc.loginid] = { balance: fetched.balance, currency };
            } else if (out[acc.loginid]) {
                out[acc.loginid] = { ...out[acc.loginid], currency };
            }
        });
        return out;
    }, [store_balances, session_balances, session_accounts, accountList]);

    useEffect(() => {
        if (personal_main || !session_accounts.length) return;
        const preferred =
            session_accounts.find(a => a.loginid === activeLoginid) ?? session_accounts[0];
        if (preferred?.loginid) {
            setPersonalMainLoginid(preferred.loginid);
            setPersonalMain(preferred.loginid);
        }
    }, [personal_main, session_accounts, activeLoginid]);

    useEffect(() => {
        if (client_main || !session_accounts.length) return;
        const preferred =
            session_accounts.find(a => !a.is_virtual) ?? session_accounts[0];
        if (preferred?.loginid) {
            setClientMainLoginid(preferred.loginid);
            setClientMain(preferred.loginid);
        }
    }, [client_main, session_accounts]);

    const refresh_session_balances = useCallback(async () => {
        for (const acc of session_accounts) {
            try {
                const api = await api_base.getCopierTradingApi(acc.loginid);
                if (!api) continue;
                const res = (await api.send({ balance: 1 })) as {
                    balance?: { balance?: number; currency?: string };
                };
                const balance = Number(res?.balance?.balance ?? 0);
                const currency =
                    (res?.balance?.currency && String(res.balance.currency).trim()) ||
                    resolveLoginidCurrency(acc.loginid, accountList);
                setSessionBalances(prev => ({
                    ...prev,
                    [acc.loginid]: { balance, currency },
                }));
            } catch {
                /* noop */
            }
        }
    }, [session_accounts, accountList]);

    const refresh_client_balances = useCallback(async () => {
        const list = readParallelCopiers('client');
        for (const copier of list) {
            try {
                const api = await api_base.getCopierTradingApi(copier.loginid);
                if (!api) continue;
                const res = (await api.send({ balance: 1 })) as {
                    balance?: { balance?: number; currency?: string };
                };
                const bal = Number(res?.balance?.balance ?? copier.balance);
                const cur =
                    (res?.balance?.currency && String(res.balance.currency).trim()) ||
                    resolveLoginidCurrency(copier.loginid, accountList);
                updateCopierBalance(copier.loginid, bal, cur);
            } catch {
                /* noop */
            }
        }
    }, [accountList]);

    useEffect(() => {
        if (!session_accounts.length) return undefined;
        void refresh_session_balances();
        const id = window.setInterval(() => void refresh_session_balances(), 15000);
        return () => clearInterval(id);
    }, [session_accounts, refresh_session_balances]);

    useEffect(() => {
        if (!client_copiers.length) return undefined;
        void refresh_client_balances();
        const id = window.setInterval(() => void refresh_client_balances(), 15000);
        return () => clearInterval(id);
    }, [client_copiers.length, refresh_client_balances]);

    const prefetch_copiers = () => {
        api_base.prefetchCopierTradingApis();
    };

    const handle_toggle_personal = () => {
        const next = !personal_on;
        setPersonalOn(next);
        setParallelCopyPersonalEnabled(next);
        setError(null);
        if (next) prefetch_copiers();
        else if (!client_copiers.some(c => c.copying)) api_base.clearCopierApis();
    };

    const select_personal_main = useCallback((loginid: string) => {
        if (!loginid) return;
        setPersonalMain(loginid);
        setPersonalMainLoginid(loginid);
        setPersonalActive(readPersonalActiveCopiers());
        setError(null);
    }, []);

    const toggle_personal_copier = (loginid: string) => {
        togglePersonalActiveCopier(loginid);
        setPersonalActive(readPersonalActiveCopiers());
        setError(null);
        if (personal_on) void api_base.getCopierTradingApi(loginid);
    };

    const switch_to_personal_lead = async () => {
        if (!personal_main) return;
        const account = session_accounts.find(a => a.loginid === personal_main);
        if (!account) {
            setError(localize('Lead account is not in this session'));
            return;
        }
        if (account.loginid === activeLoginid) return;
        setError(null);
        try {
            if (!isDerivOptionsOAuthSession()) {
                localStorage.setItem('authToken', account.token);
            }
            localStorage.setItem('active_loginid', account.loginid);
            await api_base.createNewInstance(account.loginid);
        } catch (e) {
            setError(e instanceof Error ? e.message : localize('Could not switch account'));
        }
    };

    const add_client_from_token = async () => {
        const token = client_token_input.trim();
        if (!token) return;
        if (!client_main) {
            setError(localize('Select a lead account first'));
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const auth = await authorizeCopierToken(token);
            if (auth.loginid === client_main) {
                setError(localize('Lead account cannot also be a client'));
                return;
            }
            const exists = readParallelCopiers('client').some(c => c.loginid === auth.loginid);
            if (exists) {
                setError(localize('This client is already added'));
                return;
            }
            addParallelCopier('client', {
                loginid: auth.loginid,
                token: auth.token,
                currency: resolveLoginidCurrency(auth.loginid, accountList) || auth.currency,
                balance: auth.balance,
                is_virtual: auth.is_virtual,
                copying: false,
            });
            setClientTokenInput('');
        } catch (e) {
            setError(e instanceof Error ? e.message : localize('Could not add client'));
        } finally {
            setBusy(false);
        }
    };

    const select_client_main = (loginid: string) => {
        setClientMainLoginid(loginid);
        setClientMain(loginid);
        setError(null);
    };

    const switch_to_client_main = async () => {
        if (!client_main) return;
        const account = session_accounts.find(a => a.loginid === client_main);
        if (!account) {
            setError(localize('Lead account is not in this session'));
            return;
        }
        if (account.loginid === activeLoginid) return;
        setError(null);
        try {
            if (!isDerivOptionsOAuthSession()) {
                localStorage.setItem('authToken', account.token);
            }
            localStorage.setItem('active_loginid', account.loginid);
            await api_base.createNewInstance(account.loginid);
        } catch (e) {
            setError(e instanceof Error ? e.message : localize('Could not switch account'));
        }
    };

    const toggle_client_copying = (id: string, copying: boolean) => {
        setClientCopying(id, copying);
        reload();
        setError(null);
        if (copying) {
            const copier = readParallelCopiers('client').find(c => c.id === id);
            if (copier) void api_base.getCopierTradingApi(copier.loginid);
            prefetch_copiers();
        } else {
            const still_copying = readParallelCopiers('client').some(c => c.copying);
            if (!still_copying && !personal_on) api_base.clearCopierApis();
        }
    };

    const remove_client = (id: string, loginid: string) => {
        removeParallelCopier('client', id);
        api_base.disconnectCopierApi(loginid);
        syncCopiersToAccountsList(readParallelCopiers('client'));
    };

    const client_main_active = client_main === activeLoginid;
    const client_copying_count = client_copiers.filter(c => c.copying).length;
    const personal_main_active = personal_main === activeLoginid;
    const personal_active_count = personal_active.length;
    const personal_mirror_ready =
        personal_on && personal_main_active && personal_active_count > 0;

    return (
        <div className='parallel-copy-page'>
            <div className='parallel-copy'>
                <header className='parallel-copy__header'>
                    <div>
                        <h1 className='parallel-copy__title'>{localize('Denara Copytrading')}</h1>
                        <p className='parallel-copy__subtitle'>
                            {localize(
                                'Denara Copytrading — copy smarter, trade sharper.'
                            )}
                        </p>
                    </div>
                </header>

                {error && <p className='parallel-copy__error'>{error}</p>}

                <div className='parallel-copy__panels'>
                    <section className='parallel-copy__panel parallel-copy__panel--personal'>
                        <div className='parallel-copy__panel-head'>
                            <div>
                                <h2 className='parallel-copy__panel-title'>
                                    {localize('Copy trades to your own accounts')}
                                </h2>
                                <p className='parallel-copy__panel-desc'>
                                    {localize(
                                        'Select one account as your trading account, and then copy trades to your other accounts.'
                                    )}
                                </p>
                            </div>
                            <ToggleSwitch
                                id='parallel_copy_personal_toggle'
                                is_enabled={personal_on}
                                handleToggle={handle_toggle_personal}
                                name='parallel_copy_personal'
                            />
                        </div>

                        {sessionLoggedIn && session_accounts.length > 0 ? (
                            <>
                                <span className='parallel-copy__session-label'>
                                    {localize('Session accounts')}
                                </span>
                                <p className='parallel-copy__hint parallel-copy__hint--inline'>
                                    {localize(
                                        'Mark one account as Trading (lead). Use Start copy on the others.'
                                    )}
                                </p>
                                <PersonalAccountRow
                                    accounts={session_accounts}
                                    personal_main={personal_main}
                                    personal_active={personal_active}
                                    balances={display_balances}
                                    on_set_lead={select_personal_main}
                                    on_toggle_copier={toggle_personal_copier}
                                />
                                {personal_main && !personal_main_active && (
                                    <button
                                        type='button'
                                        className='parallel-copy__btn parallel-copy__btn--primary parallel-copy__btn--switch-main'
                                        disabled={busy}
                                        onClick={() => void switch_to_personal_lead()}
                                    >
                                        {localize('Switch to trading account')} ({formatLoginidShort(personal_main)})
                                    </button>
                                )}
                                {personal_on && personal_main && !personal_main_active && (
                                    <p className='parallel-copy__warn'>
                                        {localize(
                                            'Personal copy is paused until you trade on the lead account.'
                                        )}
                                    </p>
                                )}
                                {personal_on && personal_mirror_ready && (
                                    <p className='parallel-copy__ok'>
                                        {localize('Personal copy active — {{count}} copier(s).', {
                                            count: personal_active_count,
                                        })}
                                    </p>
                                )}
                            </>
                        ) : sessionLoggedIn ? (
                            <p className='parallel-copy__hint'>
                                {localize('Loading your session accounts…')}
                            </p>
                        ) : (
                            <p className='parallel-copy__hint'>
                                {localize('Log in to see your session accounts.')}
                            </p>
                        )}
                    </section>

                    <section className='parallel-copy__panel parallel-copy__panel--client'>
                        <div className='parallel-copy__panel-head'>
                            <div>
                                <h2 className='parallel-copy__panel-title'>
                                    {localize('Copy trades to client accounts')}
                                </h2>
                                <p className='parallel-copy__panel-desc'>
                                    {localize(
                                        'Choose a trading account as the trading account, and clients tokens and start copytrading.'
                                    )}
                                </p>
                            </div>
                        </div>

                        {sessionLoggedIn && session_accounts.length > 0 ? (
                            <div className='parallel-copy__main-select'>
                                <span className='parallel-copy__session-label'>
                                    {localize('Trading account (from session)')}
                                </span>
                                <div className='parallel-copy__account-row parallel-copy__account-row--lead-only'>
                                    {session_accounts.map(acc => (
                                        <label
                                            key={`c-lead-${acc.loginid}`}
                                            className={classNames('parallel-copy__account-tile parallel-copy__account-tile--pick', {
                                                'parallel-copy__account-tile--lead':
                                                    client_main === acc.loginid,
                                            })}
                                        >
                                            <input
                                                type='radio'
                                                name='parallel_client_lead'
                                                checked={client_main === acc.loginid}
                                                onChange={() => select_client_main(acc.loginid)}
                                            />
                                            <span className='parallel-copy__account-tile-id' title={acc.loginid}>
                                                {formatLoginidShort(acc.loginid)}
                                            </span>
                                            <div className='parallel-copy__account-tile-badges'>
                                                <span
                                                    className={classNames('parallel-copy__chip-tag', {
                                                        'parallel-copy__chip-tag--demo': acc.is_virtual,
                                                        'parallel-copy__chip-tag--real': !acc.is_virtual,
                                                    })}
                                                >
                                                    {acc.is_virtual ? localize('Demo') : localize('Real')}
                                                </span>
                                            </div>
                                            <p className='parallel-copy__account-tile-balance'>
                                                {display_balances[acc.loginid] != null ? (
                                                    <>
                                                        {display_balances[acc.loginid].balance.toFixed(2)}{' '}
                                                        <span>{display_balances[acc.loginid].currency}</span>
                                                    </>
                                                ) : (
                                                    '—'
                                                )}
                                            </p>
                                        </label>
                                    ))}
                                </div>
                                {client_main && !client_main_active && (
                                    <button
                                        type='button'
                                        className='parallel-copy__btn parallel-copy__btn--primary parallel-copy__btn--switch-main'
                                        disabled={busy}
                                        onClick={() => void switch_to_client_main()}
                                    >
                                        {localize('Switch to trading account')} ({formatLoginidShort(client_main)})
                                    </button>
                                )}
                                {client_main && !client_main_active && client_copying_count > 0 && (
                                    <p className='parallel-copy__warn'>
                                        {localize(
                                            'Start/Stop works when you trade on the selected lead account.'
                                        )}
                                    </p>
                                )}
                                {client_main_active && client_copying_count > 0 && (
                                    <p className='parallel-copy__ok'>
                                        {localize('Copying to {{count}} client(s).', {
                                            count: client_copying_count,
                                        })}
                                    </p>
                                )}
                            </div>
                        ) : sessionLoggedIn ? (
                            <p className='parallel-copy__hint'>
                                {localize('Loading your session accounts…')}
                            </p>
                        ) : (
                            <p className='parallel-copy__hint'>
                                {localize('Log in to choose a lead from your session accounts.')}
                            </p>
                        )}

                        <div className='parallel-copy__token-row'>
                            <input
                                className='parallel-copy__input'
                                type='password'
                                autoComplete='off'
                                placeholder={localize('Paste client API token')}
                                value={client_token_input}
                                onChange={e => setClientTokenInput(e.target.value)}
                                disabled={busy || !client_main}
                            />
                            <button
                                type='button'
                                className='parallel-copy__btn parallel-copy__btn--primary'
                                disabled={busy || !client_token_input.trim() || !client_main}
                                onClick={() => void add_client_from_token()}
                            >
                                {localize('Add client')}
                            </button>
                        </div>

                        <h3 className='parallel-copy__section-title'>{localize('Clients')}</h3>
                        <ClientCards
                            clients={client_copiers}
                            busy={busy}
                            client_lead_active={client_main_active}
                            accountList={accountList}
                            onRefresh={() => void refresh_client_balances()}
                            onRemove={remove_client}
                            onToggleCopying={toggle_client_copying}
                        />
                    </section>
                </div>
            </div>
        </div>
    );
});

export default ParallelCopyTrading;
