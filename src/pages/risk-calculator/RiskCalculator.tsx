import { useCallback, useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import useActiveAccount from '@/hooks/api/account/useActiveAccount';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import {
    MIN_STAKE_USD,
    RISK_PROFILES,
    clampMartingaleMultiplier,
    buildGrowthLedger,
    computeRiskPlan,
    getContractSuggestions,
    type TContractSuggestion,
    clampSessionsPerDay,
    resizeSessionReturnPcts,
    sessionReturnPctFromStake,
    type TTradingLevel,
} from './risk-calculator-utils';
import './RiskCalculator.scss';

const MAIN_HASH = [
    'dashboard',
    'bot_builder',
    'Instant Fill',
    'Smart Trader',
    'Pro Aviator',
    'Auto Strategy',
    'Ready Strategies',
    'Double Double',
    'Manual Trader',
    'Risk Calculator',
    'Parallel Copy',
    'Challenge',
];

type TPageView = 'risk' | 'growth';

const SUGGESTION_ICONS: Record<TContractSuggestion['risk'], string> = {
    low: '📊',
    medium: '⚡',
    high: '🎯',
};

const RiskCalculator = observer(() => {
    const { client, dashboard } = useStore();
    const { activeLoginid } = useApiBase();
    const navigate = useNavigate();
    const { data: activeAccount } = useActiveAccount({ allBalanceData: client.all_accounts_balance });

    const rawBalance = useMemo(() => {
        const loginid = activeLoginid || activeAccount?.loginid;
        const bal = client.all_accounts_balance?.accounts?.[loginid ?? '']?.balance;
        if (typeof bal === 'number' && Number.isFinite(bal)) return bal;
        const parsed = parseFloat(String(activeAccount?.balance ?? '').replace(/,/g, ''));
        return Number.isFinite(parsed) ? parsed : 0;
    }, [activeLoginid, activeAccount, client.all_accounts_balance]);

    const [activeView, setActiveView] = useState<TPageView>('risk');
    const [level, setLevel] = useState<TTradingLevel>('beginner');
    const [martingaleMult, setMartingaleMult] = useState('1.25');
    const [manualBalance, setManualBalance] = useState('');
    const [useManualBalance, setUseManualBalance] = useState(false);

    const balance = useMemo(() => {
        if (useManualBalance) {
            const n = parseFloat(manualBalance);
            return Number.isFinite(n) && n > 0 ? n : rawBalance;
        }
        return rawBalance > 0 ? rawBalance : 100;
    }, [useManualBalance, manualBalance, rawBalance]);

    const profile = RISK_PROFILES[level];

    useEffect(() => {
        setMartingaleMult(String(profile.martingaleMultiplier));
    }, [level, profile.martingaleMultiplier]);

    const martingaleMultiplier = useMemo(
        () => clampMartingaleMultiplier(parseFloat(martingaleMult) || profile.martingaleMultiplier),
        [martingaleMult, profile.martingaleMultiplier]
    );

    const riskPlan = useMemo(
        () => computeRiskPlan(balance, level, martingaleMultiplier),
        [balance, level, martingaleMultiplier]
    );

    const [sessionsPerDay, setSessionsPerDay] = useState('3');
    const [sessionReturnPcts, setSessionReturnPcts] = useState<string[]>(['10', '10', '10']);
    const [challengeDays, setChallengeDays] = useState('10');
    const [withdrawalPct, setWithdrawalPct] = useState('50');
    const [reinvestPct, setReinvestPct] = useState('50');

    const sessionCount = clampSessionsPerDay(parseInt(sessionsPerDay, 10) || 3);

    useEffect(() => {
        setSessionReturnPcts(prev => {
            const resized = resizeSessionReturnPcts(
                prev.map(v => parseFloat(v) || 10),
                sessionCount
            );
            return resized.map(v => String(v));
        });
    }, [sessionCount]);

    const growth = useMemo(
        () =>
            buildGrowthLedger({
                startingBalance: balance,
                sessionReturnPcts: sessionReturnPcts.map(v => parseFloat(v) || 10),
                sessionsPerDay: sessionCount,
                days: parseInt(challengeDays, 10) || 10,
                withdrawalPctOfProfit: parseFloat(withdrawalPct) || 0,
                reinvestPctOfProfit: parseFloat(reinvestPct) || 0,
            }),
        [balance, sessionReturnPcts, sessionCount, challengeDays, withdrawalPct, reinvestPct]
    );

    const suggestions = useMemo(() => getContractSuggestions(level), [level]);

    const goToTab = useCallback(
        (tabIndex: number) => {
            dashboard.setActiveTab(tabIndex);
            navigate(`#${MAIN_HASH[tabIndex] ?? MAIN_HASH[0]}`);
        },
        [dashboard, navigate]
    );

    const applyRecommendedSessionReturn = () => {
        const pct = sessionReturnPctFromStake(balance, riskPlan.stake);
        setSessionReturnPcts(Array(sessionCount).fill(String(pct)));
    };

    const updateSessionReturnPct = (index: number, value: string) => {
        setSessionReturnPcts(prev => {
            const next = [...prev];
            next[index] = value;
            return next;
        });
    };

    const applyAllSessionsReturn = (value: string) => {
        setSessionReturnPcts(Array(sessionCount).fill(value));
    };

    const currency = activeAccount?.currency ?? 'USD';

    return (
        <div className='risk-calc-page'>
            <div className='risk-calc'>
                <header className='risk-calc__header'>
                    <div
                        className='risk-calc__view-switch'
                        role='tablist'
                        aria-label={localize('Planning views')}
                    >
                        <button
                            type='button'
                            role='tab'
                            aria-selected={activeView === 'risk'}
                            className={classNames('risk-calc__view-btn', {
                                'risk-calc__view-btn--active': activeView === 'risk',
                            })}
                            onClick={() => setActiveView('risk')}
                        >
                            {localize('Risk calculator')}
                        </button>
                        <button
                            type='button'
                            role='tab'
                            aria-selected={activeView === 'growth'}
                            className={classNames('risk-calc__view-btn', {
                                'risk-calc__view-btn--active': activeView === 'growth',
                            })}
                            onClick={() => setActiveView('growth')}
                        >
                            {localize('Grow account challenge')}
                        </button>
                    </div>
                </header>

                {activeView === 'risk' ? (
                    <div className='risk-calc__view risk-calc__view--risk'>
                        <div className='risk-calc__risk-layout'>
                        <div className='risk-calc__calculator'>
                            <div className='risk-calc__calc-display'>
                                <span className='risk-calc__calc-display-label'>
                                    {localize('Risk calculator')}
                                </span>
                                <div className='risk-calc__calc-display-value'>
                                    ${balance.toFixed(2)}
                                    <span className='risk-calc__calc-currency'>{currency}</span>
                                </div>
                                <div className='risk-calc__calc-display-meta'>
                                    {localize('{{pct}}% risk per trade · {{sl}}% daily stop · {{tp}}% daily target', {
                                        pct: String((profile.riskPerTradePct * 100).toFixed(1)),
                                        sl: String((profile.dailyStopLossPct * 100).toFixed(0)),
                                        tp: String((profile.dailyTakeProfitPct * 100).toFixed(0)),
                                    })}
                                </div>
                            </div>

                            <div className='risk-calc__calc-body'>
                                <div className='risk-calc__calc-input-row'>
                                    <label className='risk-calc__calc-field'>
                                        <span>{localize('Balance for planning')}</span>
                                        <input
                                            type='number'
                                            min={MIN_STAKE_USD}
                                            step='0.01'
                                            className='risk-calc__input risk-calc__input--calc'
                                            value={useManualBalance ? manualBalance : balance.toFixed(2)}
                                            readOnly={!useManualBalance}
                                            onChange={e => {
                                                setUseManualBalance(true);
                                                setManualBalance(e.target.value);
                                            }}
                                        />
                                    </label>
                                    <label className='risk-calc__calc-toggle'>
                                        <input
                                            type='checkbox'
                                            checked={useManualBalance}
                                            onChange={e => {
                                                const checked = e.target.checked;
                                                setUseManualBalance(checked);
                                                if (checked) {
                                                    setManualBalance(String(balance));
                                                } else {
                                                    setManualBalance('');
                                                }
                                            }}
                                        />
                                        {localize('Custom amount')}
                                    </label>
                                </div>

                                <div className='risk-calc__calc-levels'>
                                    <span className='risk-calc__calc-levels-label'>{localize('Trading level')}</span>
                                    <div className='risk-calc__level-tabs' role='tablist'>
                                        {(['beginner', 'intermediate', 'expert'] as TTradingLevel[]).map(l => {
                                            const levelProfile = RISK_PROFILES[l];
                                            const levelLabel =
                                                l === 'beginner'
                                                    ? localize('Beginner')
                                                    : l === 'intermediate'
                                                      ? localize('Intermediate')
                                                      : localize('Expert');
                                            const levelHint = localize(
                                                '{{risk}}% risk · {{stop}}% stop · ×{{mult}}',
                                                {
                                                    risk: (levelProfile.riskPerTradePct * 100).toFixed(1),
                                                    stop: (levelProfile.dailyStopLossPct * 100).toFixed(0),
                                                    mult: levelProfile.martingaleMultiplier.toFixed(2),
                                                }
                                            );
                                            const isActive = level === l;
                                            return (
                                                <button
                                                    key={l}
                                                    type='button'
                                                    role='tab'
                                                    aria-selected={isActive}
                                                    className={classNames(
                                                        'risk-calc__level-btn',
                                                        `risk-calc__level-btn--${l}`,
                                                        { 'risk-calc__level-btn--active': isActive }
                                                    )}
                                                    onClick={() => setLevel(l)}
                                                >
                                                    <span className='risk-calc__level-btn-label'>{levelLabel}</span>
                                                    <span className='risk-calc__level-btn-hint'>{levelHint}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className='risk-calc__calc-results' aria-live='polite'>
                                    <div className='risk-calc__calc-key'>
                                        <span>{localize('Stake')}</span>
                                        <strong>${riskPlan.stake.toFixed(2)}</strong>
                                        <small>{localize('Min $0.35')}</small>
                                    </div>
                                    <div className='risk-calc__calc-key risk-calc__calc-key--mult'>
                                        <span>{localize('Martingale')}</span>
                                        <strong className='risk-calc__calc-mult-value'>
                                            <span className='risk-calc__calc-mult-prefix'>×</span>
                                            <input
                                                type='number'
                                                min={1.01}
                                                max={10}
                                                step={0.05}
                                                className='risk-calc__input risk-calc__input--mult'
                                                value={martingaleMult}
                                                onChange={e => setMartingaleMult(e.target.value)}
                                                aria-label={localize('Martingale multiplier')}
                                            />
                                        </strong>
                                        <small>
                                            {localize('${{stake}} next · {{n}} steps · ${{exp}} max', {
                                                stake: riskPlan.martingaleStake.toFixed(2),
                                                n: String(riskPlan.maxMartingaleSteps),
                                                exp: riskPlan.martingaleExposure.toFixed(2),
                                            })}
                                        </small>
                                    </div>
                                    <div className='risk-calc__calc-key risk-calc__calc-key--loss'>
                                        <span>{localize('Stop loss')}</span>
                                        <strong>${riskPlan.stopLoss.toFixed(2)}</strong>
                                        <small>{localize('Daily limit')}</small>
                                    </div>
                                    <div className='risk-calc__calc-key risk-calc__calc-key--profit'>
                                        <span>{localize('Take profit')}</span>
                                        <strong>${riskPlan.takeProfit.toFixed(2)}</strong>
                                        <small>{localize('Daily target')}</small>
                                    </div>
                                </div>

                                <button
                                    type='button'
                                    className='risk-calc__btn risk-calc__btn--growth-link'
                                    onClick={() => {
                                        applyRecommendedSessionReturn();
                                        setActiveView('growth');
                                    }}
                                >
                                    {localize('Plan growth challenge with these settings →')}
                                </button>
                            </div>
                        </div>

                        <section className='risk-calc__section risk-calc__section--suggestions'>
                            <h2 className='risk-calc__suggestions-heading'>{localize('Suggested contracts')}</h2>
                            <div className='risk-calc__suggestions-scroll'>
                                <nav className='risk-calc__suggestions-nav' aria-label={localize('Suggested contracts')}>
                                    {suggestions.map(item => {
                                        const riskLabel =
                                            item.risk === 'low'
                                                ? localize('Lower risk')
                                                : item.risk === 'medium'
                                                  ? localize('Medium risk')
                                                  : localize('Higher risk');
                                        return (
                                            <div key={item.title} className='risk-calc__suggestion-item'>
                                                <button
                                                    type='button'
                                                    className='risk-calc__suggestion-select'
                                                    onClick={() => goToTab(item.tabIndex)}
                                                >
                                                    <span className='risk-calc__suggestion-icon' aria-hidden>
                                                        {SUGGESTION_ICONS[item.risk]}
                                                    </span>
                                                    <span className='risk-calc__suggestion-text'>
                                                        <span className='risk-calc__suggestion-title'>{item.title}</span>
                                                        <span className='risk-calc__suggestion-hint'>
                                                            {riskLabel} · {item.contracts}
                                                        </span>
                                                        {item.notes ? (
                                                            <span className='risk-calc__suggestion-notes'>{item.notes}</span>
                                                        ) : null}
                                                    </span>
                                                </button>
                                                <button
                                                    type='button'
                                                    className='risk-calc__suggestion-open'
                                                    title={localize('Open {{tab}}', { tab: item.tabLabel })}
                                                    onClick={() => goToTab(item.tabIndex)}
                                                >
                                                    →
                                                </button>
                                            </div>
                                        );
                                    })}
                                </nav>
                            </div>
                        </section>
                        </div>
                    </div>
                ) : (
                    <div className='risk-calc__view risk-calc__view--growth'>
                        <p className='risk-calc__growth-intro'>
                            {localize('Starting capital')}: <strong>${balance.toFixed(2)}</strong>
                            {useManualBalance ? (
                                <button
                                    type='button'
                                    className='risk-calc__link-btn'
                                    onClick={() => setActiveView('risk')}
                                >
                                    {localize('Change in calculator')}
                                </button>
                            ) : null}
                        </p>

                        <section className='risk-calc__section risk-calc__section--challenge-setup'>
                            <div className='risk-calc__setup-panel'>
                                <div className='risk-calc__form-grid'>
                                    <label>
                                        {localize('Sessions per day')}
                                        <input
                                            type='number'
                                            min={1}
                                            max={12}
                                            className='risk-calc__input'
                                            value={sessionsPerDay}
                                            onChange={e => setSessionsPerDay(e.target.value)}
                                        />
                                    </label>
                                    <label>
                                        {localize('Days')}
                                        <input
                                            type='number'
                                            min={1}
                                            max={90}
                                            className='risk-calc__input'
                                            value={challengeDays}
                                            onChange={e => setChallengeDays(e.target.value)}
                                        />
                                    </label>
                                    <label>
                                        {localize('Withdraw % of daily profit')}
                                        <input
                                            type='number'
                                            min={0}
                                            max={100}
                                            className='risk-calc__input'
                                            value={withdrawalPct}
                                            onChange={e => setWithdrawalPct(e.target.value)}
                                        />
                                    </label>
                                    <label>
                                        {localize('Retain % of daily profit')}
                                        <input
                                            type='number'
                                            min={0}
                                            max={100}
                                            className='risk-calc__input'
                                            value={reinvestPct}
                                            onChange={e => setReinvestPct(e.target.value)}
                                        />
                                    </label>
                                    <div className='risk-calc__form-actions'>
                                        <button
                                            type='button'
                                            className='risk-calc__btn risk-calc__btn--secondary'
                                            onClick={applyRecommendedSessionReturn}
                                        >
                                            {localize('Match stake % from calculator')}
                                        </button>
                                    </div>
                                </div>

                                <div className='risk-calc__session-inputs'>
                                    <div className='risk-calc__session-inputs-head'>
                                        <span>{localize('Session return (% of capital)')}</span>
                                        <label className='risk-calc__session-apply-all'>
                                            {localize('Apply all')}
                                            <input
                                                type='number'
                                                min={0.1}
                                                max={100}
                                                step='0.1'
                                                className='risk-calc__input risk-calc__input--compact'
                                                placeholder='10'
                                                onBlur={e => {
                                                    if (e.target.value) applyAllSessionsReturn(e.target.value);
                                                }}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') {
                                                        applyAllSessionsReturn(
                                                            (e.target as HTMLInputElement).value || '10'
                                                        );
                                                    }
                                                }}
                                            />
                                        </label>
                                    </div>
                                    <div className='risk-calc__session-inputs-grid'>
                                        {sessionReturnPcts.slice(0, sessionCount).map((val, i) => (
                                            <label key={i} className='risk-calc__session-input-cell'>
                                                {localize('Session {{n}}', { n: String(i + 1) })}
                                                <input
                                                    type='number'
                                                    min={0.1}
                                                    max={100}
                                                    step='0.1'
                                                    className='risk-calc__input'
                                                    value={val}
                                                    onChange={e => updateSessionReturnPct(i, e.target.value)}
                                                />
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div className='risk-calc__summary-bar'>
                                    <div>
                                        <span>{localize('Start capital')}</span>
                                        <strong>${growth.startingBalance.toFixed(2)}</strong>
                                    </div>
                                    <div>
                                        <span>{localize('End capital')}</span>
                                        <strong>${growth.endingCapital.toFixed(2)}</strong>
                                    </div>
                                    <div>
                                        <span>{localize('Total profit')}</span>
                                        <strong className='risk-calc__pos'>+${growth.totalProfit.toFixed(2)}</strong>
                                    </div>
                                    <div>
                                        <span>{localize('Total withdrawn')}</span>
                                        <strong className='risk-calc__withdraw-total'>
                                            ${growth.totalWithdrawn.toFixed(2)}
                                        </strong>
                                    </div>
                                    <div>
                                        <span>{localize('Total retained')}</span>
                                        <strong className='risk-calc__retain-total'>
                                            ${growth.totalReinvested.toFixed(2)}
                                        </strong>
                                    </div>
                                </div>
                            </div>

                            <div className='risk-calc__challenge-wrap'>
                                <table className='risk-calc__challenge-table'>
                                    <thead>
                                        <tr>
                                            <th className='risk-calc__ch-th risk-calc__ch-th--day' aria-label={localize('Day')}>
                                                📆
                                            </th>
                                            <th className='risk-calc__ch-th'>{localize('Capital')}</th>
                                            {Array.from({ length: growth.sessionsPerDay }, (_, i) => (
                                                <th key={i} className='risk-calc__ch-th'>
                                                    {localize('Session {{n}}', { n: String(i + 1) })}
                                                </th>
                                            ))}
                                            <th className='risk-calc__ch-th'>{localize('Profit')}</th>
                                            <th className='risk-calc__ch-th risk-calc__ch-th--retain'>
                                                {localize('Retain')}
                                            </th>
                                            <th className='risk-calc__ch-th risk-calc__ch-th--withdraw'>
                                                {localize('Withdraw')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {growth.days.map((day, idx) => (
                                            <tr
                                                key={day.day}
                                                className={classNames('risk-calc__ch-row', {
                                                    'risk-calc__ch-row--alt': idx % 2 === 1,
                                                })}
                                            >
                                                <td className='risk-calc__ch-day'>
                                                    {localize('Day {{n}}', { n: String(day.day) })}
                                                </td>
                                                <td className='risk-calc__ch-capital'>${day.capital.toFixed(2)}</td>
                                                {day.sessionProfits.map((sp, i) => (
                                                    <td key={i} className='risk-calc__ch-session'>
                                                        +${sp.toFixed(2)}
                                                    </td>
                                                ))}
                                                <td className='risk-calc__ch-profit'>+${day.profit.toFixed(2)}</td>
                                                <td className='risk-calc__ch-retain'>{day.reinvest.toFixed(2)}</td>
                                                <td className='risk-calc__ch-withdraw'>${day.withdraw.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    </div>
                )}
            </div>
        </div>
    );
});

export default RiskCalculator;
