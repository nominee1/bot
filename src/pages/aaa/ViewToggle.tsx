import { useEffect, useState } from 'react';
import { NavScrollGlassArrows } from '@/components/NavScrollGlassArrows';
import { QUICK_ACCESS_EVENTS, QUICK_ACCESS_SESSION } from '@/constants/quick-access-session';
import { useScrollClipGlassNav } from '@/hooks/useScrollClipGlassNav';
import BotIframe from '../accumulators/BotIframe';
import Multiple from '../aaaStrategies/MultiplePredictions/multiple';
import Iframe from '../accumtwo/Iframe';
import Flipa from '../aaflipaa/flipaa';
import './ViewToggle.scss';

type ViewType = 'botiframe' | 'multiple' | 'iframe' | 'flipa';

const VIEW_OPTIONS: { id: ViewType; title: string; hint: string }[] = [
    { id: 'botiframe', title: 'Instant Fill', hint: 'Fast ticket-style fills and bot workspace' },
    { id: 'flipa', title: 'Flipa Switcher', hint: 'Flip workspace and switchers' },
    { id: 'multiple', title: 'Multiple Stakes', hint: 'Stack predictions across stakes' },
    { id: 'iframe', title: 'Instant Matches', hint: 'Iframe instant matches flow' },
];

function readQuickAccessViewToggle(): ViewType {
    try {
        const raw = sessionStorage.getItem(QUICK_ACCESS_SESSION.viewToggle);
        if (raw === 'botiframe' || raw === 'multiple' || raw === 'iframe' || raw === 'flipa') {
            sessionStorage.removeItem(QUICK_ACCESS_SESSION.viewToggle);
            return raw;
        }
    } catch {
        /* ignore */
    }
    return 'botiframe';
}

const ViewToggle = () => {
    const [activeView, setActiveView] = useState<ViewType>(readQuickAccessViewToggle);
    const { navRef, edges, scrollNav } = useScrollClipGlassNav(activeView);

    useEffect(() => {
        const onQuickAccess = (e: Event) => {
            const v = (e as CustomEvent<{ view: ViewType }>).detail?.view;
            if (v === 'botiframe' || v === 'multiple' || v === 'iframe' || v === 'flipa') {
                setActiveView(v);
            }
        };
        window.addEventListener(QUICK_ACCESS_EVENTS.viewToggle, onQuickAccess as EventListener);
        return () => window.removeEventListener(QUICK_ACCESS_EVENTS.viewToggle, onQuickAccess as EventListener);
    }, []);

    return (
        <div className="instant-fill-app">
            <header className="stp-page-header">
                <div className="stp-page-header__title">
                    <span className="stp-page-header__emoji" aria-hidden>
                        ⏱️
                    </span>
                    <div>
                        <h1 className="stp-page-header__heading">Instant Fill</h1>
                        <p className="stp-page-header__sub">
                            Powerful Denara Binary Free Softwares
                        </p>
                    </div>
                </div>
            </header>

            <div className="stp-shell">
                <div className="stp-nav-wrap">
                    <h2 className="stp-rail-heading">Workspaces</h2>
                    <div className="stp-nav-scroll-clip">
                        <nav ref={navRef} className="stp-strategy-nav" aria-label="Instant Fill workspaces">
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
                            {activeView === 'botiframe' && <BotIframe />}
                            {activeView === 'multiple' && <Multiple />}
                            {activeView === 'flipa' && <Flipa />}
                            {activeView === 'iframe' && <Iframe />}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default ViewToggle;
