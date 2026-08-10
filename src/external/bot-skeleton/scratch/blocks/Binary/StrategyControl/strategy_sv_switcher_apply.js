import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.strategy_sv_switcher_apply = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('SV Switcher: Over %1 / Under %2 (loss: even/odd recover)'),
            args0: [
                { type: 'input_value', name: 'OVER_PREDICTION', check: 'Number' },
                { type: 'input_value', name: 'UNDER_PREDICTION', check: 'Number' },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            category: window.Blockly.Categories.Strategy_Control,
            tooltip: localize(
                'Alternates Over/Under each win. On loss, recover with 3 even → Even or 3 odd → Odd. Place before Purchase.'
            ),
        };
    },
    meta() {
        return {
            display_name: localize('SV Switcher apply'),
            description: localize('Over/Under alternation with even/odd streak recovery.'),
            key_words: localize('sv switcher over under even odd recovery'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_sv_switcher_apply = block => {
    const gen = window.Blockly.JavaScript.javascriptGenerator;
    const over = gen.valueToCode(block, 'OVER_PREDICTION', gen.ORDER_ATOMIC) || '1';
    const under = gen.valueToCode(block, 'UNDER_PREDICTION', gen.ORDER_ATOMIC) || '8';
    return `Bot.applyOverUnderEoRecovery(${over}, ${under});\n`;
};
