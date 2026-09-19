import { ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { standalone_routes } from '@/components/shared';
import { useChromeCollapse } from '@/hooks/use-chrome-collapse';
import { usePwaInstall } from '@/hooks/use-pwa-install';

const DISPLAY_HOST = 'bot.deriv.com';
const BAR_POS_KEY = 'chrome-url-bar-position';

type BarPosition = 'top' | 'bottom';

const readBarPosition = (): BarPosition => {
    try {
        return window.localStorage.getItem(BAR_POS_KEY) === 'bottom' ? 'bottom' : 'top';
    } catch {
        return 'top';
    }
};

const THEME_COLOR = '#ffffff';

const applyThemeColor = () => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR);
    document.documentElement.style.backgroundColor = THEME_COLOR;
    document.body.style.backgroundColor = THEME_COLOR;
};

const applyBarPosition = (position: BarPosition) => {
    document.documentElement.dataset.chromeBar = position;
    try {
        window.localStorage.setItem(BAR_POS_KEY, position);
    } catch {
        /* ignore */
    }
};

const AddressText = ({
    host,
    route,
    title,
    className,
    hostClass,
    routeClass,
}: {
    host: string;
    route: string;
    title: string;
    className: string;
    hostClass: string;
    routeClass: string;
}) => (
    <p className={className} title={title}>
        <span>
            {host ? <span className={hostClass}>{host}</span> : null}
            <span className={routeClass}>{route || '/'}</span>
        </span>
    </p>
);

const SiteInfoIcon = ({ className }: { className?: string }) => (
    <svg
        xmlns='http://www.w3.org/2000/svg'
        viewBox='0 0 960 960'
        width='20'
        height='20'
        className={className}
        aria-hidden
    >
        <path
            fill='currentColor'
            d='M696,780q-60.5,0 -102.2,-41.8T552,636q0,-60.5 41.8,-102.2T696,492q60.5,0 102.2,41.8T840,636q0,60.5 -41.8,102.2T696,780ZM696.1,708Q726,708 747,686.9q21,-21.1 21,-51T746.9,585q-21.1,-21 -51,-21T645,585.1q-21,21.1 -21,51T645.1,687q21.1,21 51,21ZM144,672v-72h336v72L144,672ZM264,468q-60.5,0 -102.2,-41.8T120,324q0,-60.5 41.8,-102.2T264,180q60.5,0 102.2,41.8T408,324q0,60.5 -41.8,102.2T264,468ZM264.1,396Q294,396 315,374.9q21,-21.1 21,-51T314.9,273q-21.1,-21 -51,-21T213,273.1q-21,21.1 -21,51T213.1,375q21.1,21 51,21ZM480,360v-72h336v72L480,360ZM696,636ZM264,324Z'
        />
    </svg>
);

const IconBtn = ({
    label,
    className,
    onClick,
    children,
}: {
    label: string;
    className?: string;
    onClick?: () => void;
    children: ReactNode;
}) => (
    <button type='button' aria-label={label} onClick={onClick} className={className}>
        {children}
    </button>
);

const ChromeUrlBars = () => {
    const location = useLocation();
    const [starred, setStarred] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [barPosition, setBarPosition] = useState<BarPosition>('top');
    const { showInstall, install } = usePwaInstall();
    useChromeCollapse(`${location.pathname}${location.search}${location.hash}:${barPosition}`);

    const host = DISPLAY_HOST;
    const route = `${location.pathname}${location.search}${location.hash}`;
    const href = `https://${host}${route}`;

    useEffect(() => {
        const next = readBarPosition();
        setBarPosition(next);
        applyBarPosition(next);
        applyThemeColor();
    }, []);

    useEffect(() => {
        applyThemeColor();
    }, [location.pathname, location.search, location.hash]);

    const setPosition = (next: BarPosition) => {
        setBarPosition(next);
        applyBarPosition(next);
        setMenuOpen(false);
    };

    return (
        <>
            <div className='chrome-url-bars'>
                <IconBtn
                    label='Back'
                    className='chrome-url-bars__btn'
                    onClick={() => {
                        history.back();
                    }}
                >
                    <svg viewBox='0 0 24 24' width='20' height='20' fill='currentColor' aria-hidden>
                        <path d='M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z' />
                    </svg>
                </IconBtn>
                <IconBtn
                    label='Forward'
                    className='chrome-url-bars__btn chrome-url-bars__btn--muted'
                    onClick={() => {
                        history.forward();
                    }}
                >
                    <svg viewBox='0 0 24 24' width='20' height='20' fill='currentColor' aria-hidden>
                        <path d='M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z' />
                    </svg>
                </IconBtn>
                <IconBtn
                    label='Reload'
                    className='chrome-url-bars__btn'
                    onClick={() => {
                        window.location.reload();
                    }}
                >
                    <svg viewBox='0 0 24 24' width='18' height='18' fill='currentColor' aria-hidden>
                        <path d='M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-1.76-4.24L13 11h7V4z' />
                    </svg>
                </IconBtn>

                <div className='chrome-url-bars__omnibox' aria-label='Address bar'>
                    <span className='chrome-url-bars__info' title='Site information'>
                        <SiteInfoIcon />
                    </span>
                    <AddressText
                        host={host}
                        route={route}
                        title={href}
                        className='chrome-url-bars__text'
                        hostClass='chrome-url-bars__host'
                        routeClass='chrome-url-bars__route'
                    />
                </div>

                <IconBtn label='Search' className='chrome-url-bars__btn'>
                    <svg viewBox='0 0 24 24' width='18' height='18' fill='currentColor' aria-hidden>
                        <path d='M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14' />
                    </svg>
                </IconBtn>
                <IconBtn label='Bookmark' className='chrome-url-bars__btn' onClick={() => setStarred(v => !v)}>
                    <svg
                        viewBox='0 0 24 24'
                        width='18'
                        height='18'
                        fill={starred ? '#fbbc04' : 'currentColor'}
                        aria-hidden
                    >
                        <path d='m12 17.27 6.18 3.73-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z' />
                    </svg>
                </IconBtn>
                <IconBtn label='Share' className='chrome-url-bars__btn'>
                    <svg viewBox='0 0 24 24' width='18' height='18' fill='currentColor' aria-hidden>
                        <path d='M16 5l-1.42 1.42-1.59-1.59V16h-1.98V4.83L9.42 6.42 8 5l4-4 4 4zm4 5v11c0 1.1-.9 2-2 2H6c-1.11 0-2-.9-2-2V10c0-1.11.89-2 2-2h3v2H6v11h12V10h-3V8h3c1.1 0 2 .89 2 2z' />
                    </svg>
                </IconBtn>
                <div className='chrome-url-bars__avatar' aria-hidden>
                    n
                </div>
            </div>

            {menuOpen ? (
                <button
                    type='button'
                    className='chrome-url-scrim'
                    aria-label='Close menu'
                    onClick={() => setMenuOpen(false)}
                />
            ) : null}

            <div className='chrome-url-bars-mobile'>
                <IconBtn
                    label='Home'
                    className='chrome-url-bars-mobile__btn'
                    onClick={() => window.location.assign(standalone_routes.home)}
                >
                    <svg
                        viewBox='0 0 24 24'
                        width='22'
                        height='22'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='1.7'
                        aria-hidden
                    >
                        <path d='M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' />
                    </svg>
                </IconBtn>

                <div className='chrome-url-bars-mobile__omnibox' aria-label='Address bar'>
                    <span className='chrome-url-bars-mobile__info' title='Site information'>
                        <SiteInfoIcon className='h-5 w-5' />
                    </span>
                    <AddressText
                        host={host}
                        route={route}
                        title={href}
                        className='chrome-url-bars-mobile__text'
                        hostClass='chrome-url-bars-mobile__host'
                        routeClass='chrome-url-bars-mobile__route'
                    />
                </div>

                <IconBtn
                    label='Bookmark'
                    className='chrome-url-bars-mobile__btn chrome-url-bars-mobile__btn--narrow'
                    onClick={() => setStarred(v => !v)}
                >
                    <svg
                        viewBox='0 0 24 24'
                        width='22'
                        height='22'
                        fill={starred ? '#fbbc04' : 'none'}
                        stroke='currentColor'
                        strokeWidth='1.6'
                        aria-hidden
                    >
                        <path d='m12 17.27 6.18 3.73-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z' />
                    </svg>
                </IconBtn>
                <div className='chrome-url-bars-mobile__tabs' aria-label='Tabs'>
                    <span className='chrome-url-bars-mobile__tab-count'>1</span>
                </div>
                <IconBtn
                    label='Menu'
                    className='chrome-url-bars-mobile__btn chrome-url-bars-mobile__btn--menu'
                    onClick={() => setMenuOpen(open => !open)}
                >
                    <svg viewBox='0 0 24 24' width='20' height='20' fill='currentColor' aria-hidden>
                        <circle cx='12' cy='5' r='1.7' />
                        <circle cx='12' cy='12' r='1.7' />
                        <circle cx='12' cy='19' r='1.7' />
                    </svg>
                </IconBtn>

                {menuOpen ? (
                    <div className='chrome-url-menu' role='menu'>
                        {showInstall ? (
                            <>
                                <button
                                    type='button'
                                    role='menuitem'
                                    className='chrome-url-menu__item'
                                    onClick={async () => {
                                        const ok = await install();
                                        if (ok) setMenuOpen(false);
                                    }}
                                >
                                    <span>Install app</span>
                                </button>
                                <div className='chrome-url-menu__sep' />
                            </>
                        ) : null}
                        {(['top', 'bottom'] as const).map(option => (
                            <button
                                key={option}
                                type='button'
                                role='menuitem'
                                className='chrome-url-menu__item'
                                onClick={() => setPosition(option)}
                            >
                                <span>Address bar at {option}</span>
                                {barPosition === option ? <span className='chrome-url-menu__check'>✓</span> : null}
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>
        </>
    );
};

export default ChromeUrlBars;
