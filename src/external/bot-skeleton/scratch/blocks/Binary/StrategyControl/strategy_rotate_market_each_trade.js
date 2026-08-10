import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.strategy_rotate_market_each_trade = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Rotate market each trade'),
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            category: window.Blockly.Categories.Strategy_Control,
            tooltip: localize('After each completed trade, switch to the next volatility market.'),
        };
    },
    meta() {
        return {
            display_name: localize('Rotate market each trade'),
            description: localize('Cycles volatility markets once per completed trade.'),
            key_words: localize('rotate market each trade volatility'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_rotate_market_each_trade = () =>
    `Bot.applyRotateMarketEachTrade();\n`;
