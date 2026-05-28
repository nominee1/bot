import type { ReadyStrategyKey } from './readyStrategyPresets';

export type AutoDigitContract = {
  kind: 'over' | 'under';
  barrier: number;
};

export type AutoEvenOddSide = 'even' | 'odd';

export type ReadyExternalStartConfig = {
  presetKey: ReadyStrategyKey;
  market: string;
  stake: number;
  ticks: number;
  martingale: number;
  takeProfit: number;
  stopLoss: number;
  delayAfterSettle: boolean;
  /** @deprecated use contractKind + contractBarrier */
  overDigit?: number;
  contractKind?: 'over' | 'under';
  contractBarrier?: number;
  /** Auto run: trade this over/under barrier when green/red bars match */
  autoContract?: AutoDigitContract;
  /** Auto run: start Even or Odd when that side is at the min % on live ticks */
  autoEvenOddSide?: AutoEvenOddSide;
};

export type ReadyExternalController = {
  selectPreset: (key: ReadyStrategyKey) => void;
  start: (cfg: ReadyExternalStartConfig) => void;
  stop: () => void;
  isRunning: () => boolean;
};

export const readyExternalController: { current: ReadyExternalController | null } = { current: null };

/** DigitBarReady registers this so every stop path turns off the auto-run toggle. */
const autoRunDisableHandler: { current: (() => void) | null } = { current: null };

export function registerAutoRunDisableHandler(fn: (() => void) | null) {
  autoRunDisableHandler.current = fn;
}

export function startReadyFromExternal(cfg: ReadyExternalStartConfig) {
  readyExternalController.current?.start(cfg);
}

export function stopReadyFromExternal() {
  autoRunDisableHandler.current?.();
  readyExternalController.current?.stop();
}
