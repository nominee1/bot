import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import './ParticipantDetail.scss';

type Summary = {
  username: string;
  start_ts: number;
  end_ts: number;
  start_balance: number | null;
  end_balance: number | null;
  net_pl: number;
  trades_count: number;
  updated_at: string;
};

type Tx = {
  transaction_id: number;
  action_type: string | null;
  amount: number | null;
  balance_after: number | null;
  transaction_time: number;
  reference_id: number | null;
  app_id: number | null;
};

const API = 'https://ttt.binaryke.com/api/participant_detail.php';

const ParticipantDetail: React.FC = () => {
  const { loginid = '' } = useParams();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tx, setTx] = useState<Tx[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const url = new URL(API);
      url.searchParams.set('loginid', loginid);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));
      const res = await fetch(url.toString());
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || 'Failed');
      setSummary(data.summary);
      setTx(data.transactions || []);
      setTotal(data.total || 0);
    } catch (e:any) {
      setErr(e.message || 'Network error');
    } finally { setLoading(false); }
  };

  useEffect(()=>{ void load(); /* eslint-disable-next-line */}, [loginid, limit, offset]);

  const fmt = (n?: number | null) => typeof n === 'number' ? n.toFixed(2) : '—';
  const cls = (n: number) => (n >= 0 ? 'pos' : 'neg');

  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="pd">
      {summary && (
        <div className="pd__summary">
          <div className="s">
            <div className="label">Username</div>
            <div className="val">{summary.username}</div>
          </div>
          <div className="s"><div className="label">Login ID</div><div className="val">{loginid}</div></div>
          <div className="s"><div className="label">Start Balance</div><div className="val">{fmt(summary.start_balance)}</div></div>
          <div className="s"><div className="label">Current Balance</div><div className="val">{fmt(summary.end_balance)}</div></div>
          <div className="s"><div className="label">Net P/L</div><div className={`val ${cls(summary.net_pl)}`}>{fmt(summary.net_pl)}</div></div>
          <div className="s"><div className="label">Trades</div><div className="val">{summary.trades_count}</div></div>
        </div>
      )}

      <div className="pd__table">
        <div className="head">
          <div className="col col--time">Time</div>
          <div className="col col--action">Action</div>
          <div className="col col--ref">Reference</div>
          <div className="col col--app">App</div>
          <div className="col col--amt">Amount</div>
          <div className="col col--bal">Balance</div>
        </div>
        <div className="scroller">
          <ul className="list">
            {tx.map(t => (
              <li key={t.transaction_id} className="row">
                <div className="col col--time" data-label="Time">{new Date(t.transaction_time * 1000).toLocaleString()}</div>
                <div className="col col--action" data-label="Action">{t.action_type ?? '-'}</div>
                <div className="col col--ref" data-label="Reference">{t.reference_id ?? '-'}</div>
                <div className="col col--app" data-label="App">{t.app_id ?? '-'}</div>
                <div className={`col col--amt ${t.amount && t.amount >= 0 ? 'pos' : 'neg'}`} data-label="Amount">{typeof t.amount === 'number' ? t.amount.toFixed(2) : '—'}</div>
                <div className="col col--bal" data-label="Balance">{typeof t.balance_after === 'number' ? t.balance_after.toFixed(2) : '—'}</div>
              </li>
            ))}
          </ul>
        </div>
        {err && <div className="status err">{err}</div>}
        {!loading && tx.length===0 && !err && <div className="status">No statements in window.</div>}
      </div>

      <div className="pd__pager">
        <button className="btn btn--ghost" onClick={()=>setOffset(Math.max(0, offset - limit))} disabled={offset===0}>‹ Prev</button>
        <div className="info">Page {page} of {pages} • {total} tx</div>
        <button className="btn btn--ghost" onClick={()=>setOffset(offset + limit)} disabled={offset+limit>=total}>Next ›</button>
        <label>Show
          <select value={limit} onChange={e=>{setLimit(Number(e.target.value)); setOffset(0);}}>
            <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
          </select>
        </label>
      </div>
    </div>
  );
};

export default ParticipantDetail;
