import { botIframeLastDigitFromQuote } from '@/pages/accumulators/botIframeTickDigitFormat';
import { computeDigitFrequencyRanks, type DigitFrequencyRanks } from '@/utils/digitFrequencyRank';
import { digitSatisfiesBarRule, type BarPositionRule } from '@/utils/digitBarPositionRules';

export const DIGIT_BAR_SCAN_SYMBOLS = [
  'R_10',
  '1HZ10V',
  '1HZ15V',
  'R_25',
  '1HZ25V',
  '1HZ30V',
  'R_50',
  '1HZ50V',
  'R_75',
  '1HZ75V',
  '1HZ90V',
  'R_100',
  '1HZ100V',
] as const;

export const DEFAULT_EVEN_ODD_MIN_PCT = 65;
export const EVEN_ODD_ANALYZE_TICKS = 120;

export type EvenOddSide = 'even' | 'odd';

export type EvenOddPercentages = {
  evenPct: number;
  oddPct: number;
};

export type MarketScanRow = {
  symbol: string;
  ranks: DigitFrequencyRanks;
  volLabel: '1s' | 'std';
  barScore: number;
  rulesPass: boolean;
};

export type EvenOddScanRow = {
  symbol: string;
  volLabel: '1s' | 'std';
  evenPct: number;
  oddPct: number;
  dominantSide: EvenOddSide | null;
  rulesPass: boolean;
  score: number;
};

type TickSend = (payload: Record<string, unknown>) => Promise<unknown>;

export function evenOddPercentagesFromCounts(counts: number[]): EvenOddPercentages {
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (!total) return { evenPct: 0, oddPct: 0 };
  let even = 0;
  for (let d = 0; d <= 9; d += 1) {
    if (d % 2 === 0) even += counts[d] ?? 0;
  }
  const odd = total - even;
  return { evenPct: (even / total) * 100, oddPct: (odd / total) * 100 };
}

export function pickDominantEvenOddSide(
  { evenPct, oddPct }: EvenOddPercentages,
  minPercent: number,
): EvenOddSide | null {
  const evenPass = evenPct >= minPercent;
  const oddPass = oddPct >= minPercent;
  if (!evenPass && !oddPass) return null;
  if (evenPass && oddPass) return evenPct >= oddPct ? 'even' : 'odd';
  return evenPass ? 'even' : 'odd';
}

export function evenOddRulesPass({ evenPct, oddPct }: EvenOddPercentages, minPercent: number): boolean {
  return evenPct >= minPercent || oddPct >= minPercent;
}

export async function scanMarketsForEvenOdd(
  send: TickSend,
  symbols: readonly string[],
  tickCount: number,
  minPercent: number,
  onProgress?: (done: number, total: number) => void,
): Promise<EvenOddScanRow[]> {
  const maxCount = Math.max(10, Math.min(5000, tickCount));
  const minPct = Math.max(50, Math.min(99, minPercent));
  const rows: EvenOddScanRow[] = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    onProgress?.(i, symbols.length);

    try {
      const hist = (await send({
        ticks_history: symbol,
        style: 'ticks',
        count: maxCount,
        end: 'latest',
        subscribe: 0,
      })) as { history?: { prices?: unknown[] }; error?: unknown };

      if (hist?.error) continue;

      const prices = (hist?.history?.prices ?? []).map(Number).filter((n: number) => Number.isFinite(n));
      if (!prices.length) continue;

      const counts = Array(10).fill(0);
      prices.forEach(q => {
        const d = botIframeLastDigitFromQuote(q, symbol);
        if (Number.isFinite(d)) counts[d] += 1;
      });

      const pct = evenOddPercentagesFromCounts(counts);
      const dominantSide = pickDominantEvenOddSide(pct, minPct);
      const rulesPass = dominantSide != null;

      rows.push({
        symbol,
        volLabel: symbol.startsWith('1HZ') ? '1s' : 'std',
        evenPct: pct.evenPct,
        oddPct: pct.oddPct,
        dominantSide,
        rulesPass,
        score: Math.max(pct.evenPct, pct.oddPct),
      });
    } catch {
      /* skip failed market */
    }
  }

  return rows.sort((a, b) => b.rulesPass - a.rulesPass || b.score - a.score);
}

export function pickBestEvenOddMarket(rows: EvenOddScanRow[]): EvenOddScanRow | null {
  if (!rows.length) return null;
  const passing = rows.filter(r => r.rulesPass);
  if (passing.length) return passing[0];
  return rows[0];
}

export async function scanMarketsForDigitBars(
  send: TickSend,
  symbols: readonly string[],
  tickCount: number,
  rules: { green: BarPositionRule; red: BarPositionRule; blue: BarPositionRule },
  onProgress?: (done: number, total: number) => void,
): Promise<MarketScanRow[]> {
  const maxCount = Math.max(10, Math.min(5000, tickCount));
  const rows: MarketScanRow[] = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    onProgress?.(i, symbols.length);

    try {
      const hist = (await send({
        ticks_history: symbol,
        style: 'ticks',
        count: maxCount,
        end: 'latest',
        subscribe: 0,
      })) as { history?: { prices?: unknown[] }; error?: unknown };

      if (hist?.error) continue;

      const prices = (hist?.history?.prices ?? []).map(Number).filter((n: number) => Number.isFinite(n));
      if (!prices.length) continue;

      const counts = Array(10).fill(0);
      prices.forEach(q => {
        const d = botIframeLastDigitFromQuote(q, symbol);
        if (Number.isFinite(d)) counts[d] += 1;
      });

      const ranks = computeDigitFrequencyRanks(counts);
      const barScore = scoreMarketAgainstRules(ranks, rules);
      const rulesPass = marketPassesBarRules(ranks, rules);

      rows.push({
        symbol,
        ranks,
        volLabel: symbol.startsWith('1HZ') ? '1s' : 'std',
        barScore,
        rulesPass,
      });
    } catch {
      /* skip failed market */
    }
  }

  return rows.sort((a, b) => b.barScore - a.barScore || b.rulesPass - a.rulesPass);
}

export function scoreMarketAgainstRules(
  ranks: Pick<DigitFrequencyRanks, 'most' | 'second' | 'least'>,
  rules: { green: BarPositionRule; red: BarPositionRule; blue: BarPositionRule },
): number {
  let score = 0;
  if (digitSatisfiesBarRule(ranks.most, rules.green)) score += 12;
  else if (rules.green.enabled && ranks.most != null) {
    score += Math.max(0, 6 - distanceFromBarRule(ranks.most, rules.green));
  }
  if (digitSatisfiesBarRule(ranks.least, rules.red)) score += 12;
  else if (rules.red.enabled && ranks.least != null) {
    score += Math.max(0, 6 - distanceFromBarRule(ranks.least, rules.red));
  }
  if (rules.blue.enabled) {
    if (digitSatisfiesBarRule(ranks.second, rules.blue)) score += 6;
    else if (ranks.second != null) score += Math.max(0, 3 - distanceFromBarRule(ranks.second, rules.blue));
  }
  return score;
}

function distanceFromBarRule(digit: number, rule: BarPositionRule): number {
  if (!rule.enabled) return 0;
  if (rule.compare === 'above') return Math.max(0, rule.digit + 1 - digit);
  return Math.max(0, digit - (rule.digit - 1));
}

export function marketPassesBarRules(
  ranks: Pick<DigitFrequencyRanks, 'most' | 'second' | 'least'>,
  rules: { green: BarPositionRule; red: BarPositionRule; blue: BarPositionRule },
): boolean {
  return (
    digitSatisfiesBarRule(ranks.most, rules.green) &&
    digitSatisfiesBarRule(ranks.least, rules.red) &&
    digitSatisfiesBarRule(ranks.second, rules.blue)
  );
}

export function pickBestMarket(rows: MarketScanRow[]): MarketScanRow | null {
  if (!rows.length) return null;
  const passing = rows.filter(r => r.rulesPass);
  if (passing.length) return passing[0];
  return rows[0];
}
