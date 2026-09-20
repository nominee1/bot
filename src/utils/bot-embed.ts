export const DERIV1_BOT_HOME_MSG = 'deriv1-bot-home';

export function isBotSubpath(): boolean {
    try {
        return window.location.pathname === '/bot' || window.location.pathname.startsWith('/bot/');
    } catch {
        return false;
    }
}

export function isBotEmbed(): boolean {
    try {
        if (typeof window === 'undefined') return false;
        if (new URLSearchParams(window.location.search).get('embed') === '1') return true;
        return window.self !== window.top;
    } catch {
        return true;
    }
}

export function getBotRouterBasename(): string | undefined {
    if (typeof window === 'undefined') return undefined;
    return isBotSubpath() ? '/bot' : undefined;
}

export function requestDeriv1Home(): void {
    if (isBotEmbed()) {
        try {
            window.parent.postMessage({ type: DERIV1_BOT_HOME_MSG, source: 'bot-1' }, '*');
            return;
        } catch {
            /* fall through */
        }
    }
    window.location.assign('/');
}

const LIVE_TAB_HASHES = ['dashboard', 'bot_builder', 'chart', 'tutorial'] as const;

/** Omnibox path matching live DBot: bot.deriv.com/#bot_builder (hash tab first, no embed/session). */
export function getLiveDbotDisplayRoute(pathname: string, _search: string, hash: string): string {
    const path = (pathname || '/').replace(/^\/bot(?=\/|$)/, '') || '/';
    if (path === '/endpoint' || path.startsWith('/endpoint/')) return '/endpoint';
    if (path === '/callback' || path.startsWith('/callback/')) return '/callback';

    const raw = (hash || '').replace(/^#/, '').split('&')[0].split('?')[0];
    const tab = LIVE_TAB_HASHES.includes(raw as (typeof LIVE_TAB_HASHES)[number]) ? raw : 'bot_builder';
    return `/#${tab}`;
}
