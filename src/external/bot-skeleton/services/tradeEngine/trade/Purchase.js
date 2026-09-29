import { isDerivOptionsOAuthSession } from '@/components/shared/utils/login/deriv-oauth-storage';
import {
    sendDerivSessionContractPurchase,
    tradeOptionsToDerivBuyIntent,
} from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import { isBotEmbed } from '@/utils/bot-embed';
import {
    executeBotEngineCrShadowPurchase,
    resolveCrShadowWalletLoginid,
    shouldUseCrShadowLiveFills,
} from '@/utils/botEngineCrShadowPurchase';
import { getHandoffShadowLoginid } from '@/utils/deriv1SessionHandoff';
import { LogTypes } from '../../../constants/messages';
import DBotStore from '../../../scratch/dbot-store';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { purchaseSuccessful, sell } from './state/actions';
import { BEFORE_PURCHASE, NEW_TICK } from './state/constants';

/** Pause after virtual settle before STOP → trade_again. Keep near-zero so the next buy is immediate. */
const CR_SHADOW_AFTER_COMPLETE_MS = 0;

/** ~1s per tick — matches Volatility index tick cadence on Deriv Bot. */
const CR_SHADOW_MS_PER_TICK = 1000;

let delayIndex = 0;
let purchase_reference;

export default Engine =>
    class Purchase extends Engine {
        purchase(contract_type) {
            // Stacked Purchase blocks buy together. Queue types here and buy in
            // commitPurchases so both legs share the round (true hedge) instead of
            // racing two async fills where the second leg often fails.
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            if (!this._purchaseRoundOpen) {
                this._purchaseRoundOpen = true;
                this._roundPurchaseTypes = [];
                this.hedgeLegs = [];
                this._bufferedContractUpdates = [];
            }

            this._roundPurchaseTypes.push(contract_type);
            return Promise.resolve();
        }

        commitPurchases() {
            const types = this._roundPurchaseTypes || [];
            this._roundPurchaseTypes = [];
            // Lock stake + barrier once for the round so Both (Higher+Lower) cannot drift.
            // Barrier stays the relative offset from trade options (e.g. +0.37 from the stake-1
            // quote); both legs debit the current workspace stake (e.g. 2).
            const hedgeStake = Number(this.tradeOptions?.amount);
            const hedgeBarrier =
                this.tradeOptions?.barrierOffset ??
                this.tradeOptions?.barrier ??
                this.tradeOptions?.barrier_1 ??
                this.tradeOptions?.prediction;

            if (Number.isFinite(hedgeStake) && hedgeStake > 0 && this.tradeOptions) {
                this.tradeOptions.amount = hedgeStake;
            }

            const run = async () => {
                for (const contract_type of types) {
                    if (Number.isFinite(hedgeStake) && hedgeStake > 0 && this.tradeOptions) {
                        this.tradeOptions.amount = hedgeStake;
                    }
                    // eslint-disable-next-line no-await-in-loop
                    await this._executePurchase(contract_type, {
                        stake: hedgeStake,
                        barrier: hedgeBarrier,
                    });
                }
            };

            return run().then(() => {
                this._purchaseRoundOpen = false;
                const bought = (this.hedgeLegs || []).length;
                const stillBefore = this.store.getState().scope === BEFORE_PURCHASE;

                if (bought && stillBefore) {
                    this.store.dispatch(purchaseSuccessful());
                    if (this.is_proposal_subscription_required) {
                        this.renewProposalsOnPurchase();
                    }
                }

                const buffered = this._bufferedContractUpdates || [];
                this._bufferedContractUpdates = [];
                buffered.forEach(({ raw, accountID, options }) => {
                    this.processContractUpdate(raw, accountID, options);
                });

                if (typeof this.finishHedgeIfReady === 'function') {
                    this.finishHedgeIfReady();
                }
            });
        }

        _rememberPurchase(buy) {
            const id = buy.contract_id;
            if (!this.hedgeLegs) this.hedgeLegs = [];
            if (this.hedgeLegs.length === 0) {
                this._roundRuns = this.updateAndReturnTotalRuns();
            }
            this.hedgeLegs.push({ id, settled: null });
            if (!this.contractId || String(this.contractId).startsWith('v-pending')) {
                this.contractId = id;
            }
        }

        _executePurchase(contract_type, hedgeLock = {}) {
            const onSuccess = response => {
                // Don't unnecessarily send a forget request for a purchased contract.
                const { buy } = response;

                contractStatus({
                    id: 'contract.purchase_received',
                    data: buy.transaction_id,
                    buy,
                });

                this._rememberPurchase(buy);

                delayIndex = 0;
                log(LogTypes.PURCHASE, { longcode: buy.longcode, transaction_id: buy.transaction_id });
                info({
                    accountID: this.accountInfo.loginid,
                    totalRuns: this._roundRuns,
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
                        stakeOverride: hedgeLock?.stake,
                        barrierOverride: hedgeLock?.barrier,
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

                const publish = contract => {
                    if (typeof this.processContractUpdate !== 'function') return;
                    this.processContractUpdate(contract, shadow.walletLoginId);
                    bumpTick();
                };

                // Immediate row: stake only, entry/exit/P&L skeleton (Deriv Bot style).
                publish(shadow.pendingContract || shadow.openContract);

                const ticks = Math.max(1, Number(this.tradeOptions?.duration) || 1);
                const unit = String(this.tradeOptions?.duration_unit || 't').toLowerCase();
                const msPerUnit = unit === 'm' || unit === 'min' ? 60_000 : unit === 's' ? 1000 : CR_SHADOW_MS_PER_TICK;
                const entryRevealMs = msPerUnit; // entry after 1 tick
                const settleMs = ticks * msPerUnit; // exit + P/L after full duration

                // After 1 tick: reveal entry (1-tick contracts also settle here).
                window.setTimeout(() => {
                    try {
                        if (!api_base?.is_running) return;
                        if (ticks <= 1) {
                            if (typeof this.processContractUpdate !== 'function') return;
                            this.processContractUpdate(shadow.soldContract, shadow.walletLoginId, {
                                afterCompleteDelayMs: CR_SHADOW_AFTER_COMPLETE_MS,
                            });
                            bumpTick();
                            return;
                        }
                        publish(shadow.openContract);
                    } catch {
                        /* ignore reveal races */
                    }
                }, entryRevealMs);

                // Multi-tick: settle after full duration (exit + P/L).
                if (ticks > 1) {
                    window.setTimeout(() => {
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
                    }, settleMs);
                }

                return true;
            };

            return tryCrShadowVirtual().then(handled => {
                if (handled) return undefined;

                // Embed / virtual-ledger sessions must never hit live Options buy (InputValidationFailed).
                if (getHandoffShadowLoginid() || isBotEmbed() || shouldUseCrShadowLiveFills()) {
                    throw new Error('Virtual settlement could not start. Check market / stake, then try Run again.');
                }

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
