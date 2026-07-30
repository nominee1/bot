import { getRoundedNumber } from '@/components/shared';
import { normalizeProposalOpenContractForBotUI } from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import { isFastTradeExecution } from '@/utils/trade-execution-mode';
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

                const raw = data.proposal_open_contract;
                if (!raw) {
                    return;
                }

                const accountID =
                    api_base.account_info?.loginid || api_base.account_id || localStorage.getItem('active_loginid');

                // Fast mode already closed on the sell transaction — only refresh UI from POC.
                if (
                    isFastTradeExecution() &&
                    this._fastClosedContractId != null &&
                    Number(this._fastClosedContractId) === Number(raw.contract_id)
                ) {
                    const contract = normalizeProposalOpenContractForBotUI(raw);
                    if (contract) {
                        this.data.contract = contract;
                        broadcastContract({ accountID, ...contract });
                    }
                    this._fastClosedContractId = null;
                    return;
                }

                if (!this.expectedContractId(raw.contract_id)) {
                    return;
                }

                this.processContractUpdate(raw, accountID);
            });
            api_base.pushSubscription(subscription);
        }

        /**
         * Close the trade cycle from the sell transaction stream (fast mode).
         * Avoids waiting for proposal_open_contract — that lag is why FAST felt like NORMAL.
         */
        handleFastSellTransaction(transaction) {
            const current = this.data.contract || {};
            if (this._fastClosedContractId === transaction.contract_id) {
                return;
            }
            this._fastClosedContractId = transaction.contract_id;

            const buy_price = Number(current.buy_price ?? 0);
            const sell_price = Number(transaction.amount ?? 0);
            const accountID =
                api_base.account_info?.loginid || api_base.account_id || localStorage.getItem('active_loginid');

            const synthetic = {
                ...current,
                contract_id: transaction.contract_id,
                sell_price,
                profit: sell_price - buy_price,
                bid_price: sell_price,
                is_sold: true,
                is_expired: true,
                is_valid_to_sell: false,
                status: 'sold',
                transaction_ids: {
                    ...(current.transaction_ids ?? {}),
                    sell: transaction.transaction_id,
                },
            };

            this.processContractUpdate(synthetic, accountID);
        }

        processContractUpdate(raw, accountID) {
            const contract = normalizeProposalOpenContractForBotUI(raw);
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

            this.resolveAfterPurchase();
            // Keep _fastClosedContractId until POC arrives so UI can refresh (see observeOpenContract).
            this.store.dispatch(sell());
        }

        resolveAfterPurchase() {
            if (!this.afterPromise) {
                return;
            }
            const resolve = this.afterPromise;
            this.afterPromise = null;
            resolve();
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
            return Number(contractId) === Number(this.contractId);
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };
