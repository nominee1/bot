import {
  clampBarDigit,
  greenRedBarRulesSatisfied,
  type BarPositionRule,
} from '@/utils/digitBarPositionRules';
import type { ReadyBuildOptions, ReadyStrategyCard, ReadyStrategyKey, StrategyType } from './readyStrategyPresets';
import {
  clampOverContractDigit,
  clampUnderContractDigit,
  type DigitContractKind,
} from './readyStrategyPresets';

export type StrategyBarProfile = {
  key: ReadyStrategyKey;
  label: string;
  green: BarPositionRule;
  red: BarPositionRule;
  blue: BarPositionRule;
  /** Short note shown in scanner */
  hint: string;
};

function rule(compare: 'above' | 'below', digit: number, enabled = true): BarPositionRule {
  return { enabled, compare, digit: clampBarDigit(digit) };
}

function profileFromOver(prediction: number, title: string, key: ReadyStrategyKey): StrategyBarProfile {
  const p = clampBarDigit(prediction);
  const greenThreshold = Math.min(9, p + 3);
  const redThreshold = Math.min(9, p + 1);
  return {
    key,
    label: title,
    green: rule('above', greenThreshold),
    red: rule('below', redThreshold),
    blue: { enabled: false, compare: 'below', digit: 5 },
    hint: `Over ${p}: scan for markets where most digit is above ${greenThreshold} and least is below ${redThreshold} (room to buy Over ${p}).`,
  };
}

function profileFromUnder(prediction: number, title: string, key: ReadyStrategyKey): StrategyBarProfile {
  const p = clampBarDigit(prediction);
  const greenThreshold = Math.max(0, p - 1);
  const redThreshold = Math.min(9, p + 1);
  return {
    key,
    label: title,
    green: rule('below', greenThreshold),
    red: rule('above', redThreshold),
    blue: { enabled: false, compare: 'above', digit: 5 },
    hint: `Under ${p}: scan for markets where most digit is below ${greenThreshold} and least is above ${redThreshold}.`,
  };
}

function profileFromEvenOdd(kind: 'even' | 'odd', key: ReadyStrategyKey, title: string): StrategyBarProfile {
  return {
    key,
    label: title,
    green: rule('below', 5),
    red: rule('above', 4),
    blue: { enabled: false, compare: 'below', digit: 5 },
    hint: `${kind === 'even' ? 'Even' : 'Odd'}: favour markets with a low hot digit (most below 5) and a high cold digit (least above 4).`,
  };
}

function profileGeneric(key: ReadyStrategyKey, title: string): StrategyBarProfile {
  return {
    key,
    label: title,
    green: rule('below', 3),
    red: rule('above', 7),
    blue: { enabled: false, compare: 'below', digit: 5 },
    hint: 'Default spread: most below 3, least above 7.',
  };
}

function primaryStrategy(card: ReadyStrategyCard, options?: ReadyBuildOptions): { key: StrategyType; prediction?: number } {
  const preset = card.build(0.35, options);
  const s = preset.activeStrategies[0];
  return { key: s.key, prediction: typeof s.prediction === 'number' ? s.prediction : undefined };
}

export type { DigitContractKind } from './readyStrategyPresets';

export type DigitContractCandidate = {
  kind: DigitContractKind;
  barrier: number;
};

/** Priority order for Over Market Flip auto run when bars match. */
export const OVER_MARKET_AUTO_CANDIDATES: DigitContractCandidate[] = [
  { kind: 'over', barrier: 2 },
  { kind: 'over', barrier: 3 },
  { kind: 'under', barrier: 7 },
  { kind: 'under', barrier: 6 },
];

export function getContractBarRules(
  kind: DigitContractKind,
  barrier: number,
): { green: BarPositionRule; red: BarPositionRule } {
  const p = clampBarDigit(barrier);
  if (kind === 'over') {
    return {
      green: rule('above', Math.min(9, p + 3)),
      red: rule('below', Math.min(9, p + 1)),
    };
  }
  return {
    green: rule('below', Math.max(0, p - 1)),
    red: rule('above', Math.min(9, p + 1)),
  };
}

export function pickOverMarketAutoCandidate(
  ranks: { most: number | null; least: number | null },
): DigitContractCandidate | null {
  for (const candidate of OVER_MARKET_AUTO_CANDIDATES) {
    const { green, red } = getContractBarRules(candidate.kind, candidate.barrier);
    if (greenRedBarRulesSatisfied(ranks, green, red)) return candidate;
  }
  return null;
}

export function formatDigitContractLabel(candidate: DigitContractCandidate): string {
  const prefix = candidate.kind === 'over' ? 'Over' : 'Under';
  return `${prefix} ${candidate.barrier}`;
}

function marketFlipBuildOptions(options?: ReadyBuildOptions): ReadyBuildOptions | undefined {
  if (!options) return undefined;
  const kind: DigitContractKind = options.contractKind ?? 'over';
  const barrier =
    options.contractBarrier ??
    (kind === 'under' ? 7 : clampOverContractDigit(options.overDigit ?? 2));
  return {
    contractKind: kind,
    contractBarrier: kind === 'under' ? clampUnderContractDigit(barrier) : clampOverContractDigit(barrier),
  };
}

export function getStrategyBarProfile(card: ReadyStrategyCard, options?: ReadyBuildOptions): StrategyBarProfile {
  const buildOpts =
    card.key === 'over_market_flip' ? marketFlipBuildOptions(options) : options;
  const { key: st, prediction } = primaryStrategy(card, buildOpts);

  switch (card.key) {
    case 'over_market_flip': {
      const kind = buildOpts?.contractKind ?? 'over';
      const barrier = buildOpts?.contractBarrier ?? (kind === 'under' ? 7 : 2);
      return kind === 'under'
        ? profileFromUnder(barrier, card.title, card.key)
        : profileFromOver(barrier, card.title, card.key);
    }
    case 'even_to_odd_3_losses':
      return profileFromEvenOdd('even', card.key, card.title);
    default:
      if (st === 'over' && prediction != null) return profileFromOver(prediction, card.title, card.key);
      if (st === 'under' && prediction != null) return profileFromUnder(prediction, card.title, card.key);
      if (st === 'even') return profileFromEvenOdd('even', card.key, card.title);
      if (st === 'odd') return profileFromEvenOdd('odd', card.key, card.title);
      return profileGeneric(card.key, card.title);
  }
}
