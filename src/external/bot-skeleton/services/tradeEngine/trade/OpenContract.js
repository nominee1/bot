import { getRoundedNumber } from '@/components/shared';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { openContractReceived, sell } from './state/actions';

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
            const contract = raw;
            this.setContractFlags(contract);
            this.data.contract = contract;
            broadcastContract({ accountID, ...contract });

            if (!this.isSold) {
                this.store.dispatch(openContractReceived());
                return;
            }

            this.contractId = '';
            clearTimeout(this.transaction_recovery_timeout);
            this.updateTotals(contract);
            contractStatus({
                id: 'contract.sold',
                data: contract.transaction_ids?.sell,
                contract,
            });

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
                    if (!api_base?.is_running) return;
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
            if (!this.contractId || contractId == null) return false;
            const expected = String(this.contractId);
            const incoming = String(contractId);
            if (expected.startsWith('v-') || incoming.startsWith('v-')) {
                return expected === incoming;
            }
            return Number(contractId) === Number(this.contractId);
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };
