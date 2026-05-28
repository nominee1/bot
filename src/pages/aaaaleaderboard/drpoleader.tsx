import { useCallback, useEffect, useRef, useState } from 'react';
import DENARATORNA from '../../../public/assets/images/TOURNAMENTtt.png';
import Deposit from '../aadeposit/Deposit';
import './ParticipantsLeaderboard.scss';

// ===== Types =====
type Participant = {
  id: number;
  username: string;
  created_at?: string;
  updated_at?: string;
};

type Props = {
  apiBaseUrl?: string;
  appId?: number;
};

type RulesModalProps = {
  show: boolean;
  onClose: () => void;
  onOpenDeposit: () => void;
};

// ===== Registration API =====
const REG_API_URL = 'https://dtraderhub.com/api/traders';
const DERIV_APP_ID = 36300;

// ===== Tournament window =====
// Wednesday 8 Apr 2026 09:00 EAT = 06:00 UTC
// Wednesday 22 Apr 2026 09:00 EAT = 06:00 UTC
const TOURNAMENT_START_UTC_MS = Date.UTC(2026, 3, 8, 6, 0, 0);
const TOURNAMENT_END_UTC_MS = Date.UTC(2026, 3, 22, 6, 0, 0);

// ===== Constants =====
const DEFAULT_USERS_LIMIT = 50;

// ===== Deriv helpers =====
function getDerivWsUrl(app_id: number): string {
  return `wss://ws.derivws.com/websockets/v3?app_id=${app_id}`;
}

async function derivAuthorize(
  token: string,
  app_id: number,
  timeoutMs = 12000
): Promise<{ loginid: string; is_virtual: number; currency?: string }> {
  return new Promise((resolve, reject) => {
    const url = getDerivWsUrl(app_id);
    const ws = new WebSocket(url);

    let settled = false;
    const tidy = () => {
      try {
        ws.close();
      } catch {}
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      tidy();
      reject(new Error('Token check timed out. Please try again.'));
    }, timeoutMs);

    ws.onopen = () => ws.send(JSON.stringify({ authorize: token }));

    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.error) {
          settled = true;
          clearTimeout(timer);
          tidy();
          reject(new Error(msg.error.message || 'Invalid token'));
          return;
        }
        if (msg.msg_type === 'authorize' && msg.authorize) {
          const { loginid, is_virtual, currency } = msg.authorize;
          settled = true;
          clearTimeout(timer);
          tidy();
          resolve({ loginid, is_virtual, currency });
        }
      } catch {
        settled = true;
        clearTimeout(timer);
        tidy();
        reject(new Error('Unexpected response from Deriv.'));
      }
    };

    ws.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      tidy();
      reject(new Error('Network error talking to Deriv.'));
    };

    ws.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        tidy();
        reject(new Error('Connection closed before validation finished.'));
      }
    };
  });
}

async function validateDerivTokenOrThrow(userToken: string) {
  const auth = await derivAuthorize(userToken, DERIV_APP_ID);
  if (auth.is_virtual === 1 || /^VRTC/i.test(auth.loginid)) {
    throw new Error('Please provide a REAL account token (not demo).');
  }
  if ((auth.currency || '').toUpperCase() !== 'USD') {
    throw new Error('Only USD accounts are allowed for this tournament.');
  }
  return auth;
}

// ===== API helpers =====
async function listParticipants(apiBaseUrl: string, q = '', limit = DEFAULT_USERS_LIMIT, offset = 0) {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const url = new URL(`${base}/list_participants.php`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  if (q.trim()) url.searchParams.set('q', q.trim());

  const res = await fetch(url.toString(), { method: 'GET' });
  const data = await res.json();
  if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load participants');

  return { results: (data.results || []) as Participant[], total: data.total || 0 };
}

const RulesModal = ({ show, onClose, onOpenDeposit }: RulesModalProps) => {
  const modalCloseBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (show) {
      document.addEventListener('keydown', onKey);
      setTimeout(() => modalCloseBtnRef.current?.focus(), 0);
      document.documentElement.style.overflow = 'hidden';
    } else {
      document.documentElement.style.overflow = '';
    }

    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = '';
    };
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div
      id="rules-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-title"
      className="modal"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal__dialog" role="document">
        <header className="modal__header">
          <h2 id="rules-title">Denara Trading Tournament — Rules (Bots Allowed)</h2>
          <button
            ref={modalCloseBtnRef}
            className="modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="modal__content">
          <section>
            <h3>1) Who can join</h3>
            <ul>
              <li>18+ only, one account per person per tournament.</li>
              <li>Eligibility depends on your country of residence.</li>
              <li>Registration is open anytime from this page.</li>
              <li>Registration info must be accurate.</li>
            </ul>
          </section>

          <section>
            <h3>2) Code of conduct</h3>
            <ul>
              <li>Be respectful. No harassment, hate speech, or discrimination.</li>
              <li>Disruptive behavior or attempts to damage Denara/Deriv reputation may lead to disqualification.</li>
            </ul>
          </section>

          <section>
            <h3>3) How it works</h3>
            <ul>
              <li>Trade Derived synthetic indices. Standings use the balance tied to your account.</li>
              <li>Eligibility: at least one closed trade during the tournament window.</li>
              <li>Users will view rankings and statements from the competition page.</li>
              <li>Deposits/withdrawals are ignored for P/L; only closed trades after baseline count.</li>
            </ul>
          </section>

          <section>
            <h3>4) Disqualification</h3>
            <ul>
              <li>Fraud, manipulation, intentional-loss strategies.</li>
            </ul>
          </section>

          <section>
            <h3>5) Prizes</h3>
            <ul>
              <li>
                <strong>1st Prize: Brand new Mercedes-Benz C200</strong>
              </li>
              <li>
                Only trades made on <strong>denarapro.com</strong> will qualify for prizing.
              </li>
              <li>Denara reserves the right to cancel, suspend, or terminate the competition at its discretion.</li>
              <li>
                Winner unlocks{' '}
                <button type="button" className="link-btn" onClick={onOpenDeposit}>
                  Denara Paid Copy-Trader
                </button>{' '}
                listing (subject to review).
              </li>
            </ul>
          </section>
        </div>

        <footer className="modal__footer">
          <button className="btn" onClick={onClose}>
            Agree
          </button>
        </footer>
      </div>
    </div>
  );
};

const ParticipantsLeaderboardMerged = ({
  apiBaseUrl = 'https://ttt.binaryke.com/api',
}: Props) => {
  const registerCardRef = useRef<HTMLDivElement | null>(null);

  // ===== Registration =====
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupMsg, setSignupMsg] = useState<string | null>(null);
  const [signupErr, setSignupErr] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const depositRef = useRef<HTMLDivElement | null>(null);

  const scrollToDeposit = () => {
    depositRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openDepositInline = () => {
    setShowRules(false);
    setShowDeposit(true);
    setTimeout(scrollToDeposit, 50);
  };

  const isValidEmail = (val: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

  // ===== Participants total only =====
  const [usersTotal, setUsersTotal] = useState(0);

  const fetchUsersTotal = useCallback(async () => {
    try {
      const { total } = await listParticipants(apiBaseUrl, '', DEFAULT_USERS_LIMIT, 0);
      setUsersTotal(total);
    } catch {
      setUsersTotal(0);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    void fetchUsersTotal();
  }, [fetchUsersTotal]);

  const onRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupErr(null);
    setSignupMsg(null);

    if (!username.trim() || !token.trim() || !email.trim()) {
      setSignupErr('Please enter username, token and email.');
      return;
    }

    if (!isValidEmail(email)) {
      setSignupErr('Please provide a valid email.');
      return;
    }

    try {
      setSignupLoading(true);
      await validateDerivTokenOrThrow(token.trim());

      const res = await fetch(REG_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          token: token.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error || `Registration failed (HTTP ${res.status})`);

      setSignupMsg(`Registered as ${data?.username || username}.`);
      setToken('');
      await fetchUsersTotal();
    } catch (e: any) {
      setSignupErr(e?.message || 'Network error');
    } finally {
      setSignupLoading(false);
    }
  };

  const tournamentStartText = new Date(TOURNAMENT_START_UTC_MS).toLocaleString();
  const tournamentEndText = new Date(TOURNAMENT_END_UTC_MS).toLocaleString();

  return (
    <div className="participants top3">
      <section className="leaderboard-hero">
        <div className="leaderboard-hero__content">
          <div className="leaderboard-hero__copy">
            <span className="eyebrow">Denara Tournament</span>
            <h1>Registration</h1>
            <p>
              Register directly from this page, then use the competition page button to view rankings and statements.
            </p>

            <div className="leaderboard-hero__totals">
              <div className="hero-stat">
                <span className="hero-stat__label">Participants</span>
                <strong className="hero-stat__value">{usersTotal}</strong>
              </div>
              <div className="hero-stat">
                <span className="hero-stat__label">Tournament Window</span>
                <strong className="hero-stat__value">14 Days</strong>
              </div>
            </div>

            <div className="leaderboard-hero__actions">
              <button className="btn" onClick={() => setShowRules(true)}>
                View Rules
              </button>
            </div>
          </div>

          <div className="leaderboard-hero__art" aria-hidden="true">
            <img src={DENARATORNA} alt="Denara Tournament visual" />
          </div>
        </div>
      </section>

      <div className="stm-shell">
        <aside className="users-rail">
          <div className="registration-card" id="register-card" ref={registerCardRef}>
            <div className="registration-card__head">
              <h2>Enter Tournament</h2>
              <p>Registration is open here anytime.</p>
            </div>

            <form onSubmit={onRegister} className="registration-form" autoComplete="off">
              <label className="field">
                <span>Username</span>
                <input
                  type="text"
                  placeholder="e.g. Beast"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  minLength={3}
                  maxLength={64}
                  required
                  disabled={signupLoading}
                />
              </label>

              <label className="field">
                <span>Deriv Real Token</span>
                <input
                  type="password"
                  placeholder="Paste Api Token (Read|Trade|Trading Information)"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  required
                  disabled={signupLoading}
                />
                <small className="muted">Validated by Deriv real USD only.</small>
              </label>

              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  placeholder=""
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  disabled={signupLoading}
                />
              </label>

              <div className="registration-actions">
                <button type="submit" className="btn" disabled={signupLoading}>
                  {signupLoading ? 'Validating…' : 'Register Tournament'}
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setShowRules(true)}>
                  Rules
                </button>
              </div>

              {signupMsg && <div className="alert ok">{signupMsg}</div>}
              {signupErr && <div className="alert err">{signupErr}</div>}
            </form>
          </div>

          <div
            className="ranking-redirect-card"
            style={{
              marginTop: '18px',
              borderRadius: '20px',
              padding: '22px',
              background: 'linear-gradient(135deg, rgba(20,20,32,0.98), rgba(45,24,80,0.98))',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 18px 40px rgba(0,0,0,0.22)',
              color: '#fff',
            }}
          >
            <div
              style={{
                fontSize: '0.78rem',
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
                opacity: 0.75,
              }}
            >
              Live Competition
            </div>

            <h3 style={{ margin: '10px 0 8px', fontSize: '1.25rem', lineHeight: 1.2 }}>
              Rankings and statements moved
            </h3>

            <p style={{ margin: 0, opacity: 0.88, lineHeight: 1.6 }}>
              Use the button below to open the full competition page where users can view live rankings and their statements.
            </p>

            <a
              href="https://www.denarapro.com/#Competition"
              target="_blank"
              rel="noreferrer"
              className="btn"
              style={{
                marginTop: '18px',
                width: '100%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                textDecoration: 'none',
                padding: '14px 18px',
                borderRadius: '14px',
                fontWeight: 700,
                fontSize: '1rem',
              }}
            >
              🏆 View Ranking / Statements
            </a>
          </div>
        </aside>

        <main className="stm-only">
          <div
            className="registration-card"
            style={{
              minHeight: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <div className="registration-card__head">
              <h2>Competition Page Access</h2>
              <p>
                Statements have been removed from this component. Users will now view both rankings and statements from the competition page.
              </p>
            </div>

            <div className="stm-summary" style={{ marginTop: '8px' }}>
              <div className="stm-summary__metrics">
                <div className="metric">
                  <div className="m-label">Tournament Start</div>
                  <div className="m-value">{tournamentStartText}</div>
                </div>
                <div className="metric">
                  <div className="m-label">Tournament End</div>
                  <div className="m-value">{tournamentEndText}</div>
                </div>
                <div className="metric">
                  <div className="m-label">Statements</div>
                  <div className="m-value">Moved</div>
                </div>
                <div className="metric">
                  <div className="m-label">Rankings</div>
                  <div className="m-value">Moved</div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '22px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <a
                href="https://www.denarapro.com/#Competition"
                target="_blank"
                rel="noreferrer"
                className="btn"
                style={{ textDecoration: 'none' }}
              >
                Open Competition Page
              </a>

              <button className="btn btn--ghost" onClick={() => setShowRules(true)}>
                View Rules
              </button>
            </div>
          </div>

          {showDeposit && (
            <section className="deposit-inline" ref={depositRef}>
              <h2 className="deposit-inline__title">Deposit</h2>
              <Deposit />
            </section>
          )}
        </main>
      </div>

      <RulesModal
        show={showRules}
        onClose={() => setShowRules(false)}
        onOpenDeposit={openDepositInline}
      />
    </div>
  );
};

export default ParticipantsLeaderboardMerged;