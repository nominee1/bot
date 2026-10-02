import debounce from 'lodash.debounce';
import { localize } from '@deriv-com/translations';
import DBotStore from '../dbot-store';

window.Blockly.BlockSvg.prototype.removeSelect = function () {
    window.Blockly.utils.dom.removeClass(this.svgGroup_, 'blocklySelected');
    if (window.Blockly.derivWorkspace.lastAddedBlock === this) {
        window.Blockly.derivWorkspace.lastAddedBlock = null;
    }
};

window.Blockly.BlockSvg.prototype.addSelect = function () {
    if (!window.Blockly.derivWorkspace.isFlyoutVisible) {
        const { flyout } = DBotStore.instance;
        if (flyout) {
            flyout.setVisibility(false);
        }

        // If there's a lastAddedBlock that's not this block, remove its highlight
        if (
            window.Blockly.derivWorkspace.lastAddedBlock &&
            window.Blockly.derivWorkspace.lastAddedBlock !== this &&
            window.Blockly.derivWorkspace.lastAddedBlock.svgGroup_
        ) {
            window.Blockly.utils.dom.removeClass(
                window.Blockly.derivWorkspace.lastAddedBlock.svgGroup_,
                'blocklySelected'
            );
        }

        // Add highlight to this block and update lastAddedBlock
        window.Blockly.utils.dom.addClass(/** @type {!Element} */ (this.svgGroup_), 'blocklySelected');
        window.Blockly.derivWorkspace.lastAddedBlock = this;
    }
};

/**
 * Set whether the block is disabled or not.
 * @param {boolean} disabled True if disabled.
 * @deriv/bot: Call updateDisabled() when setDisabled is called.
 */
window.Blockly.BlockSvg.prototype.setDisabled = function (disabled) {
    this.disabled = disabled;
    this.updateDisabled();
};

/**
 * Set whether the block is error highlighted or not.
 * @param {boolean} highlighted True if highlighted for error.
 */
window.Blockly.BlockSvg.prototype.setErrorHighlighted = function (
    should_be_error_highlighted,
    error_message = localize(
        'The block(s) highlighted in red are missing input values. Please update them and click "Run bot".'
    )
) {
    if (this.is_error_highlighted === should_be_error_highlighted) {
        return;
    }

    const highlight_class = 'block--error-highlighted';

    if (should_be_error_highlighted) {
        // Below function does its own checks to check if class already exists.
        window.Blockly.utils.dom.addClass(this.svgGroup_, highlight_class);
    } else {
        window.Blockly.utils.dom.removeClass(this.svgGroup_, highlight_class);
    }

    this.is_error_highlighted = should_be_error_highlighted;
    this.error_message = error_message;
};

// Highlight the block that is being executed
window.Blockly.BlockSvg.prototype.highlightExecutedBlock = function () {
    const highlight_block_class = 'block--execution-highlighted';
    if (!window.Blockly.utils.dom.hasClass(this.svgGroup_, highlight_block_class)) {
        window.Blockly.utils.dom.addClass(this.svgGroup_, highlight_block_class);
        setTimeout(() => {
            if (this.svgGroup_) {
                window.Blockly.utils.dom.removeClass(this.svgGroup_, highlight_block_class);
            }
        }, 1505);
    }
};

/**
 * Set block animation (Blink)
 */

window.Blockly.BlockSvg.prototype.blink = function () {
    const blink_class = 'block--blink';
    window.Blockly.utils.dom.addClass(this.svgGroup_, blink_class);

    setTimeout(() => {
        window.Blockly.utils.dom.removeClass(this.svgGroup_, blink_class);
    }, 2000);
};

/**
 * Set whether the block is collapsed or not.
 * @param {boolean} collapsed True if collapsed.
 */

/**
 * Toggles the collapse state of the block after a short delay to prevent workspace freezing.
 * @param {boolean} collapsed - Whether to collapse the block.
 */
window.Blockly.BlockSvg.prototype.toggleCollapseWithDelay = function (collapsed) {
    debounce(async () => {
        this.setCollapsed(collapsed);
    }, 100)();
};

// Store original onMouseDown_ function
const originalOnMouseDown = window.Blockly.BlockSvg.prototype.onMouseDown_;

const isTouchPointer = event => event?.pointerType === 'touch' || String(event?.type || '').startsWith('touch');

/** Editable field under a finger. A tap on the number must open the input, not only select the block. */
const editableFieldAtPointer = (block, event) => {
    const x = event?.clientX;
    const y = event?.clientY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const pad = isTouchPointer(event) ? 16 : 2;
    let best = null;
    let bestArea = Infinity;

    const visit = current => {
        if (!current) return;
        (current.inputList || []).forEach(input => {
            (input.fieldRow || []).forEach(field => {
                if (typeof field.isClickable !== 'function' || !field.isClickable()) return;
                const svg = typeof field.getSvgRoot === 'function' ? field.getSvgRoot() : null;
                const rect = svg && svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
                if (!rect || rect.width <= 0 || rect.height <= 0) return;
                const hit =
                    x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
                if (!hit) return;
                const area = rect.width * rect.height;
                if (area < bestArea) {
                    best = field;
                    bestArea = area;
                }
            });
            const child = input.connection && input.connection.targetBlock && input.connection.targetBlock();
            if (child) visit(child);
        });
    };

    visit(block);
    return best;
};

// Override onMouseDown_ to handle both selection and dragging
window.Blockly.BlockSvg.prototype.onMouseDown_ = function (e) {
    const touch = isTouchPointer(e);
    if (touch && window.Blockly.config) {
        // A finger moves more than Blockly's 5px click radius, which cancels the field editor.
        window.Blockly.config.dragRadius = 28;
    } else if (window.Blockly.config) {
        window.Blockly.config.dragRadius = 5;
    }

    const field = editableFieldAtPointer(this, e);
    if (field) {
        const gesture = this.workspace.getGesture(e);
        if (gesture) gesture.setStartField(field);
    } else if (!this.workspace.options.readOnly && !e.shiftKey) {
        this.addSelect();
    }
    // Call original handler to maintain drag functionality
    originalOnMouseDown.call(this, e);
};
