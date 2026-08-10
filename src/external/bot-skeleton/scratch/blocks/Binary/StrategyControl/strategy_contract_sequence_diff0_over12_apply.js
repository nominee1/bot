import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.strategy_contract_sequence_diff0_over12_apply = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Differs 0→Over 1→Over 2 (loss: 2 even/2 odd recover)'),
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            category: window.Blockly.Categories.Strategy_Control,
            tooltip: localize(
                'Loop: DIFFER 0 → OVER 1 → OVER 2. On loss: wait for 2 even digits then DIGITEVEN, or 2 odd digits then DIGITODD.'
            ),
        };
    },
    meta() {
        return {
            display_name: localize('Differs 0/Over 1/Over 2 sequence'),
            description: localize(
                'DIFFER 0 → OVER 1 → OVER 2 → repeat. Loss triggers even/odd recovery on a 2-digit streak.'
            ),
            key_words: localize('differ 0 over 1 2 sequence even odd recovery'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_contract_sequence_diff0_over12_apply = () =>
    `Bot.applyContractSequenceDiff0Over12Streak2();\n`;
