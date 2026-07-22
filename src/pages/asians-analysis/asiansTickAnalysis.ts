import type { TAsiansContractId, TAsiansSide } from './asiansContractCatalog';

export type TAsiansMarketScore = {
    symbol: string;
    side: TAsiansSide;
    sideLabel: string;
    score: number;
    detail: string;
    meta?: {
        streak?: number;
        trials?: number;
        wins?: number;
        band?: number;
        bestIndex?: number;
    };
};

type TDir = 1 | -1 | 0;

function directions(prices: number[]): TDir[] {
    const out: TDir[] = [];
    for (let i = 1; i < prices.length; i += 1) {
        const a = prices[i - 1];
        const b = prices[i];
        if (b > a) out.push(1);
        else if (b < a) out.push(-1);
        else out.push(0);
    }
    return out;
}

/** Mean absolute tick step — used as a soft barrier unit. */
function meanAbsStep(prices: number[]): number {
    if (prices.length < 2) return 0;
    let sum = 0;
    let n = 0;
    for (let i = 1; i < prices.length; i += 1) {
        sum += Math.abs(prices[i] - prices[i - 1]);
        n += 1;
    }
    return n ? sum / n : 0;
}

function pct(wins: number, trials: number): number {
    if (!trials) return 0;
    return Math.round((wins / trials) * 1000) / 10;
}

function analyzeRuns(
    prices: number[],
    side: 'only_up' | 'only_down',
    minTicks: number
): TAsiansMarketScore['meta'] & {
    score: number;
    detail: string;
} {
    const dirs = directions(prices);
    const target: TDir = side === 'only_up' ? 1 : -1;
    let wins = 0;
    let trials = 0;
    for (let i = 0; i <= dirs.length - minTicks; i += 1) {
        trials += 1;
        let ok = true;
        for (let j = 0; j < minTicks; j += 1) {
            if (dirs[i + j] !== target) {
                ok = false;
                break;
            }
        }
        if (ok) wins += 1;
    }
    let streak = 0;
    for (let i = dirs.length - 1; i >= 0; i -= 1) {
        if (dirs[i] === target) streak += 1;
        else break;
    }
    const score = pct(wins, trials);
    const dirLabel = side === 'only_up' ? 'up' : 'down';
    return {
        score,
        wins,
        trials,
        streak,
        detail:
            trials > 0
                ? `${score}% of windows had ${minTicks}+ successive ${dirLabel} ticks · live streak ${streak}`
                : 'Not enough ticks',
    };
}

function analyzeRiseFall(prices: number[], side: 'rise' | 'fall', duration: number) {
    let wins = 0;
    let trials = 0;
    for (let i = 0; i + duration < prices.length; i += 1) {
        trials += 1;
        const entry = prices[i];
        const exit = prices[i + duration];
        if (side === 'rise' ? exit > entry : exit < entry) wins += 1;
    }
    const score = pct(wins, trials);
    return {
        score,
        wins,
        trials,
        detail: trials
            ? `${score}% exits ${side === 'rise' ? 'above' : 'below'} entry over ${duration} ticks`
            : 'Not enough ticks',
    };
}

function analyzeHigherLower(prices: number[], side: 'higher' | 'lower', duration: number) {
    const step = meanAbsStep(prices);
    const barrierOffset = step; // soft +1 / −1 tick-step barrier from entry
    let wins = 0;
    let trials = 0;
    for (let i = 0; i + duration < prices.length; i += 1) {
        trials += 1;
        const entry = prices[i];
        const exit = prices[i + duration];
        if (side === 'higher') {
            if (exit > entry + barrierOffset) wins += 1;
        } else if (exit < entry - barrierOffset) {
            wins += 1;
        }
    }
    const score = pct(wins, trials);
    return {
        score,
        wins,
        trials,
        band: barrierOffset,
        detail: trials
            ? `${score}% cleared ±${barrierOffset.toPrecision(3)} soft barrier in ${duration} ticks`
            : 'Not enough ticks',
    };
}

function analyzeStaysInOut(prices: number[], side: 'stays_between' | 'goes_outside', duration: number) {
    const step = meanAbsStep(prices);
    const band = Math.max(step * 2.5, step || 0);
    let wins = 0;
    let trials = 0;
    for (let i = 0; i + duration < prices.length; i += 1) {
        trials += 1;
        const entry = prices[i];
        const hi = entry + band;
        const lo = entry - band;
        let touched = false;
        for (let j = 1; j <= duration; j += 1) {
            const p = prices[i + j];
            if (p >= hi || p <= lo) {
                touched = true;
                break;
            }
        }
        if (side === 'stays_between' ? !touched : touched) wins += 1;
    }
    const score = pct(wins, trials);
    return {
        score,
        wins,
        trials,
        band,
        detail: trials
            ? `${score}% windows ${side === 'stays_between' ? 'stayed inside' : 'broke'} ±${band.toPrecision(3)} band`
            : 'Not enough ticks',
    };
}

function analyzeEndsInOut(prices: number[], side: 'ends_between' | 'ends_outside', duration: number) {
    const step = meanAbsStep(prices);
    const band = Math.max(step * 2.5, step || 0);
    let wins = 0;
    let trials = 0;
    for (let i = 0; i + duration < prices.length; i += 1) {
        trials += 1;
        const entry = prices[i];
        const exit = prices[i + duration];
        const hi = entry + band;
        const lo = entry - band;
        const between = exit > lo && exit < hi;
        if (side === 'ends_between' ? between : !between) wins += 1;
    }
    const score = pct(wins, trials);
    return {
        score,
        wins,
        trials,
        band,
        detail: trials
            ? `${score}% exits ${side === 'ends_between' ? 'inside' : 'outside'} ±${band.toPrecision(3)} band`
            : 'Not enough ticks',
    };
}

function analyzeTouch(prices: number[], side: 'touch' | 'no_touch', duration: number) {
    const step = meanAbsStep(prices);
    const barrierOffset = Math.max(step * 3, step || 0);
    let wins = 0;
    let trials = 0;
    for (let i = 0; i + duration < prices.length; i += 1) {
        trials += 1;
        const entry = prices[i];
        const barrier = entry + barrierOffset;
        let touched = false;
        for (let j = 1; j <= duration; j += 1) {
            if (prices[i + j] >= barrier) {
                touched = true;
                break;
            }
        }
        if (side === 'touch' ? touched : !touched) wins += 1;
    }
    const score = pct(wins, trials);
    return {
        score,
        wins,
        trials,
        band: barrierOffset,
        detail: trials
            ? `${score}% ${side === 'touch' ? 'touched' : 'avoided'} +${barrierOffset.toPrecision(3)} barrier`
            : 'Not enough ticks',
    };
}

function analyzeAsian(prices: number[], side: 'asian_up' | 'asian_down', duration: number) {
    let wins = 0;
    let trials = 0;
    for (let i = 0; i + duration < prices.length; i += 1) {
        trials += 1;
        let sum = 0;
        for (let j = 0; j <= duration; j += 1) sum += prices[i + j];
        const avg = sum / (duration + 1);
        const last = prices[i + duration];
        if (side === 'asian_up' ? last > avg : last < avg) wins += 1;
    }
    const score = pct(wins, trials);
    return {
        score,
        wins,
        trials,
        detail: trials
            ? `${score}% last tick ${side === 'asian_up' ? '>' : '<'} window average (${duration + 1} ticks)`
            : 'Not enough ticks',
    };
}

function analyzeHighLowTicks(prices: number[], side: 'high_tick' | 'low_tick') {
    const duration = 5;
    const counts = [0, 0, 0, 0, 0];
    let trials = 0;
    for (let i = 0; i + duration <= prices.length; i += 1) {
        trials += 1;
        const slice = prices.slice(i, i + duration);
        let bestIdx = 0;
        for (let j = 1; j < duration; j += 1) {
            if (side === 'high_tick' ? slice[j] > slice[bestIdx] : slice[j] < slice[bestIdx]) {
                bestIdx = j;
            }
        }
        counts[bestIdx] += 1;
    }
    let bestIndex = 0;
    for (let j = 1; j < 5; j += 1) {
        if (counts[j] > counts[bestIndex]) bestIndex = j;
    }
    const score = trials ? pct(counts[bestIndex], trials) : 0;
    return {
        score,
        wins: counts[bestIndex],
        trials,
        bestIndex: bestIndex + 1,
        detail: trials
            ? `Tick #${bestIndex + 1} was ${side === 'high_tick' ? 'highest' : 'lowest'} ${score}% of 5-tick windows`
            : 'Not enough ticks',
    };
}

const SIDE_LABEL: Record<TAsiansSide, string> = {
    only_up: 'Only Ups',
    only_down: 'Only Downs',
    higher: 'Higher',
    lower: 'Lower',
    stays_between: 'Stays Between',
    goes_outside: 'Goes Outside',
    ends_between: 'Ends Between',
    ends_outside: 'Ends Outside',
    rise: 'Rise',
    fall: 'Fall',
    touch: 'Touches',
    no_touch: 'Does Not Touch',
    asian_up: 'Asian Up',
    asian_down: 'Asian Down',
    high_tick: 'High Tick',
    low_tick: 'Low Tick',
};

export function analyzeAsiansMarket(
    symbol: string,
    prices: number[],
    contractId: TAsiansContractId,
    side: TAsiansSide,
    durationTicks: number
): TAsiansMarketScore {
    let result: {
        score: number;
        detail: string;
        wins?: number;
        trials?: number;
        streak?: number;
        band?: number;
        bestIndex?: number;
    };

    switch (contractId) {
        case 'runs':
            result = analyzeRuns(prices, side === 'only_down' ? 'only_down' : 'only_up', Math.max(2, durationTicks));
            break;
        case 'risefall':
            result = analyzeRiseFall(prices, side === 'fall' ? 'fall' : 'rise', durationTicks);
            break;
        case 'higherlower':
            result = analyzeHigherLower(prices, side === 'lower' ? 'lower' : 'higher', durationTicks);
            break;
        case 'staysinout':
            result = analyzeStaysInOut(
                prices,
                side === 'goes_outside' ? 'goes_outside' : 'stays_between',
                durationTicks
            );
            break;
        case 'endsinout':
            result = analyzeEndsInOut(prices, side === 'ends_outside' ? 'ends_outside' : 'ends_between', durationTicks);
            break;
        case 'touchnotouch':
            result = analyzeTouch(prices, side === 'no_touch' ? 'no_touch' : 'touch', durationTicks);
            break;
        case 'asian':
            result = analyzeAsian(prices, side === 'asian_down' ? 'asian_down' : 'asian_up', durationTicks);
            break;
        case 'highlowticks':
            result = analyzeHighLowTicks(prices, side === 'low_tick' ? 'low_tick' : 'high_tick');
            break;
        default:
            result = { score: 0, detail: 'Unsupported contract' };
    }

    return {
        symbol,
        side,
        sideLabel: SIDE_LABEL[side],
        score: result.score,
        detail: result.detail,
        meta: {
            streak: result.streak,
            trials: result.trials,
            wins: result.wins,
            band: result.band,
            bestIndex: result.bestIndex,
        },
    };
}
