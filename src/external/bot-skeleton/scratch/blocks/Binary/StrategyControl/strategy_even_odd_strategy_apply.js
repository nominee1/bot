import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.strategy_even_odd_strategy_apply = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Even odd strategy'),
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            category: window.Blockly.Categories.Strategy_Control,
            tooltip: localize(
                '3 consecutive even digits → DIGITEVEN; 3 consecutive odd → DIGITODD. Otherwise waits. Place before Purchase.'
            ),
        };
    },
    meta() {
        return {
            display_name: localize('Even odd strategy'),
            description: localize('3-even / 3-odd streak hunter.'),
            key_words: localize('even odd hunter streak'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_even_odd_strategy_apply = () =>
    `Bot.applyEvenOddStrategy();\n`;
