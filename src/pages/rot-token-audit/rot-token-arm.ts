import {
    applyDerivOptionsTokenAsLead,
    fetchDerivOptionsAccounts,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import { api_base } from '@/external/bot-skeleton';
import {
    findClientCopierByLoginid,
    getClientMainLoginid,
    readAllParallelCopiers,
    setClientCopying,
    setClientMainDerivAppId,
    setClientMainLoginid,
    setParallelCopyClientEnabled,
    syncCopiersToAccountsList,
    upsertClientCopier,
} from '@/utils/parallel-copiers/parallel-copiers-storage';
import { ROT_COPY_FOLLOWER_EMAILS, ROT_COPY_LEAD_EMAIL } from './rot-copy-preset';
import { ROT_TOKEN_AUDIT_APP_ID, type TRotTokenAuditRow } from './rot-token-audit-api';

export const ROT_MIN_ARM_BALANCE_USD = 0.35;

export type TRotTokenArmFailure = { key: string; label: string; error: string };

export function isRotTokenArmEligible(row: TRotTokenAuditRow): boolean {
    if (row.status !== 'ok') return false;
    if (row.balance === null || !Number.isFinite(row.balance)) return false;
    if (row.balance <= ROT_MIN_ARM_BALANCE_USD) return false;
    if ((row.currency || 'USD').toUpperCase() !== 'USD') return false;
    const loginid = (row.resolvedLoginid || row.derivLoginid || '').trim();
    if (!loginid) return false;
    return Boolean(row.derivToken?.trim());
}

export function isRotTokenRowArmed(row: TRotTokenAuditRow): boolean {
    const loginid = rowLoginid(row);
    if (!loginid) return false;
    const copier = findClientCopierByLoginid(loginid);
    return Boolean(copier?.copying);
}

export function rowLoginid(row: TRotTokenAuditRow): string {
    return (row.resolvedLoginid || row.derivLoginid || '').trim();
}

export function findRotTokenRowByEmail(rows: TRotTokenAuditRow[], email: string): TRotTokenAuditRow | null {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;
    return rows.find(row => row.email?.trim().toLowerCase() === normalized) ?? null;
}

/** Whether preset lead + follower rows exist and are ready to arm. */
export function isRotCopyPresetReady(rows: TRotTokenAuditRow[]): {
    ok: boolean;
    leadRow: TRotTokenAuditRow | null;
    followerRows: TRotTokenAuditRow[];
    error?: string;
} {
    const leadRow = findRotTokenRowByEmail(rows, ROT_COPY_LEAD_EMAIL);
    if (!leadRow?.derivToken?.trim()) {
        return { ok: false, leadRow, followerRows: [], error: `Lead not found in tokens.json: ${ROT_COPY_LEAD_EMAIL}` };
    }
    if (leadRow.status !== 'ok') {
        return {
            ok: false,
            leadRow,
            followerRows: [],
            error: `Authorize lead first: ${ROT_COPY_LEAD_EMAIL}`,
        };
    }

    const followerRows: TRotTokenAuditRow[] = [];
    for (const email of ROT_COPY_FOLLOWER_EMAILS) {
        const row = findRotTokenRowByEmail(rows, email);
        if (!row?.derivToken?.trim()) {
            return { ok: false, leadRow, followerRows, error: `Follower not found in tokens.json: ${email}` };
        }
        if (!isRotTokenArmEligible(row)) {
            return {
                ok: false,
                leadRow,
                followerRows,
                error: `Follower not funded enough (>${ROT_MIN_ARM_BALANCE_USD} USD): ${email}`,
            };
        }
        followerRows.push(row);
    }

    return { ok: true, leadRow, followerRows };
}

/** Highest-balance funded ROT row — default lead when arming. */
export function pickRotTokenLeadRow(rows: TRotTokenAuditRow[]): TRotTokenAuditRow | null {
    return sortRotTokenRowsByBalance(rows).find(isRotTokenArmEligible) ?? null;
}

export function findRotTokenLeadRow(rows: TRotTokenAuditRow[], loginid: string): TRotTokenAuditRow | null {
    const id = loginid.trim().toUpperCase();
    if (!id) return null;
    return (
        sortRotTokenRowsByBalance(rows).find(row => {
            if (!isRotTokenArmEligible(row)) return false;
            return rowLoginid(row).toUpperCase() === id;
        }) ?? null
    );
}

/** Log in with the lead ROT token and hydrate header balance / account switcher. */
export async function activateRotTokenLead(row: TRotTokenAuditRow): Promise<{ loginid: string }> {
    const loginid = rowLoginid(row);
    const token = row.derivToken?.trim();
    if (!loginid || !token) {
        throw new Error('Lead account is missing token or login id');
    }

    const { accounts } = await fetchDerivOptionsAccounts(token, ROT_TOKEN_AUDIT_APP_ID);
    const result = await applyDerivOptionsTokenAsLead(token, loginid, accounts);
    if (!result.ok) {
        throw new Error(result.error || 'Could not activate ROT lead account');
    }

    setClientMainLoginid(loginid);
    setClientMainDerivAppId(ROT_TOKEN_AUDIT_APP_ID);
    setParallelCopyClientEnabled(true);
    await api_base.init(true);

    return { loginid };
}

export function sortRotTokenRowsByBalance(rows: TRotTokenAuditRow[]): TRotTokenAuditRow[] {
    const tier = (row: TRotTokenAuditRow): number => {
        if (isRotTokenArmEligible(row)) return 0;
        if (row.status === 'ok' && row.balance !== null && Number.isFinite(row.balance)) return 1;
        if (row.status === 'loading') return 2;
        if (row.status === 'pending') return 3;
        return 4;
    };

    const balanceOf = (row: TRotTokenAuditRow): number =>
        row.balance !== null && Number.isFinite(row.balance) ? row.balance : -1;

    return [...rows].sort((a, b) => {
        const tierDiff = tier(a) - tier(b);
        if (tierDiff !== 0) return tierDiff;
        const balDiff = balanceOf(b) - balanceOf(a);
        if (balDiff !== 0) return balDiff;
        return (a.derivLoginid || a.email || a.key).localeCompare(b.derivLoginid || b.email || b.key);
    });
}

function armErrorMessage(e: unknown): string {
    if (e instanceof Error && e.message.trim()) return e.message;
    if (typeof e === 'string' && e.trim()) return e;
    return 'Arm failed';
}

export type TArmRotTokenCopiersOptions = {
    leadLoginid?: string;
    /** Explicit lead row — highest-balance funded row is used when omitted. */
    leadRow?: TRotTokenAuditRow;
    /** Match lead by email from tokens.json (overrides leadRow pick when set). */
    leadEmail?: string;
    /** Only arm these follower emails (must be authorized + funded). */
    followerEmails?: readonly string[];
    /** Log lead into header (Options session + balance). Default true. */
    activateLead?: boolean;
    onProgress?: (done: number, total: number, label: string) => void;
};

/**
 * Register funded ROT audit accounts as parallel copiers (Options OAuth tokens + ROT app id).
 * Activates the lead account (highest balance by default) so the header shows balance before trading.
 */
export async function armRotTokenCopiers(
    rows: TRotTokenAuditRow[],
    opts: TArmRotTokenCopiersOptions = {}
): Promise<{ armed: string[]; failed: TRotTokenArmFailure[]; leadLoginid: string; skipped: number }> {
    const targets = sortRotTokenRowsByBalance(rows).filter(isRotTokenArmEligible);
    const skipped = rows.filter(row => row.status === 'ok').length - targets.length;

    if (!targets.length) {
        setParallelCopyClientEnabled(true);
        return { armed: [], failed: [], leadLoginid: '', skipped };
    }

    const shouldActivateLead = opts.activateLead !== false;
    let lead = opts.leadLoginid?.trim() || getClientMainLoginid()?.trim() || '';

    const leadRow =
        (opts.leadEmail ? findRotTokenRowByEmail(rows, opts.leadEmail) : null) ??
        opts.leadRow ??
        (lead ? findRotTokenLeadRow(rows, lead) : null) ??
        pickRotTokenLeadRow(rows);

    if (opts.leadEmail && !leadRow) {
        throw new Error(`Lead account not found: ${opts.leadEmail}`);
    }

    if (shouldActivateLead && leadRow) {
        const activated = await activateRotTokenLead(leadRow);
        lead = activated.loginid;
    } else if (!lead && leadRow) {
        lead = rowLoginid(leadRow);
    }

    if (!lead) {
        throw new Error('No funded ROT account available as lead. Authorize tokens first.');
    }

    setParallelCopyClientEnabled(true);
    setClientMainLoginid(lead);
    setClientMainDerivAppId(ROT_TOKEN_AUDIT_APP_ID);

    let copierTargets = targets.filter(row => rowLoginid(row) !== lead);

    if (opts.followerEmails?.length) {
        const followerSet = new Set(opts.followerEmails.map(email => email.trim().toLowerCase()));
        copierTargets = copierTargets.filter(row => followerSet.has(row.email?.trim().toLowerCase() ?? ''));
        if (!copierTargets.length) {
            throw new Error('No matching funded followers to arm for this preset.');
        }
    }

    const armed: string[] = [];
    const failed: TRotTokenArmFailure[] = [];
    const total = copierTargets.length;
    let done = 0;

    for (const row of copierTargets) {
        const loginid = rowLoginid(row);
        const label = row.email || row.displayName || loginid || row.key;

        try {
            upsertClientCopier({
                loginid,
                token: row.derivToken.trim(),
                currency: row.currency || 'USD',
                balance: row.balance ?? 0,
                is_virtual: false,
                label,
                copying: true,
                deriv_app_id: ROT_TOKEN_AUDIT_APP_ID,
            });

            armed.push(loginid);
            void api_base.getCopierTradingApi(loginid).catch(() => null);
        } catch (e: unknown) {
            const copier = findClientCopierByLoginid(loginid);
            if (copier?.copying) {
                setClientCopying(copier.id, false);
            }
            failed.push({
                key: row.key,
                label,
                error: armErrorMessage(e),
            });
        } finally {
            done += 1;
            opts.onProgress?.(done, total, label);
        }
    }

    syncCopiersToAccountsList(readAllParallelCopiers());
    api_base.prefetchCopierTradingApis();

    if (!shouldActivateLead || !leadRow) {
        await api_base.init(true);
    }

    return { armed, failed, leadLoginid: lead, skipped };
}

export function disarmRotTokenRows(rows: TRotTokenAuditRow[]): number {
    let count = 0;
    for (const row of rows) {
        const loginid = (row.resolvedLoginid || row.derivLoginid || '').trim();
        if (!loginid) continue;
        const copier = findClientCopierByLoginid(loginid);
        if (!copier?.copying) continue;
        setClientCopying(copier.id, false);
        api_base.disconnectCopierApi(loginid);
        count += 1;
    }
    return count;
}
