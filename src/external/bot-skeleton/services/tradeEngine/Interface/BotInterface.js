import { observer as globalObserver } from '../../../utils/observer';
import { apolloRuntime } from '../utils/apollo-runtime';
import { createDetails } from '../utils/helpers';

const getBotInterface = tradeEngine => {
    const getDetail = i => createDetails(tradeEngine.data.contract)[i];

    return {
        init: (...args) => tradeEngine.init(...args),
        start: (...args) => tradeEngine.start(...args),
        stop: (...args) => tradeEngine.stop(...args),
        purchase: contract_type => tradeEngine.purchase(contract_type),
        directPurchase: (contract_type, prediction) => tradeEngine.directPurchase(contract_type, prediction),
        setPrediction: value => tradeEngine.setPrediction(value),
        multiplePurchase: (contract_type, quantity) => tradeEngine.multiplePurchase(contract_type, quantity),
        setTradeQuantity: quantity => tradeEngine.setTradeQuantity(quantity),
        setOneSMarkets: value => tradeEngine.setOneSMarkets(value),
        setHedgeHookInfo: info => tradeEngine.setHedgeHookInfo(info),
        setOverUnderHookInfo: info => tradeEngine.setOverUnderHookInfo(info),
        setVirtualHookInfo: info => tradeEngine.setVirtualHookInfo(info),
        runHedgeHook: () => tradeEngine.runHedgeHook(),
        runOverUnderHook: () => tradeEngine.runOverUnderHook(),
        runVirtualHook: () => tradeEngine.runVirtualHook(),
        setVirtualHookEnabled: enabled => tradeEngine.setVirtualHookEnabled(enabled),
        setVirtualHookMaxSteps: steps => tradeEngine.setVirtualHookMaxSteps(steps),
        setVirtualHookMinTrades: trades => tradeEngine.setVirtualHookMinTrades(trades),
        setEntryPoint: digit => tradeEngine.setEntryPoint(digit),
        isEntryPointReached: () => tradeEngine.isEntryPointReached(),
        applyEvenOddTwoStreak: () => tradeEngine.applyEvenOddTwoStreak(),
        applyRecoveryBlock: () => tradeEngine.applyRecoveryBlock(),
        applyRedBarReverseMatches: () => tradeEngine.applyRedBarReverseMatches(),
        applyOver2Under7Switch: () => tradeEngine.applyOver2Under7Switch(),
        applyOverUnderSwitch: (...args) => tradeEngine.applyOverUnderSwitch(...args),
        applyOverHunter: (...args) => tradeEngine.applyOverHunter(...args),
        applyOverUnderEoRecovery: (...args) => tradeEngine.applyOverUnderEoRecovery(...args),
        applyRandy: () => tradeEngine.applyRandy(),
        applyEvenOddStrategy: () => tradeEngine.applyEvenOddStrategy(),
        applyContractSequenceDiff0Over12Diff9Under87: () => tradeEngine.applyContractSequenceDiff0Over12Diff9Under87(),
        applyContractSequenceOver12RecoverOver4: () => tradeEngine.applyContractSequenceOver12RecoverOver4(),
        applyRotateMarketEachTrade: () => tradeEngine.applyRotateMarketEachTrade(),
        rotateToNextVolatilityMarket: () => tradeEngine.rotateToNextVolatilityMarket(),
        applyContractSequenceDiff0Over12Streak2: () => tradeEngine.applyContractSequenceDiff0Over12Streak2(),
        applyConceptBlock: (...args) => tradeEngine.applyConceptBlock(...args),
        setNextContractType: (type, prediction) => tradeEngine.setNextContractType(type, prediction),
        contractSwitcher: value => {
            apolloRuntime.contract_switcher = value || 'disable';
        },
        setActiveContractType: value => {
            if (!value || value === 'disable') {
                apolloRuntime.other_symbol_active = false;
                apolloRuntime.other_symbol = '';
            } else {
                apolloRuntime.other_symbol_active = true;
                apolloRuntime.other_symbol = value;
            }
        },
        showTP: () => {
            apolloRuntime.show_tp = true;
        },
        showSL: () => {
            apolloRuntime.show_sl = true;
        },
        getAskPrice: contract_type => Number(getProposal(contract_type, tradeEngine).ask_price),
        getPayout: contract_type => Number(getProposal(contract_type, tradeEngine).payout),
        getPurchaseReference: () => tradeEngine.getPurchaseReference(),
        isSellAvailable: () => tradeEngine.isSellAtMarketAvailable(),
        sellAtMarket: () => tradeEngine.sellAtMarket(),
        getSellPrice: () => getSellPrice(tradeEngine),
        isResult: result => getDetail(10) === result,
        isTradeAgain: result => globalObserver.emit('bot.trade_again', result),
        readDetails: i => getDetail(i - 1),
    };
};

const getProposal = (contract_type, tradeEngine) => {
    return tradeEngine.data.proposals.find(
        proposal =>
            proposal.contract_type === contract_type &&
            proposal.purchase_reference === tradeEngine.getPurchaseReference()
    );
};

const getSellPrice = tradeEngine => {
    return tradeEngine.getSellPrice();
};

export default getBotInterface;
