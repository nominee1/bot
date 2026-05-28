/** Deriv minimum stake (USD). */
export const MIN_STAKE_USD = 0.35;

export type TTradingLevel = 'beginner' | 'intermediate' | 'expert';

export type TRiskProfile = {
    riskPerTradePct: number;
    dailyStopLossPct: number;
    dailyTakeProfitPct: number;
    martingaleMultiplier: number;
    maxMartingaleSteps: number;
    sessionWinRate: number;
    payoutRatio: number;
};

export const RISK_PROFILES: Record<TTradingLevel, TRiskProfile> = {
    beginner: {
        riskPerTradePct: 0.01,
        dailyStopLossPct: 0.05,
        dailyTakeProfitPct: 0.03,
        martingaleMultiplier: 1.25,
        maxMartingaleSteps: 3,
        sessionWinRate: 0.52,
        payoutRatio: 0.9,
    },
    intermediate: {
        riskPerTradePct: 0.015,
        dailyStopLossPct: 0.08,
        dailyTakeProfitPct: 0.05,
        martingaleMultiplier: 1.5,
        maxMartingaleSteps: 4,
        sessionWinRate: 0.55,
        payoutRatio: 0.92,
    },
    expert: {
        riskPerTradePct: 0.02,
        dailyStopLossPct: 0.1,
        dailyTakeProfitPct: 0.08,
        martingaleMultiplier: 1.75,
        maxMartingaleSteps: 5,
        sessionWinRate: 0.58,
        payoutRatio: 0.95,
    },
};

export type TRiskPlan = {
    balance: number;
    stake: number;
    martingaleMultiplier: number;
    martingaleStake: number;
    maxMartingaleSteps: number;
    martingaleExposure: number;
    stopLoss: number;
    takeProfit: number;
    riskPerTradeUsd: number;
};

const MIN_MARTINGALE_MULT = 1.01;
const MAX_MARTINGALE_MULT = 10;

export function clampMartingaleMultiplier(mult: number): number {
    if (!Number.isFinite(mult)) return MIN_MARTINGALE_MULT;
    return Math.round(Math.min(MAX_MARTINGALE_MULT, Math.max(MIN_MARTINGALE_MULT, mult)) * 100) / 100;
}

export function roundMoney(n: number): number {
    return Math.round(n * 100) / 100;
}

export function clampStake(stake: number): number {
    return roundMoney(Math.max(MIN_STAKE_USD, stake));
}

export function computeRiskPlan(
    balance: number,
    level: TTradingLevel,
    martingaleMultiplierOverride?: number
): TRiskPlan {
    const profile = RISK_PROFILES[level];
    const safeBalance = Math.max(balance, MIN_STAKE_USD);
    const martingaleMultiplier = clampMartingaleMultiplier(
        martingaleMultiplierOverride ?? profile.martingaleMultiplier
    );

    const stake = clampStake(safeBalance * profile.riskPerTradePct);
    const martingaleStake = clampStake(stake * martingaleMultiplier);

    let maxSteps = profile.maxMartingaleSteps;
    let exposure = stake;
    let totalExposure = stake;
    for (let i = 1; i < profile.maxMartingaleSteps; i++) {
        exposure = clampStake(exposure * martingaleMultiplier);
        totalExposure += exposure;
        if (totalExposure > safeBalance * 0.4) {
            maxSteps = i;
            break;
        }
    }

    return {
        balance: safeBalance,
        stake,
        martingaleMultiplier,
        martingaleStake,
        maxMartingaleSteps: maxSteps,
        martingaleExposure: roundMoney(totalExposure),
        stopLoss: roundMoney(safeBalance * profile.dailyStopLossPct),
        takeProfit: roundMoney(safeBalance * profile.dailyTakeProfitPct),
        riskPerTradeUsd: stake,
    };
}

/** One row per day — matches compounding challenge table layout. */
export type TChallengeDayRow = {
    day: number;
    capital: number;
    sessionProfits: number[];
    profit: number;
    reinvest: number;
    withdraw: number;
};

export type TGrowthSummary = {
    days: TChallengeDayRow[];
    startingBalance: number;
    endingCapital: number;
    totalWithdrawn: number;
    totalReinvested: number;
    totalProfit: number;
    sessionsPerDay: number;
    sessionReturnPcts: number[];
};

export type TGrowthInputs = {
    startingBalance: number;
    /** % of that day's capital per session (one value per session column). */
    sessionReturnPcts: number[];
    sessionsPerDay: number;
    days: number;
    /** % of daily profit withdrawn. */
    withdrawalPctOfProfit: number;
    /** % of daily profit retained into next day's capital. */
    reinvestPctOfProfit: number;
};

/**
 * Compounding challenge table:
 * - Each session profit = capital × sessionReturnPct%
 * - Daily profit = sum of sessions
 * - Retain / withdraw split from daily profit
 * - Next day capital = current capital + retained profit
 */
export function buildGrowthLedger(inputs: TGrowthInputs): TGrowthSummary {
    const sessionsPerDay = Math.max(1, Math.min(12, Math.floor(inputs.sessionsPerDay)));
    const totalDays = Math.max(1, Math.min(90, Math.floor(inputs.days)));
    const sessionReturnPcts = Array.from({ length: sessionsPerDay }, (_, i) => {
        const raw = inputs.sessionReturnPcts[i] ?? inputs.sessionReturnPcts[0] ?? 10;
        return Math.max(0.1, Math.min(100, raw));
    });
    const withdrawSplit = Math.max(0, Math.min(100, inputs.withdrawalPctOfProfit));
    const reinvestSplit = Math.max(0, Math.min(100, inputs.reinvestPctOfProfit));

    let capital = roundMoney(Math.max(inputs.startingBalance, MIN_STAKE_USD));
    const startingBalance = capital;
    let totalWithdrawn = 0;
    let totalReinvested = 0;
    let totalProfit = 0;
    const days: TChallengeDayRow[] = [];

    for (let d = 1; d <= totalDays; d++) {
        const dayCapital = capital;
        const sessionProfits: number[] = [];

        for (let s = 0; s < sessionsPerDay; s++) {
            sessionProfits.push(roundMoney(dayCapital * (sessionReturnPcts[s] / 100)));
        }

        const profit = roundMoney(sessionProfits.reduce((a, b) => a + b, 0));
        const reinvest = roundMoney(profit * (reinvestSplit / 100));
        const withdraw = roundMoney(profit * (withdrawSplit / 100));

        totalProfit = roundMoney(totalProfit + profit);
        totalWithdrawn = roundMoney(totalWithdrawn + withdraw);
        totalReinvested = roundMoney(totalReinvested + reinvest);

        days.push({
            day: d,
            capital: dayCapital,
            sessionProfits,
            profit,
            reinvest,
            withdraw,
        });

        capital = roundMoney(dayCapital + reinvest);
    }

    return {
        days,
        startingBalance,
        endingCapital: capital,
        totalWithdrawn,
        totalReinvested,
        totalProfit,
        sessionsPerDay,
        sessionReturnPcts,
    };
}

/** Derive session return % so each session targets ~stake on current capital. */
export function sessionReturnPctFromStake(capital: number, stake: number): number {
    if (capital <= 0 || stake <= 0) return 10;
    const pct = (stake / capital) * 100;
    return roundMoney(Math.min(100, Math.max(0.1, pct)));
}

export function clampSessionsPerDay(n: number): number {
    return Math.max(1, Math.min(12, Math.floor(n) || 1));
}

/** Resize per-session % array when session count changes. */
export function resizeSessionReturnPcts(prev: number[], count: number, fillPct = 10): number[] {
    const n = clampSessionsPerDay(count);
    const fill = prev[0] ?? fillPct;
    const next = prev.slice(0, n);
    while (next.length < n) next.push(fill);
    return next;
}

export type TContractSuggestion = {
    title: string;
    contracts: string;
    risk: 'low' | 'medium' | 'high';
    tabIndex: number;
    tabLabel: string;
    notes?: string;
};

/** Tab indices aligned with `main.tsx` hash order. */
export const MAIN_TAB = {
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    INSTANT_FILL: 2,
    SMART_TRADER: 3,
    PRO_AVIATOR: 4,
    AUTO_STRATEGY: 5,
    READY_STRATEGIES: 6,
    DOUBLE_DOUBLE: 7,
    MANUAL_TRADER: 8,
    RISK_CALCULATOR: 9,
    PARALLEL_COPY: 10,
    CHALLENGE: 11,
} as const;

export function getContractSuggestions(level: TTradingLevel): TContractSuggestion[] {
    const manual = {
        tabIndex: MAIN_TAB.MANUAL_TRADER,
        tabLabel: 'Manual Trader',
    };
    const auto = { tabIndex: MAIN_TAB.AUTO_STRATEGY, tabLabel: 'Auto Strategy' };
    const ready = { tabIndex: MAIN_TAB.READY_STRATEGIES, tabLabel: 'Strategies' };
    const instant = { tabIndex: MAIN_TAB.INSTANT_FILL, tabLabel: 'Instant Fill' };
    const smart = { tabIndex: MAIN_TAB.SMART_TRADER, tabLabel: 'Smart Trader' };
    const multi = { tabIndex: MAIN_TAB.DOUBLE_DOUBLE, tabLabel: 'Double Double' };
    const aviator = { tabIndex: MAIN_TAB.PRO_AVIATOR, tabLabel: 'Pro Aviator' };

    if (level === 'beginner') {
        return [
            {
                title: 'Rise / Fall (candles)',
                contracts: 'Rise & Fall on 1–5 tick duration',
                risk: 'low',
                ...manual,
                notes: 'Use candle view in Manual Trader; avoid long runs until you hit daily take profit.',
            },
            {
                title: 'Digits Over 1 & 2',
                contracts: 'Digit Over 1, Digit Over 2',
                risk: 'low',
                ...manual,
            },
            {
                title: 'Digits Under 7 & 8',
                contracts: 'Digit Under 7, Digit Under 8',
                risk: 'low',
                ...manual,
            },
            {
                title: 'Guided digit sequences',
                contracts: 'Even / Odd, low-volatility digit presets',
                risk: 'low',
                ...auto,
                notes: 'Auto Strategy runs structured digit logic with clearer stop rules.',
            },
            {
                title: 'Template strategies',
                contracts: 'Pre-built low-martingale templates',
                risk: 'low',
                ...ready,
            },
        ];
    }

    if (level === 'intermediate') {
        return [
            {
                title: 'Instant digit fills',
                contracts: 'Quick Over/Under, Even/Odd bursts',
                risk: 'medium',
                ...instant,
            },
            {
                title: 'Smart percentage entries',
                contracts: 'Weighted Over/Under with session caps',
                risk: 'medium',
                ...smart,
            },
            {
                title: 'Manual multi-contract',
                contracts: 'Rise/Fall + Digit Over/Under mix',
                risk: 'medium',
                ...manual,
            },
            {
                title: 'Double-side rounds',
                contracts: 'Paired digit predictions per round',
                risk: 'medium',
                ...multi,
            },
            {
                title: 'Ready strategy packs',
                contracts: 'Martingale-capped strategy files',
                risk: 'medium',
                ...ready,
            },
        ];
    }

    return [
        {
            title: 'Pro Aviator multiplier',
            contracts: 'Multiplier / cash-out discipline',
            risk: 'high',
            ...aviator,
        },
        {
            title: 'Double Double acceleration',
            contracts: 'Multi-leg digit rounds, higher pace',
            risk: 'high',
            ...multi,
        },
        {
            title: 'Smart Trader aggression',
            contracts: 'Higher stake % with strict stop loss',
            risk: 'high',
            ...smart,
        },
        {
            title: 'Instant Fill scalping',
            contracts: 'Rapid Over/Under, short durations',
            risk: 'high',
            ...instant,
        },
        {
            title: 'Manual advanced',
            contracts: 'Rise/Fall ladders, wider digit ranges',
            risk: 'high',
            ...manual,
        },
    ];
}
