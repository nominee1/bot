import { toast } from 'react-toastify';

export const OAUTH_USER_MESSAGE_KEY = 'denara_oauth_user_message';

export type TOAuthUserMessage = {
    message: string;
    action?: 'retry';
    at: number;
};

export function setOAuthUserMessage(message: string, action?: 'retry'): void {
    try {
        const payload: TOAuthUserMessage = { message, action, at: Date.now() };
        sessionStorage.setItem(OAUTH_USER_MESSAGE_KEY, JSON.stringify(payload));
    } catch {
        /* noop */
    }
}

export function peekOAuthUserMessage(): TOAuthUserMessage | null {
    try {
        const raw = sessionStorage.getItem(OAUTH_USER_MESSAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as TOAuthUserMessage;
        if (!parsed?.message) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function consumeOAuthUserMessage(): TOAuthUserMessage | null {
    const msg = peekOAuthUserMessage();
    try {
        sessionStorage.removeItem(OAUTH_USER_MESSAGE_KEY);
    } catch {
        /* noop */
    }
    return msg;
}

/** Toast when the dashboard shell is mounted; falls back to session message for welcome. */
export function showOAuthToast(message: string, type: 'error' | 'warning' | 'info' = 'error'): void {
    window.setTimeout(() => {
        toast(message, { type, autoClose: 8000 });
    }, 300);
}
