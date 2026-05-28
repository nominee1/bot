import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import {
    decideFlipVirtualPair,
    MAX_SESSION_LOSSES,
    ONLY_RUN_MAX_CONSECUTIVE_LOSSES,
    updateAfterFactGovernor,
    type VirtTick,
} from '@/pages/aaflipaa/flipaaVirtualDecision';
import { scheduleCrChanceLedgerRoundTrip } from '@/utils/chanceVirtualStatements';
import { sendDerivSessionContractPurchase } from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import {
    ALLOWED_BOT_IFRAME_LOGINID,
    isCrVirtualShadowLogin,
    runWithCrShadowLock,
    tryDebitCrShadowSync,
} from '@/utils/crVirtualBalanceShadow';
import {
    LegacyPlayFillIcon,
    MarketDerivedVolatility10Icon,
    MarketDerivedVolatility25Icon,
    MarketDerivedVolatility50Icon,
    MarketDerivedVolatility75Icon,
    MarketDerivedVolatility100Icon,
    MarketDerivedVolatility101sIcon,
    MarketDerivedVolatility151sIcon,
    MarketDerivedVolatility251sIcon,
    MarketDerivedVolatility301sIcon,
    MarketDerivedVolatility501sIcon,
    MarketDerivedVolatility751sIcon,
    MarketDerivedVolatility901sIcon,
    MarketDerivedVolatility1001sIcon,
    TradeTypesDigitsDiffersIcon,
    TradeTypesDigitsEvenIcon,
    TradeTypesDigitsMatchesIcon,
    TradeTypesDigitsOddIcon,
    TradeTypesDigitsOverIcon,
    TradeTypesDigitsUnderIcon,
    TradeTypesUpsAndDownsFallIcon,
    TradeTypesUpsAndDownsRiseIcon,
} from '@deriv/quill-icons';
import './multi.scss';

type StrategyType =
    | 'even'
    | 'odd'
    | 'over'
    | 'under'
    | 'matches'
    | 'differs'
    | 'rise'
    | 'fall'
    | 'only_up'
    | 'only_down'
    | 'rise_equals'
    | 'fall_equals';

type BotModuleKey =
    | 'even_odd'
    | 'over_under'
    | 'matches_differs'
    | 'rise_fall'
    | 'only_up_down'
    | 'rise_equals_fall_equals'
    | 'over2_over4_loss_switch'
    | 'under7_over3_loss_switch'
    | 'over3_under7_loss_switch';

type ModuleMode = 'left' | 'right' | 'both';
type LaneKey = 'left' | 'right';
type TradeStatus = 'pending' | 'open' | 'active' | 'won' | 'lost' | 'completed' | 'error';

type TTransaction = {
    contract_id: string;
    amount: number;
    transaction_time: number;
};

interface TTrade {
    id: string;
    moduleId: string;
    lane: LaneKey;
    moduleKey: BotModuleKey;
    moduleTitle: string;
    strategyKey: StrategyType;
    contractType: string;
    stake: number;
    market: string;
    duration: number;
    status: TradeStatus;
    timestamp: Date;
    startTime?: Date;
    closeTime?: Date;
    profit?: number;
    entryValue?: number;
    exitValue?: number;
    currentValue?: number;
    ticksRemaining?: number;
    marketFormat?: string;
    temp?: boolean;
    errorReason?: string;
    errorDetails?: string;
    barrier?: number;
}

type ModuleCardConfig = {
    mode: ModuleMode;
    stake: number | '';
    martingale: number | '';
    ticks: number | '';
    leftBarrier: number | '';
    rightBarrier: number | '';
};

type RunningModule = {
    id: string;
    key: BotModuleKey;
    title: string;
    market: string;
    enabled: boolean;
    mode: ModuleMode;
    leftStrategy: StrategyType;
    rightStrategy: StrategyType;
    stake: number;
    martingale: number;
    duration: number;
    leftBarrier?: number;
    rightBarrier?: number;
    lastLeftResult?: 'won' | 'lost';
    lastRightResult?: 'won' | 'lost';
};

type ModulePanelSnapshot = RunningModule & {
    active: boolean;
    endedAt?: number;
};

type LaneRuntime = {
    runtimeId: string;
    moduleId: string;
    lane: LaneKey;
    inFlight: boolean;
    currentOpenId: string | null;
    halted: boolean;
    settledIds: Set<string>;

    baseStrategy: StrategyType;
    baseBarrier?: number;

    currentStrategy: StrategyType;
    currentBarrier?: number;

    lossSwitchStrategy?: StrategyType;
    lossSwitchBarrier?: number;

    baseStake: number;
    currentStake: number;
    martingale: number;
};

type LaneSwitchConfig = {
    strategy: StrategyType;
    barrier?: number;
};

type ModuleDefinition = {
    key: BotModuleKey;
    title: string;
    leftLabel: string;
    rightLabel: string;
    leftStrategy: StrategyType;
    rightStrategy: StrategyType;
    needsBarrier: boolean;
    icon: JSX.Element;
    fixedLeftBarrier?: number;
    fixedRightBarrier?: number;
    leftLossSwitch?: LaneSwitchConfig;
    rightLossSwitch?: LaneSwitchConfig;
};

const MAX_ACTIVE_MODULES = 2;
const MIN_BUY_GAP_MS = 500;
const DELAY_AFTER_SETTLE_MS = 2000;
const START_SCAN_MS = 1200;
const GLOBAL_TURN_GAP_MS = 2000;

const ONE_SECOND_VOL_MARKETS = [
    '1HZ10V',
    '1HZ15V',
    '1HZ25V',
    '1HZ30V',
    '1HZ50V',
    '1HZ75V',
    '1HZ90V',
    '1HZ100V',
] as const;

// last 3 first
const MODULES: ModuleDefinition[] = [
    {
        key: 'over2_over4_loss_switch',
        title: 'Over 2 → Over 4 on loss',
        leftLabel: 'Lane A',
        rightLabel: 'Lane B',
        leftStrategy: 'over',
        rightStrategy: 'over',
        needsBarrier: false,
        fixedLeftBarrier: 2,
        fixedRightBarrier: 2,
        leftLossSwitch: { strategy: 'over', barrier: 4 },
        rightLossSwitch: { strategy: 'over', barrier: 4 },
        icon: <TradeTypesDigitsOverIcon width={18} height={18} />,
    },
    {
        key: 'under7_over3_loss_switch',
        title: 'Under 7 → Over 3 on loss',
        leftLabel: 'Lane A',
        rightLabel: 'Lane B',
        leftStrategy: 'under',
        rightStrategy: 'under',
        needsBarrier: false,
        fixedLeftBarrier: 7,
        fixedRightBarrier: 7,
        leftLossSwitch: { strategy: 'over', barrier: 3 },
        rightLossSwitch: { strategy: 'over', barrier: 3 },
        icon: <TradeTypesDigitsUnderIcon width={18} height={18} />,
    },
    {
        key: 'over3_under7_loss_switch',
        title: 'Over 3 → Under 7 on loss',
        leftLabel: 'Lane A',
        rightLabel: 'Lane B',
        leftStrategy: 'over',
        rightStrategy: 'over',
        needsBarrier: false,
        fixedLeftBarrier: 3,
        fixedRightBarrier: 3,
        leftLossSwitch: { strategy: 'under', barrier: 7 },
        rightLossSwitch: { strategy: 'under', barrier: 7 },
        icon: <TradeTypesDigitsOverIcon width={18} height={18} />,
    },
    {
        key: 'even_odd',
        title: 'Even / Odd',
        leftLabel: 'Even',
        rightLabel: 'Odd',
        leftStrategy: 'even',
        rightStrategy: 'odd',
        needsBarrier: false,
        icon: <TradeTypesDigitsEvenIcon width={18} height={18} />,
    },
    {
        key: 'over_under',
        title: 'Over / Under',
        leftLabel: 'Over',
        rightLabel: 'Under',
        leftStrategy: 'over',
        rightStrategy: 'under',
        needsBarrier: true,
        icon: <TradeTypesDigitsOverIcon width={18} height={18} />,
    },
    {
        key: 'matches_differs',
        title: 'Matches / Differs',
        leftLabel: 'Match',
        rightLabel: 'Differ',
        leftStrategy: 'matches',
        rightStrategy: 'differs',
        needsBarrier: true,
        icon: <TradeTypesDigitsMatchesIcon width={18} height={18} />,
    },
    {
        key: 'rise_fall',
        title: 'Rise / Fall',
        leftLabel: 'Rise',
        rightLabel: 'Fall',
        leftStrategy: 'rise',
        rightStrategy: 'fall',
        needsBarrier: false,
        icon: <TradeTypesUpsAndDownsRiseIcon width={18} height={18} />,
    },
    {
        key: 'only_up_down',
        title: 'Only Ups / Only Downs',
        leftLabel: 'Only Up',
        rightLabel: 'Only Down',
        leftStrategy: 'only_up',
        rightStrategy: 'only_down',
        needsBarrier: false,
        icon: <TradeTypesUpsAndDownsRiseIcon width={18} height={18} />,
    },
    {
        key: 'rise_equals_fall_equals',
        title: 'Rise = / Fall =',
        leftLabel: 'Rise =',
        rightLabel: 'Fall =',
        leftStrategy: 'rise_equals',
        rightStrategy: 'fall_equals',
        needsBarrier: false,
        icon: <TradeTypesUpsAndDownsFallIcon width={18} height={18} />,
    },
];

const DEFAULT_CARD_CONFIG: Record<BotModuleKey, ModuleCardConfig> = {
    even_odd: { mode: 'left', stake: 0.35, martingale: 1.25, ticks: 1, leftBarrier: '', rightBarrier: '' },
    over_under: { mode: 'left', stake: 0.35, martingale: 1.25, ticks: 1, leftBarrier: 4, rightBarrier: 6 },
    matches_differs: { mode: 'left', stake: 0.35, martingale: 1.25, ticks: 1, leftBarrier: 5, rightBarrier: 5 },
    rise_fall: { mode: 'left', stake: 0.35, martingale: 1.25, ticks: 1, leftBarrier: '', rightBarrier: '' },
    only_up_down: { mode: 'left', stake: 0.35, martingale: 1.25, ticks: 2, leftBarrier: '', rightBarrier: '' },
    rise_equals_fall_equals: { mode: 'left', stake: 0.35, martingale: 1.25, ticks: 1, leftBarrier: '', rightBarrier: '' },
    over2_over4_loss_switch: { mode: 'left', stake: 0.35, martingale: 1.25, ticks: 1, leftBarrier: '', rightBarrier: '' },
    under7_over3_loss_switch: { mode: 'left', stake: 0.35, martingale: 1.25, ticks: 1, leftBarrier: '', rightBarrier: '' },
    over3_under7_loss_switch: { mode: 'left', stake: 0.35, martingale: 1.25, ticks: 1, leftBarrier: '', rightBarrier: '' },
};

const marketIcons: Record<string, JSX.Element> = {
    '1HZ100V': <MarketDerivedVolatility1001sIcon width={16} height={16} />,
    R_100: <MarketDerivedVolatility100Icon width={16} height={16} />,
    R_10: <MarketDerivedVolatility10Icon width={16} height={16} />,
    R_25: <MarketDerivedVolatility25Icon width={16} height={16} />,
    R_50: <MarketDerivedVolatility50Icon width={16} height={16} />,
    R_75: <MarketDerivedVolatility75Icon width={16} height={16} />,
    '1HZ10V': <MarketDerivedVolatility101sIcon width={16} height={16} />,
    '1HZ25V': <MarketDerivedVolatility251sIcon width={16} height={16} />,
    '1HZ50V': <MarketDerivedVolatility501sIcon width={16} height={16} />,
    '1HZ15V': <MarketDerivedVolatility151sIcon width={16} height={16} />,
    '1HZ30V': <MarketDerivedVolatility301sIcon width={16} height={16} />,
    '1HZ90V': <MarketDerivedVolatility901sIcon width={16} height={16} />,
    '1HZ75V': <MarketDerivedVolatility751sIcon width={16} height={16} />,
};

const contractIcons: Record<string, JSX.Element> = {
    DIGITEVEN: <TradeTypesDigitsEvenIcon width={16} height={16} />,
    DIGITODD: <TradeTypesDigitsOddIcon width={16} height={16} />,
    DIGITMATCH: <TradeTypesDigitsMatchesIcon width={16} height={16} />,
    DIGITDIFF: <TradeTypesDigitsDiffersIcon width={16} height={16} />,
    DIGITOVER: <TradeTypesDigitsOverIcon width={16} height={16} />,
    DIGITUNDER: <TradeTypesDigitsUnderIcon width={16} height={16} />,
    CALL: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
    PUT: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />,
    CALLE: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
    PUTE: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />,
    RUNHIGH: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
    RUNLOW: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />,
};

const EntrySpotIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <circle cx={8} cy={8} r={6} stroke="#FF4444" strokeWidth={1.5} fill="white" />
        <circle cx={8} cy={8} r={3} fill="#FF4444" />
    </svg>
);

const ExitSpotIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <circle cx={8} cy={8} r={6} stroke="#999999" strokeWidth={1.5} fill="white" />
    </svg>
);

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const contractFor = (st: StrategyType) => {
    switch (st) {
        case 'even':
            return 'DIGITEVEN';
        case 'odd':
            return 'DIGITODD';
        case 'over':
            return 'DIGITOVER';
        case 'under':
            return 'DIGITUNDER';
        case 'matches':
            return 'DIGITMATCH';
        case 'differs':
            return 'DIGITDIFF';
        case 'rise':
            return 'CALL';
        case 'fall':
            return 'PUT';
        case 'only_up':
            return 'RUNHIGH';
        case 'only_down':
            return 'RUNLOW';
        case 'rise_equals':
            return 'CALLE';
        case 'fall_equals':
            return 'PUTE';
    }
};

const isDigitContract = (ct: string) =>
    ct === 'DIGITOVER' || ct === 'DIGITUNDER' || ct === 'DIGITMATCH' || ct === 'DIGITDIFF';

const minTicksForContract = (ct: string) => {
    if (ct === 'RUNHIGH' || ct === 'RUNLOW') return 2;
    return 1;
};

const isDirectionalDisplayContract = (ct: string) =>
    ct === 'CALL' || ct === 'PUT' || ct === 'CALLE' || ct === 'PUTE' || ct === 'RUNHIGH' || ct === 'RUNLOW';

const formatTickValue = (v?: number, mf?: string) => {
    if (v === undefined) return '—';
    if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(mf || '')) return v.toFixed(3);
    if (['R_50', 'R_75'].includes(mf || '')) return v.toFixed(4);
    return v.toFixed(2);
};

const parseRetryAfterMs = (message: string): number | null => {
    if (!message) return null;
    let m = message.match(/retry(?:ing)?\s+in\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s)\b/i);
    if (m) return Math.round(Number(m[1]) * 1000);
    m = message.match(/retry\s+after\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s)\b/i);
    if (m) return Math.round(Number(m[1]) * 1000);
    return null;
};

const isRateLimitError = (e: any) => {
    const errObj = e?.error ?? e;
    const code = (errObj?.code ?? '').toString();
    const msg = (errObj?.message ?? '').toString();
    return code === 'RateLimit' || /rate\s*limit|too\s*many\s*requests|throttl/i.test(msg);
};

const moduleByKey = (key: BotModuleKey) => MODULES.find(m => m.key === key)!;
const randomMarket = () => ONE_SECOND_VOL_MARKETS[Math.floor(Math.random() * ONE_SECOND_VOL_MARKETS.length)];
const getLaneRuntimeId = (moduleId: string, lane: LaneKey) => `${moduleId}__${lane}`;

/** Short hint under strategy name in the nav list (desktop left rail). */
function moduleNavHint(def: ModuleDefinition): string {
    if (def.leftLossSwitch || def.rightLossSwitch) return 'Barrier shifts after a losing trade';
    if (def.needsBarrier) return 'Choose digit barriers · left / right';
    if (def.key === 'only_up_down') return 'Multi-tick runs · requires 2+ ticks';
    return 'Pick lane · stake · martingale';
}

export default function MultiEntryModules() {
    const [selectedModuleKey, setSelectedModuleKey] = useState<BotModuleKey>(MODULES[0]?.key ?? 'even_odd');
    const [cardConfigs, setCardConfigs] = useState<Record<BotModuleKey, ModuleCardConfig>>(DEFAULT_CARD_CONFIG);
    const [runningModules, setRunningModules] = useState<RunningModule[]>([]);
    const [moduleSnapshots, setModuleSnapshots] = useState<ModulePanelSnapshot[]>([]);
    const [trades, setTrades] = useState<TTrade[]>([]);
    const [delayAfterSettle] = useState(true);
    const [scanState, setScanState] = useState<{ open: boolean; key: BotModuleKey | null }>({
        open: false,
        key: null,
    });
    const [msg, setMsg] = useState<{ txt: string; type: 'info' | 'success' | 'error' | 'loading' | 'warning' }>({
        txt: '',
        type: 'info',
    });
    const [apiEpoch, setApiEpoch] = useState(0);

    const [combinedTakeProfit, setCombinedTakeProfit] = useState<number | ''>(20);
    const [combinedStopLoss, setCombinedStopLoss] = useState<number | ''>(10);

    const rootStore = useStore();
    const client = rootStore.client;
    const { activeLoginid, tradingSocketGeneration } = useApiBase();
    const activeLoginidRef = useRef(activeLoginid);
    const clientRef = useRef(client);
    clientRef.current = client;
    useEffect(() => {
        activeLoginidRef.current = activeLoginid;
    }, [activeLoginid]);

    const runningModulesRef = useRef<RunningModule[]>([]);
    const laneRuntimeRef = useRef<Record<string, LaneRuntime>>({});
    const contractToLaneRuntimeRef = useRef<Record<string, string>>({});
    const stakesByIdRef = useRef<Record<string, number>>({});
    const laneTimerRef = useRef<Record<string, number | null>>({});
    const startTimerRef = useRef<number | null>(null);
    const lastBuyTsRef = useRef(0);
    const stopAllRef = useRef(false);
    const combinedLimitsTriggeredRef = useRef(false);

    const rateLimitRef = useRef<{ until: number; attempt: number; lastMsg: string }>({
        until: 0,
        attempt: 0,
        lastMsg: '',
    });

    const readyLaneSetRef = useRef<Set<string>>(new Set());
    const globalActiveContractRef = useRef<string | null>(null);
    const globalBuyInFlightRef = useRef(false);
    const lastServedRuntimeRef = useRef<string | null>(null);
    const globalNextTurnAtRef = useRef(0);
    const globalTurnTimerRef = useRef<number | null>(null);

    const pumpSchedulerRef = useRef<() => void>(() => {});

    const handleSettleRef = useRef<(contractId: string, net: number) => void>(() => {});

    const crVirtTickWsRef = useRef<WebSocket | null>(null);
    const virtTickBufferRef = useRef<VirtTick[]>([]);
    const virtTickEpochRef = useRef<number | null>(null);
    const virtTickMktRef = useRef('');
    const virtTradeInFlightRef = useRef(false);
    const sessionLossesVirtRef = useRef(0);
    const afterFactSuppressedRef = useRef(false);
    const afterFactWinStreakRef = useRef(0);
    const naturalLossStreakRef = useRef(0);
    const onlyRunLossStreakVirtRef = useRef<{ only_up: number; only_down: number }>({ only_up: 0, only_down: 0 });

    const strategyNavRef = useRef<HTMLElement | null>(null);
    const [strategyNavEdges, setStrategyNavEdges] = useState({ prev: false, next: false });

    const updateStrategyNavEdges = useCallback(() => {
        const el = strategyNavRef.current;
        if (!el) return;
        const { scrollLeft, scrollWidth, clientWidth } = el;
        const maxScroll = scrollWidth - clientWidth;
        const eps = 8;
        setStrategyNavEdges({
            prev: scrollLeft > eps,
            next: maxScroll > eps && scrollLeft < maxScroll - eps,
        });
    }, []);

    useLayoutEffect(() => {
        const el = strategyNavRef.current;
        if (!el) return;
        updateStrategyNavEdges();
        el.addEventListener('scroll', updateStrategyNavEdges, { passive: true });
        const ro = new ResizeObserver(() => updateStrategyNavEdges());
        ro.observe(el);
        window.addEventListener('resize', updateStrategyNavEdges);
        return () => {
            el.removeEventListener('scroll', updateStrategyNavEdges);
            ro.disconnect();
            window.removeEventListener('resize', updateStrategyNavEdges);
        };
    }, [updateStrategyNavEdges]);

    const scrollStrategyNav = useCallback((direction: -1 | 1) => {
        const el = strategyNavRef.current;
        if (!el) return;
        const delta = Math.max(140, Math.floor(el.clientWidth * 0.72)) * direction;
        el.scrollBy({ left: delta, behavior: 'smooth' });
    }, []);

    useEffect(() => {
        runningModulesRef.current = runningModules;
    }, [runningModules]);

    const upsertModuleSnapshot = useCallback((module: RunningModule, active = true) => {
        setModuleSnapshots(prev => {
            const existing = prev.find(p => p.id === module.id);

            if (existing) {
                return prev.map(p =>
                    p.id === module.id
                        ? {
                              ...p,
                              ...module,
                              active,
                              endedAt: active ? undefined : p.endedAt ?? Date.now(),
                          }
                        : p
                );
            }

            return [
                {
                    ...module,
                    active,
                    endedAt: active ? undefined : Date.now(),
                },
                ...prev,
            ];
        });
    }, []);

    const deactivateModuleSnapshot = useCallback((moduleId: string) => {
        setModuleSnapshots(prev =>
            prev.map(p =>
                p.id === moduleId
                    ? {
                          ...p,
                          active: false,
                          endedAt: Date.now(),
                      }
                    : p
            )
        );
    }, []);

    useEffect(() => {
        runningModules.forEach(mod => upsertModuleSnapshot(mod, true));
    }, [runningModules, upsertModuleSnapshot]);

    useEffect(() => {
        const api = api_base.api;
        const conn = api?.connection as any;
        if (!conn) return;

        const bump = () => setApiEpoch(x => x + 1);
        conn.addEventListener('open', bump);
        conn.addEventListener('close', bump);

        return () => {
            try {
                conn.removeEventListener('open', bump);
            } catch {
                void 0;
            }
            try {
                conn.removeEventListener('close', bump);
            } catch {
                void 0;
            }
        };
    }, [apiEpoch]);

    const setStatus = useCallback(
        (txt: string, type: 'info' | 'success' | 'error' | 'loading' | 'warning' = 'info') => {
            setMsg({ txt, type });
        },
        []
    );

    const ensureApiReady = useCallback(async () => {
        const OPEN = 1 as const;
        if (!api_base.api || api_base.api.connection.readyState !== OPEN) {
            await api_base.init(true);
        }
        const liveApi = api_base.api;
        if (!liveApi || liveApi.connection.readyState !== OPEN) {
            throw new Error('Trading connection is still initializing. Please try again.');
        }
        return liveApi;
    }, []);

    const clearLaneTimer = useCallback((runtimeId: string) => {
        if (laneTimerRef.current[runtimeId] != null) {
            window.clearTimeout(laneTimerRef.current[runtimeId]!);
            laneTimerRef.current[runtimeId] = null;
        }
    }, []);

    const clearGlobalTurnTimer = useCallback(() => {
        if (globalTurnTimerRef.current != null) {
            window.clearTimeout(globalTurnTimerRef.current);
            globalTurnTimerRef.current = null;
        }
    }, []);

    const clearAllTimers = useCallback(() => {
        Object.keys(laneTimerRef.current).forEach(key => {
            if (laneTimerRef.current[key] != null) {
                window.clearTimeout(laneTimerRef.current[key]!);
                laneTimerRef.current[key] = null;
            }
        });

        if (startTimerRef.current != null) {
            window.clearTimeout(startTimerRef.current);
            startTimerRef.current = null;
        }

        clearGlobalTurnTimer();
    }, [clearGlobalTurnTimer]);

    const closeCrVirtTickWs = useCallback(() => {
        if (crVirtTickWsRef.current) {
            try {
                crVirtTickWsRef.current.onopen = null;
                crVirtTickWsRef.current.onmessage = null;
                crVirtTickWsRef.current.onerror = null;
                crVirtTickWsRef.current.onclose = null;
                crVirtTickWsRef.current.close();
            } catch {
                void 0;
            }
            crVirtTickWsRef.current = null;
        }
        virtTickEpochRef.current = null;
        virtTickMktRef.current = '';
    }, []);

    const waitForRateLimitBackoff = useCallback(async () => {
        const now = Date.now();
        if (now < rateLimitRef.current.until) {
            await sleep(rateLimitRef.current.until - now);
        }
    }, []);

    const applyRateLimitBackoff = useCallback(
        async (err: any) => {
            const errObj = err?.error ?? err;
            const msgText = (errObj?.message ?? 'Rate limit').toString();
            const hinted = parseRetryAfterMs(msgText);
            const attempt = Math.min(10, rateLimitRef.current.attempt + 1);
            const base = 900;
            const cap = 25000;
            const exp = Math.min(cap, base * Math.pow(2, attempt - 1));
            const waitMs = Math.max(700, hinted ?? exp);

            rateLimitRef.current.attempt = attempt;
            rateLimitRef.current.lastMsg = msgText;
            rateLimitRef.current.until = Date.now() + waitMs;

            const sec = Math.max(1, Math.ceil(waitMs / 1000));
            setStatus(`⏳ Rate limit detected — backing off ~${sec}s`, 'warning');
            await sleep(waitMs);
        },
        [setStatus]
    );

    const clearRateLimitBackoff = useCallback(() => {
        rateLimitRef.current = { until: 0, attempt: 0, lastMsg: '' };
    }, []);

    const waitForThrottleGap = useCallback(async () => {
        const now = Date.now();
        const delta = now - lastBuyTsRef.current;
        if (delta < MIN_BUY_GAP_MS) {
            await sleep(MIN_BUY_GAP_MS - delta);
        }
        lastBuyTsRef.current = Date.now();
    }, []);

    const getOrderedRuntimeIds = useCallback(() => {
        const ids: string[] = [];
        for (const mod of runningModulesRef.current) {
            if (mod.mode === 'left' || mod.mode === 'both') ids.push(getLaneRuntimeId(mod.id, 'left'));
            if (mod.mode === 'right' || mod.mode === 'both') ids.push(getLaneRuntimeId(mod.id, 'right'));
        }
        return ids.filter(id => !!laneRuntimeRef.current[id] && !laneRuntimeRef.current[id].halted);
    }, []);

    const armGlobalTurnGap = useCallback(() => {
        clearGlobalTurnTimer();
        globalNextTurnAtRef.current = Date.now() + GLOBAL_TURN_GAP_MS;

        globalTurnTimerRef.current = window.setTimeout(() => {
            globalTurnTimerRef.current = null;
            pumpSchedulerRef.current();
        }, GLOBAL_TURN_GAP_MS);
    }, [clearGlobalTurnTimer]);

    const requestLaneTurn = useCallback((runtimeId: string) => {
        const rt = laneRuntimeRef.current[runtimeId];
        if (!rt || rt.halted || stopAllRef.current) return;
        readyLaneSetRef.current.add(runtimeId);
        pumpSchedulerRef.current();
    }, []);

    const removeModuleRuntime = useCallback(
        (moduleId: string) => {
            Object.keys(laneRuntimeRef.current).forEach(runtimeId => {
                const rt = laneRuntimeRef.current[runtimeId];
                if (rt.moduleId === moduleId) {
                    clearLaneTimer(runtimeId);
                    readyLaneSetRef.current.delete(runtimeId);
                    if (rt.currentOpenId) {
                        delete contractToLaneRuntimeRef.current[rt.currentOpenId];
                        if (globalActiveContractRef.current === rt.currentOpenId) {
                            globalActiveContractRef.current = null;
                        }
                    }
                    delete laneRuntimeRef.current[runtimeId];
                    delete laneTimerRef.current[runtimeId];
                }
            });

            runningModulesRef.current = runningModulesRef.current.filter(mod => mod.id !== moduleId);
        },
        [clearLaneTimer]
    );

    const stopModule = useCallback(
        (moduleId: string, silent = false) => {
            Object.keys(laneRuntimeRef.current).forEach(runtimeId => {
                const rt = laneRuntimeRef.current[runtimeId];
                if (rt.moduleId === moduleId) {
                    rt.halted = true;
                    rt.inFlight = false;
                    readyLaneSetRef.current.delete(runtimeId);
                    if (globalActiveContractRef.current && rt.currentOpenId === globalActiveContractRef.current) {
                        globalActiveContractRef.current = null;
                    }
                    rt.currentOpenId = null;
                    clearLaneTimer(runtimeId);
                }
            });

            deactivateModuleSnapshot(moduleId);
            removeModuleRuntime(moduleId);
            setRunningModules(prev => prev.filter(mod => mod.id !== moduleId));

            if (!silent) setStatus('Module stopped', 'info');

            pumpSchedulerRef.current();
        },
        [clearLaneTimer, deactivateModuleSnapshot, removeModuleRuntime, setStatus]
    );

    const stopAllModules = useCallback(
        (reason?: string) => {
            stopAllRef.current = true;
            closeCrVirtTickWs();
            clearAllTimers();
            setScanState({ open: false, key: null });
            readyLaneSetRef.current.clear();
            globalActiveContractRef.current = null;
            globalBuyInFlightRef.current = false;
            globalNextTurnAtRef.current = 0;

            Object.values(laneRuntimeRef.current).forEach(rt => {
                rt.halted = true;
                rt.inFlight = false;
                rt.currentOpenId = null;
            });

            setModuleSnapshots(prev =>
                prev.map(p =>
                    p.active
                        ? {
                              ...p,
                              active: false,
                              endedAt: Date.now(),
                          }
                        : p
                )
            );

            runningModulesRef.current = [];
            setRunningModules([]);

            setStatus(reason || 'All modules stopped', 'warning');
        },
        [clearAllTimers, closeCrVirtTickWs, setStatus]
    );

    const resetAll = useCallback(() => {
        stopAllModules();
        setTrades([]);
        setModuleSnapshots([]);
        laneRuntimeRef.current = {};
        contractToLaneRuntimeRef.current = {};
        stakesByIdRef.current = {};
        laneTimerRef.current = {};
        lastBuyTsRef.current = 0;
        clearRateLimitBackoff();
        stopAllRef.current = false;
        combinedLimitsTriggeredRef.current = false;
        readyLaneSetRef.current.clear();
        globalActiveContractRef.current = null;
        globalBuyInFlightRef.current = false;
        lastServedRuntimeRef.current = null;
        globalNextTurnAtRef.current = 0;
        clearGlobalTurnTimer();
        setStatus('History cleared', 'info');
    }, [clearGlobalTurnTimer, clearRateLimitBackoff, setStatus, stopAllModules]);

    const clearSinglePanel = useCallback(
        (moduleId: string) => {
            const isRunning = runningModulesRef.current.some(mod => mod.id === moduleId);
            if (isRunning) {
                stopModule(moduleId, true);
            }

            setTrades(prev => prev.filter(tr => tr.moduleId !== moduleId));
            setModuleSnapshots(prev => prev.filter(p => p.id !== moduleId));
            setStatus('Panel cleared', 'info');
        },
        [setStatus, stopModule]
    );

    const patchTradeError = useCallback((tempId: string, reason: string, details?: string) => {
        setTrades(prev =>
            prev.map(tr =>
                tr.id === tempId
                    ? {
                          ...tr,
                          status: 'error',
                          temp: false,
                          errorReason: reason,
                          errorDetails: details,
                          closeTime: new Date(),
                      }
                    : tr
            )
        );
    }, []);

    const openCrVirtTickWs = useCallback(
        (symbol: string) => {
            closeCrVirtTickWs();
            virtTickBufferRef.current = [];
            virtTickMktRef.current = symbol;

            const app_id = 1089;
            const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);
            crVirtTickWsRef.current = ws;

            ws.onopen = async () => {
                try {
                    const seed = await api_base.api?.send({
                        ticks_history: symbol,
                        count: 2,
                        end: 'latest',
                        start: 1,
                        adjust_start_time: 1,
                    });
                    if (seed?.history?.prices?.length && seed?.history?.times?.length) {
                        const prices = seed.history.prices.map(Number);
                        const times = seed.history.times.map(Number);
                        for (let i = 0; i < prices.length; i++) {
                            virtTickBufferRef.current.push({ epoch: times[i], quote: prices[i] });
                        }
                        virtTickEpochRef.current = times[times.length - 1] ?? null;
                    }
                } catch {
                    void 0;
                }
                try {
                    ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
                } catch {
                    void 0;
                }
            };

            ws.onmessage = (evt: MessageEvent) => {
                try {
                    const d = JSON.parse(evt.data);
                    if (d?.error || !d?.tick?.quote || !d?.tick?.epoch) return;
                    const q = Number(d.tick.quote);
                    const ep = Number(d.tick.epoch);
                    if (virtTickEpochRef.current === ep) return;
                    virtTickEpochRef.current = ep;
                    virtTickBufferRef.current.push({ epoch: ep, quote: q });
                    const buf = virtTickBufferRef.current;
                    if (buf.length > 600) buf.splice(0, buf.length - 600);
                } catch {
                    void 0;
                }
            };
            ws.onerror = () => {};
            ws.onclose = () => {};
        },
        [closeCrVirtTickWs]
    );

    const ensureVirtTicksForCrMarket = useCallback(
        async (symbol: string) => {
            if (virtTickMktRef.current !== symbol || !crVirtTickWsRef.current) {
                openCrVirtTickWs(symbol);
            }
            const t0 = Date.now();
            while (Date.now() - t0 < 5000) {
                if (virtTickBufferRef.current.length >= 2) return;
                await sleep(25);
            }
            throw new Error('virtual-tick-timeout');
        },
        [openCrVirtTickWs]
    );

    const completeVirtualMultiLaneTrade = useCallback(
        async (
            tempId: string,
            runtimeId: string,
            runtime: LaneRuntime,
            module: RunningModule,
            strategy: StrategyType,
            contractType: string,
            stake: number,
            barrier: number | undefined,
            dur: number,
            market: string
        ) => {
            const cli = clientRef.current;
            if (!cli) throw new Error('restricted');
            const shadowKey = ALLOWED_BOT_IFRAME_LOGINID;

            await ensureApiReady();
            virtTradeInFlightRef.current = true;
            try {
                await ensureVirtTicksForCrMarket(market);

                const proposalResp = await api_base.api!.send({
                    proposal: 1,
                    amount: stake,
                    basis: 'stake',
                    currency: 'USD',
                    contract_type: contractType,
                    duration: dur,
                    duration_unit: 't',
                    symbol: market,
                    ...(typeof barrier === 'number' ? { barrier: String(barrier) } : {}),
                });
                if (proposalResp?.error) throw proposalResp.error;
                const pr = proposalResp.proposal as { ask_price?: number; payout?: number };
                const ask = Number(pr.ask_price ?? stake);
                const payout = Number(pr.payout ?? stake * 1.95);

                const decision = await decideFlipVirtualPair(
                    {
                        isRunningRef: virtTradeInFlightRef,
                        tickBufferRef: virtTickBufferRef,
                        sessionLossesRef: sessionLossesVirtRef,
                        afterFactSuppressedRef,
                        afterFactWinStreakRef,
                        naturalLossStreakRef,
                        onlyRunLossStreakRef: onlyRunLossStreakVirtRef,
                    },
                    strategy,
                    typeof barrier === 'number' ? barrier : undefined,
                    dur,
                    market
                );

                if (!decision.decided) {
                    patchTradeError(tempId, 'Trade failed', 'Could not resolve virtual outcome');
                    throw new Error('virtual-timeout');
                }

                const debitOk = await runWithCrShadowLock(() => tryDebitCrShadowSync(cli, shadowKey, ask));
                if (!debitOk) {
                    patchTradeError(
                        tempId,
                        'Trade failed — insufficient balance',
                        'Not enough virtual balance for this stake.'
                    );
                    throw new Error('insufficient-balance');
                }

                const net = decision.win ? payout - ask : -ask;
                const virtId = `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;

                stakesByIdRef.current[virtId] = stake;
                contractToLaneRuntimeRef.current[virtId] = runtimeId;

                const isDir = isDirectionalDisplayContract(contractType);
                const isOneTick = dur === 1;
                const entryShown = isDir ? decision.entry : isOneTick ? decision.exit : decision.entry;
                const exitShown = decision.exit;

                updateAfterFactGovernor(
                    {
                        afterFactSuppressedRef,
                        afterFactWinStreakRef,
                        naturalLossStreakRef,
                    },
                    strategy,
                    decision.sourceMode ?? 'natural',
                    net
                );

                if (net < 0) {
                    sessionLossesVirtRef.current = Math.min(MAX_SESSION_LOSSES, sessionLossesVirtRef.current + 1);
                }

                if (strategy === 'only_up' || strategy === 'only_down') {
                    if (net >= 0) onlyRunLossStreakVirtRef.current[strategy] = 0;
                    else {
                        onlyRunLossStreakVirtRef.current[strategy] = Math.min(
                            ONLY_RUN_MAX_CONSECUTIVE_LOSSES,
                            onlyRunLossStreakVirtRef.current[strategy] + 1
                        );
                    }
                }

                const settlementCredit = decision.win ? payout : 0;
                const walletLogin = activeLoginidRef.current || cli.loginid || '';
                scheduleCrChanceLedgerRoundTrip({
                    client: cli,
                    walletLoginId: walletLogin,
                    ask,
                    settlementCredit,
                    entryEpochSec: entryShown.epoch,
                    exitEpochSec: exitShown.epoch,
                });

                setTrades(prev =>
                    prev.map(tr =>
                        tr.id === tempId
                            ? {
                                  ...tr,
                                  id: virtId,
                                  temp: false,
                                  status: net >= 0 ? 'won' : 'lost',
                                  profit: Number(net.toFixed(2)),
                                  entryValue: entryShown.quote,
                                  exitValue: exitShown.quote,
                                  closeTime: new Date(),
                                  startTime: new Date(entryShown.epoch * 1000),
                                  strategyKey: strategy,
                                  stake,
                                  barrier,
                              }
                            : tr
                    )
                );

                clearRateLimitBackoff();
                setStatus(`✅ ${module.title} ${runtime.lane.toUpperCase()} settled (virtual)`, 'success');

                runtime.inFlight = false;
                globalBuyInFlightRef.current = false;

                handleSettleRef.current(virtId, net);
            } finally {
                virtTradeInFlightRef.current = false;
            }
        },
        [
            clearRateLimitBackoff,
            ensureApiReady,
            ensureVirtTicksForCrMarket,
            patchTradeError,
            setStatus,
        ]
    );

    const createTempTrade = useCallback(
        (
            module: RunningModule,
            lane: LaneKey,
            strategyKey: StrategyType,
            contractType: string,
            stake: number,
            barrier?: number
        ) => {
            const id = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const trade: TTrade = {
                id,
                moduleId: module.id,
                lane,
                moduleKey: module.key,
                moduleTitle: module.title,
                strategyKey,
                contractType,
                stake,
                market: module.market,
                duration: module.duration,
                status: 'pending',
                timestamp: new Date(),
                marketFormat: module.market,
                temp: true,
                barrier,
            };
            setTrades(prev => [trade, ...prev]);
            return id;
        },
        []
    );

    const updateModule = useCallback((moduleId: string, updater: (m: RunningModule) => RunningModule) => {
        setRunningModules(prev => {
            const next = prev.map(mod => (mod.id === moduleId ? updater(mod) : mod));
            runningModulesRef.current = next;
            return next;
        });
    }, []);

    const getLaneConfig = useCallback((runtimeId: string) => {
        const runtime = laneRuntimeRef.current[runtimeId];
        if (!runtime) return null;

        return {
            strategy: runtime.currentStrategy,
            contractType: contractFor(runtime.currentStrategy),
            barrier: runtime.currentBarrier,
            stake: runtime.currentStake,
        };
    }, []);

    const scheduleLane = useCallback(
        (runtimeId: string, why: 'start' | 'after_win' | 'after_loss' | 'after_error' = 'start') => {
            clearLaneTimer(runtimeId);

            const runtime = laneRuntimeRef.current[runtimeId];
            if (!runtime || runtime.halted || stopAllRef.current) return;

            const run = () => {
                const rt = laneRuntimeRef.current[runtimeId];
                if (!rt || rt.halted || stopAllRef.current) return;
                if (rt.inFlight) return;
                if (rt.currentOpenId) return;
                requestLaneTurn(runtimeId);
            };

            const delay = why !== 'start' && delayAfterSettle ? DELAY_AFTER_SETTLE_MS : 0;
            laneTimerRef.current[runtimeId] = window.setTimeout(run, delay);
        },
        [clearLaneTimer, delayAfterSettle, requestLaneTurn]
    );

    const buyLane = useCallback(
        async (runtimeId: string) => {
            const runtime = laneRuntimeRef.current[runtimeId];
            if (!runtime || runtime.halted || stopAllRef.current) return;
            if (globalActiveContractRef.current || globalBuyInFlightRef.current) return;

            const module = runningModulesRef.current.find(m => m.id === runtime.moduleId);
            if (!module) return;

            if (module.mode === 'left' && runtime.lane !== 'left') return;
            if (module.mode === 'right' && runtime.lane !== 'right') return;

            const laneCfg = getLaneConfig(runtimeId);
            if (!laneCfg) return;

            const { strategy, contractType, barrier, stake } = laneCfg;
            const tempId = createTempTrade(module, runtime.lane, strategy, contractType, stake, barrier);

            runtime.inFlight = true;
            readyLaneSetRef.current.delete(runtimeId);
            globalBuyInFlightRef.current = true;
            lastServedRuntimeRef.current = runtimeId;

            try {
                await ensureApiReady();

                const walletLogin = activeLoginidRef.current || clientRef.current?.loginid || '';
                if (isCrVirtualShadowLogin(walletLogin)) {
                    if (!clientRef.current) {
                        patchTradeError(tempId, 'Wallet not ready', 'Virtual trading requires an initialized wallet.');
                        setStatus('Wallet not ready — wait and retry', 'error');
                        runtime.inFlight = false;
                        globalBuyInFlightRef.current = false;
                        if (!runtime.halted && !stopAllRef.current) {
                            scheduleLane(runtimeId, 'after_error');
                        }
                        pumpSchedulerRef.current();
                        return;
                    }

                    try {
                        await waitForThrottleGap();
                        await waitForRateLimitBackoff();
                        await completeVirtualMultiLaneTrade(
                            tempId,
                            runtimeId,
                            runtime,
                            module,
                            strategy,
                            contractType,
                            stake,
                            barrier,
                            module.duration,
                            module.market
                        );
                        return;
                    } catch (e: unknown) {
                        const msg = (e instanceof Error ? e.message : String(e ?? '')).toString();
                        if (
                            !['restricted', 'insufficient-balance', 'virtual-timeout', 'Wallet not ready'].includes(
                                msg
                            )
                        ) {
                            const errObj = (e as { error?: { message?: string } })?.error ?? e;
                            const message = (
                                typeof errObj === 'object' && errObj !== null && 'message' in errObj
                                    ? (errObj as { message?: string }).message
                                    : undefined
                            ) ||
                                msg ||
                                'Trade failed';
                            setStatus(String(message), 'error');
                        }
                        runtime.inFlight = false;
                        runtime.currentOpenId = null;
                        globalBuyInFlightRef.current = false;
                        if (!runtime.halted && !stopAllRef.current) {
                            scheduleLane(runtimeId, 'after_error');
                        }
                        pumpSchedulerRef.current();
                        return;
                    }
                }

                const MAX_RL_RETRIES = 8;

                for (let attempt = 0; attempt <= MAX_RL_RETRIES; attempt++) {
                    if (runtime.halted || stopAllRef.current) throw new Error('Trading halted');

                    try {
                        await waitForThrottleGap();
                        await waitForRateLimitBackoff();

                        const liveApi = await ensureApiReady();
                        const resp = (await sendDerivSessionContractPurchase(
                            d => liveApi.send(d) as Promise<unknown>,
                            {
                                contract_type: contractType,
                                market: module.market,
                                duration: module.duration,
                                stake,
                                ...(typeof barrier === 'number' ? { barrier: String(barrier) } : {}),
                            }
                        )) as { error?: unknown; buy?: { contract_id?: unknown } };

                        if (resp?.error) throw resp;

                        clearRateLimitBackoff();

                        const contractIdRaw = resp.buy?.contract_id;
                        if (contractIdRaw == null || contractIdRaw === '') {
                            throw new Error('No contract_id in buy response');
                        }
                        const realID = String(contractIdRaw);
                        stakesByIdRef.current[realID] = stake;
                        contractToLaneRuntimeRef.current[realID] = runtimeId;

                        runtime.currentOpenId = realID;
                        runtime.inFlight = false;
                        globalBuyInFlightRef.current = false;
                        globalActiveContractRef.current = realID;

                        setTrades(prev =>
                            prev.map(tr =>
                                tr.id === tempId
                                    ? {
                                          ...tr,
                                          id: realID,
                                          temp: false,
                                          status: 'open',
                                          strategyKey: strategy,
                                          stake,
                                          barrier,
                                      }
                                    : tr
                            )
                        );

                        try {
                            await liveApi.send({
                                proposal_open_contract: 1,
                                contract_id: realID,
                                subscribe: 1,
                            });
                        } catch {
                            void 0;
                        }

                        setStatus(`✅ ${module.title} ${runtime.lane.toUpperCase()} trade placed`, 'success');
                        return;
                    } catch (e: any) {
                        if (isRateLimitError(e) && attempt < MAX_RL_RETRIES) {
                            await applyRateLimitBackoff(e);
                            await waitForRateLimitBackoff();
                            continue;
                        }

                        const errObj = e?.error ?? e;
                        const message = (errObj?.message || 'Trade failed').toString();
                        const code = errObj?.code || '';
                        const isBalanceError =
                            code === 'InsufficientBalance' ||
                            /insufficient|balance|fund|not enough|no enough|low balance/i.test(message);

                        patchTradeError(tempId, isBalanceError ? 'Insufficient balance' : 'Trade failed', message);
                        setStatus(message || 'Trade failed', 'error');

                        runtime.inFlight = false;
                        runtime.currentOpenId = null;
                        globalBuyInFlightRef.current = false;

                        if (!runtime.halted && !stopAllRef.current) {
                            scheduleLane(runtimeId, 'after_error');
                        }
                        pumpSchedulerRef.current();
                        return;
                    }
                }

                patchTradeError(tempId, 'Rate limit', 'Too many rate limit retries');
                setStatus('Rate limit retries exhausted', 'error');
                runtime.inFlight = false;
                runtime.currentOpenId = null;
                globalBuyInFlightRef.current = false;

                if (!runtime.halted && !stopAllRef.current) {
                    scheduleLane(runtimeId, 'after_error');
                }
                pumpSchedulerRef.current();
            } catch {
                runtime.inFlight = false;
                runtime.currentOpenId = null;
                globalBuyInFlightRef.current = false;

                if (!runtime.halted && !stopAllRef.current) {
                    scheduleLane(runtimeId, 'after_error');
                }
                pumpSchedulerRef.current();
            }
        },
        [
            applyRateLimitBackoff,
            clearRateLimitBackoff,
            completeVirtualMultiLaneTrade,
            createTempTrade,
            ensureApiReady,
            getLaneConfig,
            patchTradeError,
            scheduleLane,
            setStatus,
            waitForRateLimitBackoff,
            waitForThrottleGap,
        ]
    );

    const pumpScheduler = useCallback(() => {
        if (stopAllRef.current) return;
        if (globalBuyInFlightRef.current) return;
        if (globalActiveContractRef.current) return;

        const now = Date.now();
        if (now < globalNextTurnAtRef.current) {
            if (globalTurnTimerRef.current == null) {
                globalTurnTimerRef.current = window.setTimeout(() => {
                    globalTurnTimerRef.current = null;
                    pumpSchedulerRef.current();
                }, globalNextTurnAtRef.current - now);
            }
            return;
        }

        const ready = [...readyLaneSetRef.current].filter(id => {
            const rt = laneRuntimeRef.current[id];
            if (!rt || rt.halted) return false;
            if (rt.inFlight) return false;
            if (rt.currentOpenId) return false;

            const mod = runningModulesRef.current.find(m => m.id === rt.moduleId);
            if (!mod) return false;
            if (mod.mode === 'left' && rt.lane !== 'left') return false;
            if (mod.mode === 'right' && rt.lane !== 'right') return false;

            return true;
        });

        if (!ready.length) return;

        const ordered = getOrderedRuntimeIds();
        const candidates = ordered.filter(id => ready.includes(id));
        if (!candidates.length) return;

        let pick = candidates[0];
        const last = lastServedRuntimeRef.current;

        if (last && candidates.length > 1) {
            const idx = candidates.indexOf(last);
            pick = idx >= 0 ? candidates[(idx + 1) % candidates.length] : candidates[0];
        }

        void buyLane(pick);
    }, [buyLane, getOrderedRuntimeIds]);

    pumpSchedulerRef.current = pumpScheduler;

    const handleSettle = useCallback(
        (contractId: string, net: number) => {
            const runtimeId = contractToLaneRuntimeRef.current[contractId];
            if (!runtimeId) return;

            const runtime = laneRuntimeRef.current[runtimeId];
            if (!runtime) return;

            runtime.currentOpenId = null;
            runtime.inFlight = false;

            if (globalActiveContractRef.current === contractId) {
                globalActiveContractRef.current = null;
            }

            const isWin = net >= 0;

            if (isWin) {
                runtime.currentStrategy = runtime.baseStrategy;
                runtime.currentBarrier = runtime.baseBarrier;
                runtime.currentStake = runtime.baseStake;
            } else {
                if (runtime.lossSwitchStrategy) {
                    runtime.currentStrategy = runtime.lossSwitchStrategy;
                    runtime.currentBarrier = runtime.lossSwitchBarrier;
                }
                runtime.currentStake =
                    runtime.martingale > 1
                        ? Number((runtime.currentStake * runtime.martingale).toFixed(2))
                        : runtime.baseStake;
            }

            updateModule(runtime.moduleId, mod =>
                runtime.lane === 'left'
                    ? { ...mod, lastLeftResult: isWin ? 'won' : 'lost' }
                    : { ...mod, lastRightResult: isWin ? 'won' : 'lost' }
            );

            armGlobalTurnGap();

            if (!runtime.halted && !stopAllRef.current) {
                scheduleLane(runtimeId, isWin ? 'after_win' : 'after_loss');
            }

            pumpSchedulerRef.current();
        },
        [armGlobalTurnGap, scheduleLane, updateModule]
    );

    useLayoutEffect(() => {
        handleSettleRef.current = handleSettle;
    }, [handleSettle]);

    const handleApiMessage = useCallback(
        ({ data }: any) => {
            if (data?.error) return;

            if (data?.msg_type === 'proposal_open_contract') {
                const c = data.proposal_open_contract;
                const cid = String(c.contract_id);
                if (cid.startsWith('v-')) return;
                const runtimeId = contractToLaneRuntimeRef.current[cid];
                if (!runtimeId) return;

                const runtime = laneRuntimeRef.current[runtimeId];
                if (!runtime) return;

                setTrades(prev =>
                    prev.map(tr => {
                        if (tr.id !== cid) return tr;

                        const next = { ...tr };

                        if (!next.startTime && c.entry_tick_time) {
                            next.startTime = new Date(c.entry_tick_time * 1000);
                            next.entryValue = c.entry_tick ? Number(c.entry_tick) : undefined;
                        }

                        if (c.tick_count && c.current_tick) {
                            next.ticksRemaining = c.tick_count - c.current_tick;
                        }

                        next.currentValue = c.current_spot ? Number(c.current_spot) : next.currentValue;

                        const finished = c.is_sold || c.is_expired || c.is_settleable || c.status === 'sold';
                        if (finished) {
                            const net = Number(c.profit ?? 0);
                            next.status = net >= 0 ? 'won' : 'lost';
                            next.profit = net;
                            next.closeTime = new Date();
                            next.exitValue = c.exit_tick ? Number(c.exit_tick) : undefined;
                        } else {
                            next.status = (c.status as TradeStatus) || 'active';
                        }

                        return next;
                    })
                );

                const finished = c.is_sold || c.is_expired || c.is_settleable || c.status === 'sold';
                if (finished && !runtime.settledIds.has(cid)) {
                    runtime.settledIds.add(cid);
                    handleSettle(cid, Number(c.profit ?? 0));
                }
            }

            if (data?.msg_type === 'transaction' && data.transaction?.action === 'sell') {
                const tx: TTransaction = data.transaction;
                const cid = String(tx.contract_id);
                if (cid.startsWith('v-')) return;
                const runtimeId = contractToLaneRuntimeRef.current[cid];
                if (!runtimeId) return;

                const runtime = laneRuntimeRef.current[runtimeId];
                if (!runtime) return;

                setTrades(prev =>
                    prev.map(tr => {
                        if (tr.id !== cid) return tr;
                        const stake = stakesByIdRef.current[cid] ?? tr.stake ?? 0;
                        const net = Number(tx.amount) - stake;
                        return {
                            ...tr,
                            status: net >= 0 ? 'won' : 'lost',
                            profit: net,
                            closeTime: new Date(tx.transaction_time * 1000),
                        };
                    })
                );

                if (!runtime.settledIds.has(cid)) {
                    runtime.settledIds.add(cid);
                    const stake = stakesByIdRef.current[cid] ?? 0;
                    handleSettle(cid, Number(tx.amount) - stake);
                }
            }
        },
        [handleSettle]
    );

    useEffect(() => {
        let sub: { unsubscribe: () => void } | null = null;
        let cancelled = false;

        const init = async () => {
            try {
                const liveApi = await ensureApiReady();
                if (cancelled) return;
                sub = liveApi.onMessage().subscribe(handleApiMessage);
            } catch {
                void 0;
            }
        };

        void init();

        return () => {
            cancelled = true;
            sub?.unsubscribe();
        };
    }, [apiEpoch, ensureApiReady, handleApiMessage, tradingSocketGeneration]);

    useEffect(() => {
        return () => {
            stopAllRef.current = true;
            clearAllTimers();
        };
    }, [clearAllTimers]);

    const updateCardConfig = useCallback(
        <K extends keyof ModuleCardConfig>(key: BotModuleKey, field: K, value: ModuleCardConfig[K]) => {
            setCardConfigs(prev => ({
                ...prev,
                [key]: {
                    ...prev[key],
                    [field]: value,
                },
            }));
        },
        []
    );

    const startModuleFromCard = useCallback(
        async (moduleKey: BotModuleKey) => {
            if (runningModulesRef.current.length >= MAX_ACTIVE_MODULES) {
                setStatus(`Only ${MAX_ACTIVE_MODULES} modules can be active at the same time`, 'warning');
                return;
            }

            const def = moduleByKey(moduleKey);
            const cfg = cardConfigs[moduleKey];

            if (!isNum(cfg.stake) || cfg.stake <= 0) {
                setStatus('Enter a valid stake', 'warning');
                return;
            }

            if (!isNum(cfg.martingale) || cfg.martingale < 1) {
                setStatus('Enter valid martingale (minimum 1)', 'warning');
                return;
            }

            if (!isNum(cfg.ticks) || cfg.ticks <= 0) {
                setStatus('Enter valid ticks', 'warning');
                return;
            }

            if (def.needsBarrier) {
                const leftNeeded = cfg.mode === 'left' || cfg.mode === 'both';
                const rightNeeded = cfg.mode === 'right' || cfg.mode === 'both';

                if (leftNeeded && (!isNum(cfg.leftBarrier) || cfg.leftBarrier < 0 || cfg.leftBarrier > 9)) {
                    setStatus(`${def.leftLabel} digit must be between 0 and 9`, 'warning');
                    return;
                }

                if (rightNeeded && (!isNum(cfg.rightBarrier) || cfg.rightBarrier < 0 || cfg.rightBarrier > 9)) {
                    setStatus(`${def.rightLabel} digit must be between 0 and 9`, 'warning');
                    return;
                }
            }

            const alreadyRunning = runningModulesRef.current.find(mod => mod.key === moduleKey);
            if (alreadyRunning) {
                setStatus(`${def.title} is already active`, 'warning');
                return;
            }

            if (startTimerRef.current != null) {
                window.clearTimeout(startTimerRef.current);
                startTimerRef.current = null;
            }

            setTrades(prev => prev.filter(t => t.moduleKey !== moduleKey));
            setModuleSnapshots(prev => prev.filter(p => p.key !== moduleKey));

            stopAllRef.current = false;
            combinedLimitsTriggeredRef.current = false;
            setScanState({ open: true, key: moduleKey });
            setStatus('Preparing contract engine...', 'loading');

            try {
                await ensureApiReady();
            } catch {
                setScanState({ open: false, key: null });
                setStatus('Failed to initialize API', 'error');
                return;
            }

            startTimerRef.current = window.setTimeout(() => {
                startTimerRef.current = null;

                if (stopAllRef.current) {
                    setScanState({ open: false, key: null });
                    return;
                }

                const market = randomMarket();
                const moduleId = `${moduleKey}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                const duration = Math.max(
                    Number(cfg.ticks),
                    minTicksForContract(contractFor(def.leftStrategy)),
                    minTicksForContract(contractFor(def.rightStrategy))
                );

                const leftBarrier =
                    typeof def.fixedLeftBarrier === 'number'
                        ? def.fixedLeftBarrier
                        : isNum(cfg.leftBarrier)
                          ? cfg.leftBarrier
                          : undefined;

                const rightBarrier =
                    typeof def.fixedRightBarrier === 'number'
                        ? def.fixedRightBarrier
                        : isNum(cfg.rightBarrier)
                          ? cfg.rightBarrier
                          : undefined;

                const runningModule: RunningModule = {
                    id: moduleId,
                    key: def.key,
                    title: def.title,
                    market,
                    enabled: true,
                    mode: cfg.mode,
                    leftStrategy: def.leftStrategy,
                    rightStrategy: def.rightStrategy,
                    stake: Number(cfg.stake),
                    martingale: Number(cfg.martingale),
                    duration,
                    leftBarrier,
                    rightBarrier,
                };

                const nextRunning = [...runningModulesRef.current, runningModule];
                runningModulesRef.current = nextRunning;
                setRunningModules(nextRunning);
                upsertModuleSnapshot(runningModule, true);

                const leftRuntimeId = getLaneRuntimeId(moduleId, 'left');
                const rightRuntimeId = getLaneRuntimeId(moduleId, 'right');

                laneRuntimeRef.current[leftRuntimeId] = {
                    runtimeId: leftRuntimeId,
                    moduleId,
                    lane: 'left',
                    inFlight: false,
                    currentOpenId: null,
                    halted: false,
                    settledIds: new Set<string>(),
                    baseStrategy: def.leftStrategy,
                    baseBarrier: leftBarrier,
                    currentStrategy: def.leftStrategy,
                    currentBarrier: leftBarrier,
                    lossSwitchStrategy: def.leftLossSwitch?.strategy,
                    lossSwitchBarrier: def.leftLossSwitch?.barrier,
                    baseStake: Number(cfg.stake),
                    currentStake: Number(cfg.stake),
                    martingale: Number(cfg.martingale),
                };

                laneRuntimeRef.current[rightRuntimeId] = {
                    runtimeId: rightRuntimeId,
                    moduleId,
                    lane: 'right',
                    inFlight: false,
                    currentOpenId: null,
                    halted: false,
                    settledIds: new Set<string>(),
                    baseStrategy: def.rightStrategy,
                    baseBarrier: rightBarrier,
                    currentStrategy: def.rightStrategy,
                    currentBarrier: rightBarrier,
                    lossSwitchStrategy: def.rightLossSwitch?.strategy,
                    lossSwitchBarrier: def.rightLossSwitch?.barrier,
                    baseStake: Number(cfg.stake),
                    currentStake: Number(cfg.stake),
                    martingale: Number(cfg.martingale),
                };

                setScanState({ open: false, key: null });
                setStatus(`${def.title} started on ${market}`, 'success');

                if (cfg.mode === 'left') {
                    scheduleLane(leftRuntimeId, 'start');
                } else if (cfg.mode === 'right') {
                    scheduleLane(rightRuntimeId, 'start');
                } else {
                    scheduleLane(leftRuntimeId, 'start');
                    scheduleLane(rightRuntimeId, 'start');
                }
            }, START_SCAN_MS);
        },
        [cardConfigs, ensureApiReady, scheduleLane, setStatus, upsertModuleSnapshot]
    );

    const globalStats = useMemo(() => {
        const completed = trades.filter(t => t.status === 'won' || t.status === 'lost');
        return {
            total: completed.length,
            won: completed.filter(t => t.status === 'won').length,
            lost: completed.filter(t => t.status === 'lost').length,
            totalPL: trades.reduce((sum, t) => sum + (t.profit ?? 0), 0),
        };
    }, [trades]);

    useEffect(() => {
        const hasRunning = runningModules.length > 0;
        const tpActive = isNum(combinedTakeProfit) && combinedTakeProfit > 0;
        const slActive = isNum(combinedStopLoss) && combinedStopLoss > 0;

        if (!hasRunning) {
            combinedLimitsTriggeredRef.current = false;
            return;
        }

        if (combinedLimitsTriggeredRef.current) return;

        if (tpActive && globalStats.totalPL >= combinedTakeProfit) {
            combinedLimitsTriggeredRef.current = true;
            stopAllModules(`Combined take profit hit at +${globalStats.totalPL.toFixed(2)}`);
            return;
        }

        if (slActive && globalStats.totalPL <= -combinedStopLoss) {
            combinedLimitsTriggeredRef.current = true;
            stopAllModules(`Combined stop loss hit at ${globalStats.totalPL.toFixed(2)}`);
        }
    }, [combinedStopLoss, combinedTakeProfit, globalStats.totalPL, runningModules.length, stopAllModules]);

    const runningPanels = useMemo(() => {
        return moduleSnapshots.map(module => {
            const moduleTrades = trades.filter(t => t.moduleId === module.id);
            const completed = moduleTrades.filter(t => t.status === 'won' || t.status === 'lost');
            const pl = moduleTrades.reduce((sum, t) => sum + (t.profit ?? 0), 0);

            return {
                module,
                trades: moduleTrades,
                totalPL: pl,
                total: completed.length,
                won: completed.filter(t => t.status === 'won').length,
                lost: completed.filter(t => t.status === 'lost').length,
            };
        });
    }, [moduleSnapshots, trades]);

    const selectedDef = moduleByKey(selectedModuleKey);

    const renderStrategyForm = (def: ModuleDefinition) => {
        const cfg = cardConfigs[def.key];
        const running = runningModules.find(mod => mod.key === def.key);
        const disabledByLimit = !running && runningModules.length >= MAX_ACTIVE_MODULES;

        return (
            <>
                <div className="strategy-detail-card__fields">
                    <div className="trade-control-group strategy-field multi-mode-lane-ui" aria-hidden="true">
                        <label>Mode</label>
                        <div className="strategy-detail-card__segment">
                            <button
                                type="button"
                                className={`mini-btn ${cfg.mode === 'left' ? 'active' : ''}`}
                                onClick={() => updateCardConfig(def.key, 'mode', 'left')}
                            >
                                {def.leftLabel}
                            </button>
                            <button
                                type="button"
                                className={`mini-btn ${cfg.mode === 'right' ? 'active' : ''}`}
                                onClick={() => updateCardConfig(def.key, 'mode', 'right')}
                            >
                                {def.rightLabel}
                            </button>
                            <button
                                type="button"
                                className={`mini-btn ${cfg.mode === 'both' ? 'active' : ''}`}
                                onClick={() => updateCardConfig(def.key, 'mode', 'both')}
                            >
                                Both
                            </button>
                        </div>
                    </div>

                    <div className="strategy-detail-card__row">
                        <div className="trade-control-group strategy-field">
                            <label>Stake</label>
                            <input
                                type="number"
                                className="trade-input"
                                min={0.35}
                                step={0.01}
                                value={cfg.stake === '' ? '' : String(cfg.stake)}
                                onChange={e =>
                                    updateCardConfig(def.key, 'stake', e.target.value === '' ? '' : Number(e.target.value))
                                }
                            />
                        </div>
                        <div className="trade-control-group strategy-field">
                            <label>Martingale</label>
                            <input
                                type="number"
                                className="trade-input"
                                min={1}
                                step={0.01}
                                value={cfg.martingale === '' ? '' : String(cfg.martingale)}
                                onChange={e =>
                                    updateCardConfig(
                                        def.key,
                                        'martingale',
                                        e.target.value === '' ? '' : Math.max(1, Number(e.target.value))
                                    )
                                }
                            />
                        </div>
                        <div className="trade-control-group strategy-field">
                            <label>Ticks</label>
                            <input
                                type="number"
                                className="trade-input"
                                min={1}
                                step={1}
                                value={cfg.ticks === '' ? '' : String(cfg.ticks)}
                                onChange={e =>
                                    updateCardConfig(def.key, 'ticks', e.target.value === '' ? '' : Math.max(1, Number(e.target.value)))
                                }
                            />
                        </div>
                    </div>

                    <div className="strategy-detail-card__tp-sl">
                        <span className="strategy-detail-card__tp-sl-title">Combined TP / SL</span>
                        <div className="strategy-detail-card__tp-sl-fields">
                            <label htmlFor="multi-combined-tp">TP</label>
                            <input
                                id="multi-combined-tp"
                                type="number"
                                className="trade-input trade-input--compact"
                                min={0}
                                step={0.01}
                                placeholder="20"
                                value={combinedTakeProfit === '' ? '' : String(combinedTakeProfit)}
                                onChange={e =>
                                    setCombinedTakeProfit(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))
                                }
                            />
                            <label htmlFor="multi-combined-sl">SL</label>
                            <input
                                id="multi-combined-sl"
                                type="number"
                                className="trade-input trade-input--compact"
                                min={0}
                                step={0.01}
                                placeholder="10"
                                value={combinedStopLoss === '' ? '' : String(combinedStopLoss)}
                                onChange={e =>
                                    setCombinedStopLoss(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))
                                }
                            />
                        </div>
                    </div>

                    {def.needsBarrier && (
                        <div className="strategy-detail-card__row">
                            <div className="trade-control-group strategy-field">
                                <label>{def.leftLabel} digit</label>
                                <input
                                    type="number"
                                    className="trade-input"
                                    min={0}
                                    max={9}
                                    step={1}
                                    value={cfg.leftBarrier === '' ? '' : String(cfg.leftBarrier)}
                                    onChange={e =>
                                        updateCardConfig(
                                            def.key,
                                            'leftBarrier',
                                            e.target.value === '' ? '' : Math.max(0, Math.min(9, Number(e.target.value)))
                                        )
                                    }
                                />
                            </div>
                            <div className="trade-control-group strategy-field">
                                <label>{def.rightLabel} digit</label>
                                <input
                                    type="number"
                                    className="trade-input"
                                    min={0}
                                    max={9}
                                    step={1}
                                    value={cfg.rightBarrier === '' ? '' : String(cfg.rightBarrier)}
                                    onChange={e =>
                                        updateCardConfig(
                                            def.key,
                                            'rightBarrier',
                                            e.target.value === '' ? '' : Math.max(0, Math.min(9, Number(e.target.value)))
                                        )
                                    }
                                />
                            </div>
                        </div>
                    )}

                    {!def.needsBarrier &&
                        (typeof def.fixedLeftBarrier === 'number' || typeof def.fixedRightBarrier === 'number') && (
                            <div className="strategy-detail-card__readonly-grid">
                                <div className="strategy-readonly">
                                    <span className="strategy-readonly__label">{def.leftLabel} base</span>
                                    <span className="strategy-readonly__value">
                                        {def.leftStrategy.toUpperCase()}
                                        {typeof def.fixedLeftBarrier === 'number' ? ` ${def.fixedLeftBarrier}` : ''}
                                    </span>
                                </div>
                                <div className="strategy-readonly">
                                    <span className="strategy-readonly__label">After loss</span>
                                    <span className="strategy-readonly__value">
                                        {(def.rightLossSwitch?.strategy || def.leftLossSwitch?.strategy || def.rightStrategy).toUpperCase()}
                                        {typeof (def.rightLossSwitch?.barrier ?? def.leftLossSwitch?.barrier) === 'number'
                                            ? ` ${def.rightLossSwitch?.barrier ?? def.leftLossSwitch?.barrier}`
                                            : ''}
                                    </span>
                                </div>
                            </div>
                        )}
                </div>

                <div className="strategy-detail-card__footer">
                    {!running ? (
                        <button
                            type="button"
                            className="preset-run-btn strategy-detail-card__primary"
                            disabled={disabledByLimit || scanState.open}
                            onClick={() => void startModuleFromCard(def.key)}
                        >
                            <LegacyPlayFillIcon width={18} height={18} />
                            Start strategy
                        </button>
                    ) : (
                        <div className="strategy-detail-card__running">
                            <button type="button" className="mini-btn stop-btn" onClick={() => stopModule(running.id)}>
                                Stop
                            </button>
                            <div className="strategy-detail-card__running-meta">
                                <span>
                                    Market <b>{running.market}</b>
                                </span>
                                <span>
                                    L <b>{running.lastLeftResult || '—'}</b>
                                </span>
                                <span>
                                    R <b>{running.lastRightResult || '—'}</b>
                                </span>
                            </div>
                        </div>
                    )}
                    {disabledByLimit && !running && (
                        <p className="strategy-detail-card__limit-note">
                            Two strategies can run at once. Stop one to start another.
                        </p>
                    )}
                </div>
            </>
        );
    };

    return (
        <div className="flipb">
            <header className="multi-page-header">
                <div className="multi-page-header__title">
                    <TradeTypesDigitsDiffersIcon width={22} height={22} aria-hidden />
                    <div>
                        <h1 className="multi-page-header__heading">Multi-strategy runner</h1>
                        <p className="multi-page-header__sub">Start any two strategies at once!</p>
                    </div>
                </div>
            </header>

            <div className="multi-shell">
                <div className="strategy-nav-wrap">
                    <h2 className="strategy-rail-heading">Choose &amp; start any 2 strategies</h2>
                    <div className="strategy-nav-scroll-clip">
                        <nav ref={strategyNavRef} className="strategy-nav" aria-label="Strategies">
                            {MODULES.map(def => {
                                const running = runningModules.find(mod => mod.key === def.key);
                                const atCapacity = !running && runningModules.length >= MAX_ACTIVE_MODULES;
                                const selected = def.key === selectedModuleKey;

                                return (
                                    <button
                                        key={def.key}
                                        type="button"
                                        aria-current={selected ? 'true' : undefined}
                                        className={`strategy-nav__item ${selected ? 'strategy-nav__item--selected' : ''} ${running ? 'strategy-nav__item--running' : ''} ${atCapacity ? 'strategy-nav__item--muted' : ''}`}
                                        onClick={() => setSelectedModuleKey(def.key)}
                                    >
                                        <span className="strategy-nav__icon">{def.icon}</span>
                                        <span className="strategy-nav__text">
                                            <span className="strategy-nav__title">{def.title}</span>
                                            <span className="strategy-nav__hint">{moduleNavHint(def)}</span>
                                        </span>
                                        {running && <span className="strategy-nav__dot" aria-hidden />}
                                    </button>
                                );
                            })}
                        </nav>
                        <button
                            type="button"
                            className={`strategy-nav-glass strategy-nav-glass--prev ${strategyNavEdges.prev ? 'strategy-nav-glass--visible' : ''}`}
                            aria-label="Scroll strategies left"
                            tabIndex={strategyNavEdges.prev ? 0 : -1}
                            onClick={() => scrollStrategyNav(-1)}
                        >
                            <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 6l-6 6 6 6" />
                            </svg>
                        </button>
                        <button
                            type="button"
                            className={`strategy-nav-glass strategy-nav-glass--next ${strategyNavEdges.next ? 'strategy-nav-glass--visible' : ''}`}
                            aria-label="Scroll strategies right"
                            tabIndex={strategyNavEdges.next ? 0 : -1}
                            onClick={() => scrollStrategyNav(1)}
                        >
                            <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M10 6l6 6-6 6" />
                            </svg>
                        </button>
                    </div>
                </div>

                <section className="strategy-detail" aria-live="polite">
                    <div className="strategy-detail-card">
                        <div className="strategy-detail-card__head">
                            <div className="strategy-detail-card__icon-wrap">{selectedDef.icon}</div>
                            <div>
                                <h2 className="strategy-detail-card__title">{selectedDef.title}</h2>
                                <p className="strategy-detail-card__lede">{moduleNavHint(selectedDef)}</p>
                            </div>
                        </div>

                        {renderStrategyForm(selectedDef)}
                    </div>

                </section>
            </div>

            {scanState.open && (
                <div className="preset-module-overlay">
                    <div className="preset-module preset-module--scan">
                        <div className="scan-progress">
                            <div className="scan-progress__bar" />
                        </div>
                        <h3>Analysing best market</h3>
                        <p>
                            Checking the best 1s market for <b>{scanState.key ? moduleByKey(scanState.key).title : 'module'}</b>.
                        </p>
                    </div>
                </div>
            )}

            <div className="performance-stats performance-stats--compact">
                <div className="stat-item">
                    <div className="stat-title">Combined P/L</div>
                    <div className={`stat-value ${globalStats.totalPL >= 0 ? 'profit' : 'loss'}`}>
                        {globalStats.totalPL >= 0 ? '+' : ''}
                        {globalStats.totalPL.toFixed(2)}
                    </div>
                </div>

                <div className="stat-item">
                    <div className="stat-title">Settled</div>
                    <div className="stat-value">{globalStats.total}</div>
                </div>

                <div className="stat-item">
                    <div className="stat-title">Won</div>
                    <div className="stat-value profit">{globalStats.won}</div>
                </div>

                <div className="stat-item">
                    <div className="stat-title">Lost</div>
                    <div className="stat-value loss">{globalStats.lost}</div>
                </div>

                <button type="button" className="performance-stats__reset" onClick={resetAll}>
                    Reset
                </button>
            </div>

            <div className="module-panels">
                {runningPanels.length === 0 ? (
                    <div className="trading-container">
                        <div className="no-positions">
                            <small>No strategies running</small>
                        </div>
                    </div>
                ) : (
                    runningPanels.map(panel => (
                        <div key={panel.module.id} className="trading-container module-panel">
                            <div className="module-panel__header">
                                <div className="module-panel__title">
                                    <span>{panel.module.title}</span>
                                    <span className="module-panel__market">{panel.module.market}</span>
                                    <span className="module-panel__mode">{panel.module.mode.toUpperCase()}</span>
                                    <span
                                        style={{
                                            marginLeft: 8,
                                            fontSize: 11,
                                            padding: '2px 8px',
                                            borderRadius: 999,
                                            background: panel.module.active ? '#e7f9ed' : '#f1f1f1',
                                            color: panel.module.active ? '#127a37' : '#666',
                                        }}
                                    >
                                        {panel.module.active ? 'RUNNING' : 'STOPPED'}
                                    </span>
                                </div>

                                <div
                                    className="module-panel__stats"
                                    style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
                                >
                                    <small>
                                        P/L:{' '}
                                        <b>
                                            {panel.totalPL >= 0 ? '+' : ''}
                                            {panel.totalPL.toFixed(2)}
                                        </b>
                                    </small>
                                    <small>
                                        Won: <b>{panel.won}</b>
                                    </small>
                                    <small>
                                        Lost: <b>{panel.lost}</b>
                                    </small>
                                    <small>
                                        MG: <b>{panel.module.martingale.toFixed(2)}</b>
                                    </small>

                                    {panel.module.active && (
                                        <button
                                            type="button"
                                            className="mini-btn stop-btn"
                                            onClick={() => stopModule(panel.module.id)}
                                        >
                                            Stop
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        className="mini-btn reset-btn"
                                        onClick={() => clearSinglePanel(panel.module.id)}
                                    >
                                        Clear
                                    </button>
                                </div>
                            </div>

                            <div className="title">
                                <small>Type | Market</small>
                                <small>Entry | Exit spot</small>
                                <small>Buy price & P/L</small>
                            </div>

                            <div className="open-positions">
                                {panel.trades.length === 0 ? (
                                    <div className="no-positions">
                                        <small>No positions</small>
                                    </div>
                                ) : (
                                    panel.trades.map(tr => (
                                        <div
                                            key={tr.id}
                                            className={`position-item ${
                                                tr.status === 'won'
                                                    ? 'position-win'
                                                    : tr.status === 'lost' || tr.status === 'error'
                                                      ? 'position-loss'
                                                      : 'position-open'
                                            }`}
                                        >
                                            <div className="position-header">
                                                <div className="position-market-contract" style={{ flexWrap: 'wrap' }}>
                                                    <span style={{ fontSize: 11, opacity: 0.8 }}>
                                                        {tr.lane === 'left' ? 'LEFT' : 'RIGHT'}
                                                    </span>
                                                    {marketIcons[tr.market] || <span>{tr.market}</span>}
                                                    {contractIcons[tr.contractType] || <span>{tr.contractType}</span>}
                                                    <span style={{ fontSize: 11, opacity: 0.8 }}>{tr.strategyKey}</span>
                                                    {isDigitContract(tr.contractType) && tr.barrier !== undefined && (
                                                        <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.8 }}>d{tr.barrier}</span>
                                                    )}
                                                    <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.8 }}>{tr.market}</span>
                                                </div>

                                                {tr.status === 'error' && (
                                                    <div className="error-display">
                                                        <span className="error-badge" title={tr.errorDetails || 'Trade failed'}>
                                                            !
                                                        </span>
                                                        <span className="error-text">{tr.errorReason}</span>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="position-spots">
                                                <div className="spot-entry">
                                                    <EntrySpotIcon />
                                                    {formatTickValue(tr.entryValue, tr.marketFormat)}
                                                </div>
                                                <div className="spot-exit">
                                                    <ExitSpotIcon />
                                                    {formatTickValue(tr.exitValue, tr.marketFormat)}
                                                </div>
                                            </div>

                                            <div className="position-footer">
                                                <div className="position-stake">{tr.stake.toFixed(2)} USD</div>
                                                <div
                                                    className={`position-result ${
                                                        tr.status === 'pending'
                                                            ? 'pending'
                                                            : tr.status === 'error'
                                                              ? 'loss'
                                                              : tr.profit !== undefined
                                                                ? tr.profit >= 0
                                                                    ? 'profit'
                                                                    : 'loss'
                                                                : ''
                                                    }`}
                                                >
                                                    {tr.status === 'pending'
                                                        ? '...'
                                                        : tr.profit !== undefined
                                                          ? `${tr.profit >= 0 ? '+' : ''}${tr.profit.toFixed(2)}`
                                                          : '—'}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className={`trade-status trade-status--${msg.type}`}>
                {msg.txt ? <div className="trade-status__message">{msg.txt}</div> : null}
                <div className="trade-status__meta">
                    <span>
                        Session panels <b>{moduleSnapshots.length}</b>
                    </span>
                </div>
            </div>

            <button
                type="button"
                className="floating-stop-all"
                disabled={runningModules.length === 0}
                onClick={() => stopAllModules()}
                aria-label="Stop all strategies"
                title={runningModules.length === 0 ? 'No strategies running' : 'Stop all strategies'}
            >
                Stop All
            </button>
        </div>
    );
}