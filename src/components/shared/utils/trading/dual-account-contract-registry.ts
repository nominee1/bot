/** Maps primary contract_id → mirror contract_id for dual-account sells. */
const primaryToMirror = new Map<string, string>();

export function registerMirrorContractPair(primaryContractId: string, mirrorContractId: string): void {
    if (!primaryContractId || !mirrorContractId) return;
    primaryToMirror.set(String(primaryContractId), String(mirrorContractId));
}

export function getMirrorContractId(primaryContractId: string): string | undefined {
    return primaryToMirror.get(String(primaryContractId));
}

export function unregisterMirrorContractPair(primaryContractId: string): void {
    primaryToMirror.delete(String(primaryContractId));
}

export function clearMirrorContractRegistry(): void {
    primaryToMirror.clear();
}
