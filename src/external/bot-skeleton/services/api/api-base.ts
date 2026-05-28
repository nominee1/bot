import CommonStore from '@/stores/common-store';
import { TAuthData } from '@/types/api-types';
import { observer as globalObserver } from '../../utils/observer';
import { doUntilDone, socket_state } from '../tradeEngine/utils/helpers';
import { clearMirrorContractRegistry } from '@/components/shared/utils/trading/dual-account-contract-registry';
import { clearCopierContractRegistry } from '@/utils/parallel-copiers/parallel-copiers-contract-registry';
import {
    getCopierToken,
    getParallelCopiersForMirror,
    isParallelCopyTradeEnabled,
} from '@/utils/parallel-copiers/parallel-copiers-storage';
import { isOptionsOAuthSessionLoginid, isOptionsOAuthSessionToken } from '@/utils/parallel-copiers/parallel-session-accounts';
import { wrapApiSendForDualTrade } from '@/components/shared/utils/trading/dual-account-mirror';
import {
    getMirrorLoginidForActive,
    isDualAccountTradeEnabled,
} from '@/components/shared/utils/trading/dual-account-trade';
import {
    fetchDerivOptionsAccountOtpUrl,
    getDerivOAuthAccessToken,
    isDerivOptionsOAuthSession,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import {
    authData$,
    bumpTradingSocketGeneration,
    CONNECTION_STATUS,
    setAccountList,
    setAuthData,
    setConnectionStatus,
    setIsAuthorized,
    setIsAuthorizing,
} from './observables/connection-status-stream';
import ApiHelpers from './api-helpers';
import {
    generateDerivApiInstance,
    generateDerivApiInstanceFromUrl,
    getLoginId,
    V2GetActiveClientId,
    V2GetActiveToken,
} from './appId';
import chart_api from './chart-api';

type CurrentSubscription = {
    id: string;
    unsubscribe: () => void;
};

type SubscriptionPromise = Promise<{
    subscription: CurrentSubscription;
}>;

type TApiBaseApi = {
    connection: {
        readyState: keyof typeof socket_state;
        addEventListener: (event: string, callback: () => void) => void;
        removeEventListener: (event: string, callback: () => void) => void;
    };
    send: (data: unknown) => void;
    disconnect: () => void;
    authorize: (token: string) => Promise<{ authorize: TAuthData; error: unknown }>;
    getSelfExclusion: () => Promise<unknown>;
    onMessage: () => {
        subscribe: (callback: (message: unknown) => void) => {
            unsubscribe: () => void;
        };
    };
} & ReturnType<typeof generateDerivApiInstance>;

class APIBase {
    api: TApiBaseApi | null = null;
    token: string = '';
    account_id: string = '';
    pip_sizes = {};
    account_info = {};
    is_running = false;
    subscriptions: CurrentSubscription[] = [];
    time_interval: ReturnType<typeof setInterval> | null = null;
    has_active_symbols = false;
    is_stopping = false;
    active_symbols = [];
    current_auth_subscriptions: SubscriptionPromise[] = [];
    is_authorized = false;
    active_symbols_promise: Promise<void> | null = null;
    common_store: CommonStore | undefined;
    landing_company: string | null = null;
    /** Pre-authenticated Options OTP sockets per account (demo + real). */
    private options_accounts_apis = new Map<string, TApiBaseApi>();
    /** Legacy PAT mirror sockets (demo ↔ real dual trading). */
    private legacy_mirror_apis = new Map<string, TApiBaseApi>();
    /** Parallel copy-trade sockets (one per copier loginid). */
    private copier_apis = new Map<string, TApiBaseApi>();

    clearOptionsAccountsCache = () => {
        this.options_accounts_apis.forEach(api => {
            try {
                api.disconnect();
            } catch {
                /* noop */
            }
        });
        this.options_accounts_apis.clear();
        this.clearLegacyMirrorApis();
        this.clearCopierApis();
    };

    clearLegacyMirrorApis = () => {
        this.legacy_mirror_apis.forEach(api => {
            try {
                api.disconnect();
            } catch {
                /* noop */
            }
        });
        this.legacy_mirror_apis.clear();
        clearMirrorContractRegistry();
    };

    clearCopierApis = () => {
        this.copier_apis.forEach(api => {
            try {
                api.disconnect();
            } catch {
                /* noop */
            }
        });
        this.copier_apis.clear();
        clearCopierContractRegistry();
    };

    prefetchCopierTradingApis = () => {
        if (!isParallelCopyTradeEnabled()) return;
        getParallelCopiersForMirror(this.account_id).forEach(c => {
            void this.getCopierTradingApi(c.loginid).catch(() => null);
        });
    };

    disconnectCopierApi(loginid: string): void {
        const api = this.copier_apis.get(loginid);
        if (api) {
            try {
                api.disconnect();
            } catch {
                /* noop */
            }
        }
        this.copier_apis.delete(loginid);
    };

    async getCopierTradingApi(loginid: string): Promise<TApiBaseApi | null> {
        if (!isParallelCopyTradeEnabled() || !loginid || loginid === this.account_id) {
            return null;
        }

        const cached = this.copier_apis.get(loginid);
        if (cached && cached.connection.readyState === 1) {
            return cached;
        }

        if (isDerivOptionsOAuthSession() && getDerivOAuthAccessToken() && isOptionsOAuthSessionLoginid(loginid)) {
            const api = await this.ensureOptionsApiForAccount(loginid);
            if (!api) return null;
            wrapApiSendForDualTrade(api);
            this.copier_apis.set(loginid, api);
            return api;
        }

        const token = getCopierToken(loginid);
        if (!token || isOptionsOAuthSessionToken(token)) return null;

        const api = generateDerivApiInstance() as TApiBaseApi;
        await this.waitForSocketOpen(api);
        const { error } = await api.authorize(token);
        if (error) {
            try {
                api.disconnect();
            } catch {
                /* noop */
            }
            return null;
        }
        wrapApiSendForDualTrade(api);
        this.copier_apis.set(loginid, api);
        return api;
    }

    /** Warm mirror WebSocket when dual-account trading is enabled. */
    prefetchMirrorTradingApi = () => {
        if (!isDualAccountTradeEnabled()) return;
        void this.getMirrorTradingApi().catch(() => null);
    };

    /**
     * Trading API for the paired demo/real account (opposite of the active account).
     * Used when dual-account trading is enabled.
     */
    async getMirrorTradingApi(): Promise<TApiBaseApi | null> {
        if (!isDualAccountTradeEnabled()) return null;

        const mirrorLoginid = getMirrorLoginidForActive(this.account_id);
        if (!mirrorLoginid || mirrorLoginid === this.account_id) return null;

        if (isDerivOptionsOAuthSession() && getDerivOAuthAccessToken()) {
            return this.ensureOptionsApiForAccount(mirrorLoginid);
        }

        const cached = this.legacy_mirror_apis.get(mirrorLoginid);
        if (cached && cached.connection.readyState === 1) {
            return cached;
        }

        let token: string | null = null;
        try {
            const raw = localStorage.getItem('accountsList');
            if (raw) {
                const map = JSON.parse(raw) as Record<string, string>;
                token = map[mirrorLoginid] ?? null;
            }
        } catch {
            token = null;
        }
        if (!token) return null;

        const api = generateDerivApiInstance() as TApiBaseApi;
        await this.waitForSocketOpen(api);
        const { error } = await api.authorize(token);
        if (error) {
            try {
                api.disconnect();
            } catch {
                /* noop */
            }
            return null;
        }
        this.legacy_mirror_apis.set(mirrorLoginid, api);
        return api;
    };

    /**
     * Forget stream subscriptions created during `subscribe()`.
     * Pass the socket that actually owns those subscription ids (usually the pre-switch instance).
     */
    unsubscribeAllSubscriptions(forgetOnApi: TApiBaseApi | null | undefined = this.api) {
        const target = forgetOnApi;
        this.current_auth_subscriptions?.forEach(subscription_promise => {
            subscription_promise.then(({ subscription }) => {
                if (subscription?.id) {
                    target?.send({
                        forget: subscription.id,
                    });
                }
            });
        });
        this.current_auth_subscriptions = [];
    };

    /** Assign `this.api` and notify listeners when the WebSocket instance changes. */
    private adoptTradingApi(next: TApiBaseApi | null) {
        if (!next) return;
        if (this.api === next) return;
        wrapApiSendForDualTrade(next);
        this.api = next;
        bumpTradingSocketGeneration();
    }

    onsocketopen() {
        setConnectionStatus(CONNECTION_STATUS.OPENED);
    }

    onsocketclose() {
        setConnectionStatus(CONNECTION_STATUS.CLOSED);
        this.reconnectIfNotConnected();
    }

    private waitForSocketOpen(api: TApiBaseApi, timeoutMs = 20000): Promise<void> {
        return new Promise((resolve, reject) => {
            if (api.connection.readyState === 1) {
                resolve();
                return;
            }
            let settled = false;
            const finish = (fn: () => void) => {
                if (settled) return;
                settled = true;
                api.connection.removeEventListener('open', onOpen);
                api.connection.removeEventListener('error', onError);
                clearTimeout(timer);
                fn();
            };
            const onOpen = () => finish(resolve);
            const onError = () => finish(() => reject(new Error('Options WebSocket connection failed')));
            const timer = setTimeout(
                () => finish(() => reject(new Error('Options WebSocket connection timeout'))),
                timeoutMs
            );
            api.connection.addEventListener('open', onOpen);
            api.connection.addEventListener('error', onError);
        });
    }

    private attachOptionsApiListeners(api: TApiBaseApi) {
        api.connection.addEventListener('open', this.onsocketopen.bind(this));
        api.connection.addEventListener('close', this.onsocketclose.bind(this));
    }

    private async ensureOptionsApiForAccount(accountId: string): Promise<TApiBaseApi | null> {
        const cached = this.options_accounts_apis.get(accountId);
        if (cached && cached.connection.readyState === 1) {
            return cached;
        }

        const accessToken = getDerivOAuthAccessToken();
        if (!accessToken) return null;

        const wsUrl = await fetchDerivOptionsAccountOtpUrl(accessToken, accountId);
        if (!wsUrl) return null;

        const api = generateDerivApiInstanceFromUrl(wsUrl) as TApiBaseApi;
        this.attachOptionsApiListeners(api);
        await this.waitForSocketOpen(api);
        this.options_accounts_apis.set(accountId, api);
        return api;
    }

    private prefetchOptionsAccountConnections(accountIds: string[], activeId: string) {
        accountIds
            .filter(id => id && id !== activeId)
            .forEach(id => {
                void this.ensureOptionsApiForAccount(id).catch(() => null);
            });
    }

    /**
     * Switch demo ↔ real without `init(true)` — uses pre-connected OTP WebSockets when available.
     */
    async switchOptionsOAuthAccount(loginid: string) {
        if (this.account_id === loginid && this.is_authorized && this.api?.connection.readyState === 1) {
            return;
        }

        if (!authData$.getValue()?.account_list?.length) return;

        try {
            const prevApi = this.api;
            this.unsubscribeAllSubscriptions(prevApi ?? undefined);

            const nextApi = await this.ensureOptionsApiForAccount(loginid);
            if (!nextApi) {
                throw new Error('Could not connect Options trading WebSocket for this account');
            }

            this.adoptTradingApi(nextApi);
            let snapshot = authData$.getValue();
            if (!snapshot?.loginid) {
                throw new Error('Options session is missing account data');
            }
            if (snapshot.loginid !== loginid) {
                snapshot = { ...snapshot, loginid } as typeof snapshot;
            }
            this.token = '';
            this.account_id = loginid;
            this.account_info = snapshot;
            this.is_authorized = true;
            setIsAuthorized(true);

            await this.subscribe();
            this.toggleRunButton(false);
            this.prefetchMirrorTradingApi();
        } catch (e) {
            globalObserver.emit('Error', e);
        }
    }

    /**
     * Options OAuth: REST OTP → authenticated WS for trading operations
     * (proposal, buy, sell, proposal_open_contract — https://developers.deriv.com/docs/trading/)
     */
    async connectOptionsOAuthAndSubscribe() {
        const accessToken = getDerivOAuthAccessToken();
        const accountId = getLoginId() ?? V2GetActiveClientId() ?? '';
        if (!accessToken || !accountId) {
            setIsAuthorizing(false);
            return;
        }

        try {
            const nextApi = await this.ensureOptionsApiForAccount(accountId);
            if (!nextApi) {
                throw new Error('Could not obtain Options trading WebSocket URL (OTP)');
            }

            this.adoptTradingApi(nextApi);
            const authData = authData$.getValue();
            if (!authData?.loginid) {
                throw new Error('Options session is missing account data');
            }

            this.token = '';
            this.account_id = accountId;
            this.account_info = authData;
            this.is_authorized = true;
            setIsAuthorized(true);

            if (this.has_active_symbols) {
                this.toggleRunButton(false);
            } else {
                this.active_symbols_promise = this.getActiveSymbols();
            }

            /** Same as legacy PAT path — do not block init on balance/transaction streams. */
            void this.subscribe();
            void this.getSelfExclusion();

            const otherIds = authData.account_list.map(a => a.loginid).filter(Boolean);
            this.prefetchOptionsAccountConnections(otherIds, accountId);
            this.prefetchMirrorTradingApi();
        } catch (e) {
            this.is_authorized = false;
            setIsAuthorized(false);
            globalObserver.emit('Error', e);
        } finally {
            setIsAuthorizing(false);
        }
    }

    /**
     * Legacy (PAT) account switch: keeps the classic `websockets/v3` socket when it is already open
     * and only re-runs authorize + stream subscriptions — same idea as Options OTP socket swap.
     */
    async switchLegacyAccountSession(): Promise<void> {
        if (isDerivOptionsOAuthSession() && getDerivOAuthAccessToken()) {
            return;
        }
        await this.init(false);
    }

    async init(force_create_connection = false) {
        this.toggleRunButton(true);

        if (this.api) {
            this.unsubscribeAllSubscriptions();
        }

        if (!this.api || this.api?.connection.readyState !== 1 || force_create_connection) {
            if (this.api?.connection) {
                ApiHelpers.disposeInstance();
                setConnectionStatus(CONNECTION_STATUS.CLOSED);
                this.api.disconnect();
                this.api.connection.removeEventListener('open', this.onsocketopen.bind(this));
                this.api.connection.removeEventListener('close', this.onsocketclose.bind(this));
            }
            const optionsOAuth = isDerivOptionsOAuthSession() && Boolean(getDerivOAuthAccessToken());
            if (!optionsOAuth) {
                this.adoptTradingApi(generateDerivApiInstance() as TApiBaseApi);
                this.api?.connection.addEventListener('open', this.onsocketopen.bind(this));
                this.api?.connection.addEventListener('close', this.onsocketclose.bind(this));
            }
        }

        if (!this.has_active_symbols && this.api) {
            this.active_symbols_promise = this.getActiveSymbols();
        }

        this.initEventListeners();

        if (this.time_interval) clearInterval(this.time_interval);
        this.time_interval = null;

        if (isDerivOptionsOAuthSession() && getDerivOAuthAccessToken()) {
            setIsAuthorizing(true);
            await this.connectOptionsOAuthAndSubscribe();
        } else if (V2GetActiveToken()) {
            setIsAuthorizing(true);
            await this.authorizeAndSubscribe();
        }

        chart_api.init(force_create_connection);
    }

    getConnectionStatus() {
        if (this.api?.connection) {
            const ready_state = this.api.connection.readyState;
            return socket_state[ready_state as keyof typeof socket_state] || 'Unknown';
        }
        return 'Socket not initialized';
    }

    terminate() {
        // eslint-disable-next-line no-console
        if (this.api) this.api.disconnect();
    }

    initEventListeners() {
        if (window) {
            window.addEventListener('online', this.reconnectIfNotConnected);
            window.addEventListener('focus', this.reconnectIfNotConnected);
        }
    }

    async createNewInstance(account_id: string) {
        if (this.account_id === account_id) return;
        if (isDerivOptionsOAuthSession() && getDerivOAuthAccessToken()) {
            await this.switchOptionsOAuthAccount(account_id);
            return;
        }
        await this.init();
    }

    reconnectIfNotConnected = () => {
        // eslint-disable-next-line no-console
        console.log('connection state: ', this.api?.connection?.readyState);
        if (this.api?.connection?.readyState && this.api?.connection?.readyState > 1) {
            // eslint-disable-next-line no-console
            console.log('Info: Connection to the server was closed, trying to reconnect.');
            this.init(true);
        }
    };

    async authorizeAndSubscribe() {
        const token = V2GetActiveToken();
        if (token) {
            this.token = token;
                this.account_id = getLoginId() ?? V2GetActiveClientId() ?? '';

            if (!this.api) return;

            try {
                const { authorize, error } = await this.api.authorize(this.token);
                if (error) return error;

                if (this.has_active_symbols) {
                    this.toggleRunButton(false);
                } else {
                    this.active_symbols_promise = this.getActiveSymbols();
                }
                this.account_info = authorize;
                this.account_id = String(authorize.loginid ?? this.account_id);
                setAccountList(authorize.account_list);
                setAuthData(authorize);
                setIsAuthorized(true);
                this.is_authorized = true;
                this.subscribe();
                bumpTradingSocketGeneration();
                this.getSelfExclusion();
                this.prefetchMirrorTradingApi();
            } catch (e) {
                this.is_authorized = false;
                setIsAuthorized(false);
                globalObserver.emit('Error', e);
            } finally {
                setIsAuthorizing(false);
            }
        }
    }

    async getSelfExclusion() {
        if (!this.api || !this.is_authorized) return;
        await this.api.getSelfExclusion();
        // TODO: fix self exclusion
    }

    async subscribe() {
        const subscribeToStream = (streamName: string) => {
            return doUntilDone(
                () => {
                    const subscription = this.api?.send({
                        [streamName]: 1,
                        subscribe: 1,
                    });
                    if (subscription) {
                        this.current_auth_subscriptions.push(subscription);
                    }
                    return subscription;
                },
                [],
                this
            );
        };

        const streamsToSubscribe = ['balance', 'transaction', 'proposal_open_contract'];

        await Promise.all(streamsToSubscribe.map(subscribeToStream));
    }

    getActiveSymbols = async () => {
        await doUntilDone(() => this.api?.send({ active_symbols: 'brief' }), [], this).then(
            ({ active_symbols = [], error = {} }) => {
                const pip_sizes = {};
                if (active_symbols.length) this.has_active_symbols = true;
                active_symbols.forEach(({ symbol, pip }: { symbol: string; pip: string }) => {
                    (pip_sizes as Record<string, number>)[symbol] = +(+pip).toExponential().substring(3);
                });
                this.pip_sizes = pip_sizes as Record<string, number>;
                this.toggleRunButton(false);
                this.active_symbols = active_symbols;
                return active_symbols || error;
            }
        );
    };

    toggleRunButton = (toggle: boolean) => {
        const run_button = document.querySelector('#db-animation__run-button');
        if (!run_button) return;
        (run_button as HTMLButtonElement).disabled = toggle;
    };

    setIsRunning(toggle = false) {
        this.is_running = toggle;
    }

    pushSubscription(subscription: CurrentSubscription) {
        this.subscriptions.push(subscription);
    }

    clearSubscriptions() {
        this.subscriptions.forEach(s => s.unsubscribe());
        this.subscriptions = [];

        // Resetting timeout resolvers
        const global_timeouts = globalObserver.getState('global_timeouts') ?? [];

        global_timeouts.forEach((_: unknown, i: number) => {
            clearTimeout(i);
        });
    }
}

export const api_base = new APIBase();
