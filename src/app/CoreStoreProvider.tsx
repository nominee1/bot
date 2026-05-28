import { useCallback, useEffect, useMemo, useRef } from 'react';
import Cookies from 'js-cookie';
import { observer } from 'mobx-react-lite';
import { getDecimalPlaces, toMoment } from '@/components/shared';
import {
    DERIV_OPTIONS_ACCOUNTS_KEY,
    isDerivOptionsOAuthSession,
    type TDerivOptionsAccount,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import { FORM_ERROR_MESSAGES } from '@/components/shared/constants/form-error-messages';
import { initFormErrorMessages } from '@/components/shared/utils/validation/declarative-validation-rules';
import { api_base } from '@/external/bot-skeleton';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import type { Balance } from '@deriv/api-types';
import { TLandingCompany, TSocketResponseData } from '@/types/api-types';
import { useTranslations } from '@deriv-com/translations';
import {
    ALLOWED_BOT_IFRAME_LOGINID,
    crShadowChannel,
    patchOneAccountBalance,
    syncCrShadowBalanceIfNeeded,
    VBAL_SHADOW_KEY,
} from '@/utils/crVirtualBalanceShadow';

const mergeOneAccountBalance = patchOneAccountBalance;

const CoreStoreProvider: React.FC<{ children: React.ReactNode }> = observer(({ children }) => {
    const { isAuthorizing, isAuthorized, connectionStatus, accountList, activeLoginid, authData, tradingSocketGeneration } =
        useApiBase();

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

    useEffect(() => {
        if (!client || !activeAccount?.loginid) return;
        const loginid = activeAccount.loginid;

        if (loginid === ALLOWED_BOT_IFRAME_LOGINID && !loginid.startsWith('VRT')) {
            // Defer shadow sync until auth finishes and after paint — avoids MobX + storage work on the critical path.
            if (isAuthorizing) return;

            const runSync = () => syncCrShadowBalanceIfNeeded(client, loginid);
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

        const currentBalanceData = client.all_accounts_balance?.accounts?.[loginid];
        if (currentBalanceData) {
            client.setBalance(currentBalanceData.balance.toFixed(getDecimalPlaces(currentBalanceData.currency)));
            client.setCurrency(currentBalanceData.currency);
        } else if (authData?.loginid === loginid && typeof authData.balance === 'number') {
            const cur = authData.currency || 'USD';
            client.setBalance(authData.balance.toFixed(getDecimalPlaces(cur)));
            client.setCurrency(cur);
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
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
        if (!client || !authData?.loginid || typeof authData.balance !== 'number') return;
        mergeOneAccountBalance(client, String(authData.loginid), authData.balance, authData.currency || 'USD');
    }, [client, authData?.loginid, authData?.balance, authData?.currency]);

    useEffect(() => {
        if (!client || !isDerivOptionsOAuthSession() || !accountList?.length) return;
        try {
            const raw = localStorage.getItem(DERIV_OPTIONS_ACCOUNTS_KEY);
            if (!raw) return;
            const optionsAccounts = JSON.parse(raw) as TDerivOptionsAccount[];
            if (!Array.isArray(optionsAccounts) || !optionsAccounts.length) return;

            const allowed = new Set(accountList.map(acc => String(acc.loginid)));
            optionsAccounts.forEach(account => {
                const loginid = String(account.loginid ?? '');
                if (!allowed.has(loginid)) return;
                const already = client.all_accounts_balance?.accounts?.[loginid]?.balance;
                if (typeof already === 'number' && Number.isFinite(already)) return;
                mergeOneAccountBalance(client, loginid, Number(account.balance ?? 0), account.currency || 'USD');
            });
        } catch {
            /* noop */
        }
    }, [client, accountList, client?.all_accounts_balance]);

    useEffect(() => {
        if (client && activeAccount) {
            client?.setLoginId(activeLoginid);
            client?.setAccountList(accountList);
            client?.setIsLoggedIn(true);
        }
    }, [accountList, activeAccount, activeLoginid, client]);

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

        if (
            error?.code === 'AuthorizationRequired' ||
            error?.code === 'DisabledClient' ||
            error?.code === 'InvalidToken'
        ) {
            await oAuthLogoutRef.current();
        }

        if (msg_type === 'balance' && data && !error) {
            const rawBalance = data.balance as unknown;

            if (rawBalance && typeof rawBalance === 'object' && 'accounts' in (rawBalance as object)) {
                currentClient.setAllAccountsBalance(rawBalance as Balance);
                return;
            }

            if (
                rawBalance &&
                typeof rawBalance === 'object' &&
                (rawBalance as { loginid?: unknown }).loginid != null &&
                (rawBalance as { balance?: unknown }).balance != null
            ) {
                const b = rawBalance as { loginid: string | number; balance: number; currency?: string };
                mergeOneAccountBalance(
                    currentClient,
                    String(b.loginid),
                    Number(b.balance),
                    b.currency || 'USD'
                );
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
                mergeOneAccountBalance(currentClient, String(loginidFlat), amount, cur);
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
                    const loginKey = tx.loginid || currentClient.loginid;
                    if (loginKey) {
                        mergeOneAccountBalance(currentClient, String(loginKey), bal, cur);
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
        if (!client || activeLoginid !== ALLOWED_BOT_IFRAME_LOGINID || activeLoginid.startsWith('VRT')) return;
        if (isAuthorizing) return;

        const onCrChan = () => {
            syncCrShadowBalanceIfNeeded(client, activeLoginid);
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
