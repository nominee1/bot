import { isDerivOptionsOAuthSession } from '@/components/shared/utils/login/deriv-oauth-storage';
import {
    sendDerivSessionContractPurchase,
    tradeOptionsToDerivBuyIntent,
} from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import { isBotEmbed } from '@/utils/bot-embed';
import {
    beginCrShadowHedgeRound,
    executeBotEngineCrShadowPurchase,
    getCrShadowLatestQuote,
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

/** Pause after virtual settle before STOP → trade_again (gives balance UI time to settle). */
const CR_SHADOW_AFTER_COMPLETE_MS = 1500;

/** ~1s per tick — matches Volatility index tick cadence on Deriv Bot. */
const CR_SHADOW_MS_PER_TICK = 1000;

/** Pending virtual UI settles — timers finish entry/exit on schedule even after Stop. */
const pendingShadowUiSettles = new Set();
/** Fired once when the last pending settle clears (Stop keeps bot.contract until then). */
const pendingShadowUiSettlesClearListeners = new Set();

export function hasPendingShadowUiSettles() {
    return pendingShadowUiSettles.size > 0;
}

/** Run `cb` when no virtual UI settles remain (immediately if already clear). */
export function onPendingShadowUiSettlesClear(cb) {
    if (typeof cb !== 'function') return () => {};
    if (pendingShadowUiSettles.size === 0) {
        cb();
        return () => {};
    }
    pendingShadowUiSettlesClearListeners.add(cb);
    return () => {
        pendingShadowUiSettlesClearListeners.delete(cb);
    };
}

function notifyPendingShadowUiSettlesClear() {
    if (pendingShadowUiSettles.size > 0) return;
    const listeners = [...pendingShadowUiSettlesClearListeners];
    pendingShadowUiSettlesClearListeners.clear();
    listeners.forEach(cb => {
        try {
            cb();
        } catch {
            /* ignore */
        }
    });
}

/** Emergency only (e.g. hard terminate). Stop must NOT call this — let open trades settle normally. */
export function flushPendingShadowUiSettles() {
    [...pendingShadowUiSettles].forEach(entry => {
        try {
            entry.flush();
        } catch {
            /* ignore settle races */
        }
    });
    pendingShadowUiSettles.clear();
    notifyPendingShadowUiSettlesClear();
}

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
            let types = this._roundPurchaseTypes || [];
            this._roundPurchaseTypes = [];
            // Contract type "Both" lists both sides (RUNHIGH+RUNLOW). If every stacked
            // Purchase collapsed onto the first side, buy one of each instead of two Only Ups.
            const available = [
                ...new Set(
                    (this.options?.contractTypes || this.tradeOptions?.contractTypes || []).filter(
                        type => type && type !== 'both'
                    )
                ),
            ];
            if (
                types.length >= 2 &&
                available.length >= 2 &&
                types.every(type => type === types[0]) &&
                available.includes(types[0])
            ) {
                types = types.map((_, index) => available[index % available.length]);
            }
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
                // Fresh entry for this round only — legs share ticks; next trade must not reuse them.
                beginCrShadowHedgeRound();
                // Start every leg together so Only Ups and Only Downs share one tick window.
                await Promise.all(
                    types.map(contract_type => {
                        if (Number.isFinite(hedgeStake) && hedgeStake > 0 && this.tradeOptions) {
                            this.tradeOptions.amount = hedgeStake;
                        }
                        return this._executePurchase(contract_type, {
                            stake: hedgeStake,
                            barrier: hedgeBarrier,
                        });
                    })
                );
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

                const ticks = Math.max(1, Number(this.tradeOptions?.duration) || 1);
                const unit = String(this.tradeOptions?.duration_unit || 't').toLowerCase();
                const msPerUnit = unit === 'm' || unit === 'min' ? 60_000 : unit === 's' ? 1000 : CR_SHADOW_MS_PER_TICK;
                const entryRevealMs = msPerUnit; // entry after 1 tick
                const settleMs = ticks * msPerUnit; // exit + P/L after full duration
                const startedAt = Date.now();
                const stake = Number(shadow.openContract?.buy_price) || 0;
                const payout = Number(shadow.openContract?.payout) || 0;
                const terminal = Number(shadow.soldContract?.sell_price);
                const roundMoney = value => Math.round(Number(value) * 100) / 100;
                const contractType = String(shadow.openContract?.contract_type || '');
                const isRangeContract = contractType === 'RANGE' || contractType === 'UPORDOWN';
                let markClosed = false;
                let smoothedValue = stake;
                let lastPublishedKey = '';

                const barrierLevel = (entry, raw) => {
                    if (raw === undefined || raw === null || raw === '') return null;
                    const text = String(raw).trim();
                    const n = Number(text);
                    if (!Number.isFinite(n)) return null;
                    if (/^[+-]/.test(text)) return entry + n;
                    if (Math.abs(entry) > 1 && Math.abs(n) < Math.abs(entry) * 0.5) return entry + n;
                    return n;
                };

                // Contract value from where the spot sits against the two barriers.
                // Winning side moves toward the payout. Losing side can fall to 0 (P/L negative).
                const rangeContractValue = spot => {
                    const entry = Number(shadow.openContract?.entry_spot);
                    if (!Number.isFinite(entry) || !Number.isFinite(spot)) return null;
                    const lowHighA = barrierLevel(entry, shadow.openContract?.barrier);
                    const lowHighB = barrierLevel(entry, shadow.openContract?.barrier2);
                    if (lowHighA == null || lowHighB == null) return null;
                    const low = Math.min(lowHighA, lowHighB);
                    const high = Math.max(lowHighA, lowHighB);
                    const width = Math.max(high - low, 1e-8);
                    const inside = spot > low && spot < high;
                    const winning = contractType === 'UPORDOWN' ? !inside : inside;
                    if (winning) {
                        const edge = inside
                            ? Math.min(spot - low, high - spot)
                            : spot >= high
                              ? spot - high
                              : low - spot;
                        const comfort = Math.min(1, edge / (width * 0.2));
                        return stake + (payout - stake) * comfort;
                    }
                    const depth = inside
                        ? Math.min(spot - low, high - spot) / (width / 2)
                        : Math.min(1, (spot >= high ? spot - high : low - spot) / (width * 0.2));
                    return Math.max(0, stake * (1 - Math.min(1, depth)));
                };

                // Open contract: other types walk from the stake to the close once a second.
                // Stays Between / Goes Outside follow the spot, smoothed so one tick cannot
                // strobe the summary. P/L can go negative. The sold row is still the win.
                const markedContract = () => {
                    const elapsed = Date.now() - startedAt;
                    const progress = Math.min(1, Math.max(0, elapsed / Math.max(1, settleMs)));
                    let value = stake + (terminal - stake) * progress;
                    if (isRangeContract) {
                        const spot = getCrShadowLatestQuote();
                        const fromSpot = rangeContractValue(spot);
                        let target = fromSpot == null ? value : fromSpot;
                        if (progress > 0.88) {
                            target += (terminal - target) * ((progress - 0.88) / 0.12);
                        }
                        smoothedValue = smoothedValue * 0.62 + target * 0.38;
                        value = smoothedValue;
                    }
                    value = roundMoney(value);
                    const profit = roundMoney(value - stake);
                    const revealed = elapsed >= entryRevealMs;
                    const base = revealed ? shadow.openContract : shadow.pendingContract || shadow.openContract;
                    return {
                        ...base,
                        bid_price: value,
                        profit,
                        is_sold: false,
                        is_expired: false,
                        status: 'open',
                    };
                };

                const publishMark = () => {
                    if (markClosed) return;
                    const next = markedContract();
                    const key = `${next.profit}|${next.bid_price}`;
                    if (key === lastPublishedKey) return;
                    lastPublishedKey = key;
                    publish(next);
                };

                // Immediate row: stake, with P/L at 0 and contract value at the stake.
                publishMark();

                const settleEntry = {
                    entryTimer: null,
                    settleTimer: null,
                    markTimer: null,
                    flush: null,
                };

                const clearPending = () => {
                    pendingShadowUiSettles.delete(settleEntry);
                    markClosed = true;
                    if (settleEntry.entryTimer) clearTimeout(settleEntry.entryTimer);
                    if (settleEntry.settleTimer) clearTimeout(settleEntry.settleTimer);
                    if (settleEntry.markTimer) clearInterval(settleEntry.markTimer);
                    settleEntry.entryTimer = null;
                    settleEntry.settleTimer = null;
                    settleEntry.markTimer = null;
                    notifyPendingShadowUiSettlesClear();
                };

                const settleSold = () => {
                    try {
                        if (typeof this.processContractUpdate === 'function') {
                            // Sold row first — credit must not land before exit/P&L is visible.
                            this.processContractUpdate(shadow.soldContract, shadow.walletLoginId, {
                                afterCompleteDelayMs: CR_SHADOW_AFTER_COMPLETE_MS,
                            });
                        }
                    } catch {
                        /* ignore settle races */
                    }
                    try {
                        shadow.completeLedgerCredit?.();
                    } catch {
                        /* ignore ledger races */
                    }
                    bumpTick();
                };

                settleEntry.flush = () => {
                    // Publish sold first — clearPending notifies Stop handlers that unregister
                    // bot.contract; doing clear first would drop the settle update.
                    markClosed = true;
                    if (settleEntry.markTimer) {
                        clearInterval(settleEntry.markTimer);
                        settleEntry.markTimer = null;
                    }
                    try {
                        settleSold();
                    } finally {
                        clearPending();
                    }
                };
                pendingShadowUiSettles.add(settleEntry);

                if (settleMs > 1000) {
                    settleEntry.markTimer = window.setInterval(publishMark, 1000);
                }

                // After 1 tick: reveal entry (1-tick contracts also settle here).
                // Always finish an already-purchased contract — even if the user hits Stop.
                settleEntry.entryTimer = window.setTimeout(() => {
                    try {
                        if (ticks <= 1) {
                            settleEntry.flush();
                            return;
                        }
                        publishMark();
                    } catch {
                        /* ignore reveal races */
                    }
                }, entryRevealMs);

                // Multi-tick: settle after full duration (exit + P/L).
                if (ticks > 1) {
                    settleEntry.settleTimer = window.setTimeout(() => {
                        settleEntry.flush();
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
