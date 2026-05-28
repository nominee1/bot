import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { NavScrollGlassArrows } from '@/components/NavScrollGlassArrows';
import { QUICK_ACCESS_EVENTS, QUICK_ACCESS_SESSION } from '@/constants/quick-access-session';
import { run_panel as RUN_PANEL_TAB } from '@/constants/run-panel';
import { useScrollClipGlassNav } from '@/hooks/useScrollClipGlassNav';
import { useStore } from '@/hooks/useStore';
import AccountKeyedIframeEvenOdd from '../aabrickk/AccountKeyedIframeEvenOdd';
import BrickTower from '../abrick/BrickTower';
import ReloadAuto from '../autotradeR/ReloadAuto';
import ViewStrategy from '../aaac/ViewStrategy';
import './ViewPercentage.scss';

type ViewType = 'viewstrategy' | 'evenodd' | 'reloadauto' | 'bricktower';

const VIEW_OPTIONS: { id: ViewType; title: string; hint: string }[] = [
    { id: 'reloadauto', title: 'Auto Bot', hint: 'Reload auto workflow' },
    { id: 'bricktower', title: 'Over Under', hint: 'Over | Under Signals' },
    { id: 'viewstrategy', title: 'Speed Bot', hint: 'Speed, switchers & same-stake recovery' },
    { id: 'evenodd', title: 'Even Odd', hint: 'Even Odd Signals' },
];

function readQuickAccessSmartTraderView(): ViewType {
    try {
        const raw = sessionStorage.getItem(QUICK_ACCESS_SESSION.smartTraderView);
        if (
            raw === 'viewstrategy' ||
            raw === 'evenodd' ||
            raw === 'reloadauto' ||
            raw === 'bricktower'
        ) {
            sessionStorage.removeItem(QUICK_ACCESS_SESSION.smartTraderView);
            return raw;
        }
    } catch {
        /* ignore */
    }
    return 'reloadauto';
}

const ViewPercentage = observer(() => {
    const [activeView, setActiveView] = useState<ViewType>(readQuickAccessSmartTraderView);
    const { navRef, edges, scrollNav } = useScrollClipGlassNav(activeView);
    const { ready_strategy_panel, run_panel } = useStore();

    useEffect(() => {
        ready_strategy_panel.attach();
        run_panel.setActiveTabIndex(RUN_PANEL_TAB.SUMMARY);
        return () => ready_strategy_panel.detach();
    }, [ready_strategy_panel, run_panel]);

    useEffect(() => {
        const onQuickAccess = (e: Event) => {
            const v = (e as CustomEvent<{ view: ViewType }>).detail?.view;
            if (
                v === 'viewstrategy' ||
                v === 'evenodd' ||
                v === 'reloadauto' ||
                v === 'bricktower'
            ) {
                setActiveView(v);
            }
        };
        window.addEventListener(QUICK_ACCESS_EVENTS.smartTraderView, onQuickAccess as EventListener);
        return () =>
            window.removeEventListener(QUICK_ACCESS_EVENTS.smartTraderView, onQuickAccess as EventListener);
    }, []);

    return (
        <div className="smart-trader-app">
            <header className="stp-page-header">
                <div className="stp-page-header__title">
                    <span className="stp-page-header__emoji" aria-hidden>
                        🧠
                    </span>
                    <div>
                        <h1 className="stp-page-header__heading">Smart Trader</h1>
                        <p className="stp-page-header__sub">
                         Smart Trader is attached.
                        </p>
                    </div>
                </div>
            </header>

            <div className="stp-shell">
                <div className="stp-nav-wrap">
                    <h2 className="stp-rail-heading">Workspaces</h2>
                    <div className="stp-nav-scroll-clip">
                        <nav ref={navRef} className="stp-strategy-nav" aria-label="Smart Trader workspaces">
                            {VIEW_OPTIONS.map(opt => (
                                <button
                                    key={opt.id}
                                    type="button"
                                    aria-current={activeView === opt.id ? 'true' : undefined}
                                    className={`stp-nav__item ${activeView === opt.id ? 'stp-nav__item--selected' : ''}`}
                                    onClick={() => setActiveView(opt.id)}
                                >
                                    <span className="stp-nav__text">
                                        <span className="stp-nav__title">{opt.title}</span>
                                        <span className="stp-nav__hint">{opt.hint}</span>
                                    </span>
                                </button>
                            ))}
                        </nav>
                        <NavScrollGlassArrows
                            edges={edges}
                            scrollNav={scrollNav}
                            ariaPrev="Scroll workspaces left"
                            ariaNext="Scroll workspaces right"
                        />
                    </div>
                </div>

                <section className="stp-detail" aria-live="polite">
                    <div className="stp-detail-card">
                        <div className="stp-detail-card__body">
                            {activeView === 'viewstrategy' && <ViewStrategy />}
                            {activeView === 'evenodd' && <AccountKeyedIframeEvenOdd />}
                            {activeView === 'reloadauto' && <ReloadAuto />}
                            {activeView === 'bricktower' && <BrickTower />}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
});

export default ViewPercentage;
