import { initSurvicate } from '../public-path';
import { Fragment, lazy, Suspense } from 'react';
import React from 'react';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router-dom';
import RoutePromptDialog from '@/components/route-prompt-dialog';
import { getDerivTokenExchangeUrl } from '@/components/shared/utils/config/config';
import { api_base } from '@/external/bot-skeleton';
import { V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
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
import { StoreProvider } from '@/hooks/useStore';
import CallbackPage from '@/pages/callback';
import Endpoint from '@/pages/endpoint';
import { initializeI18n, TranslationProvider } from '@deriv-com/translations';
import { URLUtils } from '@deriv-com/utils';
import CoreStoreProvider from './CoreStoreProvider';
import { AuthDebugOverlay, persistAuthDebugFlagFromUrl } from './auth-debug-overlay';
import DevToolsBlockOverlay from './dev-tools-block-overlay';
import ChunkLoader from '@/components/loader/chunk-loader';
import { localize } from '@deriv-com/translations';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './app-root.scss';

const Layout = lazy(() => import('../components/layout'));
const AppRoot = lazy(() => import('./app-root'));

const { TRANSLATIONS_CDN_URL, R2_PROJECT_NAME, CROWDIN_BRANCH_NAME } = process.env;
const i18nInstance = initializeI18n({
    cdnUrl: `${TRANSLATIONS_CDN_URL}/${R2_PROJECT_NAME}/${CROWDIN_BRANCH_NAME}`,
});

const router = createBrowserRouter(
    createRoutesFromElements(
        <Route
            path='/'
            element={
                <Suspense
                    fallback={<ChunkLoader message={localize('Please wait while we connect to the server...')} />}
                >
                    <TranslationProvider defaultLang='EN' i18nInstance={i18nInstance}>
                        <StoreProvider>
                            <RoutePromptDialog />
                            <CoreStoreProvider>
                                <Layout />
                            </CoreStoreProvider>
                        </StoreProvider>
                    </TranslationProvider>
                </Suspense>
            }
        >
            {/* All child routes will be passed as children to Layout */}
            <Route index element={<AppRoot />} />
            <Route path='endpoint' element={<Endpoint />} />
            <Route path='callback' element={<CallbackPage />} />
        </Route>
    )
);

function App() {
    const { loginInfo, paramsToDelete } = URLUtils.getLoginInfoFromURL();
    React.useLayoutEffect(() => {
        persistAuthDebugFlagFromUrl();
    }, []);

    /** Apex callback → www (or canonical) while preserving OAuth query params. */
    React.useLayoutEffect(() => {
        redirectOAuthCallbackToCanonicalOriginIfNeeded();
    }, []);

    /** Re-hydrate Options OAuth before AppContent paints (successive visits / reloads). */
    React.useLayoutEffect(() => {
        if (loginInfo.length) return;
        if (hasOAuthCallbackQuery()) return;

        const legacyToken = V2GetActiveToken();
        if (legacyToken) {
            // Legacy session should always bypass Options OAuth restore/bootstrap paths.
            clearDerivOptionsOAuthSession();
            applyLegacyAccountUrlToStorage();
            return;
        }

        restoreDerivOptionsOAuthSessionSync();
    }, [loginInfo.length]);

    /** Safari bfcache can restore welcome without re-running OAuth exchange. */
    React.useEffect(() => {
        const onPageShow = (event: PageTransitionEvent) => {
            if (!event.persisted) return;
            const params = new URLSearchParams(window.location.search);
            if (!params.has('code')) return;
            if (getDerivOAuthAccessToken()) return;
            window.location.reload();
        };
        window.addEventListener('pageshow', onPageShow);
        return () => window.removeEventListener('pageshow', onPageShow);
    }, []);

    React.useEffect(() => {
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

        try {
            sessionStorage.setItem(
                'denara_oauth_debug_callback',
                JSON.stringify({
                    at: Date.now(),
                    phase: result?.status ?? 'no_oauth_query',
                    ...(result?.status === 'state_mismatch'
                        ? {
                              hasVerifier: result.hasCodeVerifier,
                              stateLen: result.state?.length ?? 0,
                              storedStateLen: result.storedState?.length ?? 0,
                          }
                        : {}),
                    ...(result?.status === 'error' ? { oauthError: result.error } : {}),
                })
            );
        } catch {
            /* noop */
        }

        const reportOAuthFailure = (userMessage: string, debugNote: string) => {
            setOAuthUserMessage(userMessage, 'retry');
            showOAuthToast(userMessage, 'error');
            console.error('[OAuth]', debugNote); // eslint-disable-line no-console
        };

        if (result?.status === 'success') {
            void (async () => {
                try {
                    const payload: Record<string, string> = {
                        code: result.code,
                        redirect_uri: result.redirectUri,
                    };
                    if (result.hasCodeVerifier && result.codeVerifier) {
                        payload.code_verifier = result.codeVerifier;
                    }

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
                        const msg =
                            'Sign-in could not be completed. Check your connection and try logging in again.';
                        reportOAuthFailure(msg, `Token exchange HTTP ${res.status}: ${text?.slice?.(0, 500)}`);
                        return;
                    }
                    if (!accessToken) {
                        const msg = 'Sign-in response was invalid. Please try logging in again.';
                        reportOAuthFailure(msg, `no access_token in body: ${text?.slice?.(0, 500)}`);
                        return;
                    }

                    const prefetchedAccounts = extractNormalizedOptionsAccountsFromBody(body);
                    const hydrate = await applyDerivOAuthAccessTokenToFirstUsd(
                        accessToken,
                        prefetchedAccounts.length ? prefetchedAccounts : undefined
                    );
                    if (!hydrate.ok) {
                        const msg =
                            'Your Deriv account could not be loaded. Please try again or use the same browser tab.';
                        reportOAuthFailure(msg, `Options hydrate failed: ${hydrate.error}`);
                        return;
                    }
                    cleanOAuthParamsFromUrl();
                    await api_base.init(true);
                } catch (e) {
                    const msg = 'Sign-in failed due to a network error. Please try again.';
                    reportOAuthFailure(msg, `Token exchange threw: ${String(e)}`);
                }
            })();
            return;
        }

        if (result?.status === 'state_mismatch') {
            const msg =
                'Login was interrupted (browser storage was cleared). Use the same tab, avoid in-app browsers, and tap Log in again.';
            setOAuthUserMessage(msg, 'retry');
            showOAuthToast(msg, 'warning');
            return;
        }

        if (result?.status === 'error') {
            const desc = result.errorDescription || result.error;
            const msg = desc
                ? `Deriv sign-in was cancelled or failed: ${desc}`
                : 'Deriv sign-in was cancelled or failed. Please try again.';
            setOAuthUserMessage(msg, 'retry');
            showOAuthToast(msg, 'error');
            console.warn('[OAuth] Callback error from Deriv', result); // eslint-disable-line no-console
            cleanOAuthParamsFromUrl();
            return;
        }

        cleanOAuthParamsFromUrl();
    }, []);

    React.useEffect(() => {
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
        // Set login info to local storage and remove params from url
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
            <RouterProvider router={router} />
            <ToastContainer limit={3} draggable={false} />
            <AuthDebugOverlay />
            <DevToolsBlockOverlay />
        </Fragment>
    );
}

export default App;
