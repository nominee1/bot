export type BarCompare = 'above' | 'below';

export type BarPositionRule = {
  enabled: boolean;
  compare: BarCompare;
  /** Threshold digit 0–9: above => rank digit must be > this; below => rank digit must be < this */
  digit: number;
};

export function clampBarDigit(d: number): number {
  if (!Number.isFinite(d)) return 0;
  return Math.min(9, Math.max(0, Math.trunc(d)));
}

/** Green=most, blue=2nd most, red=least — optional blue can be disabled. */
export function digitSatisfiesBarRule(rankDigit: number | null, rule: BarPositionRule): boolean {
  if (!rule.enabled) return true;
  if (rankDigit == null || !Number.isFinite(rankDigit)) return false;
  const threshold = clampBarDigit(rule.digit);
  if (rule.compare === 'above') return rankDigit > threshold;
  return rankDigit < threshold;
}

export function allBarRulesSatisfied(
  ranks: { most: number | null; second: number | null; least: number | null },
  green: BarPositionRule,
  red: BarPositionRule,
  blue: BarPositionRule,
): boolean {
  return (
    digitSatisfiesBarRule(ranks.most, green) &&
    digitSatisfiesBarRule(ranks.least, red) &&
    digitSatisfiesBarRule(ranks.second, blue)
  );
}

/** Auto run: most (green) and least (red) bars only — blue is ignored. */
export function greenRedBarRulesSatisfied(
  ranks: { most: number | null; least: number | null },
  green: BarPositionRule,
  red: BarPositionRule,
): boolean {
  return digitSatisfiesBarRule(ranks.most, green) && digitSatisfiesBarRule(ranks.least, red);
}
