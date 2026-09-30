import { getRoundedNumber } from '@/components/shared';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { openContractReceived, sell } from './state/actions';
import { DURING_PURCHASE } from './state/constants';

const contractIdsMatch = (expected, incoming) => {
    if (expected == null || incoming == null) return false;
    const left = String(expected);
    const right = String(incoming);
    if (left.startsWith('v-') || right.startsWith('v-')) return left === right;
    return Number(expected) === Number(incoming);
};

const isContractSold = contract => {
    const { is_sold, status } = contract || {};
    return Boolean(is_sold) || status === 'sold' || status === 'won' || status === 'lost' || status === 'cancelled';
};

const mergeHedgeContracts = contracts => {
    const first = contracts[0] || {};
    const buyPrice = contracts.reduce((sum, contract) => sum + Number(contract.buy_price || 0), 0);
    const sellPrice = contracts.reduce((sum, contract) => sum + Number(contract.sell_price || 0), 0);
    // Keep the first leg's contract_type — joining as "HIGHER+LOWER" overwrites the
    // transaction row and paints the wrong TradeTypeIcon. Each leg is already broadcast.
    return {
        ...first,
        buy_price: buyPrice,
        sell_price: sellPrice,
        profit: sellPrice - buyPrice,
        contract_type: first.contract_type,
    };
};

export default Engine =>
    class OpenContract extends Engine {
        observeOpenContract() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type !== 'proposal_open_contract') {
                    return;
                }

                const contract = data.proposal_open_contract;
                if (!contract || !this.expectedContractId(contract?.contract_id)) {
                    return;
                }

                this.processContractUpdate(contract, api_base.account_info?.loginid);
            });
            api_base.pushSubscription(subscription);
        }

        processContractUpdate(raw, accountID, options = {}) {
            if (this._purchaseRoundOpen) {
                if (!this._bufferedContractUpdates) this._bufferedContractUpdates = [];
                this._bufferedContractUpdates.push({ raw, accountID, options });
                return;
            }

            const contract = raw;
            const legs = this.hedgeLegs || [];
            if (legs.length > 1) {
                this._applyHedgeUpdate(contract, accountID, options);
                return;
            }

            this.setContractFlags(contract);
            this.data.contract = contract;
            broadcastContract({ accountID, ...contract });

            if (!this.isSold) {
                this.store.dispatch(openContractReceived());
                return;
            }

            this.contractId = '';
            this.hedgeLegs = [];
            clearTimeout(this.transaction_recovery_timeout);
            this.updateTotals(contract);
            contractStatus({
                id: 'contract.sold',
                data: contract.transaction_ids?.sell,
                contract,
            });

            this._finishPurchaseCycle(options);
        }

        _applyHedgeUpdate(contract, accountID, options) {
            const leg = (this.hedgeLegs || []).find(item => contractIdsMatch(item.id, contract?.contract_id));
            if (!leg) return;

            broadcastContract({ accountID, ...contract });
            const sold = isContractSold(contract);
            if (!sold) {
                this.data.contract = contract;
                this.setContractFlags(contract);
                this.store.dispatch(openContractReceived());
                return;
            }

            leg.settled = contract;
            this.finishHedgeIfReady(options);
        }

        finishHedgeIfReady(options = {}) {
            const legs = this.hedgeLegs || [];
            if (legs.length < 2 || legs.some(leg => !leg.settled)) return false;
            if (this.store.getState().scope !== DURING_PURCHASE) return false;

            const merged = mergeHedgeContracts(legs.map(leg => leg.settled));
            this.hedgeLegs = [];
            this.contractId = '';
            this.isSold = true;
            this.data.contract = merged;
            clearTimeout(this.transaction_recovery_timeout);
            // Totals only — do not re-broadcast merged to the journal (would clobber a leg's type/icon).
            this.updateTotals(merged);
            contractStatus({
                id: 'contract.sold',
                data: merged.transaction_ids?.sell,
                contract: merged,
            });
            this._finishPurchaseCycle(options);
            return true;
        }

        _finishPurchaseCycle(options = {}) {
            const finishCycle = () => {
                if (this.afterPromise) {
                    const resolve = this.afterPromise;
                    this.afterPromise = null;
                    resolve();
                }
                this.store.dispatch(sell());
            };

            const delayMs = Number(options?.afterCompleteDelayMs) || 0;
            if (delayMs > 0) {
                clearTimeout(this._crShadowAfterCompleteTimer);
                this._crShadowAfterCompleteTimer = window.setTimeout(() => {
                    this._crShadowAfterCompleteTimer = null;
                    // Always finish the purchase cycle for an already-open contract,
                    // even if the user hit Stop mid-trade.
                    finishCycle();
                }, delayMs);
                return;
            }

            finishCycle();
        }

        waitForAfter() {
            return new Promise(resolve => {
                this.afterPromise = resolve;
            });
        }

        setContractFlags(contract) {
            const { is_expired, is_valid_to_sell, is_sold, entry_tick, entry_spot, status } = contract;

            this.isSold =
                Boolean(is_sold) ||
                status === 'sold' ||
                status === 'won' ||
                status === 'lost' ||
                status === 'cancelled';
            this.isSellAvailable = !this.isSold && Boolean(is_valid_to_sell);
            this.isExpired = Boolean(is_expired);
            this.hasEntryTick = Boolean(entry_tick ?? entry_spot);
        }

        expectedContractId(contractId) {
            const ids = [];
            if (this.contractId) ids.push(this.contractId);
            (this.hedgeLegs || []).forEach(leg => {
                if (leg?.id != null) ids.push(leg.id);
            });
            if (!ids.length || contractId == null) return false;
            return ids.some(id => contractIdsMatch(id, contractId));
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };
