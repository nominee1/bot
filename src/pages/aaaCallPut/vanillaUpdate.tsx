// src/pages/aaaStrategies/vanilla/VanillaCallPut.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import './VanillaCallPut.scss';

const MARKET_NAMES: Record<string, string> = {
  R_10: 'Volatility 10 Index',
  '1HZ10V': 'Volatility 10(1s) Index',
  R_25: 'Volatility 25 Index',
  '1HZ25V': 'Volatility 25(1s) Index',
  R_50: 'Volatility 50 Index',
  '1HZ50V': 'Volatility 50(1s) Index',
  R_75: 'Volatility 75 Index',
  '1HZ75V': 'Volatility 75(1s) Index',
  R_100: 'Volatility 100 Index',
  '1HZ100V': 'Volatility 100(1s) Index',
};

type TradeMode = 'vanilla' | 'touch';
type VanillaDir = 'CALL' | 'PUT';
type TouchDir = 'TOUCH' | 'NO_TOUCH';

type TProposal = {
  id: string;
  ask_price: number;
  payout?: number;
  barrier_choices?: string[];
  contract_details?: { barrier?: string };
  longcode?: string;
  spot?: number;
  min_stake?: number;
  max_stake?: number;
};

type QuoteResult = {
  proposalId: string;
  askPrice: number;
  payout: number;
  strikeOrBarrier: number;
  longcode: string;
};

type TAnyContract = {
  contract_id: string;
  symbol: string;

  mode: TradeMode;
  dir: VanillaDir | TouchDir;

  stake: number;
  barrier_offset: string;

  // locked at buy time (for Vanilla this is strike, for Touch/No Touch this is barrier target)
  profit_line: number;

  status: string;
  profit: number;
  bid_price: number | null;
  is_valid_to_sell: boolean;

  longcode?: string;
  date_start?: number;
  date_expiry?: number;
};

const clampInt = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(v)));
const clampNum = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const fmtTime = (ts?: number) => (ts ? new Date(ts * 1000).toLocaleString() : '—');
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const safeErrText = (e: any) => {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (e?.message) return e.message;
  if (e?.error?.message) return e.error.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
};

const CUSTOM_BARRIER = '__custom__';

const normalizeBarrier = (raw: string): string | null => {
  const t = String(raw ?? '').trim();
  if (!t) return null;

  const n = Number(t);
  if (!Number.isFinite(n)) return null;

  // keep it simple: relative barriers for Touch/No Touch + Vanilla offsets typically work like +X / -X
  const sign = n >= 0 ? '+' : '';
  // don't over-force decimals for markets with different steps; still keep 2 as a neat default
  return `${sign}${n.toFixed(2)}`;
};

const parseAvailableBarriersFromError = (msg: string): string[] | null => {
  const m = msg.match(/Barriers available are\s+(.+?)(?:\.\s*|$)/i);
  if (!m) return null;

  const list = m[1]
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const cleaned = list
    .map(x => normalizeBarrier(x) ?? x)
    .filter(x => /^[-+]\d+(\.\d+)?$/.test(x) || /^\d+(\.\d+)?$/.test(x));

  return cleaned.length ? cleaned : list.length ? list : null;
};

const fmtLeft = (secondsLeft: number) => {
  if (!Number.isFinite(secondsLeft)) return '—';
  if (secondsLeft <= 0) return 'Expired';

  const s = Math.floor(secondsLeft);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  const hh = String(hours).padStart(2, '0');
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');

  return days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
};

const VanillaCallPut: React.FC = () => {
  const [symbol, setSymbol] = useState('R_100');

  // ✅ NEW: mode switch (Vanilla vs Touch/No Touch)
  const [mode, setMode] = useState<TradeMode>('vanilla');

  // Vanilla direction
  const [vanillaDir, setVanillaDir] = useState<VanillaDir>('CALL');

  // Touch / No Touch direction
  const [touchDir, setTouchDir] = useState<TouchDir>('TOUCH');

  const [amount, setAmount] = useState<number | ''>(10);
  const [currency] = useState('USD');
  const [basis] = useState<'stake' | 'payout'>('stake');

  const [duration, setDuration] = useState<number | ''>(5);
  const [durationUnit, setDurationUnit] = useState<'t' | 'm' | 'h' | 'd'>('m');

  const contractType = useMemo(() => {
    if (mode === 'vanilla') return vanillaDir === 'CALL' ? 'VANILLALONGCALL' : 'VANILLALONGPUT';
    return touchDir === 'TOUCH' ? 'ONETOUCH' : 'NOTOUCH';
  }, [mode, vanillaDir, touchDir]);

  const displayDir = useMemo(() => {
    if (mode === 'vanilla') return vanillaDir;
    return touchDir === 'TOUCH' ? 'TOUCH' : 'NO TOUCH';
  }, [mode, vanillaDir, touchDir]);

  // proposal-driven UI
  const [barrierChoices, setBarrierChoices] = useState<string[]>([]);
  const [barrier, setBarrier] = useState<string>('+0.00');

  // dropdown + manual input
  const [barrierSelect, setBarrierSelect] = useState<string>('+0.00');
  const [barrierInput, setBarrierInput] = useState<string>('+0.00');

  const [proposalId, setProposalId] = useState('');
  const [askPrice, setAskPrice] = useState(0);
  const [proposalPayout, setProposalPayout] = useState(0);

  // strike (vanilla) OR barrier target (touch/no touch)
  const [proposalStrike, setProposalStrike] = useState<number>(NaN);
  const [proposalLongcode, setProposalLongcode] = useState('');
  const [limits, setLimits] = useState<{ min?: number; max?: number }>({});

  // ticks
  const [spot, setSpot] = useState<number>(NaN);

  // contracts
  const [active, setActive] = useState<Record<string, TAnyContract>>({});
  const [recent, setRecent] = useState<TAnyContract[]>([]);

  // UI status
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [isBuying, setIsBuying] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSellingAll, setIsSellingAll] = useState(false);

  // “terminal clock”
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const nowSec = useMemo(() => Math.floor(now.getTime() / 1000), [now]);

  const liveOpenPL = useMemo(() => {
    const vals = Object.values(active);
    return vals.reduce((s, c) => s + (Number.isFinite(c.profit) ? c.profit : 0), 0);
  }, [active]);

  const openCount = useMemo(() => Object.keys(active).length, [active]);

  const sellableCount = useMemo(() => {
    const vals = Object.values(active);
    return vals.reduce((n, c) => n + (c.is_valid_to_sell ? 1 : 0), 0);
  }, [active]);

  const livePLClass = liveOpenPL > 0 ? 'pos' : liveOpenPL < 0 ? 'neg' : 'flat';

  // subscriptions
  const tickSubIdRef = useRef<string | null>(null);
  const pocSubsRef = useRef<Map<string, string>>(new Map());
  const closedIdsRef = useRef<Set<string>>(new Set());

  const quoteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const show = useCallback((msg: string, type: 'info' | 'error' | 'success' = 'info') => {
    setStatusMsg(msg);
    if (type === 'error') setError(msg);
    else setError(null);

    const fn = type === 'error' ? console.error : type === 'success' ? console.log : console.info;
    fn(msg);
  }, []);

  const note = useCallback((msg: string) => {
    console.info(msg);
    setStatusMsg(msg);
  }, []);

  const forgetSub = useCallback(async (subscription_id: string) => {
    try {
      await api_base.api.send({ forget: subscription_id });
    } catch {}
  }, []);

  const subscribeTicks = useCallback(
    async (sym: string) => {
      if (tickSubIdRef.current) {
        await forgetSub(tickSubIdRef.current);
        tickSubIdRef.current = null;
      }
      setSpot(NaN);

      try {
        const resp = await api_base.api.send({ ticks: sym, subscribe: 1 });
        const sub_id = resp?.subscription?.id;
        if (sub_id) tickSubIdRef.current = String(sub_id);
      } catch (e: any) {
        show(`Ticks subscribe failed: ${safeErrText(e)}`, 'error');
      }
    },
    [forgetSub, show]
  );

  /**
   * Quote:
   * - Touch/No Touch payout will naturally change with duration/ticks (risk/probability changes),
   *   and proposal.payout reflects that. We display it.
   */
  const requestProposal = useCallback(
    async (reason: string): Promise<QuoteResult | null> => {
      setIsQuoting(true);
      setError(null);

      const amt = typeof amount === 'number' ? amount : 10;
      const dur = typeof duration === 'number' ? duration : 5;

      const payload = {
        proposal: 1,
        amount: amt,
        basis,
        currency,
        symbol,
        contract_type: contractType,
        duration: dur,
        duration_unit: durationUnit,
        barrier: barrier || '+0.00',
      };

      try {
        const resp = await api_base.api.send(payload);

        if (resp?.error) throw new Error(resp.error.message || 'Deriv returned an error');

        const p: TProposal | undefined = resp?.proposal;
        if (!p?.id) throw new Error('No proposal returned');

        const pid = String(p.id);
        const ask = Number(p.ask_price ?? 0);
        const payout = Number(p.payout ?? 0);

        const bc = Array.isArray(p.barrier_choices) ? p.barrier_choices : [];
        const strikeStr = p.contract_details?.barrier;
        const strikeOrBarrier = strikeStr != null ? Number(strikeStr) : NaN;
        const longcode = p.longcode || '';

        if (!isMountedRef.current) return null;

        setProposalId(pid);
        setAskPrice(ask);
        setProposalPayout(payout);

        // barrier choices (do not overwrite custom mode)
        if (bc.length) {
          setBarrierChoices(bc);

          if (barrierSelect !== CUSTOM_BARRIER) {
            let nextBarrier = barrier;

            if (nextBarrier && bc.includes(nextBarrier)) {
              // keep
            } else if (bc.includes('+0.00')) {
              nextBarrier = '+0.00';
            } else {
              nextBarrier = bc[0];
            }

            setBarrier(nextBarrier);
            setBarrierSelect(nextBarrier);
            setBarrierInput(nextBarrier);
          }
        } else {
          setBarrierChoices([]);
        }

        setProposalStrike(strikeOrBarrier);
        setProposalLongcode(longcode);
        setLimits({ min: p.min_stake, max: p.max_stake });

        if (typeof p.spot === 'number') setSpot(p.spot);

        show(`Quote ok (${reason})`, 'info');
        return { proposalId: pid, askPrice: ask, payout, strikeOrBarrier, longcode };
      } catch (e: any) {
        const msg = safeErrText(e);

        const avail = parseAvailableBarriersFromError(msg);
        if (avail?.length) {
          setBarrierChoices(avail);

          if (barrierSelect !== CUSTOM_BARRIER) {
            const next = avail.includes(barrier) ? barrier : avail[0];
            setBarrier(next);
            setBarrierSelect(next);
            setBarrierInput(next);
          }
        }

        show(`Proposal failed (${reason}): ${msg}`, 'error');
        return null;
      } finally {
        if (isMountedRef.current) setIsQuoting(false);
      }
    },
    [amount, barrier, basis, contractType, currency, duration, durationUnit, show, symbol, barrierSelect]
  );

  const subscribePOC = useCallback(
    async (contract_id: string) => {
      if (pocSubsRef.current.has(contract_id)) return;

      try {
        const resp = await api_base.api.send({
          proposal_open_contract: 1,
          contract_id,
          subscribe: 1,
        });
        const sub_id = resp?.subscription?.id;
        if (sub_id) pocSubsRef.current.set(contract_id, String(sub_id));
      } catch (e: any) {
        show(`Open-contract subscribe failed: ${safeErrText(e)}`, 'error');
      }
    },
    [show]
  );

  const unsubscribePOC = useCallback(
    async (contract_id: string) => {
      const sub_id = pocSubsRef.current.get(contract_id);
      if (!sub_id) return;
      await forgetSub(sub_id);
      pocSubsRef.current.delete(contract_id);
    },
    [forgetSub]
  );

  const moveToRecent = useCallback((c: TAnyContract) => {
    if (closedIdsRef.current.has(c.contract_id)) return;
    closedIdsRef.current.add(c.contract_id);
    setRecent(prev => [{ ...c }, ...prev].slice(0, 30));
  }, []);

  const buy = useCallback(async () => {
    if (isBuying) return;

    const amt = typeof amount === 'number' ? amount : 10;

    setIsBuying(true);
    try {
      const q = await requestProposal('pre-buy');
      if (!q?.proposalId) throw new Error('No quote available yet');

      // For both Vanilla and Touch/No Touch we want this to be available to display target/strike
      if (!Number.isFinite(q.strikeOrBarrier)) throw new Error('No strike/barrier yet. Wait for quote.');

      const resp = await api_base.api.send({
        buy: q.proposalId,
        price: Math.max(amt, q.askPrice || 0),
      });

      if (resp?.error) throw new Error(resp.error.message);
      const contract_id = String(resp?.buy?.contract_id || '');
      if (!contract_id) throw new Error('No contract_id in buy response');

      const newC: TAnyContract = {
        contract_id,
        symbol,
        mode,
        dir: mode === 'vanilla' ? vanillaDir : touchDir,
        stake: amt,
        barrier_offset: barrier,
        profit_line: q.strikeOrBarrier,

        status: 'open',
        profit: 0,
        bid_price: null,
        is_valid_to_sell: false,
        longcode: q.longcode,
      };

      setActive(prev => ({ ...prev, [contract_id]: newC }));
      show(`Bought ${mode === 'vanilla' ? 'Vanilla' : 'Touch/No Touch'} ${displayDir}: ${contract_id}`, 'success');
      await subscribePOC(contract_id);
    } catch (e: any) {
      show(`Buy failed: ${safeErrText(e)}`, 'error');
    } finally {
      setIsBuying(false);
    }
  }, [amount, barrier, displayDir, isBuying, mode, requestProposal, show, subscribePOC, symbol, touchDir, vanillaDir]);

  const sellNow = useCallback(
    async (contract_id: string) => {
      try {
        const resp = await api_base.api.send({ sell: contract_id, price: 0 });
        if (resp?.error) throw new Error(resp.error.message);
        show(`Sell success: ${contract_id}`, 'success');
      } catch (e: any) {
        show(`Sell failed: ${safeErrText(e)}`, 'error');
      }
    },
    [show]
  );

  const sellAllActive = useCallback(async () => {
    if (isSellingAll) return;

    const ids = Object.values(active)
      .filter(c => c.is_valid_to_sell)
      .map(c => c.contract_id);

    if (!ids.length) {
      show('No active contracts are available to sell yet (resale off).', 'info');
      return;
    }

    setIsSellingAll(true);
    setError(null);
    show(`Selling ${ids.length} active contract${ids.length === 1 ? '' : 's'}…`, 'info');

    let ok = 0;
    let fail = 0;

    for (const cid of ids) {
      if (!isMountedRef.current) break;

      try {
        const resp = await api_base.api.send({ sell: cid, price: 0 });
        if (resp?.error) throw new Error(resp.error.message);
        ok += 1;
        note(`Sell sent: ${cid.slice(-8)}`);
      } catch (e: any) {
        fail += 1;
        console.error(`Sell failed (${cid}):`, e);
      }

      await sleep(180);
    }

    if (!isMountedRef.current) return;

    setIsSellingAll(false);

    if (fail > 0) show(`Sell all done. Success: ${ok}, Failed: ${fail}.`, 'info');
    else show(`Sell all done. Success: ${ok}.`, 'success');
  }, [active, isSellingAll, note, show]);

  // Main message handler (ticks + POC updates)
  useEffect(() => {
    const sub = api_base.api.onMessage().subscribe(({ data }: any) => {
      if (!data) return;

      if (data.error) {
        show(data.error.message || 'API error', 'error');
        return;
      }

      if (data.msg_type === 'tick') {
        const q = data.tick?.quote;
        if (typeof q === 'number') setSpot(q);
        else if (typeof q === 'string') setSpot(parseFloat(q));
        return;
      }

      if (data.msg_type === 'proposal_open_contract') {
        const oc = data.proposal_open_contract;
        const contract_id = String(oc.contract_id || '');
        if (!contract_id) return;

        setActive(prev => {
          const old = prev[contract_id];
          if (!old) return prev;

          const updated: TAnyContract = {
            ...old,
            status: String(oc.status || old.status),
            profit: Number(oc.profit ?? old.profit ?? 0),
            bid_price: oc.bid_price != null ? Number(oc.bid_price) : old.bid_price,
            is_valid_to_sell: !!oc.is_valid_to_sell,
            date_start: oc.date_start ?? old.date_start,
            date_expiry: oc.date_expiry ?? old.date_expiry,
            longcode: oc.longcode ?? old.longcode,
          };

          if (updated.status !== 'open') {
            moveToRecent(updated);
            unsubscribePOC(contract_id).catch(() => {});
            const { [contract_id]: _, ...rest } = prev;
            return rest;
          }

          return { ...prev, [contract_id]: updated };
        });

        return;
      }

      if (data.msg_type === 'sell') {
        const cid = String(data.sell?.contract_id || '');
        if (cid) show(`Sell update: ${cid}`, 'info');
      }
    });

    return () => sub.unsubscribe();
  }, [moveToRecent, show, unsubscribePOC]);

  // init: ticks + initial quote
  useEffect(() => {
    subscribeTicks(symbol).catch(() => {});
    requestProposal('init').catch(() => {});
  }, [symbol, subscribeTicks, requestProposal]);

  // debounced quote when params change
  useEffect(() => {
    if (quoteDebounceRef.current) clearTimeout(quoteDebounceRef.current);
    quoteDebounceRef.current = setTimeout(() => {
      requestProposal('params change').catch(() => {});
    }, 300);

    return () => {
      if (quoteDebounceRef.current) clearTimeout(quoteDebounceRef.current);
      quoteDebounceRef.current = null;
    };
  }, [mode, vanillaDir, touchDir, amount, duration, durationUnit, barrier, contractType, requestProposal]);

  // cleanup
  useEffect(() => {
    return () => {
      if (quoteDebounceRef.current) clearTimeout(quoteDebounceRef.current);

      if (tickSubIdRef.current) {
        forgetSub(tickSubIdRef.current).catch(() => {});
        tickSubIdRef.current = null;
      }

      for (const [, subId] of pocSubsRef.current.entries()) {
        forgetSub(subId).catch(() => {});
      }
      pocSubsRef.current.clear();
    };
  }, [forgetSub]);

  const barrierOptions = useMemo(() => {
    const list = barrierChoices.length ? barrierChoices : ['+0.00'];
    return [...list, CUSTOM_BARRIER];
  }, [barrierChoices]);

  const customMode = barrierSelect === CUSTOM_BARRIER;

  const barrierLabel = mode === 'vanilla' ? 'Offset (Barrier)' : 'Barrier (Target Offset)';

  return (
    <div className="vanilla-cp">
      {/* floating forex-like status bar */}
      <div className="vc-floatbar">
        <div className="fb-left">
          <div className="fb-market">
            <span className="dot live" />
            <span className="market-name">{MARKET_NAMES[symbol] || symbol}</span>
            <span className="market-sub">
              Spot: <b>{Number.isFinite(spot) ? spot.toFixed(2) : '—'}</b>
            </span>
          </div>

          <div className="fb-clock">{now.toLocaleTimeString()}</div>
        </div>

        <div className="fb-right">
          <div className={`fb-pl ${livePLClass}`}>
            <span className="lbl">LIVE P/L</span>
            <span className="val">
              {liveOpenPL >= 0 ? '+' : ''}
              {liveOpenPL.toFixed(2)} {currency}
            </span>
          </div>

          <div className="fb-open">
            <span className="lbl">OPEN</span>
            <span className="val">{openCount}</span>
          </div>

          <button
            className="sell"
            onClick={sellAllActive}
            disabled={sellableCount === 0 || isSellingAll}
            title={sellableCount === 0 ? 'No resale-eligible contracts yet' : 'Sell all resale-eligible contracts'}
            style={{ marginLeft: 10, opacity: sellableCount === 0 || isSellingAll ? 0.6 : 1 }}
          >
            {isSellingAll ? 'Selling…' : `Sell All (${sellableCount})`}
          </button>
        </div>
      </div>

      <div className="vc-header">
        <div className="title">
          <h3>{mode === 'vanilla' ? 'Vanilla Call / Put' : 'Touch / No Touch'}</h3>
          <div className="sub">
            • live resale • live P/L
            {limits.min != null && limits.max != null && (
              <span className="limits">
                &nbsp;• Stake: {limits.min}–{limits.max} {currency}
              </span>
            )}
          </div>
        </div>

        {/* ✅ NEW: mode toggle */}
        <div className="dir-toggle" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className={mode === 'vanilla' ? 'active' : ''}
            onClick={() => {
              setMode('vanilla');
              // keep barrier; just requote
            }}
            title="Vanilla options"
          >
            VANILLA
          </button>
          <button
            className={mode === 'touch' ? 'active' : ''}
            onClick={() => {
              setMode('touch');
              // keep barrier; just requote
            }}
            title="Digital options: Touch / No Touch"
          >
            TOUCH/NO TOUCH
          </button>
        </div>
      </div>

      {/* Direction toggle depending on mode */}
      <div className="vc-header" style={{ paddingTop: 0 }}>
        {mode === 'vanilla' ? (
          <div className="dir-toggle">
            <button className={vanillaDir === 'CALL' ? 'active' : ''} onClick={() => setVanillaDir('CALL')}>
              CALL
            </button>
            <button className={vanillaDir === 'PUT' ? 'active' : ''} onClick={() => setVanillaDir('PUT')}>
              PUT
            </button>
          </div>
        ) : (
          <div className="dir-toggle">
            <button className={touchDir === 'TOUCH' ? 'active' : ''} onClick={() => setTouchDir('TOUCH')}>
              TOUCH
            </button>
            <button className={touchDir === 'NO_TOUCH' ? 'active' : ''} onClick={() => setTouchDir('NO_TOUCH')}>
              NO TOUCH
            </button>
          </div>
        )}
      </div>

      <div className="vc-grid">
        <div className="vc-card">
          <div className="row">
            <label>
              Market
              <select value={symbol} onChange={e => setSymbol(e.target.value)}>
                {Object.entries(MARKET_NAMES).map(([v, lbl]) => (
                  <option key={v} value={v}>
                    {lbl}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Duration
              <input
                type="number"
                min={1}
                step={1}
                value={duration}
                onChange={e => {
                  const v = e.target.value;
                  if (v === '') return setDuration('');
                  setDuration(clampInt(+v || 1, 1, 100000));
                }}
              />
            </label>

            <label>
              Unit
              <select value={durationUnit} onChange={e => setDurationUnit(e.target.value as any)}>
                <option value="t">ticks</option>
                <option value="m">minutes</option>
                <option value="h">hours</option>
                <option value="d">days</option>
              </select>
            </label>
          </div>

          <div className="row">
            <label>
              Stake ({currency})
              <input
                type="number"
                min={0.35}
                step={0.01}
                value={amount}
                onChange={e => {
                  const v = e.target.value;
                  if (v === '') return setAmount('');
                  setAmount(clampNum(+v || 0.35, 0.35, 2000));
                }}
              />
            </label>

            <label>
              {barrierLabel}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  value={barrierSelect}
                  onChange={e => {
                    const v = e.target.value;

                    setBarrierSelect(v);

                    if (v === CUSTOM_BARRIER) {
                      setBarrierInput(barrier);
                      return;
                    }

                    setBarrier(v);
                    setBarrierInput(v);
                  }}
                  disabled={barrierOptions.length === 0}
                  style={{ flex: 1 }}
                >
                  {barrierOptions
                    .filter((b, idx, arr) => arr.indexOf(b) === idx)
                    .map(b => (
                      <option key={b} value={b}>
                        {b === CUSTOM_BARRIER ? 'Custom…' : b}
                      </option>
                    ))}
                </select>

                {customMode && (
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="+0.00"
                    value={barrierInput}
                    onChange={e => {
                      const raw = e.target.value;
                      setBarrierInput(raw);

                      const norm = normalizeBarrier(raw);
                      if (norm) setBarrier(norm);
                    }}
                    onBlur={() => {
                      const norm = normalizeBarrier(barrierInput);
                      if (norm) {
                        setBarrierInput(norm);
                        setBarrier(norm);
                      } else {
                        setBarrierInput(barrier);
                      }
                    }}
                    style={{ width: 120 }}
                    title="Type your own barrier/offset, e.g. 25.1 / +25.10 / -12.6"
                  />
                )}
              </div>

              {barrierChoices.length > 0 && (
                <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                  Available: {barrierChoices.slice(0, 10).join(', ')}
                  {barrierChoices.length > 10 ? '…' : ''}
                </div>
              )}
            </label>

            <div className="quote-box">
              <div className="qrow">
                <span className="k">Spot</span>
                <span className="v">{Number.isFinite(spot) ? spot.toFixed(2) : '—'}</span>
              </div>

              <div className="qrow">
                <span className="k">{mode === 'vanilla' ? 'Strike' : 'Target'}</span>
                <span className="v">{Number.isFinite(proposalStrike) ? proposalStrike.toFixed(2) : '—'}</span>
              </div>

              <div className="qrow">
                <span className="k">Ask</span>
                <span className="v">{Number.isFinite(askPrice) ? askPrice.toFixed(2) : '—'}</span>
              </div>

              <div className="qrow">
                <span className="k">Payout</span>
                <span className="v">{Number.isFinite(proposalPayout) ? proposalPayout.toFixed(2) : '—'}</span>
              </div>
            </div>
          </div>

          {proposalLongcode && <div className="longcode">{proposalLongcode}</div>}
          {error && <div className="err">{error}</div>}
          {statusMsg && !error && <div className="msg">{statusMsg}</div>}

          <div className="actions">
            <button className="buy" onClick={buy} disabled={isBuying || isQuoting}>
              {isBuying ? 'Buying…' : isQuoting ? 'Quoting…' : `Buy ${mode === 'vanilla' ? 'Vanilla' : 'T/NT'} ${displayDir}`}
            </button>
          </div>
        </div>

        <div className="vc-card">
          <div className="section-head" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <h4 style={{ marginRight: 'auto' }}>Active Contracts</h4>
            <span className="pill">{Object.keys(active).length}</span>

            <button
              className="sell"
              onClick={sellAllActive}
              disabled={sellableCount === 0 || isSellingAll}
              title={sellableCount === 0 ? 'No resale-eligible contracts yet' : 'Sell all resale-eligible contracts'}
              style={{ opacity: sellableCount === 0 || isSellingAll ? 0.6 : 1 }}
            >
              {isSellingAll ? 'Selling…' : `Sell All (${sellableCount})`}
            </button>
          </div>

          {Object.keys(active).length === 0 && <p className="muted">No open contracts.</p>}

          <div className="contracts">
            {Object.values(active).map(c => {
              const secondsLeft = c.date_expiry ? c.date_expiry - nowSec : NaN;
              const leftTxt = Number.isFinite(secondsLeft) ? fmtLeft(secondsLeft) : '—';
              const hurry = Number.isFinite(secondsLeft) && secondsLeft > 0 && secondsLeft <= 10 * 60;

              return (
                <div key={c.contract_id} className="ct-row">
                  <div className="ct-main">
                    <div className="ct-id">{c.contract_id.slice(-8)}</div>

                    <div className="ct-sub">
                      <span className="tag">{c.mode === 'vanilla' ? 'VANILLA' : 'T/NT'}</span>
                      <span className={`tag ${String(c.dir).includes('CALL') || c.dir === 'TOUCH' ? 'call' : 'put'}`}>
                        {c.mode === 'vanilla' ? c.dir : c.dir === 'TOUCH' ? 'TOUCH' : 'NO TOUCH'}
                      </span>
                      <span className="tag">{c.symbol}</span>
                      <span className="tag">{c.mode === 'vanilla' ? `offset ${c.barrier_offset}` : `barrier ${c.barrier_offset}`}</span>

                      <span className="tag" title={Number.isFinite(c.profit_line) ? `${c.profit_line}` : ''}>
                        {c.mode === 'vanilla' ? 'strike' : 'target'}{' '}
                        {Number.isFinite(c.profit_line) ? c.profit_line.toFixed(2) : '—'}
                      </span>

                      <span className={`tag resale ${c.is_valid_to_sell ? 'on' : 'off'}`}>
                        {c.is_valid_to_sell ? 'resale on' : 'resale off'}
                      </span>

                      <span
                        className={`tag ${hurry ? 'warn' : ''}`}
                        title={c.date_expiry ? `Expiry: ${fmtTime(c.date_expiry)}` : ''}
                      >
                        exp: {leftTxt}
                      </span>
                    </div>
                  </div>

                  <div className="ct-right">
                    <div className={`pl ${c.profit >= 0 ? 'good' : 'bad'}`}>
                      {c.profit >= 0 ? '+' : ''}
                      {c.profit.toFixed(2)}
                    </div>

                    <div className="bid">bid: {c.bid_price != null ? c.bid_price.toFixed(2) : '—'}</div>

                    <button
                      className="sell"
                      onClick={() => sellNow(c.contract_id)}
                      disabled={!c.is_valid_to_sell || isSellingAll}
                      title={!c.is_valid_to_sell ? 'Resale not available yet' : 'Sell at market'}
                    >
                      Sell
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="vc-card">
          <div className="section-head">
            <h4>Recent</h4>
            <button
              className="reset"
              onClick={() => {
                setRecent([]);
                closedIdsRef.current.clear();
              }}
            >
              Reset
            </button>
          </div>

          {recent.length === 0 && <p className="muted">No closed contracts yet.</p>}

          <div className="contracts">
            {recent.map(c => (
              <div key={c.contract_id} className="ct-row closed">
                <div className="ct-main">
                  <div className="ct-id">{c.contract_id.slice(-8)}</div>
                  <div className="ct-sub">
                    <span className="tag">{c.mode === 'vanilla' ? 'VANILLA' : 'T/NT'}</span>
                    <span className={`tag ${String(c.dir).includes('CALL') || c.dir === 'TOUCH' ? 'call' : 'put'}`}>
                      {c.mode === 'vanilla' ? c.dir : c.dir === 'TOUCH' ? 'TOUCH' : 'NO TOUCH'}
                    </span>
                    <span className="tag">{c.symbol}</span>
                    <span className="tag">{c.mode === 'vanilla' ? `offset ${c.barrier_offset}` : `barrier ${c.barrier_offset}`}</span>
                  </div>
                  <div className="ct-times">
                    <span>Start: {fmtTime(c.date_start)}</span>
                    <span>Expiry: {fmtTime(c.date_expiry)}</span>
                  </div>
                </div>

                <div className="ct-right">
                  <div className={`pl ${c.profit >= 0 ? 'good' : 'bad'}`}>
                    {c.profit >= 0 ? '+' : ''}
                    {c.profit.toFixed(2)}
                  </div>
                  <div className="bid">final bid: {c.bid_price != null ? c.bid_price.toFixed(2) : '—'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VanillaCallPut;
