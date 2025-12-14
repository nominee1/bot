/* ====================================================================== */
/*  Strategy.tsx – TP / SL version                       */
/* ====================================================================== */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { api_base } from '@/external/bot-skeleton';
import {
    TradeTypesDigitsEvenIcon,
    TradeTypesDigitsOddIcon,
    TradeTypesDigitsMatchesIcon,
    TradeTypesDigitsOverIcon,
    TradeTypesDigitsDiffersIcon,
    TradeTypesDigitsUnderIcon,
    TradeTypesUpsAndDownsFallIcon,
    TradeTypesUpsAndDownsRiseIcon,
    MarketDerivedVolatility1001sIcon,
    MarketDerivedVolatility100Icon,
    MarketDerivedVolatility10Icon,
    MarketDerivedVolatility25Icon,
    MarketDerivedVolatility50Icon,
    MarketDerivedVolatility75Icon,
    MarketDerivedVolatility101sIcon,
    MarketDerivedVolatility251sIcon,
    MarketDerivedVolatility501sIcon,
    MarketDerivedVolatility751sIcon
} from '@deriv/quill-icons';
import './Strategy.scss';

/* ────────────────────────────────────────────────────────────────────
 *  Tick-stream hook with fixes for subscription cleanup
 * ──────────────────────────────────────────────────────────────────── */
let subscriptionId = 0;

function useTickStream(symbol: string, onTick: (p: number, s: string) => void) {
    useEffect(() => {
        let active = true;
        let lastTick: number | null = null;
        const currentId = ++subscriptionId;

        const run = async () => {
            try {
                await api_base.api.send({ forget_all: 'ticks' });
                await api_base.api.send({ ticks: symbol, subscribe: 1 });

                const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
                    if (!active || currentId !== subscriptionId || data?.msg_type !== 'tick' || !data?.tick?.quote) return;

                    if (lastTick === data.tick.quote) return;
                    lastTick = data.tick.quote;

                    onTick(data.tick.quote, symbol);
                });

                return () => sub.unsubscribe();
            } catch (error) {
                console.error('Tick stream error:', error);
            }
        };

        run();
        return () => {
            active = false;
            setTimeout(() => {
                api_base.api.send({ forget_all: 'ticks' }).catch(console.warn);
            }, 100);
        };
    }, [symbol, onTick]);
}

/* ────────────────────────────────────────────────────────────────────
 *  DigitAnalyzer
 * ──────────────────────────────────────────────────────────────────── */
class DigitAnalyzer {
    private lastProcessedPrice: number | null = null;
    consecutiveCounts = Array<number>(10).fill(0);
    streaks = { even: 0, odd: 0, rise: 0, fall: 0 };
    lastPrice: number | null = null;
    digitSeq: number[] = [];
    tickHistory: { value: string, type: 'rise' | 'fall' | 'even' | 'odd' | 'digit' }[] = [];

    private readonly marketPrecision: Record<string, number> = {
        R_10: 3,
        R_25: 3,
        R_50: 4,
        R_75: 4,
        default: 2,
    };

    getLastDigit(price: number, market: string): number {
        const precision = this.marketPrecision[market] ?? this.marketPrecision.default;
        const priceString = price.toFixed(precision);
        return parseInt(priceString.slice(-1));
    }

    process(price: number, market: string): void {
        if (this.lastProcessedPrice === price) return;
        this.lastProcessedPrice = price;
        const lastDigit = this.getLastDigit(price, market);
        const isEven = lastDigit % 2 === 0;
        const isRise = this.lastPrice !== null ? price > this.lastPrice : null;

        this.consecutiveCounts = this.consecutiveCounts.map((c, d) => (d === lastDigit ? c + 1 : 0));

        this.streaks = {
            even: isEven ? this.streaks.even + 1 : 0,
            odd: !isEven ? this.streaks.odd + 1 : 0,
            rise: isRise ? this.streaks.rise + 1 : 0,
            fall: isRise === false ? this.streaks.fall + 1 : 0,
        };

        let tickValue = '';
        let tickType: 'rise' | 'fall' | 'even' | 'odd' | 'digit' = 'digit';

        if (market.includes('rise-fall')) {
            if (isRise === true) {
                tickValue = 'R';
                tickType = 'rise';
            } else if (isRise === false) {
                tickValue = 'F';
                tickType = 'fall';
            } else {
                tickValue = 'N';
            }
        } else if (market.includes('even-odd')) {
            if (isEven) {
                tickValue = 'E';
                tickType = 'even';
            } else {
                tickValue = 'O';
                tickType = 'odd';
            }
        } else {
            tickValue = lastDigit.toString();
            tickType = 'digit';
        }

        this.tickHistory.unshift({ value: tickValue, type: tickType });
        if (this.tickHistory.length > 20) this.tickHistory.pop();

        this.lastPrice = price;
        this.digitSeq.push(lastDigit);
        if (this.digitSeq.length > 50) this.digitSeq.shift();
    }

    reset(): void {
        this.lastProcessedPrice = null;
        this.consecutiveCounts.fill(0);
        this.streaks = { even: 0, odd: 0, rise: 0, fall: 0 };
        this.lastPrice = null;
        this.digitSeq = [];
        this.tickHistory = [];
    }

    checkPattern(
        type: 'over-under' | 'even-odd' | 'rise-fall' | 'differs',
        s: { over: number; under: number; consecutive: number; preds: number[]; disabledPreds: boolean[] },
        continuationMode: boolean
    ): { type: string; barrier?: string } | null {
        switch (type) {
            case 'over-under':
                return this.#checkOverUnder(s.over, s.under, s.consecutive, continuationMode, s.disabledPreds);
            case 'even-odd':
                return this.#checkEvenOdd(s.consecutive, continuationMode);
            case 'rise-fall':
                return this.#checkRiseFall(s.consecutive, continuationMode);
            case 'differs':
                return this.#checkDiffers(s.preds, s.consecutive);
            default:
                return null;
        }
    }

    #checkOverUnder(over: number, under: number, threshold: number, continuationMode: boolean, disabledPreds: boolean[]) {
        let oc = 0;
        let uc = 0;

        // If both predictions are disabled, return null
        if (disabledPreds[0] && disabledPreds[1]) return null;

        for (let i = this.digitSeq.length - 1; i >= 0; i--) {
            const d = this.digitSeq[i];

            // Only check over if it's not disabled
            if (!disabledPreds[0] && d <= over) {
                oc++;
                if (oc >= threshold) {
                    return continuationMode
                        ? { type: 'DIGITUNDER', barrier: under.toString() }
                        : { type: 'DIGITOVER', barrier: over.toString() };
                }
            } else {
                oc = 0;
            }

            // Only check under if it's not disabled
            if (!disabledPreds[1] && d >= under) {
                uc++;
                if (uc >= threshold) {
                    return continuationMode
                        ? { type: 'DIGITOVER', barrier: over.toString() }
                        : { type: 'DIGITUNDER', barrier: under.toString() };
                }
            } else {
                uc = 0;
            }

            if (Math.max(oc, uc) + i < threshold) break;
        }
        return null;
    }

    #checkEvenOdd(th: number, continuationMode: boolean) {
        if (this.streaks.odd >= th) {
            return continuationMode
                ? { type: 'DIGITODD' }
                : { type: 'DIGITEVEN' };
        }
        if (this.streaks.even >= th) {
            return continuationMode
                ? { type: 'DIGITEVEN' }
                : { type: 'DIGITODD' };
        }
        return null;
    }

    #checkRiseFall(th: number, continuationMode: boolean) {
        if (this.streaks.rise >= th) {
            return continuationMode
                ? { type: 'CALL' }
                : { type: 'PUT' };
        }
        if (this.streaks.fall >= th) {
            return continuationMode
                ? { type: 'PUT' }
                : { type: 'CALL' };
        }
        return null;
    }

    #checkDiffers(preds: number[], th: number) {
        const valid = preds.filter((d) => d >= 0 && d <= 9);
        for (const d of valid)
            if (this.consecutiveCounts[d] >= th) return { type: 'DIGITDIFF', barrier: d.toString() };
        return null;
    }
}

/* ────────────────────────────────────────────────────────────────────
 *  AutoTrader with initialization fixes
 * ──────────────────────────────────────────────────────────────────── */
type StrategyID = 'even-odd' | 'over-under' | 'rise-fall' | 'differs';
interface StrategySettings {
    type: StrategyID;
    market: string;
    stake: number;
    martingale: number;
    duration: number;
    consecutive: number;
    over: number;
    under: number;
    preds: number[];
    disabledPreds: boolean[];
    takeProfit: number;
    stopLoss: number;
}

const marketIcons: Record<string, JSX.Element> = {
    '1HZ100V': <MarketDerivedVolatility1001sIcon width={16} height={16} />,
    'R_100': <MarketDerivedVolatility100Icon width={16} height={16} />,
    'R_10': <MarketDerivedVolatility10Icon width={16} height={16} />,
    'R_25': <MarketDerivedVolatility25Icon width={16} height={16} />,
    'R_50': <MarketDerivedVolatility50Icon width={16} height={16} />,
    'R_75': <MarketDerivedVolatility75Icon width={16} height={16} />,
    '1HZ10V': <MarketDerivedVolatility101sIcon width={16} height={16} />,
    '1HZ25V': <MarketDerivedVolatility251sIcon width={16} height={16} />,
    '1HZ50V': <MarketDerivedVolatility501sIcon width={16} height={16} />,
    '1HZ75V': <MarketDerivedVolatility751sIcon width={16} height={16} />
};

const contractIcons: Record<string, JSX.Element> = {
    'DIGITEVEN': <TradeTypesDigitsEvenIcon width={16} height={16} />,
    'DIGITODD': <TradeTypesDigitsOddIcon width={16} height={16} />,
    'DIGITMATCH': <TradeTypesDigitsMatchesIcon width={16} height={16} />,
    'DIGITDIFF': <TradeTypesDigitsDiffersIcon width={16} height={16} />,
    'DIGITOVER': <TradeTypesDigitsOverIcon width={16} height={16} />,
    'DIGITUNDER': <TradeTypesDigitsUnderIcon width={16} height={16} />,
    'CALL': <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
    'PUT': <TradeTypesUpsAndDownsFallIcon width={16} height={16} />
};

class AutoTrader {
    private initialized = false;
    private continuationMode = false;

    constructor(
        private sendWS: (m: any) => Promise<any>,
        private balanceFn: () => number,
        private tradeCb: () => void,
        private statusCb: (id: StrategyID, msg: string) => void,
    ) {
        setTimeout(() => this.initialized = true, 0);
    }

    strategies: Record<
        StrategyID,
        {
            active: boolean;
            settings: StrategySettings;
            analyzer: DigitAnalyzer;
            cooldown: boolean;
            currentStake: number;
            lossStreak: number;
            cumulativePL: number;
            contractId?: string;
            lastDigit?: number;
            lastAnalysis?: string;
            entryValue?: number;
            exitValue?: number;
            marketFormat?: string;
        }
    > = Object.create(null);

    trades: {
        id: string;
        strategy: StrategyID;
        profit: number | null;
        contractType?: string;
        stake?: number;
        entryValue?: number;
        exitValue?: number;
        market?: string;
        marketFormat?: string;
    }[] = [];

    toggleContinuationMode() {
        this.continuationMode = !this.continuationMode;
        Object.values(this.strategies).forEach(strategy => {
            if (strategy?.analyzer) {
                strategy.analyzer.reset();
            }
        });
        return this.continuationMode;
    }

    feedTick(price: number, sym: string) {
        if (!this.initialized) return;

        Object.entries(this.strategies).forEach(([sid, p]) => {
            if (!p?.active || p.settings.market !== sym || !p.analyzer) return;

            p.analyzer.process(price, `${sym}-${sid}`);
            p.lastDigit = p.analyzer.getLastDigit(price, p.settings.market);
            p.marketFormat = p.settings.market;

            if (p.settings.type === 'even-odd') {
                p.lastAnalysis = p.lastDigit % 2 === 0 ? 'E' : 'O';
            } else if (p.settings.type === 'rise-fall') {
                p.lastAnalysis = p.analyzer.lastPrice !== null ? (price > p.analyzer.lastPrice ? 'R' : 'F') : '';
            } else if (p.settings.type === 'differs') {
                p.lastAnalysis = p.lastDigit.toString();
            }

            if (!p.cooldown) {
                const sig = p.analyzer.checkPattern(p.settings.type, p.settings, this.continuationMode);
                if (sig) this.#attemptBuy(sid as StrategyID, sig);
            }
            this.statusCb(sid as StrategyID, this.getStatusText(sid as StrategyID));
            this.tradeCb();
        });
    }

    getStatusText(id: StrategyID): string {
        const p = this.strategies[id];
        if (!p) return 'Waiting…';

        let txt = `Stake:${p.currentStake} | P/L:${p.cumulativePL.toFixed(2)} | Last:${p.lastDigit ?? '–'}`;
        if (p.lastAnalysis) txt += ` (${p.lastAnalysis})`;

        if (id === 'even-odd') txt += ` | E:${p.analyzer.streaks.even} O:${p.analyzer.streaks.odd}`;
        if (id === 'rise-fall') txt += ` | R:${p.analyzer.streaks.rise} F:${p.analyzer.streaks.fall}`;
        if (id === 'differs') txt += ` | Preds:${p.settings.preds.join(',')}`;
        if (p.settings.takeProfit) txt += ` | TP:${p.settings.takeProfit}`;
        if (p.settings.stopLoss) txt += ` | SL:${p.settings.stopLoss}`;
        if (p.lossStreak > 0) txt += ` | Losses:${p.lossStreak}`;

        return txt;
    }

    start(id: StrategyID, s: StrategySettings) {
        if (this.strategies[id]?.analyzer) {
            this.strategies[id].analyzer.reset();
        }

        this.strategies[id] = {
            active: true,
            settings: s,
            analyzer: new DigitAnalyzer(),
            cooldown: false,
            currentStake: s.stake,
            lossStreak: 0,
            cumulativePL: 0,
            marketFormat: s.market
        };
    }

    stop(id: StrategyID, reason = 'Stopped') {
        if (!this.strategies[id]) return;
        this.strategies[id].active = false;
        this.statusCb(id, reason);
        const card = document.querySelector(`.strategy__card[data-strategy-id="${id}"]`);
        const btn = card?.querySelector('.strategy__trade-btn') as HTMLButtonElement | undefined;
        if (btn) {
            btn.dataset.active = 'false';
            btn.textContent = 'Start';
        }
    }

    async #attemptBuy(id: StrategyID, sig: any) {
        const p = this.strategies[id];
        const token = localStorage.getItem('authToken');
        if (!token) return this.statusCb(id, 'Not authorized');

        if (p.currentStake > this.balanceFn()) {
            this.statusCb(id, 'Insufficient balance');
            return;
        }

        const req = {
            buy: 1,
            price: p.currentStake,
            parameters: {
                amount: p.currentStake,
                basis: 'stake',
                currency: 'USD',
                contract_type: sig.type,
                duration: p.settings.duration,
                duration_unit: 't',
                symbol: p.settings.market,
                ...(sig.barrier && { barrier: sig.barrier }),
            },
        };

        p.cooldown = true;
        try {
            const { buy } = await this.sendWS(req);
            p.contractId = buy.contract_id;
            p.entryValue = p.analyzer.lastPrice || undefined;
            this.trades.unshift({
                id: buy.contract_id,
                strategy: id,
                profit: null,
                contractType: sig.type,
                stake: p.currentStake,
                entryValue: p.entryValue,
                market: p.settings.market,
                marketFormat: p.marketFormat
            });
            this.tradeCb();
            await this.sendWS({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 });
        } catch (e: any) {
            p.cooldown = false;
            this.statusCb(id, e.message || 'Buy failed');
        }
    }

    onContract(c: any) {
        const id = (Object.keys(this.strategies) as StrategyID[]).find(
            (k) => this.strategies[k].contractId === c.contract_id,
        );
        if (!id) return;

        const p = this.strategies[id];
        if (c.status !== 'open') {
            const t = this.trades.find((x) => x.id === c.contract_id);
            if (t) {
                t.profit = c.profit;
                t.exitValue = c.exit_tick ? Number(c.exit_tick) : undefined;
            }

            p.exitValue = c.exit_tick ? Number(c.exit_tick) : undefined;
            p.cumulativePL += c.profit;

            if (c.profit > 0) {
                p.currentStake = p.settings.stake;
                p.lossStreak = 0;
                this.statusCb(id, `Win! Stake reset • P/L:${p.cumulativePL.toFixed(2)}`);
            } else {
                p.currentStake *= p.settings.martingale;
                p.lossStreak += 1;
                this.statusCb(id, `Loss #${p.lossStreak}. Next:${p.currentStake} • P/L:${p.cumulativePL.toFixed(2)}`);
            }

            if (p.settings.takeProfit > 0 && p.cumulativePL >= p.settings.takeProfit) {
                this.stop(
                    id,
                    `🎯 Take&nbsp;Profit hit (+${p.cumulativePL.toFixed(2)}) – strategy stopped`,
                );
            } else if (p.settings.stopLoss > 0 && -p.cumulativePL >= p.settings.stopLoss) {
                this.stop(
                    id,
                    `🛑 Stop&nbsp;Loss hit (${p.cumulativePL.toFixed(2)}) – strategy stopped`,
                );
            } else {
                p.cooldown = false;
                p.analyzer.reset();
                p.contractId = undefined;
                this.tradeCb();
            }
        } else if (c.entry_tick) {
            p.entryValue = c.entry_tick ? Number(c.entry_tick) : undefined;
            const t = this.trades.find((x) => x.id === c.contract_id);
            if (t) {
                t.entryValue = p.entryValue;
            }
            this.tradeCb();
        }
    }
}

/* ────────────────────────────────────────────────────────────────────
 *  TickSubscriber wrapper
 * ──────────────────────────────────────────────────────────────────── */
const TickSubscriber: React.FC<{ symbol: string; onTick: (p: number, s: string) => void }> = ({
    symbol,
    onTick,
}) => {
    useTickStream(symbol, onTick);
    return null;
};

/* ────────────────────────────────────────────────────────────────────
 *  Main component logic
 * ──────────────────────────────────────────────────────────────────── */
const Strategy = observer(() => {
    const { ui } = useStore();
    const containerRef = useRef<HTMLDivElement>(null);
    const traderRef = useRef<AutoTrader>();
    const [, forceRerender] = useState({});
    const [isAuth, setIsAuth] = useState(false);
    const [activeMarkets, setActiveMarkets] = useState<Set<string>>(new Set());
    const [continuationMode, setContinuationMode] = useState(false);
    const [disabledPreds, setDisabledPreds] = useState<boolean[]>([false, false]);

    const [status, setStatus] = useState<Record<StrategyID, string>>({
        'over-under': '',
        'rise-fall': '',
        'even-odd': '',
        differs: '',
    });

    useEffect(() => {
        const token = localStorage.getItem('authToken');
        if (!token) return;
        api_base.api
            .authorize(token)
            .then(() => {
                setIsAuth(true);
                traderRef.current = new AutoTrader(
                    (m) => api_base.api.send(m),
                    () => parseFloat((document.getElementById('balance')?.textContent || '0').replace(/[^0-9.-]+/g, '')),
                    () => forceRerender({}),
                    (id, raw) => {
                        let html = raw
                            .replace('(E)', '<span class="strategy__even">(E)</span>')
                            .replace('(O)', '<span class="strategy__odd">(O)</span>')
                            .replace('(R)', '<span class="strategy__rise">(R)</span>')
                            .replace('(F)', '<span class="strategy__fall">(F)</span>');
                        if (id === 'differs' && traderRef.current?.strategies.differs) {
                            const preds = traderRef.current.strategies.differs.settings.preds;
                            preds.forEach((d) => {
                                html = html.replace(
                                    new RegExp(`\\b${d}\\b`, 'g'),
                                    `<span class="strategy__predicted-digit">${d}</span>`,
                                );
                            });
                        }
                        setStatus((prev) => ({ ...prev, [id]: html }));
                    },
                );
            })
            .catch(console.error);
    }, []);

    const onTick = useCallback((p: number, s: string) => {
        if (traderRef.current && activeMarkets.has(s)) {
            traderRef.current.feedTick(p, s);
        }
    }, [activeMarkets]);

    useEffect(() => {
        const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
            if (data.proposal_open_contract) traderRef.current?.onContract(data.proposal_open_contract);
        });
        return () => sub.unsubscribe();
    }, []);

    const toggleContinuationMode = () => {
        if (traderRef.current) {
            const newMode = traderRef.current.toggleContinuationMode();
            setContinuationMode(newMode);
        }
    };

    const refreshActive = () => {
        const s = new Set<string>();
        Object.values(traderRef.current?.strategies ?? {}).forEach((p) => p.active && s.add(p.settings.market));
        setActiveMarkets(s);
    };

    const getSettings = (card: Element): StrategySettings => {
        const q = (sel: string) => card.querySelector(sel) as HTMLInputElement | HTMLSelectElement | null;
        const num = (el: HTMLElement | null, d = 0) => (el && +((el as HTMLInputElement).value || 0) > 0 ? +((el as HTMLInputElement).value || 0) : d);
        const preds = Array.from(card.querySelectorAll('.strategy__prediction-input'))
            .map((i) => {
                const v = Number((i as HTMLInputElement).value);
                return v >= 0 && v <= 9 ? v : 0;
            })
            .filter((v, i, a) => a.indexOf(v) === i);
        return {
            type: card.getAttribute('data-strategy-id') as StrategyID,
            market: (q('.strategy__market-select') as HTMLSelectElement).value,
            stake: num(q('.strategy__stake-input'), 1),
            martingale: num(q('.strategy__martingale-input'), 1),
            duration: num(q('.strategy__duration-input'), 1),
            consecutive: num(q('.strategy__Consecutive-input'), 1),
            over: preds[0] ?? 1,
            under: preds[1] ?? 8,
            preds,
            disabledPreds,
            takeProfit: num(q('.strategy__take-profit-input'), 0),
            stopLoss: num(q('.strategy__stop-loss-input'), 0),
        };
    };

    const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (!isAuth) return;
        const btn = e.currentTarget;
        const card = btn.closest('.strategy__card')!;
        const id = card.getAttribute('data-strategy-id') as StrategyID;
        const on = btn.dataset.active === 'true';
        if (on) {
            traderRef.current?.stop(id);
            refreshActive();
        } else {
            traderRef.current?.start(id, getSettings(card));
            btn.dataset.active = 'true';
            btn.textContent = 'Stop';
            refreshActive();
        }
    };

    const [activeStrategy, setActiveStrategy] = useState<StrategyID>('over-under');
    const switchStrategy = (strategyId: StrategyID) => {
        setActiveStrategy(strategyId);
    };

    const togglePrediction = (index: number) => {
        const newDisabledPreds = [...disabledPreds];
        newDisabledPreds[index] = !newDisabledPreds[index];

        // Ensure both predictions can't be disabled
        if (newDisabledPreds[0] && newDisabledPreds[1]) {
            newDisabledPreds[index] = false;
        }

        setDisabledPreds(newDisabledPreds);
    };

    const pl = traderRef.current?.trades.reduce((s, t) => s + (t.profit ?? 0), 0) ?? 0;

    const formatTickValue = (value?: number, marketFormat?: string) => {
        if (value === undefined) return '—';

        let tickString: string;
        if (marketFormat === 'R_10' || marketFormat === 'R_25') {
            tickString = value.toFixed(3);
        } else if (marketFormat === 'R_50' || marketFormat === 'R_75') {
            tickString = value.toFixed(4);
        } else {
            tickString = value.toFixed(2);
        }

        return tickString;
    };

    const renderTickDisplay = (strategyId: StrategyID) => {
        if (!traderRef.current?.strategies[strategyId]) return null;

        const analyzer = traderRef.current.strategies[strategyId].analyzer;
        if (!analyzer || !analyzer.tickHistory.length) return null;

        return (
            <div className="strategy__tick-display">
                {analyzer.tickHistory.map((tick, index) => (
                    <span
                        key={index}
                        className={`strategy__tick strategy__tick-${tick.type}`}
                        title={`Tick ${index + 1}`}
                    >
                        {tick.value}
                    </span>
                ))}
            </div>
        );
    };

    return (
        <div
            className="strategy__container"
            ref={containerRef}
            style={{ background: ui.is_dark_mode_on ? 'var(--general-main-1)' : 'transparent' }}
        >
            {!isAuth ? (
                <div className="strategy__landing" style={{ background: ui.is_dark_mode_on ? 'var(--general-main-1)' : 'transparent' }}>
                    <div className="strategy__landing-header">
                        <h1>Hands Free Trading Bots</h1>
                        <h2>Powered By Denara AI</h2>
                        <p>Automated trading strategies powered by Denara AI</p>
                    </div>

                    <div className="strategy__landing-cta">
                        <h2>Please Login to Start Trading</h2>
                        <p>These automated strategies are designed to capitalize on statistical patterns in digit distributions. Please login to access the trading interface.</p>
                    </div>
                </div>
            ) : (
                <>
                    {[...activeMarkets].map((sym) => (
                        <TickSubscriber key={sym} symbol={sym} onTick={onTick} />
                    ))}

                    {/* ────────── Navbar ────────── */}
                    <div className="strategy__navbar">
                        <div className="strategy__navbar-brand">⏱️ Instant Fill</div>
                        <div className="strategy__navbar-auth">
                            <span>Connected</span> <span id="balance">$10,000.00</span>
                        </div>
                    </div>
                    <div className="strategy__navbar-controls">
                        <div className="strategy__tabs">
                            <button
                                className={`strategy__tab ${activeStrategy === 'over-under' ? 'active' : ''}`}
                                onClick={() => switchStrategy('over-under')}
                            >
                                Over/Under
                            </button>
                            <button
                                className={`strategy__tab ${activeStrategy === 'rise-fall' ? 'active' : ''}`}
                                onClick={() => switchStrategy('rise-fall')}
                                style={{ display: 'none' }}
                            >
                                Rise/Fall
                            </button>
                            <button
                                className={`strategy__tab ${activeStrategy === 'even-odd' ? 'active' : ''}`}
                                onClick={() => switchStrategy('even-odd')}
                            >
                                Even/Odd
                            </button>
                            <button
                                className={`strategy__tab ${activeStrategy === 'differs' ? 'active' : ''}`}
                                onClick={() => switchStrategy('differs')}
                            >
                                Differs
                            </button>
                        </div>
                        <button
                            className="strategy__mode-toggle"
                            onClick={toggleContinuationMode}
                        >
                            {continuationMode ? 'Continuation Analysis' : 'Reversal Analysis'}
                        </button>
                    </div>

                    {/* ────────── Strategy Cards ────────── */}
                    <div className="strategy__grid">
                        {/* ─── Over / Under ─── */}
                        <div className="strategy__card" data-strategy-id="over-under" style={{ display: activeStrategy === 'over-under' ? 'block' : 'none' }}>
                            <div className="strategy__card-header">
                                <div className="strategy__card-name">
                                    <TradeTypesDigitsOverIcon width={20} height={20} />
                                    Over|Under
                                    <TradeTypesDigitsUnderIcon width={20} height={20} />
                                </div>
                                <button className="strategy__trade-btn" data-active="false" onClick={toggle}>
                                    Start
                                </button>
                            </div>

                            <div className="strategy__form-group">
                                <label>Market</label>
                                <select className="strategy__market-select">
                                    <option value="1HZ10V">Volatility 10(1s) index</option>
                                    <option value="R_10">Volatility 10 index</option>
                                    <option value="R_25">Volatility 25 index</option>
                                    <option value="1HZ25V">Volatility 25(1s) index</option>
                                    <option value="R_50">Volatility 50 index</option>
                                    <option value="1HZ50V">Volatility 50(1s) index</option>
                                    <option value="R_75">Volatility 75 index</option>
                                    <option value="1HZ75V">Volatility 75(1s) index</option>
                                    <option value="R_100">Volatility 100 index</option>
                                    <option value="1HZ100V">Volatility 100(1s) index</option>
                                </select>
                            </div>

                            <div className="strategy__form-row">
                                <div className="strategy__form-group">
                                    <label>Stake Amount</label>
                                    <input type="number" className="strategy__stake-input" min="1" defaultValue="10" />
                                </div>
                                <div className="strategy__form-group">
                                    <label>Martingale</label>
                                    <input type="number" className="strategy__martingale-input" min="1" defaultValue="2" />
                                </div>
                            </div>

                            <div className="strategy__form-row">
                                <div className="strategy__form-group">
                                    <label>Duration (ticks)</label>
                                    <input type="number" className="strategy__duration-input" min="1" defaultValue="1" />
                                </div>
                                <div className="strategy__form-group">
                                    <label>Consecutive Count</label>
                                    <input type="number" className="strategy__Consecutive-input" min="1" defaultValue="1" />
                                </div>
                            </div>

                            <div className="strategy__form-row">
                                <div className="strategy__form-group">
                                    <label>Take Profit</label>
                                    <input
                                        type="number"
                                        className="strategy__take-profit-input"
                                        min="0"
                                        step="0.1"
                                        defaultValue="0"
                                        placeholder="0 for none"
                                    />
                                </div>
                                <div className="strategy__form-group">
                                    <label>Stop Loss</label>
                                    <input
                                        type="number"
                                        className="strategy__stop-loss-input"
                                        min="0"
                                        step="0.1"
                                        defaultValue="0"
                                        placeholder="0 for none"
                                    />
                                </div>
                            </div>

                            <div className="strategy__prediction-controls">
                                <div className="strategy__form-row">
                                    <div className="strategy__form-group">
                                        <label>Prediction 1 (OVER)</label>
                                        <div className="strategy__prediction-toggle-container">
                                            <input
                                                type="number"
                                                className="strategy__prediction-input"
                                                defaultValue="1"
                                                min="1"
                                                max="9"
                                            />
                                            <button
                                                className={`strategy__prediction-toggle ${disabledPreds[0] ? 'disabled' : ''}`}
                                                onClick={() => togglePrediction(0)}
                                            >
                                                {disabledPreds[0] ? 'Disabled' : 'Enabled'}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="strategy__form-group">
                                        <label>Prediction 2 (UNDER)</label>
                                        <div className="strategy__prediction-toggle-container">
                                            <input
                                                type="number"
                                                className="strategy__prediction-input"
                                                defaultValue="8"
                                                min="1"
                                                max="9"
                                            />
                                            <button
                                                className={`strategy__prediction-toggle ${disabledPreds[1] ? 'disabled' : ''}`}
                                                onClick={() => togglePrediction(1)}
                                            >
                                                {disabledPreds[1] ? 'Disabled' : 'Enabled'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Tick display for this strategy */}
                            {renderTickDisplay('over-under')}

                            <div
                                className="strategy__trade-status"
                                id="tradeStatus-over-under"
                                dangerouslySetInnerHTML={{ __html: status['over-under'] }}
                            />
                        </div>

                        {/* ─── Rise / Fall ─── */}
                        <div className="strategy__card" data-strategy-id="rise-fall" style={{ display: activeStrategy === 'rise-fall' ? 'block' : 'none' }}>
                            <div className="strategy__card-header">
                                <div className="strategy__card-name">
                                    <TradeTypesUpsAndDownsRiseIcon width={20} height={20} />
                                    <TradeTypesUpsAndDownsFallIcon width={20} height={20} />
                                    Rise|Fall
                                </div>
                                <button className="strategy__trade-btn" data-active="false" onClick={toggle}>
                                    Start
                                </button>
                            </div>

                            <div className="strategy__form-group">
                                <label>Market</label>
                                <select className="strategy__market-select">
                                    <option value="1HZ10V">Volatility 10(1s) index</option>
                                    <option value="R_10">Volatility 10 index</option>
                                    <option value="R_25">Volatility 25 index</option>
                                    <option value="1HZ25V">Volatility 25(1s) index</option>
                                    <option value="R_50">Volatility 50 index</option>
                                    <option value="1HZ50V">Volatility 50(1s) index</option>
                                    <option value="R_75">Volatility 75 index</option>
                                    <option value="1HZ75V">Volatility 75(1s) index</option>
                                    <option value="R_100">Volatility 100 index</option>
                                    <option value="1HZ100V">Volatility 100(1s) index</option>
                                </select>
                            </div>

                            <div className="strategy__form-row">
                                <div className="strategy__form-group">
                                    <label>Stake Amount</label>
                                    <input type="number" className="strategy__stake-input" min="1" defaultValue="10" />
                                </div>
                                <div className="strategy__form-group">
                                    <label>Martingale</label>
                                    <input type="number" className="strategy__martingale-input" min="1" defaultValue="2" />
                                </div>
                            </div>

                            <div className="strategy__form-row">
                                <div className="strategy__form-group">
                                    <label>Duration (ticks)</label>
                                    <input type="number" className="strategy__duration-input" min="1" defaultValue="1" />
                                </div>
                                <div className="strategy__form-group">
                                    <label>Consecutive Count</label>
                                    <input type="number" className="strategy__Consecutive-input" min="1" defaultValue="3" />
                                </div>
                            </div>

                            <div className="strategy__form-row">
                                <div className="strategy__form-group">
                                    <label>Take Profit</label>
                                    <input
                                        type="number"
                                        className="strategy__take-profit-input"
                                        min="0"
                                        step="0.1"
                                        defaultValue="0"
                                        placeholder="0 for none"
                                    />
                                </div>
                                <div className="strategy__form-group">
                                    <label>Stop Loss</label>
                                    <input
                                        type="number"
                                        className="strategy__stop-loss-input"
                                        min="0"
                                        step="0.1"
                                        defaultValue="0"
                                        placeholder="0 for none"
                                    />
                                </div>
                            </div>

                            {/* Tick display for this strategy */}
                            {renderTickDisplay('rise-fall')}

                            <div
                                className="strategy__trade-status"
                                id="tradeStatus-rise-fall"
                                dangerouslySetInnerHTML={{ __html: status['rise-fall'] }}
                            />

                            <div className="strategy__card-header" style={{ flexDirection: 'column' }}>
                                <small>(Consecutive) Rise → Buys Fall</small>
                                <small>(Consecutive) Fall → Buys Rise</small>
                            </div>
                        </div>

                        {/* ─── Even / Odd ─── */}
                        <div className="strategy__card" data-strategy-id="even-odd" style={{ display: activeStrategy === 'even-odd' ? 'block' : 'none' }}
                        >
                            <div className="strategy__card-header">
                                <div className="strategy__card-name">
                                    <TradeTypesDigitsEvenIcon width={20} height={20} />
                                    Even|Odd
                                    <TradeTypesDigitsOddIcon width={20} height={20} />

                                </div>
                                <button className="strategy__trade-btn" data-active="false" onClick={toggle}>
                                    Start
                                </button>
                            </div>

                            <div className="strategy__form-group">
                                <label>Market</label>
                                <select className="strategy__market-select">
                                    <option value="1HZ10V">Volatility 10(1s) index</option>
                                    <option value="R_10">Volatility 10 index</option>
                                    <option value="R_25">Volatility 25 index</option>
                                    <option value="1HZ25V">Volatility 25(1s) index</option>
                                    <option value="R_50">Volatility 50 index</option>
                                    <option value="1HZ50V">Volatility 50(1s) index</option>
                                    <option value="R_75">Volatility 75 index</option>
                                    <option value="1HZ75V">Volatility 75(1s) index</option>
                                    <option value="R_100">Volatility 100 index</option>
                                    <option value="1HZ100V">Volatility 100(1s) index</option>
                                </select>
                            </div>

                            <div className="strategy__form-row">
                                <div className="strategy__form-group">
                                    <label>Stake Amount</label>
                                    <input type="number" className="strategy__stake-input" min="1" defaultValue="10" />
                                </div>
                                <div className="strategy__form-group">
                                    <label>Martingale</label>
                                    <input type="number" className="strategy__martingale-input" min="1" defaultValue="2" />
                                </div>
                            </div>

                            <div className="strategy__form-row">
                                <div className="strategy__form-group">
                                    <label>Duration (ticks)</label>
                                    <input type="number" className="strategy__duration-input" min="1" defaultValue="1" />
                                </div>
                                <div className="strategy__form-group">
                                    <label>Consecutive Count</label>
                                    <input type="number" className="strategy__Consecutive-input" min="1" defaultValue="3" />
                                </div>
                            </div>

                            <div className="strategy__form-row">
                                <div className="strategy__form-group">
                                    <label>Take Profit</label>
                                    <input
                                        type="number"
                                        className="strategy__take-profit-input"
                                        min="0"
                                        step="0.1"
                                        defaultValue="0"
                                        placeholder="0 for none"
                                    />
                                </div>
                                <div className="strategy__form-group">
                                    <label>Stop Loss</label>
                                    <input
                                        type="number"
                                        className="strategy__stop-loss-input"
                                        min="0"
                                        step="0.1"
                                        defaultValue="0"
                                        placeholder="0 for none"
                                    />
                                </div>
                            </div>

                            {/* Tick display for this strategy */}
                            {renderTickDisplay('even-odd')}

                            <div
                                className="strategy__trade-status"
                                id="tradeStatus-even-odd"
                                dangerouslySetInnerHTML={{ __html: status['even-odd'] }}
                            />

                            <div className="strategy__card-header" style={{ flexDirection: 'column' }}>
                                <small>(Consecutive) Even → Buys Odd</small>
                                <small>(Consecutive) Odd → Buys Even</small>
                            </div>
                        </div>

                        {/* ─── Differs ─── */}
                        <div className="strategy__card" data-strategy-id="differs" style={{ display: activeStrategy === 'differs' ? 'block' : 'none' }}>
                            <div className="strategy__card-header">
                                <div className="strategy__card-name">
                                    <TradeTypesDigitsDiffersIcon width={20} height={20} />
                                    Differs
                                </div>
                                <button className="strategy__trade-btn" data-active="false" onClick={toggle}>
                                    Start
                                </button>
                            </div>

                            <div className="strategy__form-group">
                                <label>Market</label>
                                <select className="strategy__market-select">
                                    <option value="1HZ10V">Volatility 10(1s) index</option>
                                    <option value="R_10">Volatility 10 index</option>
                                    <option value="R_25">Volatility 25 index</option>
                                    <option value="1HZ25V">Volatility 25(1s) index</option>
                                    <option value="R_50">Volatility 50 index</option>
                                    <option value="1HZ50V">Volatility 50(1s) index</option>
                                    <option value="R_75">Volatility 75 index</option>
                                    <option value="1HZ75V">Volatility 75(1s) index</option>
                                    <option value="R_100">Volatility 100 index</option>
                                    <option value="1HZ100V">Volatility 100(1s) index</option>
                                </select>
                            </div>
                            <div className="strategy__prediction-controls">
                                <div className="strategy__form-row">
                                    <div className="strategy__form-group">
                                        <label>Stake Amount</label>
                                        <input type="number" className="strategy__stake-input" min="1" defaultValue="10" />
                                    </div>
                                    <div className="strategy__form-group">
                                        <label>Martingale</label>
                                        <input type="number" className="strategy__martingale-input" min="1" defaultValue="2" />
                                    </div>
                                </div>
                            </div>

                            <div className="strategy__prediction-controls">
                                <div className="strategy__form-row">
                                    <div className="strategy__form-group">
                                        <label>Duration (ticks)</label>
                                        <input type="number" className="strategy__duration-input" min="1" defaultValue="1" />
                                    </div>
                                    <div className="strategy__form-group">
                                        <label>Consecutive Count</label>
                                        <input type="number" className="strategy__Consecutive-input" min="1" defaultValue="1" />
                                    </div>
                                </div>
                            </div>

                            <div className="strategy__prediction-controls">

                                <div className="strategy__form-row">
                                    <div className="strategy__form-group">
                                        <label>Take Profit</label>
                                        <input
                                            type="number"
                                            className="strategy__take-profit-input"
                                            min="0"
                                            step="0.1"
                                            defaultValue="0"
                                            placeholder="0 for none"
                                        />
                                    </div>
                                    <div className="strategy__form-group">
                                        <label>Stop Loss</label>
                                        <input
                                            type="number"
                                            className="strategy__stop-loss-input"
                                            min="0"
                                            step="0.1"
                                            defaultValue="0"
                                            placeholder="0 for none"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="strategy__prediction-controls">
                                <div className="strategy__form-row">
                                    <div className="strategy__form-group">
                                        <label>Prediction:</label>
                                        <input
                                            type="number"
                                            className="strategy__prediction-input"
                                            defaultValue="1"
                                            min="1"
                                            max="9"
                                        />
                                    </div>
                                    <div className="strategy__form-group">
                                        <label>Prediction:</label>
                                        <input
                                            type="number"
                                            className="strategy__prediction-input"
                                            defaultValue="5"
                                            min="1"
                                            max="9"
                                        />
                                    </div>
                                    <div className="strategy__form-group">
                                        <label>Prediction:</label>
                                        <input
                                            type="number"
                                            className="strategy__prediction-input"
                                            defaultValue="9"
                                            min="1"
                                            max="9"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Tick display for this strategy */}
                            {renderTickDisplay('differs')}

                            <div
                                className="strategy__trade-status"
                                id="tradeStatus-differs"
                                dangerouslySetInnerHTML={{ __html: status['differs'] }}
                            />

                            <div className="strategy__card-header" style={{ flexDirection: 'column' }}>
                                <small>Prediction appearance triggers a buy</small>
                            </div>
                        </div>
                    </div>

                    {/* ────────── History ────────── */}
                    <div className="transaction_header">
                    <div className="history_header"><h3>Transactions</h3></div>
                    <div className="strategy__profit-loss-display">
                        <small>💰</small>{' '}
                        <span id="profitLossValue">
                            {pl >= 0 ? '+' : ''}
                            {pl.toFixed(2)} USD
                        </span>
                    </div>
                    </div>
                    <div className="strategy__history-section">

                        <div className="strategy__history-list">
                            {traderRef.current?.trades.slice(0, 10).map((t) => (
                                <div key={t.id} className="strategy__trade-item">
                                    <div className="strategy__trade-header">
                                        <div className="strategy__trade-market">
                                            {marketIcons[t.market || ''] || <span>{t.market}</span>}
                                        </div>
                                        <div className="strategy__trade-contract">
                                            {contractIcons[t.contractType || ''] || <span>{t.contractType}</span>}
                                        </div>
                                        <div className="strategy__trade-stake">
                                            {t.stake?.toFixed(2) || '—'}
                                        </div>
                                    </div>

                                    <div className="strategy__trade-spots">
                                        <div className="strategy__trade-entry">
                                            <svg width={16} height={16} viewBox="0 0 16 16">
                                                <circle cx={8} cy={8} r={6} stroke="#FF4444" strokeWidth={1.5} fill="white" />
                                                <circle cx={8} cy={8} r={3} fill="#FF4444" />
                                            </svg>
                                            {formatTickValue(t.entryValue, t.marketFormat)}
                                        </div>

                                        <div className="strategy__trade-exit">
                                            <svg width={16} height={16} viewBox="0 0 16 16">
                                                <circle cx={8} cy={8} r={6} stroke="#999999" strokeWidth={1.5} fill="white" />
                                            </svg>
                                            {formatTickValue(t.exitValue, t.marketFormat)}
                                        </div>
                                    </div>

                                    <div className={`strategy__trade-result ${t.profit && t.profit >= 0 ? 'strategy__profit' : 'strategy__loss'}`}>
                                        {t.profit !== null ? (
                                            `${t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}`
                                        ) : '—'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
});

export default Strategy;