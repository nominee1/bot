// src/pages/aaaStrategies/RecoverSameStake/RecoverSameStake.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useApiBase } from '@/hooks/useApiBase';
import { api_base } from '@/external/bot-skeleton';
import { sendDerivSessionContractPurchase } from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import {
  TradeTypesDigitsOverIcon,
  TradeTypesDigitsUnderIcon,
  LegacyPlayFillIcon,
  MarketDerivedVolatility1001sIcon,
  MarketDerivedVolatility100Icon,
  SocialYoutubeBlackIcon,
  MarketDerivedVolatility10Icon,
  MarketDerivedJump100Icon,
  MarketDerivedJump10Icon,
  MarketDerivedJump25Icon,
  MarketDerivedJump50Icon,
  MarketDerivedJump75Icon,
  MarketDerivedVolatility25Icon,
  MarketDerivedVolatility50Icon,
  MarketDerivedVolatility75Icon,
  MarketDerivedVolatility751sIcon,
  MarketDerivedVolatility101sIcon,
  MarketDerivedVolatility251sIcon,
  MarketDerivedVolatility501sIcon,
  MarketDerivedVolatility151sIcon,
  MarketDerivedVolatility301sIcon,
  MarketDerivedVolatility901sIcon,
} from '@deriv/quill-icons';

import LazyYouTubeModal from '../LazyYoutubeModal/LazyYouTubeModal';
import './RecoverSameStake.scss';

type StrategyType = 'over' | 'under';
type TradeStatus = 'pending' | 'open' | 'active' | 'won' | 'lost' | 'completed' | 'error';

interface TTrade {
  id: string;
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
  barrierDigit?: number; // show D#
}

/* ----- Delay between settlement and next trade ----- */
const DELAY_AFTER_SETTLE_MS = 2000;

/* 🔒 Base buy gap (we'll increase automatically on real) */
const MIN_BUY_GAP_MS = 500;

/* ---------- Market Icons ---------- */
const marketIcons: Record<string, JSX.Element> = {
  '1HZ100V': <MarketDerivedVolatility1001sIcon width={16} height={16} />,
  R_100: <MarketDerivedVolatility100Icon width={16} height={16} />,
  R_10: <MarketDerivedVolatility10Icon width={16} height={16} />,
  R_25: <MarketDerivedVolatility25Icon width={16} height={16} />,
  R_50: <MarketDerivedVolatility50Icon width={16} height={16} />,
  R_75: <MarketDerivedVolatility75Icon width={16} height={16} />,
  JD10: <MarketDerivedJump10Icon width={16} height={16} />,
  JD25: <MarketDerivedJump25Icon width={16} height={16} />,
  JD50: <MarketDerivedJump50Icon width={16} height={16} />,
  JD75: <MarketDerivedJump75Icon width={16} height={16} />,
  JD100: <MarketDerivedJump100Icon width={16} height={16} />,
  '1HZ10V': <MarketDerivedVolatility101sIcon width={16} height={16} />,
  '1HZ25V': <MarketDerivedVolatility251sIcon width={16} height={16} />,
  '1HZ50V': <MarketDerivedVolatility501sIcon width={16} height={16} />,
  '1HZ15V': <MarketDerivedVolatility151sIcon width={16} height={16} />,
  '1HZ30V': <MarketDerivedVolatility301sIcon width={16} height={16} />,
  '1HZ90V': <MarketDerivedVolatility901sIcon width={16} height={16} />,
  '1HZ75V': <MarketDerivedVolatility751sIcon width={16} height={16} />,
};

const contractIcons: Record<string, JSX.Element> = {
  DIGITOVER: <TradeTypesDigitsOverIcon width={16} height={16} />,
  DIGITUNDER: <TradeTypesDigitsUnderIcon width={16} height={16} />,
};

/* ---------- Custom Entry/Exit Spot Icons ---------- */
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

/* ---------- Helpers ---------- */
const toNum = (v: string) => {
  if (v.trim() === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const formatTickValue = (v?: number, mf?: string) => {
  if (v === undefined) return '—';
  if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(mf || '')) return v.toFixed(3);
  if (['R_50', 'R_75'].includes(mf || '')) return v.toFixed(4);
  return v.toFixed(2);
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Try to parse Deriv rate-limit messages like:
 *  - "Rate limit reached for: buy, retrying in 2 seconds."
 *  - "Retry after 1s"
 */
const parseRetryAfterMs = (message: string): number | null => {
  if (!message) return null;

  // "retrying in 2 seconds"
  let m = message.match(/retry(?:ing)?\s+in\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s)\b/i);
  if (m) return Math.max(0, Math.round(Number(m[1]) * 1000));

  // "retry after 2s"
  m = message.match(/retry\s+after\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s)\b/i);
  if (m) return Math.max(0, Math.round(Number(m[1]) * 1000));

  // Sometimes they return "Retry in: 2000" (rare)
  m = message.match(/retry\s+(?:in|after)\s*[:=]?\s*(\d{2,6})\b/i);
  if (m) {
    const n = Number(m[1]);
    // if it's huge, assume ms; if small assume seconds
    return n > 60 ? n : n * 1000;
  }

  return null;
};

export default function RecoverSameStake() {
  const { tradingSocketGeneration } = useApiBase();
  /* ===== Inputs ===== */
  const [isRunning, setIsRunning] = useState(false);
  const [market, setMarket] = useState('JD50');

  // strings → allow clearing
  const [stakeStr, setStakeStr] = useState('10');
  const [tpStr, setTpStr] = useState('10');
  const [slStr, setSlStr] = useState('40');

  const [strategy, setStrategy] = useState<StrategyType>('over'); // over/under only
  const [ticks, setTicks] = useState(1);

  const [ytOpen, setYtOpen] = useState(false);
  const YT_URL = 'https://youtu.be/iB-KJSwBZcw?si=jMFFqQKzpjQ_30KX';

  // N losses before switching from main digit
  const [switchEvery, setSwitchEvery] = useState<number>(2);

  // Digits 0..9, default active [2,6], max 4
  const [activeDigits, setActiveDigits] = useState<number[]>([2, 4]);

  // Main-digit recovery toggle
  const [mainDigitRecovery, setMainDigitRecovery] = useState(false);
  const mainDigitRecoveryRef = useRef(false);
  useEffect(() => {
    mainDigitRecoveryRef.current = mainDigitRecovery;
  }, [mainDigitRecovery]);

  // Martingale input (optional), default 1.25
  const [martingaleInput, setMartingaleInput] = useState<number | ''>(1.25);
  const martingaleInputRef = useRef<number | ''>(1.25);
  useEffect(() => {
    martingaleInputRef.current = martingaleInput;
  }, [martingaleInput]);

  // derived numerics
  const stakeInput = Math.max(0, toNum(stakeStr));
  const tpInput = Math.max(0, toNum(tpStr));
  const slInput = Math.max(0, toNum(slStr));

  /* ===== Trades & status ===== */
  const [trades, setTrades] = useState<TTrade[]>([]);
  const [msg, setMsg] = useState<{
    txt: string;
    type: 'info' | 'success' | 'error' | 'loading' | 'warning';
  }>({
    txt: '',
    type: 'info',
  });
  const [profitLoss, setPL] = useState(0);
  const [sessionPL, setSessionPL] = useState(0);

  /* ===== FSM / flags ===== */
  const isRunningRef = useRef(false);
  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  // block stray post-TP/SL buys
  const stopRequestedRef = useRef(false);

  // switching machinery
  const lossesSinceSwitchRef = useRef(0); // used mostly for main digit loss streak
  const predIndexRef = useRef(0); // index into digits array

  // track which contract ids we already settled (POC)
  const settledContractsRef = useRef<Set<string>>(new Set());

  // 🔒 Buy throttle clock
  const lastBuyTsRef = useRef<number>(0);

  /* ===== Ghost-buy guards ===== */
  const runIdRef = useRef(0); // increments on every start
  const nextTimerRef = useRef<number | null>(null); // clear scheduled buys on stop/start/reset
  const buyInFlightRef = useRef(false); // prevents double buy if two triggers collide

  // map contract_id -> runId (prevents old contracts triggering new buys)
  const contractRunRef = useRef<Map<string, number>>(new Map());

  // RateLimit backoff guard (prevents overlapping retries)
  const backoffInFlightRef = useRef(false);

  const clearNextTimer = useCallback(() => {
    if (nextTimerRef.current != null) {
      window.clearTimeout(nextTimerRef.current);
      nextTimerRef.current = null;
    }
  }, []);

  /* ===== Locked runtime config ===== */
  const locked = useRef({
    S: 2, // base stake
    strat: 'over' as StrategyType,
    market: '1HZ10V',
    ticks: 1,
    tp: 0,
    sl: 0,
    switchEvery: 2,
    digits: [2, 6] as number[],
  });

  // Single-mode martingale — maxSteps = 10
  const martingale = useRef({ base: 0.35, current: 0.35, step: 0, maxSteps: 10 });

  const setStatus = useCallback(
    (txt: string, type: 'info' | 'success' | 'error' | 'loading' | 'warning' = 'info') => {
      setMsg({ txt, type });
    },
    []
  );

  const createTempTrade = useCallback((ct: string, stake: number, mkt: string, dur: number, barrierDigit: number) => {
    const id = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const t: TTrade = {
      id,
      contractType: ct,
      stake,
      market: mkt,
      duration: dur,
      status: 'pending',
      timestamp: new Date(),
      marketFormat: mkt,
      temp: true,
      barrierDigit,
    };
    setTrades(prev => [t, ...prev]);
    // tag temp id to current run
    contractRunRef.current.set(id, runIdRef.current);
    return id;
  }, []);

  const getBalanceError = useCallback((e: any) => {
    const errorObj = e?.error ?? e;
    const message = (errorObj?.message || 'Unknown error').toString();
    const code = errorObj?.code || '';
    const isBalanceError =
      code === 'InsufficientBalance' || /insufficient|balance|fund|not enough|no enough|low balance/i.test(message);
    return { isBalanceError, message, code };
  }, []);

  const contractFor = useCallback((st: StrategyType) => (st === 'over' ? 'DIGITOVER' : 'DIGITUNDER'), []);

  const isRealAccount = useCallback(() => {
    // Deriv authorize response usually has authorize.is_virtual
    const info: any = api_base.account_info;
    const is_virtual = info?.is_virtual;
    if (typeof is_virtual === 'boolean') return !is_virtual;
    return false; // unknown => don't assume real
  }, []);

  const effectiveBuyGapMs = useCallback(() => {
    // On real accounts, be more conservative to avoid hitting buy throttles.
    // Keep your base logic, just add a safety floor for real.
    return isRealAccount() ? Math.max(MIN_BUY_GAP_MS, 1200) : MIN_BUY_GAP_MS;
  }, [isRealAccount]);

  /* ===== HARD STOP (TP/SL/manual) ===== */
  const hardStop = useCallback(
    (reason: 'tp' | 'sl' | 'manual') => {
      stopRequestedRef.current = true;
      isRunningRef.current = false;
      setIsRunning(false);
      if (reason === 'manual') setStatus('Bot stopped', 'info');
    },
    [setStatus]
  );

  /* ===== Session P/L apply + TP/SL ===== */
  const applyPnLAndMaybeStop = useCallback(
    (delta: number) => {
      setSessionPL(prev => {
        const next = Number((prev + delta).toFixed(2));
        const { tp, sl } = locked.current;
        if (!stopRequestedRef.current && isRunningRef.current) {
          if (tp > 0 && next >= tp) {
            stopRequestedRef.current = true;
            setStatus(`🎉 Take Profit hit: +$${next.toFixed(2)} (session)`, 'success');
            hardStop('tp');
          } else if (sl > 0 && -next >= sl) {
            stopRequestedRef.current = true;
            setStatus(`🛑 Stop Loss hit: -$${Math.abs(next).toFixed(2)} (session)`, 'error');
            hardStop('sl');
          }
        }
        return next;
      });
    },
    [hardStop, setStatus]
  );

  const currentBarrierDigit = () => {
    const d = locked.current.digits;
    if (!d.length) return 2;
    const i = Math.max(0, Math.min(predIndexRef.current, d.length - 1));
    return d[i];
  };

  /* ===== Account-switch safe: API epoch + re-subscription (fixed listener leak) ===== */
  const [apiEpoch, setApiEpoch] = useState(0);

  useEffect(() => {
    const api = api_base.api as any;
    const conn = api?.connection;
    if (!conn) return;

    const bump = () => setApiEpoch(x => x + 1);

    conn.addEventListener('open', bump);
    conn.addEventListener('close', bump);

    return () => {
      try {
        conn.removeEventListener('open', bump);
      } catch {
        /* ignore */
      }
      try {
        conn.removeEventListener('close', bump);
      } catch {
        /* ignore */
      }
    };
  }, [tradingSocketGeneration]);

  /* ===== API readiness + throttle ===== */
  const ensureApiReady = useCallback(async () => {
    const OPEN = 1 as const;
    const conn = (api_base.api as any)?.connection;
    if (!conn || conn.readyState !== OPEN) {
      await api_base.init(true); // recreate + authorize + resubscribe
    }
  }, []);

  const waitForThrottleGap = useCallback(async () => {
    const gap = effectiveBuyGapMs();
    const now = Date.now();
    const delta = now - (lastBuyTsRef.current || 0);
    if (delta < gap) {
      await sleep(gap - delta);
    }
    lastBuyTsRef.current = Date.now();
  }, [effectiveBuyGapMs]);

  /* ===== RateLimit-aware send wrapper (must-have) ===== */
  const sendWithRateLimitBackoff = useCallback(
    async <T,>(
      action: () => Promise<T>,
      opts?: {
        maxRetries?: number;
        baseDelayMs?: number;
        maxDelayMs?: number;
        onRetryStatus?: (text: string) => void;
      }
    ): Promise<T> => {
      const maxRetries = opts?.maxRetries ?? 6;
      const baseDelayMs = opts?.baseDelayMs ?? 900; // start a bit higher for real stability
      const maxDelayMs = opts?.maxDelayMs ?? 20000;

      let lastErr: any = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (!isRunningRef.current || stopRequestedRef.current) {
          // Stop requested — abort retries silently.
          throw lastErr ?? new Error('Stopped');
        }

        try {
          const res = await action();
          // some Deriv wrappers return { error: ... } in resolved payload
          const anyRes: any = res as any;
          if (anyRes?.error) throw anyRes;
          return res;
        } catch (e: any) {
          lastErr = e;

          const errObj = e?.error ?? e;
          const code = errObj?.code ?? '';
          const message = (errObj?.message ?? '').toString();

          const isRate =
            code === 'RateLimit' ||
            code === 'TooManyRequests' ||
            /rate\s*limit|too\s*many\s*requests/i.test(message);

          const isDisconnect = code === 'DisconnectError' || /disconnect/i.test(message);

          if (!isRate && !isDisconnect) {
            throw e;
          }

          // prevent overlapping backoff loops (ghost retries)
          if (backoffInFlightRef.current) {
            throw e;
          }
          backoffInFlightRef.current = true;

          try {
            // If disconnected, try to re-init and retry
            if (isDisconnect) {
              if (attempt >= maxRetries) throw e;
              opts?.onRetryStatus?.('🔌 Disconnected — reconnecting…');
              await ensureApiReady();
              // small wait to let subscriptions settle
              await sleep(600);
              continue;
            }

            // RateLimit: respect server hint if available, else exponential backoff
            const hinted = parseRetryAfterMs(message);
            const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
            const waitMs = Math.max(600, hinted ?? exp);

            // small jitter so we don't collide with server windows
            const jitter = Math.floor(Math.random() * 250);
            const finalWait = Math.min(maxDelayMs, waitMs + jitter);

            if (attempt >= maxRetries) throw e;

            opts?.onRetryStatus?.(`⏳ Rate limit — retrying in ${(finalWait / 1000).toFixed(1)}s…`);
            await sleep(finalWait);
          } finally {
            backoffInFlightRef.current = false;
          }
        }
      }

      throw lastErr ?? new Error('Failed after retries');
    },
    [ensureApiReady]
  );

  /* ===== BUY: stake comes from martingale or base ===== */
  const buyContract = useCallback(
    async (stake: number) => {
      if (!isRunningRef.current || stopRequestedRef.current) return;

      // ✅ prevent double-buys from overlapping triggers
      if (buyInFlightRef.current) return;
      buyInFlightRef.current = true;

      const ct = contractFor(locked.current.strat);
      const mkt = locked.current.market;
      const dur = locked.current.ticks;
      const barrierDigit = currentBarrierDigit();
      const barrier = String(barrierDigit);

      let tmpID: string | null = null;

      try {
        // Ensure socket ready + respect global buy gap
        await ensureApiReady();
        await waitForThrottleGap();

        tmpID = createTempTrade(ct, stake, mkt, dur, barrierDigit);

        const doBuy = async () => {
          const api = api_base.api as any;
          if (!api) throw new Error('API not ready');
          return sendDerivSessionContractPurchase(d => api.send(d), {
            contract_type: ct,
            market: mkt,
            duration: dur,
            stake,
            barrier,
          });
        };

        // ✅ MUST-HAVE: rate limit aware backoff + retry
        const resp: any = await sendWithRateLimitBackoff(doBuy, {
          maxRetries: isRealAccount() ? 8 : 4,
          baseDelayMs: isRealAccount() ? 1100 : 700,
          maxDelayMs: 25000,
          onRetryStatus: text => {
            // don’t spam if user stopped
            if (isRunningRef.current && !stopRequestedRef.current) setStatus(text, 'warning');
          },
        });

        if (stopRequestedRef.current) return;

        const realID = String((resp as any).buy?.contract_id ?? '');
        if (!realID) throw new Error('No contract_id in buy response');

        // ✅ tag real contract_id to this run (prevents old contracts triggering new buys)
        contractRunRef.current.set(realID, runIdRef.current);

        // cleanup temp mapping
        if (tmpID) contractRunRef.current.delete(tmpID);

        setTrades(ts =>
          ts.map(t => (t.id === tmpID ? { ...t, id: realID, temp: false, status: 'open' } : t))
        );

        setStatus('✅ Trade placed', 'success');
        return realID;
      } catch (e: any) {
        const { isBalanceError, message, code } = getBalanceError(e);

        // Update only our temp trade (not all temps)
        if (tmpID) {
          setTrades(ts =>
            ts.map(t =>
              t.id === tmpID
                ? {
                    ...t,
                    status: 'error',
                    temp: false,
                    errorReason: isBalanceError
                      ? 'Insufficient balance'
                      : code === 'RateLimit'
                      ? 'Rate limit'
                      : 'Trade failed',
                    errorDetails: message,
                    closeTime: new Date(),
                  }
                : t
            )
          );
        }

        setStatus(message || 'Trade failed', 'error');

        // If we hit RateLimit and exhausted retries, pause the scheduler a bit (extra safety)
        const msgText = (e?.error?.message ?? e?.message ?? '').toString();
        const errCode = e?.error?.code ?? e?.code;
        if (errCode === 'RateLimit' || /rate\s*limit/i.test(msgText)) {
          clearNextTimer();
          // backoff a little before allowing the next schedule cycle
          nextTimerRef.current = window.setTimeout(() => {
            // only continue if still running
            if (isRunningRef.current && !stopRequestedRef.current) {
              // next will be scheduled by settle; this is just a cooling-off window
              setStatus('✅ Cooldown complete — waiting for next settlement / trigger…', 'info');
            }
          }, 2500);
        }

        return;
      } finally {
        buyInFlightRef.current = false;
      }
    },
    [
      contractFor,
      createTempTrade,
      ensureApiReady,
      getBalanceError,
      isRealAccount,
      sendWithRateLimitBackoff,
      setStatus,
      waitForThrottleGap,
      clearNextTimer,
    ]
  );

  /* ===== Scheduler: delay after settlement ===== */
  const scheduleNext = useCallback(
    (why: 'start' | 'win' | 'loss') => {
      if (!isRunningRef.current || stopRequestedRef.current) return;

      // ✅ capture run id to avoid old timers buying into new session
      const myRunId = runIdRef.current;

      const run = async () => {
        if (runIdRef.current !== myRunId) return;
        if (!isRunningRef.current || stopRequestedRef.current) return;

        const mi = isNum(martingaleInputRef.current) ? martingaleInputRef.current : 1;
        const useMg = mi > 1;
        const stake = useMg ? martingale.current.current : locked.current.S;

        await buyContract(stake);
      };

      if (why === 'start') {
        clearNextTimer();
        run();
      } else {
        clearNextTimer();
        nextTimerRef.current = window.setTimeout(run, DELAY_AFTER_SETTLE_MS);
      }
    },
    [buyContract, clearNextTimer]
  );

  /* ===== Settlement: martingale + digit switching ===== */
  const handleSettle = useCallback(
    (cid: string, net: number) => {
      const won = net >= 0;

      // Session P/L + TP/SL logic
      applyPnLAndMaybeStop(net);

      if (!isRunningRef.current || stopRequestedRef.current) return;

      // Martingale update (single-mode)
      const mi = isNum(martingaleInputRef.current) ? martingaleInputRef.current : 1;
      const useMg = mi > 1;
      if (useMg) {
        if (won) {
          martingale.current.current = martingale.current.base;
          martingale.current.step = 0;
        } else {
          if (martingale.current.step < martingale.current.maxSteps) {
            martingale.current.step += 1;
            martingale.current.current = Number((martingale.current.current * mi).toFixed(2));
          } else {
            martingale.current.current = martingale.current.base;
            martingale.current.step = 0;
          }
        }
      }

      const digits = locked.current.digits;
      const k = digits.length || 0;
      const isLoss = net < 0;
      const currentIndex = Math.max(0, Math.min(predIndexRef.current, Math.max(0, k - 1)));

      // NO switching possible if <2 digits
      if (k < 2) {
        if (!isLoss) {
          lossesSinceSwitchRef.current = 0;
        } else {
          lossesSinceSwitchRef.current += 1;
        }
        scheduleNext(isLoss ? 'loss' : 'win');
        return;
      }

      // ===== Mode 1: Main Digit Recovery =====
      if (mainDigitRecoveryRef.current) {
        // main digit is index 0
        if (!isLoss) {
          // WIN
          if (currentIndex === 0) {
            lossesSinceSwitchRef.current = 0;
          } else {
            predIndexRef.current = 0;
            lossesSinceSwitchRef.current = 0;
            setStatus(`✅ Recovery win on D${digits[currentIndex]} → resetting to main D${digits[0]}`, 'success');
          }
          scheduleNext('win');
          return;
        }

        // LOSS
        if (currentIndex === 0) {
          lossesSinceSwitchRef.current += 1;
          const N = Math.max(1, Math.min(7, locked.current.switchEvery));
          if (lossesSinceSwitchRef.current >= N && k > 1) {
            predIndexRef.current = 1;
            lossesSinceSwitchRef.current = 0;
            setStatus(`↔️ Switched from main D${digits[0]} to D${digits[1]} after ${N} loss step(s)`, 'info');
          }
          scheduleNext('loss');
          return;
        }

        // currentIndex > 0 (on a recovery digit)
        lossesSinceSwitchRef.current = 0;

        if (currentIndex < k - 1) {
          const oldDigit = digits[currentIndex];
          const nextDigit = digits[currentIndex + 1];
          predIndexRef.current = currentIndex + 1;
          setStatus(`↔️ Loss on D${oldDigit} → switching to D${nextDigit}`, 'info');
        } else {
          setStatus(`⚠️ Loss on last digit D${digits[currentIndex]} — staying until recovery win`, 'warning');
        }

        scheduleNext('loss');
        return;
      }

      // ===== Mode 2: ORIGINAL behavior (sequential rotation) =====
      if (isLoss) {
        lossesSinceSwitchRef.current += 1;
        const N = Math.max(1, Math.min(7, locked.current.switchEvery));
        if (lossesSinceSwitchRef.current >= N) {
          predIndexRef.current = (currentIndex + 1) % k;
          lossesSinceSwitchRef.current = 0;
          setStatus(`↔️ Switched prediction to D${currentBarrierDigit()} after ${N} loss step(s)`, 'info');
        }
      } else {
        lossesSinceSwitchRef.current = 0;
      }

      scheduleNext(isLoss ? 'loss' : 'win');
    },
    [applyPnLAndMaybeStop, scheduleNext, setStatus]
  );

  /* ===== POC stream (single truth for entry/exit/PL) — account-switch safe ===== */
  useEffect(() => {
    const api = api_base.api as any;
    if (!api?.onMessage) return;

    const sub = api.onMessage().subscribe(({ data }: any) => {
      if (data?.error) {
        // Don't hard-stop here; buy backoff handles trading errors.
        // This is mainly for unexpected WS errors.
        // eslint-disable-next-line no-console
        console.error('WS error', data.error);
        return;
      }

      if (data?.msg_type === 'proposal_open_contract') {
        const c = data.proposal_open_contract;
        const cidStr = String(c.contract_id);

        setTrades(prev =>
          prev.map(tr => {
            if (tr.id !== cidStr) return tr;

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

        // When finished, apply session logic once
        const finished = c.is_sold || c.is_expired || c.is_settleable || c.status === 'sold';
        if (finished) {
          if (!settledContractsRef.current.has(cidStr)) {
            settledContractsRef.current.add(cidStr);

            // ✅ GHOST BUY FIX:
            // Only allow a finished contract to schedule the next trade if it belongs to THIS run.
            const cidRun = contractRunRef.current.get(cidStr);
            if (cidRun !== undefined && cidRun !== runIdRef.current) {
              return;
            }

            const net = Number(c.profit ?? 0);
            handleSettle(cidStr, net);
          }
        }
      }
    });

    return () => sub.unsubscribe();
  }, [apiEpoch, handleSettle, tradingSocketGeneration]);

  /* ===== Aggregate P/L ===== */
  useEffect(() => {
    setPL(trades.reduce((s, t) => s + (t.profit ?? 0), 0));
  }, [trades]);

  /* ===== Start / Stop / Reset ===== */
  const startBot = useCallback(() => {
    if (activeDigits.length === 0) {
      setStatus('Select at least 1 prediction digit (0–9).', 'warning');
      return;
    }
    if (activeDigits.length > 4) {
      setStatus('Select up to 4 digits.', 'warning');
      return;
    }
    if (strategy === 'over' && activeDigits.includes(9)) {
      setStatus('Over 9 never resets (unwinnable). Remove 9.', 'warning');
      return;
    }
    if (strategy === 'under' && activeDigits.includes(0)) {
      setStatus('Under 0 never resets (unwinnable). Remove 0.', 'warning');
      return;
    }

    const N = Math.max(1, Math.min(7, Number(switchEvery || 1)));

    // Lock runtime config
    locked.current = {
      S: stakeInput,
      strat: strategy,
      market,
      ticks,
      tp: tpInput,
      sl: slInput,
      switchEvery: N,
      digits: [...activeDigits],
    };

    // init martingale base from locked S
    const base = locked.current.S > 0 ? locked.current.S : 0.35;
    martingale.current.base = base;
    martingale.current.current = base;
    martingale.current.step = 0;

    predIndexRef.current = 0;
    lossesSinceSwitchRef.current = 0;
    setSessionPL(0);
    stopRequestedRef.current = false;
    settledContractsRef.current.clear();

    // reset throttle clock so first buy is immediate
    lastBuyTsRef.current = 0;

    // ✅ new run + clear any old scheduled buys (prevents ghost buys)
    clearNextTimer();
    runIdRef.current += 1;

    // tag currently running session
    isRunningRef.current = true;
    setIsRunning(true);

    const mi = isNum(martingaleInput) ? martingaleInput : 1;

    setStatus(
      `Bot started (${strategy.toUpperCase()} ; digits: ${locked.current.digits.join(', ')} ; ${
        mainDigitRecovery
          ? 'Main digit recovery'
          : `switch every ${N} loss step${N > 1 ? 's' : ''}`
      } · Martingale ${mi > 1 ? `×${mi.toFixed(2)}` : 'off'} · Delay ${DELAY_AFTER_SETTLE_MS / 1000}s · Min buy gap ${
        effectiveBuyGapMs() as number
      }ms${isRealAccount() ? ' (real safe)' : ''})`,
      'success'
    );

    // first trade: immediate buy, not tied to ticks
    scheduleNext('start');
  }, [
    activeDigits,
    stakeInput,
    strategy,
    market,
    ticks,
    tpInput,
    slInput,
    switchEvery,
    setStatus,
    scheduleNext,
    martingaleInput,
    mainDigitRecovery,
    clearNextTimer,
    effectiveBuyGapMs,
    isRealAccount,
  ]);

  const stopBot = useCallback(() => {
    clearNextTimer();
    hardStop('manual');
  }, [clearNextTimer, hardStop]);

  const handleReset = useCallback(() => {
    if (isRunningRef.current) return;
    clearNextTimer();
    setTrades([]);
    setPL(0);
    setSessionPL(0);
    lossesSinceSwitchRef.current = 0;
    predIndexRef.current = 0;
    settledContractsRef.current.clear();
    contractRunRef.current.clear();
    setStatus('History cleared', 'info');
  }, [clearNextTimer, setStatus]);

  /* ===== Stats ===== */
  const tradeStats = useMemo(() => {
    const completed = trades.filter(t => t.status === 'won' || t.status === 'lost');
    return {
      total: completed.length,
      won: completed.filter(t => t.status === 'won').length,
      lost: completed.filter(t => t.status === 'lost').length,
    };
  }, [trades]);

  /* ===== UI helpers ===== */
  const toggleDigit = (d: number) => {
    setActiveDigits(prev => {
      const exists = prev.includes(d);
      if (exists) return prev.filter(x => x !== d);
      if (prev.length >= 4) return prev;
      return [...prev, d];
    });
  };
  const isDigitActive = (d: number) => activeDigits.includes(d);

  const nextStakeDisplay = (() => {
    const mi = isNum(martingaleInput) ? martingaleInput : 1;
    const useMg = mi > 1;
    return useMg ? martingale.current.current : locked.current.S;
  })();

  return (
    <div className="recover">
      <div className="history-title">
        <div className="eve">
          <MarketDerivedJump100Icon width={18} height={18} />
          Same Stake Recovery
          <MarketDerivedJump100Icon width={16} height={16} />
        </div>
        <div
          className="youtube"
          role="button"
          tabIndex={0}
          aria-label="Play tutorial video"
          onClick={() => setYtOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setYtOpen(true);
            }
          }}
        >
          <SocialYoutubeBlackIcon width={16} height={16} />
        </div>
      </div>

      <div className="trading-container">
        <LazyYouTubeModal videoUrl={YT_URL} isOpen={ytOpen} onClose={() => setYtOpen(false)} />

        <div className="trade-controls">
          <div className="trade-control-group market-selector">
            <label>Market</label>
            <select
              value={market}
              onChange={e => setMarket(e.target.value)}
              disabled={isRunning}
              className="trade-input"
            >
              <option value="R_10">Vol 10</option>
              <option value="1HZ10V">Vol 10 (1s)</option>
              <option value="1HZ15V">Vol 15 (1s)</option>
              <option value="R_25">Vol 25</option>
              <option value="1HZ25V">Vol 25 (1s)</option>
              <option value="1HZ30V">Vol 30 (1s)</option>
              <option value="R_50">Vol 50</option>
              <option value="1HZ50V">Vol 50 (1s)</option>
              <option value="R_75">Vol 75</option>
              <option value="1HZ75V">Vol 75 (1s)</option>
              <option value="1HZ90V">Vol 90 (1s)</option>
              <option value="R_100">Vol 100</option>
              <option value="1HZ100V">Vol 100 (1s)</option>
              <option value="JD10">Jump 10</option>
              <option value="JD25">Jump 25</option>
              <option value="JD50">Jump 50</option>
              <option value="JD75">Jump 75</option>
              <option value="JD100">Jump 100</option>
            </select>
          </div>

          <div className="trade-control-group">
            <label>Stake</label>
            <input
              type="number"
              className="trade-input"
              value={stakeStr}
              onChange={e => setStakeStr(e.target.value)}
              min={0}
              step="any"
              disabled={isRunning}
            />
          </div>

          <div className="trade-control-group">
            <label>Strategy</label>
            <select
              className="trade-input"
              value={strategy}
              onChange={e => setStrategy(e.target.value as StrategyType)}
              disabled={isRunning}
            >
              <option value="over">Over</option>
              <option value="under">Under</option>
            </select>
          </div>

          {/* Digit selector */}
          <div className="trade-control-group">
            <label>Predictions 4(max)</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 6 }}>
              {Array.from({ length: 10 }, (_, d) => {
                const active = isDigitActive(d);
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={isRunning}
                    onClick={() => toggleDigit(d)}
                    title={active ? 'Click to remove' : 'Click to add'}
                    style={{
                      border: `1px solid ${active ? '#1a73e8' : 'var(--border-normal)'}`,
                      borderRadius: '50%',
                      color: active ? '#8B0000' : 'var(--text-general)',
                      fontWeight: 600,
                      fontSize: '12px',
                      textAlign: 'center',
                      cursor: isRunning ? 'not-allowed' : 'pointer',
                      boxShadow: active ? '0 0 8px rgba(26, 115, 232, 0.4)' : 'none',
                      transform: active ? 'scale(1.05)' : 'scale(1)',
                      transition: 'all 0.2s ease',
                      opacity: isRunning ? 0.6 : 1,
                    }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
              Recovery: {activeDigits.length ? activeDigits.join(' → ') : '—'}
            </div>
          </div>

          <div className="trade-control-group">
            <label>Switch after (loss steps)</label>
            <input
              type="number"
              className="trade-input"
              value={switchEvery}
              onChange={e => setSwitchEvery(Math.max(1, Math.min(7, Number(e.target.value || 1))))}
              min={1}
              max={7}
              disabled={isRunning}
            />
          </div>

          {/* Main digit recovery toggle */}
          <div className="trade-control-group">
            <label>Main digit recovery</label>
            <button
              type="button"
              onClick={() => setMainDigitRecovery(v => !v)}
              disabled={isRunning}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 4,
                border: '1px solid #333',
                background: mainDigitRecovery ? '#2e7d32' : '#424242',
                color: '#fff',
                fontWeight: 600,
                cursor: isRunning ? 'not-allowed' : 'pointer',
              }}
              title={
                'ON: D1 is main. After N losses on D1 → D2; middle digits move forward on loss; ' +
                'last digit sticks until win; any non-main win resets back to D1.'
              }
            >
              {mainDigitRecovery ? 'Main mode: ON' : 'Main mode: OFF'}
            </button>
          </div>

          {/* Martingale input */}
          <div className="trade-control-group">
            <label>Martingale ×</label>
            <input
              type="number"
              className="trade-input"
              value={martingaleInput === '' ? '' : String(martingaleInput)}
              onChange={e => setMartingaleInput(e.target.value === '' ? '' : Number(e.target.value))}
              min={1}
              step={0.01}
              disabled={isRunning}
              title=">1 enables martingale; 1 disables"
            />
          </div>

          <div className="trade-control-group">
            <label>Take Profit</label>
            <input
              type="number"
              className="trade-input"
              value={tpStr}
              onChange={e => setTpStr(e.target.value)}
              min={0}
              step="any"
              disabled={isRunning}
              placeholder="0 to disable"
            />
          </div>

          <div className="trade-control-group">
            <label>Stop Loss</label>
            <input
              type="number"
              className="trade-input"
              value={slStr}
              onChange={e => setSlStr(e.target.value)}
              min={0}
              step="any"
              disabled={isRunning}
              placeholder="0 to disable"
            />
          </div>

          <div className="trade-control-group">
            <label>Ticks</label>
            <select
              className="trade-input"
              value={ticks}
              onChange={e => setTicks(parseInt(e.target.value, 10))}
              disabled={isRunning}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </div>

          <div className="trade-control-group">
            <label
              className="start"
              style={{
                display: 'flex',
                alignItems: 'center',
                fontWeight: 'bold',
                fontSize: '15px',
                gap: '4px',
                cursor: 'pointer',
              }}
            >
              <LegacyPlayFillIcon width={20} height={20} /> Run
            </label>

            <button
              className={`auto-trade-toggle ${isRunning ? 'on' : 'off'}`}
              onClick={isRunning ? () => stopBot() : () => startBot()}
              style={{
                padding: '.8rem .12rem',
                background: isRunning ? 'linear-gradient(90deg,#4285F4,#34a853)' : '#E6A85C',
                color: '#fff',
                border: '1px solid #222',
                justifyContent: 'center',
                display: 'flex',
                borderRadius: '4px',
                fontWeight: 'bold',
              }}
              title="One trade per settlement; same stake recovery · optional martingale"
            >
              {isRunning ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        <div className="title">
          <small>Type|Market</small>
          <small>Entry|Exit spot</small>
          <small>Buy price & P/L</small>
        </div>

        <div className="open-positions">
          {trades.length === 0 ? (
            <div className="no-positions">
              <small>No positions</small>
            </div>
          ) : (
            trades.map(tr => (
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
                  <div className="position-market-contract">
                    {marketIcons[tr.market] || <span>{tr.market}</span>}
                    {contractIcons[tr.contractType] || <span>{tr.contractType}</span>}
                    <span style={{ marginLeft: 6, fontWeight: 600 }}>D{tr.barrierDigit ?? '—'}</span>
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

        {!isRunning && (
          <div className="trade-control-group">
            <label>&nbsp;</label>
            <button className="trade-btn reset-btn" onClick={handleReset} title="Clear results and P/L">
              Reset
            </button>
          </div>
        )}
      </div>

      <div className="trade-status">
        <div>
          {msg.txt}
          {isRunning && (
            <span style={{ marginLeft: 10 }}>
              🔁 1 trade per settlement · Mode: <b>{mainDigitRecovery ? 'Main digit recovery' : 'Sequential switch'}</b>{' '}
              · Delay after settle: <b>{DELAY_AFTER_SETTLE_MS / 1000}s</b> · Min buy gap:{' '}
              <b>{effectiveBuyGapMs()}ms</b>
              {isRealAccount() ? <b> · (real safe)</b> : null}
            </span>
          )}
        </div>
        <div style={{ marginTop: 6 }}>
          Martingale:{' '}
          {isNum(martingaleInput) && martingaleInput > 1 ? (
            <>
              <b>ON ×{martingaleInput.toFixed(2)}</b> · step{' '}
              <b>
                {martingale.current.step}/{martingale.current.maxSteps}
              </b>{' '}
              · Current stake <b>${martingale.current.current.toFixed(2)}</b>
            </>
          ) : (
            <b>off</b>
          )}
          <span style={{ marginLeft: 12 }}>
            Toward main switch (losses on D{locked.current.digits[0]}): <b>{lossesSinceSwitchRef.current}</b>
          </span>
          <span style={{ marginLeft: 12 }}>
            Next stake: <b>${nextStakeDisplay.toFixed(2)}</b>
          </span>
          <span style={{ marginLeft: 12 }}>
            Current: <b>{locked.current.strat.toUpperCase()} D{currentBarrierDigit()}</b>
          </span>
          <span style={{ marginLeft: 12 }}>
            Selected: <b>{locked.current.digits.join(', ')}</b>
          </span>
          <span style={{ marginLeft: 12 }}>
            Session P/L: <b>{sessionPL >= 0 ? '+' : '-'}${Math.abs(sessionPL).toFixed(2)}</b>
          </span>
        </div>
      </div>

      <div className="performance-stats">
        <div className="stat-item">
          <div className="stat-title">Total P/L</div>
          <div className={`stat-value ${profitLoss >= 0 ? 'profit' : 'loss'}`}>
            {profitLoss >= 0 ? '+' : ''}${Math.abs(profitLoss).toFixed(2)} USD
          </div>
        </div>
        <div className="stat-item">
          <div className="stat-title">No. of runs</div>
          <div className="stat-value">{tradeStats.total}</div>
        </div>
        <div className="stat-item">
          <div className="stat-title">Won</div>
          <div className="stat-value profit">{tradeStats.won}</div>
        </div>
        <div className="stat-item">
          <div className="stat-title">Lost</div>
          <div className="stat-value loss">{tradeStats.lost}</div>
        </div>
      </div>
    </div>
  );
}
