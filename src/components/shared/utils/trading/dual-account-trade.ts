import {
    DERIV_OPTIONS_ACCOUNTS_KEY,
    isDerivOptionsOAuthSession,
    type TDerivOptionsAccount,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import { isVirtualLoginid, pickDefaultActiveLoginAccount } from '@/components/shared/utils/login/pick-default-account';
import { authData$ } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import type { TAccount } from '@/types/api-types';

export const DUAL_ACCOUNT_TRADE_STORAGE_KEY = 'dual_account_trade_enabled';

export type TDualTradePair = {
    demoLoginid: string;
    realLoginid: string;
};

const listeners = new Set<() => void>();

function notifyDualTradeListeners() {
    listeners.forEach(fn => fn());
}

export function subscribeDualAccountTradeEnabled(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function isDualAccountTradeEnabled(): boolean {
    try {
        return localStorage.getItem(DUAL_ACCOUNT_TRADE_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

export function setDualAccountTradeEnabled(enabled: boolean): void {
    try {
        localStorage.setItem(DUAL_ACCOUNT_TRADE_STORAGE_KEY, enabled ? '1' : '0');
    } catch {
        /* noop */
    }
    notifyDualTradeListeners();
}

function readOptionsAccounts(): TDerivOptionsAccount[] {
    try {
        const raw = localStorage.getItem(DERIV_OPTIONS_ACCOUNTS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as TDerivOptionsAccount[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function resolvePairFromLoginids(
    accounts: Array<{ loginid: string; is_virtual?: number | boolean; isVirtual?: boolean }>
): TDualTradePair | null {
    const demoAccounts = accounts.filter(
        a => Boolean(a.isVirtual) || Boolean(a.is_virtual) || isVirtualLoginid(a.loginid)
    );
    const realAccounts = accounts.filter(
        a => !a.isVirtual && !a.is_virtual && !isVirtualLoginid(a.loginid)
    );
    if (!demoAccounts.length || !realAccounts.length) return null;

    const demoPick = pickDefaultActiveLoginAccount(
        demoAccounts.map(a => ({ loginid: a.loginid, currency: (a as { currency?: string }).currency }))
    );
    const realPick = pickDefaultActiveLoginAccount(
        realAccounts.map(a => ({ loginid: a.loginid, currency: (a as { currency?: string }).currency }))
    );
    if (!demoPick?.loginid || !realPick?.loginid) return null;

    return { demoLoginid: demoPick.loginid, realLoginid: realPick.loginid };
}

/** Resolve first real + demo loginids for OAuth and legacy sessions. */
export function resolveDualTradePair(): TDualTradePair | null {
    if (isDerivOptionsOAuthSession()) {
        const options = readOptionsAccounts();
        if (options.length) {
            return resolvePairFromLoginids(
                options.map(a => ({ loginid: a.loginid, isVirtual: a.isVirtual, currency: a.currency }))
            );
        }
    }

    const authList = authData$.getValue()?.account_list;
    if (authList?.length) {
        return resolvePairFromLoginids(authList);
    }

    try {
        const raw = localStorage.getItem('accountsList');
        if (!raw) return null;
        const map = JSON.parse(raw) as Record<string, string>;
        const loginids = Object.keys(map).filter(Boolean);
        if (!loginids.length) return null;
        return resolvePairFromLoginids(loginids.map(loginid => ({ loginid })));
    } catch {
        return null;
    }
}

export function canUseDualAccountTrade(): boolean {
    return resolveDualTradePair() !== null;
}

export function getMirrorLoginid(activeLoginid: string, pair: TDualTradePair | null = resolveDualTradePair()): string | null {
    if (!pair || !activeLoginid) return null;
    if (activeLoginid === pair.demoLoginid) return pair.realLoginid;
    if (activeLoginid === pair.realLoginid) return pair.demoLoginid;
    return null;
}

export function getMirrorLoginidForActive(activeLoginid?: string | null): string | null {
    const active = activeLoginid ?? authData$.getValue()?.loginid ?? localStorage.getItem('active_loginid') ?? '';
    return getMirrorLoginid(active);
}

export function adjustTradeOptionsForLoginid<T extends { currency?: string }>(
    tradeOptions: T,
    loginid: string
): T {
    const accountList: TAccount[] = authData$.getValue()?.account_list ?? [];
    const account = accountList.find(a => a.loginid === loginid);
    if (!account?.currency) return tradeOptions;
    return { ...tradeOptions, currency: account.currency };
}
