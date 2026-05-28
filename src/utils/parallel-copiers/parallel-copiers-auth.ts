import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { isVirtualLoginid } from '@/components/shared/utils/login/pick-default-account';

export type TAuthorizeCopierResult = {
    loginid: string;
    token: string;
    currency: string;
    balance: number;
    is_virtual: boolean;
};

/**
 * Authorize a PAT token and return account metadata (used when adding copiers).
 */
export async function authorizeCopierToken(token: string): Promise<TAuthorizeCopierResult> {
    const trimmed = token.trim();
    if (!trimmed) {
        throw new Error('Token is required');
    }

    const api = generateDerivApiInstance();
    await new Promise<void>((resolve, reject) => {
        if (api.connection.readyState === 1) {
            resolve();
            return;
        }
        const onOpen = () => {
            api.connection.removeEventListener('open', onOpen);
            api.connection.removeEventListener('error', onError);
            resolve();
        };
        const onError = () => {
            api.connection.removeEventListener('open', onOpen);
            api.connection.removeEventListener('error', onError);
            reject(new Error('Could not connect to Deriv'));
        };
        api.connection.addEventListener('open', onOpen);
        api.connection.addEventListener('error', onError);
    });

    try {
        const { authorize, error } = await api.authorize(trimmed);
        if (error) {
            const msg =
                typeof error === 'object' && error && 'message' in error
                    ? String((error as { message?: string }).message)
                    : 'Authorization failed';
            throw new Error(msg);
        }
        if (!authorize?.loginid) {
            throw new Error('Invalid authorize response');
        }

        return {
            loginid: String(authorize.loginid),
            token: trimmed,
            currency: String(authorize.currency ?? 'USD'),
            balance: Number(authorize.balance ?? 0),
            is_virtual: Boolean(authorize.is_virtual) || isVirtualLoginid(String(authorize.loginid)),
        };
    } finally {
        try {
            api.disconnect();
        } catch {
            /* noop */
        }
    }
}
