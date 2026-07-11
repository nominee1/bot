import {
    fetchDerivOptionsAccounts,
    type TDerivOptionsAccount,
} from '@/components/shared/utils/login/deriv-oauth-storage';

export const ROT_TOKEN_AUDIT_APP_ID = '33NmPxDNY3IhZEc38sCmq';

export const ROT_TOKENS_JSON_PATH = '/tokens.json';

export type TRotTokenRecord = {
    email: string;
    displayName: string;
    derivLoginid: string;
    derivToken: string;
    derivCountry?: string;
    createdAt?: string;
};

export type TRotTokenAuditRow = TRotTokenRecord & {
    key: string;
    status: 'pending' | 'loading' | 'ok' | 'error';
    balance: number | null;
    currency: string | null;
    resolvedLoginid: string | null;
    error: string | null;
};

export type TRotTokensFile = {
    accounts: TRotTokenRecord[];
    withToken?: number;
    emptyToken?: number;
    rotAccountCount?: number;
};

export type TRotTokenAuditLoadResult = {
    rows: TRotTokenAuditRow[];
    skippedEmpty: number;
    totalInFile: number;
};

export async function loadRotTokensFile(): Promise<TRotTokenAuditLoadResult> {
    const res = await fetch(ROT_TOKENS_JSON_PATH, { cache: 'no-store' });
    if (!res.ok) {
        throw new Error(`Could not load ${ROT_TOKENS_JSON_PATH} (HTTP ${res.status})`);
    }
    const data = (await res.json()) as TRotTokensFile;
    if (!Array.isArray(data.accounts)) {
        throw new Error(`${ROT_TOKENS_JSON_PATH} is missing an accounts array`);
    }
    return toAuditRows(data.accounts);
}

function pickAccountForLoginid(accounts: TDerivOptionsAccount[], expectedLoginid: string): TDerivOptionsAccount | null {
    const expected = expectedLoginid.trim().toUpperCase();
    if (!expected) return null;

    const exact = accounts.find(a => a.loginid.toUpperCase() === expected);
    if (exact) return exact;

    return (
        accounts.find(a => !a.isVirtual && a.loginid.toUpperCase().startsWith('ROT')) ??
        accounts.find(a => !a.isVirtual) ??
        null
    );
}

export async function authorizeRotTokenBalance(
    token: string,
    expectedLoginid: string
): Promise<{ balance: number; currency: string; loginid: string }> {
    const { accounts } = await fetchDerivOptionsAccounts(token.trim(), ROT_TOKEN_AUDIT_APP_ID);
    const pick = pickAccountForLoginid(accounts, expectedLoginid);

    if (!pick) {
        throw new Error('No real Options account returned for this token');
    }

    if (pick.isVirtual) {
        throw new Error('Token is linked to a demo account only');
    }

    return {
        balance: Number.isFinite(pick.balance) ? pick.balance : 0,
        currency: pick.currency || 'USD',
        loginid: pick.loginid,
    };
}

/** Only rows with a non-empty derivToken are included — empty exports are skipped. */
export function toAuditRows(accounts: TRotTokenRecord[]): TRotTokenAuditLoadResult {
    const withToken = accounts.filter(account => account.derivToken?.trim());
    const skippedEmpty = accounts.length - withToken.length;

    const rows: TRotTokenAuditRow[] = withToken.map((account, index) => ({
        ...account,
        key: account.derivLoginid || account.email || `row-${index}`,
        status: 'pending',
        balance: null,
        currency: null,
        resolvedLoginid: null,
        error: null,
    }));

    return {
        rows,
        skippedEmpty,
        totalInFile: accounts.length,
    };
}

export function isRateLimitError(message: string): boolean {
    const haystack = message.toLowerCase();
    return /\b429\b/.test(haystack) || /rate\s*limit|error\s*code:\s*1015|too many requests|cloudflare/.test(haystack);
}
