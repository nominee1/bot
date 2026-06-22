type TDerivTradeDebugSource = 'ready' | 'multi' | 'deriv-session' | 'coordinated';

type TDerivTradeDebugPhase =
    | 'proposal_request'
    | 'proposal_response'
    | 'buy_request'
    | 'buy_response'
    | 'trade_failed'
    | 'wire_error';

export type TDerivTradeDebugMeta = {
    source: TDerivTradeDebugSource;
    phase: TDerivTradeDebugPhase;
    attempt?: number;
    contractType?: string;
    market?: string;
    stake?: number;
    barrier?: number | string;
    slotId?: string;
    extra?: Record<string, unknown>;
};

const safeJson = (value: unknown): unknown => {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return value;
    }
};

const extractWireMessage = (value: unknown): string | undefined => {
    if (!value || typeof value !== 'object') {
        return value instanceof Error ? value.message : value != null ? String(value) : undefined;
    }
    const row = value as Record<string, unknown>;
    if (typeof row.message === 'string' && row.message.trim()) return row.message;
    const nested = row.error;
    if (nested && typeof nested === 'object' && 'message' in nested) {
        const msg = (nested as { message?: unknown }).message;
        if (typeof msg === 'string' && msg.trim()) return msg;
    }
    return undefined;
};

const extractWireCode = (value: unknown): string | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const row = value as Record<string, unknown>;
    if (typeof row.code === 'string' && row.code.trim()) return row.code;
    const nested = row.error;
    if (nested && typeof nested === 'object' && 'code' in nested) {
        const code = (nested as { code?: unknown }).code;
        if (typeof code === 'string' && code.trim()) return code;
    }
    return undefined;
};

/** Console diagnostics for Deriv buy/proposal wire failures (filter console by `deriv-trade`). */
export function logDerivTradeWire(meta: TDerivTradeDebugMeta, payload: unknown) {
    const tag = `[deriv-trade:${meta.source}] ${meta.phase}`;
    const summary = {
        ...meta,
        message: extractWireMessage(payload),
        code: extractWireCode(payload),
    };

    // eslint-disable-next-line no-console
    console.groupCollapsed(tag, summary);
    // eslint-disable-next-line no-console
    console.log('raw response', payload);
    // eslint-disable-next-line no-console
    console.log('parsed', safeJson(payload));
    // eslint-disable-next-line no-console
    console.groupEnd();
}

export function logDerivTradeFailure(
    meta: Omit<TDerivTradeDebugMeta, 'phase'>,
    error: unknown,
    context?: Record<string, unknown>
) {
    logDerivTradeWire(
        { ...meta, phase: 'trade_failed' },
        {
            error,
            errorMessage: extractWireMessage(error),
            errorCode: extractWireCode(error),
            ...context,
        }
    );
}
