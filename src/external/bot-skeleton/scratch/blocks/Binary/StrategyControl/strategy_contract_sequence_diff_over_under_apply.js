import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.strategy_contract_sequence_diff_over_under_apply = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Differs 0 → Over 1 → Over 2 → Differs 9 → Under 8 → Under 7 (loss: even/odd recover)'),
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            category: window.Blockly.Categories.Strategy_Control,
            tooltip: localize(
                '6-step Differs/Over/Under loop with 3-even / 3-odd recovery on loss. Place before Purchase.'
            ),
        };
    },
    meta() {
        return {
            display_name: localize('Differs / Over / Under 6-step loop'),
            description: localize('Differs Hunter style 6-step contract sequence.'),
            key_words: localize('differs hunter sequence over under'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_contract_sequence_diff_over_under_apply = () =>
    `Bot.applyContractSequenceDiff0Over12Diff9Under87();\n`;
