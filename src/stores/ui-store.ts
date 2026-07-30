import { action, makeObservable, observable } from 'mobx';
import { isTouchDevice } from '@/components/shared/utils/screen/responsive';
import {
    readTradeExecutionMode,
    type TTradeExecutionMode,
    writeTradeExecutionMode,
} from '@/utils/trade-execution-mode';

export type { TTradeExecutionMode };

export default class UiStore {
    is_mobile = true;
    is_desktop = true;
    is_tablet = false;
    is_chart_layout_default = true;
    /** Dark mode is the default; bright mode is explicit `theme=light`. */
    is_dark_mode_on = localStorage.getItem('theme') !== 'light';
    account_switcher_disabled_message = '';
    current_focus = null;
    show_prompt = false;
    is_trading_assessment_for_new_user_enabled = false;
    is_accounts_switcher_on = false;
    /** Fast skips artificial bot delays; Normal paces purchases (~1s per sleep unit). */
    trade_execution_mode: TTradeExecutionMode = readTradeExecutionMode();

    // TODO: fix - need to implement this feature
    is_onscreen_keyboard_active = false;

    constructor() {
        makeObservable(this, {
            account_switcher_disabled_message: observable,
            current_focus: observable,
            is_accounts_switcher_on: observable,
            is_dark_mode_on: observable,
            is_desktop: observable,
            is_mobile: observable,
            is_tablet: observable,
            is_trading_assessment_for_new_user_enabled: observable,
            show_prompt: observable,
            trade_execution_mode: observable,
            setAccountSwitcherDisabledMessage: action.bound,
            setCurrentFocus: action.bound,
            setDarkMode: action.bound,
            setDevice: action.bound,
            setPromptHandler: action.bound,
            setIsTradingAssessmentForNewUserEnabled: action.bound,
            setTradeExecutionMode: action,
            toggleTradeExecutionMode: action,
            toggleAccountsDialog: action.bound,
            toggleOnScreenKeyboard: action.bound,
        });
    }

    setTradeExecutionMode = (mode: TTradeExecutionMode) => {
        this.trade_execution_mode = mode;
        writeTradeExecutionMode(mode);
    };

    toggleTradeExecutionMode = () => {
        this.setTradeExecutionMode(this.trade_execution_mode === 'fast' ? 'normal' : 'fast');
    };

    setPromptHandler = (should_show: boolean) => {
        this.show_prompt = should_show;
    };

    setAccountSwitcherDisabledMessage = (message: string) => {
        if (message) {
            this.account_switcher_disabled_message = message;
        } else {
            this.account_switcher_disabled_message = '';
        }
    };
    setIsTradingAssessmentForNewUserEnabled(value: boolean) {
        this.is_trading_assessment_for_new_user_enabled = value;
    }

    setDarkMode = (value: boolean) => {
        this.is_dark_mode_on = value;
        try {
            localStorage.setItem('theme', value ? 'dark' : 'light');
            localStorage.setItem('ui_store', JSON.stringify({ is_dark_mode_on: value }));
        } catch {
            /* ignore */
        }
        const body = typeof document !== 'undefined' ? document.querySelector('body') : null;
        if (!body) return;
        if (value) {
            body.classList.remove('theme--light');
            body.classList.add('theme--dark');
        } else {
            body.classList.remove('theme--dark');
            body.classList.add('theme--light');
        }
    };

    setDevice = (value: 'mobile' | 'desktop' | 'tablet') => {
        this.is_mobile = value === 'mobile';
        this.is_desktop = value === 'desktop';
        this.is_tablet = value === 'tablet';
    };

    toggleAccountsDialog(status = !this.is_accounts_switcher_on) {
        this.is_accounts_switcher_on = status;
    }

    toggleOnScreenKeyboard() {
        this.is_onscreen_keyboard_active = this.current_focus !== null && this.is_mobile && isTouchDevice();
    }

    setCurrentFocus(value) {
        this.current_focus = value;
        this.toggleOnScreenKeyboard();
    }
}
