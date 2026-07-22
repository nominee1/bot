import { useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { MAIN_APP_TAB_INDEX } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import {
    ASIANS_CONTRACTS,
    ASIANS_SCAN_SYMBOLS,
    getContractDef,
    type TAsiansContractId,
    type TAsiansSide,
} from './asiansContractCatalog';
import { useAsiansAnalysis } from './useAsiansAnalysis';
import './asiansAnalysis.scss';

export type TAsiansAnalysisPanelProps = {
    active?: boolean;
    /** Compact chrome for right-rail embed (legacy — prefer `page`). */
    embedded?: boolean;
    /** Full main-tab layout. */
    page?: boolean;
    onClose?: () => void;
};

function formatUpdatedAt(iso: string | null): string {
    if (!iso) return 'waiting for first pass';
    try {
        return new Date(iso).toLocaleTimeString();
    } catch {
        return iso;
    }
}

function scoreTone(score: number): 'hot' | 'warm' | 'cool' {
    if (score >= 28) return 'hot';
    if (score >= 18) return 'warm';
    return 'cool';
}

export default function AsiansAnalysisPanel({
    active = true,
    embedded = false,
    page = false,
    onClose,
}: TAsiansAnalysisPanelProps) {
    const { dashboard } = useStore();
    const { setActiveTab } = dashboard;

    const [contractId, setContractId] = useState<TAsiansContractId>('runs');
    const def = getContractDef(contractId);
    const [side, setSide] = useState<TAsiansSide>(def.sides[0].id);
    const [duration, setDuration] = useState(def.defaultDurationTicks);

    useEffect(() => {
        const next = getContractDef(contractId);
        setSide(next.sides[0].id);
        setDuration(next.defaultDurationTicks);
    }, [contractId]);

    const scanner = useAsiansAnalysis(active, contractId, side, duration);

    const topRows = useMemo(() => scanner.rows.slice(0, page ? 13 : 8), [scanner.rows, page]);
    const skeletonCount = page ? 6 : 3;
    const showSkeleton =
        scanner.scanning && topRows.length < (page ? 8 : 4)
            ? Math.max(0, skeletonCount - Math.min(topRows.length, skeletonCount))
            : 0;
    const progressPct = scanner.progress.total ? Math.round((scanner.progress.done / scanner.progress.total) * 100) : 0;

    const openAsiansTab = () => {
        setActiveTab(MAIN_APP_TAB_INDEX.DERIV_SMARTTRADER);
        onClose?.();
    };

    return (
        <div
            className={classNames('asians-analysis__panel', {
                'asians-analysis__panel--embedded': embedded,
                'asians-analysis__panel--page': page,
            })}
        >
            <div className={classNames('asians-analysis__foreground', { 'asians-analysis__foreground--page': page })}>
                <header className='asians-analysis__header'>
                    <div className='asians-analysis__brand'>
                        <span className='asians-analysis__brand-icon' aria-hidden>
                            〰
                        </span>
                        <div>
                            <h2 className='asians-analysis__title' id='asians-analysis-title'>
                                Asians Path Lab
                            </h2>
                            <p className='asians-analysis__subtitle'>Tick-path heuristics for SmartTrader contracts</p>
                        </div>
                    </div>
                    <div className='asians-analysis__header-actions'>
                        <button
                            type='button'
                            className='asians-analysis__ghost-btn'
                            onClick={scanner.refresh}
                            disabled={scanner.scanning}
                        >
                            {scanner.scanning ? 'Scanning…' : 'Refresh'}
                        </button>
                        {onClose ? (
                            <button type='button' className='asians-analysis__ghost-btn' onClick={onClose}>
                                Close
                            </button>
                        ) : null}
                    </div>
                </header>

                <div className={classNames({ 'asians-analysis__layout': page })}>
                    <div className='asians-analysis__controls-col'>
                        <p className='asians-analysis__disclaimer'>
                            Volatility markets are designed to be random. Scores estimate how often a pattern showed up
                            in the last ~200 ticks — not a prediction of the next trade.
                        </p>

                        <div className='asians-analysis__contracts' role='tablist' aria-label='Contract type'>
                            {ASIANS_CONTRACTS.map(c => (
                                <button
                                    key={c.id}
                                    type='button'
                                    role='tab'
                                    aria-selected={contractId === c.id}
                                    className={classNames('asians-analysis__contract-chip', {
                                        'is-active': contractId === c.id,
                                    })}
                                    onClick={() => setContractId(c.id)}
                                >
                                    {c.label}
                                </button>
                            ))}
                        </div>

                        <div className='asians-analysis__rule'>
                            <strong>{def.label}</strong>
                            <span>{def.rule}</span>
                            <em>{def.heuristic}</em>
                        </div>

                        <div className='asians-analysis__controls'>
                            <div className='asians-analysis__sides' role='group' aria-label='Contract side'>
                                {def.sides.map(s => (
                                    <button
                                        key={s.id}
                                        type='button'
                                        className={classNames('asians-analysis__side-btn', {
                                            'is-active': side === s.id,
                                        })}
                                        onClick={() => setSide(s.id)}
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </div>
                            {contractId !== 'highlowticks' ? (
                                <label className='asians-analysis__duration'>
                                    <span>{contractId === 'runs' ? 'Min ticks' : 'Duration (ticks)'}</span>
                                    <input
                                        type='number'
                                        min={2}
                                        max={30}
                                        value={duration}
                                        onChange={e => setDuration(Math.max(2, Number(e.target.value) || 2))}
                                    />
                                </label>
                            ) : (
                                <span className='asians-analysis__duration-fixed'>Fixed 5-tick windows</span>
                            )}
                        </div>

                        <div className='asians-analysis__status'>
                            {scanner.scanning
                                ? `Scanning ${scanner.progress.symbol ?? '…'} (${scanner.progress.done}/${scanner.progress.total})`
                                : `Updated ${formatUpdatedAt(scanner.updatedAt)}${
                                      scanner.source ? ` · ${scanner.source} ticks` : ''
                                  }`}
                            {scanner.error ? <span className='asians-analysis__error'> · {scanner.error}</span> : null}
                        </div>

                        {scanner.scanning ? (
                            <div
                                className='asians-analysis__progress'
                                role='progressbar'
                                aria-valuenow={progressPct}
                                aria-valuemin={0}
                                aria-valuemax={100}
                            >
                                <div className='asians-analysis__progress-bar' style={{ width: `${progressPct}%` }} />
                            </div>
                        ) : null}

                        <button type='button' className='asians-analysis__cta' onClick={openAsiansTab}>
                            Open Asians desk
                        </button>
                    </div>

                    <ul
                        className={classNames('asians-analysis__list', {
                            'asians-analysis__list--grid': page,
                        })}
                    >
                        {topRows.map((row, index) => (
                            <li
                                key={`${row.symbol}-${row.side}`}
                                className={classNames('asians-analysis__row', `is-${scoreTone(row.score)}`)}
                            >
                                <div className='asians-analysis__row-top'>
                                    <span className='asians-analysis__rank'>#{index + 1}</span>
                                    <span className='asians-analysis__symbol'>{row.symbol}</span>
                                    <span className='asians-analysis__score'>{row.score.toFixed(1)}%</span>
                                </div>
                                <div className='asians-analysis__row-meta'>
                                    <span className='asians-analysis__side-tag'>{row.sideLabel}</span>
                                    {typeof row.meta?.streak === 'number' && row.meta.streak > 0 ? (
                                        <span className='asians-analysis__streak'>streak {row.meta.streak}</span>
                                    ) : null}
                                    {typeof row.meta?.trials === 'number' ? (
                                        <span>
                                            {row.meta.wins ?? 0}/{row.meta.trials} windows
                                        </span>
                                    ) : null}
                                </div>
                                <p className='asians-analysis__detail'>{row.detail}</p>
                            </li>
                        ))}
                        {showSkeleton > 0
                            ? ASIANS_SCAN_SYMBOLS.slice(0, showSkeleton).map(symbol => (
                                  <li
                                      key={`sk-${symbol}`}
                                      className='asians-analysis__row asians-analysis__row--skeleton'
                                  >
                                      <div className='asians-analysis__row-top'>
                                          <span className='asians-analysis__symbol'>{symbol}</span>
                                          <span className='asians-analysis__score'>…</span>
                                      </div>
                                      <p className='asians-analysis__detail'>Fetching ticks…</p>
                                  </li>
                              ))
                            : null}
                        {!scanner.scanning && topRows.length === 0 ? (
                            <li className='asians-analysis__empty'>
                                No rankings yet. Tap Refresh to pull the latest ~200 ticks per market.
                            </li>
                        ) : null}
                    </ul>
                </div>
            </div>
        </div>
    );
}
