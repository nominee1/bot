import { localize } from '@deriv-com/translations';

// Touch → synthetic mouse click closes Blockly's native prompt / inline editor.
// Keep the overlay armed briefly so that ghost click cannot dismiss it.
const ARM_MS = 450;

let activeModal = null;

const useCenteredFieldModal = () => {
    const agent = window.Blockly?.utils?.userAgent;
    const mobileAgent = !!(agent && (agent.MOBILE || agent.ANDROID || agent.IPAD || agent.IPHONE));
    return mobileAgent || window.innerWidth < 1280;
};

const syncModalToVisualViewport = root => {
    const vv = window.visualViewport;
    if (!vv || !root) return;
    root.style.top = `${vv.offsetTop}px`;
    root.style.left = `${vv.offsetLeft}px`;
    root.style.width = `${vv.width}px`;
    root.style.height = `${vv.height}px`;
};

const closeModal = result => {
    if (!activeModal) return;
    const { node, finish, onViewport } = activeModal;
    activeModal = null;
    if (onViewport) {
        window.visualViewport?.removeEventListener('resize', onViewport);
        window.visualViewport?.removeEventListener('scroll', onViewport);
    }
    node.remove();
    finish(result);
};

const openCenteredModal = ({ title, value = '', onDone }) => {
    closeModal(null);

    const root = document.createElement('div');
    root.className = 'dbot-field-modal';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');

    const card = document.createElement('div');
    card.className = 'dbot-field-modal__card';

    const heading = document.createElement('p');
    heading.className = 'dbot-field-modal__title';
    heading.textContent = title || localize('Change value');
    card.appendChild(heading);

    const input = document.createElement('input');
    input.className = 'dbot-field-modal__input';
    input.type = 'text';
    input.inputMode = 'decimal';
    input.enterKeyHint = 'done';
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.value = value == null ? '' : String(value);
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            closeModal(input.value);
        }
    });
    card.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'dbot-field-modal__actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'dbot-field-modal__button dbot-field-modal__button--ghost';
    cancel.textContent = localize('Cancel');
    cancel.addEventListener('click', () => closeModal(null));

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'dbot-field-modal__button';
    ok.textContent = localize('OK');
    ok.addEventListener('click', () => closeModal(input.value));

    actions.appendChild(cancel);
    actions.appendChild(ok);
    card.appendChild(actions);
    root.appendChild(card);

    const armedUntil = Date.now() + ARM_MS;
    const swallowOpeningTap = event => {
        if (Date.now() >= armedUntil) return;
        event.preventDefault();
        event.stopPropagation();
    };
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'].forEach(type => {
        root.addEventListener(type, swallowOpeningTap, true);
    });

    root.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeModal(null);
    });
    root.addEventListener('click', event => {
        if (Date.now() < armedUntil) return;
        if (event.target === root) closeModal(null);
    });

    const onViewport = () => syncModalToVisualViewport(root);
    syncModalToVisualViewport(root);
    window.visualViewport?.addEventListener('resize', onViewport);
    window.visualViewport?.addEventListener('scroll', onViewport);

    activeModal = { node: root, finish: onDone, onViewport };
    document.body.appendChild(root);

    // Focus after the ghost click window so the keyboard does not flash open/closed.
    window.setTimeout(() => {
        if (!activeModal || activeModal.node !== root) return;
        input.focus({ preventScroll: true });
        input.select();
    }, ARM_MS);
};

const showCenteredTextEditor = function () {
    const title = window.Blockly.Msg?.CHANGE_VALUE_TITLE || localize('Change value');
    openCenteredModal({
        title,
        value: this.getText(),
        onDone: text => {
            if (text !== null && this.sourceBlock_) {
                this.setValue(this.getValueFromEditorText_(text));
            }
            if (typeof this.onFinishEditing_ === 'function') this.onFinishEditing_(this.value_);
        },
    });
};

const installCenteredFieldModal = () => {
    const { FieldNumber, FieldTextInput, dialog } = window.Blockly || {};
    if (!FieldNumber && !FieldTextInput) return;

    // FieldNumber / FieldTextInput share FieldInput.prototype (not exported).
    const fieldInputProto =
        (FieldNumber && Object.getPrototypeOf(FieldNumber.prototype)) ||
        (FieldTextInput && Object.getPrototypeOf(FieldTextInput.prototype));
    if (!fieldInputProto || typeof fieldInputProto.showEditor_ !== 'function') return;
    if (Object.prototype.hasOwnProperty.call(fieldInputProto, '__dbotCenteredModal')) return;

    const originalShowEditor = fieldInputProto.showEditor_;
    fieldInputProto.showEditor_ = function (event, quietInput) {
        if (quietInput || !useCenteredFieldModal()) {
            originalShowEditor.call(this, event, quietInput);
            return;
        }
        showCenteredTextEditor.call(this);
    };
    fieldInputProto.__dbotCenteredModal = true;

    // Any leftover Blockly.dialog.prompt / window.prompt path (Change value:).
    if (dialog?.setPrompt) {
        dialog.setPrompt((message, defaultValue, callback) => {
            if (!useCenteredFieldModal()) {
                // eslint-disable-next-line no-alert
                callback(window.prompt(message, defaultValue));
                return;
            }
            openCenteredModal({
                title: message,
                value: defaultValue || '',
                onDone: callback,
            });
        });
    }
};

installCenteredFieldModal();
