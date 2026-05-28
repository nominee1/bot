/** Single Denara display name for competitions + backend trader row (linked to Deriv PAT; login password stored hashed on server). */

export const DENARA_COMPETITION_USERNAME_KEY = 'denara_competition_username';

/** Dispatched on `window` after `setDenaraCompetitionUsername` updates storage (same-tab UI sync). */
export const DENARA_COMPETITION_USERNAME_CHANGED_EVENT = 'denara_competition_username_changed';

/** REST host for trader rows (`POST …/traders`) — same as `ParticipantsLeaderboard` REG_API_URL base. */
export const COMPETITION_API_BASE_URL = 'https://dtraderhub.com/api';

/**
 * Competition PHP host (`list_challenges.php`, `join_challenge.php`, `/challenge/payments/*` on `index.php`, …).
 * Default **dtraderhub** so local HTTPS dev (`https://localhost:8443`) gets CORS + full router; override with
 * `DENARA_COMPETITION_PHP_API_BASE_URL` (e.g. `https://ttt.binaryke.com/api`) if your deploy serves the same API there
 * **and** that host’s `CORS_ALLOW_ORIGINS` includes your app origin.
 */
export const COMPETITION_PHP_API_BASE_URL = 'https://dtraderhub.com/api';

/**
 * Extra host for `GET …/get_token.php` only (Denara ID header login — see {@link getCompetitionGetTokenLookupBases}).
 * Tried before dtraderhub so login works if `get_token.php` is not deployed on dtraderhub yet.
 */
export const COMPETITION_GET_TOKEN_FALLBACK_BASE_URL = 'https://ttt.binaryke.com/api';

/** Full URL for trader registration JSON POST — matches `ParticipantsLeaderboard` REG_API_URL. */
export const COMPETITION_TRADERS_REGISTER_URL = `${COMPETITION_API_BASE_URL}/traders`;

/**
 * Base URL for competition PHP (challenges, participants, tokens, `create_challenge.php`, etc.).
 * Override with `DENARA_COMPETITION_PHP_API_BASE_URL` or legacy `DENARA_CHALLENGE_PHP_API_BASE_URL`.
 */
export function getCompetitionPhpApiBaseUrl(): string {
    const fromEnv =
        (typeof process.env.DENARA_COMPETITION_PHP_API_BASE_URL === 'string'
            ? process.env.DENARA_COMPETITION_PHP_API_BASE_URL.trim()
            : '') ||
        (typeof process.env.DENARA_CHALLENGE_PHP_API_BASE_URL === 'string'
            ? process.env.DENARA_CHALLENGE_PHP_API_BASE_URL.trim()
            : '');
    return fromEnv || COMPETITION_PHP_API_BASE_URL;
}

/** @deprecated use `getCompetitionPhpApiBaseUrl` — same implementation */
export function getCompetitionChallengePhpBaseUrl(): string {
    return getCompetitionPhpApiBaseUrl();
}

/**
 * Bases for `GET …/get_token.php?username=` (Denara ID login).
 * Order: env override → Binaryke fallback → dtraderhub. Fallback runs before dtraderhub so login still works if
 * production has not uploaded `get_token.php` next to `index.php` yet (otherwise first hop returns 404 Not Found).
 */
export function getCompetitionGetTokenLookupBases(): string[] {
    const fromEnv =
        typeof process.env.DENARA_GET_TOKEN_API_BASE_URL === 'string'
            ? process.env.DENARA_GET_TOKEN_API_BASE_URL.trim()
            : '';
    const all = [fromEnv, COMPETITION_GET_TOKEN_FALLBACK_BASE_URL, COMPETITION_API_BASE_URL].filter(
        (b): b is string => b.length > 0
    );
    return [...new Set(all)];
}

export function getDenaraCompetitionUsername(): string | null {
    try {
        const v = localStorage.getItem(DENARA_COMPETITION_USERNAME_KEY);
        return v?.trim() ? v.trim() : null;
    } catch {
        return null;
    }
}

export function setDenaraCompetitionUsername(username: string): void {
    const trimmed = username.trim();
    try {
        localStorage.setItem(DENARA_COMPETITION_USERNAME_KEY, trimmed);
    } catch {
        /* noop */
    }
    if (typeof window !== 'undefined') {
        try {
            window.dispatchEvent(new CustomEvent(DENARA_COMPETITION_USERNAME_CHANGED_EVENT, { detail: trimmed }));
        } catch {
            /* noop */
        }
    }
}

type ApiErr = { ok?: false; error?: string };

export async function registerCompetitionTrader(payload: {
    username: string;
    token: string;
    email: string;
    password: string;
}): Promise<{ username?: string }> {
    const res = await fetch(COMPETITION_TRADERS_REGISTER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data: { ok?: boolean; username?: string; error?: string };

    try {
        data = JSON.parse(text) as typeof data;
    } catch {
        throw new Error('The server returned an unexpected response. Please try again.');
    }

    if (!res.ok || data.ok === false) {
        throw new Error(data?.error || `Register failed (${res.status})`);
    }

    return data;
}
