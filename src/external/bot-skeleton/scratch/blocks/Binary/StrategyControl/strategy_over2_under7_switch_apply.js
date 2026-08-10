import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.strategy_over2_under7_switch_apply = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Over 2 / Under 7 switch (N losses each way)'),
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            category: window.Blockly.Categories.Strategy_Control,
            tooltip: localize(
                'Over 2 until N losses, then Under 7 until N losses, then back to Over 2 (preset N=1). Place before Purchase.'
            ),
        };
    },
    meta() {
        return {
            display_name: localize('Over 2 / Under 7 switch'),
            description: localize('Autoswitcher-style Over 2 ↔ Under 7 with loss-based switching.'),
            key_words: localize('over 2 under 7 switch autoswitcher'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_over2_under7_switch_apply = () =>
    `Bot.applyOver2Under7Switch();\n`;
