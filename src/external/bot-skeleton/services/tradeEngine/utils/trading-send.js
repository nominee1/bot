import { registerMirrorContractPair } from '@/components/shared/utils/trading/dual-account-contract-registry';
import { mirrorSellForPrimaryContract } from '@/components/shared/utils/trading/dual-account-mirror';
import {
    mirrorSellAllCopiersForPrimary,
    mirrorTradeOptionBuyToAllCopiers,
} from '@/utils/parallel-copiers/parallel-copiers-mirror';
import {
    adjustTradeOptionsForLoginid,
    getMirrorLoginidForActive,
    isDualAccountTradeEnabled,
} from '@/components/shared/utils/trading/dual-account-trade';
import { api_base } from '../../api/api-base';
import { tradeOptionToBuy } from './helpers';

/**
 * Mirror buy on the paired demo/real account. Failures are logged but do not block the primary trade.
 * @returns {Promise<string|null>} mirror contract_id
 */
export async function executeMirrorPurchase(contract_type, tradeOptions, engine = null) {
    if (!isDualAccountTradeEnabled() || !tradeOptions) return null;

    const mirrorLoginid = getMirrorLoginidForActive(api_base.account_id);
    if (!mirrorLoginid) return null;

    const mirrorApi = await api_base.getMirrorTradingApi();
    if (!mirrorApi) return null;

    const adjusted = adjustTradeOptionsForLoginid(tradeOptions, mirrorLoginid);
    const payload = tradeOptionToBuy(contract_type, adjusted);

    try {
        const response = await mirrorApi.send(payload);
        const mirrorId = response?.buy?.contract_id ?? null;
        const primaryId = engine?.contractId;
        if (mirrorId && primaryId) {
            registerMirrorContractPair(String(primaryId), String(mirrorId));
        }
        return mirrorId;
    } catch {
        return null;
    }
}

/** Fire-and-forget mirror buy; stores contract id on the engine when resolved. */
export function startMirrorPurchase(engine, contract_type) {
    if (!engine?.tradeOptions) return;
    engine.mirrorContractId = null;

    const primaryId = engine.contractId ? String(engine.contractId) : null;
    void mirrorTradeOptionBuyToAllCopiers(contract_type, engine.tradeOptions, primaryId);

    if (!isDualAccountTradeEnabled()) return;

    void executeMirrorPurchase(contract_type, engine.tradeOptions, engine).then(contractId => {
        if (contractId) {
            engine.mirrorContractId = contractId;
            if (engine.contractId) {
                registerMirrorContractPair(String(engine.contractId), String(contractId));
            }
        }
    });
}

/** Sell the mirror contract if dual trading created one. */
export async function executeMirrorSell(primary_contract_id) {
    if (!primary_contract_id) return;
    const id = String(primary_contract_id);
    await mirrorSellAllCopiersForPrimary(id, 0);
    if (!isDualAccountTradeEnabled()) return;
    await mirrorSellForPrimaryContract(id, 0);
}
