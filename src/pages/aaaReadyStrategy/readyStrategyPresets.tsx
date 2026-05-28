import {
  TradeTypesDigitsDiffersIcon,
  TradeTypesDigitsMatchesIcon,
  TradeTypesDigitsOverIcon,
  TradeTypesDigitsUnderIcon,
  TradeTypesUpsAndDownsFallIcon,
  TradeTypesUpsAndDownsRiseIcon,
} from '@deriv/quill-icons';

export type StrategyType =
  | 'even'
  | 'odd'
  | 'over'
  | 'under'
  | 'matches'
  | 'differs'
  | 'rise'
  | 'fall'
  | 'only_up'
  | 'only_down'
  | 'rise_equals'
  | 'fall_equals';

export type DigitContractKind = 'over' | 'under';

export type ReadyBuildOptions = {
  /** @deprecated use contractKind + contractBarrier */
  overDigit?: number;
  contractKind?: DigitContractKind;
  contractBarrier?: number;
};

export type ReadyStrategyKey =
  | 'over2_market_flip'
  | 'under7_market_flip'
  | 'over2_to_over4_main'
  | 'under7_to_over3_main'
  | 'all_switched_on_loss'
  | 'rise_to_fall_on_loss'
  | 'only_up_to_only_down_on_loss'
  | 'rotation_over2_over3_under7_under6'
  | 'rise_equals_to_fall_equals_on_loss'
  | 'only_up_alone'
  | 'only_down_alone'
  | 'virtual_over2_after_3_virtual_wins'
  | 'virtual_under7_after_3_virtual_wins'
  | 'virtual_over4_under6_after_4_virtual_losses';

export type RuntimePresetMode = 'default' | 'market_flip_after_3_wins' | 'rotate_each_settle';

export type ActiveStrategy = {
  key: StrategyType;
  stake: number | '';
  prediction?: number | '';
};

export type ReadyPresetConfig = {
  activeStrategies: ActiveStrategy[];
  mainMode: boolean;
  switchOnLoss: boolean;
  lossesToSwitch: number;
  mode: RuntimePresetMode;
  virtualHooks?: {
    enabled: boolean;
    virtualMode: 'wins' | 'losses';
    virtualTarget: number;
    martingaleDelay: number;
    returnToVirtual: number;
  };
};

export type ReadyStrategyCard = {
  key: ReadyStrategyKey;
  title: string;
  description: string;
  icon: JSX.Element;
  build: (stake: number, options?: ReadyBuildOptions) => ReadyPresetConfig;
};

export function clampOverContractDigit(d: number): number {
  if (!Number.isFinite(d)) return 2;
  return Math.min(8, Math.max(0, Math.trunc(d)));
}

export function clampUnderContractDigit(d: number): number {
  if (!Number.isFinite(d)) return 7;
  return Math.min(9, Math.max(1, Math.trunc(d)));
}

export const READY_MARKET_OPTIONS = [
  { value: 'R_10', label: 'Vol 10' },
  { value: '1HZ10V', label: 'Vol 10 (1s)' },
  { value: '1HZ15V', label: 'Vol 15 (1s)' },
  { value: 'R_25', label: 'Vol 25' },
  { value: '1HZ25V', label: 'Vol 25 (1s)' },
  { value: '1HZ30V', label: 'Vol 30 (1s)' },
  { value: 'R_50', label: 'Vol 50' },
  { value: '1HZ50V', label: 'Vol 50 (1s)' },
  { value: 'R_75', label: 'Vol 75' },
  { value: '1HZ75V', label: 'Vol 75 (1s)' },
  { value: '1HZ90V', label: 'Vol 90 (1s)' },
  { value: 'R_100', label: 'Vol 100' },
  { value: '1HZ100V', label: 'Vol 100 (1s)' },
  { value: 'JD10', label: 'Jump 10' },
  { value: 'JD25', label: 'Jump 25' },
  { value: 'JD50', label: 'Jump 50' },
  { value: 'JD75', label: 'Jump 75' },
  { value: 'JD100', label: 'Jump 100' },
] as const;

const UPS_DOWNS_STRATEGY_KEYS: StrategyType[] = [
  'rise',
  'fall',
  'only_up',
  'only_down',
  'rise_equals',
  'fall_equals',
];

export function presetUsesUpsDownsStrategies(preset: ReadyPresetConfig): boolean {
  return preset.activeStrategies.some(s => UPS_DOWNS_STRATEGY_KEYS.includes(s.key));
}

export function createReadyStrategyCards(): ReadyStrategyCard[] {
  return [
    {
      key: 'over2_market_flip',
      title: 'Over 2 + Market Flip',
      description:
        'Trade Over 2. After 3 wins switch market. If first trade on new market loses, switch market immediately.',
      icon: <TradeTypesDigitsOverIcon width={18} height={18} />,
      build: stake => ({
        activeStrategies: [{ key: 'over', stake, prediction: 2 }],
        mainMode: false,
        switchOnLoss: false,
        lossesToSwitch: 1,
        mode: 'market_flip_after_3_wins',
      }),
    },
    {
      key: 'under7_market_flip',
      title: 'Under 7 + Market Flip',
      description:
        'Trade Under 7. After 3 wins switch market. If first trade on new market loses, switch market immediately.',
      icon: <TradeTypesDigitsUnderIcon width={18} height={18} />,
      build: stake => ({
        activeStrategies: [{ key: 'under', stake, prediction: 7 }],
        mainMode: false,
        switchOnLoss: false,
        lossesToSwitch: 1,
        mode: 'market_flip_after_3_wins',
      }),
    },
    {
      key: 'over2_to_over4_main',
      title: 'Over 2 → Over 4',
      description: 'Main mode ON. Starts with Over 2, then switches to Over 4 on loss.',
      icon: <TradeTypesDigitsOverIcon width={18} height={18} />,
      build: stake => ({
        activeStrategies: [
          { key: 'over', stake, prediction: 2 },
          { key: 'over', stake, prediction: 4 },
        ],
        mainMode: true,
        switchOnLoss: true,
        lossesToSwitch: 1,
        mode: 'default',
      }),
    },
    {
      key: 'under7_to_over3_main',
      title: 'Under 7 → Over 3',
      description: 'Main mode ON. Starts with Under 7, then switches to Over 3 on loss.',
      icon: <TradeTypesDigitsUnderIcon width={18} height={18} />,
      build: stake => ({
        activeStrategies: [
          { key: 'under', stake, prediction: 7 },
          { key: 'over', stake, prediction: 3 },
        ],
        mainMode: true,
        switchOnLoss: true,
        lossesToSwitch: 1,
        mode: 'default',
      }),
    },
    {
      key: 'all_switched_on_loss',
      title: 'All Strategies Switch on Loss',
      description: 'Cycles through multiple contracts and moves to the next one after a loss.',
      icon: <TradeTypesDigitsMatchesIcon width={18} height={18} />,
      build: stake => ({
        activeStrategies: [
          { key: 'over', stake, prediction: 2 },
          { key: 'under', stake, prediction: 7 },
          { key: 'even', stake },
          { key: 'odd', stake },
        ],
        mainMode: false,
        switchOnLoss: true,
        lossesToSwitch: 1,
        mode: 'default',
      }),
    },
    {
      key: 'rise_to_fall_on_loss',
      title: 'Rise → Fall on Loss',
      description: 'Starts with Rise and switches to Fall on loss.',
      icon: <TradeTypesUpsAndDownsRiseIcon width={18} height={18} />,
      build: stake => ({
        activeStrategies: [
          { key: 'rise', stake },
          { key: 'fall', stake },
        ],
        mainMode: true,
        switchOnLoss: true,
        lossesToSwitch: 1,
        mode: 'default',
      }),
    },
    {
      key: 'only_up_to_only_down_on_loss',
      title: 'Only Ups → Only Downs',
      description: 'Starts with Only Ups and switches to Only Downs on loss.',
      icon: <TradeTypesUpsAndDownsRiseIcon width={18} height={18} />,
      build: stake => ({
        activeStrategies: [
          { key: 'only_up', stake },
          { key: 'only_down', stake },
        ],
        mainMode: true,
        switchOnLoss: true,
        lossesToSwitch: 1,
        mode: 'default',
      }),
    },
    {
      key: 'rotation_over2_over3_under7_under6',
      title: 'Rotation: O2 → O3 → U7 → U6',
      description: 'Rotates to the next contract after every settled trade.',
      icon: <TradeTypesDigitsDiffersIcon width={18} height={18} />,
      build: stake => ({
        activeStrategies: [
          { key: 'over', stake, prediction: 2 },
          { key: 'over', stake, prediction: 3 },
          { key: 'under', stake, prediction: 7 },
          { key: 'under', stake, prediction: 6 },
        ],
        mainMode: false,
        switchOnLoss: false,
        lossesToSwitch: 1,
        mode: 'rotate_each_settle',
      }),
    },
    {
      key: 'rise_equals_to_fall_equals_on_loss',
      title: 'Rise = → Fall = on Loss',
      description: 'Starts with Rise Equals and switches to Fall Equals on loss.',
      icon: <TradeTypesUpsAndDownsRiseIcon width={18} height={18} />,
      build: stake => ({
        activeStrategies: [
          { key: 'rise_equals', stake },
          { key: 'fall_equals', stake },
        ],
        mainMode: true,
        switchOnLoss: true,
        lossesToSwitch: 1,
        mode: 'default',
      }),
    },
    {
      key: 'only_up_alone',
      title: 'Only Ups Alone',
      description: 'Runs Only Ups only.',
      icon: <TradeTypesUpsAndDownsRiseIcon width={18} height={18} />,
      build: stake => ({
        activeStrategies: [{ key: 'only_up', stake }],
        mainMode: false,
        switchOnLoss: false,
        lossesToSwitch: 1,
        mode: 'default',
      }),
    },
    {
      key: 'only_down_alone',
      title: 'Only Downs Alone',
      description: 'Runs Only Downs only.',
      icon: <TradeTypesUpsAndDownsFallIcon width={18} height={18} />,
      build: stake => ({
        activeStrategies: [{ key: 'only_down', stake }],
        mainMode: false,
        switchOnLoss: false,
        lossesToSwitch: 1,
        mode: 'default',
      }),
    },
    {
      key: 'virtual_over2_after_3_virtual_wins',
      title: 'Virtual Over 2 after 3 Wins',
      description:
        'Waits for 3 virtual wins, then takes real Over 2. Recovery returns to virtual after real wins.',
      icon: <TradeTypesDigitsOverIcon width={18} height={18} />,
      build: stake => ({
        activeStrategies: [{ key: 'over', stake, prediction: 2 }],
        mainMode: false,
        switchOnLoss: false,
        lossesToSwitch: 1,
        mode: 'default',
        virtualHooks: {
          enabled: true,
          virtualMode: 'wins',
          virtualTarget: 3,
          martingaleDelay: 0,
          returnToVirtual: 1,
        },
      }),
    },
    {
      key: 'virtual_under7_after_3_virtual_wins',
      title: 'Virtual Under 7 after 3 Wins',
      description:
        'Waits for 3 virtual wins, then takes real Under 7. Recovery returns to virtual after real wins.',
      icon: <TradeTypesDigitsUnderIcon width={18} height={18} />,
      build: stake => ({
        activeStrategies: [{ key: 'under', stake, prediction: 7 }],
        mainMode: false,
        switchOnLoss: false,
        lossesToSwitch: 1,
        mode: 'default',
        virtualHooks: {
          enabled: true,
          virtualMode: 'wins',
          virtualTarget: 3,
          martingaleDelay: 0,
          returnToVirtual: 1,
        },
      }),
    },
    {
      key: 'virtual_over4_under6_after_4_virtual_losses',
      title: 'Virtual O4 / U6 after 4 Losses',
      description:
        'Waits for 4 virtual losses, then takes real Over 4 / Under 6 using the normal recovery flow.',
      icon: <TradeTypesDigitsDiffersIcon width={18} height={18} />,
      build: stake => ({
        activeStrategies: [
          { key: 'over', stake, prediction: 4 },
          { key: 'under', stake, prediction: 6 },
        ],
        mainMode: false,
        switchOnLoss: true,
        lossesToSwitch: 1,
        mode: 'default',
        virtualHooks: {
          enabled: true,
          virtualMode: 'losses',
          virtualTarget: 4,
          martingaleDelay: 0,
          returnToVirtual: 1,
        },
      }),
    },
  ];
}
