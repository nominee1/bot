import {
    getStoredDerivOptionsAccounts,
    isDerivOptionsOAuthSession,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import type ClientStore from '@/stores/client-store';
import type { Balance } from '@deriv/api-types';

/** Real-money wallet used by BotIframe virtual pipeline (shadow balance in localStorage). */
export const ALLOWED_BOT_IFRAME_LOGINID = 'CR7557018';

/** Options trading wallet paired with {@link ALLOWED_BOT_IFRAME_LOGINID} — same virtual ledger & fills. */
export const OPTIONS_VIRTUAL_SHADOW_LOGINID = 'ROT90381442';

/** CR ↔ ROT pairs that share one virtual shadow ledger (always keyed by the CR loginid). */
export const VIRTUAL_SHADOW_CR_TO_OPTIONS: Readonly<Record<string, string>> = {
    [ALLOWED_BOT_IFRAME_LOGINID]: OPTIONS_VIRTUAL_SHADOW_LOGINID,
};

const VIRTUAL_SHADOW_OPTIONS_TO_CR: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(VIRTUAL_SHADOW_CR_TO_OPTIONS).map(([cr, rot]) => [rot.toUpperCase(), cr.toUpperCase()])
);

const VIRTUAL_SHADOW_MANAGED_LOGINIDS = new Set(
    Object.entries(VIRTUAL_SHADOW_CR_TO_OPTIONS).flatMap(([cr, rot]) => [cr.toUpperCase(), rot.toUpperCase()])
);

/** Ledger storage key for shadow balance. Options OAuth ROT uses its own id; legacy CR keeps CR key. */
export function resolveVirtualShadowLedgerKey(loginid: string | undefined | null): string {
    const id = String(loginid ?? '')
        .trim()
        .toUpperCase();
    if (!id) return ALLOWED_BOT_IFRAME_LOGINID;

    if (isDerivOptionsOAuthSession() && id === OPTIONS_VIRTUAL_SHADOW_LOGINID.toUpperCase()) {
        return OPTIONS_VIRTUAL_SHADOW_LOGINID;
    }

    if (id === ALLOWED_BOT_IFRAME_LOGINID.toUpperCase()) return ALLOWED_BOT_IFRAME_LOGINID;
    const cr = VIRTUAL_SHADOW_OPTIONS_TO_CR[id];
    if (cr) return cr;
    return String(loginid ?? '').trim() || ALLOWED_BOT_IFRAME_LOGINID;
}

export function getOptionsLoginidForVirtualShadowCr(crLoginid: string): string | null {
    const id = String(crLoginid ?? '')
        .trim()
        .toUpperCase();
    const entry = Object.entries(VIRTUAL_SHADOW_CR_TO_OPTIONS).find(([cr]) => cr.toUpperCase() === id);
    return entry?.[1] ?? null;
}

export function isOptionsVirtualShadowLoginid(loginid: string | undefined | null): boolean {
    const id = String(loginid ?? '')
        .trim()
        .toUpperCase();
    return id === OPTIONS_VIRTUAL_SHADOW_LOGINID.toUpperCase();
}

/** Copytraders “Random 1 to the moon” lead — virtual shadow only while moon mode is on. */
export const MOON_COPY_LEAD_LOGINID = 'ROT91631259';

export const MOON_MODE_STORAGE_KEY = 'copytraders_moon_mode_active_v1';

/** Snapshotted when moon mode activates — used to mirror lead P/L onto Antidote when copy UIs open. */
export const MOON_SESSION_KEY = 'copytraders_moon_session_v1';

export type TMoonSessionSnapshot = {
    /** Lead virtual ledger at session start (set on first trade seed if not known at activate). */
    leadStart: number | null;
    /** Antidote display balance at session start (from moon trader settings). */
    antidoteStart: number;
};

export function readMoonSession(): TMoonSessionSnapshot | null {
    try {
        const raw = localStorage.getItem(MOON_SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<TMoonSessionSnapshot>;
        const antidoteStart = Number(parsed.antidoteStart);
        if (!Number.isFinite(antidoteStart)) return null;
        const leadStart = parsed.leadStart === null || parsed.leadStart === undefined ? null : Number(parsed.leadStart);
        return {
            antidoteStart,
            leadStart: typeof leadStart === 'number' && Number.isFinite(leadStart) ? leadStart : null,
        };
    } catch {
        return null;
    }
}

export function writeMoonSession(session: TMoonSessionSnapshot): void {
    try {
        localStorage.setItem(MOON_SESSION_KEY, JSON.stringify(session));
    } catch {
        /* noop */
    }
}

export function clearMoonSession(): void {
    try {
        localStorage.removeItem(MOON_SESSION_KEY);
    } catch {
        /* noop */
    }
}

/** Record lead ledger baseline on first virtual-trade seed of a moon session. */
export function recordMoonLeadStartIfNeeded(leadStart: number): void {
    if (!isMoonCopyModeActive() || !Number.isFinite(leadStart)) return;
    const session = readMoonSession();
    if (!session || session.leadStart != null) return;
    writeMoonSession({ ...session, leadStart: Number(leadStart.toFixed(2)) });
}

export function readMoonLeadLedgerBalanceFromStorage(): number | undefined {
    const stored = getCrShadow(getMoonLeadVirtualLedgerKey());
    return typeof stored === 'number' && Number.isFinite(stored) ? stored : undefined;
}

export const MOON_WRONG_ACCOUNT_ERROR = 'moon-wrong-account';

export function moonLeadWalletRequiredMessage(): string {
    return 'Moon mode on — switch to ROT91631259 to trade as moon lead';
}

/** When moon copy mode is on, virtual trades must run from the ROT lead wallet. */
export function checkMoonLeadWallet(walletLogin: string | undefined | null): string | null {
    const id = String(walletLogin ?? '').trim();
    if (!id || !isMoonCopyModeActive()) return null;
    if (id.toUpperCase() === MOON_COPY_LEAD_LOGINID.toUpperCase()) return null;
    return moonLeadWalletRequiredMessage();
}

export function isMoonCopyModeActive(): boolean {
    try {
        return localStorage.getItem(MOON_MODE_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

/** Internal ledger key for moon-mode virtual trades (does not replace header balance). */
export function getMoonLeadVirtualLedgerKey(): string {
    return `${MOON_COPY_LEAD_LOGINID}_moon_virt`;
}

export function isMoonLeadVirtualTradeLoginid(loginid: string | undefined | null): boolean {
    const id = String(loginid ?? '')
        .trim()
        .toUpperCase();
    if (!id || id.startsWith('VRT')) return false;
    return isMoonCopyModeActive() && id === MOON_COPY_LEAD_LOGINID.toUpperCase();
}

/** Header balance replaced by shadow map — ROT90381442 (Options) or CR7557018 (legacy WS only). */
export function isShadowDisplayManagedLoginid(loginid: string): boolean {
    const key = loginid.trim().toUpperCase();
    if (!key || key.startsWith('VRT') || !VIRTUAL_SHADOW_MANAGED_LOGINIDS.has(key)) return false;
    if (key === OPTIONS_VIRTUAL_SHADOW_LOGINID.toUpperCase()) return true;
    // Legacy CR wallet only when not on Options OAuth (Options uses ROT as the display wallet).
    return key === ALLOWED_BOT_IFRAME_LOGINID.toUpperCase() && !isDerivOptionsOAuthSession();
}

/** Block live Deriv balance merges while header tracks the shared virtual ledger. */
export function shouldSuppressDerivBalanceForVirtualShadow(loginid: string | undefined | null): boolean {
    const id = String(loginid ?? '').trim();
    if (!id) return false;
    return isShadowDisplayManagedLoginid(id);
}

/** @deprecated use {@link isShadowDisplayManagedLoginid} */
export function isShadowManagedLoginid(loginid: string): boolean {
    return isShadowDisplayManagedLoginid(loginid);
}

/** Virtual trade pipeline — CR7557018 + ROT90381442 always; ROT91631259 only during moon copy mode. */
export function isCrVirtualShadowLogin(loginid: string | undefined | null): boolean {
    const id = String(loginid ?? '').trim();
    if (!id) return false;
    return isShadowDisplayManagedLoginid(id) || isMoonLeadVirtualTradeLoginid(id);
}

/**
 * Moon + ROT header: virtual fills only (same rule as CR7557018 on its wallet).
 * Never call real Deriv `buy` for this combination.
 */
export function mustUseMoonVirtualTradePipeline(loginid: string | undefined | null): boolean {
    return isMoonLeadVirtualTradeLoginid(loginid);
}

export function isMoonVirtualLeadAccount(loginid: string | undefined | null): boolean {
    const id = String(loginid ?? '')
        .trim()
        .toUpperCase();
    if (!id) return false;
    return isMoonCopyModeActive() && id === MOON_COPY_LEAD_LOGINID.toUpperCase();
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

/** Read persisted shadow for a wallet (resolves paired CR↔ROT ledger key). */
export function getCrShadowForWallet(loginid?: string): number | undefined {
    if (!loginid) return undefined;
    const key = isShadowDisplayManagedLoginid(loginid) ? resolveVirtualShadowLedgerKey(loginid) : loginid;
    return getCrShadow(key);
}

function patchPairedShadowAccountBalances(
    client: ClientStore,
    loginid: string,
    amount: number,
    currency: string
): void {
    const ids = new Set<string>();

    if (isDerivOptionsOAuthSession() && isOptionsVirtualShadowLoginid(loginid)) {
        ids.add(OPTIONS_VIRTUAL_SHADOW_LOGINID);
    } else {
        const ledgerKey = resolveVirtualShadowLedgerKey(loginid);
        ids.add(String(loginid));
        ids.add(ledgerKey);
        const pairedOptions = getOptionsLoginidForVirtualShadowCr(ledgerKey);
        if (pairedOptions) ids.add(pairedOptions);
    }

    const existingRoot = client.all_accounts_balance;
    const existingAccounts = existingRoot?.accounts ? { ...existingRoot.accounts } : {};
    let changed = false;

    ids.forEach(key => {
        const prevEntry = existingAccounts[key] ?? { loginid: key, currency };
        const entryCurrency = currency || (prevEntry as { currency?: string }).currency || 'USD';
        if (prevEntry.balance === amount && (prevEntry as { currency?: string }).currency === entryCurrency) {
            return;
        }
        existingAccounts[key] = {
            ...prevEntry,
            balance: amount,
            currency: entryCurrency,
        };
        changed = true;
    });

    if (!changed) return;

    client.setAllAccountsBalance({
        ...(existingRoot ?? {}),
        accounts: existingAccounts,
    } as Balance);
}

/** Whether a `cr_shadow` broadcast should refresh the header for this active wallet. */
export function crShadowBroadcastMatchesWallet(
    walletLoginid: string | undefined | null,
    broadcastLoginid: string | undefined | null
): boolean {
    const wallet = String(walletLoginid ?? '').trim();
    const broadcast = String(broadcastLoginid ?? '').trim();
    if (!wallet || !broadcast) return false;
    if (wallet === broadcast) return true;
    if (!isShadowDisplayManagedLoginid(wallet)) return false;

    if (isDerivOptionsOAuthSession() && isOptionsVirtualShadowLoginid(wallet)) {
        return broadcast.toUpperCase() === OPTIONS_VIRTUAL_SHADOW_LOGINID.toUpperCase();
    }

    return resolveVirtualShadowLedgerKey(wallet) === resolveVirtualShadowLedgerKey(broadcast);
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

function moonVirtLedgerBalance(client: ClientStore, loginKey: string): number {
    const ledgerKey = getMoonLeadVirtualLedgerKey();
    const stored = getCrShadow(ledgerKey);
    if (typeof stored === 'number' && Number.isFinite(stored)) return stored;
    return readDisplayedRealBalance(client, loginKey);
}

function writeMoonVirtLedger(client: ClientStore, loginKey: string, next: number): void {
    const ledgerKey = getMoonLeadVirtualLedgerKey();
    const dec = decimalsForCurrency(client.currency || 'USD');
    const rounded = Number(next.toFixed(dec));
    writeCrShadow(ledgerKey, rounded);
}

/** Ignore live Deriv balance pushes for ROT while moon virtual trading is on. */
export function shouldSuppressDerivBalanceForMoonLead(loginid: string | undefined | null): boolean {
    return isMoonVirtualLeadAccount(loginid);
}

function patchMoonVirtHeaderBalance(client: ClientStore, loginKey: string, amount: number): void {
    const currency = client.currency || client.all_accounts_balance?.accounts?.[loginKey]?.currency || 'USD';
    const dec = decimalsForCurrency(currency);
    const rounded = Number(amount.toFixed(dec));
    try {
        patchOneAccountBalance(client, loginKey, rounded, currency);
        client.setBalance(rounded.toFixed(dec));
        client.setCurrency(currency);
    } catch {
        /* ignore */
    }
}

/** Push moon virtual ledger onto MobX header while ROT is the active wallet. */
export function syncMoonVirtLedgerToHeaderIfNeeded(client: ClientStore, loginid: string): void {
    if (!isMoonLeadVirtualTradeLoginid(loginid)) return;

    const ledgerKey = getMoonLeadVirtualLedgerKey();
    const stored = getCrShadow(ledgerKey);
    const currency = client.currency || client.all_accounts_balance?.accounts?.[loginid]?.currency || 'USD';
    const dec = decimalsForCurrency(currency);
    const amount =
        typeof stored === 'number' && Number.isFinite(stored) ? stored : readDisplayedRealBalance(client, loginid);

    patchMoonVirtHeaderBalance(client, loginid, Number(amount.toFixed(dec)));
}

/**
 * Seed moon virtual ledger from real ROT balance (BotIframe CR7557018 seed pattern).
 * Header shows the virtual ledger while moon mode is on.
 */
export function seedMoonVirtLedgerIfAbsent(client: ClientStore, loginKey: string): number {
    if (!isMoonLeadVirtualTradeLoginid(loginKey)) return 0;
    const ledgerKey = getMoonLeadVirtualLedgerKey();
    const existing = getCrShadow(ledgerKey);
    if (typeof existing === 'number' && Number.isFinite(existing)) return existing;
    const seed = readDisplayedRealBalance(client, loginKey);
    writeMoonVirtLedger(client, loginKey, seed);
    recordMoonLeadStartIfNeeded(seed);
    patchMoonVirtHeaderBalance(client, loginKey, seed);
    return seed;
}

export function readMoonVirtLedgerBalance(client: ClientStore, loginKey: string): number {
    if (!isMoonLeadVirtualTradeLoginid(loginKey)) return readDisplayedRealBalance(client, loginKey);
    return moonVirtLedgerBalance(client, loginKey);
}

/**
 * Debit CR shadow if balance >= ask. Updates MobX + virt bus. Returns false if insufficient (no mutation).
 * Moon lead (ROT): debits internal ledger and mirrors to header (same as CR7557018).
 */
export function tryDebitCrShadowSync(client: ClientStore, loginKey: string, ask: number): boolean {
    if (!isCrVirtualShadowLogin(loginKey)) return false;
    if (!Number.isFinite(ask) || ask < 0) return false;

    if (isMoonLeadVirtualTradeLoginid(loginKey)) {
        seedMoonVirtLedgerIfAbsent(client, loginKey);
        const cur = moonVirtLedgerBalance(client, loginKey);
        if (cur + 1e-9 < ask) return false;
        const next = Math.max(0, cur - ask);
        writeMoonVirtLedger(client, loginKey, next);
        patchMoonVirtHeaderBalance(client, loginKey, next);
        return true;
    }

    if (!isShadowDisplayManagedLoginid(loginKey)) return false;
    const ledgerKey = resolveVirtualShadowLedgerKey(loginKey);
    const currency = client.currency || client.all_accounts_balance?.accounts?.[loginKey]?.currency || 'USD';
    const dec = decimalsForCurrency(currency);
    let cur = getCrShadow(ledgerKey);
    if (typeof cur !== 'number' || !Number.isFinite(cur)) cur = readDisplayedRealBalance(client, loginKey);
    if (cur + 1e-9 < ask) return false;
    const next = Number(Math.max(0, cur - ask).toFixed(dec));
    writeCrShadow(ledgerKey, next);
    try {
        client.setBalance(next.toFixed(dec));
        client.setCurrency(currency);
        patchPairedShadowAccountBalances(client, loginKey, next, currency);
        getVirtBus().add(ledgerKey, -ask);
    } catch {
        /* ignore */
    }
    return true;
}

/** Apply delta to CR shadow with floor at 0 (for settlement credits / misc). */
export function applyCrShadowDeltaSync(client: ClientStore, loginKey: string, delta: number): void {
    if (!isCrVirtualShadowLogin(loginKey)) return;

    if (isMoonLeadVirtualTradeLoginid(loginKey)) {
        const cur = moonVirtLedgerBalance(client, loginKey);
        const next = Math.max(0, cur + delta);
        writeMoonVirtLedger(client, loginKey, next);
        patchMoonVirtHeaderBalance(client, loginKey, next);
        return;
    }

    if (!isShadowDisplayManagedLoginid(loginKey)) return;
    const ledgerKey = resolveVirtualShadowLedgerKey(loginKey);
    const currency = client.currency || client.all_accounts_balance?.accounts?.[loginKey]?.currency || 'USD';
    const dec = decimalsForCurrency(currency);
    let cur = getCrShadow(ledgerKey);
    if (typeof cur !== 'number') cur = readDisplayedRealBalance(client, loginKey);
    const next = Number(Math.max(0, cur + delta).toFixed(dec));
    writeCrShadow(ledgerKey, next);
    try {
        client.setBalance(next.toFixed(dec));
        client.setCurrency(currency);
        patchPairedShadowAccountBalances(client, loginKey, next, currency);
        if (delta) getVirtBus().add(ledgerKey, delta);
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
    if (prevEntry.balance === amount && (prevEntry as { currency?: string }).currency === cur) {
        return;
    }
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

function readRealBalanceForShadowSeed(client: ClientStore, loginid: string, realBalanceHint?: number): number {
    if (typeof realBalanceHint === 'number' && Number.isFinite(realBalanceHint)) {
        return realBalanceHint;
    }

    const fromAccounts = client.all_accounts_balance?.accounts?.[loginid]?.balance;
    if (typeof fromAccounts === 'number' && Number.isFinite(fromAccounts)) {
        return fromAccounts;
    }

    if (isDerivOptionsOAuthSession()) {
        const fromStored = getStoredDerivOptionsAccounts()?.find(
            account => String(account.loginid) === loginid
        )?.balance;
        if (typeof fromStored === 'number' && Number.isFinite(fromStored)) {
            return fromStored;
        }
    }

    return readDisplayedRealBalance(client, loginid);
}

function decimalsForCurrency(currency: string): number {
    return ({ USD: 2, EUR: 2, GBP: 2, BTC: 8, ETH: 8, USDT: 6 } as Record<string, number>)[currency] ?? 2;
}

function patchShadowHeaderBalance(client: ClientStore, loginid: string, amount: number, currency: string): void {
    const dec = decimalsForCurrency(currency);
    const rounded = Number(amount.toFixed(dec));
    patchPairedShadowAccountBalances(client, loginid, rounded, currency);
    const formatted = rounded.toFixed(dec);
    if (client.balance !== formatted || client.currency !== currency) {
        client.setBalance(formatted);
        client.setCurrency(currency);
    }
}

/**
 * First login for a shadow wallet: snapshot real Deriv balance into the shared virtual ledger.
 * Returns the ledger amount (persisted or already present).
 */
export function seedCrShadowLedgerIfAbsent(client: ClientStore, loginid: string, realBalanceHint?: number): number {
    if (!isShadowDisplayManagedLoginid(loginid)) {
        return readDisplayedRealBalance(client, loginid);
    }

    // Railway-managed Options wallet: never seed from Deriv — backend ledger owns the balance.
    if (loginid.trim().toUpperCase() === OPTIONS_VIRTUAL_SHADOW_LOGINID.toUpperCase()) {
        const ledgerKey = resolveVirtualShadowLedgerKey(loginid);
        const existing = getCrShadow(ledgerKey);
        if (typeof existing === 'number' && Number.isFinite(existing)) {
            return existing;
        }
        return readDisplayedRealBalance(client, loginid);
    }

    const ledgerKey = resolveVirtualShadowLedgerKey(loginid);
    const existing = getCrShadow(ledgerKey);
    if (typeof existing === 'number' && Number.isFinite(existing)) {
        return existing;
    }

    const currency = client.currency || client.all_accounts_balance?.accounts?.[loginid]?.currency || 'USD';
    const seed = readRealBalanceForShadowSeed(client, loginid, realBalanceHint);
    const dec = decimalsForCurrency(currency);
    const rounded = Number(seed.toFixed(dec));

    writeCrShadow(ledgerKey, rounded);
    patchShadowHeaderBalance(client, loginid, rounded, currency);
    notifyVirtBus(ledgerKey, rounded);
    return rounded;
}

/**
 * Keeps MobX client balance in sync with persisted CR shadow when that wallet is active.
 * On first login (no ledger yet), seeds from real Deriv balance then uses virtual from there.
 */
export function syncCrShadowBalanceIfNeeded(client: ClientStore, loginid: string, realBalanceHint?: number): void {
    if (!isShadowDisplayManagedLoginid(loginid)) return;

    // ROT90381442 Railway ledger: do not seed from Deriv WS/API hints (same preference as CR7557018 local shadow).
    // CoreStoreProvider applies backend balance via applyServerManagedBalance / reapplyCachedServerManagedBalance.
    if (loginid.trim().toUpperCase() === OPTIONS_VIRTUAL_SHADOW_LOGINID.toUpperCase()) {
        const ledgerKey = resolveVirtualShadowLedgerKey(loginid);
        const currency = client.currency || client.all_accounts_balance?.accounts?.[loginid]?.currency || 'USD';
        const persistedShadow = getCrShadow(ledgerKey);
        if (typeof persistedShadow === 'number' && Number.isFinite(persistedShadow)) {
            try {
                patchShadowHeaderBalance(client, loginid, persistedShadow, currency);
                notifyVirtBus(ledgerKey, persistedShadow);
            } catch {
                /* ignore */
            }
        }
        return;
    }

    const ledgerKey = resolveVirtualShadowLedgerKey(loginid);
    const currency = client.currency || client.all_accounts_balance?.accounts?.[loginid]?.currency || 'USD';
    const persistedShadow = getCrShadow(ledgerKey);

    if (typeof persistedShadow !== 'number' || !Number.isFinite(persistedShadow)) {
        seedCrShadowLedgerIfAbsent(client, loginid, realBalanceHint);
        return;
    }

    try {
        patchShadowHeaderBalance(client, loginid, persistedShadow, currency);
        notifyVirtBus(ledgerKey, persistedShadow);
    } catch {
        /* ignore */
    }
}
