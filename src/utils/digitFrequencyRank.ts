export type DigitRank = 1 | 2 | 3 | 4 | null;

export type RankedDigitStat = {
  digit: number;
  count: number;
  pct: number;
  rank: DigitRank;
};

export type DigitFrequencyRanks = {
  ranked: RankedDigitStat[];
  most: number | null;
  second: number | null;
  third: number | null;
  least: number | null;
  total: number;
};

/** Rank digits by frequency: 1=most, 2=2nd, 3=3rd, 4=least (ties: higher digit wins for least). */
export function computeDigitFrequencyRanks(digitCounts: number[]): DigitFrequencyRanks {
  const total = digitCounts.reduce((s, n) => s + n, 0);
  const raw = Array.from({ length: 10 }, (_, d) => ({
    digit: d,
    count: digitCounts[d] || 0,
    pct: total > 0 ? ((digitCounts[d] || 0) / total) * 100 : 0,
  }));

  if (!total) {
    return {
      ranked: raw.map(x => ({ ...x, rank: null })),
      most: null,
      second: null,
      third: null,
      least: null,
      total: 0,
    };
  }

  const sorted = [...raw].sort((a, b) => b.count - a.count || a.digit - b.digit);
  const most = sorted[0]?.digit ?? null;
  const second = sorted[1]?.digit ?? null;
  const third = sorted[2]?.digit ?? null;

  const minCount = Math.min(...raw.map(x => x.count));
  const leastCandidates = raw.filter(x => x.count === minCount);
  const least = leastCandidates.length
    ? [...leastCandidates].sort((a, b) => b.digit - a.digit)[0].digit
    : null;

  const ranked = raw
    .map(x => {
      let rank: DigitRank = null;
      if (x.digit === most) rank = 1;
      else if (x.digit === second) rank = 2;
      else if (x.digit === third) rank = 3;
      else if (x.digit === least) rank = 4;
      return { ...x, rank };
    })
    .sort((a, b) => a.digit - b.digit);

  return { most, second, third, least, ranked, total };
}
