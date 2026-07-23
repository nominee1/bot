import { useCallback, useEffect, useMemo, useRef } from 'react';
import Cookies from 'js-cookie';
import { observer } from 'mobx-react-lite';
import { getDecimalPlaces, toMoment } from '@/components/shared';
import { FORM_ERROR_MESSAGES } from '@/components/shared/constants/form-error-messages';
import {
    getStoredDerivOptionsAccounts,
    isDerivOptionsOAuthSession,
    refreshDerivOptionsAccountsFromApi,
    type TDerivOptionsAccount,
    updateStoredOptionsAccountBalance,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import { setOAuthUserMessage, showOAuthToast } from '@/components/shared/utils/login/oauth-user-feedback';
import {
    SESSION_EXPIRED_LOGIN_MESSAGE,
    type TSessionExpiredPayload,
} from '@/components/shared/utils/login/session-expiry';
import { initFormErrorMessages } from '@/components/shared/utils/validation/declarative-validation-rules';
import { api_base } from '@/external/bot-skeleton';
import { authData$ } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { subscribeMoonTrader } from '@/pages/copytraders/copytraders-moon-trader';
import type ClientStore from '@/stores/client-store';
import { TLandingCompany, TSocketResponseData } from '@/types/api-types';
import { shouldSuppressDerivBalanceForServerManaged } from '@/utils/applyServerManagedBalance';
import {
    crShadowBroadcastMatchesWallet,
    crShadowChannel,
    type CrShadowMsg,
    getCrShadow,
    getMoonLeadVirtualLedgerKey,
    isMoonCopyModeActive,
    isMoonLeadVirtualTradeLoginid,
    isShadowDisplayManagedLoginid,
    MOON_COPY_LEAD_LOGINID,
    patchOneAccountBalance,
    resolveVirtualShadowLedgerKey,
    seedCrShadowLedgerIfAbsent,
    shouldSuppressDerivBalanceForMoonLead,
    shouldSuppressDerivBalanceForVirtualShadow,
    syncCrShadowBalanceIfNeeded,
    syncMoonVirtLedgerToHeaderIfNeeded,
    VBAL_SHADOW_KEY,
} from '@/utils/crVirtualBalanceShadow';
import {
    getParallelCopiersForMirror,
    isParallelCopyTradeEnabled,
} from '@/utils/parallel-copiers/parallel-copiers-storage';
import type { Balance } from '@deriv/api-types';
import { useTranslations } from '@deriv-com/translations';

/** Block live Deriv balance merges for virtual shadow wallets — keep header on shared ledger. */
function mergeOneAccountBalance(client: ClientStore, loginid: string, amount: number, currency: string): void {
    if (shouldSuppressDerivBalanceForVirtualShadow(loginid)) {
        syncCrShadowBalanceIfNeeded(client, loginid, amount);
        return;
    }
    if (shouldSuppressDerivBalanceForMoonLead(loginid)) {
        syncMoonVirtLedgerToHeaderIfNeeded(client, loginid);
        return;
    }
    if (shouldSuppressDerivBalanceForServerManaged(loginid)) {
        return;
    }
    patchOneAccountBalance(client, loginid, amount, currency);
}

function mergeOptionsAccountBalances(
    client: ClientStore,
    accounts: TDerivOptionsAccount[],
    allowedLoginids: Set<string>
): void {
    accounts.forEach(account => {
        const loginid = String(account.loginid ?? '');
        if (!allowedLoginids.has(loginid)) return;
        if (shouldSuppressDerivBalanceForVirtualShadow(loginid)) {
            syncCrShadowBalanceIfNeeded(client, loginid, Number(account.balance ?? 0));
            return;
        }
        if (shouldSuppressDerivBalanceForMoonLead(loginid)) {
            syncMoonVirtLedgerToHeaderIfNeeded(client, loginid);
            return;
        }
        if (shouldSuppressDerivBalanceForServerManaged(loginid)) {
            return;
        }
        mergeOneAccountBalance(client, loginid, Number(account.balance ?? 0), account.currency || 'USD');
    });
}

function mergeAllAccountsBalancePayload(client: ClientStore, incoming: Balance): void {
    const incomingAccountsRaw = incoming.accounts ?? {};
    const incomingAccounts: Record<string, NonNullable<Balance['accounts']>[string]> = {
        ...incomingAccountsRaw,
    };
    const shadowIds = Object.keys(incomingAccounts).filter(loginid =>
        shouldSuppressDerivBalanceForVirtualShadow(loginid)
    );
    const managedIds = Object.keys(incomingAccounts).filter(loginid =>
        shouldSuppressDerivBalanceForServerManaged(loginid)
    );
    const shadowRealBalances = new Map<string, number>();
    shadowIds.forEach(loginid => {
        const entry = incomingAccountsRaw[loginid];
        if (entry && typeof entry.balance === 'number' && Number.isFinite(entry.balance)) {
            shadowRealBalances.set(loginid, entry.balance);
        }
        delete incomingAccounts[loginid];
    });
    managedIds.forEach(loginid => {
        delete incomingAccounts[loginid];
    });

    const existingAccounts = client.all_accounts_balance?.accounts ?? {};
    client.setAllAccountsBalance({
        ...incoming,
        accounts: { ...existingAccounts, ...incomingAccounts },
    });

    shadowIds.forEach(loginid => {
        syncCrShadowBalanceIfNeeded(client, loginid, shadowRealBalances.get(loginid));
    });
}

function scheduleDeferredHeaderSync(runSync: () => void, isAuthorizing: boolean): (() => void) | undefined {
    if (isAuthorizing) return undefined;

    const idle =
        typeof requestIdleCallback !== 'undefined'
            ? () => {
                  const id = requestIdleCallback(runSync, { timeout: 4000 });
                  return () => cancelIdleCallback(id);
              }
            : () => {
                  const id = window.setTimeout(runSync, 48);
                  return () => clearTimeout(id);
              };

    let idleCleanup: (() => void) | undefined;
    let raf1 = 0;
    let raf2 = 0;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleIdle = () => {
        idleCleanup = idle();
    };

    if (typeof requestAnimationFrame !== 'undefined') {
        raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(scheduleIdle);
        });
    } else {
        fallbackTimer = window.setTimeout(scheduleIdle, 0);
    }

    return () => {
        if (typeof cancelAnimationFrame !== 'undefined') {
            if (raf1) cancelAnimationFrame(raf1);
            if (raf2) cancelAnimationFrame(raf2);
        }
        if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
        idleCleanup?.();
    };
}

const CoreStoreProvider: React.FC<{ children: React.ReactNode }> = observer(({ children }) => {
    const {
        isAuthorizing,
        isAuthorized,
        connectionStatus,
        accountList,
        activeLoginid,
        authData,
        tradingSocketGeneration,
    } = useApiBase();

    const appInitialization = useRef(false);
    const accountInitialization = useRef(false);
    const timeInterval = useRef<NodeJS.Timeout | null>(null);
    const msg_listener = useRef<{ unsubscribe: () => void } | null>(null);
    const { client, common } = useStore() ?? {};

    const { currentLang } = useTranslations();

    const { oAuthLogout, isOAuth2Enabled } = useOauth2({ handleLogout: async () => client.logout(), client });

    const clientRef = useRef(client);
    clientRef.current = client;
    const oAuthLogoutRef = useRef(oAuthLogout);
    oAuthLogoutRef.current = oAuthLogout;

    const promptExpiredSessionLogout = useCallback(async (reason = SESSION_EXPIRED_LOGIN_MESSAGE) => {
        setOAuthUserMessage(reason, 'retry');
        showOAuthToast(reason, 'warning');
        await oAuthLogoutRef.current();
    }, []);
    const promptExpiredSessionLogoutRef = useRef(promptExpiredSessionLogout);
    promptExpiredSessionLogoutRef.current = promptExpiredSessionLogout;

    useEffect(() => {
        const onSessionExpired = (payload?: TSessionExpiredPayload) => {
            void promptExpiredSessionLogout(payload?.reason);
        };
        globalObserver.register('session.expired', onSessionExpired);
        return () => {
            globalObserver.unregister('session.expired', onSessionExpired);
        };
    }, [promptExpiredSessionLogout]);

    const isLoggedOutCookie = Cookies.get('logged_state') === 'false';

    useEffect(() => {
        // Custom PKCE + Options OAuth must not be undone by a stale Hydra `logged_state=false` cookie.
        if (isLoggedOutCookie && isOAuth2Enabled && client?.is_logged_in && !isDerivOptionsOAuthSession()) {
            oAuthLogout();
        }
    }, [isLoggedOutCookie, oAuthLogout, isOAuth2Enabled, client?.is_logged_in]);

    const activeAccount = useMemo(
        () => accountList?.find(account => account.loginid === activeLoginid),
        [activeLoginid, accountList]
    );

    /** Keep armed Oracle/client copier sockets warm after leaving Copytraders or switching back to lead. */
    useEffect(() => {
        if (!isAuthorized || !activeLoginid || isAuthorizing) return;
        if (!isParallelCopyTradeEnabled()) return;
        if (!getParallelCopiersForMirror(activeLoginid).length) return;
        api_base.prefetchCopierTradingApis();
    }, [isAuthorized, isAuthorizing, activeLoginid, tradingSocketGeneration]);

    useEffect(() => {
        if (!client || !authData?.loginid || typeof authData.balance !== 'number') return;
        const loginid = String(authData.loginid);
        if (shouldSuppressDerivBalanceForVirtualShadow(loginid)) {
            syncCrShadowBalanceIfNeeded(client, loginid, authData.balance);
            return;
        }
        if (shouldSuppressDerivBalanceForMoonLead(loginid)) {
            syncMoonVirtLedgerToHeaderIfNeeded(client, loginid);
            return;
        }
        if (shouldSuppressDerivBalanceForServerManaged(loginid)) {
            return;
        }
        mergeOneAccountBalance(client, loginid, authData.balance, authData.currency || 'USD');
    }, [client, authData?.loginid, authData?.balance, authData?.currency]);

    useEffect(() => {
        if (!client || !isDerivOptionsOAuthSession() || !accountList?.length) return;

        const allowed = new Set(accountList.map(acc => String(acc.loginid)));
        const stored = getStoredDerivOptionsAccounts();
        if (stored?.length) {
            mergeOptionsAccountBalances(client, stored, allowed);
        }
    }, [client, accountList, authData?.loginid]);

    /** Options OAuth: seed shadow ledger once real ROT balance is available (may load after active account). */
    useEffect(() => {
        if (!client || !activeLoginid || !isShadowDisplayManagedLoginid(activeLoginid)) return;
        if (!isDerivOptionsOAuthSession()) return;

        const ledgerKey = resolveVirtualShadowLedgerKey(activeLoginid);
        if (getCrShadow(ledgerKey) !== undefined) return;

        const stored = getStoredDerivOptionsAccounts();
        const cached = stored?.find(account => account.loginid === activeLoginid);
        if (cached && typeof cached.balance === 'number') {
            seedCrShadowLedgerIfAbsent(client, activeLoginid, cached.balance);
            return;
        }

        let cancelled = false;
        void refreshDerivOptionsAccountsFromApi().then(accounts => {
            if (cancelled || !accounts?.length) return;
            const match = accounts.find(account => account.loginid === activeLoginid);
            if (match && typeof match.balance === 'number') {
                seedCrShadowLedgerIfAbsent(client, activeLoginid, match.balance);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [client, activeLoginid, tradingSocketGeneration]);

    useEffect(() => {
        if (!activeAccount?.loginid) return;
        const loginid = activeAccount.loginid;

        const virtHeaderSync = isShadowDisplayManagedLoginid(loginid)
            ? () => {
                  const currentClient = clientRef.current;
                  if (currentClient) syncCrShadowBalanceIfNeeded(currentClient, loginid);
              }
            : isMoonLeadVirtualTradeLoginid(loginid)
              ? () => {
                    const currentClient = clientRef.current;
                    if (currentClient) syncMoonVirtLedgerToHeaderIfNeeded(currentClient, loginid);
                }
              : null;

        if (!virtHeaderSync) return undefined;
        return scheduleDeferredHeaderSync(virtHeaderSync, isAuthorizing);
    }, [activeAccount?.loginid, isAuthorizing]);

    useEffect(() => {
        if (!client || !activeAccount?.loginid) return;
        const loginid = activeAccount.loginid;
        if (isShadowDisplayManagedLoginid(loginid) || isMoonLeadVirtualTradeLoginid(loginid)) return;

        const currentBalanceData = client.all_accounts_balance?.accounts?.[loginid];
        if (
            authData?.loginid === loginid &&
            typeof authData.balance === 'number' &&
            (isAuthorizing || !currentBalanceData)
        ) {
            const cur = authData.currency || 'USD';
            const formatted = authData.balance.toFixed(getDecimalPlaces(cur));
            if (client.balance !== formatted || client.currency !== cur) {
                client.setBalance(formatted);
                client.setCurrency(cur);
            }
        } else if (currentBalanceData) {
            const formatted = currentBalanceData.balance.toFixed(getDecimalPlaces(currentBalanceData.currency));
            if (client.balance !== formatted || client.currency !== currentBalanceData.currency) {
                client.setBalance(formatted);
                client.setCurrency(currentBalanceData.currency);
            }
        }
    }, [
        activeAccount?.loginid,
        client?.all_accounts_balance,
        authData?.balance,
        authData?.currency,
        authData?.loginid,
        client,
        isAuthorizing,
    ]);

    useEffect(() => {
        if (!client || !isDerivOptionsOAuthSession() || !isAuthorized || isAuthorizing || !accountList?.length) {
            return undefined;
        }

        const allowed = new Set(accountList.map(acc => String(acc.loginid)));

        const mergeOptionsBalances = (accounts: TDerivOptionsAccount[]) => {
            mergeOptionsAccountBalances(client, accounts, allowed);
        };

        const stored = getStoredDerivOptionsAccounts();
        if (stored?.length) mergeOptionsBalances(stored);

        void refreshDerivOptionsAccountsFromApi().then(accounts => {
            if (accounts?.length) mergeOptionsBalances(accounts);
        });
    }, [client, isAuthorized, isAuthorizing, accountList, tradingSocketGeneration]);

    useEffect(() => {
        if (!client) return;
        if (!isAuthorized) {
            if (!isAuthorizing) {
                client.setIsLoggedIn(false);
            }
            return;
        }
        if (activeAccount) {
            client?.setLoginId(activeLoginid);
            client?.setAccountList(accountList);
            client?.setIsLoggedIn(true);
        }
    }, [accountList, activeAccount, activeLoginid, client, isAuthorized, isAuthorizing]);

    useEffect(() => {
        initFormErrorMessages(FORM_ERROR_MESSAGES());

        return () => {
            if (timeInterval.current) {
                clearInterval(timeInterval.current);
            }
        };
    }, []);

    useEffect(() => {
        if (common && currentLang) {
            common.setCurrentLanguage(currentLang);
        }
    }, [currentLang, common]);

    useEffect(() => {
        if (client && !isAuthorizing && !appInitialization.current) {
            appInitialization.current = true;

            api_base.api?.websiteStatus().then((res: TSocketResponseData<'website_status'>) => {
                client.setWebsiteStatus(res.website_status);
            });

            // Update server time every 10 seconds
            timeInterval.current = setInterval(() => {
                api_base.api
                    ?.time()
                    .then((res: TSocketResponseData<'time'>) => {
                        common.setServerTime(toMoment(res.time), false);
                    })
                    .catch(() => {
                        common.setServerTime(toMoment(Date.now()), true);
                    });
            }, 10000);
        }
    }, [client, common, isAuthorizing]);

    const handleMessages = useCallback(async (res: Record<string, unknown>) => {
        const currentClient = clientRef.current;
        if (!res || !currentClient) return;
        const envelope = res as { data?: Record<string, unknown> };
        const data = (envelope?.data ?? envelope) as Record<string, unknown>;
        const msg_type = data.msg_type as string | undefined;
        const error = data.error as { code?: string } | undefined;
        const sessionLoginid = authData$.getValue()?.loginid || currentClient.loginid;

        if (
            error?.code === 'AuthorizationRequired' ||
            error?.code === 'DisabledClient' ||
            error?.code === 'InvalidToken'
        ) {
            void promptExpiredSessionLogoutRef.current();
        }

        if (msg_type === 'balance' && data && !error) {
            const rawBalance = data.balance as unknown;

            if (rawBalance && typeof rawBalance === 'object' && 'accounts' in (rawBalance as object)) {
                mergeAllAccountsBalancePayload(currentClient, rawBalance as Balance);
                if (isMoonCopyModeActive()) {
                    syncMoonVirtLedgerToHeaderIfNeeded(currentClient, MOON_COPY_LEAD_LOGINID);
                }
                const accountsMap = (rawBalance as Balance).accounts;
                if (accountsMap) {
                    Object.keys(accountsMap).forEach(loginid => {
                        if (shouldSuppressDerivBalanceForVirtualShadow(loginid)) {
                            syncCrShadowBalanceIfNeeded(currentClient, loginid);
                        }
                    });
                }
                if (isDerivOptionsOAuthSession()) {
                    if (accountsMap) {
                        Object.entries(accountsMap).forEach(([loginid, entry]) => {
                            if (
                                shouldSuppressDerivBalanceForVirtualShadow(loginid) ||
                                shouldSuppressDerivBalanceForMoonLead(loginid) ||
                                shouldSuppressDerivBalanceForServerManaged(loginid)
                            ) {
                                return;
                            }
                            const bal = entry?.balance;
                            if (typeof bal === 'number' && Number.isFinite(bal)) {
                                updateStoredOptionsAccountBalance(loginid, bal, entry?.currency || 'USD');
                            }
                        });
                    }
                }
                return;
            }

            if (
                rawBalance &&
                typeof rawBalance === 'object' &&
                (rawBalance as { loginid?: unknown }).loginid != null &&
                (rawBalance as { balance?: unknown }).balance != null
            ) {
                const b = rawBalance as { loginid: string | number; balance: number; currency?: string };
                const loginKey = String(b.loginid);
                const cur = b.currency || 'USD';
                mergeOneAccountBalance(currentClient, loginKey, Number(b.balance), cur);
                if (
                    isDerivOptionsOAuthSession() &&
                    !shouldSuppressDerivBalanceForVirtualShadow(loginKey) &&
                    !shouldSuppressDerivBalanceForMoonLead(loginKey) &&
                    !shouldSuppressDerivBalanceForServerManaged(loginKey)
                ) {
                    updateStoredOptionsAccountBalance(loginKey, Number(b.balance), cur);
                }
                return;
            }

            const loginidFlat = data.loginid as string | number | undefined;
            let amount: number | undefined;
            if (typeof rawBalance === 'number') {
                amount = rawBalance;
            } else if (typeof rawBalance === 'string') {
                const parsed = parseFloat(rawBalance);
                if (Number.isFinite(parsed)) amount = parsed;
            }
            const cur = (data.currency as string) || 'USD';
            if (loginidFlat != null && amount != null && Number.isFinite(amount)) {
                const loginKey = String(loginidFlat);
                mergeOneAccountBalance(currentClient, loginKey, amount, cur);
                if (
                    isDerivOptionsOAuthSession() &&
                    !shouldSuppressDerivBalanceForVirtualShadow(loginKey) &&
                    !shouldSuppressDerivBalanceForMoonLead(loginKey) &&
                    !shouldSuppressDerivBalanceForServerManaged(loginKey)
                ) {
                    updateStoredOptionsAccountBalance(loginKey, amount, cur);
                }
            }
        }

        if (msg_type === 'transaction' && data && !error) {
            const tx = data.transaction as
                | {
                      balance?: number;
                      balance_after?: number;
                      currency?: string;
                      loginid?: string;
                  }
                | undefined
                | null;
            if (tx && typeof tx === 'object') {
                let bal: number | undefined;
                if (typeof tx.balance === 'number') bal = tx.balance;
                else if (typeof tx.balance === 'string') {
                    const p = parseFloat(tx.balance);
                    if (Number.isFinite(p)) bal = p;
                } else if (typeof tx.balance_after === 'number') bal = tx.balance_after;
                else if (typeof tx.balance_after === 'string') {
                    const p = parseFloat(tx.balance_after);
                    if (Number.isFinite(p)) bal = p;
                }
                if (bal != null && Number.isFinite(bal)) {
                    const cur = (tx.currency as string) || currentClient.currency || 'USD';
                    const loginKey = tx.loginid || sessionLoginid;
                    if (loginKey) {
                        const id = String(loginKey);
                        mergeOneAccountBalance(currentClient, id, bal, cur);
                        if (
                            isDerivOptionsOAuthSession() &&
                            !shouldSuppressDerivBalanceForMoonLead(id) &&
                            !shouldSuppressDerivBalanceForServerManaged(id)
                        ) {
                            updateStoredOptionsAccountBalance(id, bal, cur);
                        }
                    }
                }
            }
        }
    }, []);

    useEffect(() => {
        if (!client || !api_base?.api) return;

        const subscription = api_base.api.onMessage().subscribe(handleMessages);
        msg_listener.current = { unsubscribe: subscription?.unsubscribe };

        return () => {
            subscription?.unsubscribe?.();
            if (msg_listener.current) msg_listener.current = null;
        };
    }, [connectionStatus, client, handleMessages, tradingSocketGeneration]);

    useEffect(() => {
        if (!isAuthorized) {
            accountInitialization.current = false;
        }
    }, [isAuthorized]);

    useEffect(() => {
        if (!client || !activeLoginid || !isShadowDisplayManagedLoginid(activeLoginid)) return;
        if (isAuthorizing) return;

        const onCrChan = (ev: MessageEvent<CrShadowMsg>) => {
            const msg = ev?.data;
            if (!msg || msg.type !== 'cr_shadow') return;
            if (crShadowBroadcastMatchesWallet(activeLoginid, msg.loginid)) {
                syncCrShadowBalanceIfNeeded(client, activeLoginid);
            }
        };

        const onCrStorage = (e: StorageEvent) => {
            if (e.key !== VBAL_SHADOW_KEY) return;
            syncCrShadowBalanceIfNeeded(client, activeLoginid);
        };

        crShadowChannel?.addEventListener?.('message', onCrChan as EventListener);
        window.addEventListener('storage', onCrStorage);
        return () => {
            crShadowChannel?.removeEventListener?.('message', onCrChan as EventListener);
            window.removeEventListener('storage', onCrStorage);
        };
    }, [activeLoginid, client, isAuthorizing]);

    /** Moon lead: header tracks virtual ledger; block Deriv WS from overwriting it. */
    useEffect(() => {
        if (!client || !activeLoginid || !isMoonLeadVirtualTradeLoginid(activeLoginid)) return;
        if (isAuthorizing) return;

        const ledgerKey = getMoonLeadVirtualLedgerKey();
        const syncHeader = () => syncMoonVirtLedgerToHeaderIfNeeded(client, activeLoginid);

        syncHeader();

        const onCrChan = (ev: MessageEvent<CrShadowMsg>) => {
            const msg = ev?.data;
            if (!msg || msg.type !== 'cr_shadow') return;
            if (msg.loginid === ledgerKey || msg.loginid === activeLoginid) syncHeader();
        };

        const onCrStorage = (e: StorageEvent) => {
            if (e.key !== VBAL_SHADOW_KEY) return;
            syncHeader();
        };

        crShadowChannel?.addEventListener?.('message', onCrChan as EventListener);
        window.addEventListener('storage', onCrStorage);
        return () => {
            crShadowChannel?.removeEventListener?.('message', onCrChan as EventListener);
            window.removeEventListener('storage', onCrStorage);
        };
    }, [activeLoginid, client, isAuthorizing]);

    useEffect(() => {
        if (!client || !activeLoginid) return undefined;

        const syncMoonHeader = () => {
            if (isMoonLeadVirtualTradeLoginid(activeLoginid)) {
                syncMoonVirtLedgerToHeaderIfNeeded(client, activeLoginid);
            }
        };

        syncMoonHeader();
        return subscribeMoonTrader(syncMoonHeader);
    }, [client, activeLoginid]);

    useEffect(() => {
        if (!isAuthorizing && isAuthorized && !accountInitialization.current && client) {
            accountInitialization.current = true;

            if (isDerivOptionsOAuthSession()) {
                client.setOptionsOAuthSessionReady();
                return;
            }

            api_base.api.getSettings().then((settingRes: TSocketResponseData<'get_settings'>) => {
                client?.setAccountSettings(settingRes.get_settings);
                api_base.api
                    .landingCompany({
                        landing_company: settingRes.get_settings?.country_code,
                    })
                    .then((res: TSocketResponseData<'landing_company'>) => {
                        client?.setLandingCompany(res.landing_company as unknown as TLandingCompany);
                    });
            });

            api_base.api.getAccountStatus().then((res: TSocketResponseData<'get_account_status'>) => {
                client?.setAccountStatus(res.get_account_status);
            });
        }
    }, [isAuthorizing, isAuthorized, client]);

    return <>{children}</>;
});

export default CoreStoreProvider;
