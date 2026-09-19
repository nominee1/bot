import type ClientStore from '@/stores/client-store';

/** bot-1 has no Railway Fury ledger — keep the Denara import surface as a no-op. */
export function hasPendingSharedVirtualLedgerSync(): boolean {
    return false;
}

export async function pushSharedVirtualLedgerPnl(pnlDelta: number): Promise<number | null> {
    void pnlDelta;
    return null;
}

export function scheduleSharedVirtualLedgerPnlSync(
    client: ClientStore | null | undefined,
    walletLoginId: string | undefined | null,
    pnlDelta: number
): void {
    void client;
    void walletLoginId;
    void pnlDelta;
}
