import { isDerivOptionsOAuthSession } from '@/components/shared/utils/login/deriv-oauth-storage';
import {
    sendDerivSessionContractPurchase,
    tradeOptionsToDerivBuyIntent,
} from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import {
    executeBotEngineCrShadowPurchase,
    resolveCrShadowWalletLoginid,
    shouldUseCrShadowLiveFills,
} from '@/utils/botEngineCrShadowPurchase';
import { LogTypes } from '../../../constants/messages';
import DBotStore from '../../../scratch/dbot-store';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { purchaseSuccessful, sell } from './state/actions';
import { BEFORE_PURCHASE, NEW_TICK } from './state/constants';

/** Pause after virtual settle before STOP → trade_again (mirrors async real-bot spacing). */
const CR_SHADOW_AFTER_COMPLETE_MS = 2000;

let delayIndex = 0;
let purchase_reference;

export default Engine =>
    class Purchase extends Engine {
        purchase(contract_type) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            const onSuccess = response => {
                // Don't unnecessarily send a forget request for a purchased contract.
                const { buy } = response;

                contractStatus({
                    id: 'contract.purchase_received',
                    data: buy.transaction_id,
                    buy,
                });

                this.contractId = buy.contract_id;
                this.store.dispatch(purchaseSuccessful());

                if (this.is_proposal_subscription_required) {
                    this.renewProposalsOnPurchase();
                }

                delayIndex = 0;
                log(LogTypes.PURCHASE, { longcode: buy.longcode, transaction_id: buy.transaction_id });
                info({
                    accountID: this.accountInfo.loginid,
                    totalRuns: this.updateAndReturnTotalRuns(),
                    transaction_ids: { buy: buy.transaction_id },
                    contract_type,
                    buy_price: buy.buy_price,
                });
            };

            // CR7557018 / ROT90381442 — Flipaa buy-after-fact virtual settlement (no real Deriv buy).
            const tryCrShadowVirtual = async () => {
                const client = DBotStore?.instance?.client;
                const walletLogin = resolveCrShadowWalletLoginid(client?.loginid, api_base?.account_info?.loginid);
                if (!shouldUseCrShadowLiveFills(walletLogin, client?.loginid)) {
                    return false;
                }

                this.isSold = false;
                this.contractId = `v-pending-${Date.now()}`;
                this.store.dispatch(purchaseSuccessful());
                contractStatus({
                    id: 'contract.purchase_sent',
                    data: this.tradeOptions?.amount,
                });

                const unstickScope = () => {
                    try {
                        this.contractId = '';
                        this.store.dispatch(sell());
                    } catch {
                        /* ignore */
                    }
                };

                let shadow;
                try {
                    shadow = await executeBotEngineCrShadowPurchase({
                        client,
                        tradeOptions: this.tradeOptions,
                        symbolFallback: this.options?.symbol,
                        contractType: contract_type,
                    });
                } catch (err) {
                    unstickScope();
                    throw err;
                }

                if (!shadow) {
                    unstickScope();
                    return true;
                }

                onSuccess(shadow.buyResponse);

                const bumpTick = () => {
                    try {
                        this.store.dispatch({
                            type: NEW_TICK,
                            payload: Date.now() + Math.random(),
                        });
                    } catch {
                        /* ignore */
                    }
                };

                if (typeof this.processContractUpdate === 'function') {
                    this.processContractUpdate(shadow.openContract, shadow.walletLoginId);
                    bumpTick();
                }

                const openDisplayMs = 120;
                clearTimeout(this._crShadowSettleTimer);
                this._crShadowSettleTimer = window.setTimeout(() => {
                    this._crShadowSettleTimer = null;
                    try {
                        if (typeof this.processContractUpdate !== 'function') return;
                        if (!api_base?.is_running) return;
                        this.processContractUpdate(shadow.soldContract, shadow.walletLoginId, {
                            afterCompleteDelayMs: CR_SHADOW_AFTER_COMPLETE_MS,
                        });
                        bumpTick();
                    } catch {
                        /* ignore settle races */
                    }
                }, openDisplayMs);

                return true;
            };

            return tryCrShadowVirtual().then(handled => {
                if (handled) return undefined;

                if (this.is_proposal_subscription_required) {
                    const { id, askPrice } = this.selectProposal(contract_type);

                    const action = () => api_base.api.send({ buy: id, price: askPrice });

                    this.isSold = false;

                    contractStatus({
                        id: 'contract.purchase_sent',
                        data: askPrice,
                    });

                    if (!this.options.timeMachineEnabled) {
                        return doUntilDone(action).then(onSuccess);
                    }

                    return recoverFromError(
                        action,
                        (errorCode, makeDelay) => {
                            // if disconnected no need to resubscription (handled by live-api)
                            if (errorCode !== 'DisconnectError') {
                                this.renewProposalsOnPurchase();
                            } else {
                                this.clearProposals();
                            }

                            const unsubscribe = this.store.subscribe(() => {
                                const { scope, proposalsReady } = this.store.getState();
                                if (scope === BEFORE_PURCHASE && proposalsReady) {
                                    makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                    unsubscribe();
                                }
                            });
                        },
                        ['PriceMoved', 'InvalidContractProposal'],
                        delayIndex++
                    ).then(onSuccess);
                }
                const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);
                const action = () => {
                    if (isDerivOptionsOAuthSession()) {
                        return sendDerivSessionContractPurchase(
                            data => api_base.api.send(data),
                            tradeOptionsToDerivBuyIntent(contract_type, this.tradeOptions)
                        );
                    }
                    return api_base.api.send(trade_option);
                };

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: this.tradeOptions.amount,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(onSuccess);
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
                        if (errorCode === 'DisconnectError') {
                            this.clearProposals();
                        }
                        const unsubscribe = this.store.subscribe(() => {
                            const { scope } = this.store.getState();
                            if (scope === BEFORE_PURCHASE) {
                                makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(onSuccess);
            });
        }
        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };
