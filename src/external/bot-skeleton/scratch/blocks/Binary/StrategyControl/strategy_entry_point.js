import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

const colourProps = () => ({
    colour: window.Blockly.Colours.Base.colour,
    colourSecondary: window.Blockly.Colours.Base.colourSecondary,
    colourTertiary: window.Blockly.Colours.Base.colourTertiary,
});

window.Blockly.Blocks.strategy_set_entry_point = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('set entry point to %1'),
            args0: [
                {
                    type: 'input_value',
                    name: 'DIGIT',
                    check: 'Number',
                },
            ],
            previousStatement: null,
            nextStatement: null,
            ...colourProps(),
            category: window.Blockly.Categories.Strategy_Control,
            tooltip: localize('Set your entry digit once at bot start (stack under Run once at start).'),
        };
    },
    meta() {
        return {
            display_name: localize('Set entry point'),
            description: localize('Like set variable — choose digit 0–9 in Run once at start.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_set_entry_point = block => {
    const digit =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'DIGIT',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ASSIGNMENT
        ) || '0';
    return `Bot.setEntryPoint(${digit});\n`;
};

window.Blockly.Blocks.strategy_entry_point_reached = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('entry point reached'),
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_HEXAGONAL,
            ...colourProps(),
            category: window.Blockly.Categories.Strategy_Control,
            tooltip: localize('True when the last tick digit matches the digit you set with “set entry point to”.'),
        };
    },
    meta() {
        return {
            display_name: localize('Entry point reached'),
            description: localize('Use in IF under Purchase conditions after setting entry point at start.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_entry_point_reached = () => [
    'Bot.isEntryPointReached()',
    window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC,
];
