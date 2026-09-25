import {
    authData$,
    setAccountList,
    setAuthData,
    setIsAuthorized,
    setIsAuthorizing,
} from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import type { TAccount, TAuthData } from '@/types/api-types';

export const DERIV1_BOT_SESSION_MSG = 'deriv1-bot-session';
export const DERIV1_BOT_BALANCE_MSG = 'deriv1-virtual-balance';
export const DERIV1_BOT_SESSION_ACK = 'deriv1-bot-session-ack';
export const DERIV1_HANDOFF_LOGINID_KEY = 'deriv1_virtual_shadow_loginid';
export const DERIV1_SESSION_STORAGE_KEY = 'deriv1_bot_session_v1';
export const DERIV1_ACCOUNT_MODE_KEY = 'deriv1_account_mode';
export const DERIV1_DEMO_LOGINID = 'VRTC10000';
export const DERIV1_DEMO_BALANCE = 10000;

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
        'http://localhost:3001',
        'https://localhost:3001',
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

function normalizeSession(parsed: Partial<Deriv1BotSessionPayload>): Deriv1BotSessionPayload | null {
    const loginid = String(parsed.loginid || '').trim();
    if (parsed.v !== 1 || !loginid) return null;
    return {
        v: 1,
        loginid,
        email: parsed.email,
        currency: parsed.currency || 'USD',
        virtualBalance: Number(parsed.virtualBalance),
        oauthToken: parsed.oauthToken,
        furyToken: parsed.furyToken,
    };
}

export function parseDeriv1SessionFromLocation(): Deriv1BotSessionPayload | null {
    try {
        const hash = window.location.hash.replace(/^#/, '');
        const packed = hash.match(/(?:^|&)deriv1_session=([^&]+)/)?.[1];
        if (!packed) return null;
        const json = fromBase64Url(decodeURIComponent(packed));
        return normalizeSession(JSON.parse(json) as Partial<Deriv1BotSessionPayload>);
    } catch {
        return null;
    }
}

export function persistDeriv1Session(session: Deriv1BotSessionPayload): void {
    try {
        const packed = JSON.stringify(session);
        sessionStorage.setItem(DERIV1_SESSION_STORAGE_KEY, packed);
        localStorage.setItem(DERIV1_SESSION_STORAGE_KEY, packed);
    } catch {
        /* ignore */
    }
}

export function readPersistedDeriv1Session(): Deriv1BotSessionPayload | null {
    try {
        const raw =
            sessionStorage.getItem(DERIV1_SESSION_STORAGE_KEY) || localStorage.getItem(DERIV1_SESSION_STORAGE_KEY);
        if (!raw) return null;
        return normalizeSession(JSON.parse(raw) as Partial<Deriv1BotSessionPayload>);
    } catch {
        return null;
    }
}

export function getDeriv1AccountMode(): 'real' | 'demo' {
    try {
        return sessionStorage.getItem(DERIV1_ACCOUNT_MODE_KEY) === 'demo' ? 'demo' : 'real';
    } catch {
        return 'real';
    }
}

export function setDeriv1AccountMode(mode: 'real' | 'demo'): void {
    try {
        sessionStorage.setItem(DERIV1_ACCOUNT_MODE_KEY, mode);
    } catch {
        /* ignore */
    }
}

export function isDeriv1DemoLoginid(loginid?: string | null): boolean {
    return String(loginid || '')
        .trim()
        .toUpperCase()
        .startsWith('VRT');
}

function demoAccountFromCurrency(currency: string): TAccount {
    return {
        account_category: 'trading',
        account_type: 'standard',
        broker: 'VRTC',
        created_at: 0,
        currency: currency || 'USD',
        currency_type: 'fiat',
        is_disabled: 0,
        is_virtual: 1,
        landing_company_name: 'virtual',
        linked_to: [],
        loginid: DERIV1_DEMO_LOGINID,
    };
}

function withDemoAccountList(real: TAccount): TAccount[] {
    if (isDeriv1DemoLoginid(real.loginid)) return [real];
    return [real, demoAccountFromCurrency(real.currency)];
}

function persistClientAccounts(accounts: TAccount[], email?: string): void {
    try {
        const accountsList = JSON.parse(localStorage.getItem('accountsList') || '{}') as Record<string, string>;
        const clientAccounts = JSON.parse(localStorage.getItem('clientAccounts') || '{}') as Record<string, object>;
        accounts.forEach(account => {
            if (!accountsList[account.loginid]) {
                accountsList[account.loginid] = account.is_virtual ? 'deriv1-demo' : 'deriv1-virtual';
            }
            clientAccounts[account.loginid] = {
                loginid: account.loginid,
                token: accountsList[account.loginid],
                currency: account.currency || 'USD',
                email: email || '',
                is_virtual: account.is_virtual ? 1 : 0,
            };
        });
        localStorage.setItem('accountsList', JSON.stringify(accountsList));
        localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
    } catch {
        /* ignore */
    }
}

function virtualAccountFromSession(session: Deriv1BotSessionPayload): TAccount {
    return {
        account_category: 'trading',
        account_type: 'standard',
        broker: 'CR',
        created_at: 0,
        currency: session.currency || 'USD',
        currency_type: 'fiat',
        is_disabled: 0,
        is_virtual: /^VRT/i.test(session.loginid) ? 1 : 0,
        landing_company_name: 'svg',
        linked_to: [],
        loginid: session.loginid,
    };
}

/** Hydrate MobX/header auth without a live Deriv authorize (virtual ledger session). */
export function hydrateAuthFromDeriv1Session(session: Deriv1BotSessionPayload): void {
    const account = virtualAccountFromSession(session);
    const list = withDemoAccountList(account);
    const useDemo = getDeriv1AccountMode() === 'demo' && list.some(item => item.loginid === DERIV1_DEMO_LOGINID);
    const loginKey = useDemo ? DERIV1_DEMO_LOGINID : session.loginid;
    const balance = useDemo
        ? DERIV1_DEMO_BALANCE
        : Number.isFinite(session.virtualBalance)
          ? session.virtualBalance
          : 0;
    const auth = {
        account_list: list,
        balance,
        country: '',
        currency: session.currency || 'USD',
        email: session.email || '',
        fullname: '',
        is_virtual: useDemo || isDeriv1DemoLoginid(session.loginid) ? 1 : 0,
        landing_company_fullname: 'Deriv (SVG) LLC',
        landing_company_name: useDemo ? 'virtual' : 'svg',
        linked_to: [],
        local_currencies: {},
        loginid: loginKey,
        preferred_language: 'EN',
        scopes: [],
        upgradeable_landing_companies: [],
        user_id: 0,
    } as TAuthData;

    persistClientAccounts(list, session.email);
    try {
        localStorage.setItem('active_loginid', loginKey);
    } catch {
        /* ignore */
    }

    setIsAuthorizing(false);
    setAccountList(list);
    setAuthData(auth);
    setIsAuthorized(true);
}

export function switchDeriv1AccountMode(mode: 'real' | 'demo', realBalance?: number): void {
    setDeriv1AccountMode(mode);
    const session = readPersistedDeriv1Session();
    // Keep Real ledger independent of Demo. Only refresh Real from an explicit real balance
    // when switching (never replace Real with Demo's fixed 10,000).
    const existing =
        typeof session?.virtualBalance === 'number' && Number.isFinite(session.virtualBalance)
            ? session.virtualBalance
            : undefined;
    const incoming = Number(realBalance);
    const looksLikeDemo =
        Number.isFinite(incoming) && Math.abs(incoming - DERIV1_DEMO_BALANCE) < 0.001 && mode === 'demo';
    const ledger = looksLikeDemo
        ? (existing ?? 0)
        : Number.isFinite(incoming) && incoming >= 0
          ? incoming
          : (existing ?? 0);

    if (session) {
        const next = { ...session, virtualBalance: mode === 'demo' ? (existing ?? ledger) : ledger };
        // When entering Demo, preserve Real ledger as-is.
        if (mode === 'demo' && existing != null) {
            next.virtualBalance = existing;
        }
        persistDeriv1Session(next);
        hydrateAuthFromDeriv1Session(next);
        return;
    }
    const current = authData$.getValue();
    const realLogin = getHandoffShadowLoginid() || current?.loginid || '';
    if (!realLogin || isDeriv1DemoLoginid(realLogin)) return;
    hydrateAuthFromDeriv1Session({
        v: 1,
        loginid: realLogin,
        email: current?.email,
        currency: current?.currency || 'USD',
        virtualBalance: ledger,
    });
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
        window.history.replaceState({}, '', `${url.pathname}${url.search}#bot_builder`);
    } catch {
        /* ignore */
    }
}

let lastPostedToDeriv1: number | null = null;

export function postVirtualBalanceToDeriv1(value: number, loginid?: string): void {
    // Demo switcher ledger must never overwrite the parent Real virtual balance.
    if (isDeriv1DemoLoginid(loginid)) return;
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const rounded = Math.round(n * 100) / 100;
    if (lastPostedToDeriv1 === rounded) return;
    lastPostedToDeriv1 = rounded;
    const stored = readPersistedDeriv1Session();
    if (stored && !isDeriv1DemoLoginid(stored.loginid)) {
        persistDeriv1Session({ ...stored, virtualBalance: rounded });
    }
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
    const next = { ...session, loginid: loginKey };
    rememberHandoffShadowLoginid(loginKey);
    persistDeriv1Session(next);
    try {
        localStorage.setItem('active_loginid', loginKey);
    } catch {
        /* ignore */
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
    // Demo row is display-only at 10,000 — write locally without parent post (writeCrShadow skips VRT).
    writeShadow(DERIV1_DEMO_LOGINID, DERIV1_DEMO_BALANCE);
    hydrateAuthFromDeriv1Session(next);
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
    const persisted = readPersistedDeriv1Session();
    if (persisted) {
        applyDeriv1SessionPayload(persisted, writeShadow);
        return persisted;
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
