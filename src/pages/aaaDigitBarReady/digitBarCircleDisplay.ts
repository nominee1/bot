import { digitSatisfiesBarRule, type BarPositionRule } from '@/utils/digitBarPositionRules';
import type { DigitContractKind } from './readyStrategyPresets';
import type { EvenOddSide } from './digitBarMarketScanner';

export type DigitCircleBarDisplayInput = {
  digit: number;
  ranks: { most: number | null; second: number | null; least: number | null };
  greenRule: BarPositionRule;
  redRule: BarPositionRule;
  blueRule: BarPositionRule;
  latestDigit: number | null;
  historyReady: boolean;
  isMarketFlipStrategy: boolean;
  contractKind: DigitContractKind;
  contractBarrier: number;
};

export type DigitCircleEvenOddInput = {
  digit: number;
  latestDigit: number | null;
  historyReady: boolean;
  dominantEvenOddSide: EvenOddSide | null;
};

/** Over/under: rank rings + green/red bar pass-fail + O/U zones. */
export function getDigitCircleBarClasses(input: DigitCircleBarDisplayInput): string[] {
  const {
    digit,
    ranks,
    greenRule,
    redRule,
    blueRule,
    latestDigit,
    historyReady,
    isMarketFlipStrategy,
    contractKind,
    contractBarrier,
  } = input;

  const classes = ['digits__digit'];

  if (historyReady && latestDigit === digit) {
    classes.push('digits__digit--latest');
  }

  if (historyReady && ranks.most === digit) {
    classes.push('digits__digit--bar-most');
    classes.push(
      digitSatisfiesBarRule(ranks.most, greenRule) ? 'digits__digit--bar-pass' : 'digits__digit--bar-fail',
    );
  }

  if (historyReady && ranks.least === digit) {
    classes.push('digits__digit--bar-least');
    classes.push(
      digitSatisfiesBarRule(ranks.least, redRule) ? 'digits__digit--bar-pass' : 'digits__digit--bar-fail',
    );
  }

  if (historyReady && blueRule.enabled && ranks.second === digit) {
    classes.push('digits__digit--bar-second');
    classes.push(
      digitSatisfiesBarRule(ranks.second, blueRule) ? 'digits__digit--bar-pass' : 'digits__digit--bar-fail',
    );
  }

  if (historyReady && isMarketFlipStrategy) {
    if (contractKind === 'over') {
      const inOverZone = contractBarrier === 0 ? digit > 0 : digit > contractBarrier;
      if (inOverZone) classes.push('digits__digit--ou-over');
    } else if (digit < contractBarrier) {
      classes.push('digits__digit--ou-under');
    }
  }

  return classes;
}

/** Even/odd: highlight the side that meets the min % threshold. */
export function getDigitCircleEvenOddClasses(input: DigitCircleEvenOddInput): string[] {
  const { digit, latestDigit, historyReady, dominantEvenOddSide } = input;
  const classes = ['digits__digit'];

  if (historyReady && latestDigit === digit) {
    classes.push('digits__digit--latest');
  }

  if (!historyReady || !dominantEvenOddSide) return classes;

  const isEvenDigit = digit % 2 === 0;
  if (dominantEvenOddSide === 'even' && isEvenDigit) {
    classes.push('digits__digit--even-side');
  }
  if (dominantEvenOddSide === 'odd' && !isEvenDigit) {
    classes.push('digits__digit--odd-side');
  }

  return classes;
}
