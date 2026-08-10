import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.strategy_randy_apply = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Randy'),
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            category: window.Blockly.Categories.Strategy_Control,
            tooltip: localize(
                'Random Differs 0 / Over 1–2 / Differs 9 / Under 8–7 without immediate repeats. Loss → even/odd streak recovery.'
            ),
        };
    },
    meta() {
        return {
            display_name: localize('Randy'),
            description: localize('Random digit rotation with even/odd recovery.'),
            key_words: localize('randy random differs over under'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_randy_apply = () => `Bot.applyRandy();\n`;
