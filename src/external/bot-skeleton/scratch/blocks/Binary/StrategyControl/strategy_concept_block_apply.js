import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.strategy_concept_block_apply = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize(
                'Concept Block | ticks %1 | thr %2 | over %3 | under %4 | scan %5 | cooldown %6 | win lock %7 | lock thr %8'
            ),
            args0: [
                { type: 'input_value', name: 'TICK_COUNT', check: 'Number' },
                { type: 'input_value', name: 'THRESHOLD', check: 'Number' },
                { type: 'input_value', name: 'OVER_BARRIER', check: 'Number' },
                { type: 'input_value', name: 'UNDER_BARRIER', check: 'Number' },
                { type: 'input_value', name: 'WAIT_BEFORE_SCAN', check: 'Number' },
                { type: 'input_value', name: 'COOLDOWN', check: 'Number' },
                { type: 'input_value', name: 'WIN_STREAK_LOCK', check: 'Number' },
                { type: 'input_value', name: 'LOCK_THRESHOLD', check: 'Number' },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            category: window.Blockly.Categories.Strategy_Control,
            tooltip: localize('Concept Block. Place before Purchase.'),
        };
    },
    meta() {
        return {
            display_name: localize('Concept Block'),
            description: localize('Concept Block strategy control.'),
            key_words: localize('concept block'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_concept_block_apply = block => {
    const gen = window.Blockly.JavaScript.javascriptGenerator;
    const tickCount = gen.valueToCode(block, 'TICK_COUNT', gen.ORDER_ATOMIC) || '15';
    const threshold = gen.valueToCode(block, 'THRESHOLD', gen.ORDER_ATOMIC) || '70';
    const overBarrier = gen.valueToCode(block, 'OVER_BARRIER', gen.ORDER_ATOMIC) || '2';
    const underBarrier = gen.valueToCode(block, 'UNDER_BARRIER', gen.ORDER_ATOMIC) || '7';
    const waitBeforeScan = gen.valueToCode(block, 'WAIT_BEFORE_SCAN', gen.ORDER_ATOMIC) || '5';
    const cooldown = gen.valueToCode(block, 'COOLDOWN', gen.ORDER_ATOMIC) || '3';
    const winStreakLock = gen.valueToCode(block, 'WIN_STREAK_LOCK', gen.ORDER_ATOMIC) || '3';
    const lockThreshold = gen.valueToCode(block, 'LOCK_THRESHOLD', gen.ORDER_ATOMIC) || '80';
    return `Bot.applyConceptBlock(${tickCount}, ${threshold}, ${overBarrier}, ${underBarrier}, ${waitBeforeScan}, ${cooldown}, ${winStreakLock}, ${lockThreshold});\n`;
};
