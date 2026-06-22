import { useCallback, useEffect, useMemo, useRef } from 'react';
import Cookies from 'js-cookie';
import { observer } from 'mobx-react-lite';
import { getDecimalPlaces, toMoment } from '@/components/shared';
import { FORM_ERROR_MESSAGES } from '@/components/shared/constants/form-error-messages';
import { isBotStudioDeploy } from '@/components/shared/utils/config/config';
import {
    getStoredDerivOptionsAccounts,
    invalidateDerivOptionsOAuthSession,
    isDerivOptionsOAuthSession,
    refreshDerivOptionsAccountsFromApi,
    type TDerivOptionsAccount,
    updateStoredOptionsAccountBalance,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import { initFormErrorMessages } from '@/components/shared/utils/validation/declarative-validation-rules';
import { api_base } from '@/external/bot-skeleton';
import {
    authData$,
    CONNECTION_STATUS,
} from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import useTMB from '@/hooks/useTMB';
import type ClientStore from '@/stores/client-store';
import { TLandingCompany, TSocketResponseData } from '@/types/api-types';
import type { Balance } from '@deriv/api-types';
import { useTranslations } from '@deriv-com/translations';

function mergeOptionsAccountBalances(
    client: ClientStore,
    accounts: TDerivOptionsAccount[],
    allowedLoginids: Set<string>
): void {
    accounts.forEach(account => {
        const loginid = String(account.loginid ?? '');
        if (!allowedLoginids.has(loginid)) return;
        const currentBalanceData = client.all_accounts_balance?.accounts?.[loginid];
        const nextBalance = {
            balance: Number(account.balance ?? 0),
            currency: account.currency || 'USD',
        };
        client.setAllAccountsBalance({
            ...client.all_accounts_balance,
            accounts: {
                ...(client.all_accounts_balance?.accounts ?? {}),
                [loginid]: currentBalanceData ? { ...currentBalanceData, ...nextBalance } : nextBalance,
            },
        } as Balance);
    });
}

type TClientInformation = {
    loginid?: string;
    email?: string;
    currency?: string;
    residence?: string | null;
    first_name?: string;
    last_name?: string;
    preferred_language?: string | null;
    user_id?: number | string;
    landing_company_shortcode?: string;
};
const CoreStoreProvider: React.FC<{ children: React.ReactNode }> = observer(({ children }) => {
    const currentDomain = useMemo(() => '.' + window.location.hostname.split('.').slice(-2).join('.'), []);
    const { isAuthorizing, isAuthorized, connectionStatus, accountList, activeLoginid } = useApiBase();
    const authData = authData$.getValue();

    const appInitialization = useRef(false);
    const accountInitialization = useRef(false);
    const timeInterval = useRef<NodeJS.Timeout | null>(null);
    const msg_listener = useRef<{ unsubscribe: () => void } | null>(null);
    const { client, common } = useStore() ?? {};

    const { currentLang } = useTranslations();

    const { oAuthLogout } = useOauth2({ handleLogout: async () => client.logout(), client });

    const { is_tmb_enabled: tmb_enabled_from_hook } = useTMB();

    const is_tmb_enabled = useMemo(
        () => window.is_tmb_enabled === true || tmb_enabled_from_hook,
        [tmb_enabled_from_hook]
    );

    const isLoggedOutCookie = Cookies.get('logged_state') === 'false' && !is_tmb_enabled;

    useEffect(() => {
        // Bot Studio PKCE + Options OAuth must not be undone by a stale Hydra `logged_state=false` cookie.
        if (isBotStudioDeploy()) return;
        if (isLoggedOutCookie && client?.is_logged_in && !isDerivOptionsOAuthSession()) {
            oAuthLogout();
        }
    }, [isLoggedOutCookie, oAuthLogout, client?.is_logged_in]);

    const activeAccount = useMemo(
        () => accountList?.find(account => account.loginid === activeLoginid),
        [activeLoginid, accountList]
    );

    useEffect(() => {
        if (!client || !isDerivOptionsOAuthSession() || !accountList?.length) return;

        const allowed = new Set(accountList.map(acc => String(acc.loginid)));
        const stored = getStoredDerivOptionsAccounts();
        if (stored?.length) {
            mergeOptionsAccountBalances(client, stored, allowed);
        }
    }, [client, accountList, authData?.loginid]);

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

        const refresh = async () => {
            const accounts = await refreshDerivOptionsAccountsFromApi();
            if (accounts?.length) mergeOptionsBalances(accounts);
        };

        void refresh();
        const intervalId = window.setInterval(() => void refresh(), 12000);
        return () => window.clearInterval(intervalId);
    }, [client, isAuthorized, isAuthorizing, accountList]);

    useEffect(() => {
        const currentBalanceData = client?.all_accounts_balance?.accounts?.[activeAccount?.loginid ?? ''];
        if (currentBalanceData) {
            client?.setBalance(currentBalanceData.balance.toFixed(getDecimalPlaces(currentBalanceData.currency)));
            client?.setCurrency(currentBalanceData.currency);
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeAccount?.loginid, client?.all_accounts_balance]);

    useEffect(() => {
        if (!client) return;
        if (activeAccount) {
            client?.setLoginId(activeLoginid);
            client?.setAccountList(accountList);
            client?.setIsLoggedIn(true);
        } else if (!accountList?.length && !isAuthorizing) {
            client.resetAfterOptionsAuthExpiry();
        }
    }, [accountList, activeAccount, activeLoginid, client, isAuthorizing]);

    useEffect(() => {
        if (!client || isAuthorizing) return;
        if (!isAuthorized && !activeLoginid && client.is_logged_in) {
            client.resetAfterOptionsAuthExpiry();
        }
    }, [client, isAuthorizing, isAuthorized, activeLoginid]);

    useEffect(() => {
        if (!isAuthorized) {
            accountInitialization.current = false;
        }
    }, [isAuthorized]);

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
        const updateServerTime = () => {
            api_base.api
                .time()
                .then((res: TSocketResponseData<'time'>) => {
                    common.setServerTime(toMoment(res.time), false);
                })
                .catch(() => {
                    common.setServerTime(toMoment(Date.now()), true);
                });
        };

        // Clear any existing interval before setting up a new one
        if (timeInterval.current) {
            clearInterval(timeInterval.current);
            timeInterval.current = null;
        }

        // Only setup the interval if the connection is open and we have access to the API
        if (client && connectionStatus === CONNECTION_STATUS.OPENED && api_base?.api) {
            if (!appInitialization.current) {
                appInitialization.current = true;
                api_base.api?.websiteStatus().then((res: TSocketResponseData<'website_status'>) => {
                    client.setWebsiteStatus(res.website_status);
                });
            }

            // Initial time update
            updateServerTime();

            // Schedule updates every 10 seconds
            timeInterval.current = setInterval(updateServerTime, 10000);
        }

        // Cleanup on unmount or dependency change
        return () => {
            if (timeInterval.current) {
                clearInterval(timeInterval.current);
                timeInterval.current = null;
            }
        };
    }, [client, common, is_tmb_enabled, connectionStatus]);

    const handleMessages = useCallback(
        async (res: Record<string, unknown>) => {
            if (!res) return;
            const data = res.data as TSocketResponseData<'balance'>;
            const { msg_type, error } = data;

            if (
                error?.code === 'AuthorizationRequired' ||
                error?.code === 'DisabledClient' ||
                error?.code === 'InvalidToken'
            ) {
                if (isDerivOptionsOAuthSession()) {
                    invalidateDerivOptionsOAuthSession('Your session expired. Please log in again.');
                } else {
                    await oAuthLogout();
                }
            }

            if (msg_type === 'balance' && data && !error) {
                const balance = data.balance;
                if (balance?.accounts) {
                    client.setAllAccountsBalance(balance);
                    if (isDerivOptionsOAuthSession()) {
                        Object.entries(balance.accounts).forEach(([loginid, entry]) => {
                            const bal = entry?.balance;
                            if (typeof bal === 'number' && Number.isFinite(bal)) {
                                updateStoredOptionsAccountBalance(loginid, bal, entry?.currency || 'USD');
                            }
                        });
                    }
                } else if (balance?.loginid) {
                    if (!client?.all_accounts_balance?.accounts || !balance?.loginid) return;
                    const accounts = { ...client.all_accounts_balance.accounts };
                    const currentLoggedInBalance = { ...accounts[balance.loginid] };
                    currentLoggedInBalance.balance = balance.balance;

                    const updatedAccounts = {
                        ...client.all_accounts_balance,
                        accounts: {
                            ...client.all_accounts_balance.accounts,
                            [balance.loginid]: currentLoggedInBalance,
                        },
                    };
                    client.setAllAccountsBalance(updatedAccounts);
                    if (isDerivOptionsOAuthSession()) {
                        updateStoredOptionsAccountBalance(
                            String(balance.loginid),
                            Number(balance.balance),
                            balance.currency || 'USD'
                        );
                    }
                }
            }
        },
        [client, oAuthLogout]
    );

    useEffect(() => {
        if (!isAuthorizing && client) {
            const subscription = api_base?.api?.onMessage().subscribe(handleMessages);
            msg_listener.current = { unsubscribe: subscription?.unsubscribe };
        }

        return () => {
            if (msg_listener.current) {
                msg_listener.current.unsubscribe?.();
            }
        };
    }, [connectionStatus, handleMessages, isAuthorizing, isAuthorized, client]);

    useEffect(() => {
        if (!isAuthorizing && isAuthorized && !accountInitialization.current && client) {
            accountInitialization.current = true;

            if (isDerivOptionsOAuthSession()) {
                client.setOptionsOAuthSessionReady();
                return;
            }

            api_base.api.getSettings().then((settingRes: TSocketResponseData<'get_settings'>) => {
                client?.setAccountSettings(settingRes.get_settings);
                const client_information: TClientInformation = {
                    loginid: activeAccount?.loginid,
                    email: settingRes.get_settings?.email,
                    currency: client?.currency,
                    residence: settingRes.get_settings?.residence,
                    first_name: settingRes.get_settings?.first_name,
                    last_name: settingRes.get_settings?.last_name,
                    preferred_language: settingRes.get_settings?.preferred_language,
                    user_id: ((api_base.account_info as any)?.user_id as number) || activeLoginid,
                    landing_company_shortcode: activeAccount?.landing_company_name,
                };

                Cookies.set('client_information', JSON.stringify(client_information), {
                    domain: currentDomain,
                });

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
