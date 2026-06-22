import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { ToastContainer } from 'react-toastify';
import AuthLoadingWrapper from '@/components/auth-loading-wrapper';
import useLiveChat from '@/components/chat/useLiveChat';
import { BOT_RESTRICTED_COUNTRIES_LIST } from '@/components/layout/header/utils';
import ChunkLoader from '@/components/loader/chunk-loader';
import MigrationModal from '@/components/migration-modal';
import PWAInstallModal from '@/components/pwa-install-modal';
import { getUrlBase } from '@/components/shared';
import { isDerivOptionsOAuthSession } from '@/components/shared/utils/login/deriv-oauth-storage';
import TncStatusUpdateModal from '@/components/tnc-status-update-modal';
import TransactionDetailsModal from '@/components/transaction-details';
import { api_base, ApiHelpers, ServerTime } from '@/external/bot-skeleton';
import { V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import useIntercom from '@/hooks/useIntercom';
import { useOfflineDetection } from '@/hooks/useOfflineDetection';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import useTrackjs from '@/hooks/useTrackjs';
import initDatadog from '@/utils/datadog';
import initHotjar from '@/utils/hotjar';
import { setSmartChartsPublicPath } from '@deriv/deriv-charts';
import { ThemeProvider } from '@deriv-com/quill-ui';
import { localize } from '@deriv-com/translations';
import Audio from '../components/audio';
import BlocklyLoading from '../components/blockly-loading';
import BotStopped from '../components/bot-stopped';
import BotBuilder from '../pages/bot-builder';
import Main from '../pages/main';
import './app.scss';
import 'react-toastify/dist/ReactToastify.css';
import '../components/bot-notification/bot-notification.scss';

const AppContent = observer(() => {
    const [is_api_initialized, setIsApiInitialized] = React.useState(false);
    const [is_loading, setIsLoading] = React.useState(true);
    const [is_eu_error_loading, setIsEuErrorLoading] = React.useState(true);
    const [offline_timeout, setOfflineTimeout] = React.useState(null);
    const store = useStore();
    const { app, transactions, common, client } = store;
    const { showDigitalOptionsMaltainvestError } = app;
    const { is_dark_mode_on } = useThemeSwitcher();
    const { isOnline } = useOfflineDetection();

    const { recovered_transactions, recoverPendingContracts } = transactions;
    const is_subscribed_to_msg_listener = React.useRef(false);
    const msg_listener = React.useRef(null);
    const { connectionStatus, isAuthorizing, isAuthorized, activeLoginid } = useApiBase();
    const { initTrackJS } = useTrackjs();

    initTrackJS(client.loginid);

    const livechat_client_information = {
        is_client_store_initialized: client?.is_logged_in ? !!client?.account_settings?.email : !!client,
        is_logged_in: client?.is_logged_in,
        loginid: client?.loginid,
        landing_company_shortcode: client?.landing_company_shortcode,
        currency: client?.currency,
        residence: client?.residence,
        email: client?.account_settings?.email,
        first_name: client?.account_settings?.first_name,
        last_name: client?.account_settings?.last_name,
    };

    useLiveChat(livechat_client_information);

    const token = V2GetActiveToken() ?? null;
    useIntercom(token);

    useEffect(() => {
        if (connectionStatus === CONNECTION_STATUS.OPENED) {
            setIsApiInitialized(true);
            common.setSocketOpened(true);
            // Clear offline timeout if connection is restored
            if (offline_timeout) {
                clearTimeout(offline_timeout);
                setOfflineTimeout(null);
            }
        } else if (!isAuthorizing && !isAuthorized) {
            // Expired Options OAuth or logged-out classic session — socket never opens; still show dashboard.
            common.setSocketOpened(false);
            setIsApiInitialized(true);
            setIsLoading(false);
        } else if (connectionStatus !== CONNECTION_STATUS.OPENED) {
            common.setSocketOpened(false);
        }
    }, [common, connectionStatus, offline_timeout, isAuthorizing, isAuthorized]);

    // Handle offline scenarios - don't wait indefinitely for API
    useEffect(() => {
        if (!isOnline && is_loading) {
            console.log('[Offline] Detected offline state, setting timeout to show dashboard');
            const timeout = setTimeout(() => {
                console.log('[Offline] Timeout reached, showing dashboard in offline mode');
                setIsLoading(false);
                setIsApiInitialized(true);
                // Initialize basic stores for offline mode
                if (!app.dbot_store) {
                    init();
                }
            }, 3000); // Wait 3 seconds for potential connection, then show dashboard

            setOfflineTimeout(timeout);
        } else if (isOnline && offline_timeout) {
            // Clear timeout if we come back online
            clearTimeout(offline_timeout);
            setOfflineTimeout(null);
        }

        return () => {
            if (offline_timeout) {
                clearTimeout(offline_timeout);
            }
        };
    }, [isOnline, is_loading, offline_timeout, app.dbot_store]);

    const { current_language } = common;
    const html = document.documentElement;
    React.useEffect(() => {
        html?.setAttribute('lang', current_language.toLowerCase());
        html?.setAttribute('dir', current_language.toLowerCase() === 'ar' ? 'rtl' : 'ltr');
    }, [current_language, html]);

    // Check for EU client error early
    const is_eu_country = client?.is_eu_country;
    const clients_logged_out_country_code = client?.clients_country;
    const clients_logged_in_country_code = client?.account_settings?.country_code;
    const is_client_logged_in = client?.is_logged_in;

    useEffect(() => {
        const bot_restricted_countries = BOT_RESTRICTED_COUNTRIES_LIST();

        if (!client.is_logged_in) {
            // For logged out users
            if (clients_logged_out_country_code) {
                const is_restricted = !!bot_restricted_countries[clients_logged_out_country_code];
                setIsEuErrorLoading(client.is_eu_country && is_restricted);
            }
        } else {
            // For logged in users
            if (clients_logged_in_country_code) {
                const is_restricted = !!bot_restricted_countries[clients_logged_in_country_code];
                setIsEuErrorLoading(is_restricted);
            }
        }
    }, [is_eu_country, clients_logged_out_country_code, clients_logged_in_country_code, is_client_logged_in]);

    const handleMessage = React.useCallback(
        ({ data }) => {
            if (data?.msg_type === 'proposal_open_contract' && !data?.error) {
                const { proposal_open_contract } = data;
                if (
                    proposal_open_contract?.status !== 'open' &&
                    !recovered_transactions?.includes(proposal_open_contract?.contract_id)
                ) {
                    recoverPendingContracts(proposal_open_contract);
                }
            }
        },
        [recovered_transactions, recoverPendingContracts]
    );

    React.useEffect(() => {
        setSmartChartsPublicPath(getUrlBase('/js/smartcharts/'));
    }, []);

    React.useEffect(() => {
        const optionsOAuth = isDerivOptionsOAuthSession();
        const sessionLoggedIn = client.is_logged_in || (optionsOAuth && Boolean(activeLoginid));

        if (!is_subscribed_to_msg_listener.current && sessionLoggedIn && is_api_initialized && api_base?.api) {
            is_subscribed_to_msg_listener.current = true;
            msg_listener.current = api_base.api.onMessage()?.subscribe(handleMessage);
        }
        return () => {
            if (is_subscribed_to_msg_listener.current && msg_listener.current) {
                is_subscribed_to_msg_listener.current = false;
                msg_listener.current.unsubscribe?.();
            }
        };
    }, [activeLoginid, is_api_initialized, client.is_logged_in, client.loginid, handleMessage, connectionStatus]);

    React.useEffect(() => {
        showDigitalOptionsMaltainvestError(client, common);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client.is_options_blocked, client.account_settings?.country_code, client.clients_country]);

    const init = () => {
        ServerTime.init(common);
        app.setDBotEngineStores();
        ApiHelpers.setInstance(app.api_helpers_store);
        import('@/utils/gtm').then(({ default: GTM }) => {
            GTM.init(store);
        });
    };

    const changeActiveSymbolLoadingState = () => {
        init();

        const optionsOAuth = isDerivOptionsOAuthSession();
        const LOADER_CAP_MS = optionsOAuth ? 10000 : 0;
        let loaderCapTimer = null;

        const finishLoading = () => {
            if (loaderCapTimer) {
                clearTimeout(loaderCapTimer);
                loaderCapTimer = null;
            }
            setIsLoading(false);
        };

        if (LOADER_CAP_MS > 0) {
            loaderCapTimer = setTimeout(finishLoading, LOADER_CAP_MS);
        }

        const retrieveActiveSymbols = () => {
            const { active_symbols } = ApiHelpers.instance;

            if (!isOnline) {
                finishLoading();
                return;
            }

            active_symbols.retrieveActiveSymbols(true).then(finishLoading).catch(finishLoading);
        };

        if (ApiHelpers?.instance?.active_symbols) {
            retrieveActiveSymbols();
        } else {
            const intervalId = setInterval(() => {
                if (ApiHelpers?.instance?.active_symbols) {
                    clearInterval(intervalId);
                    retrieveActiveSymbols();
                } else if (!isOnline) {
                    clearInterval(intervalId);
                    finishLoading();
                }
            }, 1000);

            setTimeout(() => {
                clearInterval(intervalId);
                if (is_loading) {
                    finishLoading();
                }
            }, 10000);
        }
    };

    React.useEffect(() => {
        if (!is_api_initialized) return;
        init();

        const optionsOAuth = isDerivOptionsOAuthSession();
        const sessionLoggedIn = client.is_logged_in || (optionsOAuth && Boolean(activeLoginid));

        if (!sessionLoggedIn) {
            if (isAuthorizing && !optionsOAuth) {
                setIsLoading(true);
            } else {
                changeActiveSymbolLoadingState();
            }
            return;
        }
        setIsLoading(true);
        changeActiveSymbolLoadingState();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeLoginid, client.is_logged_in, isAuthorizing, is_api_initialized]);

    React.useEffect(() => {
        const optionsOAuth = isDerivOptionsOAuthSession();
        const sessionLoggedIn = client.is_logged_in || (optionsOAuth && Boolean(activeLoginid));
        if (sessionLoggedIn && client.is_landing_company_loaded && is_api_initialized) {
            changeActiveSymbolLoadingState();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeLoginid, client.is_landing_company_loaded, client.is_logged_in, is_api_initialized, client.loginid]);

    useEffect(() => {
        initDatadog(true);
        if (client) {
            initHotjar(client);
        }
    }, []);

    if (common?.error) return null;

    // Show loading message based on online/offline state
    const getLoadingMessage = () => {
        if (is_eu_error_loading) return '';
        if (!isOnline) return localize('Loading offline dashboard...');
        if (isDerivOptionsOAuthSession()) return localize('Setting up your account, please hold on…');
        return localize('Initializing Deriv Bot account...');
    };

    // Skip loading entirely when offline - show dashboard directly
    if (!isOnline) {
        console.log('[Offline] Bypassing loader, showing dashboard directly');
        return (
            <AuthLoadingWrapper>
                <ThemeProvider theme={is_dark_mode_on ? 'dark' : 'light'}>
                    <BlocklyLoading />
                    <div className='bot-dashboard bot' data-testid='dt_bot_dashboard'>
                        {/* <PWAInstallModalTest /> */}
                        <Audio />
                        <Main />
                        <BotBuilder />
                        <BotStopped />
                        <TransactionDetailsModal />
                        <PWAInstallModal />
                        <ToastContainer limit={3} draggable={false} />
                        <TncStatusUpdateModal />
                        <MigrationModal />
                    </div>
                </ThemeProvider>
            </AuthLoadingWrapper>
        );
    }

    return is_loading ? (
        <ChunkLoader message={getLoadingMessage()} />
    ) : (
        <AuthLoadingWrapper>
            <ThemeProvider theme={is_dark_mode_on ? 'dark' : 'light'}>
                <BlocklyLoading />
                <div className='bot-dashboard bot' data-testid='dt_bot_dashboard'>
                    {/* <PWAInstallModalTest /> */}
                    <Audio />
                    <Main />
                    <BotBuilder />
                    <BotStopped />
                    <TransactionDetailsModal />
                    <PWAInstallModal />
                    <ToastContainer limit={3} draggable={false} />
                    <TncStatusUpdateModal />
                    <MigrationModal />
                </div>
            </ThemeProvider>
        </AuthLoadingWrapper>
    );
});

export default AppContent;
