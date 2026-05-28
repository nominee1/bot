/** primary contract_id → copier loginid → copier contract_id */
const primaryToCopierContracts = new Map<string, Map<string, string>>();

export function registerCopierContractPair(
    primaryContractId: string,
    copierLoginid: string,
    copierContractId: string
): void {
    if (!primaryContractId || !copierLoginid || !copierContractId) return;
    const key = String(primaryContractId);
    if (!primaryToCopierContracts.has(key)) {
        primaryToCopierContracts.set(key, new Map());
    }
    primaryToCopierContracts.get(key)!.set(copierLoginid, String(copierContractId));
}

export function getCopierContractMap(primaryContractId: string): Map<string, string> {
    return new Map(primaryToCopierContracts.get(String(primaryContractId)) ?? []);
}

export function clearCopierContractRegistry(): void {
    primaryToCopierContracts.clear();
}
