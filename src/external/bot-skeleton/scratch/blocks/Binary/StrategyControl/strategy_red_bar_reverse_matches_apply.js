import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.strategy_red_bar_reverse_matches_apply = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Red bar reverse MATCHES (4 ticks) — predict coldest digit on rising red bar'),
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            category: window.Blockly.Categories.Strategy_Control,
            tooltip: localize(
                'MATCHES on the red bar (least frequent digit): red bar % must rise, last tick must hit that digit.'
            ),
        };
    },
    meta() {
        return {
            display_name: localize('Red bar reverse MATCHES'),
            description: localize(
                'Digit MATCHES when the coldest (red bar) digit frequency is increasing and the latest tick lands on that digit.'
            ),
            key_words: localize('matches red bar reverse coldest digit entry'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_red_bar_reverse_matches_apply = () =>
    `Bot.applyRedBarReverseMatches();\n`;
