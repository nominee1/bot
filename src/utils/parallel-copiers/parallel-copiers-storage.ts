import {
    getDerivOAuthAccessToken,
    isDerivOptionsOAuthSession,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import { isVirtualLoginid } from '@/components/shared/utils/login/pick-default-account';
import {
    isOptionsOAuthSessionLoginid,
    isOptionsOAuthSessionToken,
    readSessionAccountMap,
} from '@/utils/parallel-copiers/parallel-session-accounts';

export const PARALLEL_COPIERS_STORAGE_KEY = 'parallel_copiers_v1';
export const PARALLEL_COPIERS_PERSONAL_KEY = 'parallel_copiers_personal_v1';
export const PARALLEL_COPIERS_CLIENT_KEY = 'parallel_copiers_client_v1';
export const PARALLEL_COPY_TRADE_ENABLED_KEY = 'parallel_copy_trade_enabled';
export const PARALLEL_COPY_PERSONAL_ENABLED_KEY = 'parallel_copy_personal_enabled';
export const PARALLEL_COPY_CLIENT_ENABLED_KEY = 'parallel_copy_client_enabled';
export const PARALLEL_CLIENT_MAIN_LOGINID_KEY = 'parallel_client_main_loginid';
export const PARALLEL_CLIENT_DERIV_APP_ID_KEY = 'parallel_client_deriv_app_id';
export const PARALLEL_PERSONAL_MAIN_LOGINID_KEY = 'parallel_personal_main_loginid';
export const PARALLEL_PERSONAL_ACTIVE_COPIERS_KEY = 'parallel_personal_active_copiers_v1';

export type TParallelCopyScope = 'personal' | 'client';

export type TParallelCopier = {
    id: string;
    loginid: string;
    token: string;
    currency: string;
    label: string;
    is_virtual: boolean;
    balance: number;
    added_at: number;
    scope: TParallelCopyScope;
    /** Client only: when true, trades mirror to this account. */
    copying?: boolean;
    /** Options REST / OTP Deriv-App-ID when token is not the session lead OAuth token. */
    deriv_app_id?: string;
};

const listeners = new Set<() => void>();

function storageKeyForScope(scope: TParallelCopyScope): string {
    return scope === 'personal' ? PARALLEL_COPIERS_PERSONAL_KEY : PARALLEL_COPIERS_CLIENT_KEY;
}

function notify() {
    listeners.forEach(fn => fn());
}

export function subscribeParallelCopiers(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function migrateLegacyCopiersOnce(): void {
    try {
        const legacy_raw = localStorage.getItem(PARALLEL_COPIERS_STORAGE_KEY);
        if (legacy_raw) {
            const legacy = JSON.parse(legacy_raw) as TParallelCopier[];
            if (Array.isArray(legacy) && legacy.length) {
                const active = readPersonalActiveCopiers();
                if (!active.length) {
                    const ids = legacy.map(c => c.loginid).filter(Boolean);
                    writePersonalActiveCopiers(ids);
                }
            }
            localStorage.removeItem(PARALLEL_COPIERS_STORAGE_KEY);
        }

        const personal_stored = localStorage.getItem(PARALLEL_COPIERS_PERSONAL_KEY);
        if (personal_stored) {
            const personal = JSON.parse(personal_stored) as TParallelCopier[];
            if (Array.isArray(personal) && personal.length) {
                const active = readPersonalActiveCopiers();
                if (!active.length) {
                    const ids = personal.map(c => c.loginid).filter(Boolean);
                    writePersonalActiveCopiers(ids);
                }
            }
            localStorage.removeItem(PARALLEL_COPIERS_PERSONAL_KEY);
        }

        if (localStorage.getItem(PARALLEL_COPY_TRADE_ENABLED_KEY) === '1') {
            if (localStorage.getItem(PARALLEL_COPY_PERSONAL_ENABLED_KEY) == null) {
                localStorage.setItem(PARALLEL_COPY_PERSONAL_ENABLED_KEY, '1');
            }
        }
    } catch {
        /* noop */
    }
}

function readFlag(key: string): boolean {
    try {
        return localStorage.getItem(key) === '1';
    } catch {
        return false;
    }
}

function writeFlag(key: string, enabled: boolean): void {
    try {
        localStorage.setItem(key, enabled ? '1' : '0');
    } catch {
        /* noop */
    }
    notify();
}

export function isParallelCopyPersonalEnabled(): boolean {
    migrateLegacyCopiersOnce();
    return readFlag(PARALLEL_COPY_PERSONAL_ENABLED_KEY);
}

export function isParallelCopyClientEnabled(): boolean {
    migrateLegacyCopiersOnce();
    return readFlag(PARALLEL_COPY_CLIENT_ENABLED_KEY);
}

export function setParallelCopyPersonalEnabled(enabled: boolean): void {
    writeFlag(PARALLEL_COPY_PERSONAL_ENABLED_KEY, enabled);
}

export function setParallelCopyClientEnabled(enabled: boolean): void {
    writeFlag(PARALLEL_COPY_CLIENT_ENABLED_KEY, enabled);
}

/** True when personal copy is on or at least one client card is copying. */
export function isParallelCopyTradeEnabled(): boolean {
    return isParallelCopyPersonalEnabled() || readParallelCopiers('client').some(c => c.copying === true);
}

/** @deprecated Use scope-specific enable flags. */
export function setParallelCopyTradeEnabled(enabled: boolean): void {
    setParallelCopyPersonalEnabled(enabled);
    setParallelCopyClientEnabled(enabled);
}

export function getClientMainLoginid(): string | null {
    migrateLegacyCopiersOnce();
    try {
        const id = localStorage.getItem(PARALLEL_CLIENT_MAIN_LOGINID_KEY);
        return id && id.trim() ? id.trim() : null;
    } catch {
        return null;
    }
}

export function getPersonalMainLoginid(): string | null {
    migrateLegacyCopiersOnce();
    try {
        const id = localStorage.getItem(PARALLEL_PERSONAL_MAIN_LOGINID_KEY);
        return id && id.trim() ? id.trim() : null;
    } catch {
        return null;
    }
}

export function setClientMainLoginid(loginid: string | null): void {
    try {
        if (loginid) {
            localStorage.setItem(PARALLEL_CLIENT_MAIN_LOGINID_KEY, loginid);
        } else {
            localStorage.removeItem(PARALLEL_CLIENT_MAIN_LOGINID_KEY);
            localStorage.removeItem(PARALLEL_CLIENT_DERIV_APP_ID_KEY);
        }
    } catch {
        /* noop */
    }
    notify();
}

/** Deriv-App-ID for the client lead (e.g. ROT parallel copy app id from rot-token-audit). */
export function getClientMainDerivAppId(): string | null {
    try {
        const id = localStorage.getItem(PARALLEL_CLIENT_DERIV_APP_ID_KEY);
        return id?.trim() ? id.trim() : null;
    } catch {
        return null;
    }
}

export function setClientMainDerivAppId(appId: string | null): void {
    try {
        if (appId?.trim()) {
            localStorage.setItem(PARALLEL_CLIENT_DERIV_APP_ID_KEY, appId.trim());
        } else {
            localStorage.removeItem(PARALLEL_CLIENT_DERIV_APP_ID_KEY);
        }
    } catch {
        /* noop */
    }
    notify();
}

/** Options REST / OTP app id — copier row first, then client lead override. */
export function resolveOptionsDerivAppIdForLoginid(loginid: string): string | null {
    const fromCopier = getCopierDerivAppId(loginid);
    if (fromCopier) return fromCopier;
    const main = getClientMainLoginid();
    if (main && main === loginid.trim()) {
        return getClientMainDerivAppId();
    }
    return null;
}

export function setPersonalMainLoginid(loginid: string | null): void {
    try {
        if (loginid) {
            localStorage.setItem(PARALLEL_PERSONAL_MAIN_LOGINID_KEY, loginid);
            const active = readPersonalActiveCopiers().filter(id => id !== loginid);
            writePersonalActiveCopiers(active);
        } else {
            localStorage.removeItem(PARALLEL_PERSONAL_MAIN_LOGINID_KEY);
        }
    } catch {
        /* noop */
    }
    notify();
}

export function readPersonalActiveCopiers(): string[] {
    migrateLegacyCopiersOnce();
    try {
        const raw = localStorage.getItem(PARALLEL_PERSONAL_ACTIVE_COPIERS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as string[];
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
        return [];
    }
}

function writePersonalActiveCopiers(loginids: string[]): void {
    try {
        const main = getPersonalMainLoginid();
        const unique = [...new Set(loginids.filter(id => id && id !== main))];
        localStorage.setItem(PARALLEL_PERSONAL_ACTIVE_COPIERS_KEY, JSON.stringify(unique));
    } catch {
        /* noop */
    }
    notify();
}

export function togglePersonalActiveCopier(loginid: string): boolean {
    const main = getPersonalMainLoginid();
    if (!loginid || loginid === main) return false;
    const active = readPersonalActiveCopiers();
    const next = active.includes(loginid) ? active.filter(id => id !== loginid) : [...active, loginid];
    writePersonalActiveCopiers(next);
    return next.includes(loginid);
}

export function isPersonalCopierActive(loginid: string): boolean {
    return readPersonalActiveCopiers().includes(loginid);
}

function buildPersonalCopiersFromSession(): TParallelCopier[] {
    const main = getPersonalMainLoginid();
    if (!main) return [];
    const active = readPersonalActiveCopiers();
    const session = readSessionAccountMap();
    return active
        .filter(loginid => loginid !== main && session.has(loginid))
        .map(loginid => {
            const acc = session.get(loginid)!;
            return {
                id: `personal_session_${loginid}`,
                loginid,
                token: acc.token,
                currency: acc.currency,
                label: loginid,
                is_virtual: acc.is_virtual,
                balance: 0,
                added_at: 0,
                scope: 'personal' as const,
            };
        });
}

export function readParallelCopiers(scope: TParallelCopyScope): TParallelCopier[] {
    if (scope === 'personal') {
        return buildPersonalCopiersFromSession();
    }
    migrateLegacyCopiersOnce();
    try {
        const raw = localStorage.getItem(storageKeyForScope(scope));
        if (!raw) return [];
        const parsed = JSON.parse(raw) as TParallelCopier[];
        return Array.isArray(parsed) ? parsed.map(c => ({ ...c, scope, copying: c.copying ?? false })) : [];
    } catch {
        return [];
    }
}

export function readAllParallelCopiers(): TParallelCopier[] {
    return [...readParallelCopiers('personal'), ...readParallelCopiers('client')];
}

function writeParallelCopiers(scope: TParallelCopyScope, copiers: TParallelCopier[]): void {
    if (scope === 'personal') return;
    try {
        localStorage.setItem(storageKeyForScope(scope), JSON.stringify(copiers));
    } catch {
        /* noop */
    }
    notify();
}

/** Keep copier tokens in legacy `accountsList` so the rest of the app can resolve them. */
export function syncCopiersToAccountsList(copiers: TParallelCopier[]): void {
    try {
        const accounts_list = JSON.parse(localStorage.getItem('accountsList') ?? '{}') as Record<string, string>;
        const client_accounts = JSON.parse(localStorage.getItem('clientAccounts') ?? '{}') as Record<
            string,
            { loginid: string; token: string; currency: string }
        >;

        copiers.forEach(c => {
            if (!c.loginid || !c.token) return;
            accounts_list[c.loginid] = c.token;
            client_accounts[c.loginid] = {
                loginid: c.loginid,
                token: c.token,
                currency: c.currency || 'USD',
            };
        });

        localStorage.setItem('accountsList', JSON.stringify(accounts_list));
        localStorage.setItem('clientAccounts', JSON.stringify(client_accounts));
    } catch {
        /* noop */
    }
}

function syncScopeToAccountsList(scope: TParallelCopyScope): void {
    syncCopiersToAccountsList(readAllParallelCopiers());
    void scope;
}

export function updateCopierBalance(loginid: string, balance: number, currency?: string): void {
    const copiers = readParallelCopiers('client');
    const idx = copiers.findIndex(c => c.loginid === loginid);
    if (idx < 0) return;
    copiers[idx] = {
        ...copiers[idx],
        balance,
        ...(currency ? { currency } : {}),
    };
    writeParallelCopiers('client', copiers);
}

export function addParallelCopier(
    scope: TParallelCopyScope,
    entry: Omit<TParallelCopier, 'id' | 'label' | 'added_at' | 'scope' | 'copying'> & {
        copying?: boolean;
        label?: string;
    }
): TParallelCopier {
    if (scope === 'personal') {
        togglePersonalActiveCopier(entry.loginid);
        return buildPersonalCopiersFromSession().find(c => c.loginid === entry.loginid)!;
    }

    const copiers = readParallelCopiers('client');
    const next_index = copiers.length + 1;
    const copier: TParallelCopier = {
        ...entry,
        scope,
        copying: entry.copying ?? false,
        id: `${scope}_${Date.now()}_${next_index}`,
        label: entry.label?.trim() || `Client ${next_index}`,
        added_at: Date.now(),
        is_virtual: entry.is_virtual ?? isVirtualLoginid(entry.loginid),
    };
    const next = [...copiers, copier];
    writeParallelCopiers('client', next);
    syncScopeToAccountsList('client');
    return copier;
}

/** Add or update a client copier by loginid (used when arming Oracle copytraders). */
export function upsertClientCopier(
    entry: Omit<TParallelCopier, 'id' | 'added_at' | 'scope'> & { scope?: never }
): TParallelCopier {
    const copiers = readParallelCopiers('client');
    const idx = copiers.findIndex(c => c.loginid === entry.loginid);
    if (idx >= 0) {
        copiers[idx] = {
            ...copiers[idx],
            token: entry.token,
            currency: entry.currency,
            balance: entry.balance,
            is_virtual: entry.is_virtual,
            label: entry.label ?? copiers[idx].label,
            copying: entry.copying ?? true,
            deriv_app_id: entry.deriv_app_id ?? copiers[idx].deriv_app_id,
        };
        writeParallelCopiers('client', copiers);
        syncCopiersToAccountsList(copiers);
        return copiers[idx];
    }
    return addParallelCopier('client', {
        loginid: entry.loginid,
        token: entry.token,
        currency: entry.currency,
        balance: entry.balance,
        is_virtual: entry.is_virtual,
        copying: entry.copying ?? true,
        label: entry.label,
        deriv_app_id: entry.deriv_app_id,
    });
}

export function findClientCopierByLoginid(loginid: string): TParallelCopier | undefined {
    return readParallelCopiers('client').find(c => c.loginid === loginid);
}

export function findClientCopierByLabel(label: string): TParallelCopier | undefined {
    const norm = label.trim().toLowerCase();
    return readParallelCopiers('client').find(c => c.label.trim().toLowerCase() === norm);
}

export function removeParallelCopier(scope: TParallelCopyScope, id: string): void {
    if (scope === 'personal') {
        const copier = readParallelCopiers('personal').find(c => c.id === id);
        if (copier) {
            writePersonalActiveCopiers(readPersonalActiveCopiers().filter(l => l !== copier.loginid));
        }
        return;
    }
    const next = readParallelCopiers('client').filter(c => c.id !== id);
    writeParallelCopiers('client', next);
    syncScopeToAccountsList('client');
}

export function setClientCopying(id: string, copying: boolean): void {
    const copiers = readParallelCopiers('client');
    const idx = copiers.findIndex(c => c.id === id);
    if (idx < 0) return;
    copiers[idx] = { ...copiers[idx], copying };
    writeParallelCopiers('client', copiers);
    if (copying) {
        syncScopeToAccountsList('client');
    }
}

export function getParallelCopiersForMirror(activeLoginid: string): TParallelCopier[] {
    if (!activeLoginid) return [];

    const out: TParallelCopier[] = [];
    const seen = new Set<string>();

    const pushUnique = (list: TParallelCopier[]) => {
        list.forEach(c => {
            if (!c.loginid || seen.has(c.loginid)) return;
            if (!c.token) return;
            seen.add(c.loginid);
            out.push(c);
        });
    };

    if (isParallelCopyPersonalEnabled()) {
        const main = getPersonalMainLoginid();
        if (main && main === activeLoginid) {
            pushUnique(buildPersonalCopiersFromSession());
        }
    }

    const main_client = getClientMainLoginid();
    if (main_client && main_client === activeLoginid) {
        pushUnique(readParallelCopiers('client').filter(c => c.copying === true));
    }

    return out;
}

export function getCopierToken(loginid: string): string | null {
    const session = readSessionAccountMap().get(loginid);
    if (session?.token) return session.token;
    const found = readParallelCopiers('client').find(c => c.loginid === loginid);
    return found?.token ?? null;
}

export function getCopierDerivAppId(loginid: string): string | null {
    const found = readParallelCopiers('client').find(c => c.loginid === loginid);
    return found?.deriv_app_id?.trim() || null;
}

/** True when this copier trades on classic `websockets/v3` (a1- PAT), not Options OTP/PAT. */
export function isLegacyParallelCopierLoginid(loginid: string): boolean {
    if (!loginid?.trim()) return false;
    const token = getCopierToken(loginid);
    if (!token || token === 'MOON_VIRTUAL' || token === 'MOON_LEAD_VIRTUAL') return false;
    const trimmed = token.trim();
    if (/^\s*(pat_|eyJ|ory_at_)/i.test(trimmed)) return false;
    if (isOptionsOAuthSessionToken(token)) return false;
    if (isDerivOptionsOAuthSession() && getDerivOAuthAccessToken() && isOptionsOAuthSessionLoginid(loginid)) {
        return false;
    }
    return true;
}
