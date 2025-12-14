import React, { useEffect, useMemo, useRef, useState } from 'react';
import './CopiersBalances.scss';

type Props = {
  apiBase?: string;           // default: https://dtraderhub.com/api
  copierUsername?: string;    // default: "Totoi01"
  pollMs?: number;            // default: 30000
};

type CopierBalanceResp = {
  username: string;
  balance: number | null;
  currency: string | null;
  fetched_at?: number; // epoch ms
};

const CopierBalanceCard: React.FC<Props> = ({
  apiBase = 'https://dtraderhub.com/api',
  copierUsername = 'Totoi01',
  pollMs = 30_000,
}) => {
  const [row, setRow] = useState<CopierBalanceResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`${apiBase}/copiers/${encodeURIComponent(copierUsername)}/balance`);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 180)}`);
      }
      const data: CopierBalanceResp = await res.json();
      setRow(data);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load balance');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    timerRef.current = window.setInterval(load, pollMs) as unknown as number;
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, copierUsername, pollMs]);

  const title = useMemo(() => `Copier Balance — ${copierUsername}`, [copierUsername]);

  return (
    <div className="copier-balance-card">
      <div className="cbc__head">
        <h3>{title}</h3>
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {err && <div className="cbc__status error">{err}</div>}

      {!err && (
        <div className="cbc__body">
          <div className="cbc__row">
            <div className="cbc__label">Balance</div>
            <div className="cbc__value">
              {typeof row?.balance === 'number' ? row.balance.toFixed(2) : '—'}
            </div>
          </div>
          <div className="cbc__row">
            <div className="cbc__label">Currency</div>
            <div className="cbc__value">{row?.currency || '—'}</div>
          </div>
          <div className="cbc__foot">
            <span className="muted">
              {row?.fetched_at ? `Updated ${new Date(row.fetched_at).toLocaleTimeString()}` : '—'}
            </span>
            <span className="muted">Auto-refresh: {Math.round(pollMs / 1000)}s</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default CopierBalanceCard;
