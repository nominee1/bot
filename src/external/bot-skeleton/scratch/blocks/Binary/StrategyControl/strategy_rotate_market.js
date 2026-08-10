import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.strategy_rotate_market = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Rotate to next volatility market'),
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            category: window.Blockly.Categories.Strategy_Control,
            tooltip: localize('Moves to the next symbol in the volatility index list.'),
        };
    },
    meta() {
        return {
            display_name: localize('Rotate market'),
            description: localize('Cycles R_10 … 1HZ100V for multi-market strategies.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_rotate_market = () =>
    `Bot.rotateToNextVolatilityMarket();\n`;
