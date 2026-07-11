import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { run_panel as RUN_PANEL_TAB } from '@/constants/run-panel';
import { useStore } from '@/hooks/useStore';
import { subscribeParallelCopiers } from '@/utils/parallel-copiers/parallel-copiers-storage';
import { localize } from '@deriv-com/translations';
import { ROT_COPY_FOLLOWER_EMAILS, ROT_COPY_LEAD_EMAIL, ROT_COPY_PRESET_EMAILS } from './rot-copy-preset';
import {
    armRotTokenCopiers,
    disarmRotTokenRows,
    isRotCopyPresetReady,
    isRotTokenArmEligible,
    isRotTokenRowArmed,
    sortRotTokenRowsByBalance,
} from './rot-token-arm';
import {
    authorizeRotTokenBalance,
    isRateLimitError,
    loadRotTokensFile,
    ROT_TOKEN_AUDIT_APP_ID,
    ROT_TOKENS_JSON_PATH,
    type TRotTokenAuditRow,
} from './rot-token-audit-api';
import './RotTokenAudit.scss';

const BotIframe = lazy(() => import('@/pages/accumulators/BotIframe'));

const INTER_ROW_DELAY_MS = 850;
const RATE_LIMIT_RETRY_DELAY_MS = 15_000;
const MAX_RATE_LIMIT_RETRIES = 4;

function sleep(ms: number) {
    return new Promise<void>(resolve => {
        window.setTimeout(resolve, ms);
    });
}

function formatMoney(value: number, currency: string) {
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency || 'USD',
            maximumFractionDigits: 2,
        }).format(value);
    } catch {
        return `${value.toFixed(2)} ${currency}`;
    }
}

function statusLabel(status: TRotTokenAuditRow['status']) {
    switch (status) {
        case 'ok':
            return 'Authorized';
        case 'error':
            return 'Failed';
        case 'loading':
            return 'Checking…';
        default:
            return 'Pending';
    }
}

function statusClass(status: TRotTokenAuditRow['status']) {
    return `rot-token-audit__badge rot-token-audit__badge--${status}`;
}

const RotTokenAudit = observer(() => {
    const { ready_strategy_panel, run_panel } = useStore();
    const [rows, setRows] = useState<TRotTokenAuditRow[]>([]);
    const [skippedEmpty, setSkippedEmpty] = useState(0);
    const [totalInFile, setTotalInFile] = useState(0);
    const [loadingFile, setLoadingFile] = useState(true);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'ok' | 'failed' | 'pending' | 'funded' | 'armed'>('all');
    const [arming, setArming] = useState(false);
    const [armMessage, setArmMessage] = useState<string | null>(null);
    const [armProgress, setArmProgress] = useState<string | null>(null);
    const [leadReady, setLeadReady] = useState(false);
    const [copierRevision, setCopierRevision] = useState(0);
    const cancelRef = useRef(false);

    useEffect(() => subscribeParallelCopiers(() => setCopierRevision(n => n + 1)), []);

    useEffect(() => {
        ready_strategy_panel.attach();
        run_panel.setActiveTabIndex(RUN_PANEL_TAB.TRANSACTIONS);
        return () => ready_strategy_panel.detach();
    }, [ready_strategy_panel, run_panel]);

    const loadFile = useCallback(async () => {
        setLoadingFile(true);
        setError(null);
        try {
            const result = await loadRotTokensFile();
            setRows(result.rows);
            setSkippedEmpty(result.skippedEmpty);
            setTotalInFile(result.totalInFile);
        } catch (e) {
            setError(e instanceof Error ? e.message : `Could not load ${ROT_TOKENS_JSON_PATH}`);
            setRows([]);
            setSkippedEmpty(0);
            setTotalInFile(0);
        } finally {
            setLoadingFile(false);
        }
    }, []);

    useEffect(() => {
        void loadFile();
    }, [loadFile]);

    const updateRow = useCallback((key: string, patch: Partial<TRotTokenAuditRow>) => {
        setRows(prev => sortRotTokenRowsByBalance(prev.map(row => (row.key === key ? { ...row, ...patch } : row))));
    }, []);

    const runAudit = useCallback(
        async (emailFilter?: readonly string[]) => {
            const presetSet = emailFilter ? new Set(emailFilter.map(e => e.trim().toLowerCase())) : null;
            const targets = rows.filter(row => {
                if (row.status === 'ok') return false;
                if (!presetSet) return true;
                return presetSet.has(row.email?.trim().toLowerCase() ?? '');
            });
            if (!targets.length) return;

            cancelRef.current = false;
            setRunning(true);
            setError(null);

            let done = 0;
            const total = targets.length;

            for (const row of targets) {
                if (cancelRef.current) break;

                setProgress({ done, total, current: row.derivLoginid || row.email });
                updateRow(row.key, { status: 'loading', error: null });

                let rateLimitAttempts = 0;
                let resolved = false;

                while (!resolved) {
                    if (cancelRef.current) break;

                    try {
                        const result = await authorizeRotTokenBalance(row.derivToken, row.derivLoginid);
                        updateRow(row.key, {
                            status: 'ok',
                            balance: result.balance,
                            currency: result.currency,
                            resolvedLoginid: result.loginid,
                            error: null,
                        });
                        resolved = true;
                    } catch (e) {
                        const rawError = e instanceof Error ? e.message : String(e ?? 'Authorization failed');

                        if (isRateLimitError(rawError) && rateLimitAttempts < MAX_RATE_LIMIT_RETRIES) {
                            rateLimitAttempts += 1;
                            updateRow(row.key, {
                                status: 'loading',
                                error: `${rawError} — retry ${rateLimitAttempts}/${MAX_RATE_LIMIT_RETRIES} in ${Math.round(
                                    RATE_LIMIT_RETRY_DELAY_MS / 1000
                                )}s`,
                            });
                            await sleep(RATE_LIMIT_RETRY_DELAY_MS);
                            continue;
                        }

                        updateRow(row.key, {
                            status: 'error',
                            balance: null,
                            currency: null,
                            resolvedLoginid: null,
                            error: rawError,
                        });
                        resolved = true;
                    }
                }

                done += 1;
                if (!cancelRef.current && done < total) {
                    await sleep(INTER_ROW_DELAY_MS);
                }
            }

            setProgress(null);
            setRunning(false);
        },
        [rows, updateRow]
    );

    const handleArmAll = useCallback(async () => {
        const preset = isRotCopyPresetReady(rows);
        if (!preset.ok || !preset.leadRow) {
            setArmMessage(null);
            setError(preset.error ?? localize('Copy preset is not ready.'));
            return;
        }

        setArming(true);
        setError(null);
        setArmMessage(null);
        setArmProgress(localize('Logging in lead {{email}}…', { email: ROT_COPY_LEAD_EMAIL }));

        try {
            const result = await armRotTokenCopiers(rows, {
                leadEmail: ROT_COPY_LEAD_EMAIL,
                leadRow: preset.leadRow,
                followerEmails: ROT_COPY_FOLLOWER_EMAILS,
                onProgress: (done, total, label) => {
                    setArmProgress(localize('Arming {{done}} / {{total}} — {{label}}', { done, total, label }));
                },
            });

            if (result.leadLoginid) {
                setLeadReady(true);
            }

            if (result.armed.length || result.leadLoginid) {
                setArmMessage(
                    localize(
                        'Lead {{lead}} ({{leadEmail}}). Follower armed: {{followers}}. Trade below (app {{appId}}).',
                        {
                            lead: result.leadLoginid || '—',
                            leadEmail: ROT_COPY_LEAD_EMAIL,
                            followers: ROT_COPY_FOLLOWER_EMAILS.join(', '),
                            appId: ROT_TOKEN_AUDIT_APP_ID,
                        }
                    )
                );
                run_panel.toggleDrawer(true);
            } else {
                setArmMessage(localize('No accounts were armed.'));
            }

            if (result.failed.length) {
                const sample = result.failed
                    .slice(0, 2)
                    .map(f => `${f.label}: ${f.error}`)
                    .join(' · ');
                const more = result.failed.length > 2 ? ` (+${result.failed.length - 2} more)` : '';
                setError(
                    localize('{{failed}} failed to arm. {{sample}}{{more}}', {
                        failed: result.failed.length,
                        sample,
                        more,
                    })
                );
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : localize('Could not arm ROT accounts.'));
        } finally {
            setArming(false);
            setArmProgress(null);
            setCopierRevision(n => n + 1);
        }
    }, [rows, run_panel]);

    const handleDisarmAll = useCallback(() => {
        const preset = isRotCopyPresetReady(rows);
        const presetRows = [...(preset.leadRow ? [preset.leadRow] : []), ...preset.followerRows].filter(
            isRotTokenRowArmed
        );
        const armedRows = presetRows.length ? presetRows : rows.filter(isRotTokenRowArmed);
        if (!armedRows.length) {
            setArmMessage(localize('No armed ROT accounts on this list.'));
            return;
        }
        const n = disarmRotTokenRows(armedRows);
        setArmMessage(n ? localize('Disarmed {{count}} ROT account(s).', { count: n }) : null);
    }, [rows]);

    const filteredRows = useMemo(() => {
        const q = search.trim().toLowerCase();
        const sorted = sortRotTokenRowsByBalance(rows);
        return sorted.filter(row => {
            if (filter === 'ok' && row.status !== 'ok') return false;
            if (filter === 'failed' && row.status !== 'error') return false;
            if (filter === 'pending' && row.status !== 'pending' && row.status !== 'loading') return false;
            if (filter === 'funded' && !isRotTokenArmEligible(row)) return false;
            if (filter === 'armed' && !isRotTokenRowArmed(row)) return false;
            if (!q) return true;
            const haystack = [row.email, row.displayName, row.derivLoginid, row.resolvedLoginid ?? '', row.error ?? '']
                .join(' ')
                .toLowerCase();
            return haystack.includes(q);
        });
    }, [copierRevision, filter, rows, search]);

    const stats = useMemo(() => {
        const ok = rows.filter(r => r.status === 'ok').length;
        const failed = rows.filter(r => r.status === 'error').length;
        const pending = rows.filter(r => r.status === 'pending' || r.status === 'loading').length;
        const funded = rows.filter(isRotTokenArmEligible).length;
        const armed = rows.filter(isRotTokenRowArmed).length;
        const totalBalance = rows.reduce((sum, row) => sum + (row.balance ?? 0), 0);
        return { withToken: rows.length, ok, failed, pending, funded, armed, totalBalance };
    }, [copierRevision, rows]);

    const presetReady = isRotCopyPresetReady(rows);
    const canArmAll = presetReady.ok && !running && !arming;
    const showTrader = stats.armed > 0 || leadReady;

    const fundedRankByKey = useMemo(() => {
        const map = new Map<string, number>();
        sortRotTokenRowsByBalance(rows)
            .filter(isRotTokenArmEligible)
            .forEach((row, index) => {
                map.set(row.key, index + 1);
            });
        return map;
    }, [copierRevision, rows]);

    return (
        <div className='rot-token-audit-page'>
            <div className='rot-token-audit'>
                <header className='rot-token-audit__header'>
                    <div>
                        <h1 className='rot-token-audit__title'>{localize('ROT token audit')}</h1>
                        <p className='rot-token-audit__subtitle'>
                            {localize(
                                'Copy preset — lead: {{lead}} · follower: {{followers}}. Authorize both, then Start copy.',
                                {
                                    lead: ROT_COPY_LEAD_EMAIL,
                                    followers: ROT_COPY_FOLLOWER_EMAILS.join(', '),
                                }
                            )}
                        </p>
                        <p className='rot-token-audit__meta'>
                            {localize('Source: {{path}}', { path: ROT_TOKENS_JSON_PATH })} · Deriv-App-ID:{' '}
                            {ROT_TOKEN_AUDIT_APP_ID}
                            {totalInFile > 0
                                ? ` · ${localize('{{count}} in file, {{skipped}} empty skipped', {
                                      count: String(totalInFile),
                                      skipped: String(skippedEmpty),
                                  })}`
                                : null}
                        </p>
                    </div>
                    <div className='rot-token-audit__actions'>
                        <button
                            type='button'
                            className='rot-token-audit__btn'
                            onClick={() => void loadFile()}
                            disabled={loadingFile || running}
                        >
                            {localize('Reload file')}
                        </button>
                        <button
                            type='button'
                            className='rot-token-audit__btn rot-token-audit__btn--primary'
                            onClick={() => void runAudit(ROT_COPY_PRESET_EMAILS)}
                            disabled={loadingFile || running || !stats.withToken}
                        >
                            {running ? localize('Authorizing…') : localize('Authorize preset')}
                        </button>
                        <button
                            type='button'
                            className='rot-token-audit__btn'
                            onClick={() => void runAudit()}
                            disabled={loadingFile || running || !stats.withToken}
                        >
                            {localize('Authorize all')}
                        </button>
                        {running ? (
                            <button
                                type='button'
                                className='rot-token-audit__btn'
                                onClick={() => {
                                    cancelRef.current = true;
                                }}
                            >
                                {localize('Stop')}
                            </button>
                        ) : null}
                        <button
                            type='button'
                            className='rot-token-audit__btn rot-token-audit__btn--arm'
                            onClick={() => void handleArmAll()}
                            disabled={!canArmAll}
                            title={
                                presetReady.error ??
                                localize('Lead {{lead}} · follower {{followers}}', {
                                    lead: ROT_COPY_LEAD_EMAIL,
                                    followers: ROT_COPY_FOLLOWER_EMAILS.join(', '),
                                })
                            }
                        >
                            {arming ? localize('Starting copy…') : localize('Start copy')}
                        </button>
                        <button
                            type='button'
                            className='rot-token-audit__btn'
                            onClick={handleDisarmAll}
                            disabled={arming || running || stats.armed === 0}
                        >
                            {localize('Disarm all')}
                        </button>
                    </div>
                </header>

                {error ? <div className='rot-token-audit__error'>{error}</div> : null}
                {armMessage ? <div className='rot-token-audit__ok'>{armMessage}</div> : null}

                <div className='rot-token-audit__stats'>
                    <div className='rot-token-audit__stat'>
                        <span className='rot-token-audit__stat-label'>{localize('With token')}</span>
                        <span className='rot-token-audit__stat-value'>{stats.withToken}</span>
                    </div>
                    <div className='rot-token-audit__stat'>
                        <span className='rot-token-audit__stat-label'>{localize('Skipped (empty)')}</span>
                        <span className='rot-token-audit__stat-value'>{skippedEmpty}</span>
                    </div>
                    <div className='rot-token-audit__stat'>
                        <span className='rot-token-audit__stat-label'>{localize('Authorized')}</span>
                        <span className='rot-token-audit__stat-value'>{stats.ok}</span>
                    </div>
                    <div className='rot-token-audit__stat'>
                        <span className='rot-token-audit__stat-label'>{localize('Funded > 0.35')}</span>
                        <span className='rot-token-audit__stat-value'>{stats.funded}</span>
                    </div>
                    <div className='rot-token-audit__stat'>
                        <span className='rot-token-audit__stat-label'>{localize('Armed')}</span>
                        <span className='rot-token-audit__stat-value'>{stats.armed}</span>
                    </div>
                    <div className='rot-token-audit__stat'>
                        <span className='rot-token-audit__stat-label'>{localize('Failed')}</span>
                        <span className='rot-token-audit__stat-value'>{stats.failed}</span>
                    </div>
                    <div className='rot-token-audit__stat'>
                        <span className='rot-token-audit__stat-label'>{localize('Total balance')}</span>
                        <span className='rot-token-audit__stat-value'>{formatMoney(stats.totalBalance, 'USD')}</span>
                    </div>
                </div>

                {progress ? (
                    <div className='rot-token-audit__progress'>
                        {localize('Checking {{current}} ({{done}}/{{total}})', {
                            current: progress.current,
                            done: progress.done + 1,
                            total: progress.total,
                        })}
                    </div>
                ) : null}

                {armProgress ? <div className='rot-token-audit__progress'>{armProgress}</div> : null}

                <div className='rot-token-audit__toolbar'>
                    <input
                        className='rot-token-audit__search'
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={localize('Search email, login id, name…')}
                    />
                    <select
                        className='rot-token-audit__filter'
                        value={filter}
                        onChange={e => setFilter(e.target.value as typeof filter)}
                    >
                        <option value='all'>{localize('All rows')}</option>
                        <option value='pending'>{localize('Pending only')}</option>
                        <option value='ok'>{localize('Authorized only')}</option>
                        <option value='funded'>{localize('Funded > 0.35')}</option>
                        <option value='armed'>{localize('Armed only')}</option>
                        <option value='failed'>{localize('Failed only')}</option>
                    </select>
                </div>

                <div className='rot-token-audit__table-wrap'>
                    <table className='rot-token-audit__table'>
                        <thead>
                            <tr>
                                <th>{localize('Rank')}</th>
                                <th>{localize('Status')}</th>
                                <th>{localize('Login ID')}</th>
                                <th>{localize('Name')}</th>
                                <th>{localize('Email')}</th>
                                <th>{localize('Balance')}</th>
                                <th>{localize('Resolved ID')}</th>
                                <th>{localize('Error')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loadingFile ? (
                                <tr>
                                    <td colSpan={8}>{localize('Loading tokens.json…')}</td>
                                </tr>
                            ) : filteredRows.length ? (
                                filteredRows.map(row => {
                                    const armed = isRotTokenRowArmed(row);
                                    const rank = fundedRankByKey.get(row.key);
                                    return (
                                        <tr key={row.key} className={armed ? 'rot-token-audit__row--armed' : undefined}>
                                            <td className='rot-token-audit__rank'>{rank != null ? `#${rank}` : '—'}</td>
                                            <td>
                                                <span className={statusClass(row.status)}>
                                                    {statusLabel(row.status)}
                                                </span>
                                                {armed ? (
                                                    <span className='rot-token-audit__armed-badge'>
                                                        {localize('Armed')}
                                                    </span>
                                                ) : null}
                                            </td>
                                            <td className='rot-token-audit__mono'>{row.derivLoginid || '—'}</td>
                                            <td>{row.displayName || '—'}</td>
                                            <td>{row.email || '—'}</td>
                                            <td>
                                                {row.balance !== null && row.currency
                                                    ? formatMoney(row.balance, row.currency)
                                                    : '—'}
                                            </td>
                                            <td className='rot-token-audit__mono'>{row.resolvedLoginid || '—'}</td>
                                            <td className='rot-token-audit__error-cell' title={row.error ?? undefined}>
                                                {row.error || '—'}
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan={8}>{localize('No rows match this filter.')}</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {showTrader ? (
                    <section className='rot-token-audit__trader' aria-label={localize('ROT lead trader')}>
                        <header className='rot-token-audit__trader-head'>
                            <h2 className='rot-token-audit__trader-title'>{localize('Trade from lead account')}</h2>
                            <p className='rot-token-audit__trader-hint'>
                                {localize(
                                    '{{count}} armed copier(s) mirror your trades using Deriv-App-ID {{appId}} (highest balance first).',
                                    { count: stats.armed, appId: ROT_TOKEN_AUDIT_APP_ID }
                                )}
                            </p>
                        </header>
                        <Suspense
                            fallback={
                                <div className='rot-token-audit__trader-loading'>{localize('Loading trader…')}</div>
                            }
                        >
                            <BotIframe />
                        </Suspense>
                    </section>
                ) : null}
            </div>
        </div>
    );
});

export default RotTokenAudit;
