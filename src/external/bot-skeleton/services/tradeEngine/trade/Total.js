import { getRoundedNumber } from '@/components/shared';
import { localize } from '@deriv-com/translations';
import { LogTypes } from '../../../constants/messages';
import { createError } from '../../../utils/error';
import { observer as globalObserver } from '../../../utils/observer';
import { info, log } from '../utils/broadcast';

const skeleton = {
    totalProfit: 0,
    totalWins: 0,
    totalLosses: 0,
    totalStake: 0,
    totalPayout: 0,
    totalRuns: 0,
};

const globalStat = {};

export default Engine =>
    class Total extends Engine {
        constructor() {
            super();
            this.sessionRuns = 0;
            this.sessionProfit = 0;
            this._consecutiveLosses = 0;
            this._consecutiveWins = 0;

            globalObserver.register('statistics.clear', this.clearStatistics.bind(this));
        }

        clearStatistics() {
            this.sessionRuns = 0;
            this.sessionProfit = 0;
            this._consecutiveLosses = 0;
            this._consecutiveWins = 0;
            if (!this.accountInfo) return;
            const { loginid: accountID } = this.accountInfo;
            globalStat[accountID] = { ...skeleton };
        }

        updateTotals(contract) {
            const { sell_price: sellPrice, buy_price: buyPrice, currency, profit: contractProfit } = contract;

            const buy = Number(buyPrice);
            const sell = Number(sellPrice);
            const profit =
                contractProfit != null && Number.isFinite(Number(contractProfit))
                    ? getRoundedNumber(Number(contractProfit), currency)
                    : getRoundedNumber((Number.isFinite(sell) ? sell : 0) - (Number.isFinite(buy) ? buy : 0), currency);

            const win = profit > 0;

            if (win) {
                this._consecutiveWins = (this._consecutiveWins || 0) + 1;
                this._consecutiveLosses = 0;
                this._u8LossCount = 0;
            } else {
                this._consecutiveLosses = (this._consecutiveLosses || 0) + 1;
                this._consecutiveWins = 0;
                this._u8LossCount = this._consecutiveLosses;
            }

            if (typeof this.clearStrategyPurchaseSkip === 'function') {
                this.clearStrategyPurchaseSkip();
            }
            if (typeof this.onDbotwebStrategySettlement === 'function') {
                this.onDbotwebStrategySettlement(win);
            }
            if (typeof this.advanceContractSequence === 'function') {
                this.advanceContractSequence(win);
            }
            if (typeof this.onConceptBlockSettlement === 'function') {
                this.onConceptBlockSettlement(win);
            }

            const accountStat = this.getAccountStat();

            accountStat.totalWins += win ? 1 : 0;

            accountStat.totalLosses += !win ? 1 : 0;

            this.sessionProfit = getRoundedNumber(Number(this.sessionProfit) + Number(profit), currency);

            accountStat.totalProfit = getRoundedNumber(Number(accountStat.totalProfit) + Number(profit), currency);

            accountStat.totalStake = getRoundedNumber(
                Number(accountStat.totalStake) + (Number.isFinite(buy) ? buy : 0),
                currency
            );

            const payout = Number.isFinite(sell) ? sell : Number.isFinite(buy) ? buy + Number(profit) : 0;
            accountStat.totalPayout = getRoundedNumber(Number(accountStat.totalPayout) + payout, currency);

            info({
                profit,
                contract,
                accountID: this.accountInfo.loginid,
                totalProfit: accountStat.totalProfit,
                totalWins: accountStat.totalWins,
                totalLosses: accountStat.totalLosses,
                totalStake: accountStat.totalStake,
                totalPayout: accountStat.totalPayout,
            });

            log(win ? LogTypes.PROFIT : LogTypes.LOST, { currency, profit });
        }

        updateAndReturnTotalRuns() {
            this.sessionRuns++;
            const accountStat = this.getAccountStat();

            return ++accountStat.totalRuns;
        }

        /* eslint-disable class-methods-use-this */
        getTotalRuns() {
            const accountStat = this.getAccountStat();
            return accountStat.totalRuns;
        }

        getTotalProfit(toString, currency) {
            const accountStat = this.getAccountStat();

            return toString && accountStat.totalProfit !== 0
                ? getRoundedNumber(+accountStat.totalProfit, currency)
                : +accountStat.totalProfit;
        }

        /* eslint-enable */
        checkLimits(tradeOption) {
            if (!tradeOption.limitations) {
                return;
            }

            const {
                limitations: { maxLoss, maxTrades },
            } = tradeOption;

            if (maxLoss && maxTrades) {
                if (this.sessionRuns >= maxTrades) {
                    throw createError('CustomLimitsReached', localize('Maximum number of trades reached'));
                }
                if (this.sessionProfit <= -maxLoss) {
                    throw createError('CustomLimitsReached', localize('Maximum loss amount reached'));
                }
            }
        }

        /* eslint-disable class-methods-use-this */
        validateTradeOptions(tradeOptions) {
            const take_profit = tradeOptions.take_profit;
            const stop_loss = tradeOptions.stop_loss;

            if (take_profit) {
                tradeOptions.limit_order.take_profit = take_profit;
            }
            if (stop_loss) {
                tradeOptions.limit_order.stop_loss = stop_loss;
            }

            return tradeOptions;
        }

        getAccountStat() {
            const { loginid: accountID } = this.accountInfo;

            if (!(accountID in globalStat)) {
                globalStat[accountID] = { ...skeleton };
            }

            return globalStat[accountID];
        }
    };
