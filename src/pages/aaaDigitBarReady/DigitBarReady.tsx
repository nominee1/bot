import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useDerivVisualTickApi } from '@/hooks/useDerivVisualTickApi';
import { useStore } from '@/hooks/useStore';
import { botIframeLastDigitFromQuote } from '@/pages/accumulators/botIframeTickDigitFormat';
import { computeDigitFrequencyRanks } from '@/utils/digitFrequencyRank';
import {
  allBarRulesSatisfied,
  clampBarDigit,
  type BarCompare,
  type BarPositionRule,
} from '@/utils/digitBarPositionRules';
import { recoverDerivLiveTickStream } from '@/utils/derivTickStream';
import {
  MarketDerivedVolatility1001sIcon,
  MarketDerivedVolatility100Icon,
  MarketDerivedVolatility10Icon,
  MarketDerivedVolatility25Icon,
  MarketDerivedVolatility50Icon,
  MarketDerivedVolatility75Icon,
  MarketDerivedVolatility101sIcon,
  MarketDerivedVolatility251sIcon,
  MarketDerivedVolatility501sIcon,
  MarketDerivedVolatility751sIcon,
  MarketDerivedVolatility151sIcon,
  MarketDerivedVolatility301sIcon,
  MarketDerivedVolatility901sIcon,
} from '@deriv/quill-icons';
import { LegacyPlayFillIcon } from '@deriv/quill-icons';
import ReadyEngine from '../aaaReadyStrategy/ready';
import {
  clampOverContractDigit,
  clampUnderContractDigit,
  createReadyStrategyCards,
  presetUsesUpsDownsStrategies,
  READY_MARKET_OPTIONS,
  type DigitContractKind,
  type ReadyBuildOptions,
  type ReadyStrategyCard,
  type ReadyStrategyKey as DigitBarStrategyKey,
} from './readyStrategyPresets';
import {
  DEFAULT_EVEN_ODD_MIN_PCT,
  DIGIT_BAR_SCAN_SYMBOLS,
  EVEN_ODD_ANALYZE_TICKS,
  evenOddPercentagesFromCounts,
  pickBestEvenOddMarket,
  pickBestMarket,
  pickDominantEvenOddSide,
  scanMarketsForDigitBars,
  scanMarketsForEvenOdd,
  type EvenOddScanRow,
  type MarketScanRow,
} from './digitBarMarketScanner';
import { getDigitCircleBarClasses, getDigitCircleEvenOddClasses } from './digitBarCircleDisplay';
import {
  formatDigitContractLabel,
  getStrategyBarProfile,
  pickOverMarketAutoCandidate,
} from './strategyBarProfiles';
import { run_panel as RUN_PANEL_TAB } from '@/constants/run-panel';
import {
  registerAutoRunDisableHandler,
  startReadyFromExternal,
  stopReadyFromExternal,
  type AutoDigitContract,
  type AutoEvenOddSide,
} from './readyExternalController';
import '../aaaReadyStrategy/ready.scss';
import './digitBarReady.scss';

const AUTO_SCAN_INTERVAL_MS = 30_000;
const DEFAULT_MARKET = '1HZ10V';
const OVER_UNDER_HISTORY_TICKS = 1000;

const BAR_EMOJI = {
  green: '🟢',
  blue: '🔵',
  red: '🔴',
} as const;

function BarRuleEditor({
  emoji,
  label,
  rule,
  onChange,
}: {
  emoji: string;
  label: string;
  rule: BarPositionRule;
  onChange: (next: BarPositionRule) => void;
}) {
  return (
    <div className="digit-bar-ready__bar-rule">
      <div className="digit-bar-ready__bar-rule-head">
        <span>
          <span className="digit-bar-ready__bar-emoji" aria-hidden>
            {emoji}
          </span>
          {label}
        </span>
        <label>
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={e => onChange({ ...rule, enabled: e.target.checked })}
          />{' '}
          Use
        </label>
      </div>
      <div className="digit-bar-ready__bar-rule-row">
        <select
          className="trade-input"
          value={rule.compare}
          disabled={!rule.enabled}
          onChange={e => onChange({ ...rule, compare: e.target.value as BarCompare })}
        >
          <option value="below">below</option>
          <option value="above">above</option>
        </select>
        <input
          type="number"
          className="trade-input"
          min={0}
          max={9}
          disabled={!rule.enabled}
          value={rule.digit}
          onChange={e => onChange({ ...rule, digit: clampBarDigit(Number(e.target.value)) })}
        />
      </div>
    </div>
  );
}

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

const DigitBarReady = observer(() => {
  const { ready_strategy_panel, run_panel } = useStore();
  const { visualTickApi, visualTickReady } = useDerivVisualTickApi();

  const cards = useMemo(() => createReadyStrategyCards(), []);
  const [selectedKey, setSelectedKey] = useState<DigitBarStrategyKey | null>(cards[0]?.key ?? null);
  const [market, setMarket] = useState(DEFAULT_MARKET);
  const [contractKind, setContractKind] = useState<DigitContractKind>('over');
  const [contractBarrier, setContractBarrier] = useState<number | ''>(2);
  const [evenOddMinPct, setEvenOddMinPct] = useState<number | ''>(DEFAULT_EVEN_ODD_MIN_PCT);
  const [evenOddAnalyzeTicks, setEvenOddAnalyzeTicks] = useState<number | ''>(EVEN_ODD_ANALYZE_TICKS);
  const [greenRule, setGreenRule] = useState<BarPositionRule>({ enabled: true, compare: 'below', digit: 3 });
  const [redRule, setRedRule] = useState<BarPositionRule>({ enabled: true, compare: 'above', digit: 7 });
  const [blueRule, setBlueRule] = useState<BarPositionRule>({ enabled: false, compare: 'below', digit: 5 });
  const [stake, setStake] = useState<number | ''>(2);
  const [ticks, setTicks] = useState<number | ''>(1);
  const [martingale, setMartingale] = useState<number | ''>(1.25);
  const [takeProfit, setTakeProfit] = useState<number | ''>('');
  const [stopLoss, setStopLoss] = useState<number | ''>('');
  const [delayAfterSettle, setDelayAfterSettle] = useState(true);
  const [autoRun, setAutoRun] = useState(false);

  const [scanInProgress, setScanInProgress] = useState(false);
  const [scanMsg, setScanMsg] = useState('Scanning markets for Even or Odd at 65%+…');
  const [evenOddScanRows, setEvenOddScanRows] = useState<EvenOddScanRow[]>([]);
  const [barScanRows, setBarScanRows] = useState<MarketScanRow[]>([]);
  const [bestScanMarket, setBestScanMarket] = useState<string | null>(null);

  const [digitCounts, setDigitCounts] = useState<number[]>(() => Array(10).fill(0));
  const [historyReady, setHistoryReady] = useState(false);
  const [latestDigit, setLatestDigit] = useState<number | null>(null);
  const autoStartedRef = useRef(false);
  const autoStartIssuedRef = useRef(false);
  /** Sync gate so Stop disables auto-run before React re-renders (prevents immediate restart). */
  const autoRunEnabledRef = useRef(false);
  const wasRunningRef = useRef(false);
  const digitHistoryRef = useRef<number[]>([]);
  const scanGenRef = useRef(0);
  const scanInProgressRef = useRef(false);
  const isRunningRef = useRef(false);

  const isRunning = ready_strategy_panel.is_strategy_running;

  const selectedCard = useMemo(
    () => cards.find(c => c.key === selectedKey) ?? null,
    [cards, selectedKey],
  );

  const isEvenOddStrategy = selectedKey === 'even_to_odd_3_losses';
  const isMarketFlipStrategy = selectedKey === 'over_market_flip';

  const evenOddAnalyzeTicksN = useMemo(() => {
    if (typeof evenOddAnalyzeTicks !== 'number' || !Number.isFinite(evenOddAnalyzeTicks)) {
      return EVEN_ODD_ANALYZE_TICKS;
    }
    return Math.max(10, Math.min(5000, Math.floor(evenOddAnalyzeTicks)));
  }, [evenOddAnalyzeTicks]);

  const historyTickCount = isEvenOddStrategy ? evenOddAnalyzeTicksN : OVER_UNDER_HISTORY_TICKS;

  const contractBarrierN = useMemo(() => {
    if (typeof contractBarrier !== 'number') {
      return contractKind === 'over' ? 2 : 7;
    }
    return contractKind === 'over'
      ? clampOverContractDigit(contractBarrier)
      : clampUnderContractDigit(contractBarrier);
  }, [contractBarrier, contractKind]);

  const barBuildOptions = useMemo((): ReadyBuildOptions | undefined => {
    if (!isMarketFlipStrategy) return undefined;
    return { contractKind, contractBarrier: contractBarrierN };
  }, [contractBarrierN, contractKind, isMarketFlipStrategy]);

  const evenOddMinPctN = useMemo(() => {
    if (typeof evenOddMinPct !== 'number' || !Number.isFinite(evenOddMinPct)) return DEFAULT_EVEN_ODD_MIN_PCT;
    return Math.max(50, Math.min(99, evenOddMinPct));
  }, [evenOddMinPct]);

  const scanSymbols = useMemo(() => {
    if (!selectedCard) return [...DIGIT_BAR_SCAN_SYMBOLS];
    const preset = selectedCard.build(typeof stake === 'number' ? stake : 0.35);
    if (!presetUsesUpsDownsStrategies(preset)) return [...DIGIT_BAR_SCAN_SYMBOLS];
    return DIGIT_BAR_SCAN_SYMBOLS.filter(s => !s.startsWith('JD'));
  }, [selectedCard, stake]);

  const selectableMarkets = useMemo(() => {
    if (!selectedCard) return [...READY_MARKET_OPTIONS];
    const preset = selectedCard.build(typeof stake === 'number' ? stake : 0.35);
    if (!presetUsesUpsDownsStrategies(preset)) return [...READY_MARKET_OPTIONS];
    return READY_MARKET_OPTIONS.filter(o => !o.value.startsWith('JD'));
  }, [selectedCard, stake]);

  const ranks = useMemo(() => computeDigitFrequencyRanks(digitCounts), [digitCounts]);

  const evenOddPct = useMemo(() => evenOddPercentagesFromCounts(digitCounts), [digitCounts]);

  const liveDominantSide = useMemo(
    () => (historyReady && isEvenOddStrategy ? pickDominantEvenOddSide(evenOddPct, evenOddMinPctN) : null),
    [evenOddPct, evenOddMinPctN, historyReady, isEvenOddStrategy],
  );

  const autoRunCandidate = useMemo(() => {
    if (!historyReady || !isMarketFlipStrategy) return null;
    return pickOverMarketAutoCandidate({ most: ranks.most, least: ranks.least });
  }, [historyReady, isMarketFlipStrategy, ranks.least, ranks.most]);

  const rulesOk = useMemo(() => {
    if (!historyReady) return false;
    if (isEvenOddStrategy) return liveDominantSide != null;
    if (isMarketFlipStrategy) return autoRunCandidate != null;
    return allBarRulesSatisfied(
      { most: ranks.most, second: ranks.second, least: ranks.least },
      greenRule,
      redRule,
      blueRule,
    );
  }, [
    autoRunCandidate,
    blueRule,
    greenRule,
    historyReady,
    isEvenOddStrategy,
    liveDominantSide,
    ranks.least,
    ranks.most,
    ranks.second,
    redRule,
  ]);

  const autoRulesOk = useMemo(() => {
    if (!historyReady) return false;
    if (isMarketFlipStrategy) return autoRunCandidate != null;
    if (isEvenOddStrategy) return liveDominantSide != null;
    return false;
  }, [autoRunCandidate, historyReady, isEvenOddStrategy, isMarketFlipStrategy, liveDominantSide]);

  const applyBarProfile = useCallback(
    (card: ReadyStrategyCard, options?: ReadyBuildOptions) => {
      const profile = getStrategyBarProfile(card, options);
      setGreenRule(profile.green);
      setRedRule(profile.red);
      setBlueRule(profile.blue);
    },
    [],
  );

  const runStrategyScan = useCallback(
    async (card: ReadyStrategyCard) => {
      const tickApi = visualTickApi;
      if (!tickApi || tickApi.connection.readyState !== 1) {
        setScanMsg('Tick API not ready — waiting…');
        return;
      }

      const gen = ++scanGenRef.current;
      setScanInProgress(true);

      if (card.key === 'even_to_odd_3_losses') {
        setScanMsg(`Scanning ${scanSymbols.length} markets (${evenOddAnalyzeTicksN} ticks, ${evenOddMinPctN}%+)…`);
        try {
          const rows = await scanMarketsForEvenOdd(
            payload => tickApi.send(payload) as Promise<unknown>,
            scanSymbols,
            evenOddAnalyzeTicksN,
            evenOddMinPctN,
            (done, total) => {
              if (scanGenRef.current === gen) setScanMsg(`Scanned ${done}/${total} markets…`);
            },
          );
          if (scanGenRef.current !== gen) return;
          setEvenOddScanRows(rows);
          const best = pickBestEvenOddMarket(rows);
          if (best) {
            setBestScanMarket(best.symbol);
            if (!isRunningRef.current) setMarket(best.symbol);
            const side = best.dominantSide;
            setScanMsg(
              best.rulesPass && side
                ? `Best match: ${best.symbol} — ${side} ${side === 'even' ? best.evenPct.toFixed(1) : best.oddPct.toFixed(1)}%`
                : `Closest: ${best.symbol} (Even ${best.evenPct.toFixed(1)}%, Odd ${best.oddPct.toFixed(1)}%)`,
            );
          } else {
            setBestScanMarket(null);
            setScanMsg('No scan data — next automatic scan soon');
          }
        } catch {
          if (scanGenRef.current === gen) setScanMsg('Scan failed');
        } finally {
          if (scanGenRef.current === gen) setScanInProgress(false);
        }
        return;
      }

      const opts = card.key === 'over_market_flip' ? barBuildOptions : undefined;
      const profile = getStrategyBarProfile(card, opts);
      applyBarProfile(card, opts);
      setScanMsg(`Scanning ${scanSymbols.length} markets for ${card.title}…`);

      try {
        const rows = await scanMarketsForDigitBars(
          payload => tickApi.send(payload) as Promise<unknown>,
          scanSymbols,
          OVER_UNDER_HISTORY_TICKS,
          { green: profile.green, red: profile.red, blue: profile.blue },
          (done, total) => {
            if (scanGenRef.current === gen) setScanMsg(`Scanned ${done}/${total} markets…`);
          },
        );
        if (scanGenRef.current !== gen) return;
        setBarScanRows(rows);
        const best = pickBestMarket(rows);
        if (best) {
          setBestScanMarket(best.symbol);
          setMarket(best.symbol);
          setScanMsg(
            best.rulesPass
              ? `Best match: ${best.symbol} (most ${best.ranks.most}, least ${best.ranks.least})`
              : `Closest match: ${best.symbol} — live circles must confirm bar rules`,
          );
        } else {
          setBestScanMarket(null);
          setScanMsg('No scan data — next automatic scan soon');
        }
      } catch {
        if (scanGenRef.current === gen) setScanMsg('Scan failed');
      } finally {
        if (scanGenRef.current === gen) setScanInProgress(false);
      }
    },
    [applyBarProfile, barBuildOptions, evenOddAnalyzeTicksN, evenOddMinPctN, scanSymbols, visualTickApi],
  );

  const selectStrategy = useCallback(
    (card: ReadyStrategyCard) => {
      if (isRunning) return;
      setSelectedKey(card.key);
      void runStrategyScan(card);
    },
    [isRunning, runStrategyScan],
  );

  const startStrategy = useCallback(
    (key: DigitBarStrategyKey, options?: { fromAuto?: boolean }) => {
      if (isRunning) return;
      const card = cards.find(c => c.key === key);
      if (!card) return;

      if (selectedKey !== key) {
        selectStrategy(card);
        return;
      }

      const fromAuto = options?.fromAuto === true;
      if (fromAuto ? !autoRulesOk : !rulesOk) return;

      const stakeN = typeof stake === 'number' && stake > 0 ? stake : 0.35;
      const ticksN = typeof ticks === 'number' && ticks >= 1 ? ticks : 1;
      const martN = typeof martingale === 'number' && martingale >= 1 ? martingale : 1.25;

      const autoEvenOddSide: AutoEvenOddSide | undefined =
        key === 'even_to_odd_3_losses' && liveDominantSide ? liveDominantSide : undefined;
      const autoContract: AutoDigitContract | undefined =
        fromAuto && key === 'over_market_flip' && autoRunCandidate ? autoRunCandidate : undefined;

      if (fromAuto) autoStartIssuedRef.current = true;
      startReadyFromExternal({
        presetKey: key,
        market,
        stake: stakeN,
        ticks: ticksN,
        martingale: martN,
        takeProfit: typeof takeProfit === 'number' ? takeProfit : 0,
        stopLoss: typeof stopLoss === 'number' ? stopLoss : 0,
        delayAfterSettle,
        ...(key === 'over_market_flip' && !autoContract
          ? { contractKind, contractBarrier: contractBarrierN }
          : {}),
        ...(autoContract ? { autoContract } : {}),
        ...(autoEvenOddSide ? { autoEvenOddSide } : {}),
      });
    },
    [
      autoRunCandidate,
      autoRulesOk,
      cards,
      contractBarrierN,
      contractKind,
      delayAfterSettle,
      isRunning,
      liveDominantSide,
      market,
      martingale,
      rulesOk,
      selectStrategy,
      selectedKey,
      stake,
      stopLoss,
      takeProfit,
      ticks,
    ],
  );

  const disableAutoRun = useCallback(() => {
    autoRunEnabledRef.current = false;
    autoStartedRef.current = false;
    autoStartIssuedRef.current = false;
    setAutoRun(false);
  }, []);

  const handleStop = useCallback(() => {
    stopReadyFromExternal();
  }, []);

  useEffect(() => {
    registerAutoRunDisableHandler(disableAutoRun);
    return () => registerAutoRunDisableHandler(null);
  }, [disableAutoRun]);

  const tryAutoRun = useCallback(() => {
    if (
      !autoRunEnabledRef.current ||
      !autoRun ||
      !autoRulesOk ||
      !selectedKey ||
      isRunning ||
      autoStartedRef.current ||
      autoStartIssuedRef.current
    ) {
      return;
    }
    startStrategy(selectedKey, { fromAuto: true });
  }, [autoRun, autoRulesOk, isRunning, selectedKey, startStrategy]);

  useEffect(() => {
    if (!isRunning) return;
    if (autoStartIssuedRef.current) {
      autoStartIssuedRef.current = false;
      autoStartedRef.current = true;
    }
  }, [isRunning]);

  useEffect(() => {
    if (!autoRun || isRunning || !autoStartIssuedRef.current) return;
    const t = window.setTimeout(() => {
      if (!isRunningRef.current && autoStartIssuedRef.current) {
        autoStartIssuedRef.current = false;
      }
    }, 1000);
    return () => window.clearTimeout(t);
  }, [autoRun, isRunning, autoRulesOk, selectedKey]);

  useEffect(() => {
    autoRunEnabledRef.current = autoRun;
  }, [autoRun]);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning) disableAutoRun();
    wasRunningRef.current = isRunning;
  }, [disableAutoRun, isRunning]);

  useEffect(() => {
    tryAutoRun();
  }, [tryAutoRun]);

  useEffect(() => {
    ready_strategy_panel.attach();
    run_panel.setActiveTabIndex(RUN_PANEL_TAB.SUMMARY);
    return () => ready_strategy_panel.detach();
  }, [ready_strategy_panel, run_panel]);

  useEffect(() => {
    if (isRunning) run_panel.toggleDrawer(true);
  }, [isRunning, run_panel]);

  useEffect(() => {
    if (selectedCard && visualTickReady) {
      void runStrategyScan(selectedCard);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualTickReady, selectedCard?.key]);

  useEffect(() => {
    if (isEvenOddStrategy && selectedCard && visualTickReady) {
      void runStrategyScan(selectedCard);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evenOddAnalyzeTicksN, evenOddMinPctN, isEvenOddStrategy]);

  useEffect(() => {
    if (isMarketFlipStrategy && selectedCard) {
      applyBarProfile(selectedCard, barBuildOptions);
    }
  }, [applyBarProfile, barBuildOptions, contractBarrierN, contractKind, isMarketFlipStrategy, selectedCard]);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    scanInProgressRef.current = scanInProgress;
  }, [scanInProgress]);

  useEffect(() => {
    if (!selectedCard || !visualTickReady || isRunning) return;
    const id = window.setInterval(() => {
      if (!scanInProgressRef.current) void runStrategyScan(selectedCard);
    }, AUTO_SCAN_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [isRunning, runStrategyScan, selectedCard, visualTickReady]);

  useEffect(() => {
    if (!selectableMarkets.some(o => o.value === market)) {
      setMarket(selectableMarkets[0]?.value ?? DEFAULT_MARKET);
    }
  }, [selectableMarkets, market]);

  const pushDigit = useCallback((d: number) => {
    const buf = digitHistoryRef.current;
    buf.push(d);
    if (buf.length > historyTickCount) buf.shift();
    const counts = Array(10).fill(0);
    buf.forEach(digit => {
      counts[digit] += 1;
    });
    setDigitCounts(counts);
    setLatestDigit(d);
    setHistoryReady(buf.length > 0);
  }, [historyTickCount]);

  useEffect(() => {
    const tickApi = visualTickApi;
    if (!tickApi || !visualTickReady || tickApi.connection.readyState !== 1) return;

    let cancelled = false;
    setHistoryReady(false);
    setDigitCounts(Array(10).fill(0));
    digitHistoryRef.current = [];

    const applyHistory = (prices: number[]) => {
      if (cancelled) return;
      const buf: number[] = [];
      prices.forEach(q => {
        const d = botIframeLastDigitFromQuote(q, market);
        if (Number.isFinite(d)) buf.push(d);
      });
      digitHistoryRef.current = buf.slice(-historyTickCount);
      const counts = Array(10).fill(0);
      digitHistoryRef.current.forEach(d => {
        counts[d] += 1;
      });
      setDigitCounts(counts);
      setHistoryReady(digitHistoryRef.current.length > 0);
      const last = digitHistoryRef.current[digitHistoryRef.current.length - 1];
      if (last !== undefined) setLatestDigit(last);
    };

    const boot = async () => {
      try {
        const hist = await tickApi.send({
          ticks_history: market,
          style: 'ticks',
          count: historyTickCount,
          end: 'latest',
          subscribe: 0,
        });
        if (cancelled) return;
        const prices = (hist?.history?.prices ?? []).map(Number).filter((n: number) => Number.isFinite(n));
        if (prices.length) applyHistory(prices);
      } catch {
        if (!cancelled) setHistoryReady(false);
      }
      await recoverDerivLiveTickStream(tickApi, market);
    };

    void boot();

    const sub = tickApi.onMessage().subscribe(({ data }: { data?: Record<string, unknown> }) => {
      if (cancelled || !data || data.msg_type !== 'tick' || !data.tick) return;
      const tick = data.tick as { quote?: unknown; symbol?: string };
      const tickSym = tick.symbol ?? (data.echo_req as { ticks?: string })?.ticks;
      if (tickSym && tickSym !== market) return;
      const q = Number(tick.quote);
      if (!Number.isFinite(q)) return;
      const d = botIframeLastDigitFromQuote(q, market);
      if (Number.isFinite(d)) pushDigit(d);
    });

    return () => {
      cancelled = true;
      sub.unsubscribe();
    };
  }, [historyTickCount, visualTickApi, visualTickReady, market, pushDigit]);

  const R = 22;
  const C = 2 * Math.PI * R;
  const fullRingDash = `${C} ${C}`;

  const topEvenOddScanRows = evenOddScanRows.slice(0, 6);
  const topBarScanRows = barScanRows.slice(0, 6);
  const bestEvenOddRow = bestScanMarket
    ? evenOddScanRows.find(r => r.symbol === bestScanMarket)
    : null;
  const bestBarRow = bestScanMarket ? barScanRows.find(r => r.symbol === bestScanMarket) : null;

  const liveStatusMessage = useMemo(() => {
    if (isRunning) {
      return `Running: ${selectedCard?.title ?? 'strategy'} on ${market}`;
    }
    if (autoRun) {
      if (autoRulesOk) {
        if (isMarketFlipStrategy && autoRunCandidate) {
          return `Signals match ${formatDigitContractLabel(autoRunCandidate)} — starting auto trade…`;
        }
        if (isEvenOddStrategy && liveDominantSide) {
          const pct = liveDominantSide === 'even' ? evenOddPct.evenPct : evenOddPct.oddPct;
          return `${liveDominantSide === 'even' ? 'Even' : 'Odd'} at ${pct.toFixed(1)}% — starting auto trade…`;
        }
        return 'Signals match — starting auto trade…';
      }
      if (isMarketFlipStrategy) {
        return 'Auto run on — confirming positions of red bar and green bar';
      }
      return `Auto run on — waiting for Even or Odd at ${evenOddMinPctN}%+ (${evenOddAnalyzeTicksN} ticks)…`;
    }
    if (autoRulesOk) {
      if (isMarketFlipStrategy && autoRunCandidate) {
        return `Signals match ${formatDigitContractLabel(autoRunCandidate)} — use RUN or enable Auto run`;
      }
      if (isEvenOddStrategy && liveDominantSide) {
        const pct = liveDominantSide === 'even' ? evenOddPct.evenPct : evenOddPct.oddPct;
        return `${liveDominantSide === 'even' ? 'Even' : 'Odd'} at ${pct.toFixed(1)}% — use RUN or enable Auto run`;
      }
      return 'Signals match — use RUN or enable Auto run';
    }
    if (isMarketFlipStrategy) return 'Waiting for live green/red bar positions…';
    return `Waiting for Even or Odd at ${evenOddMinPctN}%+ on live ticks…`;
  }, [
    autoRun,
    autoRunCandidate,
    autoRulesOk,
    evenOddAnalyzeTicksN,
    evenOddMinPctN,
    evenOddPct.evenPct,
    evenOddPct.oddPct,
    isEvenOddStrategy,
    isMarketFlipStrategy,
    isRunning,
    liveDominantSide,
    market,
    selectedCard?.title,
  ]);

  const liveStatusTone = isRunning ? 'run' : autoRun ? (autoRulesOk ? 'ok' : 'armed') : autoRulesOk ? 'ok' : 'wait';

  return (
    <div className="flip digit-bar-ready">
      <header className="digit-bar-ready__header">
        <h1>Green Bar Red Bar auto trader</h1>
      
      </header>

      <div className="digit-bar-ready__layout">
        <aside className="digit-bar-ready__strategies ready-nav-wrap">
          <h2 className="ready-rail-heading">Strategies</h2>
          <div className="ready-nav-scroll-clip">
            <nav className="ready-strategy-nav" aria-label="Auto strategy list">
              {cards.map(card => {
                const selected = selectedKey === card.key;
                return (
                  <div
                    key={card.key}
                    className={`ready-strategy-nav__item ${selected ? 'ready-strategy-nav__item--selected' : ''}`}
                  >
                    <button
                      type="button"
                      className="digit-bar-ready__strategy-select"
                      disabled={isRunning}
                      onClick={() => selectStrategy(card)}
                    >
                      <span className="ready-strategy-nav__icon">{card.icon}</span>
                      <span className="ready-strategy-nav__text">
                        <span className="ready-strategy-nav__title">{card.title}</span>
                        <span className="ready-strategy-nav__hint">{card.description}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="digit-bar-ready__strategy-start"
                      title={`Start ${card.title}`}
                      disabled={isRunning || (selectedKey === card.key && !rulesOk)}
                      onClick={e => {
                        e.stopPropagation();
                        startStrategy(card.key);
                      }}
                    >
                      <LegacyPlayFillIcon width={16} height={16} />
                    </button>
                  </div>
                );
              })}
            </nav>
          </div>
        </aside>

        <section className="digit-bar-ready__center">
          <div className="digit-bar-ready__center-scroll">
          <div className="digit-bar-ready__scan-panel">
          <div
            className={`digit-bar-ready__status-pill digit-bar-ready__status-pill--top digit-bar-ready__status-pill--${liveStatusTone}`}
          >
            {liveStatusMessage}
          </div>
          <div className="digit-bar-ready__scanner digit-bar-ready__market-scan">
            <div className="digit-bar-ready__scanner-toolbar digit-bar-ready__scanner-toolbar--scan">
              <span
                className={`digit-bar-ready__rescan-status ${scanInProgress ? 'is-scanning' : ''}`}
                role="status"
                aria-live="polite"
              >
                {scanInProgress ? 'Scanning…' : 'Scan idle'}
              </span>
              <span className="digit-bar-ready__scan-status">{scanMsg}</span>
              <label className="digit-bar-ready__auto-run">
                <span className="digit-bar-ready__auto-run-label">Auto run</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoRun}
                  className={`digit-bar-ready__auto-run-toggle ${autoRun ? 'is-on' : ''}`}
                  disabled={isRunning}
                  onClick={() => {
                    setAutoRun(prev => {
                      const next = !prev;
                      autoRunEnabledRef.current = next;
                      if (!next) autoStartedRef.current = false;
                      return next;
                    });
                  }}
                />
              </label>
            </div>

            <div className="digit-bar-ready__scanner-market-row digit-bar-ready__scanner-market-row--first">
              <div className="digit-bar-ready__scanner-market-field">
                <label className="digit-bar-ready__scanner-market-label">Manual market</label>
                <select
                  className="trade-input digit-bar-ready__scanner-market-select"
                  value={market}
                  disabled={isRunning}
                  onChange={e => setMarket(e.target.value)}
                >
                  {selectableMarkets.map(o => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {isEvenOddStrategy ? (
                <>
                  <div className="digit-bar-ready__scanner-contract-field">
                    <label className="digit-bar-ready__scanner-market-label">Analyze ticks</label>
                    <input
                      type="number"
                      className="trade-input digit-bar-ready__scanner-contract-input"
                      min={10}
                      max={5000}
                      step={1}
                      disabled={isRunning}
                      value={evenOddAnalyzeTicks === '' ? '' : String(evenOddAnalyzeTicks)}
                      onChange={e => {
                        const raw = e.target.value;
                        if (raw === '') {
                          setEvenOddAnalyzeTicks('');
                          return;
                        }
                        setEvenOddAnalyzeTicks(Math.max(10, Math.min(5000, Math.floor(Number(raw)))));
                      }}
                    />
                  </div>
                  <div className="digit-bar-ready__scanner-contract-field">
                    <label className="digit-bar-ready__scanner-market-label">Min % (Even or Odd)</label>
                    <input
                      type="number"
                      className="trade-input digit-bar-ready__scanner-contract-input"
                      min={50}
                      max={99}
                      step={1}
                      disabled={isRunning}
                      value={evenOddMinPct === '' ? '' : String(evenOddMinPct)}
                      onChange={e => {
                        const raw = e.target.value;
                        if (raw === '') {
                          setEvenOddMinPct('');
                          return;
                        }
                        setEvenOddMinPct(Math.max(50, Math.min(99, Math.floor(Number(raw)))));
                      }}
                    />
                  </div>
                </>
              ) : null}
              {isMarketFlipStrategy ? (
                <div className="digit-bar-ready__scanner-contract-field">
                  <label className="digit-bar-ready__scanner-market-label">Prediction</label>
                  <div className="digit-bar-ready__scanner-contract-row">
                    <select
                      className="trade-input digit-bar-ready__scanner-contract-type"
                      value={contractKind}
                      disabled={isRunning}
                      onChange={e => {
                        const kind = e.target.value as DigitContractKind;
                        setContractKind(kind);
                        setContractBarrier(kind === 'over' ? 2 : 7);
                      }}
                    >
                      <option value="over">Over</option>
                      <option value="under">Under</option>
                    </select>
                    <input
                      type="number"
                      className="trade-input digit-bar-ready__scanner-contract-input"
                      min={contractKind === 'over' ? 0 : 1}
                      max={contractKind === 'over' ? 8 : 9}
                      step={1}
                      disabled={isRunning}
                      value={contractBarrier === '' ? '' : String(contractBarrier)}
                      onChange={e => {
                        const raw = e.target.value;
                        if (raw === '') {
                          setContractBarrier('');
                          return;
                        }
                        const n = Number(raw);
                        setContractBarrier(
                          contractKind === 'over' ? clampOverContractDigit(n) : clampUnderContractDigit(n),
                        );
                      }}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {isMarketFlipStrategy ? (
              <div className="digit-bar-ready__scanner-bar-section">
                <h4 className="digit-bar-ready__scanner-bar-title">Green bar red bar position</h4>
                <div className="digit-bar-ready__scanner-bar-rules">
                  <BarRuleEditor
                    emoji={BAR_EMOJI.green}
                    label="Green Bar"
                    rule={greenRule}
                    onChange={r => setGreenRule(r)}
                  />
                  <BarRuleEditor
                    emoji={BAR_EMOJI.blue}
                    label="2nd most appearing"
                    rule={blueRule}
                    onChange={r => setBlueRule(r)}
                  />
                  <BarRuleEditor
                    emoji={BAR_EMOJI.red}
                    label="Red Bar"
                    rule={redRule}
                    onChange={r => setRedRule(r)}
                  />
                </div>
              </div>
            ) : null}

            {bestScanMarket ? (
              <div className="digit-bar-ready__best-market">
                Recommended market: <strong>{bestScanMarket}</strong>
                {isEvenOddStrategy && bestEvenOddRow?.rulesPass && bestEvenOddRow.dominantSide ? (
                  <span className="digit-bar-ready__match-badge">
                    {bestEvenOddRow.dominantSide === 'even' ? 'Even' : 'Odd'} at{' '}
                    {bestEvenOddRow.dominantSide === 'even'
                      ? bestEvenOddRow.evenPct.toFixed(1)
                      : bestEvenOddRow.oddPct.toFixed(1)}
                    %
                  </span>
                ) : isMarketFlipStrategy && bestBarRow?.rulesPass ? (
                  <span className="digit-bar-ready__match-badge">Rules pass on scan</span>
                ) : (
                  <span className="digit-bar-ready__match-badge digit-bar-ready__match-badge--weak">Closest only</span>
                )}
              </div>
            ) : null}

            <div className="digit-bar-ready__scanner-results">
              {isEvenOddStrategy ? (
                topEvenOddScanRows.length === 0 ? (
                  <div className="digit-bar-ready__scanner-empty">{scanInProgress ? 'Scanning…' : 'No results yet'}</div>
                ) : (
                  topEvenOddScanRows.map(row => (
                    <div
                      key={row.symbol}
                      className={`digit-bar-ready__scanner-row ${row.rulesPass ? 'digit-bar-ready__scanner-row--pass' : ''}`}
                    >
                      <span className="digit-bar-ready__scanner-row-market">
                        {marketIcons[row.symbol] ?? null}
                        {row.symbol}
                        <span className={`vol-badge vol-${row.volLabel}`}>{row.volLabel}</span>
                      </span>
                      <span className="digit-bar-ready__scanner-row-digits">
                        Even {row.evenPct.toFixed(1)}% · Odd {row.oddPct.toFixed(1)}%
                        {row.rulesPass && row.dominantSide ? ` · ${row.dominantSide} ✓` : ''}
                      </span>
                    </div>
                  ))
                )
              ) : topBarScanRows.length === 0 ? (
                <div className="digit-bar-ready__scanner-empty">{scanInProgress ? 'Scanning…' : 'No results yet'}</div>
              ) : (
                topBarScanRows.map(row => (
                  <div
                    key={row.symbol}
                    className={`digit-bar-ready__scanner-row ${row.rulesPass ? 'digit-bar-ready__scanner-row--pass' : ''}`}
                  >
                    <span className="digit-bar-ready__scanner-row-market">
                      {marketIcons[row.symbol] ?? null}
                      {row.symbol}
                      <span className={`vol-badge vol-${row.volLabel}`}>{row.volLabel}</span>
                    </span>
                    <span className="digit-bar-ready__scanner-row-digits">
                      <span aria-hidden>{BAR_EMOJI.green}</span>
                      {row.ranks.most ?? '—'}
                      <span aria-hidden>{BAR_EMOJI.red}</span>
                      {row.ranks.least ?? '—'}
                      {row.rulesPass ? ' ✓' : ''}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
          </div>

          <div className="digit-bar-ready__live-panel">
          <div className="digit-bar-ready__scanner digit-bar-ready__scanner--live">
          <div className="digit-bar-ready__rank-legend">
            <span>
              Market: <b>{market}</b>
            </span>
            {isEvenOddStrategy ? (
              <>
                <span>
                  Even: <b>{historyReady ? `${evenOddPct.evenPct.toFixed(1)}%` : '—'}</b>
                </span>
                <span>
                  Odd: <b>{historyReady ? `${evenOddPct.oddPct.toFixed(1)}%` : '—'}</b>
                </span>
                <span>
                  Signal:{' '}
                  <b>
                    {liveDominantSide
                      ? `${liveDominantSide === 'even' ? 'Even' : 'Odd'} (${liveDominantSide === 'even' ? evenOddPct.evenPct.toFixed(1) : evenOddPct.oddPct.toFixed(1)}%)`
                      : '—'}
                  </b>
                </span>
              </>
            ) : (
              <>
                <span>
                  <span aria-hidden>{BAR_EMOJI.green}</span> Most: <b>{ranks.most ?? '—'}</b>
                </span>
                <span>
                  <span aria-hidden>{BAR_EMOJI.blue}</span> 2nd: <b>{ranks.second ?? '—'}</b>
                </span>
                <span>
                  <span aria-hidden>{BAR_EMOJI.red}</span> Least: <b>{ranks.least ?? '—'}</b>
                </span>
              </>
            )}
            <span>
              Latest: <b>{latestDigit ?? '—'}</b>
            </span>
          </div>

          <div
            className={[
              'digits-container',
              historyReady ? '' : 'digits-container--loading',
              isMarketFlipStrategy && historyReady ? 'digits-container--ou-barrier' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="digits">
              {ranks.ranked.map(({ digit, pct, rank, count }) => {
                const rankClass =
                  rank === 1
                    ? 'progress__value--rank-1'
                    : rank === 2
                      ? 'progress__value--rank-2'
                      : rank === 3
                        ? 'progress__value--rank-3'
                        : rank === 4
                          ? 'progress__value--rank-last'
                          : '';
                const digitClasses = isEvenOddStrategy
                  ? getDigitCircleEvenOddClasses({
                      digit,
                      latestDigit,
                      historyReady,
                      dominantEvenOddSide: liveDominantSide,
                    })
                  : getDigitCircleBarClasses({
                      digit,
                      ranks,
                      greenRule,
                      redRule,
                      blueRule,
                      latestDigit,
                      historyReady,
                      isMarketFlipStrategy,
                      contractKind,
                      contractBarrier: contractBarrierN,
                    });
                const title = historyReady
                  ? isEvenOddStrategy
                    ? `${digit}: ${count} (${pct.toFixed(1)}%)${digit % 2 === 0 ? ' · even' : ' · odd'}`
                    : `${digit}: ${count} (${pct.toFixed(1)}%)${rank === 1 ? ' · green bar (most)' : ''}${rank === 4 ? ' · red bar (least)' : ''}`
                  : `Digit ${digit}`;
                return (
                  <div key={digit} className={digitClasses.join(' ')} title={title}>
                    <div className="digits__pie-container">
                      <svg className="digits__pie-progress" viewBox="0 0 56 56" aria-hidden>
                        <circle className="progress__bg" cx="28" cy="28" r={R} />
                        <circle
                          className={['progress__value', rankClass].filter(Boolean).join(' ')}
                          cx="28"
                          cy="28"
                          r={R}
                          strokeDasharray={fullRingDash}
                          strokeDashoffset="0"
                        />
                      </svg>
                      <div className="digits__digit-value">
                        <span className="digits__digit-display-value">{digit}</span>
                        <span className="digits__digit-display-percentage">
                          {historyReady ? `${pct.toFixed(1)}%` : '…'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
          </div>
          </div>
          </div>
        </section>

        <aside className="digit-bar-ready__settings">
          <h2 className="digit-bar-ready__settings-title">Trade settings</h2>
          <div className="digit-bar-ready__column-scroll">
            <div className="digit-bar-ready__run-actions digit-bar-ready__run-actions--top">
              <button
                type="button"
                className="preset-run-btn"
                disabled={!selectedKey || !rulesOk || isRunning}
                onClick={() => selectedKey && startStrategy(selectedKey)}
              >
                RUN
              </button>
              <button type="button" className="preset-back-btn" disabled={!isRunning} onClick={handleStop}>
                Stop
              </button>
            </div>
            <div className="trade-control-group">
              <label>Stake</label>
              <input
                type="number"
                className="trade-input"
                min={0.01}
                step={0.01}
                disabled={isRunning}
                value={stake === '' ? '' : String(stake)}
                onChange={e => setStake(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </div>

            <div className="trade-control-group">
              <label>Duration (ticks)</label>
              <input
                type="number"
                className="trade-input"
                min={1}
                disabled={isRunning}
                value={ticks === '' ? '' : String(ticks)}
                onChange={e => setTicks(e.target.value === '' ? '' : Math.max(1, Math.floor(Number(e.target.value))))}
              />
            </div>

            <div className="trade-control-group">
              <label>Martingale ×</label>
              <input
                type="number"
                className="trade-input"
                min={1}
                step={0.01}
                disabled={isRunning}
                value={martingale === '' ? '' : String(martingale)}
                onChange={e => setMartingale(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </div>

            <div className="trade-control-group">
              <label>Take profit ($)</label>
              <input
                type="number"
                className="trade-input"
                min={0}
                step={0.01}
                disabled={isRunning}
                value={takeProfit === '' ? '' : String(takeProfit)}
                onChange={e => setTakeProfit(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
              />
            </div>

            <div className="trade-control-group">
              <label>Stop loss ($)</label>
              <input
                type="number"
                className="trade-input"
                min={0}
                step={0.01}
                disabled={isRunning}
                value={stopLoss === '' ? '' : String(stopLoss)}
                onChange={e => setStopLoss(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
              />
            </div>
          </div>
        </aside>
      </div>

      <div className="digit-bar-ready__engine" aria-hidden>
        <ReadyEngine shellHidden />
      </div>
    </div>
  );
});

export default DigitBarReady;
