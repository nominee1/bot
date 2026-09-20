export const DERIV1_BOT_SESSION_MSG = 'deriv1-bot-session';
export const DERIV1_BOT_BALANCE_MSG = 'deriv1-virtual-balance';
export const DERIV1_BOT_SESSION_ACK = 'deriv1-bot-session-ack';
export const DERIV1_HANDOFF_LOGINID_KEY = 'deriv1_virtual_shadow_loginid';

export type Deriv1BotSessionPayload = {
    v: 1;
    loginid: string;
    email?: string;
    currency: string;
    virtualBalance: number;
    oauthToken?: string;
    furyToken?: string;
};

function readBuildEnv(key: string): string {
    const value = typeof process.env[key] === 'string' ? process.env[key].trim() : '';
    return value;
}

export function getDeriv1AppOrigins(): string[] {
    const extra = readBuildEnv('DERIV1_APP_ORIGIN') || readBuildEnv('NEXT_PUBLIC_DERIV1_ORIGIN');
    const list = [
        extra,
        'https://deriv-1-beta.vercel.app',
        'https://deriv-1.vercel.app',
        'http://localhost:3000',
        'https://localhost:3000',
    ].filter(Boolean);
    return [...new Set(list)];
}

export function isDeriv1Origin(origin: string): boolean {
    if (!origin) return false;
    try {
        if (origin === window.location.origin) return true;
    } catch {
        /* ignore */
    }
    if (getDeriv1AppOrigins().includes(origin)) return true;
    try {
        const host = new URL(origin).hostname.toLowerCase();
        return /^deriv-1(-[a-z0-9]+)?\.vercel\.app$/i.test(host);
    } catch {
        return false;
    }
}

function fromBase64Url(raw: string): string {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    return atob(padded + pad);
}

export function parseDeriv1SessionFromLocation(): Deriv1BotSessionPayload | null {
    try {
        const hash = window.location.hash.replace(/^#/, '');
        const params = new URLSearchParams(hash.includes('=') ? hash : '');
        const packed = params.get('deriv1_session');
        if (!packed) return null;
        const json = fromBase64Url(packed);
        const parsed = JSON.parse(json) as Partial<Deriv1BotSessionPayload>;
        if (parsed.v !== 1) return null;
        return {
            v: 1,
            loginid: String(parsed.loginid || '').trim(),
            email: parsed.email,
            currency: parsed.currency || 'USD',
            virtualBalance: Number(parsed.virtualBalance),
            oauthToken: parsed.oauthToken,
            furyToken: parsed.furyToken,
        };
    } catch {
        return null;
    }
}

export function rememberHandoffShadowLoginid(loginid: string): void {
    const id = loginid.trim();
    if (!id) return;
    try {
        localStorage.setItem(DERIV1_HANDOFF_LOGINID_KEY, id);
        sessionStorage.setItem(DERIV1_HANDOFF_LOGINID_KEY, id);
    } catch {
        /* ignore */
    }
}

export function getHandoffShadowLoginid(): string {
    try {
        return (
            localStorage.getItem(DERIV1_HANDOFF_LOGINID_KEY) ||
            sessionStorage.getItem(DERIV1_HANDOFF_LOGINID_KEY) ||
            ''
        ).trim();
    } catch {
        return '';
    }
}

export function isHandoffShadowLoginid(loginid: string | undefined | null): boolean {
    const id = String(loginid ?? '')
        .trim()
        .toUpperCase();
    const stored = getHandoffShadowLoginid().toUpperCase();
    return Boolean(id && stored && id === stored);
}

function stripHandoffHash(): void {
    try {
        const url = new URL(window.location.href);
        if (!url.hash.includes('deriv1_session=')) return;
        window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    } catch {
        /* ignore */
    }
}

let lastPostedToDeriv1: number | null = null;

export function postVirtualBalanceToDeriv1(value: number, loginid?: string): void {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const rounded = Math.round(n * 100) / 100;
    if (lastPostedToDeriv1 === rounded) return;
    lastPostedToDeriv1 = rounded;
    const payload = {
        type: DERIV1_BOT_BALANCE_MSG,
        source: 'bot-1',
        value: rounded,
        loginid: loginid || getHandoffShadowLoginid() || undefined,
    };
    const opener = window.opener as Window | null;
    const parentWin = window.parent !== window ? window.parent : null;
    [opener, parentWin].forEach(target => {
        if (!target || target.closed) return;
        try {
            target.postMessage(payload, '*');
        } catch {
            /* ignore */
        }
    });
}

export function applyDeriv1SessionPayload(
    session: Deriv1BotSessionPayload,
    writeShadow: (loginid: string, value: number) => void
): void {
    const loginKey = session.loginid || 'ROT90381442';
    rememberHandoffShadowLoginid(loginKey);
    try {
        localStorage.setItem('active_loginid', loginKey);
    } catch {
        /* ignore */
    }
    if (session.oauthToken) {
        try {
            localStorage.setItem('deriv_oauth_access_token', session.oauthToken);
            localStorage.setItem('deriv-oauth-token', session.oauthToken);
            localStorage.setItem('deriv_oauth_access_token_saved_at', String(Date.now()));
        } catch {
            /* ignore */
        }
    }
    if (session.furyToken) {
        try {
            localStorage.setItem('fury-token', session.furyToken);
        } catch {
            /* ignore */
        }
    }
    if (Number.isFinite(session.virtualBalance)) {
        lastPostedToDeriv1 = Math.round(session.virtualBalance * 100) / 100;
        writeShadow(loginKey, session.virtualBalance);
    }
}

export function consumeDeriv1Handoff(
    writeShadow: (loginid: string, value: number) => void
): Deriv1BotSessionPayload | null {
    const fromHash = parseDeriv1SessionFromLocation();
    if (fromHash) {
        applyDeriv1SessionPayload(fromHash, writeShadow);
        stripHandoffHash();
        try {
            window.opener?.postMessage({ type: DERIV1_BOT_SESSION_ACK, source: 'bot-1' }, '*');
        } catch {
            /* ignore */
        }
        return fromHash;
    }
    return null;
}

export function listenForDeriv1Session(writeShadow: (loginid: string, value: number) => void): () => void {
    const onMsg = (event: MessageEvent) => {
        if (!isDeriv1Origin(event.origin)) return;
        const data = event.data as {
            type?: string;
            session?: Deriv1BotSessionPayload;
            value?: number;
            loginid?: string;
        };
        if (data?.type === DERIV1_BOT_BALANCE_MSG) {
            const next = Number(data.value);
            if (!Number.isFinite(next)) return;
            const loginKey = String(data.loginid || getHandoffShadowLoginid() || 'ROT90381442').trim();
            rememberHandoffShadowLoginid(loginKey);
            lastPostedToDeriv1 = Math.round(next * 100) / 100;
            writeShadow(loginKey, next);
            return;
        }
        if (data?.type !== DERIV1_BOT_SESSION_MSG || !data.session) return;
        applyDeriv1SessionPayload(data.session, writeShadow);
        try {
            (event.source as Window | null)?.postMessage(
                { type: DERIV1_BOT_SESSION_ACK, source: 'bot-1' },
                event.origin
            );
        } catch {
            /* ignore */
        }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
}
