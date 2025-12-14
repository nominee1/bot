import React, { useEffect, useState } from 'react';
import './LeaderboardCards.scss';

type Row = {
  username: string;
  loginid: string;
  start_balance: number | null;
  end_balance: number | null;
  net_pl: number;
  trades_count: number;
  updated_at: string;
};

const API = 'https://ttt.binaryke.com/api/leaderboard_summary.php';

const LeaderboardCards: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const url = new URL(API);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));
      if (q.trim()) url.searchParams.set('q', q.trim());
      const res = await fetch(url.toString());
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || 'Failed');
      setRows(data.results || []);
      setTotal(data.total || 0);
    } catch (e: any) {
      setErr(e.message || 'Network error');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [limit, offset]);

  const fmt = (n?: number | null) => typeof n === 'number' ? n.toFixed(2) : '—';
  const cls = (n: number) => (n >= 0 ? 'pos' : 'neg');

  return (
    <div className="lb">
      <div className="lb__toolbar">
        <form className="lb__search" onSubmit={(e)=>{e.preventDefault(); setOffset(0); void load();}}>
          <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search username..." />
          <button className="btn" type="submit">Search</button>
        </form>
        <div className="lb__controls">
          <label>Show
            <select value={limit} onChange={e=>{setLimit(Number(e.target.value)); setOffset(0);}}>
              <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option>
            </select>
          </label>
          <button className="btn btn--ghost" onClick={()=>void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="lb__grid">
        {rows.map((r, i) => (
          <a className="card" key={r.loginid} href={`/participant/${encodeURIComponent(r.loginid)}`}>
            <div className="card__top">
              <div className="card__rank">#{(page-1)*limit + i + 1}</div>
              <div className="card__user">{r.username}</div>
              <div className="card__login">{r.loginid}</div>
            </div>
            <div className="card__metrics">
              <div className="m">
                <div className="m__label">Start</div>
                <div className="m__val">{fmt(r.start_balance)}</div>
              </div>
              <div className="m">
                <div className="m__label">Current</div>
                <div className="m__val">{fmt(r.end_balance)}</div>
              </div>
              <div className="m">
                <div className="m__label">Net P/L</div>
                <div className={`m__val ${cls(r.net_pl)}`}>{fmt(r.net_pl)}</div>
              </div>
              <div className="m">
                <div className="m__label">Trades</div>
                <div className="m__val">{r.trades_count}</div>
              </div>
            </div>
            <div className="card__time">Updated {new Date(r.updated_at).toLocaleString()}</div>
          </a>
        ))}
      </div>

      <div className="lb__pager">
        <button className="btn btn--ghost" onClick={()=>setOffset(Math.max(0, offset - limit))} disabled={offset===0}>‹ Prev</button>
        <div className="lb__pageinfo">Page {page} of {pages} • {total} total</div>
        <button className="btn btn--ghost" onClick={()=>setOffset(offset + limit)} disabled={offset+limit>=total}>Next ›</button>
      </div>

      {err && <div className="lb__err">{err}</div>}
      {!loading && rows.length===0 && !err && <div className="lb__err">No participants yet.</div>}
    </div>
  );
};

export default LeaderboardCards;
