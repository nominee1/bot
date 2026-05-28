/* ====================================================================== */
/*  Strategy.tsx – TP / SL version                       */
/* ====================================================================== */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import {
  applyDerivSessionMarketField,
  coerceProposalOpenContractEntrySpot,
  sendDerivSessionContractPurchase,
} from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { playTradeResultSound } from '@/pages/aap2psafe/tradeSounds';
import type ClientStore from '@/stores/client-store';
import { scheduleCrChanceLedgerRoundTrip } from '@/utils/chanceVirtualStatements';
import {
  ALLOWED_BOT_IFRAME_LOGINID,
  getCrShadow,
  isCrVirtualShadowLogin,
  runWithCrShadowLock,
  tryDebitCrShadowSync,
} from '@/utils/crVirtualBalanceShadow';
import { isDerivOptionsOAuthSession, stringifyUnknown } from '@/components/shared/utils/login/deriv-oauth-storage';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import {
    MarketDerivedVolatility10Icon,
    MarketDerivedVolatility25Icon,
    MarketDerivedVolatility50Icon,
    MarketDerivedVolatility75Icon,
    MarketDerivedVolatility100Icon,
    MarketDerivedVolatility101sIcon,
    MarketDerivedVolatility251sIcon,
    MarketDerivedVolatility501sIcon,
    MarketDerivedVolatility751sIcon,
    MarketDerivedVolatility1001sIcon,
    TradeTypesDigitsDiffersIcon,
    TradeTypesDigitsEvenIcon,
    TradeTypesDigitsMatchesIcon,
    TradeTypesDigitsOddIcon,
    TradeTypesDigitsOverIcon,
    TradeTypesDigitsUnderIcon,
    TradeTypesUpsAndDownsFallIcon,
    TradeTypesUpsAndDownsRiseIcon} from '@deriv/quill-icons';
import {
    autotradeStrategyFormatQuoteForDigitContract,
    autotradeStrategyLastDigitFromQuote,
} from './autotradeStrategyTickDigitFormat';
import './Strategy.scss';

const STRATEGY_DEFAULT_MARKET = '1HZ10V';

function derivTradeErrorMessage(err: unknown): string {
    if (!err) return 'Buy failed';
    if (typeof err === 'string') return err;
    const o = err as { message?: string; error?: { message?: string; code?: string } };
    if (o.error?.message) {
        return o.error.code ? `${o.error.message} (${o.error.code})` : o.error.message;
    }
    if (o.message) return o.message;
    return stringifyUnknown(err) || 'Buy failed';
}

function readStrategyTradingBalance(client: ClientStore | undefined, loginid: string): number {
    if (!client || !loginid) return 0;
    if (isCrVirtualShadowLogin(loginid)) {
        const shadow = getCrShadow(loginid);
        if (typeof shadow === 'number' && Number.isFinite(shadow)) return shadow;
    }
    const fromAccounts = client.all_accounts_balance?.accounts?.[loginid]?.balance;
    if (typeof fromAccounts === 'number' && Number.isFinite(fromAccounts)) return fromAccounts;
    const b = parseFloat(String(client.balance ?? '0'));
    return Number.isFinite(b) ? b : 0;
}

function strategyAccountCurrency(client: ClientStore | undefined, loginid: string): string {
    return (
        client?.currency ||
        client?.all_accounts_balance?.accounts?.[loginid]?.currency ||
        'USD'
    );
}

function normalizeContractId(id: unknown): string {
    if (id == null || id === '') return '';
    return String(id);
}

function coerceProposalOpenContractExitSpot(c: Record<string, unknown>): number | undefined {
    const n = (v: unknown): number | undefined => {
        if (v === undefined || v === null) return undefined;
        const x = typeof v === 'number' ? v : parseFloat(String(v));
        return Number.isFinite(x) ? x : undefined;
    };
    return n(c.exit_tick) ?? n(c.exit_spot) ?? n(c.current_spot);
}

function isProposalContractSettled(c: Record<string, unknown>): boolean {
    return Boolean(
        c.is_sold ||
        c.is_expired ||
        c.is_settleable ||
        c.status === 'sold' ||
        (c.status !== 'open' && c.profit != null && c.profit !== ''),
    );
}

/** 1s volatility (`1HZ*`) — two confirmation ticks after the streak; standard vol — one. */
function postStreakConfirmationTicksForMarket(market: string): number {
    return /^1HZ/i.test(market || '') ? 2 : 1;
}

/** Wall-clock pause before shadow ledger + onContract so the last proof tick can paint (onContract resets analyzer / tick strip). */
function shadowVirtualSettleUiDelayMs(market: string): number {
    return /^1HZ/i.test(market || '') ? 420 : 780;
}

/* ────────────────────────────────────────────────────────────────────
 *  Tick-stream hook with fixes for subscription cleanup
 * ──────────────────────────────────────────────────────────────────── */
let subscriptionId = 0;

function useTickStream(
    symbol: string,
    onTick: (p: number, s: string) => void,
    connectionStatus: CONNECTION_STATUS,
    tradingSocketGeneration: number
) {
    useEffect(() => {
        if (connectionStatus !== CONNECTION_STATUS.OPENED || !api_base.api) return;

        let active = true;
        let lastTick: number | null = null;
        let unsubscribe: (() => void) | undefined;
        const currentId = ++subscriptionId;

        const run = async () => {
            try {
                if (!active || currentId !== subscriptionId) return;
                await api_base.api.send({ forget_all: 'ticks' });
                if (!active || currentId !== subscriptionId) return;
                await api_base.api.send({ ticks: symbol, subscribe: 1 });

                const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
                    if (!active || currentId !== subscriptionId || data?.msg_type !== 'tick' || !data?.tick?.quote) {
                        return;
                    }

                    const tickSym = data.tick.symbol ?? data.echo_req?.ticks;
                    if (tickSym && tickSym !== symbol) return;

                    const quote = Number(data.tick.quote);
                    if (!Number.isFinite(quote)) return;
                    if (lastTick === quote) return;
                    lastTick = quote;

                    onTick(quote, symbol);
                });

                unsubscribe = () => sub.unsubscribe();
            } catch (error) {
                console.error('Tick stream error:', error);
            }
        };

        void run();
        return () => {
            active = false;
            unsubscribe?.();
            setTimeout(() => {
                if (currentId === subscriptionId) {
                    api_base.api?.send({ forget_all: 'ticks' }).catch(console.warn);
                }
            }, 100);
        };
    }, [symbol, onTick, connectionStatus, tradingSocketGeneration]);
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

    getLastDigit(price: number, market: string): number {
        return autotradeStrategyLastDigitFromQuote(price, market);
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

    /** Even/odd: continuation = same parity; reversal = opposite. (Used for all accounts; shadow only changes settlement.) */
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

/**
 * CR7557018: after the signal, collect post-streak proof ticks before settling (same cadence as tick strip:
 * 2 ticks on 1s vol markets, 1 on standard). Win/loss uses the *first* proof tick only; later ticks are visual proof.
 */
type ShadowProofPhase = {
    virtId: string;
    walletLogin: string;
    sig: { type: string; barrier?: string };
    stake: number;
    market: string;
    ask: number;
    payout: number;
    triggerPrice: number;
    triggerEpochSec: number;
    /** How many ticks to collect after the signal tick before finalize */
    ticksRemaining: number;
    proofTotal: number;
    proofChain: { quote: number; digit: number }[];
    decisionDigit?: number;
    decisionExitPrice?: number;
};

type ShadowSettleBundle = {
    strategyId: StrategyID;
    contractPayload: {
        contract_id: string;
        status: string;
        profit: number;
        exit_tick: string;
        entry_tick: string;
    };
    ledger: {
        client: ClientStore;
        walletLoginId: string;
        ask: number;
        settlementCredit: number;
        entryEpochSec: number;
    };
};

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
    private settledContractIds = new Set<string>();

    constructor(
        private sendWS: (m: any) => Promise<any>,
        private balanceFn: () => number,
        private tradeCb: () => void,
        private statusCb: (id: StrategyID, msg: string) => void,
        private shadowApi?: {
            isShadow: () => boolean;
            getClient: () => ClientStore | undefined;
            getWallet: () => string;
        },
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
            /** Shadow (CR7557018): debit on signal; collect proof ticks then settle. */
            shadowProofPhase?: ShadowProofPhase;
            /** Shadow: delayed ledger + onContract so the UI can show the final proof tick before analyzer.reset(). */
            shadowDeferredSettle?: { timer: ReturnType<typeof setTimeout>; bundle: ShadowSettleBundle };
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
        (Object.keys(this.strategies) as StrategyID[]).forEach((sid) => {
            this.#cancelShadowDeferredSettle(sid, true);
        });
        Object.values(this.strategies).forEach(strategy => {
            if (strategy?.analyzer) {
                strategy.analyzer.reset();
            }
            strategy.shadowProofPhase = undefined;
        });
        return this.continuationMode;
    }

    syncLiveSettingsFromDom(readLiveSettings: (card: Element) => StrategySettings) {
        (Object.keys(this.strategies) as StrategyID[]).forEach((sid) => {
            const p = this.strategies[sid];
            if (!p?.active) return;
            const card = document.querySelector(`.strategy__card[data-strategy-id="${sid}"]`);
            if (!card) return;
            const nw = readLiveSettings(card);
            if (nw.type !== sid) return;
            p.settings = {
                ...nw,
                stake: Number(nw.stake.toFixed(2)),
            };
        });
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

            if (p.shadowProofPhase) {
                this.#advanceShadowProofPhase(sid as StrategyID, p, price);
            }

            if (!p.cooldown) {
                const sig = p.analyzer.checkPattern(p.settings.type, p.settings, this.continuationMode);
                if (sig) this.#attemptBuy(sid as StrategyID, sig, price);
            }
            this.statusCb(sid as StrategyID, this.getStatusText(sid as StrategyID));
            this.tradeCb();
        });
    }

    getStatusText(id: StrategyID): string {
        const p = this.strategies[id];
        if (!p) return 'Waiting…';

        let txt = `Stake:${p.currentStake.toFixed(2)} | P/L:${p.cumulativePL.toFixed(2)} | Last:${p.lastDigit ?? '–'}`;
        if (p.lastAnalysis) txt += ` (${p.lastAnalysis})`;

        if (id === 'even-odd') txt += ` | E:${p.analyzer.streaks.even} O:${p.analyzer.streaks.odd}`;
        if (id === 'rise-fall') txt += ` | R:${p.analyzer.streaks.rise} F:${p.analyzer.streaks.fall}`;
        if (id === 'differs') txt += ` | Preds:${p.settings.preds.join(',')}`;
        if (p.settings.takeProfit) txt += ` | TP:${p.settings.takeProfit}`;
        if (p.settings.stopLoss) txt += ` | SL:${p.settings.stopLoss}`;
        if (p.lossStreak > 0) txt += ` | Losses:${p.lossStreak}`;

        if (this.shadowApi?.isShadow() && p.shadowProofPhase) {
            const ph = p.shadowProofPhase;
            const digits = ph.proofChain.map(x => String(x.digit)).join(' → ');
            const n = ph.proofChain.length;
            const total = ph.proofTotal;
            txt += ` | <span class="strategy__shadow-proof">Virtual proof ${n}/${total}${digits ? `: ${digits}` : ''}</span>`;
        } else if (this.shadowApi?.isShadow() && p.shadowDeferredSettle) {
            txt += ` | <span class="strategy__shadow-proof">Virtual settle pending (showing final ticks)…</span>`;
        }

        return txt;
    }

    start(id: StrategyID, s: StrategySettings) {
        this.#cancelShadowDeferredSettle(id, true);

        if (this.strategies[id]?.analyzer) {
            this.strategies[id].analyzer.reset();
        }

        // ensure base stake is 2dp
        const baseStake = Number(s.stake.toFixed(2));

        this.strategies[id] = {
            active: true,
            settings: { ...s, stake: baseStake },
            analyzer: new DigitAnalyzer(),
            cooldown: false,
            currentStake: baseStake, // 2dp
            lossStreak: 0,
            cumulativePL: 0,
            marketFormat: s.market,
            shadowProofPhase: undefined,
            shadowDeferredSettle: undefined,
        };
    }

    stop(id: StrategyID, reason = 'Stopped') {
        if (!this.strategies[id]) return;
        this.#cancelShadowDeferredSettle(id, true);
        this.strategies[id].active = false;
        this.strategies[id].shadowProofPhase = undefined;
        this.statusCb(id, reason);
        const card = document.querySelector(`.strategy__card[data-strategy-id="${id}"]`);
        const btn = card?.querySelector('.strategy__trade-btn') as HTMLButtonElement | undefined;
        if (btn) {
            btn.dataset.active = 'false';
            btn.textContent = 'Start';
        }
    }

    // Reset trades + P/L for all strategies
    resetHistory() {
        (Object.keys(this.strategies) as StrategyID[]).forEach((sid) => {
            this.#cancelShadowDeferredSettle(sid, true);
        });
        this.trades = [];
        this.settledContractIds.clear();
        Object.values(this.strategies).forEach(p => {
            p.cumulativePL = 0;
            p.lossStreak = 0;
            p.currentStake = Number(p.settings.stake.toFixed(2));
            p.entryValue = undefined;
            p.exitValue = undefined;
            p.shadowProofPhase = undefined;
            p.contractId = undefined;
            p.cooldown = false;
        });
    }

    #executeShadowSettleBundle(bundle: ShadowSettleBundle) {
        const cid = normalizeContractId(bundle.contractPayload.contract_id);
        const t = this.trades.find((x) => normalizeContractId(x.id) === cid);
        if (t && t.profit !== null) return;

        const exitEpochSec = Math.floor(Date.now() / 1000);
        scheduleCrChanceLedgerRoundTrip({
            client: bundle.ledger.client,
            walletLoginId: bundle.ledger.walletLoginId,
            ask: bundle.ledger.ask,
            settlementCredit: bundle.ledger.settlementCredit,
            entryEpochSec: bundle.ledger.entryEpochSec,
            exitEpochSec,
        });
        this.onContract(bundle.contractPayload);
    }

    #cancelShadowDeferredSettle(id: StrategyID, runBundle: boolean) {
        const p = this.strategies[id];
        if (!p?.shadowDeferredSettle) return;
        clearTimeout(p.shadowDeferredSettle.timer);
        const { bundle } = p.shadowDeferredSettle;
        p.shadowDeferredSettle = undefined;
        if (runBundle) this.#executeShadowSettleBundle(bundle);
    }

    #advanceShadowProofPhase(id: StrategyID, p: AutoTrader['strategies'][StrategyID], price: number) {
        const ph = p.shadowProofPhase;
        if (!ph) return;

        const digit = p.analyzer.getLastDigit(price, ph.market);
        ph.proofChain.push({ quote: price, digit });
        if (ph.decisionDigit === undefined) {
            ph.decisionDigit = digit;
            ph.decisionExitPrice = price;
        }

        ph.ticksRemaining -= 1;
        if (ph.ticksRemaining > 0) {
            this.tradeCb();
            return;
        }

        this.#finalizeShadowProofFromProof(id, p);
    }

    #finalizeShadowProofFromProof(id: StrategyID, p: AutoTrader['strategies'][StrategyID]) {
        const ph = p.shadowProofPhase;
        if (!ph) return;

        const cli = this.shadowApi?.getClient();
        if (!cli) {
            p.shadowProofPhase = undefined;
            p.cooldown = false;
            p.contractId = undefined;
            this.statusCb(id, 'Wallet lost (virtual settle)');
            this.tradeCb();
            return;
        }

        const decisionDigit = ph.decisionDigit ?? p.analyzer.getLastDigit(ph.triggerPrice, ph.market);
        const decisionExitPrice = ph.decisionExitPrice ?? ph.triggerPrice;
        const ct = ph.sig.type;
        const br = ph.sig.barrier;
        const b = br != null && br !== '' ? Number(br) : NaN;

        let win = false;
        switch (ct) {
            case 'DIGITEVEN':
                win = decisionDigit % 2 === 0;
                break;
            case 'DIGITODD':
                win = decisionDigit % 2 === 1;
                break;
            case 'CALL':
                win = decisionExitPrice > ph.triggerPrice;
                break;
            case 'PUT':
                win = decisionExitPrice < ph.triggerPrice;
                break;
            case 'DIGITOVER':
                win = Number.isFinite(b) && decisionDigit > b;
                break;
            case 'DIGITUNDER':
                win = Number.isFinite(b) && decisionDigit < b;
                break;
            case 'DIGITMATCH':
                win = Number.isFinite(b) && decisionDigit === b;
                break;
            case 'DIGITDIFF':
                win = Number.isFinite(b) && decisionDigit !== b;
                break;
            default:
                win = false;
        }

        const net = Number((win ? ph.payout - ph.ask : -ph.ask).toFixed(2));
        const lastProofQuote =
            ph.proofChain.length > 0 ? ph.proofChain[ph.proofChain.length - 1].quote : decisionExitPrice;

        const bundle: ShadowSettleBundle = {
            strategyId: id,
            contractPayload: {
                contract_id: ph.virtId,
                status: 'sold',
                profit: net,
                exit_tick: String(lastProofQuote),
                entry_tick: String(ph.triggerPrice),
            },
            ledger: {
                client: cli,
                walletLoginId: ph.walletLogin,
                ask: ph.ask,
                settlementCredit: win ? ph.payout : 0,
                entryEpochSec: ph.triggerEpochSec,
            },
        };

        p.shadowProofPhase = undefined;

        if (p.shadowDeferredSettle) {
            clearTimeout(p.shadowDeferredSettle.timer);
            p.shadowDeferredSettle = undefined;
        }

        const delayMs = shadowVirtualSettleUiDelayMs(ph.market);
        p.shadowDeferredSettle = {
            timer: setTimeout(() => {
                const p2 = this.strategies[id];
                if (p2?.shadowDeferredSettle) p2.shadowDeferredSettle = undefined;
                this.#executeShadowSettleBundle(bundle);
            }, delayMs),
            bundle,
        };

        this.statusCb(id, this.getStatusText(id));
        this.tradeCb();
    }

    async #attemptBuy(id: StrategyID, sig: any, triggerPrice: number) {
        const p = this.strategies[id];
        const token = localStorage.getItem('authToken');
        if (!token && !isDerivOptionsOAuthSession()) return this.statusCb(id, 'Not authorized');

        const cli = this.shadowApi?.getClient();
        const walletLogin = this.shadowApi?.getWallet() || '';
        const currency = strategyAccountCurrency(cli, walletLogin);

        if (p.currentStake > this.balanceFn()) {
            this.statusCb(id, 'Insufficient balance');
            return;
        }

        p.cooldown = true;
        try {
            if (this.shadowApi?.isShadow()) {
                if (!cli || !isCrVirtualShadowLogin(walletLogin)) {
                    this.statusCb(id, 'Wallet not ready (virtual mode)');
                    p.cooldown = false;
                    return;
                }

                const reqProposal: Record<string, unknown> = {
                    proposal: 1,
                    amount: p.currentStake,
                    basis: 'stake',
                    currency,
                    contract_type: sig.type,
                    duration: p.settings.duration,
                    duration_unit: 't',
                    ...(sig.barrier && { barrier: sig.barrier }),
                };
                applyDerivSessionMarketField(reqProposal, p.settings.market);

                const proposalResp = await this.sendWS(reqProposal);
                if (proposalResp?.error) {
                    throw new Error(proposalResp.error?.message || 'Proposal failed');
                }
                const pr = proposalResp.proposal as { ask_price?: number; payout?: number };
                const ask = Number(pr.ask_price ?? p.currentStake);
                const payout = Number(pr.payout ?? p.currentStake * 1.95);

                const debitOk = await runWithCrShadowLock(() =>
                    tryDebitCrShadowSync(cli, ALLOWED_BOT_IFRAME_LOGINID, ask),
                );
                if (!debitOk) throw new Error('Insufficient balance');

                const virtId = `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                p.contractId = virtId;
                p.entryValue = triggerPrice;
                const proofTicks = postStreakConfirmationTicksForMarket(p.settings.market);
                p.shadowProofPhase = {
                    virtId,
                    walletLogin,
                    sig: { type: sig.type, barrier: sig.barrier },
                    stake: p.currentStake,
                    market: p.settings.market,
                    ask,
                    payout,
                    triggerPrice,
                    triggerEpochSec: Math.floor(Date.now() / 1000),
                    ticksRemaining: proofTicks,
                    proofTotal: proofTicks,
                    proofChain: [],
                };

                this.settledContractIds.delete(virtId);
                this.trades.unshift({
                    id: virtId,
                    strategy: id,
                    profit: null,
                    contractType: sig.type,
                    stake: p.currentStake,
                    entryValue: triggerPrice,
                    market: p.settings.market,
                    marketFormat: p.marketFormat ?? p.settings.market,
                });
                this.tradeCb();
                return;
            }

            const buyResp = (await sendDerivSessionContractPurchase(d => this.sendWS(d), {
                contract_type: sig.type,
                market: p.settings.market,
                duration: p.settings.duration,
                stake: p.currentStake,
                currency,
                basis: 'stake',
                ...(sig.barrier ? { barrier: sig.barrier } : {}),
            })) as { error?: unknown; buy?: { contract_id?: unknown } };

            if (buyResp?.error) throw buyResp.error;

            const cidRaw = buyResp.buy?.contract_id;
            if (cidRaw == null || cidRaw === '') throw new Error('No contract_id in buy response');
            const contract_id = String(cidRaw);

            p.contractId = contract_id;
            p.entryValue = triggerPrice;
            this.settledContractIds.delete(contract_id);
            this.trades.unshift({
                id: contract_id,
                strategy: id,
                profit: null,
                contractType: sig.type,
                stake: p.currentStake,
                entryValue: p.entryValue,
                market: p.settings.market,
                marketFormat: p.marketFormat ?? p.settings.market,
            });
            this.tradeCb();
            this.statusCb(id, `Contract ${contract_id} opened`);
            try {
                await this.sendWS({ proposal_open_contract: 1, contract_id, subscribe: 1 });
            } catch {
                void 0;
            }
        } catch (e: unknown) {
            p.cooldown = false;
            this.statusCb(id, derivTradeErrorMessage(e));
        }
    }

    #applyOpenContractUpdate(id: StrategyID, poc: Record<string, unknown>, cid: string) {
        const p = this.strategies[id];
        const entrySpot = coerceProposalOpenContractEntrySpot(poc);
        const exitSpot = coerceProposalOpenContractExitSpot(poc);
        const t = this.trades.find((x) => normalizeContractId(x.id) === cid);

        if (entrySpot != null) {
            p.entryValue = entrySpot;
            if (t) t.entryValue = entrySpot;
        }
        if (exitSpot != null && !isProposalContractSettled(poc)) {
            p.exitValue = exitSpot;
            if (t) t.exitValue = exitSpot;
        }
        this.tradeCb();
    }

    #finalizeContractSettlement(id: StrategyID, cid: string, profit: number, exitSpot?: number) {
        if (this.settledContractIds.has(cid)) return;
        this.settledContractIds.add(cid);

        const p = this.strategies[id];
        const t = this.trades.find((x) => normalizeContractId(x.id) === cid);
        const firstSettlement = !!(t && t.profit === null);

        if (t) {
            t.profit = profit;
            if (exitSpot != null) t.exitValue = exitSpot;
            if (t.entryValue == null && exitSpot != null) {
                t.entryValue = p.entryValue ?? exitSpot;
            }
        }

        if (exitSpot != null) p.exitValue = exitSpot;
        p.cumulativePL += profit;

        if (firstSettlement) {
            playTradeResultSound(Number.isFinite(profit) ? profit >= 0 : false);
        }

        if (profit > 0) {
            p.currentStake = Number(p.settings.stake.toFixed(2));
            p.lossStreak = 0;
            this.statusCb(id, `Win! Stake reset • P/L:${p.cumulativePL.toFixed(2)}`);
        } else {
            p.currentStake = Number((p.currentStake * p.settings.martingale).toFixed(2));
            p.lossStreak += 1;
            this.statusCb(
                id,
                `Loss #${p.lossStreak}. Next:${p.currentStake.toFixed(2)} • P/L:${p.cumulativePL.toFixed(2)}`,
            );
        }

        if (p.settings.takeProfit > 0 && p.cumulativePL >= p.settings.takeProfit) {
            this.stop(id, `🎯 Take&nbsp;Profit hit (+${p.cumulativePL.toFixed(2)}) – strategy stopped`);
        } else if (p.settings.stopLoss > 0 && -p.cumulativePL >= p.settings.stopLoss) {
            this.stop(id, `🛑 Stop&nbsp;Loss hit (${p.cumulativePL.toFixed(2)}) – strategy stopped`);
        } else {
            p.cooldown = false;
            p.analyzer.reset();
            p.contractId = undefined;
            this.tradeCb();
        }
    }

    onContract(c: Record<string, unknown>) {
        const cid = normalizeContractId(c.contract_id);
        if (!cid) return;

        const id = (Object.keys(this.strategies) as StrategyID[]).find(
            (k) => normalizeContractId(this.strategies[k].contractId) === cid,
        );
        if (!id) return;

        const poc = c;
        this.#applyOpenContractUpdate(id, poc, cid);

        if (!isProposalContractSettled(poc)) return;

        const profit = Number(poc.profit ?? 0);
        const exitSpot = coerceProposalOpenContractExitSpot(poc);
        this.#finalizeContractSettlement(id, cid, profit, exitSpot);
    }

    onTransactionSell(tx: { contract_id?: unknown; amount?: number; transaction_time?: number }) {
        const cid = normalizeContractId(tx.contract_id);
        if (!cid || this.settledContractIds.has(cid)) return;

        const id = (Object.keys(this.strategies) as StrategyID[]).find(
            (k) => normalizeContractId(this.strategies[k].contractId) === cid,
        );
        if (!id) return;

        const t = this.trades.find((x) => normalizeContractId(x.id) === cid);
        const stake = t?.stake ?? this.strategies[id].currentStake;
        const profit = Number(tx.amount ?? 0) - stake;
        this.#finalizeContractSettlement(id, cid, profit);
    }
}

/* ────────────────────────────────────────────────────────────────────
 *  TickSubscriber wrapper
 * ──────────────────────────────────────────────────────────────────── */
const TickSubscriber: React.FC<{
    symbol: string;
    onTick: (p: number, s: string) => void;
    connectionStatus: CONNECTION_STATUS;
    tradingSocketGeneration: number;
}> = ({ symbol, onTick, connectionStatus, tradingSocketGeneration }) => {
    useTickStream(symbol, onTick, connectionStatus, tradingSocketGeneration);
    return null;
};

/* ────────────────────────────────────────────────────────────────────
 *  Main component logic
 * ──────────────────────────────────────────────────────────────────── */
const Strategy = observer(() => {
    const { ui, client } = useStore();
    const { activeLoginid, tradingSocketGeneration, connectionStatus, isAuthorized } = useApiBase();
    const clientRef = useRef(client);
    const activeLoginidRef = useRef(activeLoginid);
    useEffect(() => {
        clientRef.current = client;
    }, [client]);
    useEffect(() => {
        activeLoginidRef.current = activeLoginid;
    }, [activeLoginid]);

    const shadowApi = useMemo(
        () => ({
            isShadow: () => isCrVirtualShadowLogin(activeLoginidRef.current || clientRef.current?.loginid || ''),
            getClient: () => clientRef.current,
            getWallet: () => activeLoginidRef.current || clientRef.current?.loginid || '',
        }),
        []
    );

    const tradingSend = useCallback(async (payload: Record<string, unknown>) => {
        if (!api_base.api || api_base.api.connection.readyState !== 1) {
            await api_base.init(true);
        }
        if (!api_base.api) throw new Error('Trading API not ready');
        return api_base.api.send(payload) as Promise<unknown>;
    }, []);

    const readBalance = useCallback(
        () => readStrategyTradingBalance(clientRef.current, activeLoginidRef.current || clientRef.current?.loginid || ''),
        []
    );

    const containerRef = useRef<HTMLDivElement>(null);
    const traderRef = useRef<AutoTrader>();
    const [tradeRevision, setTradeRevision] = useState(0);
    const forceRerender = useCallback(() => setTradeRevision(n => n + 1), []);
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
        let cancelled = false;
        let pollTimer: number | undefined;

        const mountTrader = () => {
            if (cancelled || !api_base.api) return;
            const prev = traderRef.current;
            if (prev) {
                (Object.keys(prev.strategies) as StrategyID[]).forEach((sid) => {
                    if (prev.strategies[sid]?.active) prev.stop(sid, 'Session updated — strategies stopped');
                });
            }
            traderRef.current = new AutoTrader(
                tradingSend,
                readBalance,
                forceRerender,
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
                    setStatus((prevSt) => ({ ...prevSt, [id]: html }));
                },
                shadowApi,
            );
        };

        const token = localStorage.getItem('authToken');
        const optionsSession = isDerivOptionsOAuthSession();

        if (!optionsSession && !token) {
            return () => {
                cancelled = true;
            };
        }

        const waitForTradingSession = () => {
            if (cancelled) return;
            if (api_base.api && connectionStatus === CONNECTION_STATUS.OPENED && isAuthorized) {
                mountTrader();
                return;
            }
            pollTimer = window.setTimeout(waitForTradingSession, 150);
        };
        waitForTradingSession();

        return () => {
            cancelled = true;
            if (pollTimer !== undefined) window.clearTimeout(pollTimer);
        };
    }, [shadowApi, tradingSocketGeneration, connectionStatus, isAuthorized, tradingSend, readBalance]);

    useEffect(() => {
        if (!api_base.api) return;
        const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
            if (!data || !traderRef.current) return;

            const poc =
                data.proposal_open_contract ??
                (data.msg_type === 'proposal_open_contract' ? data.proposal_open_contract : null);
            if (poc) traderRef.current.onContract(poc as Record<string, unknown>);

            if (data.msg_type === 'transaction' && data.transaction?.action === 'sell') {
                traderRef.current.onTransactionSell(data.transaction);
            }
        });
        return () => sub.unsubscribe();
    }, [tradingSocketGeneration]);

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

    const getSettings = useCallback((card: Element): StrategySettings => {
        const q = (sel: string) => card.querySelector(sel) as HTMLInputElement | HTMLSelectElement | null;
        const num = (el: HTMLElement | null, d = 0) =>
            (el && +((el as HTMLInputElement).value || 0) > 0 ? +((el as HTMLInputElement).value || 0) : d);

        const preds = Array.from(card.querySelectorAll('.strategy__prediction-input'))
            .map((i) => {
                const v = Number((i as HTMLInputElement).value);
                return v >= 0 && v <= 9 ? v : 0;
            })
            .filter((v, i, a) => a.indexOf(v) === i);

        const rawStake = num(q('.strategy__stake-input'), 0.35);
        const rawMartingale = num(q('.strategy__martingale-input'), 1.25);

        return {
            type: card.getAttribute('data-strategy-id') as StrategyID,
            market: (q('.strategy__market-select') as HTMLSelectElement).value,
            stake: Number(rawStake.toFixed(2)),           // 2dp stake
            martingale: rawMartingale,
            duration: num(q('.strategy__duration-input'), 1),
            consecutive: num(q('.strategy__Consecutive-input'), 1),
            over: preds[0] ?? 1,
            under: preds[1] ?? 8,
            preds,
            disabledPreds,
            takeProfit: num(q('.strategy__take-profit-input'), 0),
            stopLoss: num(q('.strategy__stop-loss-input'), 0),
        };
    }, [disabledPreds]);

    const onTick = useCallback((p: number, s: string) => {
        if (!traderRef.current) return;
        traderRef.current.syncLiveSettingsFromDom(getSettings);
        traderRef.current.feedTick(p, s);
        setActiveMarkets((prev) => {
            const next = new Set<string>();
            Object.values(traderRef.current!.strategies).forEach((st) => {
                if (st?.active) next.add(st.settings.market);
            });
            if (prev.size === next.size && [...prev].every((m) => next.has(m))) return prev;
            return next;
        });
    }, [getSettings]);

    const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (!traderRef.current) return;
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

    const [activeStrategy, setActiveStrategy] = useState<StrategyID>('even-odd');
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
    const isAnyActive = Object.values(traderRef.current?.strategies ?? {}).some(p => p.active);

    const balanceLabel = useMemo(() => {
        const loginid = activeLoginid || client?.loginid || '';
        const bal = readStrategyTradingBalance(client, loginid);
        const cur = strategyAccountCurrency(client, loginid);
        const prefix = cur === 'USD' ? '$' : '';
        const suffix = cur === 'USD' ? '' : ` ${cur}`;
        return `${prefix}${bal.toFixed(2)}${suffix}`;
    }, [activeLoginid, client, client?.balance, client?.currency, client?.all_accounts_balance]);

    const formatTickValue = (value?: number, marketFormat?: string) => {
        if (value === undefined || value === null || !Number.isFinite(value)) return '—';
        return autotradeStrategyFormatQuoteForDigitContract(value, marketFormat || STRATEGY_DEFAULT_MARKET);
    };

    const renderTickDisplay = (strategyId: StrategyID) => {
        if (!traderRef.current?.strategies[strategyId]) return null;

        const st = traderRef.current.strategies[strategyId];
        const analyzer = st.analyzer;
        if (!analyzer || !analyzer.tickHistory.length) return null;

        const consecutive = Math.max(1, Math.floor(Number(st.settings.consecutive) || 1));
        const extra = postStreakConfirmationTicksForMarket(st.settings.market);
        const displayLen = consecutive + extra;
        const shown = analyzer.tickHistory.slice(0, displayLen);
        const pad = Math.max(0, displayLen - shown.length);

        return (
            <div className="strategy__tick-display" aria-label={`Last ${displayLen} ticks (newest first)`}>
                {shown.map((tick, index) => (
                    <span
                        key={`t-${index}`}
                        className={`strategy__tick strategy__tick-${tick.type}`}
                        title={`Tick ${index + 1} of ${displayLen} (newest first)`}
                    >
                        {tick.value}
                    </span>
                ))}
                {Array.from({ length: pad }, (_, i) => (
                    <span
                        key={`pad-${i}`}
                        className="strategy__tick strategy__tick-pending"
                        title="Older ticks will appear here as the stream fills"
                    >
                        ·
                    </span>
                ))}
            </div>
        );
    };

    return (
        <div className={`strategy-page${ui.is_dark_mode_on ? ' strategy-page--dark' : ''}`}>
            <div className="strategy__container" ref={containerRef}>
                    {[...activeMarkets].map((sym) => (
                        <TickSubscriber
                            key={sym}
                            symbol={sym}
                            onTick={onTick}
                            connectionStatus={connectionStatus}
                            tradingSocketGeneration={tradingSocketGeneration}
                        />
                    ))}

                    <header className="strategy-page__hero">
                        <h1 className="strategy-page__title">TP / SL strategies</h1>
                        <p className="strategy-page__sub">
                            Hands-free digit bots with take-profit, stop-loss, and martingale.
                        </p>
                    </header>

                    {/* ────────── Navbar ────────── */}
                    <div className="strategy__navbar">
                        <div className="strategy__navbar-brand">⚙️ Auto Bot</div>
                        <div className="strategy__navbar-auth">
                            <span>Connected</span> <span id="balance">{balanceLabel}</span>
                        </div>
                    </div>
                    <div className="strategy__navbar-controls">
                        <div className="strategy__tabs">
                            <button
                                className={`strategy__tab ${activeStrategy === 'even-odd' ? 'active' : ''}`}
                                onClick={() => switchStrategy('even-odd')}
                            >
                                Even/Odd
                            </button>
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
                                <select className="strategy__market-select" defaultValue={STRATEGY_DEFAULT_MARKET}>
                                    <option value="R_10">Volatility 10 index</option>
                                    <option value="1HZ10V">Volatility 10(1s) index</option>
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
                                    <input type="number" className="strategy__stake-input" min="0.01" step="0.01" defaultValue="0.35" />
                                </div>
                                <div className="strategy__form-group">
                                    <label>Martingale</label>
                                    <input type="number" className="strategy__martingale-input" min="1" step="0.01" defaultValue="1.25" />
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
                                {continuationMode ? (
                                    <>
                                        <small>
                                            Continuation (same): Even streak → Even · Odd streak → Odd
                                        </small>
                                        <small>Example (N=2): …EE + next E = win · …EE + next O = loss</small>
                                    </>
                                ) : (
                                    <>
                                        <small>
                                            Reversal (opposite): Even streak → Odd · Odd streak → Even
                                        </small>
                                        <small>Example (N=2): …EE + next O = win · …EE + next E = loss</small>
                                    </>
                                )}
                            </div>
                        </div>

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
                                <select className="strategy__market-select" defaultValue={STRATEGY_DEFAULT_MARKET}>
                                    <option value="R_10">Volatility 10 index</option>
                                    <option value="1HZ10V">Volatility 10(1s) index</option>
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
                                    <input type="number" className="strategy__stake-input" min="0.01" step="0.01" defaultValue="0.35" />
                                </div>
                                <div className="strategy__form-group">
                                    <label>Martingale</label>
                                    <input type="number" className="strategy__martingale-input" min="1" step="0.01" defaultValue="1.25" />
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
                                <select className="strategy__market-select" defaultValue={STRATEGY_DEFAULT_MARKET}>
                                    <option value="R_10">Volatility 10 index</option>
                                    <option value="1HZ10V">Volatility 10(1s) index</option>
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
                                    <input type="number" className="strategy__stake-input" min="0.01" step="0.01" defaultValue="0.35" />
                                </div>
                                <div className="strategy__form-group">
                                    <label>Martingale</label>
                                    <input type="number" className="strategy__martingale-input" min="1" step="0.01" defaultValue="1.25" />
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
                                {continuationMode ? (
                                    <>
                                        <small>
                                            Continuation (same): Rise streak → Rise (CALL) · Fall streak → Fall (PUT)
                                        </small>
                                        <small>Next tick continues the streak direction = win</small>
                                    </>
                                ) : (
                                    <>
                                        <small>
                                            Reversal (opposite): Rise streak → Fall (PUT) · Fall streak → Rise (CALL)
                                        </small>
                                        <small>Next tick flips direction = win</small>
                                    </>
                                )}
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
                                <select className="strategy__market-select" defaultValue={STRATEGY_DEFAULT_MARKET}>
                                    <option value="R_10">Volatility 10 index</option>
                                    <option value="1HZ10V">Volatility 10(1s) index</option>
                                    <option value="R_25">Volatility 25 index</option>
                                    <option value="1HZ25V">Volatility 25(1s) index</option>
                                    <option value="R_50">Volatility 50 index</option>
                                    <option value="1HZ50V">Volatility 50(1s) index</option>
                                    <option value="R_75">Volatility 75 index</option>
                                    <option value="1HZ75V">Volatility 75(1s) index</option>
                                    <option value="R_100">Volatility 100 index</option>
                                    <option value="1HZ100V">Volatility 100(1s) index</option>
                                    <option value="JD10">Jump 10</option>
                                    <option value="JD25">Jump 25</option>
                                    <option value="JD50">Jump 50</option>
                                    <option value="JD75">Jump 75</option>
                                    <option value="JD100">Jump 100</option>
                                </select>
                            </div>
                            <div className="strategy__prediction-controls">
                                <div className="strategy__form-row">
                                    <div className="strategy__form-group">
                                        <label>Stake Amount</label>
                                        <input type="number" className="strategy__stake-input" min="0.01" step="0.01" defaultValue="0.35" />
                                    </div>
                                    <div className="strategy__form-group">
                                        <label>Martingale</label>
                                        <input type="number" className="strategy__martingale-input" min="1" step="0.01" defaultValue="1.25" />
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

                    {/* Reset button like in Flipaa – only when no strategy is running */}
                    {!isAnyActive && (
                        <div className="strategy__reset-wrapper">
                            <button
                                className="strategy__reset-btn"
                                onClick={() => {
                                    if (!traderRef.current) return;
                                    traderRef.current.resetHistory();
                                    setStatus({
                                        'over-under': '',
                                        'rise-fall': '',
                                        'even-odd': '',
                                        differs: '',
                                    });
                                    forceRerender();
                                }}
                                title="Clear results and P/L"
                            >
                                Reset
                            </button>
                        </div>
                    )}

                    <div className="strategy__history-section">

                        <div className="strategy__history-list" key={tradeRevision}>
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
                                            {t.stake !== undefined ? t.stake.toFixed(2) : '—'}
                                        </div>
                                    </div>

                                    <div className="strategy__trade-spots">
                                        <div className="strategy__trade-entry">
                                            <svg width={16} height={16} viewBox="0 0 16 16">
                                                <circle cx={8} cy={8} r={6} stroke="#FF4444" strokeWidth={1.5} fill="white" />
                                                <circle cx={8} cy={8} r={3} fill="#FF4444" />
                                            </svg>
                                            {formatTickValue(t.entryValue, t.marketFormat || t.market)}
                                        </div>

                                        <div className="strategy__trade-exit">
                                            <svg width={16} height={16} viewBox="0 0 16 16">
                                                <circle cx={8} cy={8} r={6} stroke="#999999" strokeWidth={1.5} fill="white" />
                                            </svg>
                                            {formatTickValue(t.exitValue, t.marketFormat || t.market)}
                                        </div>
                                    </div>

                                    <div className={`strategy__trade-result ${t.profit !== null && t.profit >= 0 ? 'strategy__profit' : 'strategy__loss'}`}>
                                        {t.profit !== null ? (
                                            `${t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}`
                                        ) : '—'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
            </div>
        </div>
    );
});

export default Strategy;
