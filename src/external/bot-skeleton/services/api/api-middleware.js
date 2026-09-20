export const REQUESTS = [
    'active_symbols',
    'authorize',
    'balance',
    'buy',
    'proposal',
    'proposal_open_contract',
    'transaction',
    'ticks_history',
    'history',
];

/** Public/OTP Options WS rejects v3 `loginid` and `symbol`; market is `underlying_symbol`. */
export function transformOptionsWsRequest(request) {
    if (!request || typeof request !== 'object') return request;
    const next = { ...request };
    delete next.loginid;
    if (next.symbol && !next.underlying_symbol) {
        next.underlying_symbol = next.symbol;
    }
    delete next.symbol;
    if (next.parameters && typeof next.parameters === 'object') {
        next.parameters = { ...next.parameters };
        if (next.parameters.symbol && !next.parameters.underlying_symbol) {
            next.parameters.underlying_symbol = next.parameters.symbol;
        }
        delete next.parameters.symbol;
        delete next.parameters.loginid;
        if (next.parameters.multiplier == null) delete next.parameters.multiplier;
    }
    if (next.multiplier == null) delete next.multiplier;
    return next;
}

class APIMiddleware {
    constructor(config) {
        this.config = config;
        this.debounced_calls = {};
    }

    requestDataTransformer = request => transformOptionsWsRequest(request);

    getRequestType = request => {
        let req_type;
        REQUESTS.forEach(type => {
            if (type in request && !req_type) req_type = type;
        });

        return req_type;
    };

    defineMeasure = res_type => {
        if (res_type) {
            let measure;
            if (res_type === 'history') {
                performance.mark('ticks_history_end');
                measure = performance.measure('ticks_history', 'ticks_history_start', 'ticks_history_end');
            } else {
                performance.mark(`${res_type}_end`);
                measure = performance.measure(`${res_type}`, `${res_type}_start`, `${res_type}_end`);
            }
            return (measure.startTimeDate = new Date(Date.now() - measure.startTime));
        }
        return false;
    };

    sendIsCalled = ({ response_promise, args: [request] }) => {
        const req_type = this.getRequestType(request);
        if (req_type) performance.mark(`${req_type}_start`);
        response_promise
            .then(res => {
                const res_type = this.getRequestType(res);
                if (res_type) {
                    this.defineMeasure(res_type);
                }
            })
            .catch(() => {});
        return response_promise;
    };
}

export default APIMiddleware;
