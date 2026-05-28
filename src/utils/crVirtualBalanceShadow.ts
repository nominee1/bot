import type ClientStore from '@/stores/client-store';
import type { Balance } from '@deriv/api-types';

/** Real-money wallet used by BotIframe virtual pipeline (shadow balance in localStorage). */
export const ALLOWED_BOT_IFRAME_LOGINID = 'CR7557018';

/** Case-insensitive match — Deriv `authorize` / UI may vary casing; shadow keys use {@link ALLOWED_BOT_IFRAME_LOGINID}. */
export function isCrVirtualShadowLogin(loginid: string | undefined | null): boolean {
    return String(loginid ?? '')
        .trim()
        .toUpperCase() === ALLOWED_BOT_IFRAME_LOGINID.toUpperCase();
}

export const VBAL_SHADOW_KEY = 'virtual_cr_shadow_map';

export type CrShadowMsg = { type: 'cr_shadow'; loginid: string; value: number };

export let crShadowChannel: BroadcastChannel | null = null;
try {
    crShadowChannel = new BroadcastChannel('denara_cr_virtual_shadow');
} catch {
    /* Safari Private / old browsers */
}

declare global {
    interface Window {
        __VIRT_BAL__?: { map: Record<string, number>; subs: Set<() => void> };
    }
}

function notifyVirtBus(loginid: string, value: number) {
    const bag = window.__VIRT_BAL__;
    if (!bag) return;
    bag.map[loginid] = value;
    bag.subs.forEach(fn => fn());
}

export function readCrShadowMap(): Record<string, number> {
    try {
        return JSON.parse(localStorage.getItem(VBAL_SHADOW_KEY) || '{}');
    } catch {
        return {};
    }
}

export function getCrShadow(loginid?: string): number | undefined {
    if (!loginid) return undefined;
    const map = readCrShadowMap();
    return typeof map[loginid] === 'number' ? map[loginid] : undefined;
}

export function writeCrShadow(loginid: string, value: number) {
    const map = readCrShadowMap();
    map[loginid] = value;
    localStorage.setItem(VBAL_SHADOW_KEY, JSON.stringify(map));
    try {
        crShadowChannel?.postMessage({ type: 'cr_shadow', loginid, value } as CrShadowMsg);
    } catch {
        /* ignore */
    }
}

/** In-memory bus used by BotIframe / Flipaa virtual pipelines */
export function getVirtBus() {
    if (!window.__VIRT_BAL__) window.__VIRT_BAL__ = { map: {}, subs: new Set() };
    const bag = window.__VIRT_BAL__;
    const notify = () => bag.subs.forEach(fn => fn());
    return {
        get(loginid?: string) {
            return loginid ? Number(bag.map[loginid] ?? 0) : 0;
        },
        add(loginid: string | undefined, delta: number) {
            if (loginid && delta) {
                bag.map[loginid] = (bag.map[loginid] ?? 0) + Number(delta);
                notify();
            }
        },
        set(loginid: string | undefined, value: number) {
            if (loginid) {
                bag.map[loginid] = Number(value ?? 0);
                notify();
            }
        },
        subscribe(fn: () => void) {
            bag.subs.add(fn);
            return () => bag.subs.delete(fn);
        },
    };
}

let crShadowMutex = Promise.resolve();

export function runWithCrShadowLock<T>(fn: () => T): Promise<T> {
    const prev = crShadowMutex;
    let release!: () => void;
    const tail = new Promise<void>(r => {
        release = r;
    });
    crShadowMutex = tail;
    return prev.then(() => {
        try {
            return fn();
        } finally {
            release();
        }
    });
}

/**
 * Debit CR shadow if balance >= ask. Updates MobX + virt bus. Returns false if insufficient (no mutation).
 */
export function tryDebitCrShadowSync(client: ClientStore, loginKey: string, ask: number): boolean {
    if (loginKey !== ALLOWED_BOT_IFRAME_LOGINID || loginKey.startsWith('VRT')) return false;
    const currency = client.currency || client.all_accounts_balance?.accounts?.[loginKey]?.currency || 'USD';
    const dec = decimalsForCurrency(currency);
    let cur = getCrShadow(loginKey);
    if (typeof cur !== 'number' || !Number.isFinite(cur)) cur = readDisplayedRealBalance(client, loginKey);
    if (!Number.isFinite(ask) || ask < 0) return false;
    if (cur + 1e-9 < ask) return false;
    const next = Number((Math.max(0, cur - ask)).toFixed(dec));
    writeCrShadow(loginKey, next);
    try {
        client.setBalance(next.toFixed(dec));
        client.setCurrency(currency);
        patchOneAccountBalance(client, loginKey, next, currency);
        getVirtBus().add(loginKey, -ask);
    } catch {
        /* ignore */
    }
    return true;
}

/** Apply delta to CR shadow with floor at 0 (for settlement credits / misc). */
export function applyCrShadowDeltaSync(client: ClientStore, loginKey: string, delta: number): void {
    if (loginKey !== ALLOWED_BOT_IFRAME_LOGINID || loginKey.startsWith('VRT')) return;
    const currency = client.currency || client.all_accounts_balance?.accounts?.[loginKey]?.currency || 'USD';
    const dec = decimalsForCurrency(currency);
    let cur = getCrShadow(loginKey);
    if (typeof cur !== 'number') cur = readDisplayedRealBalance(client, loginKey);
    const next = Number((Math.max(0, cur + delta)).toFixed(dec));
    writeCrShadow(loginKey, next);
    try {
        client.setBalance(next.toFixed(dec));
        client.setCurrency(currency);
        patchOneAccountBalance(client, loginKey, next, currency);
        if (delta) getVirtBus().add(loginKey, delta);
    } catch {
        /* ignore */
    }
}

export function applyCrShadowDeltaLocked(client: ClientStore, loginKey: string, delta: number): Promise<void> {
    return runWithCrShadowLock(() => {
        applyCrShadowDeltaSync(client, loginKey, delta);
    }).then(() => undefined);
}

export function patchOneAccountBalance(client: ClientStore, loginKey: string, amount: number, currency: string) {
    const existingRoot = client.all_accounts_balance;
    const existingAccounts = existingRoot?.accounts ? { ...existingRoot.accounts } : {};
    const prevEntry = existingAccounts[loginKey] ?? { loginid: loginKey, currency };
    const cur = currency || (prevEntry as { currency?: string }).currency || 'USD';
    existingAccounts[loginKey] = {
        ...prevEntry,
        balance: amount,
        currency: cur,
    };
    client.setAllAccountsBalance({
        ...(existingRoot ?? {}),
        accounts: existingAccounts,
    } as Balance);
}

function readDisplayedRealBalance(client: ClientStore, loginid: string): number {
    const fromAccounts = client.all_accounts_balance?.accounts?.[loginid]?.balance;
    if (typeof fromAccounts === 'number' && Number.isFinite(fromAccounts)) return fromAccounts;
    const b = parseFloat(String(client.balance ?? '0'));
    return Number.isFinite(b) ? b : 0;
}

function decimalsForCurrency(currency: string): number {
    return ({ USD: 2, EUR: 2, GBP: 2, BTC: 8, ETH: 8, USDT: 6 } as Record<string, number>)[currency] ?? 2;
}

/**
 * Keeps MobX client balance in sync with persisted CR shadow when that wallet is active.
 * Prefer localStorage shadow; otherwise mirror whatever balance is already on the client (Deriv).
 */
export function syncCrShadowBalanceIfNeeded(client: ClientStore, loginid: string): void {
    if (loginid !== ALLOWED_BOT_IFRAME_LOGINID || loginid.startsWith('VRT')) return;

    const persistedShadow = getCrShadow(loginid);
    const currency = client.currency || client.all_accounts_balance?.accounts?.[loginid]?.currency || 'USD';
    const dec = decimalsForCurrency(currency);

    const amount =
        typeof persistedShadow === 'number' && Number.isFinite(persistedShadow)
            ? persistedShadow
            : readDisplayedRealBalance(client, loginid);

    try {
        patchOneAccountBalance(client, loginid, amount, currency);
        client.setBalance(amount.toFixed(dec));
        client.setCurrency(currency);
        notifyVirtBus(loginid, amount);
    } catch {
        /* ignore */
    }
}
