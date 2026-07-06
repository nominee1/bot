const DEFAULT_PA_API_BASE_URL = 'https://railway-backend-production-3f3a.up.railway.app';

export const PA_SERVICE_UNAVAILABLE_MESSAGE = 'Service unavailable. Please try again later.';

/** Railway Node API for M-Pesa deposits + PA transfers (`PA_API_BASE_URL` at build time). */
export function getPaApiBaseUrl(): string {
    const fromEnv = (process.env.PA_API_BASE_URL as string | undefined)?.trim().replace(/\/+$/, '');
    if (fromEnv) return fromEnv;
    return DEFAULT_PA_API_BASE_URL;
}

/** Site owner affiliate code baked at deploy time (`BOT_STUDIO_AFFILIATE_CODE`). */
export function getSiteAffiliateCode(): string {
    return (process.env.BOT_STUDIO_AFFILIATE_CODE as string | undefined)?.trim().toLowerCase() ?? '';
}

const USER_FACING_ERROR_PATTERNS = [
    /^Enter a valid Kenyan M-Pesa number/i,
    /^Enter a valid USD amount/i,
    /^Enter your M-Pesa phone number/i,
    /^Enter your CR funding login ID/i,
    /^Minimum deposit is/i,
    /^Payment of KES \d/i,
    /^A valid email is required/i,
    /^Funding login ID must/i,
    /^Deposits are not available at the moment/i,
    /^M-Pesa payment was not completed/i,
    /^Payment agent transfer failed/i,
    /^Save your profile first/i,
    /^Your profile is missing/i,
    /^Could not save profile$/i,
    /^Could not start deposit$/i,
];

const TECHNICAL_ERROR_PATTERNS = [
    /https?:\/\//i,
    /railway/i,
    /\bcors\b/i,
    /\bfetch\b/i,
    /internal server/i,
    /\bdatabase\b/i,
    /\boauth\b/i,
    /\btoken\b/i,
    /ECONNREFUSED/i,
    /CORS_ORIGINS/i,
];

/** Strip backend URLs and other technical details before showing errors in the UI. */
export function sanitizePaApiError(message: string | null | undefined): string {
    if (!message?.trim()) return PA_SERVICE_UNAVAILABLE_MESSAGE;

    const msg = message.trim();
    if (TECHNICAL_ERROR_PATTERNS.some(pattern => pattern.test(msg))) {
        return PA_SERVICE_UNAVAILABLE_MESSAGE;
    }
    if (USER_FACING_ERROR_PATTERNS.some(pattern => pattern.test(msg))) {
        return msg;
    }
    if (msg.length <= 72 && !msg.includes('://')) {
        return msg;
    }
    return PA_SERVICE_UNAVAILABLE_MESSAGE;
}

export function formatPaApiFetchError(err: unknown): string {
    if (err instanceof TypeError && /fetch/i.test(err.message)) {
        return PA_SERVICE_UNAVAILABLE_MESSAGE;
    }
    if (err instanceof Error && err.message) {
        return sanitizePaApiError(err.message);
    }
    return PA_SERVICE_UNAVAILABLE_MESSAGE;
}
