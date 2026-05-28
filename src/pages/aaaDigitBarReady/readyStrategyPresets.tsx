import { TradeTypesDigitsEvenIcon, TradeTypesDigitsOverIcon } from '@deriv/quill-icons';
import {
  clampOverContractDigit,
  clampUnderContractDigit,
  type ReadyBuildOptions,
  type ReadyPresetConfig,
} from '../aaaReadyStrategy/readyStrategyPresets';

export type {
  ActiveStrategy,
  DigitContractKind,
  ReadyBuildOptions,
  ReadyPresetConfig,
  RuntimePresetMode,
  StrategyType,
} from '../aaaReadyStrategy/readyStrategyPresets';

export {
  clampOverContractDigit,
  clampUnderContractDigit,
  presetUsesUpsDownsStrategies,
  READY_MARKET_OPTIONS,
} from '../aaaReadyStrategy/readyStrategyPresets';

/** Strategy keys shown on the Digit Bar / Auto Strategy tab only. */
export type ReadyStrategyKey = 'even_to_odd_3_losses' | 'over_market_flip';

export type ReadyStrategyCard = {
  key: ReadyStrategyKey;
  title: string;
  description: string;
  icon: JSX.Element;
  build: (stake: number, options?: ReadyBuildOptions) => ReadyPresetConfig;
};

export function createReadyStrategyCards(): ReadyStrategyCard[] {
  return [
    {
      key: 'over_market_flip',
      title: 'Over & Under Market Flip',
      description:
        'Trade Over or Under on green/red bar match. After 3 wins switch market; first loss on new market switches again.',
      icon: <TradeTypesDigitsOverIcon width={18} height={18} />,
      build: (stake, options) => {
        const kind = options?.contractKind ?? 'over';
        const barrier =
          options?.contractBarrier ??
          (kind === 'under' ? 7 : clampOverContractDigit(options?.overDigit ?? 2));
        const prediction =
          kind === 'under' ? clampUnderContractDigit(barrier) : clampOverContractDigit(barrier);
        return {
          activeStrategies: [{ key: kind, stake, prediction }],
          mainMode: false,
          switchOnLoss: false,
          lossesToSwitch: 1,
          mode: 'market_flip_after_3_wins',
        };
      },
    },
    {
      key: 'even_to_odd_3_losses',
      title: 'Even / Odd % Match',
      description:
        'Scans markets for Even or Odd at your min % (default 65%), then trades the dominant side on the best matching market.',
      icon: <TradeTypesDigitsEvenIcon width={18} height={18} />,
      build: stake => ({
        activeStrategies: [{ key: 'even', stake }],
        mainMode: false,
        switchOnLoss: false,
        lossesToSwitch: 1,
        mode: 'default',
      }),
    },
  ];
}
