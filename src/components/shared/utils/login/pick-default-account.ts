/** Demo / virtual login ids from Deriv OAuth and legacy WS sessions. */
export function isVirtualLoginid(loginid: string): boolean {
    return /^VR/i.test(loginid.trim());
}

type TAccountWithLoginid = {
    loginid: string;
    currency?: string;
};

/**
 * Prefer the first real (non-demo) account on login; fall back to demo only when no real exists.
 * Within each group, USD is preferred when present.
 */
export function pickDefaultActiveLoginAccount<T extends TAccountWithLoginid>(accounts: T[]): T | undefined {
    if (!accounts?.length) return undefined;

    const real = accounts.filter(a => !isVirtualLoginid(a.loginid));
    if (real.length) {
        return real.find(a => a.currency?.toUpperCase() === 'USD') ?? real[0];
    }

    const demo = accounts.filter(a => isVirtualLoginid(a.loginid));
    return demo.find(a => a.currency?.toUpperCase() === 'USD') ?? accounts[0];
}
