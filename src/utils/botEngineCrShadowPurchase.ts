/**
 * Bot Builder / Bot Settings — Flipaa-style buy-after-fact virtual settlement
 * for CR7557018 / ROT90381442 (and moon lead when active).
 *
 * Settlement (open → sold) is applied by the trade engine caller via processContractUpdate.
 */
import { api_base } from '@/external/bot-skeleton';
import {
    CONTRACT_TO_FLIP_STRATEGY,
    type CrShadowVirtFillResult,
    ensureCrShadowVirtTickBuffer,
    executeCrShadowVirtualFill,
    resolveCrShadowWalletLoginid,
    shouldUseCrShadowLiveFills,
} from '@/utils/crShadowVirtualFill';
import { checkMoonLeadWallet, seedCrShadowLedgerIfAbsent } from '@/utils/crVirtualBalanceShadow';

type VirtTick = { epoch: number; quote: number };

const tickBufferRef: { current: VirtTick[] } = { current: [] };
const tickEpochRef: { current: number | null } = { current: null };
const tickMarketRef: { current: string } = { current: '' };
const tickWsRef: { current: WebSocket | null } = { current: null };

const afterFactSuppressedRef = { current: false };
const afterFactWinStreakRef = { current: 0 };
const naturalLossStreakRef = { current: 0 };
const sessionLossesVirtRef = { current: 0 };
/** First Matches trade of each bot run force-wins with the predicted exit digit. */
const matchesFirstPendingRef = { current: true };
const onlyRunLossStreakRef: { current: Record<'only_up' | 'only_down', number> } = {
    current: { only_up: 0, only_down: 0 },
};
const onlyRunLossStreakVirtRef: { current: Record<'only_up' | 'only_down', number> } = {
    current: { only_up: 0, only_down: 0 },
};

/** Call when the user starts the bot so the next Matches trade is a predicted-digit win. */
export function resetCrShadowMatchesFirstRun(): void {
    matchesFirstPendingRef.current = true;
}

/** True while a virtual fill is resolving — keeps tick WS + after-fact wait alive. */
const fillInFlightRef = { current: false };

/**
 * After-fact wait loops + tick WS `isActive` must stay true during decideFlipVirtualPair.
 * Prefer bot running, but also stay hot while a fill is in flight (purchase await gap).
 */
const isRunningRef = {
    get current() {
        return Boolean(api_base?.is_running) || fillInFlightRef.current;
    },
    set current(v: boolean) {
        fillInFlightRef.current = Boolean(v);
    },
};

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

function resolveBarrier(tradeOptions: Record<string, unknown> | undefined): number | undefined {
    if (!tradeOptions) return undefined;
    const raw = tradeOptions.prediction ?? tradeOptions.barrier ?? tradeOptions.barrier_1 ?? tradeOptions.barrierOffset;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
}

/** Normalize Blockly / proposal contract type aliases → Flipaa strategy keys. */
function normalizeContractType(contractType: string): string {
    const raw = String(contractType || '')
        .trim()
        .toUpperCase();
    const aliases: Record<string, string> = {
        EVEN: 'DIGITEVEN',
        ODD: 'DIGITODD',
        OVER: 'DIGITOVER',
        UNDER: 'DIGITUNDER',
        MATCHES: 'DIGITMATCH',
        MATCH: 'DIGITMATCH',
        DIFFERS: 'DIGITDIFF',
        DIFFER: 'DIGITDIFF',
        RISE: 'CALL',
        FALL: 'PUT',
        HIGHER: 'CALL',
        LOWER: 'PUT',
        ONLYUP: 'RUNHIGH',
        ONLY_UP: 'RUNHIGH',
        ONLYDOWN: 'RUNLOW',
        ONLY_DOWN: 'RUNLOW',
    };
    return aliases[raw] || raw;
}

export type BotEngineCrShadowPurchaseResult = {
    buyResponse: { buy: Record<string, unknown> };
    fill: CrShadowVirtFillResult;
    openContract: Record<string, unknown>;
    soldContract: Record<string, unknown>;
    walletLoginId: string;
};

/** Demo-style buy ids: constant head `27674`, rotating middle, trailing `9` (e.g. 2767405699). */
let virtBuyIdSeq = 0;
function nextVirtualBuyTransactionId(): number {
    const PREFIX = 27674;
    virtBuyIdSeq = (virtBuyIdSeq + 1) % 10000;
    const middle = (Math.floor(Date.now() / 1000) + virtBuyIdSeq * 37) % 10000;
    return PREFIX * 100000 + middle * 10 + 9;
}

function nextVirtualSellTransactionId(buyTx: number): number {
    // Keep same shape; bump middle so sell ≠ buy, still ends in 9.
    const base = Math.floor(buyTx / 10);
    return (base + 1) * 10 + 9;
}

const SYMBOL_DISPLAY_NAMES: Record<string, string> = {
    R_10: 'Volatility 10 Index',
    R_25: 'Volatility 25 Index',
    R_50: 'Volatility 50 Index',
    R_75: 'Volatility 75 Index',
    R_100: 'Volatility 100 Index',
    '1HZ10V': 'Volatility 10 (1s) Index',
    '1HZ25V': 'Volatility 25 (1s) Index',
    '1HZ50V': 'Volatility 50 (1s) Index',
    '1HZ75V': 'Volatility 75 (1s) Index',
    '1HZ100V': 'Volatility 100 (1s) Index',
    RDBULL: 'Bull Market Index',
    RDBEAR: 'Bear Market Index',
};

function symbolDisplayName(symbol: string): string {
    return SYMBOL_DISPLAY_NAMES[symbol] || symbol.replace(/_/g, ' ');
}

/** Fallback when proposal omits longcode — mirrors Deriv digit / rise-fall wording. */
function buildFallbackLongcode(contractType: string, symbol: string, duration: number, barrier?: number): string {
    const name = symbolDisplayName(symbol);
    const ticks = Math.max(1, duration);
    const tickWord = ticks === 1 ? 'tick' : 'ticks';
    const b = barrier ?? 0;
    switch (contractType) {
        case 'DIGITOVER':
            return `Win payout if the last digit of ${name} is strictly higher than ${b} after ${ticks} ${tickWord}.`;
        case 'DIGITUNDER':
            return `Win payout if the last digit of ${name} is strictly lower than ${b} after ${ticks} ${tickWord}.`;
        case 'DIGITMATCH':
            return `Win payout if the last digit of ${name} is ${b} after ${ticks} ${tickWord}.`;
        case 'DIGITDIFF':
            return `Win payout if the last digit of ${name} differs from ${b} after ${ticks} ${tickWord}.`;
        case 'DIGITEVEN':
            return `Win payout if the last digit of ${name} is even after ${ticks} ${tickWord}.`;
        case 'DIGITODD':
            return `Win payout if the last digit of ${name} is odd after ${ticks} ${tickWord}.`;
        case 'CALL':
            return `Win payout if ${name} is strictly higher than entry spot after ${ticks} ${tickWord}.`;
        case 'PUT':
            return `Win payout if ${name} is strictly lower than entry spot after ${ticks} ${tickWord}.`;
        case 'RUNHIGH':
            return `Win payout if ${name} only goes up after ${ticks} ${tickWord}.`;
        case 'RUNLOW':
            return `Win payout if ${name} only goes down after ${ticks} ${tickWord}.`;
        default:
            return `Win payout if ${name} meets ${contractType} conditions after ${ticks} ${tickWord}.`;
    }
}

function buildContracts(
    fill: CrShadowVirtFillResult,
    contractType: string,
    symbol: string,
    currency: string,
    duration: number,
    barrier?: number
): Pick<BotEngineCrShadowPurchaseResult, 'buyResponse' | 'openContract' | 'soldContract'> {
    const buyTx = nextVirtualBuyTransactionId();
    const sellTx = nextVirtualSellTransactionId(buyTx);
    const purchaseTime = Math.floor(Date.now() / 1000);
    const entryDisplay = String(fill.entry.quote);
    const exitDisplay = String(fill.exit.quote);
    const shortcode = fill.shortcode || `${contractType}_${symbol}_${purchaseTime}_${Math.max(1, duration)}T_S0P_0`;
    // Prefer proposal longcode so journal matches real demo buys (Bought: … (ID: …)).
    const longcode = fill.longcode || buildFallbackLongcode(contractType, symbol, duration, barrier);
    const buyResponse = {
        buy: {
            contract_id: fill.virtId,
            buy_price: fill.ask,
            purchase_time: purchaseTime,
            transaction_id: buyTx,
            longcode,
            shortcode,
        },
    };

    const openContract = {
        contract_id: fill.virtId,
        contract_type: contractType,
        underlying_symbol: symbol,
        underlying: symbol,
        display_name: symbolDisplayName(symbol),
        symbol,
        currency,
        buy_price: fill.ask,
        bid_price: fill.ask,
        payout: fill.payout,
        shortcode,
        longcode,
        date_start: purchaseTime,
        tick_count: Math.max(1, duration),
        entry_tick: fill.entry.quote,
        entry_spot: fill.entry.quote,
        entry_tick_display_value: entryDisplay,
        entry_spot_display_value: entryDisplay,
        entry_tick_time: fill.entry.epoch,
        exit_tick: fill.exit.quote,
        exit_spot: fill.exit.quote,
        exit_tick_display_value: exitDisplay,
        exit_spot_display_value: exitDisplay,
        exit_tick_time: fill.exit.epoch,
        barrier: barrier ?? 0,
        current_spot: fill.exit.quote,
        is_sold: false,
        is_expired: false,
        is_valid_to_sell: false,
        status: 'open',
        transaction_ids: { buy: buyTx },
    };

    const sell_price = fill.win ? fill.payout : 0;
    const soldContract = {
        ...openContract,
        sell_price,
        bid_price: sell_price,
        profit: fill.net,
        is_sold: true,
        is_expired: true,
        is_valid_to_sell: false,
        status: fill.win ? 'won' : 'lost',
        transaction_ids: {
            buy: buyTx,
            sell: sellTx,
        },
    };

    return { buyResponse, openContract, soldContract };
}

async function waitForFreshVirtTick(minEpoch: number | null, timeoutMs = 2500): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const last = tickBufferRef.current[tickBufferRef.current.length - 1];
        if (last && (minEpoch == null || last.epoch > minEpoch) && tickBufferRef.current.length >= 2) {
            return;
        }
        await sleep(25);
    }
}

/**
 * When active wallet is a CR/ROT shadow login and contract type is supported,
 * run Flipaa buy-after-fact fill. Returns null when real Deriv buy should be used.
 */
export async function executeBotEngineCrShadowPurchase(args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tradeOptions: Record<string, any> | undefined;
    symbolFallback?: string;
    contractType: string;
}): Promise<BotEngineCrShadowPurchaseResult | null> {
    const { client, tradeOptions, symbolFallback } = args;
    const contractType = normalizeContractType(args.contractType);
    const walletLogin = resolveCrShadowWalletLoginid(client?.loginid, api_base?.account_info?.loginid);

    if (!shouldUseCrShadowLiveFills(walletLogin, client?.loginid)) {
        return null;
    }

    if (!CONTRACT_TO_FLIP_STRATEGY[contractType]) {
        throw new Error(
            `Virtual settlement does not support ${args.contractType}. Use a digit / rise-fall style contract.`
        );
    }

    const moonErr = checkMoonLeadWallet(walletLogin);
    if (moonErr) {
        throw new Error(moonErr);
    }

    if (!client) {
        throw new Error('Client store is not ready for virtual settlement.');
    }

    seedCrShadowLedgerIfAbsent(client, walletLogin);

    const symbol = String(tradeOptions?.symbol || symbolFallback || '');
    if (!symbol) {
        throw new Error('Missing market symbol for virtual settlement.');
    }

    const stake = Number(tradeOptions?.amount);
    if (!Number.isFinite(stake) || stake <= 0) {
        throw new Error('Invalid stake for virtual settlement.');
    }

    const duration = Math.max(1, Number(tradeOptions?.duration) || 1);
    const barrier = resolveBarrier(tradeOptions);
    const currency = String(client.currency || 'USD');

    fillInFlightRef.current = true;
    try {
        const epochBefore = tickEpochRef.current;
        await ensureCrShadowVirtTickBuffer(
            symbol,
            tickBufferRef,
            tickEpochRef,
            tickMarketRef,
            tickWsRef,
            () => Boolean(api_base?.is_running) || fillInFlightRef.current
        );
        // Give the live stream one fresh tick so after-fact isn't stuck on seed history.
        await waitForFreshVirtTick(epochBefore);

        const fill = await executeCrShadowVirtualFill({
            client,
            walletLoginId: walletLogin,
            contractType,
            stake,
            market: symbol,
            duration,
            barrier,
            currency,
            ensureApiReady: async () => {
                if (!api_base.api) {
                    await api_base.init(true);
                }
                return api_base.api;
            },
            ensureTicks: async sym => {
                await ensureCrShadowVirtTickBuffer(
                    sym,
                    tickBufferRef,
                    tickEpochRef,
                    tickMarketRef,
                    tickWsRef,
                    () => Boolean(api_base?.is_running) || fillInFlightRef.current
                );
            },
            refs: {
                isRunningRef,
                tickBufferRef,
                // Matches: force-win on first bot-run trade, and again after 3 session losses.
                sessionLossesRef: sessionLossesVirtRef,
                matchesFirstPendingRef,
                afterFactSuppressedRef,
                afterFactWinStreakRef,
                naturalLossStreakRef,
                onlyRunLossStreakRef,
                sessionLossesVirtRef,
                onlyRunLossStreakVirtRef,
            },
        });

        const built = buildContracts(fill, contractType, symbol, currency, duration, barrier);
        return {
            ...built,
            fill,
            walletLoginId: walletLogin,
        };
    } finally {
        fillInFlightRef.current = false;
    }
}

export { resolveCrShadowWalletLoginid, shouldUseCrShadowLiveFills };
