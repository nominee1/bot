export function getPaApiBaseUrl(): string {
    const fromEnv = typeof process.env.PA_API_BASE_URL === 'string' ? process.env.PA_API_BASE_URL.trim() : '';
    return (fromEnv || 'https://railway-backend-production-3f3a.up.railway.app').replace(/\/+$/, '');
}

export function getDeriv1LedgerProxyUrl(): string {
    const fromEnv = typeof process.env.DERIV1_APP_ORIGIN === 'string' ? process.env.DERIV1_APP_ORIGIN.trim() : '';
    const liveOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    const origin = (fromEnv || liveOrigin || 'https://bot.deriv.com').replace(/\/+$/, '');
    return `${origin}/api/virtual-ledger`;
}
