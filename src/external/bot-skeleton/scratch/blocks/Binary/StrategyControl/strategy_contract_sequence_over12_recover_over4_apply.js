import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.strategy_contract_sequence_over12_recover_over4_apply = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Over 1 → Over 2 (loss: recover with Over 4)'),
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            category: window.Blockly.Categories.Strategy_Control,
            tooltip: localize(
                'Over 1 → Over 2 loop. Any loss recovers with Over 4 until a win, then restarts at Over 1.'
            ),
        };
    },
    meta() {
        return {
            display_name: localize('Over 1–2 with Over 4 recovery'),
            description: localize('Over Hunter style Over 1/2 sequence with Over 4 recovery.'),
            key_words: localize('over 1 2 4 recovery sequence'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_contract_sequence_over12_recover_over4_apply = () =>
    `Bot.applyContractSequenceOver12RecoverOver4();\n`;
