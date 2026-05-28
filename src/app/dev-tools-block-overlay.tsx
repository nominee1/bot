import React from 'react';

import { useDevice } from '@deriv-com/ui';

import './dev-tools-block-overlay.scss';

/** Session flag when user opens app with ?denara_allow_devtools=1 (team / emergency only). */
const BYPASS_SESSION_KEY = 'denara_devtools_overlay_bypass';
const BYPASS_QUERY = 'denara_allow_devtools';

const DETECT_THRESHOLD_PX = 140;

function isDevelopmentBuild(): boolean {
    return typeof process !== 'undefined' && process.env.NODE_ENV === 'development';
}

function applyBypassFromUrlOrSession(): boolean {
    try {
        const u = new URL(window.location.href);
        if (u.searchParams.get(BYPASS_QUERY) === '1') {
            sessionStorage.setItem(BYPASS_SESSION_KEY, '1');
            u.searchParams.delete(BYPASS_QUERY);
            const q = u.searchParams.toString();
            window.history.replaceState({}, '', `${u.pathname}${q ? `?${q}` : ''}${u.hash}`);
            return true;
        }
    } catch {
        /* noop */
    }
    try {
        return sessionStorage.getItem(BYPASS_SESSION_KEY) === '1';
    } catch {
        return false;
    }
}

function detectDevToolsLikelyOpen(): boolean {
    const w = window.outerWidth - window.innerWidth;
    const h = window.outerHeight - window.innerHeight;
    return w > DETECT_THRESHOLD_PX || h > DETECT_THRESHOLD_PX;
}

function isDevToolsShortcut(e: KeyboardEvent): boolean {
    if (e.key === 'F12') return true;

    const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;

    // Windows / Linux: Ctrl+Shift+I/J/C/K (inspect, console, picker, Firefox toolbox)
    if (e.ctrlKey && e.shiftKey && ['I', 'J', 'C', 'K'].includes(k)) return true;

    // View source
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'u') return true;

    // macOS: Cmd+Opt+I / J / C
    if (e.metaKey && e.altKey && ['I', 'J', 'C'].includes(k)) return true;

    return false;
}

/**
 * Production-only full-screen notice when browser developer tools appear to be open (desktop viewports only).
 * Heuristic (viewport chrome gap) — not cryptographically secure; intended as a discouragement layer.
 * Team bypass: load once with <code>?denara_allow_devtools=1</code> (stores session flag).
 */
export default function DevToolsBlockOverlay() {
    const { isDesktop } = useDevice();
    const bypassRef = React.useRef(false);
    const [blocked, setBlocked] = React.useState(false);

    React.useLayoutEffect(() => {
        bypassRef.current = applyBypassFromUrlOrSession();
    }, []);

    React.useEffect(() => {
        if (!isDesktop) return;
        if (isDevelopmentBuild()) return;
        if (bypassRef.current) return;

        const tick = () => {
            setBlocked(detectDevToolsLikelyOpen());
        };

        const id = window.setInterval(tick, 380);
        window.addEventListener('resize', tick);
        document.addEventListener('visibilitychange', tick);

        tick();

        return () => {
            window.clearInterval(id);
            window.removeEventListener('resize', tick);
            document.removeEventListener('visibilitychange', tick);
        };
    }, [isDesktop]);

    /** Discourage common DevTools entry points (cannot truly lock the browser). */
    React.useEffect(() => {
        if (!isDesktop) return;
        if (isDevelopmentBuild()) return;
        if (applyBypassFromUrlOrSession()) return;

        const onContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (!isDevToolsShortcut(e)) return;
            e.preventDefault();
            e.stopPropagation();
        };

        document.addEventListener('contextmenu', onContextMenu, true);
        window.addEventListener('keydown', onKeyDown, true);

        return () => {
            document.removeEventListener('contextmenu', onContextMenu, true);
            window.removeEventListener('keydown', onKeyDown, true);
        };
    }, [isDesktop]);

    if (!isDesktop) return null;
    if (isDevelopmentBuild()) return null;
    if (bypassRef.current) return null;
    if (!blocked) return null;

    return (
        <div
            className='devtools-block'
            role='alertdialog'
            aria-modal='true'
            aria-labelledby='devtools-block-title'
        >
            <div className='devtools-block__panel'>
                <div className='devtools-block__badge'>
                    <span className='devtools-block__badge-dot' aria-hidden />
                    Session notice
                </div>
                <h1 id='devtools-block-title' className='devtools-block__title'>
                    Developer tools are not available here
                </h1>
                <p className='devtools-block__lead'>
                    For security and to protect our traders&apos; experience, using browser developer tools with this
                    application is not permitted. If you need technical details or integration help, please reach out to
                    the Denara team instead of inspecting the client.
                </p>
                <p className='devtools-block__contact'>
                    <strong>Need access or documentation?</strong> Contact Denara developers through your usual support
                    channel or account representative for official information and tooling.
                </p>
                <p className='devtools-block__section-title'>About Denara tools</p>
                <ul className='devtools-block__list'>
                    <li>
                        Trading and automation workflows built around Deriv, with a focus on clarity and controlled risk.
                    </li>
                    <li>
                        Competition and copy-trading features designed for transparent leaderboards and fair payouts.
                    </li>
                    <li>
                        Official updates and product surfaces are published on Denara&apos;s sites — not inside the
                        browser inspector.
                    </li>
                </ul>
                <div className='devtools-block__links'>
                    <a className='devtools-block__link' href='https://www.denarapro.com' target='_blank' rel='noreferrer'>
                        Denara Pro
                    </a>
                    <a
                        className='devtools-block__link'
                        href='https://site.denaratool.com'
                        target='_blank'
                        rel='noreferrer'
                    >
                        Denara Tool
                    </a>
                    <a className='devtools-block__link' href='https://denaratool.com/reports' target='_blank' rel='noreferrer'>
                        Reports
                    </a>
                </div>
                <p className='devtools-block__footnote'>
                    Close the developer tools panel — this screen will hide automatically when the docked panel no longer
                    reduces the page viewport. Denara engineers: for this session only, load once with{' '}
                    <code>?denara_allow_devtools=1</code> in the URL (restores context menu and shortcuts for this tab until
                    you clear site data).
                </p>
            </div>
        </div>
    );
}
