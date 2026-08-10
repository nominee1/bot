import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.strategy_over_hunter_apply = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Over Hunter: Over %1 → loss → Under %2 → recovery Under %3 → win → Over %1'),
            args0: [
                { type: 'input_value', name: 'OVER_X', check: 'Number' },
                { type: 'input_value', name: 'UNDER_N', check: 'Number' },
                { type: 'input_value', name: 'RECOVERY_V', check: 'Number' },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            category: window.Blockly.Categories.Strategy_Control,
            tooltip: localize(
                'Trade Over, then Under after a loss, then recovery Under. Any win resets to Over. Place before Purchase.'
            ),
        };
    },
    meta() {
        return {
            display_name: localize('Over Hunter apply'),
            description: localize('Over → Under after loss → recovery Under → win back to Over.'),
            key_words: localize('over hunter loss recovery under'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_over_hunter_apply = block => {
    const gen = window.Blockly.JavaScript.javascriptGenerator;
    const overX = gen.valueToCode(block, 'OVER_X', gen.ORDER_ATOMIC) || '2';
    const underN = gen.valueToCode(block, 'UNDER_N', gen.ORDER_ATOMIC) || '7';
    const recoveryV = gen.valueToCode(block, 'RECOVERY_V', gen.ORDER_ATOMIC) || '5';
    return `Bot.applyOverHunter(${overX}, ${underN}, ${recoveryV});\n`;
};
