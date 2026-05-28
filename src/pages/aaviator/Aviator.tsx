import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AreaSeries,
  createChart,
  CrosshairMode,
  type IChartApi,
  LastPriceAnimationMode,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { ReactNode } from 'react';
import {
  applyDerivSessionMarketField,
  sendDerivSessionContractPurchase,
} from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import { api_base } from '@/external/bot-skeleton';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import {
  ALLOWED_BOT_IFRAME_LOGINID,
  applyCrShadowDeltaLocked,
  isCrVirtualShadowLogin,
  runWithCrShadowLock,
  tryDebitCrShadowSync,
} from '@/utils/crVirtualBalanceShadow';
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
} from '@deriv/quill-icons';
import { aviatorResolveDigitTickDecimals } from './aviatorTickDigitFormat';
import './Aviator.scss';

const LINE_CHART_MAX_POINTS = 2000;

/** Aviator-only key so this page defaults to light; Manual Trader theme does not carry over. */
const AVIATOR_UI_THEME_KEY = 'aviator-ui-theme';

type UiTheme = 'light' | 'dark';

function IconSun({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function IconMoon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

type LinePoint = { t: number; v: number };

/** Barrier band covers this fraction of the *visible* chart width (from the right edge). */
const BARRIER_VIEWPORT_RATIO = 0.25;

/**
 * Keeps the latest tick this far from the chart’s right edge (price scale), as a fraction of plot width.
 * Implemented via `timeScale.rightOffset` (bars × barSpacing ≈ gap in px).
 */
const AVIATOR_LAST_TICK_RIGHT_GAP_RATIO = 1 / 3;

function applyAviatorLastTickRightGap(chart: IChartApi) {
  const ts = chart.timeScale();
  const barSpacing = ts.options().barSpacing;
  if (!(barSpacing > 0)) return;
  const plotW = ts.width();
  if (!(plotW > 0)) return;
  const bars = Math.max(0, Math.round((plotW * AVIATOR_LAST_TICK_RIGHT_GAP_RATIO) / barSpacing));
  if (ts.options().rightOffset === bars) return;
  ts.applyOptions({ rightOffset: bars });
}

function aviatorChartGrid(chartDark: boolean) {
  return chartDark
    ? {
        vertLines: { visible: true, color: 'rgba(148, 163, 184, 0.14)' },
        horzLines: { visible: true, color: 'rgba(148, 163, 184, 0.14)' },
      }
    : {
        vertLines: { visible: true, color: 'rgba(148, 163, 184, 0.38)' },
        horzLines: { visible: true, color: 'rgba(148, 163, 184, 0.38)' },
      };
}

function paintBarrierOverlay(params: {
  chart: IChartApi;
  series: { priceToCoordinate(price: number): number | null };
  svg: SVGSVGElement | null;
  stackEl: HTMLElement | null;
  points: LinePoint[];
  barrierPct: number;
  crashed: boolean;
  chartDark: boolean;
}) {
  const { chart, series, svg, stackEl, points, barrierPct, crashed, chartDark } = params;
  if (!svg || !stackEl || points.length === 0 || !(barrierPct > 0)) {
    if (svg) svg.replaceChildren();
    return;
  }

  const last = points[points.length - 1];
  const tEnd = last.t;
  const frac = barrierPct / 100;
  const top = last.v * (1 + frac);
  const bottom = last.v * (1 - frac);
  const mid = last.v;

  const ts = chart.timeScale();
  const xRight = ts.timeToCoordinate(tEnd as UTCTimestamp);
  const yTop = series.priceToCoordinate(top);
  const yBot = series.priceToCoordinate(bottom);
  const yMid = series.priceToCoordinate(mid);

  if (xRight === null || yTop === null || yBot === null || yMid === null) {
    svg.replaceChildren();
    return;
  }

  const lr = ts.getVisibleLogicalRange();
  let left: number;
  let right: number;
  if (lr !== null && lr.to > lr.from) {
    const visibleSpan = lr.to - lr.from;
    const barrierStartLogical = lr.to - visibleSpan * BARRIER_VIEWPORT_RATIO;
    const xLeft = ts.logicalToCoordinate(barrierStartLogical as never);
    if (xLeft !== null) {
      left = Math.min(xLeft, xRight);
      right = Math.max(xLeft, xRight);
    } else {
      left = Math.max(0, xRight - stackEl.clientWidth * BARRIER_VIEWPORT_RATIO);
      right = xRight;
    }
  } else {
    left = Math.max(0, xRight - stackEl.clientWidth * BARRIER_VIEWPORT_RATIO);
    right = xRight;
  }

  const w = stackEl.clientWidth;
  const h = stackEl.clientHeight;
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  left = Math.max(0, left);
  right = Math.min(w, Math.max(right, left + 1));
  const topPx = Math.min(yTop, yBot);
  const botPx = Math.max(yTop, yBot);

  const strokeMain = crashed
    ? chartDark
      ? '#f87171'
      : '#dc2626'
    : chartDark
      ? '#38bdf8'
      : '#2563eb';
  const fillBand = crashed
    ? chartDark
      ? 'rgba(248, 113, 113, 0.14)'
      : 'rgba(220, 38, 38, 0.12)'
    : chartDark
      ? 'rgba(56, 189, 248, 0.12)'
      : 'rgba(37, 99, 235, 0.12)';

  svg.replaceChildren();

  const ns = 'http://www.w3.org/2000/svg';

  const rect = document.createElementNS(ns, 'rect');
  rect.setAttribute('x', String(left));
  rect.setAttribute('y', String(topPx));
  rect.setAttribute('width', String(Math.max(1, right - left)));
  rect.setAttribute('height', String(Math.max(0, botPx - topPx)));
  rect.setAttribute('fill', fillBand);
  svg.appendChild(rect);

  const mkLine = (y: number, dashed: boolean) => {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', String(left));
    line.setAttribute('x2', String(right));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', strokeMain);
    line.setAttribute('stroke-width', dashed ? '1.5' : '2');
    if (dashed) line.setAttribute('stroke-dasharray', '5 5');
    svg.appendChild(line);
  };

  mkLine(topPx, false);
  mkLine(botPx, false);
  mkLine(yMid, true);
}

/** Fixed stroke like reference screenshots; not direction-colored (crash still turns red). */
const AVIATOR_PRICE_LINE_STROKE = {
  light: '#383838',
  dark: '#94a3b8',
} as const;

/** Light theme area fill matches Deriv-style neutral gray under the stroke (see reference screenshots). */
function aviatorPriceSeriesOptions(chartDark: boolean, crashed: boolean, lineColor: string) {
  if (chartDark) {
    const stroke = crashed ? '#f87171' : lineColor;
    return {
      lineColor: stroke,
      topColor: crashed ? 'rgba(248, 113, 113, 0.22)' : 'rgba(148, 163, 184, 0.2)',
      bottomColor: crashed ? 'rgba(248, 113, 113, 0.05)' : 'rgba(100, 116, 139, 0.07)',
      lineWidth: 2 as const,
      crosshairMarkerVisible: true,
      lastPriceAnimation: LastPriceAnimationMode.OnDataUpdate,
    };
  }
  const stroke = crashed ? '#dc2626' : lineColor;
  return {
    lineColor: stroke,
    topColor: crashed ? 'rgba(220, 38, 38, 0.2)' : 'rgba(232, 232, 232, 0.72)',
    bottomColor: crashed ? 'rgba(220, 38, 38, 0.08)' : 'rgba(232, 232, 232, 0.18)',
    lineWidth: 2 as const,
    crosshairMarkerVisible: true,
    lastPriceAnimation: LastPriceAnimationMode.OnDataUpdate,
  };
}

/** Same chart chrome as ManualTrader (`createChart` options); area series underlay + stroke; no time-scale labels. */
function AviatorLineChart({
  points,
  crashed,
  embedded,
  barrierPct,
  symbol,
  chartDark,
}: {
  points: LinePoint[];
  crashed: boolean;
  /** When true, chart height follows container (`ResizeObserver`) instead of a fixed pixel height. */
  embedded?: boolean;
  /** Max one-tick % band from `THRESHOLD_MAP` — barriers at ±this % of last price. */
  barrierPct?: number;
  /** Active volatility symbol — drives price-scale decimals (pip size). */
  symbol: string;
  /** Same light/dark chart chrome as ManualTrader (from page theme toggle + localStorage). */
  chartDark: boolean;
}) {
  const neutralStroke = chartDark ? AVIATOR_PRICE_LINE_STROKE.dark : AVIATOR_PRICE_LINE_STROKE.light;

  const stackRef = useRef<HTMLDivElement | null>(null);
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const barrierSvgRef = useRef<SVGSVGElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<any>(null);

  const overlayInputRef = useRef({
    points,
    barrierPct,
    crashed,
    chartDark,
  });
  overlayInputRef.current = { points, barrierPct, crashed, chartDark };

  const scheduleBarrierPaint = useCallback(() => {
    requestAnimationFrame(() => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series) return;
      const { points: pts, barrierPct: bp, crashed: cr, chartDark: dark } = overlayInputRef.current;
      if (bp === undefined || !(bp > 0)) {
        barrierSvgRef.current?.replaceChildren();
        return;
      }
      paintBarrierOverlay({
        chart,
        series,
        svg: barrierSvgRef.current,
        stackEl: stackRef.current,
        points: pts,
        barrierPct: bp,
        crashed: cr,
        chartDark: dark,
      });
    });
  }, []);

  /** After `setData` / zoom, barSpacing updates asynchronously — re-sync offset once layout settles (coalesced). */
  const gapLayoutRafRef = useRef<number | null>(null);
  const scheduleGapAfterScaleLayout = useCallback(() => {
    if (gapLayoutRafRef.current != null) return;
    gapLayoutRafRef.current = requestAnimationFrame(() => {
      gapLayoutRafRef.current = null;
      requestAnimationFrame(() => {
        const c = chartRef.current;
        if (!c) return;
        applyAviatorLastTickRightGap(c);
        scheduleBarrierPaint();
      });
    });
  }, [scheduleBarrierPaint]);

  useEffect(() => {
    if (!chartHostRef.current || !stackRef.current) return;

    const initialH = embedded
      ? Math.max(200, stackRef.current.clientHeight || 360)
      : 460;

    const chart = createChart(chartHostRef.current, {
      layout: {
        background: { color: chartDark ? '#14181f' : '#ffffff' },
        textColor: chartDark ? '#94a3b8' : '#334155',
        attributionLogo: false,
      },
      grid: aviatorChartGrid(chartDark),
      crosshair: { mode: CrosshairMode.Normal },
      width: stackRef.current.clientWidth,
      height: initialH,
      timeScale: {
        visible: false,
        timeVisible: false,
        secondsVisible: false,
        ticksVisible: false,
        borderVisible: false,
        rightOffset: 0,
        fixRightEdge: true,
        rightBarStaysOnScroll: true,
        shiftVisibleRangeOnNewBar: true,
      },
      rightPriceScale: {
        borderVisible: true,
        borderColor: chartDark ? '#2d3545' : '#cbd5e1',
      },
    });

    const series = chart.addSeries(AreaSeries, {
      ...aviatorPriceSeriesOptions(chartDark, crashed, neutralStroke),
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const onLogicalRange = () => {
      scheduleBarrierPaint();
      scheduleGapAfterScaleLayout();
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(onLogicalRange);

    const onTimeScaleSize = () => {
      requestAnimationFrame(() => {
        const c = chartRef.current;
        if (!c) return;
        applyAviatorLastTickRightGap(c);
        scheduleBarrierPaint();
      });
    };
    chart.timeScale().subscribeSizeChange(onTimeScaleSize);

    const ro = new ResizeObserver(() => {
      if (stackRef.current && chartRef.current) {
        const w = stackRef.current.clientWidth;
        const h = embedded ? Math.max(200, stackRef.current.clientHeight) : 460;
        chartRef.current.applyOptions({ width: w, height: h });
        applyAviatorLastTickRightGap(chartRef.current);
        scheduleGapAfterScaleLayout();
        scheduleBarrierPaint();
      }
    });
    ro.observe(stackRef.current);

    return () => {
      if (gapLayoutRafRef.current != null) {
        cancelAnimationFrame(gapLayoutRafRef.current);
        gapLayoutRafRef.current = null;
      }
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onLogicalRange);
      chart.timeScale().unsubscribeSizeChange(onTimeScaleSize);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once; theme updates below
  }, [embedded, scheduleBarrierPaint, scheduleGapAfterScaleLayout]);

  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;
    chartRef.current.applyOptions({
      layout: {
        background: { color: chartDark ? '#14181f' : '#ffffff' },
        textColor: chartDark ? '#94a3b8' : '#334155',
        attributionLogo: false,
      },
      grid: aviatorChartGrid(chartDark),
      rightPriceScale: {
        borderColor: chartDark ? '#2d3545' : '#cbd5e1',
      },
    });
    seriesRef.current.applyOptions({
      ...aviatorPriceSeriesOptions(chartDark, crashed, neutralStroke),
    });
    const prec = aviatorResolveDigitTickDecimals(symbol);
    const minMove = prec <= 0 ? 1 : 10 ** -prec;
    seriesRef.current.applyOptions({
      priceFormat: { type: 'price', precision: prec, minMove },
    });
  }, [chartDark, crashed, neutralStroke, symbol]);

  useEffect(() => {
    if (!seriesRef.current || points.length === 0) return;
    seriesRef.current.setData(
      points.map(p => ({
        time: p.t as UTCTimestamp,
        value: p.v,
      }))
    );
    const chart = chartRef.current;
    if (chart) {
      applyAviatorLastTickRightGap(chart);
      chart.timeScale().scrollToRealTime();
      scheduleGapAfterScaleLayout();
    }
    scheduleBarrierPaint();
  }, [points, scheduleBarrierPaint, scheduleGapAfterScaleLayout]);

  useEffect(() => {
    scheduleBarrierPaint();
  }, [barrierPct, crashed, chartDark, scheduleBarrierPaint]);

  return (
    <div className={`aviator-line-chart-wrap${embedded ? ' aviator-line-chart-wrap--embedded' : ''}`}>
      <div ref={stackRef} className="aviator-line-chart-stack">
        <div ref={chartHostRef} className="aviator-line-chart-pane aviator-line-chart-pane--chart-host" />
        <svg ref={barrierSvgRef} className="aviator-line-chart-barrier-svg" aria-hidden />
      </div>
    </div>
  );
}

/* ───────────────────────── Constants ───────────────────────── */

const MARKET_NAMES: Record<string, string> = {
  R_10: 'Volatility 10 Index', '1HZ10V': 'Volatility 10(1s) Index',
  R_25: 'Volatility 25 Index', '1HZ25V': 'Volatility 25(1s) Index',
  R_50: 'Volatility 50 Index', '1HZ50V': 'Volatility 50(1s) Index',
  R_75: 'Volatility 75 Index', '1HZ75V': 'Volatility 75(1s) Index',
  R_100: 'Volatility 100 Index', '1HZ100V': 'Volatility 100(1s) Index',
};

const AVIATOR_SYMBOL_KEYS = Object.keys(MARKET_NAMES) as (keyof typeof MARKET_NAMES)[];

/** Volatility 10 index (`R_10`), not Vol 10 (1s) `1HZ10V`. */
const AVIATOR_DEFAULT_MARKET = 'R_10';

/** Chart dropdown labels + icons (aligned with ManualTrader market picker). */
const AVIATOR_MARKET_META: Record<string, { label: string; icon: JSX.Element }> = {
  '1HZ10V': { label: 'Vol 10 (1s)', icon: <MarketDerivedVolatility101sIcon width={16} height={16} /> },
  '1HZ25V': { label: 'Vol 25 (1s)', icon: <MarketDerivedVolatility251sIcon width={16} height={16} /> },
  '1HZ50V': { label: 'Vol 50 (1s)', icon: <MarketDerivedVolatility501sIcon width={16} height={16} /> },
  '1HZ75V': { label: 'Vol 75 (1s)', icon: <MarketDerivedVolatility751sIcon width={16} height={16} /> },
  '1HZ100V': { label: 'Vol 100 (1s)', icon: <MarketDerivedVolatility1001sIcon width={16} height={16} /> },
  R_10: { label: 'Vol 10', icon: <MarketDerivedVolatility10Icon width={16} height={16} /> },
  R_25: { label: 'Vol 25', icon: <MarketDerivedVolatility25Icon width={16} height={16} /> },
  R_50: { label: 'Vol 50', icon: <MarketDerivedVolatility50Icon width={16} height={16} /> },
  R_75: { label: 'Vol 75', icon: <MarketDerivedVolatility75Icon width={16} height={16} /> },
  R_100: { label: 'Vol 100', icon: <MarketDerivedVolatility100Icon width={16} height={16} /> },
};

/** Normalize API `growth_rate` (0.03 vs 3) to whole-number percent for UI. */
function accumGrowthRatePct(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (Math.abs(n) <= 1 && n !== 0) return Math.round(n * 100);
  return Math.round(n);
}

const THRESHOLD_MAP: Record<string, Record<string, number>> = {
  '1': { R_10: 0.00613, '1HZ10V': 0.00433, R_25: 0.01531, '1HZ25V': 0.01083, R_50: 0.03063, '1HZ50V': 0.02166, R_75: 0.04594, '1HZ75V': 0.03249, R_100: 0.06126, '1HZ100V': 0.04331 },
  '2': { R_10: 0.00573, '1HZ10V': 0.00405, R_25: 0.01431, '1HZ25V': 0.01012, R_50: 0.02863, '1HZ50V': 0.02024, R_75: 0.04294, '1HZ75V': 0.03036, R_100: 0.05725, '1HZ100V': 0.04048 },
  '3': { R_10: 0.00537, '1HZ10V': 0.0038, R_25: 0.01342, '1HZ25V': 0.00949, R_50: 0.02685, '1HZ50V': 0.01898, R_75: 0.04027, '1HZ75V': 0.02847, R_100: 0.05369, '1HZ100V': 0.03797 },
  '4': { R_10: 0.00511, '1HZ10V': 0.00361, R_25: 0.01277, '1HZ25V': 0.00903, R_50: 0.02554, '1HZ50V': 0.01806, R_75: 0.03831, '1HZ75V': 0.02709, R_100: 0.05109, '1HZ100V': 0.03612 },
  '5': { R_10: 0.00486, '1HZ10V': 0.00344, R_25: 0.01216, '1HZ25V': 0.0086, R_50: 0.02431, '1HZ50V': 0.01719, R_75: 0.03647, '1HZ75V': 0.02579, R_100: 0.04863, '1HZ100V': 0.03438 },
};

const getCounterColor = (c: number) => {
  if (c <= 0) return '#cb4335';
  if (c < 10) return '#cb4335';
  if (c < 20) return '#2874a6';
  if (c < 50) return '#6c3483';
  if (c < 100) return '#800080';
  if (c < 150) return '#4B0082';
  if (c < 200) return '#0000FF';
  return '#00008B';
};

/* ───────────────────────── Streak Analysis ───────────────────────── */

type StreakStats = {
  range: string;
  total: number;
  continued: number;
  failed: number;
  continuationRate: number;
};

const getRange = (streak: number): string => {
  if (streak < 10) return '0-10';
  if (streak < 20) return '10-20';
  if (streak < 30) return '20-30';
  if (streak < 40) return '30-40';
  if (streak < 50) return '40-50';
  if (streak < 60) return '50-60';
  if (streak < 70) return '60-70';
  if (streak < 80) return '70-80';
  if (streak < 90) return '80-90';
  if (streak < 100) return '90-100';
  if (streak < 150) return '100-150';
  if (streak < 200) return '150-200';
  if (streak < 300) return '200-300';
  return '300+';
};

const calculateStreakStats = (history: number[]): StreakStats[] => {
  const rangeCounts: Record<string, number> = {};
  const total = history.length;

  // Count how many streaks fell into each range
  history.forEach(streak => {
    const range = getRange(streak);
    rangeCounts[range] = (rangeCounts[range] || 0) + 1;
  });

  // Calculate continuation rates
  const ranges = Object.keys(rangeCounts).sort();
  const stats: StreakStats[] = [];

  ranges.forEach((range, i) => {
    const streaksInRange = rangeCounts[range];

    // Streaks that exceeded this range = total - streaks in lower or equal ranges
    const streaksContinued = total - ranges.slice(0, i + 1)
      .reduce((sum, r) => sum + (rangeCounts[r] || 0), 0);

    stats.push({
      range,
      total: streaksInRange,
      continued: streaksContinued,
      failed: streaksInRange,
      continuationRate: streaksContinued / (streaksContinued + streaksInRange) * 100
    });
  });

  return stats;
};

const getCurrentRangeStats = (counter: number, stats: StreakStats[]): StreakStats | null => {
  const currentRange = getRange(counter);
  return stats.find(s => s.range === currentRange) || null;
};

/* ───────────────────────── Accumulator (split layout: tx left / settings right) ───────────────────────── */

type TAccum = {
  id: string;
  symbol: string;
  buyPrice: number;
  profit: number;
  status: 'open' | 'sold' | 'expired';
  target: number;
  closedTime?: number;
  /** Growth rate % (1–5) at purchase / from API */
  growthRate?: number;
  /** Accumulator tick counter from API when present */
  currentTick?: number;
  /** Underlying quote at virtual open (CR shadow) — drives live P/L without Deriv ACCU stream */
  virtEntryQuote?: number;
};

/**
 * Deriv can emit validation errors for `proposal_open_contract` after sell/unsubscribe.
 * Those are harmless for the user — avoid showing them in contract settings.
 */
function suppressAccuContractSettingsError(message: unknown): boolean {
  const m = String(message ?? '').toLowerCase();
  return m.includes('proposal_open_contract') && m.includes('validation');
}

/** Map Deriv-style statuses into UI buckets so Sell shows for any active ACCU. */
function normalizeAccumStatus(raw: unknown): TAccum['status'] {
  const s = String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_');

  if (['sold', 'won'].includes(s)) return 'sold';
  if (['expired', 'lost', 'cancelled', 'canceled'].includes(s)) return 'expired';
  return 'open';
}

/** Open ACCU to target with the primary Buy/Sell control — matches chart symbol & growth when possible. */
function selectPrimaryAccuSellId(
  contracts: Record<string, TAccum>,
  chartSymbol: string,
  chartGrowthRate: number
): string | null {
  const list = Object.values(contracts).filter(c => c.status === 'open');
  if (list.length === 0) return null;
  const byId = (a: TAccum, b: TAccum) => a.id.localeCompare(b.id);

  const matchesSymGr = list.filter(
    c => c.symbol === chartSymbol && (c.growthRate ?? chartGrowthRate) === chartGrowthRate
  );
  if (matchesSymGr.length) return [...matchesSymGr].sort(byId)[0].id;

  const matchesSym = list.filter(c => c.symbol === chartSymbol);
  if (matchesSym.length) return [...matchesSym].sort(byId)[0].id;

  return [...list].sort(byId)[0].id;
}

type AccumulatorContextValue = {
  symbol: string;
  growthRate: number;
  counter: number;
  streakStats: StreakStats[];
  stake: number;
  setStake: (n: number) => void;
  takeProfit: number;
  setTakeProfit: (n: number) => void;
  contracts: Record<string, TAccum>;
  recent: TAccum[];
  pl: number;
  isBuying: boolean;
  isSelling: boolean;
  error: string | null;
  buy: () => Promise<void>;
  manualSell: (id: string) => Promise<void>;
  resetRecent: () => void;
};

const AccumulatorContext = createContext<AccumulatorContextValue | null>(null);

function useAccumulator(): AccumulatorContextValue {
  const v = useContext(AccumulatorContext);
  if (!v) throw new Error('useAccumulator must be used inside AccumulatorProvider');
  return v;
}

function AccumulatorProvider({
  symbol,
  growthRate,
  counter,
  streakStats,
  children,
  underlyingRef,
}: {
  symbol: string;
  growthRate: number;
  counter: number;
  streakStats: StreakStats[];
  children: ReactNode;
  underlyingRef: React.MutableRefObject<number | null>;
}) {
  const { client } = useStore();
  const { activeLoginid, tradingSocketGeneration } = useApiBase();
  const clientRef = useRef(client);
  const activeLoginidRef = useRef(activeLoginid);
  useEffect(() => {
    clientRef.current = client;
  }, [client]);
  useEffect(() => {
    activeLoginidRef.current = activeLoginid;
  }, [activeLoginid]);
  const [stake, setStakeState] = useState(10);
  const [takeProfit, setTakeProfitState] = useState(0);
  const [contracts, setCons] = useState<Record<string, TAccum>>({});
  const [recent, setRecent] = useState<TAccum[]>([]);
  const [pl, setPL] = useState(0);
  const [isBuying, setIsBuying] = useState(false);
  const [isSelling, setIsSelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshRef = useRef<NodeJS.Timeout | null>(null);
  const accuBusyRef = useRef(false);
  const subs = useRef<Set<string>>(new Set());
  const closedIds = useRef<Set<string>>(new Set());
  const pendingStatusChecks = useRef<Set<string>>(new Set());
  /** Avoid duplicate TP auto-sells while `doSell` is in flight for a virtual contract. */
  const pendingVirtualTpRef = useRef<Set<string>>(new Set());
  const contractsRef = useRef<Record<string, TAccum>>({});

  contractsRef.current = contracts;

  const setStake = useCallback((n: number) => setStakeState(Math.max(1, Math.floor(Number(n) || 1))), []);
  const setTakeProfit = useCallback((n: number) => setTakeProfitState(Math.max(0, Number(n) || 0)), []);

  const showStatus = (msg: string, type: 'info' | 'error' | 'success') => {
    setError(type === 'error' ? msg : null);
    console[type === 'info' ? 'info' : type === 'error' ? 'error' : 'log'](msg);
  };

  const addToRecent = (c: TAccum, profit?: number) => {
    if (closedIds.current.has(c.id)) return;
    closedIds.current.add(c.id);
    setRecent(prev => [
      { ...c, profit: profit ?? c.profit, status: 'sold', closedTime: Date.now() },
      ...prev,
    ]);
  };

  const resetRecent = () => {
    setRecent([]);
    closedIds.current.clear();
  };

  const subscribeToUpdates = async (id: string) => {
    if (subs.current.has(id)) return;
    try {
      await api_base.api.send({
        proposal_open_contract: 1,
        contract_id: id,
        subscribe: 1,
      });
      subs.current.add(id);
      pendingStatusChecks.current.delete(id);
    } catch (e) {
      console.warn('Subscription error:', e);
    }
  };

  const unsubscribe = async (id: string) => {
    if (String(id).startsWith('v-')) return;
    if (!subs.current.has(id)) return;
    try {
      await api_base.api.send({
        proposal_open_contract: 0,
        contract_id: id,
      });
      subs.current.delete(id);
      pendingStatusChecks.current.delete(id);
    } catch (e) {
      console.warn('Unsubscription error:', e);
    }
  };

  const doSell = async (id: string) => {
    if (String(id).startsWith('v-')) {
      const c = contractsRef.current[id];
      if (!c) throw new Error('Contract not found');
      const cli = clientRef.current;
      const login = activeLoginidRef.current || cli?.loginid || '';
      if (!cli || !isCrVirtualShadowLogin(login)) throw new Error('Virtual wallet not available');
      const cashout = Number((c.buyPrice + c.profit).toFixed(2));
      await applyCrShadowDeltaLocked(cli, ALLOWED_BOT_IFRAME_LOGINID, cashout);
      return { contract_id: id, profit: c.profit, sell_price: cashout };
    }
    const resp = await api_base.api.send({ sell: id, price: 0 });
    if (resp.error) throw new Error(resp.error.message);
    return resp.sell;
  };

  const handlePortfolio = (portfolio: any) => {
    if (!portfolio?.contracts) return;
    const open: Record<string, TAccum> = {};

    portfolio.contracts
      .filter((c: any) => c.contract_type === 'ACCU' && normalizeAccumStatus(c.status) === 'open')
      .forEach((c: any) => {
        const id = String(c.contract_id);
        open[id] = {
          id,
          symbol: c.symbol,
          buyPrice: Number(c.buy_price),
          profit: parseFloat(c.profit ?? 0),
          status: normalizeAccumStatus(c.status),
          target: takeProfit,
          growthRate: accumGrowthRatePct(c.growth_rate),
          currentTick: c.current_tick != null ? Number(c.current_tick) : undefined,
        };
        subscribeToUpdates(id);
      });

    setCons(prev => {
      const virt: Record<string, TAccum> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (String(k).startsWith('v-')) virt[k] = v;
      }
      return { ...virt, ...open };
    });
  };

  const handleContract = (c: any) => {
    const cid = String(c.contract_id);
    if (cid.startsWith('v-')) return;
    setCons(prev => {
      const old = prev[cid];
      if (!old) return prev;

      const updated: TAccum = {
        ...old,
        profit: parseFloat(c.profit ?? 0),
        status: normalizeAccumStatus(c.status),
        growthRate: accumGrowthRatePct(c.growth_rate) ?? old.growthRate,
        currentTick:
          c.current_tick != null ? Number(c.current_tick) : old.currentTick,
      };

      if (updated.status === 'open' && updated.target > 0 && updated.profit >= updated.target) {
        doSell(updated.id)
          .then(sell => {
            addToRecent(updated, sell.profit);
            setCons(p => {
              const rest = { ...p };
              delete rest[updated.id];
              return rest;
            });
            if (!String(updated.id).startsWith('v-')) unsubscribe(updated.id);
            showStatus(`TP hit – sold ${updated.id}`, 'success');
          })
          .catch(e => showStatus(`Auto-sell failed: ${e.message}`, 'error'));
        return prev;
      }

      if (updated.status !== 'open') {
        addToRecent(updated);
        const rest = { ...prev };
        delete rest[updated.id];
        return rest;
      }

      return { ...prev, [updated.id]: updated };
    });
  };

  const handleSell = (sell: any) => {
    const cid = String(sell.contract_id);
    setCons(prev => {
      const sold = prev[cid];
      if (sold) addToRecent(sold, sell.profit);
      const rest = { ...prev };
      delete rest[cid];
      return rest;
    });
    if (!String(cid).startsWith('v-')) unsubscribe(cid);
  };

  const checkContractStatus = async (id: string) => {
    if (String(id).startsWith('v-')) return;
    if (pendingStatusChecks.current.has(id)) return;
    pendingStatusChecks.current.add(id);

    try {
      const resp = await api_base.api.send({
        proposal_open_contract: 1,
        contract_id: id,
      });

      if (resp.error) {
        console.warn('Status check failed for', id, resp.error);
        return;
      }

      handleContract(resp.proposal_open_contract);
    } catch (e) {
      console.warn('Error checking contract status:', e);
    } finally {
      pendingStatusChecks.current.delete(id);
    }
  };

  const buy = async () => {
    if (accuBusyRef.current) return;
    accuBusyRef.current = true;
    setIsBuying(true);
    setError(null);

    try {
      const login = activeLoginidRef.current || clientRef.current?.loginid || '';
      if (isCrVirtualShadowLogin(login)) {
        const cli = clientRef.current;
        if (!cli) throw new Error('Wallet not ready');
        const propPayload: Record<string, unknown> = {
          proposal: 1,
          amount: stake,
          basis: 'stake',
          currency: 'USD',
          contract_type: 'ACCU',
          growth_rate: growthRate / 100,
        };
        applyDerivSessionMarketField(propPayload, symbol);
        const prop = await api_base.api.send(propPayload);
        if (prop.error) throw new Error(prop.error.message);
        const ask = Number(prop.proposal?.ask_price ?? stake);
        const debitOk = await runWithCrShadowLock(() => tryDebitCrShadowSync(cli, ALLOWED_BOT_IFRAME_LOGINID, ask));
        if (!debitOk) throw new Error('Insufficient balance');
        const virtId = `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const entryQ = underlyingRef.current;
        setCons(c => ({
          ...c,
          [virtId]: {
            id: virtId,
            symbol,
            buyPrice: ask,
            profit: 0,
            status: 'open',
            target: takeProfit,
            growthRate,
            virtEntryQuote: entryQ != null && Number.isFinite(entryQ) ? entryQ : undefined,
          },
        }));
        showStatus(`Bought virtual ACCU: ${virtId}`, 'success');
        return;
      }

      const resp = (await sendDerivSessionContractPurchase(d => api_base.api!.send(d) as Promise<unknown>, {
        contract_type: 'ACCU',
        market: symbol,
        stake,
        extras: { growth_rate: growthRate / 100 },
      })) as {
        error?: { message?: string };
        buy?: { contract_id?: unknown; buy_price?: unknown };
      };

      if (resp.error) throw new Error(resp.error.message ?? 'Buy failed');
      const cidRaw = resp.buy?.contract_id;
      if (cidRaw == null || cidRaw === '') throw new Error('No contract ID in response');

      const id = String(cidRaw);
      setCons(c => ({
        ...c,
        [id]: {
          id,
          symbol,
          buyPrice: Number(resp.buy?.buy_price),
          profit: 0,
          status: 'open',
          target: takeProfit,
          growthRate,
        },
      }));

      showStatus(`Bought ACCU contract: ${id}`, 'success');
      await subscribeToUpdates(id);
    } catch (err: any) {
      const msg = err.message.toLowerCase().includes('insufficient')
        ? 'Insufficient balance'
        : err.message;
      showStatus(`Buy failed: ${msg}`, 'error');
    } finally {
      accuBusyRef.current = false;
      setIsBuying(false);
    }
  };

  const manualSell = async (id: string) => {
    if (accuBusyRef.current) return;
    accuBusyRef.current = true;
    setIsSelling(true);
    try {
      const sellInfo = await doSell(id);
      const closed = contractsRef.current[id];
      if (closed) addToRecent(closed, sellInfo.profit);

      setCons(prev => {
        const rest = { ...prev };
        delete rest[id];
        return rest;
      });
      unsubscribe(id);
      showStatus(`Sold contract: ${id}`, 'success');
    } catch (err: any) {
      showStatus(`Sell failed: ${err.message}`, 'error');
    } finally {
      accuBusyRef.current = false;
      setIsSelling(false);
    }
  };

  useEffect(() => {
    const tpLine = takeProfit > 0 ? takeProfit : 0;
    const tickMs = 320;

    const id = window.setInterval(() => {
      const q = underlyingRef.current;
      if (q == null || !Number.isFinite(q)) return;

      setCons(prev => {
        let changed = false;
        const next: Record<string, TAccum> = { ...prev };
        for (const [k, c] of Object.entries(prev)) {
          if (!k.startsWith('v-') || c.status !== 'open') continue;
          const entry = c.virtEntryQuote ?? c.buyPrice;
          if (!(typeof entry === 'number' && Number.isFinite(entry)) || entry <= 0) continue;
          const move = (q - entry) / entry;
          const gr = (c.growthRate ?? growthRate) / 100;
          const raw = c.buyPrice * move * Math.max(0.5, 1 + gr * 8);
          const profit = Math.max(-c.buyPrice * 0.98, Math.min(c.buyPrice * 30, Number(raw.toFixed(2))));
          const tickN = profit !== c.profit ? (c.currentTick ?? 0) + 1 : (c.currentTick ?? 0);
          const liveTarget = takeProfit > 0 ? takeProfit : c.target;
          const row: TAccum = { ...c, profit, currentTick: tickN, target: liveTarget };

          const rowChanged =
              row.profit !== c.profit ||
              row.currentTick !== c.currentTick ||
              row.target !== c.target;
          if (rowChanged) {
              next[k] = row;
              changed = true;
          }

          if (tpLine > 0 && profit >= tpLine && !pendingVirtualTpRef.current.has(k)) {
            pendingVirtualTpRef.current.add(k);
            void (async () => {
              try {
                const cur = contractsRef.current[k];
                if (!cur || cur.status !== 'open' || !k.startsWith('v-')) return;
                const sell = await doSell(k);
                addToRecent(cur, sell.profit);
                setCons(p => {
                  if (!p[k]) return p;
                  const rest = { ...p };
                  delete rest[k];
                  return rest;
                });
                showStatus(`TP hit – sold ${k}`, 'success');
              } catch (err: any) {
                showStatus(`Auto-sell failed: ${err?.message ?? err}`, 'error');
              } finally {
                pendingVirtualTpRef.current.delete(k);
              }
            })();
          }
        }
        return changed ? next : prev;
      });
    }, tickMs);

    return () => {
      clearInterval(id);
      pendingVirtualTpRef.current.clear();
    };
  }, [underlyingRef, growthRate, takeProfit]);

  useEffect(() => {
    const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
      if (data.error) {
        const errMsg = data.error.message ?? '';
        if (suppressAccuContractSettingsError(errMsg)) {
          console.warn('[ACCU] Ignored benign API error:', errMsg);
        } else {
          showStatus(errMsg, 'error');
        }
        return;
      }

      switch (data.msg_type) {
        case 'proposal_open_contract':
          handleContract(data.proposal_open_contract);
          break;
        case 'sell':
          handleSell(data.sell);
          break;
        case 'portfolio':
          handlePortfolio(data.portfolio);
          break;
      }
    });

    api_base.api.send({ portfolio: 1 });
    refreshRef.current = setInterval(() => {
      api_base.api.send({ portfolio: 1 });
      Object.keys(contractsRef.current).forEach(checkContractStatus);
    }, 180_000);

    return () => {
      sub.unsubscribe();
      if (refreshRef.current) clearInterval(refreshRef.current);
      subs.current.forEach(id => unsubscribe(id));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- also rebind when Options OTP socket instance changes
  }, [takeProfit, tradingSocketGeneration]);

  useEffect(() => {
    const openPL = Object.values(contracts).reduce((s, c) => s + c.profit, 0);
    const closedPL = recent.reduce((s, c) => s + c.profit, 0);
    setPL(openPL + closedPL);
  }, [contracts, recent]);

  const contextValue = useMemo<AccumulatorContextValue>(
    () => ({
      symbol,
      growthRate,
      counter,
      streakStats,
      stake,
      setStake,
      takeProfit,
      setTakeProfit,
      contracts,
      recent,
      pl,
      isBuying,
      isSelling,
      error,
      buy,
      manualSell,
      resetRecent,
    }),
    [
      symbol,
      growthRate,
      counter,
      streakStats,
      stake,
      setStake,
      takeProfit,
      setTakeProfit,
      contracts,
      recent,
      pl,
      isBuying,
      isSelling,
      error,
      buy,
      manualSell,
      resetRecent,
    ]
  );

  return <AccumulatorContext.Provider value={contextValue}>{children}</AccumulatorContext.Provider>;
}

function AccumulatorTransactionsColumn() {
  const {
    contracts,
    recent,
    pl,
    growthRate,
    manualSell,
    isSelling,
    resetRecent,
  } = useAccumulator();

  const [openPosCollapsed, setOpenPosCollapsed] = useState(false);
  const activeList = Object.values(contracts);

  return (
    <div className="aviator-tx-panel">
      <h3 className="aviator-tx-panel__title">Transactions</h3>

      <div className="aviator-tx-orders aviator-tx-orders--open">
        <div className="aviator-tx-open-head">
          <span className="aviator-tx-open-head__title">Open positions</span>
          <button
            type="button"
            className="aviator-tx-open-head__toggle"
            aria-expanded={!openPosCollapsed}
            aria-label={openPosCollapsed ? 'Expand open positions' : 'Collapse open positions'}
            onClick={() => setOpenPosCollapsed(v => !v)}
          >
            {openPosCollapsed ? '+' : '—'}
          </button>
        </div>
        {!openPosCollapsed ? (
          <>
            <div className="aviator-tx-orders__body aviator-tx-orders__body--open-cards">
              {activeList.length === 0 ? (
                <div className="aviator-tx-empty aviator-tx-empty--open">No open positions</div>
              ) : (
                activeList.map(c => {
                  const meta = AVIATOR_MARKET_META[c.symbol];
                  const marketTitle = MARKET_NAMES[c.symbol] ?? c.symbol;
                  const gr = c.growthRate ?? growthRate;
                  const stakeAmt = c.buyPrice;
                  const contractVal = stakeAmt + c.profit;
                  const tpDisplay =
                    c.target > 0 ? (
                      <span className="aviator-pos-card__tp-val">{c.target.toFixed(2)}</span>
                    ) : (
                      <span className="aviator-pos-card__tp-placeholder">
                        <span>—</span>
                        <span className="aviator-pos-card__tp-edit" aria-hidden>
                          ✎
                        </span>
                      </span>
                    );

                  return (
                    <article key={c.id} className="aviator-pos-card">
                      <header className="aviator-pos-card__market">
                        <div className="aviator-pos-card__market-left">
                          {meta?.icon ? (
                            <span className="aviator-pos-card__market-icon">{meta.icon}</span>
                          ) : null}
                          <span className="aviator-pos-card__market-name">{marketTitle}</span>
                        </div>
                        <div className="aviator-pos-card__market-right">
                          <span className="aviator-pos-card__accu-icon" aria-hidden>
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                              <path
                                d="M2 11 L5.5 7.5 L9 9.5 L14 4"
                                stroke="#dc2626"
                                strokeWidth="1.35"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <div className="aviator-pos-card__accu-meta">
                            <span className="aviator-pos-card__accu-label">Accumulators</span>
                            <span className="aviator-pos-card__accu-rate">{gr}%</span>
                          </div>
                        </div>
                      </header>

                      <div className="aviator-pos-card__ticks">
                        {c.currentTick != null ? `${c.currentTick} Ticks` : '—'}
                      </div>

                      <div className="aviator-pos-card__grid">
                        <span className="aviator-pos-card__usd-badge">USD</span>
                        <div className="aviator-pos-card__cell">
                          <span className="aviator-pos-card__lbl">Stake:</span>
                          <span className="aviator-pos-card__val">{stakeAmt.toFixed(2)}</span>
                        </div>
                        <div className="aviator-pos-card__cell aviator-pos-card__cell--right">
                          <span className="aviator-pos-card__lbl">Contract value:</span>
                          <span
                            className={`aviator-pos-card__val ${contractVal >= stakeAmt ? 'aviator-pos-card__val--teal' : 'aviator-pos-card__val--warn'}`}
                          >
                            {contractVal.toFixed(2)}
                            <span className="aviator-pos-card__tri" aria-hidden>
                              {contractVal >= stakeAmt ? '▲' : '▼'}
                            </span>
                          </span>
                        </div>
                        <div className="aviator-pos-card__cell">
                          <span className="aviator-pos-card__lbl">Total profit/loss:</span>
                          <span
                            className={`aviator-pos-card__val ${c.profit >= 0 ? 'aviator-pos-card__val--teal' : 'aviator-pos-card__val--warn'}`}
                          >
                            {c.profit >= 0 ? '+' : ''}
                            {c.profit.toFixed(2)}
                            <span className="aviator-pos-card__tri" aria-hidden>
                              {c.profit >= 0 ? '▲' : '▼'}
                            </span>
                          </span>
                        </div>
                        <div className="aviator-pos-card__cell aviator-pos-card__cell--right">
                          <span className="aviator-pos-card__lbl">Take profit:</span>
                          <div className="aviator-pos-card__tp-box">{tpDisplay}</div>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="aviator-pos-card__sell"
                        disabled={isSelling}
                        onClick={() => void manualSell(c.id)}
                      >
                        Sell
                      </button>
                    </article>
                  );
                })
              )}
            </div>
            <footer className="aviator-tx-open-footer">
              <div className="aviator-tx-open-footer__count">
                {activeList.length} open position{activeList.length === 1 ? '' : 's'}
              </div>
            </footer>
          </>
        ) : null}
      </div>

      <div className="aviator-tx-orders">
        <div className="aviator-tx-orders__head aviator-tx-orders__head--split">
          <span>Recent</span>
          <button type="button" className="aviator-tx-reset" onClick={resetRecent}>
            Reset list
          </button>
        </div>
        <div className="aviator-tx-orders__body">
          {recent.length === 0 ? (
            <div className="aviator-tx-empty">No closed trades yet</div>
          ) : (
            recent.map(c => (
              <div key={`${c.id}-${c.closedTime ?? ''}`} className={`aviator-tx-row aviator-tx-row--${c.status}`}>
                <div className="aviator-tx-row__main aviator-tx-row__main--recent">
                  <span className={`aviator-tx-row__pl ${c.profit >= 0 ? 'is-plus' : 'is-minus'}`}>
                    {c.profit >= 0 ? '+' : ''}
                    {c.profit.toFixed(2)}
                  </span>
                </div>
                <span className="aviator-tx-row__st">{c.status}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="aviator-tx-pl">
        <span className="aviator-tx-pl__label">Session P/L</span>
        <span className={`aviator-tx-pl__value ${pl >= 0 ? 'is-plus' : 'is-minus'}`}>
          {pl >= 0 ? '+' : ''}
          {pl.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function AccumulatorSettingsColumn({
  growthRate,
  setGrowthRate,
  pctDiff,
}: {
  growthRate: number;
  setGrowthRate: (r: number) => void;
  /** Latest tick vs prior tick move % — “crash monitor”. */
  pctDiff: number;
}) {
  const {
    counter,
    streakStats,
    stake,
    setStake,
    takeProfit,
    setTakeProfit,
    contracts,
    symbol,
    growthRate: ctxGrowthRate,
    buy,
    manualSell,
    isBuying,
    isSelling,
    error,
  } = useAccumulator();

  const currentRangeStats = getCurrentRangeStats(counter, streakStats);
  const primarySellId = selectPrimaryAccuSellId(contracts, symbol, ctxGrowthRate);
  const primarySellContract = primarySellId ? contracts[primarySellId] : null;
  const primaryShowsSell = primarySellId != null;
  const sellGrowthPct = primarySellContract?.growthRate ?? ctxGrowthRate;

  const onPrimaryTrade = () => {
    if (primaryShowsSell && primarySellId) void manualSell(primarySellId);
    else void buy();
  };

  return (
    <div className="accu-panel aviator-settings-panel">
      <div className="accu-header">
        <h3>Accumulators Ai</h3>
        <span className="counter-badge" style={{ color: getCounterColor(counter) }}>
          {counter}
        </span>
      </div>

      <div className="aviator-crash-monitor" title="Absolute % move last tick vs prior tick">
        <span className="aviator-crash-monitor__label">Crash monitor</span>
        <span className="aviator-crash-monitor__value">{pctDiff.toFixed(6)}%</span>
      </div>

      <div className="aviator-growth-selector">
        <span className="aviator-growth-selector__label">Growth rate</span>
        <div className="aviator-growth-selector__buttons">
          {[1, 2, 3, 4, 5].map(r => (
            <button
              key={r}
              type="button"
              className={growthRate === r ? 'active' : ''}
              onClick={() => setGrowthRate(r)}
            >
              {r}%
            </button>
          ))}
        </div>
      </div>

      {currentRangeStats ? (
        <div className="streak-stats">
          <div className="streak-stats-item">
            <span className="streak-stats-label">Range</span>
            <span className="streak-stats-value">{currentRangeStats.range}</span>
          </div>
          <div className="streak-stats-item">
            <span className="streak-stats-label">Succeeded</span>
            <span className="streak-stats-value continued">{currentRangeStats.continued}</span>
          </div>
          <div className="streak-stats-item">
            <span className="streak-stats-label">Failed</span>
            <span className="streak-stats-value failed">{currentRangeStats.failed}</span>
          </div>
          <div className="streak-stats-item">
            <span className="streak-stats-label">Total</span>
            <span className="streak-stats-value">
              {currentRangeStats.continued + currentRangeStats.failed}
            </span>
          </div>
        </div>
      ) : null}

      {error ? <div className="accu-error">{error}</div> : null}

      <div className="accu-controls aviator-accu-controls">
        <label className="aviator-accu-controls__field">
          <span className="aviator-accu-controls__label">Stake (USD)</span>
          <input
            className="aviator-trade-input"
            type="number"
            min={1}
            step={1}
            value={stake}
            onChange={e => setStake(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            onKeyDown={e => {
              if (e.key === '.' || e.key === ',') e.preventDefault();
            }}
          />
        </label>

        <label className="aviator-accu-controls__field">
          <span className="aviator-accu-controls__label">Take profit</span>
          <input
            className="aviator-trade-input"
            type="number"
            min={0}
            step={0.01}
            value={takeProfit}
            onChange={e => setTakeProfit(Math.max(0, Number(e.target.value) || 0))}
            placeholder="Auto sell at (0 = disabled)"
          />
        </label>
        <button
          type="button"
          className={`aviator-accu-buy${primaryShowsSell ? ' aviator-accu-buy--sell-mode' : ''}`}
          onClick={() => void onPrimaryTrade()}
          disabled={isBuying || isSelling}
        >
          {isBuying
            ? 'Buying…'
            : isSelling
              ? 'Selling…'
              : primaryShowsSell
                ? `Sell Accumulators @ ${sellGrowthPct}%`
                : `Buy Accumulators @ ${growthRate}%`}
        </button>
      </div>
    </div>
  );
}

function AviatorChartSection({
  symbol,
  setSymbol,
  linePoints,
  crashed,
  shownHistory,
  barrierPct,
  chartDark,
  chartHistoryLoading,
  uiTheme,
  setUiTheme,
}: {
  symbol: string;
  setSymbol: (s: string) => void;
  linePoints: LinePoint[];
  crashed: boolean;
  shownHistory: number[];
  barrierPct: number | undefined;
  chartDark: boolean;
  chartHistoryLoading: boolean;
  uiTheme: UiTheme;
  setUiTheme: (t: UiTheme) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const preview = shownHistory.slice(0, 14);
  const meta = AVIATOR_MARKET_META[symbol];

  return (
    <section className="aviator-chart-panel">
      <div className="aviator__theme-toggle" role="group" aria-label="Color theme">
        <button
          type="button"
          className={uiTheme === 'light' ? 'active' : ''}
          onClick={() => setUiTheme('light')}
          aria-pressed={uiTheme === 'light'}
          title="Light theme"
        >
          <IconSun size={17} />
        </button>
        <button
          type="button"
          className={uiTheme === 'dark' ? 'active' : ''}
          onClick={() => setUiTheme('dark')}
          aria-pressed={uiTheme === 'dark'}
          title="Dark theme"
        >
          <IconMoon size={17} />
        </button>
      </div>
      <div className="aviator-smartchart">
        <div className="aviator-chart-body">
          <div className="aviator-chart-main">
            {historyOpen ? (
              <div className="aviator-history-expand" role="region" aria-label="Stats history">
                <div className="aviator-history-expand__head">
                  <span>Stats</span>
                  <button type="button" className="aviator-history-expand__close" onClick={() => setHistoryOpen(false)}>
                    Close
                  </button>
                </div>
                <div className="aviator-history-expand__grid">
                  {shownHistory.map((cnt, idx) => (
                    <span
                      key={`${cnt}-${idx}`}
                      className="aviator-history-chip"
                      style={{ color: getCounterColor(cnt) }}
                    >
                      {cnt}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="aviator-chart-fill">
              <AviatorLineChart
                embedded
                symbol={symbol}
                points={linePoints}
                crashed={crashed}
                barrierPct={barrierPct}
                chartDark={chartDark}
              />
              {chartHistoryLoading ? (
                <div className="aviator-chart-loading" role="status" aria-live="polite">
                  <span className="aviator-chart-loading-spinner" aria-hidden />
                  <span>Loading Denara Accumulators chart…</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="aviator-history-strip">
            <span className="aviator-history-strip__label">Stats</span>
            <div className="aviator-history-strip__values" aria-hidden={historyOpen}>
              {preview.length === 0 ? (
                <span className="aviator-history-strip__empty">—</span>
              ) : (
                preview.map((cnt, idx) => (
                  <span key={`${cnt}-${idx}`} style={{ color: getCounterColor(cnt) }}>
                    {cnt}
                  </span>
                ))
              )}
            </div>
            <button
              type="button"
              className="aviator-history-strip__toggle"
              onClick={() => setHistoryOpen(o => !o)}
              aria-expanded={historyOpen}
              aria-label={historyOpen ? 'Collapse stats list' : 'Expand stats list'}
              title={historyOpen ? 'Collapse' : 'Expand'}
            >
              {historyOpen ? '▼' : '▲'}
            </button>
          </div>
        </div>

        <div className="aviator-chart-market aviator-chart-market--left">
          <div className="aviator-chart-market-card">
            <div className="aviator-chart-market-row">
              {meta?.icon ? <span className="aviator-chart-market-icon">{meta.icon}</span> : null}
              <select
                className="aviator-chart-market-select"
                value={symbol}
                onChange={e => setSymbol(e.target.value)}
                aria-label="Market"
              >
                {AVIATOR_SYMBOL_KEYS.map(key => (
                  <option key={key} value={key}>
                    {AVIATOR_MARKET_META[key]?.label ?? MARKET_NAMES[key]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────── Analysis Helper ───────────────────── */

function analysePrices(
  prices: number[],
  symbol: string,
  rate: number
): { currentStreak: number; streakHistory: number[]; streakStats: StreakStats[] } {
  const thr = THRESHOLD_MAP[String(rate)]?.[symbol];
  if (!thr) {
    console.warn('No threshold found for', symbol, rate);
    return { currentStreak: 0, streakHistory: [], streakStats: [] };
  }

  const history: number[] = [];
  let counter = 0;

  for (let i = 1; i < prices.length; i++) {
    const pct = Math.abs((prices[i] - prices[i - 1]) / prices[i - 1] * 100);
    if (pct <= thr) counter++;
    else { history.push(counter); counter = 0; }
  }

  const streakStats = calculateStreakStats(history);
  return { currentStreak: counter, streakHistory: history.slice(-100), streakStats };
}

/* ────────────────────────── Main Component ────────────────────────── */

const TickAnalysis: React.FC = () => {
  const [symbol, setSymbol] = useState(AVIATOR_DEFAULT_MARKET);
  const [growthRate, setGrowthRate] = useState(5);
  const [pctDiff, setPctDiff] = useState(0);
  const [counter, setCounter] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [streakStats, setStreakStats] = useState<StreakStats[]>([]);
  const [crashed, setCrashed] = useState(false);
  const [linePoints, setLinePoints] = useState<LinePoint[]>([]);
  const [uiTheme, setUiTheme] = useState<UiTheme>(() => {
    if (typeof window === 'undefined') return 'light';
    try {
      const s = window.localStorage.getItem(AVIATOR_UI_THEME_KEY);
      if (s === 'dark' || s === 'light') return s;
    } catch {
      /* private mode etc. */
    }
    return 'light';
  });

  const wsRef = useRef<WebSocket | null>(null);
  const prevTickRef = useRef<number | null>(null);
  const streakRef = useRef<number>(0);
  const lineSeqRef = useRef(0);
  const debounceTimer = useRef<NodeJS.Timeout>();
  const isMounted = useRef(false);

  const openSocket = useCallback((sym: string) => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Reset states when opening new connection
    setCounter(0);
    streakRef.current = 0;
    setHistory([]);
    setStreakStats([]);
    setCrashed(false);
    prevTickRef.current = null;
    lineSeqRef.current = 0;
    setLinePoints([]);

    const sock = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');
    wsRef.current = sock;

    sock.onopen = () => {
      console.log('WebSocket connected for', sym);
      sock.send(JSON.stringify({
        ticks_history: sym,
        style: 'ticks',
        count: 5000,
        end: 'latest',
        subscribe: 1,
      }));
    };

    sock.onmessage = (e) => {
      if (!isMounted.current) return;

      try {
        const msg = JSON.parse(e.data);

        // Skip if we're not tracking this symbol anymore
        if (msg.error || symbol !== msg.echo_req?.ticks_history) return;

        if (msg.msg_type === 'history') {
          const prices: number[] = msg.history.prices.map(Number);
          if (!prices.length) return;

          const n = prices.length;
          const from = Math.max(0, n - LINE_CHART_MAX_POINTS);
          const pts: LinePoint[] = [];
          for (let i = from; i < n; i++) pts.push({ t: i, v: prices[i] });
          lineSeqRef.current = n;
          setLinePoints(pts);

          const { currentStreak, streakHistory, streakStats } = analysePrices(prices, sym, growthRate);
          streakRef.current = currentStreak;
          prevTickRef.current = prices.at(-1) ?? null;
          setCounter(currentStreak);
          setHistory(streakHistory);
          setStreakStats(streakStats);
          setCrashed(false);
          return;
        }

        if (msg.msg_type === 'tick') {
          handleTick(msg.tick.quote);
        }
      } catch (err) {
        console.error('Error processing WS message:', err);
      }
    };

    sock.onerror = (e) => {
      console.error('WebSocket error:', e);
    };

    sock.onclose = () => {
      console.log('WebSocket closed for', sym);
    };
  }, [growthRate, symbol]);

  const handleTick = (val: number) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(() => {
      const prev = prevTickRef.current;
      if (prev === null) {
        prevTickRef.current = val;
        return;
      }

      const diff = val - prev;
      const pct = Math.abs(diff / prev * 100);
      const thr = THRESHOLD_MAP[String(growthRate)]?.[symbol];

      if (!thr) {
        console.warn('No threshold found for', symbol, growthRate);
        return;
      }

      setPctDiff(pct);

      if (pct <= thr) {
        const newCounter = streakRef.current + 1;
        streakRef.current = newCounter;
        setCounter(newCounter);
        setCrashed(false);
      } else {
        const streak = streakRef.current;
        setHistory(h => {
          const next = [...h, streak];
          return next.length > 100 ? next.slice(-100) : next;
        });
        streakRef.current = 0;
        setCounter(0);
        setCrashed(true);
      }

      const seq = lineSeqRef.current++;
      setLinePoints(prev => {
        const next = [...prev, { t: seq, v: val }];
        return next.length > LINE_CHART_MAX_POINTS ? next.slice(-LINE_CHART_MAX_POINTS) : next;
      });

      prevTickRef.current = val;
    }, 50); // 50ms debounce
  };

  useEffect(() => {
    isMounted.current = true;
    openSocket(symbol);

    return () => {
      isMounted.current = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [symbol, growthRate, openSocket]);

  useEffect(() => {
    // Update streak stats whenever history changes
    setStreakStats(calculateStreakStats(history));
  }, [history]);

  useEffect(() => {
    try {
      window.localStorage.setItem(AVIATOR_UI_THEME_KEY, uiTheme);
    } catch {
      /* ignore */
    }
  }, [uiTheme]);

  const shownHistory = history.slice(-100).reverse();
  const chartDark = uiTheme === 'dark';
  const chartHistoryLoading = linePoints.length === 0;

  return (
    <div className={`aviator-page${chartDark ? ' aviator-page--ui-dark' : ''}`}>
      <div className="aviator-predictor">
        <AccumulatorProvider
          symbol={symbol}
          growthRate={growthRate}
          counter={counter}
          streakStats={streakStats}
          underlyingRef={prevTickRef}
        >
          <div className="aviator-grid">
            <aside className="aviator-grid__tx">
              <AccumulatorTransactionsColumn />
            </aside>
            <div className="aviator-grid__main">
              <AviatorChartSection
                symbol={symbol}
                setSymbol={setSymbol}
                linePoints={linePoints}
                crashed={crashed}
                shownHistory={shownHistory}
                barrierPct={THRESHOLD_MAP[String(growthRate)]?.[symbol]}
                chartDark={chartDark}
                chartHistoryLoading={chartHistoryLoading}
                uiTheme={uiTheme}
                setUiTheme={setUiTheme}
              />
            </div>
            <aside className="aviator-grid__settings">
              <AccumulatorSettingsColumn growthRate={growthRate} setGrowthRate={setGrowthRate} pctDiff={pctDiff} />
            </aside>
          </div>
        </AccumulatorProvider>
      </div>
    </div>
  );
};

export default TickAnalysis;