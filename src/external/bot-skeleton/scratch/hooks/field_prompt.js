import { localize } from '@deriv-com/translations';

// Native window.prompt always shows the real origin ("localhost says", etc.).
// This dialog keeps the same prompt UX but labels it bot.deriv.com like Deriv Bot.
const ARM_MS = 450;
const PROMPT_HOST = 'bot.deriv.com';

let activeModal = null;

const useMobileFieldPrompt = () => {
    const agent = window.Blockly?.utils?.userAgent;
    const mobileAgent = !!(agent && (agent.MOBILE || agent.ANDROID || agent.IPAD || agent.IPHONE));
    return mobileAgent || window.innerWidth < 1280;
};

const isIosPrompt = () => {
    const agent = window.Blockly?.utils?.userAgent;
    if (agent?.IPAD || agent?.IPHONE) return true;
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/i.test(ua)) return true;
    // iPadOS 13+ can report as Mac with touch
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
};

const promptMessageText = title => {
    const raw = String(title || window.Blockly?.Msg?.CHANGE_VALUE_TITLE || localize('Change value')).trim();
    const base = raw.replace(/:\s*$/, '') || localize('Change value');
    return `${base}:`;
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

const openPromptModal = ({ title, value = '', onDone }) => {
    closeModal(null);

    const ios = isIosPrompt();
    const root = document.createElement('div');
    root.className = `dbot-field-modal dbot-field-modal--${ios ? 'ios' : 'android'}`;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');

    const card = document.createElement('div');
    card.className = 'dbot-field-modal__card';

    const hostLine = document.createElement('p');
    hostLine.className = 'dbot-field-modal__host';
    hostLine.textContent = localize('{{host}} says', { host: PROMPT_HOST });
    card.appendChild(hostLine);

    const heading = document.createElement('p');
    heading.className = 'dbot-field-modal__title';
    heading.textContent = promptMessageText(title);
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
    cancel.className = 'dbot-field-modal__button dbot-field-modal__button--cancel';
    cancel.textContent = localize('Cancel');
    cancel.addEventListener('click', () => closeModal(null));

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'dbot-field-modal__button dbot-field-modal__button--ok';
    ok.textContent = localize('OK');
    ok.addEventListener('click', () => closeModal(input.value));

    // Android Chrome: Cancel | OK side-by-side. iOS Safari dark prompt: OK above Cancel.
    if (ios) {
        actions.appendChild(ok);
        actions.appendChild(cancel);
    } else {
        actions.appendChild(cancel);
        actions.appendChild(ok);
    }
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

    window.setTimeout(() => {
        if (!activeModal || activeModal.node !== root) return;
        input.focus({ preventScroll: true });
        input.select();
    }, ARM_MS);
};

const showPromptTextEditor = function () {
    const title = window.Blockly.Msg?.CHANGE_VALUE_TITLE || localize('Change value');
    openPromptModal({
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

const installBotDerivPrompt = () => {
    const { FieldNumber, FieldTextInput, dialog } = window.Blockly || {};
    if (!FieldNumber && !FieldTextInput) return;

    const fieldInputProto =
        (FieldNumber && Object.getPrototypeOf(FieldNumber.prototype)) ||
        (FieldTextInput && Object.getPrototypeOf(FieldTextInput.prototype));
    if (!fieldInputProto || typeof fieldInputProto.showEditor_ !== 'function') return;
    if (Object.prototype.hasOwnProperty.call(fieldInputProto, '__dbotDerivPrompt')) return;

    const originalShowEditor = fieldInputProto.showEditor_;
    fieldInputProto.showEditor_ = function (event, quietInput) {
        if (quietInput || !useMobileFieldPrompt()) {
            originalShowEditor.call(this, event, quietInput);
            return;
        }
        showPromptTextEditor.call(this);
    };
    fieldInputProto.__dbotDerivPrompt = true;

    if (dialog?.setPrompt) {
        dialog.setPrompt((message, defaultValue, callback) => {
            if (!useMobileFieldPrompt()) {
                // eslint-disable-next-line no-alert
                callback(window.prompt(message, defaultValue));
                return;
            }
            openPromptModal({
                title: message,
                value: defaultValue || '',
                onDone: callback,
            });
        });
    }
};

installBotDerivPrompt();
