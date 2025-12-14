import React, { useMemo, useState } from 'react';
import './DenaraAccount.scss';

const API_BASE = 'https://dtraderhub.com/api'; // adjust as needed

type Toast = { id: string; text: string; type?: 'info'|'success'|'error' };
const newId = () => Math.random().toString(36).slice(2);

const Toasts: React.FC<{ items: Toast[], onDismiss: (id: string)=>void }> = ({ items, onDismiss }) => {
  React.useEffect(() => {
    const timers = items.map(t => setTimeout(() => onDismiss(t.id), 3200));
    return () => timers.forEach(clearTimeout);
  }, [items, onDismiss]);
  return (
    <div className="toasts denara-toasts">
      {items.map(t => (
        <div key={t.id} className={`toast ${t.type || 'info'}`}>
          <div className="toast__dot" />
          <div className="toast__text">{t.text}</div>
          <button className="toast__x" onClick={() => onDismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
};

type ServiceKey = 'copytrading' | 'tournaments' | 'metrics' | 'payments';

const basicPerms = ['read','trade','trading_information'] as const;

const DenaraAccount: React.FC = () => {
  // toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = (text: string, type?: Toast['type']) =>
    setToasts(prev => [...prev, { id: newId(), text, type }]);
  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  // form state
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [services, setServices] = useState<Record<ServiceKey, boolean>>({
    copytrading: true,
    tournaments: false,
    metrics: true,
    payments: false,
  });
  const [busy, setBusy] = useState(false);

  const suggestedPerms = useMemo(() => {
    const p = new Set<string>(basicPerms);
    if (services.payments) p.add('payments');
    return Array.from(p);
  }, [services]);

  const canSubmit = username.trim().length >= 3 && token.trim().length >= 12;
  const toggle = (k: ServiceKey) => setServices(prev => ({ ...prev, [k]: !prev[k] }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/denara/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          token: token.trim(),
          expected_services: Object.keys(services).filter(k => (services as any)[k]),
          suggested_scopes: suggestedPerms,
        }),
      });
      const data = await res.json().catch(()=>({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      setToken('');
      toast('Username saved and token verified', 'success');
    } catch (err: any) {
      toast(err?.message || 'Failed to save', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="denara-account-root card glass">
      {/* Hero */}
      <div className="da-hero">
        <h2>Denara Username & Token</h2>
        <div className="hero-badges">
          <span className="badge badge--accent">Unified Identity</span>
          <span className="badge">Copytrade · Metrics · Tournaments</span>
        </div>
      </div>

      <p className="muted small" style={{marginTop: -6}}>
        Create a Denara username used across copytrading, tournaments, metrics, and payments. Choose what you plan to use — we’ll suggest the minimal Deriv permissions.
      </p>

      {/* Services */}
      <section className="da-panel">
        <h3>What do you plan to use?</h3>
        <div className="svc-grid">
          <label className={`svc ${services.copytrading ? 'on' : ''}`}>
            <input type="checkbox" checked={services.copytrading} onChange={()=>toggle('copytrading')} />
            <div>
              <div className="svc__title">Copytrading</div>
              <div className="svc__desc">Follow traders, view trade history, start/stop copying.</div>
            </div>
          </label>

          <label className={`svc ${services.metrics ? 'on' : ''}`}>
            <input type="checkbox" checked={services.metrics} onChange={()=>toggle('metrics')} />
            <div>
              <div className="svc__title">Metrics Dashboard</div>
              <div className="svc__desc">Read balances, statements, performance.</div>
            </div>
          </label>

          <label className={`svc ${services.tournaments ? 'on' : ''}`}>
            <input type="checkbox" checked={services.tournaments} onChange={()=>toggle('tournaments')} />
            <div>
              <div className="svc__title">Tournaments</div>
              <div className="svc__desc">Join events. Claim prizes via Denara.</div>
            </div>
          </label>

          <label className={`svc ${services.payments ? 'on' : ''}`}>
            <input type="checkbox" checked={services.payments} onChange={()=>toggle('payments')} />
            <div>
              <div className="svc__title">Payments & Transfers</div>
              <div className="svc__desc">Pay before copytrading, redeem prizes, fund other users.</div>
            </div>
          </label>
        </div>

        <div className="perm-box">
          <div className="perm-title">Suggested Deriv permissions for your token:</div>
          <div className="perm-list">
            {suggestedPerms.map(p => <span className="chip" key={p}>{p}</span>)}
          </div>
          <div className="muted xsmall" style={{marginTop: 6}}>
            Basics: <strong>read</strong>, <strong>trade</strong>, <strong>trading_information</strong>. Add <strong>payments</strong> if you’ll send/receive money (copytrading fees, prize redemptions, transfers).
          </div>
        </div>
      </section>

      {/* Form */}
      <form className="form-grid" onSubmit={submit}>
        <label>
          <span>Denara Username</span>
          <div className="field">
            <div className="field__icon">@</div>
            <input
              value={username}
              onChange={(e)=>setUsername(e.target.value)}
              placeholder="your_denara_name"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="field-hint">
            <span className="badge">public handle</span>
            <span className="badge badge--ok">used across all Denara services</span>
          </div>
        </label>

        <label>
          <span>Deriv API Token</span>
          <div className="field field--mono">
            <div className="field__icon">◎</div>
            <input
              value={token}
              onChange={(e)=>setToken(e.target.value)}
              placeholder="Paste token with suggested permissions"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="field-hint">
            <span className="badge badge--warn">read · trade · trading_information</span>
            <span className="badge badge--ok">+ payments if sending/receiving</span>
          </div>
        </label>

        <div className="actions">
          <button className="btn primary" type="submit" disabled={!canSubmit || busy}>
            {busy ? 'Saving…' : 'Save / Update Token'}
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => { setUsername(''); setToken(''); toast('Cleared', 'info'); }}
          >
            Clear
          </button>
        </div>
      </form>

      {/* Info */}
      {/* <section className="info">
        <h3>What we store</h3>
        <ul className="muted small">
          <li>Your Denara <strong>username</strong> and the token (server-side only).</li>
          <li>After authorization, we store your account <strong>login id</strong> and <strong>email</strong>.</li>
          <li>When you enter a Denara username elsewhere (e.g., Funding), we resolve it to the stored login id.</li>
          <li>You can update your token anytime by re-submitting this form.</li>
        </ul>
      </section> */}

      <Toasts items={toasts} onDismiss={dismiss} />
    </div>
  );
};

export default DenaraAccount;
