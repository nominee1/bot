import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.strategy_even_odd_two_streak_apply = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Even/Odd (2 digits) — 2 even → Even, 2 odd → Odd'),
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            category: window.Blockly.Categories.Strategy_Control,
            tooltip: localize(
                'When the last 2 tick digits are both even, sets DIGITEVEN. When both are odd, sets DIGITODD. Otherwise waits — no purchase. Place before Purchase.'
            ),
        };
    },
    meta() {
        return {
            display_name: localize('Even/Odd 2-digit streak'),
            description: localize(
                'Trade Even after 2 consecutive even digits; trade Odd after 2 consecutive odd digits.'
            ),
            key_words: localize('even odd two 2 digits streak pair'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_even_odd_two_streak_apply = () =>
    `Bot.applyEvenOddTwoStreak();\n`;
