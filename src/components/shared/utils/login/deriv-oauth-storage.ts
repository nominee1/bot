import {
    getDenaraOidNumericAppId,
    getDerivOAuthClientId,
    getDerivOptionsRestAppIds,
} from '@/components/shared/utils/config/config';
import {
    authData$,
    setAccountList,
    setAuthData,
    setIsAuthorized,
    setIsAuthorizing,
} from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import type { TAccount, TAuthData } from '@/types/api-types';
import { clearLoggedStateCookie } from './oauth-login-flow';
import { setOAuthUserMessage } from './oauth-user-feedback';

const OPTIONS_ACCOUNTS_URL = 'https://api.derivws.com/trading/v1/options/accounts';
const OPTIONS_LEGACY_ACCOUNTS_URL = 'https://api.derivws.com/trading/v1/options/legacy/accounts';
const OPTIONS_OTP_URL_BASE = 'https://api.derivws.com/trading/v1/options/accounts';

export const DERIV_OAUTH_ACCESS_TOKEN_KEY = 'deriv_oauth_access_token';
export const DERIV_OAUTH_ACCESS_TOKEN_SAVED_AT_KEY = 'deriv_oauth_access_token_saved_at';
export const DERIV_OPTIONS_ACCOUNTS_KEY = 'deriv_options_accounts';
export const DERIV_OPTIONS_LEGACY_LINKS_KEY = 'deriv_options_legacy_links';
export const DERIV_OPTIONS_AUTH_MODE_KEY = 'deriv_options_auth_mode';

export type TDerivOptionsLegacyLink = {
    /** Options / ROT trading account id (visible in Traders Hub). */
    optionsAccountId: string;
    /** Legacy CR loginid used for deposits, withdrawals, and inter-account transfers. */
    crLoginid: string;
    currency: string;
};

export type TDerivOptionsLegacyLinkMap = {
    links: TDerivOptionsLegacyLink[];
    /** ROT (or other Options account_id) → CR loginid */
    optionsToCr: Record<string, string>;
    /** CR loginid → linked Options account ids */
    crToOptions: Record<string, string[]>;
    fetchedAt: number;
};

export type TDerivOptionsAccount = {
    loginid: string;
    currency: string;
    isVirtual: boolean;
    balance: number;
    accountType: string;
    /** Legacy CR wallet for the same real account (funding / transfer_between_accounts). */
    crLoginid?: string;
    raw: Record<string, unknown>;
};

/** Safe string for UI / errors — avoids React rendering `[object Object]`. */
export function stringifyUnknown(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (value instanceof Error) return value.message;
    try {
        return JSON.stringify(value);
    } catch {
        return Object.prototype.toString.call(value);
    }
}

/** Extract Bearer token from Hostinger `token-exchange.php` JSON (or compatible) body. */
export function parseOAuthAccessTokenFromExchangeBody(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const at = (body as Record<string, unknown>).access_token;
    return typeof at === 'string' && at.length > 0 ? at : null;
}

export function getDerivOAuthAccessToken(): string | null {
    try {
        const t = localStorage.getItem(DERIV_OAUTH_ACCESS_TOKEN_KEY);
        return t && t !== 'null' ? t : null;
    } catch {
        return null;
    }
}

export function isDerivOptionsOAuthSession(): boolean {
    try {
        return localStorage.getItem(DERIV_OPTIONS_AUTH_MODE_KEY) === '1' && Boolean(getDerivOAuthAccessToken());
    } catch {
        return false;
    }
}

export function clearDerivOptionsOAuthSession(): void {
    const keys = [
        DERIV_OAUTH_ACCESS_TOKEN_KEY,
        DERIV_OAUTH_ACCESS_TOKEN_SAVED_AT_KEY,
        DERIV_OPTIONS_ACCOUNTS_KEY,
        DERIV_OPTIONS_LEGACY_LINKS_KEY,
        DERIV_OPTIONS_AUTH_MODE_KEY,
    ];
    keys.forEach(k => {
        try {
            localStorage.removeItem(k);
        } catch {
            /* noop */
        }
    });
}

/** Clear stale Options OAuth storage and reset in-memory auth observables (expired token / OTP 401). */
export function invalidateDerivOptionsOAuthSession(userMessage?: string): void {
    clearDerivOptionsOAuthSession();
    try {
        localStorage.removeItem('active_loginid');
    } catch {
        /* noop */
    }
    clearLoggedStateCookie();
    setIsAuthorized(false);
    setIsAuthorizing(false);
    setAuthData(null);
    setAccountList([]);
    void import('@/external/bot-skeleton').then(({ api_base }) => {
        api_base.clearOptionsAccountsCache?.();
    });
    if (userMessage) {
        setOAuthUserMessage(userMessage, 'retry');
    }
}

function derivRestHeaders(accessToken: string, derivAppId?: string): Record<string, string> {
    return {
        Authorization: `Bearer ${accessToken}`,
        'Deriv-App-ID': derivAppId ?? getDerivOAuthClientId(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
}

const isRetryableOptionsAuthFailure = (status: number, bodyText: string) =>
    status === 401 ||
    /invalid\s+or\s+expired\s+token|invalid\s+or\s+missing\s+authentication|unauthorized/i.test(bodyText);

function parseBalance(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const n = parseFloat(value);
        if (Number.isFinite(n)) return n;
    }
    return 0;
}

function isDemoAccountRaw(raw: Record<string, unknown>): boolean {
    const type = String(raw.account_type ?? raw.accountType ?? raw.type ?? '').toLowerCase();
    if (type === 'demo' || type === 'virtual') return true;
    if (raw.is_demo === true || raw.is_demo === 1) return true;
    if (raw.is_virtual === true || raw.is_virtual === 1) return true;
    return false;
}

function isCrLoginid(loginid: string): boolean {
    return /^CR/i.test(String(loginid ?? '').trim());
}

function isOptionsTradingLoginid(loginid: string): boolean {
    const id = String(loginid ?? '').trim();
    return /^(ROT|DOT)/i.test(id);
}

/** Read CR loginid when Deriv includes it on the Options account payload. */
function extractCrLoginidFromOptionsAccountRaw(raw: Record<string, unknown>): string | undefined {
    const candidates = [
        raw.cr_loginid,
        raw.crLoginid,
        raw.legacy_loginid,
        raw.legacyLoginid,
        raw.funding_loginid,
        raw.fundingLoginid,
        raw.transfer_loginid,
        raw.transferLoginid,
        raw.wallet_loginid,
        raw.walletLoginid,
        raw.linked_loginid,
        raw.linkedLoginid,
    ];
    for (const value of candidates) {
        const id = String(value ?? '').trim();
        if (isCrLoginid(id)) return id;
    }

    const linked = raw.linked_to ?? raw.linkedTo;
    if (Array.isArray(linked)) {
        for (const entry of linked) {
            if (!entry || typeof entry !== 'object') continue;
            const row = entry as Record<string, unknown>;
            const id = String(row.loginid ?? row.account_id ?? row.accountId ?? '').trim();
            if (isCrLoginid(id)) return id;
        }
    }

    return undefined;
}

function buildLegacyLinkMap(links: TDerivOptionsLegacyLink[]): TDerivOptionsLegacyLinkMap {
    const optionsToCr: Record<string, string> = {};
    const crToOptions: Record<string, string[]> = {};
    for (const link of links) {
        optionsToCr[link.optionsAccountId] = link.crLoginid;
        if (!crToOptions[link.crLoginid]) crToOptions[link.crLoginid] = [];
        if (!crToOptions[link.crLoginid].includes(link.optionsAccountId)) {
            crToOptions[link.crLoginid].push(link.optionsAccountId);
        }
    }
    return { links, optionsToCr, crToOptions, fetchedAt: Date.now() };
}

function mergeLegacyLinks(...groups: TDerivOptionsLegacyLink[][]): TDerivOptionsLegacyLink[] {
    const byOptions = new Map<string, TDerivOptionsLegacyLink>();
    for (const group of groups) {
        for (const link of group) {
            if (!link.optionsAccountId || !link.crLoginid) continue;
            byOptions.set(link.optionsAccountId, link);
        }
    }
    return [...byOptions.values()];
}

/** Pair ROT + CR wallets that share currency when both appear in GET /options/accounts. */
function linkOptionsAccountsFromAccountList(accounts: TDerivOptionsAccount[]): TDerivOptionsLegacyLink[] {
    const crByCurrency = new Map<string, string>();
    for (const account of accounts) {
        if (account.isVirtual || !isCrLoginid(account.loginid)) continue;
        if (!crByCurrency.has(account.currency)) crByCurrency.set(account.currency, account.loginid);
    }

    const links: TDerivOptionsLegacyLink[] = [];
    for (const account of accounts) {
        if (account.isVirtual || !isOptionsTradingLoginid(account.loginid)) continue;
        const crLoginid = crByCurrency.get(account.currency);
        if (!crLoginid) continue;
        links.push({
            optionsAccountId: account.loginid,
            crLoginid,
            currency: account.currency,
        });
    }
    return links;
}

/**
 * Parse `GET /trading/v1/options/legacy/accounts` — maps legacy CR loginids to Options account_ids.
 * @see https://developers.deriv.com/docs/options-legacy/legacy-accounts
 */
export function parseLegacyAccountsLinksFromBody(body: unknown): TDerivOptionsLegacyLink[] {
    if (!body || typeof body !== 'object') return [];
    const root = body as Record<string, unknown>;
    const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root;
    const loginids = data.loginids;
    if (!loginids || typeof loginids !== 'object') return [];

    const links: TDerivOptionsLegacyLink[] = [];
    for (const [crLoginid, entries] of Object.entries(loginids as Record<string, unknown>)) {
        if (!isCrLoginid(crLoginid) || !Array.isArray(entries)) continue;
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') continue;
            const row = entry as Record<string, unknown>;
            const optionsAccountId = String(row.account_id ?? row.accountId ?? row.id ?? '').trim();
            if (!optionsAccountId) continue;
            links.push({
                optionsAccountId,
                crLoginid: String(crLoginid).trim(),
                currency: String(row.currency ?? row.currency_code ?? 'USD').toUpperCase(),
            });
        }
    }
    return links;
}

export function getStoredDerivOptionsLegacyLinks(): TDerivOptionsLegacyLinkMap | null {
    try {
        const raw = localStorage.getItem(DERIV_OPTIONS_LEGACY_LINKS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as TDerivOptionsLegacyLinkMap;
        if (!parsed || typeof parsed !== 'object' || !parsed.optionsToCr) return null;
        return parsed;
    } catch {
        return null;
    }
}

function persistOptionsLegacyLinks(linkMap: TDerivOptionsLegacyLinkMap) {
    localStorage.setItem(DERIV_OPTIONS_LEGACY_LINKS_KEY, JSON.stringify(linkMap));
}

function attachCrLoginidsToOptionsAccounts(
    accounts: TDerivOptionsAccount[],
    linkMap: TDerivOptionsLegacyLinkMap | null
): TDerivOptionsAccount[] {
    return accounts.map(account => {
        const fromRaw = extractCrLoginidFromOptionsAccountRaw(account.raw);
        const fromMap = linkMap?.optionsToCr[account.loginid];
        const crLoginid = fromRaw || fromMap;
        if (!crLoginid || crLoginid === account.crLoginid) return account;
        return { ...account, crLoginid };
    });
}

/** Resolve CR funding loginid for an active ROT / Options trading account. */
export function getCrLoginidForOptionsAccount(optionsLoginid: string): string | null {
    const id = String(optionsLoginid ?? '').trim();
    if (!id) return null;
    if (isCrLoginid(id)) return id;

    const fromAccount = getStoredDerivOptionsAccounts()?.find(account => account.loginid === id)?.crLoginid;
    if (fromAccount) return fromAccount;

    return getStoredDerivOptionsLegacyLinks()?.optionsToCr[id] ?? null;
}

/** Resolve ROT / Options trading account for a CR funding wallet (first match). */
export function getOptionsLoginidForCrLoginid(crLoginid: string): string | null {
    const id = String(crLoginid ?? '').trim();
    if (!id) return null;
    if (isOptionsTradingLoginid(id)) return id;

    const fromLinks = getStoredDerivOptionsLegacyLinks()?.crToOptions[id]?.[0];
    if (fromLinks) return fromLinks;

    const fromAccount = getStoredDerivOptionsAccounts()?.find(
        account => account.crLoginid === id || account.loginid === id
    );
    if (fromAccount) {
        return isOptionsTradingLoginid(fromAccount.loginid) ? fromAccount.loginid : null;
    }

    return null;
}

/**
 * GET /trading/v1/options/legacy/accounts — discover CR ↔ ROT mapping for funding transfers.
 * Returns null on 404 (no legacy mapping) without failing login.
 */
export async function fetchDerivOptionsLegacyAccountLinks(
    accessToken: string,
    derivAppId?: string
): Promise<TDerivOptionsLegacyLinkMap | null> {
    const appId = derivAppId ?? getDerivOAuthClientId();
    try {
        const res = await fetch(OPTIONS_LEGACY_ACCOUNTS_URL, {
            headers: derivRestHeaders(accessToken, appId),
        });
        const text = await res.text();
        let body: unknown = text;
        try {
            body = JSON.parse(text) as unknown;
        } catch {
            /* keep text */
        }

        if (res.status === 404 || res.status === 409) return null;
        if (!res.ok) return null;

        const links = parseLegacyAccountsLinksFromBody(body);
        if (!links.length) return null;
        return buildLegacyLinkMap(links);
    } catch {
        return null;
    }
}

async function enrichOptionsAccountsWithLegacyLinks(
    accessToken: string,
    accounts: TDerivOptionsAccount[],
    derivAppId?: string
): Promise<TDerivOptionsAccount[]> {
    const legacyMap = await fetchDerivOptionsLegacyAccountLinks(accessToken, derivAppId);
    const mergedLinks = mergeLegacyLinks(legacyMap?.links ?? [], linkOptionsAccountsFromAccountList(accounts));
    const linkMap = mergedLinks.length ? buildLegacyLinkMap(mergedLinks) : legacyMap;
    if (linkMap?.links.length) persistOptionsLegacyLinks(linkMap);
    return attachCrLoginidsToOptionsAccounts(accounts, linkMap);
}

function normalizeOptionsAccount(raw: unknown): TDerivOptionsAccount | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const loginid = String(r.account_id ?? r.accountId ?? r.id ?? r.loginid ?? '').trim();
    if (!loginid) return null;

    const accountType = String(r.account_type ?? r.accountType ?? r.type ?? (isDemoAccountRaw(r) ? 'demo' : 'real'));
    const isVirtual = isDemoAccountRaw(r);
    const currency = String(r.currency ?? r.currency_code ?? 'USD').toUpperCase();
    const crLoginid = extractCrLoginidFromOptionsAccountRaw(r);

    return {
        loginid,
        currency,
        isVirtual,
        balance: parseBalance(r.balance ?? r.balance_amount ?? r.available_balance),
        accountType,
        ...(crLoginid ? { crLoginid } : {}),
        raw: r,
    };
}

function extractAccountsPayload(body: unknown): unknown[] {
    if (!body || typeof body !== 'object') return [];
    const root = body as Record<string, unknown>;

    if (Array.isArray(root.data)) return root.data;
    if (root.data && typeof root.data === 'object') {
        const data = root.data as Record<string, unknown>;
        if (Array.isArray(data.accounts)) return data.accounts;
        if (Array.isArray(data.account_list)) return data.account_list;
    }
    if (Array.isArray(root.accounts)) return root.accounts;
    if (Array.isArray(root.account_list)) return root.account_list;

    return [];
}

/** Parse normalized options accounts from any exchange/API response body shape. */
export function extractNormalizedOptionsAccountsFromBody(body: unknown): TDerivOptionsAccount[] {
    return extractAccountsPayload(body)
        .map(normalizeOptionsAccount)
        .filter((a): a is TDerivOptionsAccount => a !== null);
}

/** GET /trading/v1/options/accounts — demo + real Options accounts for the OAuth Bearer / PAT. */
export async function fetchDerivOptionsAccounts(
    accessToken: string,
    derivAppId?: string
): Promise<{
    ok: true;
    accounts: TDerivOptionsAccount[];
    derivAppId: string;
}> {
    const appId = derivAppId ?? getDerivOAuthClientId();
    const accRes = await fetch(OPTIONS_ACCOUNTS_URL, {
        headers: derivRestHeaders(accessToken, appId),
    });
    const text = await accRes.text();
    let body: unknown = text;
    try {
        body = JSON.parse(text) as unknown;
    } catch {
        /* keep text */
    }

    if (!accRes.ok) {
        const preview = text.length > 320 ? `${text.slice(0, 320)}…` : text;
        throw new Error(`GET /trading/v1/options/accounts → HTTP ${accRes.status} — ${preview}`);
    }

    const accounts = extractAccountsPayload(body)
        .map(normalizeOptionsAccount)
        .filter((a): a is TDerivOptionsAccount => a !== null);

    if (!accounts.length) {
        throw new Error('No Options accounts returned from Deriv API');
    }

    return { ok: true, accounts, derivAppId: appId };
}

/**
 * PAT (`pat_…`) and OAuth Bearer tokens must use the **new** Options app id (OAuth `client_id` / PAT app on developers.deriv.com).
 * Legacy numeric WS ids (71070, …) are not tried here.
 */
export async function fetchDerivOptionsAccountsWithAppIdFallback(accessToken: string): Promise<{
    ok: true;
    accounts: TDerivOptionsAccount[];
    derivAppId: string;
}> {
    const appIds = getDerivOptionsRestAppIds();
    let lastError: Error | null = null;

    for (const appId of appIds) {
        try {
            return await fetchDerivOptionsAccounts(accessToken, appId);
        } catch (e: unknown) {
            const err = e instanceof Error ? e : new Error(String(e ?? 'Options accounts request failed'));
            lastError = err;
            const statusMatch = err.message.match(/HTTP\s+(\d+)/);
            const status = statusMatch ? Number(statusMatch[1]) : 0;
            if (isRetryableOptionsAuthFailure(status, err.message)) {
                continue;
            }
            throw err;
        }
    }

    throw (
        lastError ??
        new Error(
            'Could not verify this token with Deriv Options API. Create the token under the same Deriv app as this site, or use a legacy API token from Deriv → Account → API token.'
        )
    );
}

function toTAccount(account: TDerivOptionsAccount): TAccount {
    const crLoginid = account.crLoginid ?? getCrLoginidForOptionsAccount(account.loginid) ?? undefined;
    return {
        account_category: 'trading',
        account_type: account.isVirtual ? 'demo' : 'real',
        broker: 'deriv',
        created_at: 0,
        currency: account.currency,
        currency_type: 'fiat',
        is_disabled: 0,
        is_virtual: account.isVirtual ? 1 : 0,
        landing_company_name: account.isVirtual ? 'virtual' : 'svg',
        linked_to: crLoginid ? [{ platform: 'cr', loginid: crLoginid }] : [],
        loginid: account.loginid,
    };
}

function pickDefaultOptionsAccount(accounts: TDerivOptionsAccount[]): TDerivOptionsAccount {
    const realUsd = accounts.find(a => !a.isVirtual && a.currency === 'USD');
    if (realUsd) return realUsd;
    const realAny = accounts.find(a => !a.isVirtual);
    if (realAny) return realAny;
    const demoUsd = accounts.find(a => a.isVirtual && a.currency === 'USD');
    if (demoUsd) return demoUsd;
    return accounts[0];
}

function readLoginidFromUrl(): string {
    try {
        return new URLSearchParams(window.location.search).get('loginid')?.trim() ?? '';
    } catch {
        return '';
    }
}

/** Resolve Options active account: URL loginid wins, then stored active_loginid, then real-first default. */
function resolveActiveOptionsAccount(
    stored: TDerivOptionsAccount[],
    options?: { ignoreStoredActive?: boolean }
): TDerivOptionsAccount {
    const fromUrl = readLoginidFromUrl();
    if (fromUrl) {
        const hit = stored.find(a => a.loginid === fromUrl);
        if (hit) return hit;
    }
    if (!options?.ignoreStoredActive) {
        const activeLoginid = localStorage.getItem('active_loginid') ?? '';
        if (activeLoginid) {
            const byStorage = stored.find(a => a.loginid === activeLoginid);
            if (byStorage) return byStorage;
        }
    }
    return pickDefaultOptionsAccount(stored);
}

/** `account` stays human-readable (`demo` / currency); `loginid` disambiguates multi-account same currency. */
export function upsertAccountQueryInBrowser(loginid: string, accountDisplayParam: string, mode: 'push' | 'replace') {
    const url = new URL(window.location.href);
    url.searchParams.set('account', accountDisplayParam);
    url.searchParams.set('loginid', loginid);
    const search = url.searchParams.toString();
    const next = `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
    if (mode === 'replace') window.history.replaceState({}, '', next);
    else window.history.pushState({}, '', next);
}

function buildAuthData(accounts: TDerivOptionsAccount[], active: TDerivOptionsAccount): TAuthData {
    const account_list = accounts.map(toTAccount);
    return {
        account_list,
        balance: active.balance,
        country: '',
        currency: active.currency,
        email: '',
        fullname: '',
        is_virtual: active.isVirtual ? 1 : 0,
        landing_company_fullname: active.isVirtual ? 'Virtual' : 'SVG',
        landing_company_name: active.isVirtual ? 'virtual' : 'svg',
        linked_to: [],
        local_currencies: {},
        loginid: active.loginid,
        preferred_language: 'EN',
        scopes: ['trade', 'account_manage'],
        upgradeable_landing_companies: [],
        user_id: 0,
    };
}

function persistOptionsAccounts(accounts: TDerivOptionsAccount[]) {
    localStorage.setItem(DERIV_OPTIONS_ACCOUNTS_KEY, JSON.stringify(accounts));
    localStorage.setItem(DERIV_OPTIONS_AUTH_MODE_KEY, '1');
}

/** Cached Options accounts from localStorage (balances used to seed header before REST refresh). */
export function getStoredDerivOptionsAccounts(): TDerivOptionsAccount[] | null {
    try {
        const raw = localStorage.getItem(DERIV_OPTIONS_ACCOUNTS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as TDerivOptionsAccount[];
        return Array.isArray(parsed) && parsed.length ? parsed : null;
    } catch {
        return null;
    }
}

/** Legacy `a1-…` tokens must not coexist with Options OAuth — they stall `api_base.authorize`. */
function clearLegacyDerivSessionKeys() {
    ['authToken', 'accountsList', 'clientAccounts'].forEach(key => {
        try {
            localStorage.removeItem(key);
        } catch {
            /* noop */
        }
    });
}

function applyOptionsSessionToApp(
    accounts: TDerivOptionsAccount[],
    active: TDerivOptionsAccount,
    options?: { updateUrl?: boolean }
) {
    clearLegacyDerivSessionKeys();
    const authData = buildAuthData(accounts, active);
    setIsAuthorizing(false);
    setAccountList(authData.account_list);
    setAuthData(authData);
    setIsAuthorized(true);

    localStorage.setItem('active_loginid', active.loginid);

    if (options?.updateUrl === false) return;

    const accountParam = active.isVirtual ? 'demo' : active.currency;
    upsertAccountQueryInBrowser(active.loginid, accountParam, 'replace');
}

/**
 * OAuth2 POST-login outcome for classic DBot:
 * - Bearer is **not** usable as `{ authorize }` on `ws.derivws.com/websockets/v3`.
 * - Options REST + OTP WS: see https://developers.deriv.com/docs/options/get-accounts/
 */
export type TApplyOAuthTokenResult =
    | { ok: true; mode: 'options_oauth'; accounts: TDerivOptionsAccount[]; activeLoginid: string }
    | { ok: false; error: string };

/**
 * Exchange OAuth Bearer for Options accounts and hydrate header / account switcher state.
 */
export async function applyDerivOAuthAccessTokenToFirstUsd(
    accessToken: string,
    prefetchedAccounts?: TDerivOptionsAccount[]
): Promise<TApplyOAuthTokenResult> {
    return applyDerivOptionsTokenAsLead(accessToken, undefined, prefetchedAccounts);
}

/**
 * Log in with an Options PAT/Bearer and set a specific account as header lead (Copytraders new lead).
 */
export async function applyDerivOptionsTokenAsLead(
    accessToken: string,
    preferredLoginid?: string,
    prefetchedAccounts?: TDerivOptionsAccount[]
): Promise<TApplyOAuthTokenResult> {
    try {
        localStorage.setItem('config.app_id', getDenaraOidNumericAppId());
        localStorage.setItem(DERIV_OAUTH_ACCESS_TOKEN_KEY, accessToken);
        localStorage.setItem(DERIV_OAUTH_ACCESS_TOKEN_SAVED_AT_KEY, String(Date.now()));

        let accounts: TDerivOptionsAccount[] | null =
            prefetchedAccounts && prefetchedAccounts.length ? prefetchedAccounts : null;
        try {
            if (!accounts?.length) {
                const fetched = await fetchDerivOptionsAccountsWithAppIdFallback(accessToken);
                accounts = fetched.accounts;
            }
        } catch {
            const stored = getStoredDerivOptionsAccounts();
            if (stored?.length) {
                accounts = stored;
            } else {
                throw new Error('Options accounts fetch failed and no stored session accounts were found');
            }
        }
        if (!accounts?.length) {
            throw new Error('No Options accounts available to hydrate session');
        }

        accounts = await enrichOptionsAccountsWithLegacyLinks(accessToken, accounts);

        const preferred = preferredLoginid?.trim();
        let active: TDerivOptionsAccount;
        if (preferred) {
            const match = accounts.find(a => a.loginid === preferred);
            if (!match) {
                throw new Error(`Options account ${preferred} was not found for this token`);
            }
            if (match.isVirtual) {
                throw new Error('Demo Options accounts cannot be used as lead');
            }
            active = match;
        } else {
            active = resolveActiveOptionsAccount(accounts, { ignoreStoredActive: true });
            if (active.isVirtual) {
                throw new Error('Demo Options accounts cannot be used as lead');
            }
        }

        persistOptionsAccounts(accounts);
        applyOptionsSessionToApp(accounts, active);
        clearLoggedStateCookie();

        return {
            ok: true,
            mode: 'options_oauth',
            accounts,
            activeLoginid: active.loginid,
        };
    } catch (e) {
        return { ok: false, error: stringifyUnknown(e) };
    }
}

/**
 * Synchronous restore for first paint (avoids welcome/loader flash on reload).
 * Uses cached `deriv_options_accounts` only — call {@link restoreDerivOptionsOAuthSessionFromStorage} to refresh from API.
 */
export function restoreDerivOptionsOAuthSessionSync(): boolean {
    const accessToken = getDerivOAuthAccessToken();
    if (!accessToken) return false;

    const stored = getStoredDerivOptionsAccounts();
    if (!stored?.length) return false;

    const active = resolveActiveOptionsAccount(stored);
    applyOptionsSessionToApp(stored, active);
    return true;
}

/** Re-apply Options session from localStorage after a full page reload. */
export async function restoreDerivOptionsOAuthSessionFromStorage(): Promise<TApplyOAuthTokenResult> {
    const accessToken = getDerivOAuthAccessToken();
    if (!accessToken) {
        return { ok: false, error: 'No OAuth access token in storage' };
    }

    const stored = getStoredDerivOptionsAccounts();
    if (stored?.length) {
        const active = resolveActiveOptionsAccount(stored);
        applyOptionsSessionToApp(stored, active);
        return { ok: true, mode: 'options_oauth', accounts: stored, activeLoginid: active.loginid };
    }

    const result = await applyDerivOAuthAccessTokenToFirstUsd(accessToken);
    if (!result.ok) {
        invalidateDerivOptionsOAuthSession('Your session expired. Please log in again.');
    }
    return result;
}

/** Keep cached Options accounts in sync when a live balance stream updates one wallet. */
export function updateStoredOptionsAccountBalance(loginid: string, balance: number, currency?: string): void {
    const stored = getStoredDerivOptionsAccounts();
    if (!stored?.length) return;

    let changed = false;
    const next = stored.map(account => {
        if (account.loginid !== loginid) return account;
        const cur = currency?.trim() || account.currency;
        if (account.balance === balance && account.currency === cur) return account;
        changed = true;
        return { ...account, balance, currency: cur };
    });
    if (changed) persistOptionsAccounts(next);
}

/** Refresh auth header balance for the active Options account without re-running full session setup. */
export function syncOptionsAuthDataBalance(accounts: TDerivOptionsAccount[], activeLoginid: string): void {
    const active = accounts.find(a => a.loginid === activeLoginid);
    if (!active) return;

    const current = authData$.getValue();
    if (!current?.loginid || current.loginid !== active.loginid) return;
    if (current.balance === active.balance && current.currency === active.currency) return;

    setAuthData(buildAuthData(accounts, active));
}

/**
 * GET /trading/v1/options/accounts — refresh demo + real balances for the account switcher.
 * Returns null when offline or the token cannot be verified.
 */
export async function refreshDerivOptionsAccountsFromApi(): Promise<TDerivOptionsAccount[] | null> {
    const accessToken = getDerivOAuthAccessToken();
    if (!accessToken) return null;

    try {
        const { accounts: fetched, derivAppId } = await fetchDerivOptionsAccountsWithAppIdFallback(accessToken);
        if (!fetched?.length) return null;

        const accounts = await enrichOptionsAccountsWithLegacyLinks(accessToken, fetched, derivAppId);
        if (!accounts.length) return null;

        persistOptionsAccounts(accounts);
        const activeLoginid =
            localStorage.getItem('active_loginid')?.trim() ||
            authData$.getValue()?.loginid ||
            resolveActiveOptionsAccount(accounts).loginid;
        syncOptionsAuthDataBalance(accounts, activeLoginid);
        return accounts;
    } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e ?? 'Options accounts refresh failed'));
        const statusMatch = err.message.match(/HTTP\s+(\d+)/);
        const status = statusMatch ? Number(statusMatch[1]) : 0;
        if (isRetryableOptionsAuthFailure(status, err.message)) {
            invalidateDerivOptionsOAuthSession('Your session expired. Please log in again.');
        }
        return null;
    }
}

/** Switch active Options account (demo / real) in the account switcher. */
export async function switchDerivOptionsAccount(loginid: string): Promise<void> {
    const fresh = await refreshDerivOptionsAccountsFromApi();
    const stored = fresh ?? getStoredDerivOptionsAccounts();
    if (!stored?.length) return;

    const next = stored.find(a => a.loginid === loginid);
    if (!next) return;

    applyOptionsSessionToApp(stored, next, { updateUrl: false });

    const { api_base } = await import('@/external/bot-skeleton');
    await api_base.switchOptionsOAuthAccount(loginid);

    upsertAccountQueryInBrowser(next.loginid, next.isVirtual ? 'demo' : next.currency, 'push');
}

export type TFetchOptionsOtpResult = { ok: true; url: string } | { ok: false; unauthorized: boolean };

/** POST /trading/v1/options/accounts/{accountId}/otp — WebSocket URL for trading (short-lived). */
export async function fetchDerivOptionsAccountOtpUrl(
    accessToken: string,
    accountId: string
): Promise<TFetchOptionsOtpResult> {
    try {
        const res = await fetch(`${OPTIONS_OTP_URL_BASE}/${encodeURIComponent(accountId)}/otp`, {
            method: 'POST',
            headers: derivRestHeaders(accessToken),
        });
        const text = await res.text();
        let body: unknown = text;
        try {
            body = JSON.parse(text) as unknown;
        } catch {
            /* noop */
        }
        if (!res.ok) {
            return { ok: false, unauthorized: isRetryableOptionsAuthFailure(res.status, text) };
        }
        if (!body || typeof body !== 'object') return { ok: false, unauthorized: false };
        const data = (body as Record<string, unknown>).data;
        if (data && typeof data === 'object') {
            const url = (data as Record<string, unknown>).url;
            if (typeof url === 'string' && url.length > 0) return { ok: true, url };
        }
        return { ok: false, unauthorized: false };
    } catch {
        return { ok: false, unauthorized: false };
    }
}
