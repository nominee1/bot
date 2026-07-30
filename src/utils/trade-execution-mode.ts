export type TTradeExecutionMode = 'fast' | 'normal';

export const TRADE_EXECUTION_MODE_KEY = 'dbot_trade_execution_mode';

export const readTradeExecutionMode = (): TTradeExecutionMode => {
    try {
        return localStorage.getItem(TRADE_EXECUTION_MODE_KEY) === 'normal' ? 'normal' : 'fast';
    } catch {
        return 'fast';
    }
};

/** True unless the user explicitly chose Normal (default is Fast). */
export const isFastTradeExecution = (): boolean => readTradeExecutionMode() === 'fast';

export const writeTradeExecutionMode = (mode: TTradeExecutionMode): void => {
    try {
        localStorage.setItem(TRADE_EXECUTION_MODE_KEY, mode);
    } catch {
        /* ignore quota / private mode */
    }
};

/**
 * Blockly `sleep(n)` delay in ms — Fast skips pacing; Normal uses ~1s per unit (+ jitter).
 * Fast also skips the post-sell tick wait in tradeEngine `watchScope` (see trade/index.js).
 */
export const getTradeExecutionSleepMs = (arg = 1): number => {
    if (readTradeExecutionMode() !== 'normal') {
        return 0;
    }
    const units = Math.max(1, Number(arg) || 1);
    return units * (1000 + 700 * Math.random());
};
