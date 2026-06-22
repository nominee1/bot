import { initSurvicate } from '../public-path';
import { Fragment, lazy, Suspense } from 'react';
import React from 'react';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import ChunkLoader from '@/components/loader/chunk-loader';
import RoutePromptDialog from '@/components/route-prompt-dialog';
import { crypto_currencies_display_order, fiat_currencies_display_order } from '@/components/shared';
import {
    getDenaraOidNumericAppId,
    getDerivOAuthClientId,
    getDerivTokenExchangeUrl,
    hasBotStudioOAuthConfig,
} from '@/components/shared/utils/config/config';
import {
    applyDerivOAuthAccessTokenToFirstUsd,
    clearDerivOptionsOAuthSession,
    extractNormalizedOptionsAccountsFromBody,
    getDerivOAuthAccessToken,
    parseOAuthAccessTokenFromExchangeBody,
    restoreDerivOptionsOAuthSessionFromStorage,
    restoreDerivOptionsOAuthSessionSync,
    upsertAccountQueryInBrowser,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import { applyLegacyAccountUrlToStorage } from '@/components/shared/utils/login/legacy-account-url-sync';
import { handleDerivOAuthCallback } from '@/components/shared/utils/login/login';
import {
    hasOAuthCallbackQuery,
    redirectOAuthCallbackToCanonicalOriginIfNeeded,
} from '@/components/shared/utils/login/oauth-login-flow';
import {
    consumeOAuthUserMessage,
    setOAuthUserMessage,
    showOAuthToast,
} from '@/components/shared/utils/login/oauth-user-feedback';
import { pickDefaultActiveLoginAccount } from '@/components/shared/utils/login/pick-default-account';
import { api_base } from '@/external/bot-skeleton';
import { V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { useOfflineDetection } from '@/hooks/useOfflineDetection';
import { StoreProvider } from '@/hooks/useStore';
import CallbackPage from '@/pages/callback';
import Endpoint from '@/pages/endpoint';
import { TAuthData } from '@/types/api-types';
import { initializeI18n, localize, TranslationProvider } from '@deriv-com/translations';
import { URLUtils } from '@deriv-com/utils';
import CoreStoreProvider from './CoreStoreProvider';
import OAuthAccountSetupOverlay from './oauth-account-setup-overlay';
import 'react-toastify/dist/ReactToastify.css';
import './app-root.scss';

const Layout = lazy(() => import('../components/layout'));
const AppRoot = lazy(() => import('./app-root'));

const { TRANSLATIONS_CDN_URL, R2_PROJECT_NAME, CROWDIN_BRANCH_NAME } = process.env;
const i18nInstance = initializeI18n({
    cdnUrl: `${TRANSLATIONS_CDN_URL}/${R2_PROJECT_NAME}/${CROWDIN_BRANCH_NAME}`,
});

const SuspenseWrapper = ({ children }: { children: React.ReactNode }) => {
    const { isOnline } = useOfflineDetection();

    const getLoadingMessage = () => {
        if (!isOnline) return localize('Loading offline dashboard...');
        return localize('Please wait while we connect to the server...');
    };

    return <Suspense fallback={<ChunkLoader message={getLoadingMessage()} />}>{children}</Suspense>;
};

const router = createBrowserRouter(
    createRoutesFromElements(
        <Route
            path='/'
            element={
                <SuspenseWrapper>
                    <TranslationProvider defaultLang='EN' i18nInstance={i18nInstance}>
                        <StoreProvider>
                            <RoutePromptDialog />
                            <CoreStoreProvider>
                                <Layout />
                            </CoreStoreProvider>
                        </StoreProvider>
                    </TranslationProvider>
                </SuspenseWrapper>
            }
        >
            <Route index element={<AppRoot />} />
            <Route path='endpoint' element={<Endpoint />} />
            <Route path='callback' element={<CallbackPage />} />
        </Route>
    )
);

function App() {
    const { loginInfo, paramsToDelete } = URLUtils.getLoginInfoFromURL();
    const [is_oauth_account_setup, setIsOAuthAccountSetup] = React.useState(() => {
        if (typeof window === 'undefined') return false;
        return hasBotStudioOAuthConfig() && hasOAuthCallbackQuery();
    });

    React.useLayoutEffect(() => {
        redirectOAuthCallbackToCanonicalOriginIfNeeded();
    }, []);

    React.useLayoutEffect(() => {
        if (!hasBotStudioOAuthConfig()) return;
        if (loginInfo.length) return;
        if (hasOAuthCallbackQuery()) return;

        const legacyToken = V2GetActiveToken();
        if (legacyToken) {
            clearDerivOptionsOAuthSession();
            applyLegacyAccountUrlToStorage();
            return;
        }

        restoreDerivOptionsOAuthSessionSync();
    }, [loginInfo.length]);

    React.useEffect(() => {
        if (!hasBotStudioOAuthConfig()) return;

        const cleanOAuthParamsFromUrl = () => {
            const url = new URL(window.location.href);
            const had =
                url.searchParams.has('code') ||
                url.searchParams.has('state') ||
                url.searchParams.has('error') ||
                url.searchParams.has('error_description');
            if (!had) return;
            url.searchParams.delete('code');
            url.searchParams.delete('state');
            url.searchParams.delete('scope');
            url.searchParams.delete('error');
            url.searchParams.delete('error_description');
            const search = url.searchParams.toString();
            window.history.replaceState({}, '', `${url.pathname}${search ? `?${search}` : ''}${url.hash}`);
        };

        const result = handleDerivOAuthCallback();

        const reportOAuthFailure = (userMessage: string, debugNote: string) => {
            setOAuthUserMessage(userMessage, 'retry');
            showOAuthToast(userMessage, 'error');
            console.error('[OAuth]', debugNote); // eslint-disable-line no-console
        };

        if (result?.status === 'success') {
            setIsOAuthAccountSetup(true);
            void (async () => {
                try {
                    const payload: Record<string, string> = {
                        code: result.code,
                        redirect_uri: result.redirectUri,
                    };
                    if (result.hasCodeVerifier && result.codeVerifier) {
                        payload.code_verifier = result.codeVerifier;
                    }
                    const oauthClientId = getDerivOAuthClientId();
                    const wsAppId = getDenaraOidNumericAppId();
                    if (oauthClientId) payload.oauth_client_id = oauthClientId;
                    if (wsAppId) payload.ws_app_id = wsAppId;

                    const res = await fetch(getDerivTokenExchangeUrl(), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    const text = await res.text();
                    let body: unknown = text;
                    try {
                        body = JSON.parse(text) as unknown;
                    } catch {
                        /* leave as string */
                    }
                    const accessToken = parseOAuthAccessTokenFromExchangeBody(body);

                    if (!res.ok) {
                        reportOAuthFailure(
                            'Sign-in could not be completed. Check your connection and try logging in again.',
                            `Token exchange HTTP ${res.status}: ${text?.slice?.(0, 500)}`
                        );
                        cleanOAuthParamsFromUrl();
                        return;
                    }
                    if (!accessToken) {
                        reportOAuthFailure(
                            'Sign-in response was invalid. Please try logging in again.',
                            `no access_token in body: ${text?.slice?.(0, 500)}`
                        );
                        cleanOAuthParamsFromUrl();
                        return;
                    }

                    const prefetchedAccounts = extractNormalizedOptionsAccountsFromBody(body);
                    const hydrate = await applyDerivOAuthAccessTokenToFirstUsd(
                        accessToken,
                        prefetchedAccounts.length ? prefetchedAccounts : undefined
                    );
                    if (!hydrate.ok) {
                        reportOAuthFailure(
                            'Your Deriv account could not be loaded. Please try again or use the same browser tab.',
                            `Options hydrate failed: ${hydrate.error}`
                        );
                        cleanOAuthParamsFromUrl();
                        return;
                    }
                    cleanOAuthParamsFromUrl();
                    await api_base.init(true);
                } catch (e) {
                    const isFetchBlocked =
                        e instanceof TypeError &&
                        /failed to fetch|networkerror|load failed/i.test(String(e.message ?? e));
                    reportOAuthFailure(
                        isFetchBlocked
                            ? 'Sign-in could not reach the Deriv Sites token server. Redeploy from Deriv Sites (production URL) and try logging in again.'
                            : 'Sign-in failed due to a network error. Please try again.',
                        `Token exchange threw: ${String(e)}`
                    );
                    cleanOAuthParamsFromUrl();
                } finally {
                    setIsOAuthAccountSetup(false);
                }
            })();
            return;
        }

        if (result?.status === 'state_mismatch') {
            setIsOAuthAccountSetup(false);
            const msg =
                'Login was interrupted (browser storage was cleared). Use the same tab, avoid in-app browsers, and tap Log in again.';
            setOAuthUserMessage(msg, 'retry');
            showOAuthToast(msg, 'warning');
            cleanOAuthParamsFromUrl();
            return;
        }

        if (result?.status === 'error') {
            setIsOAuthAccountSetup(false);
            const desc = result.errorDescription || result.error;
            const msg = desc
                ? `Deriv sign-in was cancelled or failed: ${desc}`
                : 'Deriv sign-in was cancelled or failed. Please try again.';
            setOAuthUserMessage(msg, 'retry');
            showOAuthToast(msg, 'error');
            cleanOAuthParamsFromUrl();
            return;
        }

        if (hasOAuthCallbackQuery()) {
            setIsOAuthAccountSetup(false);
        }
        cleanOAuthParamsFromUrl();
    }, []);

    React.useEffect(() => {
        if (!hasBotStudioOAuthConfig()) return;
        if (loginInfo.length) return;
        if (V2GetActiveToken()) return;
        if (!getDerivOAuthAccessToken()) return;

        void restoreDerivOptionsOAuthSessionFromStorage().then(async result => {
            if (result.ok) {
                await api_base.init(true);
            } else if (import.meta.env.DEV) {
                console.warn('[OAuth] Options session refresh failed:', result.error); // eslint-disable-line no-console
            }
        });
    }, [loginInfo.length]);

    React.useEffect(() => {
        if (hasBotStudioOAuthConfig()) {
            if (loginInfo.length) {
                clearDerivOptionsOAuthSession();
                try {
                    const active = pickDefaultActiveLoginAccount(loginInfo) ?? loginInfo[0];
                    if (!active?.loginid || !active?.token) return;

                    const accountsList: Record<string, string> = {};
                    const clientAccounts: Record<string, { loginid: string; token: string; currency: string }> = {};

                    loginInfo.forEach((account: { loginid: string; token: string; currency: string }) => {
                        accountsList[account.loginid] = account.token;
                        clientAccounts[account.loginid] = account;
                    });

                    localStorage.setItem('accountsList', JSON.stringify(accountsList));
                    localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));

                    URLUtils.filterSearchParams(paramsToDelete);

                    localStorage.setItem('authToken', active.token);
                    localStorage.setItem('active_loginid', active.loginid);

                    const account_param = active.loginid.startsWith('VR') ? 'demo' : active.currency || 'USD';
                    upsertAccountQueryInBrowser(String(active.loginid), account_param, 'replace');
                } catch (error) {
                    console.error('Error setting up login info:', error);
                }
            }

            URLUtils.filterSearchParams(['lang']);
            return;
        }

        const accounts_list = localStorage.getItem('accountsList');
        const client_accounts = localStorage.getItem('clientAccounts');
        const url_params = new URLSearchParams(window.location.search);
        const account_currency = url_params.get('account');
        const validCurrencies = [...fiat_currencies_display_order, ...crypto_currencies_display_order];

        const is_valid_currency = account_currency && validCurrencies.includes(account_currency?.toUpperCase());

        if (!accounts_list || !client_accounts) return;

        try {
            const parsed_accounts = JSON.parse(accounts_list);
            const parsed_client_accounts = JSON.parse(client_accounts) as TAuthData['account_list'];

            const updateLocalStorage = (token: string, loginid: string) => {
                localStorage.setItem('authToken', token);
                localStorage.setItem('active_loginid', loginid);
            };

            if (account_currency?.toUpperCase() === 'DEMO') {
                const demo_account = Object.entries(parsed_accounts).find(([key]) => key.startsWith('VR'));

                if (demo_account) {
                    const [loginid, token] = demo_account;
                    updateLocalStorage(String(token), loginid);
                }
            } else if (account_currency?.toUpperCase() !== 'DEMO' && is_valid_currency) {
                const real_account = Object.entries(parsed_client_accounts).find(
                    ([loginid, account]) =>
                        !loginid.startsWith('VR') && account.currency.toUpperCase() === account_currency?.toUpperCase()
                );

                if (real_account) {
                    const [loginid, account] = real_account;
                    if ('token' in account) {
                        updateLocalStorage(String(account?.token), loginid);
                    }
                }
            }
        } catch (e) {
            console.warn('Error', e); // eslint-disable-line no-console
        }
    }, [loginInfo, paramsToDelete]);

    React.useEffect(() => {
        const oauthNotice = consumeOAuthUserMessage();
        if (oauthNotice?.message) {
            showOAuthToast(oauthNotice.message, oauthNotice.action === 'retry' ? 'warning' : 'error');
        }
    }, []);

    React.useEffect(() => {
        initSurvicate();
        window?.dataLayer?.push({ event: 'page_load' });
        return () => {
            const survicate_box = document.getElementById('survicate-box');
            if (survicate_box) {
                survicate_box.style.display = 'none';
            }
        };
    }, []);

    return (
        <Fragment>
            {is_oauth_account_setup ? <OAuthAccountSetupOverlay /> : null}
            <RouterProvider router={router} />
            {hasBotStudioOAuthConfig() ? <ToastContainer limit={3} draggable={false} /> : null}
        </Fragment>
    );
}

export default App;
