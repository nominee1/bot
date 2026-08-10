import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.strategy_recovery_block_apply = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Recovery Block — MKorean Under 4 (all markets)'),
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            category: window.Blockly.Categories.Strategy_Control,
            tooltip: localize(
                'MKORUNDER4: green bar on digits 0–3, two digits ≥11.5%, last ticks all ≥4 → DIGITUNDER 4. Place before Purchase.'
            ),
        };
    },
    meta() {
        return {
            display_name: localize('Recovery Block'),
            description: localize('MKorean Under 4 strategy — trades DIGITUNDER 4 when MKORUNDER4 conditions pass.'),
            key_words: localize('recovery block mkorean under 4 mkorunder4 under 4'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_recovery_block_apply = () =>
    `Bot.applyRecoveryBlock();\n`;
