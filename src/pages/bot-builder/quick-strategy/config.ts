import { config as qs_config } from '@/external/bot-skeleton';
import { localize } from '@deriv-com/translations';
import {
    D_ALEMBERT,
    MARTINGALE,
    OSCARS_GRIND,
    REVERSE_D_ALEMBERT,
    REVERSE_MARTINGALE,
    STRATEGY_1_3_2_6,
} from '../../../constants/quick-strategies';
import { LocalizeHTMLForSellConditions } from './localize_html';
import { TConfigItem, TStrategies, TValidationItem } from './types';

export const FORM_TABS = () => [
    {
        label: localize('Trade parameters'),
        value: 'TRADE_PARAMETERS',
    },
    {
        label: localize('Learn more'),
        value: 'LEARN_MORE',
        disabled: true,
    },
];

const SELL_CONDITIONS_TYPE_INFO = (): TConfigItem => ({
    type: 'label',
    label: localize('Sell conditions'),
    description: LocalizeHTMLForSellConditions,
});

const LABEL_ACCUMULAORTS_SIZE = (): TConfigItem => ({
    type: 'label',
    label: localize('Size'),
    description: localize('The size used to multiply the stake after a successful trade for the next trade.'),
});

// This will trigger the boolean_tick_count value to render the take profit and tick count fields
const SELL_CONDITIONS_TYPE = (): TConfigItem => ({
    type: 'sell_conditions',
    name: 'sell_conditions',
});

const GROWTH_RATE = (): TConfigItem => ({
    type: 'label',
    label: localize('Growth rate'),
    description: localize(
        'Your stake will grow at the specified growth rate per tick as long as the current spot price remains within the range of the previous spot price.'
    ),
});

const GROWTH_RATE_VALUE = (): TConfigItem => ({
    type: 'growth_rate',
    name: 'growth_rate',
    attached: true,
    validation: ['number', 'required', 'ceil'],
});

const LABEL_ACCUMULAORTS_UNIT = (): TConfigItem => ({
    type: 'label',
    label: localize('Unit'),
    description: localize('The unit used to multiply the stake after a losing trade for the next trade.'),
});

const TAKE_PROFIT = (): TConfigItem => ({
    type: 'number',
    name: 'take_profit',
    should_have: [{ key: 'boolean_tick_count', value: false }],
    hide_without_should_have: true,
    attached: true,
    has_currency_unit: true,
});

const TICK_COUNT = (): TConfigItem => ({
    type: 'number',
    name: 'tick_count',
    should_have: [{ key: 'boolean_tick_count', value: true }],
    hide_without_should_have: true,
    attached: true,
    has_currency_unit: false,
});

const NUMBER_DEFAULT_VALIDATION = (): TValidationItem => ({
    type: 'min',
    value: 1,
    getMessage: (min: string | number) => localize('Must be a number higher than {{ min }}', { min: Number(min) - 1 }),
});

const LABEL_SYMBOL = (): TConfigItem => ({
    type: 'label',
    label: localize('Asset'),
    description: localize('The underlying market your bot will trade with this strategy.'),
});

const SYMBOL = (): TConfigItem => ({
    type: 'symbol',
    name: 'symbol',
});

const LABEL_TRADETYPE = (): TConfigItem => ({
    type: 'label',
    label: localize('Contract type'),
    description: localize('Your bot will use this contract type for every run'),
});

const TRADETYPE = (): TConfigItem => ({
    type: 'tradetype',
    name: 'tradetype',
    dependencies: ['symbol'],
});

const LABEL_PURCHASE_TYPE = (): TConfigItem => ({
    type: 'label',
    label: localize('Purchase condition'),
    description: localize('Your bot uses a single trade type for each run.'),
});

const PURCHASE_TYPE = (): TConfigItem => ({
    type: 'contract_type',
    name: 'type',
    dependencies: ['symbol', 'tradetype'],
});

const LABEL_STAKE = (): TConfigItem => ({
    type: 'label',
    label: localize('Initial stake'),
    description: localize('The amount that you stake for the first trade. Note that this is the minimum stake amount.'),
});

const STAKE = (): TConfigItem => ({
    type: 'number',
    name: 'stake',
    validation: ['number', 'required', 'ceil', NUMBER_DEFAULT_VALIDATION()],
    has_currency_unit: true,
});

const LABEL_DURATION = (): TConfigItem => ({
    type: 'label',
    label: localize('Duration'),
    description: localize('How long each trade takes to expire.'),
});

const DURATION_TYPE = (): TConfigItem => ({
    type: 'durationtype',
    name: 'durationtype',
    dependencies: ['symbol', 'tradetype'],
    attached: true,
});

const DURATION = (): TConfigItem => ({
    type: 'number',
    name: 'duration',
    attached: true,
    validation: ['number', 'required', 'min', 'max'],
});

const LABEL_PROFIT = (): TConfigItem => ({
    type: 'label',
    label: localize('Profit threshold'),
    description: localize('The bot will stop trading if your total profit exceeds this amount.'),
});

const PROFIT = (): TConfigItem => ({
    type: 'number',
    name: 'profit',
    validation: ['number', 'required', 'ceil', NUMBER_DEFAULT_VALIDATION()],
    has_currency_unit: true,
});

const LABEL_LOSS = (): TConfigItem => ({
    type: 'label',
    label: localize('Loss threshold'),
    description: localize('The bot will stop trading if your total loss exceeds this amount.'),
});

const LOSS = (): TConfigItem => ({
    type: 'number',
    name: 'loss',
    validation: ['number', 'required', 'ceil', NUMBER_DEFAULT_VALIDATION()],
    has_currency_unit: true,
});

const LABEL_MARTINGALE_SIZE = (): TConfigItem => ({
    type: 'label',
    label: localize('Size'),
    description: localize('The size used to multiply the stake after a losing trade for the next trade.'),
});

const LABEL_REVERSE_MARTINGALE_SIZE = (): TConfigItem => ({
    type: 'label',
    label: localize('Size'),
    description: localize('The size used to multiply the stake after a successful trade for the next trade.'),
});

const SIZE = (): TConfigItem => ({
    type: 'number',
    name: 'size',
    validation: [
        'number',
        'required',
        'floor',
        {
            type: 'min',
            value: String(qs_config().QUICK_STRATEGY.DEFAULT.size),
            getMessage: (min: string | number) =>
                localize('The value must be equal or greater than {{ min }}', { min }),
        },
    ],
});

const LABEL_DALEMBERT_UNIT = (): TConfigItem => ({
    type: 'label',
    label: localize('Unit'),
    description: localize(
        'Number of unit(s) to be added to the next trade after a losing trade. One unit is equivalent to the amount of initial stake.'
    ),
});

const LABEL_REVERSE_DALEMBERT_UNIT = (): TConfigItem => ({
    type: 'label',
    label: localize('Unit'),
    description: localize(
        'Number of unit(s) to be added to the next trade after a successful trade. One unit is equivalent to the amount of initial stake.'
    ),
});

const UNIT = (): TConfigItem => ({
    type: 'number',
    name: 'unit',
    // validation: ['number', 'required', 'ceil', NUMBER_DEFAULT_VALIDATION()],
});

const CHECKBOX_MAX_STAKE = (): TConfigItem => ({
    type: 'checkbox',
    name: 'boolean_max_stake',
    label: localize('Max stake'),
    description: localize('The stake for your next trade will reset to the initial stake if it exceeds this value.'),
    attached: true,
});

const MAX_STAKE = (): TConfigItem => ({
    type: 'number',
    name: 'max_stake',
    validation: ['number', 'required', 'ceil', 'min'],
    should_have: [{ key: 'boolean_max_stake', value: true }],
    hide_without_should_have: true,
    attached: true,
    has_currency_unit: true,
});

const LABEL_LAST_DIGIT_PREDICTION = (): TConfigItem => ({
    type: 'label',
    name: 'label_last_digit_prediction',
    label: localize('Last Digit Prediction'),
    description: localize('Your prediction of the last digit of the asset price.'),
    should_have: [{ key: 'tradetype', value: '', multiple: ['matchesdiffers', 'overunder'] }],
    hide_without_should_have: true,
});

const LAST_DIGIT_PREDICTION = (): TConfigItem => ({
    type: 'number',
    name: 'last_digit_prediction',
    validation: ['number', 'required', 'min', 'max', 'integer'],
    should_have: [{ key: 'tradetype', value: '', multiple: ['matchesdiffers', 'overunder'] }],
    hide_without_should_have: true,
});

export const STRATEGIES = (): TStrategies => ({
   
    D_ALEMBERT: {
        name: 'AutoSwitcher2@25',
        label: localize('Dtrader AutoSwitcher 2@25'),
        rs_strategy_name: `d'alembert`,
        description: D_ALEMBERT(),
        fields: [
            [
                // LABEL_SYMBOL(),
                // SYMBOL(),
                // LABEL_TRADETYPE(),
                // TRADETYPE(),
                // LABEL_PURCHASE_TYPE(),
                // PURCHASE_TYPE(),
                // LABEL_LAST_DIGIT_PREDICTION(),
                // LAST_DIGIT_PREDICTION(),
                // LABEL_STAKE(),
                // STAKE(),
                // LABEL_DURATION(),
                // DURATION_TYPE(),
                // DURATION(),
            ],
            [
                // LABEL_PROFIT(),
                // PROFIT(),
                // LABEL_LOSS(),
                // LOSS(),
                // LABEL_DALEMBERT_UNIT(),
                // UNIT(),
                // CHECKBOX_MAX_STAKE(),
                // MAX_STAKE(),
            ],
        ],
    },
    MARTINGALE: {
        name: 'Deriv Killer 🐍 4.0',
        label: localize('Deriv Killer 🐍 4.0'),
        rs_strategy_name: 'martingale',
        description: MARTINGALE(),
        fields: [
            [
                LABEL_SYMBOL(),
                SYMBOL(),
                LABEL_TRADETYPE(),
                TRADETYPE(),
                LABEL_PURCHASE_TYPE(),
                PURCHASE_TYPE(),
                LABEL_LAST_DIGIT_PREDICTION(),
                LAST_DIGIT_PREDICTION(),
                LABEL_STAKE(),
                STAKE(),
                LABEL_DURATION(),
                DURATION_TYPE(),
                DURATION(),
            ],
            [
                LABEL_PROFIT(),
                PROFIT(),
                LABEL_LOSS(),
                LOSS(),
                LABEL_MARTINGALE_SIZE(),
                SIZE(),
                CHECKBOX_MAX_STAKE(),
                MAX_STAKE(),
            ],
        ],
    },
    OSCARS_GRIND: {
        name: 'Rise $ Fall Copilot',
        label: localize('Rise $ Fall Copilot'),
        rs_strategy_name: `Rise and Fall Copilot`,
        description: OSCARS_GRIND(),
        fields: [
            [
                LABEL_SYMBOL(),
                SYMBOL(),
                LABEL_TRADETYPE(),
                TRADETYPE(),
                LABEL_PURCHASE_TYPE(),
                PURCHASE_TYPE(),
                LABEL_LAST_DIGIT_PREDICTION(),
                LAST_DIGIT_PREDICTION(),
                LABEL_STAKE(),
                STAKE(),
                LABEL_DURATION(),
                DURATION_TYPE(),
                DURATION(),
            ],
            [LABEL_PROFIT(), PROFIT(), LABEL_LOSS(), LOSS(), CHECKBOX_MAX_STAKE(), MAX_STAKE()],
        ],
    },
    REVERSE_MARTINGALE: {
        name: 'Over Under Pro Ai',
        label: localize('Over Under Pro Ai'),
        rs_strategy_name: 'Over Under Pro Ai',
        description: REVERSE_MARTINGALE(),
        fields: [
            [
                LABEL_SYMBOL(),
                SYMBOL(),
                LABEL_TRADETYPE(),
                TRADETYPE(),
                LABEL_PURCHASE_TYPE(),
                PURCHASE_TYPE(),
                LABEL_LAST_DIGIT_PREDICTION(),
                LAST_DIGIT_PREDICTION(),
                LABEL_STAKE(),
                STAKE(),
                LABEL_DURATION(),
                DURATION_TYPE(),
                DURATION(),
            ],
            [
                LABEL_PROFIT(),
                PROFIT(),
                LABEL_LOSS(),
                LOSS(),
                LABEL_REVERSE_MARTINGALE_SIZE(),
                SIZE(),
                CHECKBOX_MAX_STAKE(),
                MAX_STAKE(),
            ],
        ],
    },
    REVERSE_D_ALEMBERT: {
        name: 'DtraderD4',
        label: localize('DtraderD4'),
        rs_strategy_name: `reverse d'alembert`,
        description: REVERSE_D_ALEMBERT(),
        fields: [
            [
                // LABEL_SYMBOL(),
                // SYMBOL(),
                // LABEL_TRADETYPE(),
                // TRADETYPE(),
                // LABEL_PURCHASE_TYPE(),
                // PURCHASE_TYPE(),
                // LABEL_LAST_DIGIT_PREDICTION(),
                // LAST_DIGIT_PREDICTION(),
                // LABEL_STAKE(),
                // STAKE(),
                // LABEL_DURATION(),
                // DURATION_TYPE(),
                // DURATION(),
            ],
            [
                // LABEL_PROFIT(),
                // PROFIT(),
                // LABEL_LOSS(),
                // LOSS(),
                // LABEL_REVERSE_DALEMBERT_UNIT(),
                // UNIT(),
                // CHECKBOX_MAX_STAKE(),
                // MAX_STAKE(),
            ],
        ],
    },
    STRATEGY_1_3_2_6: {
        name: 'oracleV2',
        label: localize('Dtrader OracleV2'),
        rs_strategy_name: '1-3-2-6',
        description: STRATEGY_1_3_2_6(),
        fields: [
            [], // Empty array for first column
            [], // Empty array for second column
        ],
    },
    
    ACCUMULATORS_MARTINGALE: {
        name: 'Pro Aviator Ai',
        label: localize('Pro Aviator Ai'),
        rs_strategy_name: 'accumulators_martingale',
        description: [],
        fields: [
            [LABEL_SYMBOL(), SYMBOL(), LABEL_STAKE(), STAKE(), GROWTH_RATE(), GROWTH_RATE_VALUE()],
            [
                LABEL_PROFIT(),
                PROFIT(),
                LABEL_LOSS(),
                LOSS(),
                LABEL_ACCUMULAORTS_SIZE(),
                SIZE(),
                SELL_CONDITIONS_TYPE_INFO(),
                SELL_CONDITIONS_TYPE(),
                TAKE_PROFIT(),
                TICK_COUNT(),
                CHECKBOX_MAX_STAKE(),
                MAX_STAKE(),
            ],
        ],
    },
    ACCUMULATORS_DALEMBERT: {
        name: 'Aviator Profit Booster',
        label: localize('Aviator Profit Booster'),
        rs_strategy_name: 'accumulators_dalembert',
        description: [],
        fields: [
            [LABEL_SYMBOL(), SYMBOL(), LABEL_STAKE(), STAKE(), GROWTH_RATE(), GROWTH_RATE_VALUE()],
            [
                LABEL_PROFIT(),
                PROFIT(),
                LABEL_LOSS(),
                LOSS(),
                LABEL_ACCUMULAORTS_UNIT(),
                UNIT(),
                SELL_CONDITIONS_TYPE_INFO(),
                SELL_CONDITIONS_TYPE(),
                TAKE_PROFIT(),
                TICK_COUNT(),
                CHECKBOX_MAX_STAKE(),
                MAX_STAKE(),
            ],
        ],
    },
    ACCUMULATORS_MARTINGALE_ON_STAT_RESET: {
        name: 'Smart Recovery Bot',
        label: localize('Smart Recovery Bot'),
        rs_strategy_name: 'accumulators_martingale_on_stat_reset',
        description: [],
        fields: [
            [LABEL_SYMBOL(), SYMBOL(), LABEL_STAKE(), STAKE(), GROWTH_RATE(), GROWTH_RATE_VALUE()],
            [
                LABEL_PROFIT(),
                PROFIT(),
                LABEL_LOSS(),
                LOSS(),
                LABEL_ACCUMULAORTS_SIZE(),
                SIZE(),
                SELL_CONDITIONS_TYPE_INFO(),
                SELL_CONDITIONS_TYPE(),
                TAKE_PROFIT(),
                TICK_COUNT(),
                CHECKBOX_MAX_STAKE(),
                MAX_STAKE(),
            ],
        ],
    },
    ACCUMULATORS_DALEMBERT_ON_STAT_RESET: {
        name: 'Auto-Rebalance',
        label: localize("Dtrader Auto-Rebalance"),
        rs_strategy_name: 'accumulators_dalembert_on_stat_reset',
        description: [],
        fields: [
            [LABEL_SYMBOL(), SYMBOL(), LABEL_STAKE(), STAKE(), GROWTH_RATE(), GROWTH_RATE_VALUE()],
            [
                LABEL_PROFIT(),
                PROFIT(),
                LABEL_LOSS(),
                LOSS(),
                LABEL_ACCUMULAORTS_UNIT(),
                UNIT(),
                SELL_CONDITIONS_TYPE_INFO(),
                SELL_CONDITIONS_TYPE(),
                TAKE_PROFIT(),
                TICK_COUNT(),
                CHECKBOX_MAX_STAKE(),
                MAX_STAKE(),
            ],
        ],
    },
    ACCUMULATORS_REVERSE_MARTINGALE: {
        name: 'Smart Paroli',
        label: localize('Smart Paroli'),
        rs_strategy_name: 'accumulators_reverse_martingale',
        description: [],
        fields: [
            [LABEL_SYMBOL(), SYMBOL(), LABEL_STAKE(), STAKE(), GROWTH_RATE(), GROWTH_RATE_VALUE()],
            [
                LABEL_PROFIT(),
                PROFIT(),
                LABEL_LOSS(),
                LOSS(),
                LABEL_ACCUMULAORTS_SIZE(),
                SIZE(),
                SELL_CONDITIONS_TYPE_INFO(),
                SELL_CONDITIONS_TYPE(),
                TAKE_PROFIT(),
                TICK_COUNT(),
                CHECKBOX_MAX_STAKE(),
                MAX_STAKE(),
            ],
        ],
    },
    ACCUMULATORS_REVERSE_MARTINGALE_ON_STAT_RESET: {
        name: 'Growth Reset Pro',
        label: localize('Dtrader Growth Reset Pro'),
        rs_strategy_name: 'accumulators_reverse_martingale_on_stat_reset',
        description: [],
        fields: [
            [LABEL_SYMBOL(), SYMBOL(), LABEL_STAKE(), STAKE(), GROWTH_RATE(), GROWTH_RATE_VALUE()],
            [
                LABEL_PROFIT(),
                PROFIT(),
                LABEL_LOSS(),
                LOSS(),
                LABEL_ACCUMULAORTS_SIZE(),
                SIZE(),
                SELL_CONDITIONS_TYPE_INFO(),
                SELL_CONDITIONS_TYPE(),
                TAKE_PROFIT(),
                TICK_COUNT(),
                CHECKBOX_MAX_STAKE(),
                MAX_STAKE(),
            ],
        ],
    },
    ACCUMULATORS_REVERSE_DALEMBERT: {
        name: 'Reverse Accumulator+',
        label: localize("Reverse Accumulator+"),
        rs_strategy_name: 'accumulators_reverse_dalembert',
        description: [],
        fields: [
            [LABEL_SYMBOL(), SYMBOL(), LABEL_STAKE(), STAKE(), GROWTH_RATE(), GROWTH_RATE_VALUE()],
            [
                LABEL_PROFIT(),
                PROFIT(),
                LABEL_LOSS(),
                LOSS(),
                LABEL_ACCUMULAORTS_UNIT(),
                UNIT(),
                SELL_CONDITIONS_TYPE_INFO(),
                SELL_CONDITIONS_TYPE(),
                TAKE_PROFIT(),
                TICK_COUNT(),
                CHECKBOX_MAX_STAKE(),
                MAX_STAKE(),
            ],
        ],
    },
    ACCUMULATORS_REVERSE_DALEMBERT_ON_STAT_RESET: {
        name: 'Success Cycle Pro',
        label: localize("Success Cycle Pro"),
        rs_strategy_name: 'accumulators_reverse_dalembert_on_stat_reset',
        description: [],
        fields: [
            [LABEL_SYMBOL(), SYMBOL(), LABEL_STAKE(), STAKE(), GROWTH_RATE(), GROWTH_RATE_VALUE()],
            [
                LABEL_PROFIT(),
                PROFIT(),
                LABEL_LOSS(),
                LOSS(),
                LABEL_ACCUMULAORTS_UNIT(),
                UNIT(),
                SELL_CONDITIONS_TYPE_INFO(),
                SELL_CONDITIONS_TYPE(),
                TAKE_PROFIT(),
                TICK_COUNT(),
                CHECKBOX_MAX_STAKE(),
                MAX_STAKE(),
            ],
        ],
    },
});
