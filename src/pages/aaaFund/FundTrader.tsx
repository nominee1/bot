import React, { useEffect, useMemo, useState } from 'react';
import './FundTrader.scss';

const API_BASE = 'https://dtraderhub.com/api'; // adjust if needed

type Toast = { id: string; text: string; type?: 'info'|'success'|'error' };
const newId = () => Math.random().toString(36).slice(2);

const Toasts: React.FC<{ items: Toast[], onDismiss: (id: string) => void }> = ({ items, onDismiss }) => {
  useEffect(() => {
    const timers = items.map(t => setTimeout(() => onDismiss(t.id), 3500));
    return () => timers.forEach(clearTimeout);
  }, [items, onDismiss]);
  return (
    <div className="toasts">
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

const OtpModal: React.FC<{
  invoiceId: number | null,
  requiresOtp: boolean,
  visible: boolean,
  onClose: () => void,
  onSubmit: (verificationInput: string) => Promise<void>,
  initialMessage?: string,
}> = ({ requiresOtp, visible, onClose, onSubmit, initialMessage }) => {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!visible) setInput(''); }, [visible]);

  if (!visible) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal>
      <div className="modal">
        <div className="modal__head">
          <h3>{requiresOtp ? 'Enter verification code' : 'Confirm funding'}</h3>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal__body">
          {initialMessage && <div className="muted small">{initialMessage}</div>}
          <p>
            {requiresOtp
              ? 'We emailed you a verification code (or a link). Paste the code or the full URL here and press Confirm.'
              : 'No OTP required — press Confirm to proceed.'}
          </p>
          {requiresOtp && (
            <input
              type="text"
              placeholder="Paste code or full link"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          )}
        </div>
        <div className="modal__foot">
          <div className="actions">
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button
              className="btn primary"
              disabled={busy || (requiresOtp && input.trim() === '')}
              onClick={async () => {
                setBusy(true);
                try { await onSubmit(input.trim()); } finally { setBusy(false); }
              }}
            >
              {busy ? 'Confirming…' : 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/** little helpers */
const idAvatar = (s: string) => (s || '??').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
const isPosNumber = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
};
const prettyUSD = (n?: number) => (typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(2)}` : '—');

const quickAmounts = [10, 25, 50, 100, 250, 500];

const FundTrader: React.FC = () => {
  // toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = (text: string, type?: Toast['type']) =>
    setToasts(prev => [...prev, { id: newId(), text, type }]);
  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  // funder identity (Denara username)
  const [funderDenara, setFunderDenara] = useState('');

  // funding form
  const [mode, setMode] = useState<'loginid'|'denara'>('loginid');
  const [recipientLoginId, setRecipientLoginId] = useState('');
  const [recipientDenara, setRecipientDenara] = useState('');
  const [amountUsd, setAmountUsd] = useState('');
  const [prepareBusy, setPrepareBusy] = useState(false);

  // voucher
  const [voucher, setVoucher] = useState('');
  const [redeemBusy, setRedeemBusy] = useState(false);

  // otp
  const [otpVisible, setOtpVisible] = useState(false);
  const [pendingInvoice, setPendingInvoice] = useState<{ id:number, amount:number, currency:string, requires_otp:boolean }|null>(null);
  const [otpMsg, setOtpMsg] = useState<string|undefined>(undefined);

  const clearFunding = () => { setRecipientLoginId(''); setRecipientDenara(''); setAmountUsd(''); };

  const gotoCreateUsername = () => {
    // navigate to your DenaraAccount view
    window.open('/denara-account', '_blank');
  };

  const recipientLabel = useMemo(() => {
    if (mode === 'loginid') return recipientLoginId.trim() || 'CR•••••••';
    return recipientDenara.trim() || 'username';
  }, [mode, recipientDenara, recipientLoginId]);

  const amountNumber = useMemo(() => {
    const n = Number(amountUsd);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [amountUsd]);

  const transferSummary = useMemo(() => {
    // You can add fees later; right now we just echo the amount.
    return {
      send: amountNumber || 0,
      fee: 0,
      total: amountNumber || 0,
    };
  }, [amountNumber]);

  const prepareFunding = async () => {
    const amt = Number(amountUsd);
    if (!funderDenara.trim()) { toast('Enter your Denara username first', 'info'); return; }
    if (!Number.isFinite(amt) || amt <= 0) { toast('Enter a valid amount', 'info'); return; }
    if (mode === 'loginid' && !recipientLoginId.trim()) { toast('Enter recipient login id', 'info'); return; }
    if (mode === 'denara' && !recipientDenara.trim()) { toast('Enter recipient Denara username', 'info'); return; }

    setPrepareBusy(true);
    try {
      const body: any = {
        funder_username: funderDenara.trim(),
        amount: amt,
      };
      if (mode === 'loginid') body.recipient_loginid = recipientLoginId.trim();
      else body.recipient_username = recipientDenara.trim();

      const res = await fetch(`${API_BASE}/fund/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(()=>({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      const inv = data.invoice;
      setPendingInvoice({ id: inv.id, amount: inv.amount, currency: inv.currency, requires_otp: !!inv.requires_otp });
      setOtpMsg(data.otp && data.otp.to ? `Verification sent to ${String(data.otp.to).replace(/(.{2}).+(@)/,'$1***$2')}` : undefined);
      if (inv.requires_otp) {
        setOtpVisible(true);
        toast('Verification sent — check your email', 'info');
      } else {
        await confirmFunding(inv.id, '');
      }
    } catch (e: any) {
      toast(e?.message || 'Failed to prepare funding', 'error');
    } finally {
      setPrepareBusy(false);
    }
  };

  const confirmFunding = async (invoiceIdParam?: number | string | null, verificationInput?: string) => {
    const invoice_id = invoiceIdParam ?? pendingInvoice?.id;
    if (!invoice_id) { toast('No invoice to confirm', 'info'); return; }

    try {
      const body: any = { invoice_id: Number(invoice_id) };
      if (typeof verificationInput === 'string' && verificationInput.trim() !== '') body.verification_input = verificationInput.trim();

      const res = await fetch(`${API_BASE}/fund/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(()=>({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      setOtpVisible(false);
      setPendingInvoice(null);
      clearFunding();
      toast('Funding complete', 'success');
    } catch (e: any) {
      toast(e?.message || 'Failed to confirm funding', 'error');
    } finally {
      setOtpVisible(false);
    }
  };

  const redeemVoucher = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!funderDenara.trim()) { toast('Enter your Denara username first', 'info'); return; }
    if (!voucher.trim()) { toast('Enter voucher code', 'info'); return; }

    setRedeemBusy(true);
    try {
      const res = await fetch(`${API_BASE}/vouchers/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voucher_code: voucher.trim(), funder_username: funderDenara.trim() }),
      });
      const data = await res.json().catch(()=>({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      if (data.requires_otp) {
        setPendingInvoice({ id: data.invoice_id, amount: data.amount, currency: data.currency, requires_otp: true });
        setOtpMsg('Verification sent');
        setOtpVisible(true);
      } else {
        toast(`Voucher credited to ${data.credited_to_loginid}: ${data.amount} ${data.currency}`, 'success');
      }
      setVoucher('');
    } catch (e: any) {
      toast(e?.message || 'Voucher redeem failed', 'error');
    } finally {
      setRedeemBusy(false);
    }
  };

  // postMessage handler for redirect-based OTP confirms
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!e?.data) return;
      if (e.data?.type === 'DERIV_PAYMENT_OK') {
        toast('Verification confirmed (redirect)', 'success');
        setOtpVisible(false);
        setPendingInvoice(null);
        clearFunding();
      } else if (e.data?.type === 'DERIV_PAYMENT_ERR') {
        toast(`Verification failed: ${String(e.data.error ?? 'error')}`, 'error');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="fund-trader-root card glass">
      {/* HERO */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'end', marginBottom: 12}}>
        <div>
          <h2 style={{marginBottom: 6}}>Fund a Trader</h2>
          <div className="muted small">Move funds securely via Payment Agent. OTP-protected. Fast and trackable.</div>
        </div>
        <div style={{display:'flex', gap:8}}>
          <span className="btn ghost" title="You can always set or update your token in Denara Account" onClick={() => window.open('/denara-account','_blank')}>Manage Denara</span>
        </div>
      </div>

      <div className="grid two-col">
        {/* LEFT: Identity + Voucher */}
        <section className="card--panel">
          <h3>Your Denara identity</h3>
          <div className="muted xsmall" style={{marginBottom: 8}}>
            Use the Denara username that you linked to your Deriv token in the Account page.
          </div>
          <div className="form-inline">
            <span>My Denara username</span>
            <input
              value={funderDenara}
              onChange={e=>setFunderDenara(e.target.value)}
              placeholder="your_denara_name"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div className="actions">
            <button className="btn" onClick={() => window.open('/denara-account','_blank')}>Create / Update Denara Username</button>
          </div>

          <hr />

          <h3>Redeem Voucher</h3>
          <form onSubmit={redeemVoucher} className="form-grid">
            <label>
              <span>Voucher code</span>
              <input
                value={voucher}
                onChange={e=>setVoucher(e.target.value)}
                placeholder="XXXX-XXXX-XXXX"
                spellCheck={false}
              />
            </label>
            <div className="actions">
              <button className="btn" type="submit" disabled={redeemBusy || !voucher.trim() || !funderDenara.trim()}>
                {redeemBusy ? 'Redeeming…' : 'Redeem'}
              </button>
            </div>
            <div className="muted xsmall">Vouchers are backed by USD value and redeem to your linked login id.</div>
          </form>
        </section>

        {/* RIGHT: Fund Someone — lively UX */}
        <section className="card--panel">
          <h3>Fund someone</h3>

          {/* Recipient capsule */}
          <div style={{
            display:'flex', alignItems:'center', gap:12, marginBottom:12,
            padding:'10px 12px', border:'1px solid rgba(0,0,0,0.08)', borderRadius:10, background:'#fafcff'
          }}>
            <div style={{
              width:36, height:36, borderRadius:999, display:'grid', placeItems:'center',
              background:'#eaf6ff', color:'#0f172a', fontWeight:800
            }}>
              {idAvatar(recipientLabel)}
            </div>
            <div style={{flex:1, minWidth:0}}>
              <div style={{fontWeight:700}}>{recipientLabel}</div>
              <div className="muted xsmall">
                {mode === 'loginid' ? 'Deriv Login ID' : 'Denara Username (we’ll resolve to Login ID)'}
              </div>
            </div>
            <div style={{display:'flex', gap:6}}>
              <span className="btn ghost" onClick={() => { setMode('loginid'); }}>Login ID</span>
              <span className="btn ghost" onClick={() => { setMode('denara'); }}>Denara</span>
            </div>
          </div>

          {/* Mode switch */}
          <div className="switch" style={{marginTop: 0}}>
            <label>
              <input type="radio" checked={mode==='loginid'} onChange={()=>setMode('loginid')} />
              <span>Recipient Login ID</span>
            </label>
            <label>
              <input type="radio" checked={mode==='denara'} onChange={()=>setMode('denara')} />
              <span>Recipient Denara Username</span>
            </label>
          </div>

          {/* Recipient input */}
          {mode==='loginid' ? (
            <label className="form-grid" style={{marginTop:8}}>
              <span>Recipient login id</span>
              <input
                value={recipientLoginId}
                onChange={e=>setRecipientLoginId(e.target.value)}
                placeholder="CR1234567"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
          ) : (
            <label className="form-grid" style={{marginTop:8}}>
              <span>Recipient Denara username</span>
              <input
                value={recipientDenara}
                onChange={e=>setRecipientDenara(e.target.value)}
                placeholder="trader_denara_name"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
          )}

          {/* Amount with quick chips */}
          <label className="form-grid" style={{marginTop:8}}>
            <span>Amount (USD)</span>
            <input
              type="number"
              min="1"
              step="0.01"
              value={amountUsd}
              onChange={e=>setAmountUsd(e.target.value)}
              placeholder="100.00"
              inputMode="decimal"
            />
          </label>

          <div style={{display:'flex', flexWrap:'wrap', gap:8, marginTop:8}}>
            {quickAmounts.map(a => (
              <button
                key={a}
                type="button"
                className="btn"
                onClick={() => setAmountUsd(String(a))}
                title={`Set ${a} USD`}
              >
                +{a}
              </button>
            ))}
            <button
              type="button"
              className="btn ghost"
              onClick={() => setAmountUsd(v => (isPosNumber(v) ? String(Number(v) * 2) : '50'))}
              title="Double the current amount"
            >
              2×
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setAmountUsd('')}
              title="Clear amount"
            >
              Clear
            </button>
          </div>

          {/* Live summary */}
          <div className="invoice-box" style={{marginTop:12}}>
            <div><strong>Send:</strong> {prettyUSD(transferSummary.send)} USD</div>
            <div><strong>Fee:</strong> {prettyUSD(transferSummary.fee)} USD</div>
            <div><strong>Total:</strong> {prettyUSD(transferSummary.total)} USD</div>
            {pendingInvoice && (
              <div className="muted xsmall" style={{marginTop:6}}>
                Pending invoice #{pendingInvoice.id} — {pendingInvoice.amount} {pendingInvoice.currency}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="actions" style={{marginTop:12}}>
            <button className="btn primary" disabled={prepareBusy} onClick={prepareFunding}>
              {prepareBusy ? 'Preparing…' : 'Prepare Funding'}
            </button>
            <button className="btn ghost" onClick={clearFunding}>Clear</button>
          </div>

          {/* Inline invoice CTA when present */}
          {pendingInvoice && (
            <div className="invoice-box" style={{marginTop:12}}>
              <div><strong>Invoice #{pendingInvoice.id}</strong></div>
              <div>{pendingInvoice.amount} {pendingInvoice.currency}</div>
              <div>Requires verification: {pendingInvoice.requires_otp ? 'Yes' : 'No'}</div>
              <div style={{marginTop:8, display:'flex', gap:8}}>
                {pendingInvoice.requires_otp ? (
                  <button className="btn" onClick={() => setOtpVisible(true)}>Enter Code / Link</button>
                ) : (
                  <button className="btn" onClick={() => confirmFunding(pendingInvoice.id, '')}>Confirm (No OTP)</button>
                )}
              </div>
            </div>
          )}

          <div className="muted xsmall" style={{marginTop:10}}>
            Flow: Prepare → (Deriv sends link/code) → Confirm → funds move to our payment agent then to the recipient.
          </div>
        </section>
      </div>

      <OtpModal
        invoiceId={pendingInvoice?.id ?? null}
        requiresOtp={!!pendingInvoice?.requires_otp}
        visible={otpVisible}
        initialMessage={otpMsg}
        onClose={() => setOtpVisible(false)}
        onSubmit={(v) => confirmFunding(pendingInvoice?.id, v)}
      />

      <Toasts items={toasts} onDismiss={dismiss} />
    </div>
  );
};

export default FundTrader;
