import DerivAPIBasic from '@deriv/deriv-api/dist/DerivAPIBasic';
import APIMiddleware, { transformOptionsWsRequest } from './api-middleware';

/** Public Options market-data socket (no auth). v3 ws.derivws.com returns empty active_symbols here. */
export const PUBLIC_OPTIONS_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';

export const generateDerivApiInstance = () => {
    return generateDerivApiInstanceFromUrl(PUBLIC_OPTIONS_WS_URL);
};

/** Options API OTP URL — authenticated `proposal` / `buy` / `sell` per Deriv docs. */
export const generateDerivApiInstanceFromUrl = socket_url => {
    const deriv_socket = new WebSocket(socket_url);
    const raw_send = deriv_socket.send.bind(deriv_socket);
    deriv_socket.send = function sendOptionsWs(data) {
        if (typeof data === 'string') {
            try {
                data = JSON.stringify(transformOptionsWsRequest(JSON.parse(data)));
            } catch {
                /* keep original frame */
            }
        } else if (data && typeof data === 'object') {
            data = JSON.stringify(transformOptionsWsRequest(data));
        }
        return raw_send(data);
    };
    const deriv_api = new DerivAPIBasic({
        connection: deriv_socket,
        middleware: new APIMiddleware({}),
    });
    return deriv_api;
};

export const getLoginId = () => {
    const login_id = localStorage.getItem('active_loginid');
    if (login_id && login_id !== 'null') return login_id;
    return null;
};

export const V2GetActiveToken = () => {
    const token = localStorage.getItem('authToken');
    if (token && token !== 'null') return token;
    return null;
};

export const V2GetActiveClientId = () => {
    const token = V2GetActiveToken();

    if (!token) return null;
    try {
        const raw = localStorage.getItem('accountsList');
        if (!raw || raw === 'null') return null;
        const account_list = JSON.parse(raw);
        if (!account_list || typeof account_list !== 'object') return null;

        const preferred = getLoginId();
        if (preferred && account_list[preferred] === token) {
            return preferred;
        }

        const first_match = Object.keys(account_list).find(key => account_list[key] === token);
        return first_match ?? null;
    } catch {
        return null;
    }
};

export const getToken = () => {
    const active_loginid = getLoginId();
    const client_accounts = JSON.parse(localStorage.getItem('accountsList')) ?? undefined;
    const active_account = (client_accounts && client_accounts[active_loginid]) || {};
    return {
        token: active_account ?? undefined,
        account_id: active_loginid ?? undefined,
    };
};
