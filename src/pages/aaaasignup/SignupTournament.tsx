import { useEffect, useMemo, useRef, useState } from 'react';
import DENARATORNA from '../../../public/assets/images/DENARATORNA.png';
import Deposit from '../aadeposit/Deposit';
import './SignupTournament.scss';

// 🔁 Now using the same API as traders
const API_URL = 'https://dtraderhub.com/api/traders';

const DERIV_APP_ID = 36300;

/** ======= TIME WINDOW (EAT = UTC+3) ======= */
const EAT_OFFSET_HOURS = 3;
const toUtcMsFromEAT = (y: number, m0: number, d: number, h = 0, min = 0, s = 0, ms = 0) =>
  Date.UTC(y, m0, d, h - EAT_OFFSET_HOURS, min, s, ms);

// Registration opens: Sun Nov 9, 2025 04:00 EAT
const REG_START_MS_UTC = toUtcMsFromEAT(2025, 10, 9, 4, 0, 0);

// Registration closes: Mon Nov 17, 2025 09:00 EAT
const REG_END_MS_UTC = toUtcMsFromEAT(2025, 10, 25, 9, 0, 0);

type TCountdown = { d: number; h: number; m: number; s: number; done: boolean };

function getDerivWsUrl(app_id: number): string {
  return `wss://ws.derivws.com/websockets/v3?app_id=${app_id}`;
}

// Minimal WS RPC util for one-shot calls (authorize)
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
      } catch { }
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

const TournamentLanding = () => {
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [email, setEmail] = useState(''); // optional

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [countdown, setCountdown] = useState<TCountdown>({
    d: 0,
    h: 0,
    m: 0,
    s: 0,
    done: false,
  });
  const [registrationOpen, setRegistrationOpen] = useState<boolean>(false);
  const [registrationClosed, setRegistrationClosed] = useState<boolean>(false);

  // Rules modal
  const [showRules, setShowRules] = useState(false);

  // Deposit toggle (inline, no navigation)
  const [showDeposit, setShowDeposit] = useState(false);

  const formRef = useRef<HTMLDivElement | null>(null);
  const modalCloseBtnRef = useRef<HTMLButtonElement | null>(null);
  const depositRef = useRef<HTMLDivElement | null>(null);

  // Labels (explicit EAT)
  const startLabel = useMemo(() => {
    return (
      new Date(REG_START_MS_UTC).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }) + ' (EAT)'
    );
  }, []);
  const endLabel = useMemo(() => {
    return (
      new Date(REG_END_MS_UTC).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }) + ' (EAT)'
    );
  }, []);

  /** Countdown to END; locks at 00:00:00:00 when passed */
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const open = now >= REG_START_MS_UTC && now < REG_END_MS_UTC;
      const closed = now >= REG_END_MS_UTC;

      setRegistrationOpen(open);
      setRegistrationClosed(closed);

      const target = REG_END_MS_UTC;
      const diff = Math.max(0, target - now);

      const d = Math.floor(diff / (24 * 3600_000));
      const h = Math.floor((diff % (24 * 3600_000)) / 3600_000);
      const m = Math.floor((diff % 3600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1000);

      setCountdown({ d, h, m, s, done: closed });
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Modal ESC + scroll lock
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowRules(false);
    };
    if (showRules) {
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
  }, [showRules]);

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const scrollToDeposit = () => {
    depositRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // simple validators
  const isValidEmail = (val: string) => val === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

  async function validateDerivTokenOrThrow(userToken: string) {
    // keep same real + USD guard as before
    const auth = await derivAuthorize(userToken, DERIV_APP_ID);
    if (auth.is_virtual === 1 || /^VRTC/i.test(auth.loginid)) {
      throw new Error('Please provide a REAL account token (not demo).');
    }
    if ((auth.currency || '').toUpperCase() !== 'USD') {
      throw new Error('Only USD accounts are allowed for this tournament.');
    }
    return auth;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);

    if (!registrationOpen) {
      setErr(registrationClosed ? 'Registration is closed.' : 'Registration has not opened yet.');
      return;
    }
    if (!username || !token) {
      setErr('Please enter username and token.');
      return;
    }
    if (!isValidEmail(email)) {
      setErr('Please provide a valid email (or leave it empty).');
      return;
    }

    try {
      setLoading(true);

      // Frontend validation (REAL + USD) before sending to shared traders API
      await validateDerivTokenOrThrow(token);

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim() || undefined,
          token: token.trim(),
          // ❌ no min_balance, no price_usd – backend defaults handle them
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as any)?.error || `Registration failed (HTTP ${res.status})`);
      }

      setMsg(`Registered as ${data?.username || username}.`);
      setToken('');
      // keep email + username prefilled so they see what they used
    } catch (e: any) {
      setErr(e?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  // When user clicks "Denara Paid Copy-Trader" inside Rules:
  const openDepositInline = () => {
    setShowRules(false);
    setShowDeposit(true);
    // allow DOM paint then scroll
    setTimeout(scrollToDeposit, 50);
  };

  const submitDisabled =
    loading || !registrationOpen || !username.trim() || !token.trim() || !isValidEmail(email);

  const openLeaderboard = () => {
    window.open('https://site.denaratool.com/#Tournament', '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="tournament-landing">
      {/* ===== HERO ===== */}
      <section className="hero">
        <div className="hero__grid">
          {/* Left copy */}
          <div className="hero__col hero__col--copy">
            <div className="hero__body">
              <h1 className="hero__title">Denara Trading Tournament Season2</h1>
              <p className="hero__subtitle">
                Prize Pool: <strong>Starting $200</strong> •{' '}
                {registrationClosed ? (
                  <strong>Tournament Ended</strong>
                ) : registrationOpen ? (
                  <>
                    Registration closes <strong>{endLabel}</strong>
                  </>
                ) : (
                  <>
                    Registration opens <strong>{startLabel}</strong>
                  </>
                )}
              </p>

              <div className="hero__cta">
                <button
                  className="btn btn--ghost"
                  type="button"
                  onClick={() => setShowRules(true)}
                  aria-haspopup="dialog"
                  aria-controls="rules-modal"
                  aria-expanded={showRules}
                >
                  View Full Rules
                </button>

                <div className="countdown">
                  <span className="countdown__label">
                    {registrationClosed ? 'Registration ended' : 'Registration ends in'}
                  </span>
                  <div className="countdown__digits">
                    {['Days', 'Hours', 'Mins', 'Secs'].map((label, i) => {
                      const vals = registrationClosed
                        ? ['00', '00', '00', '00']
                        : [
                            String(countdown.d).padStart(2, '0'),
                            String(countdown.h).padStart(2, '0'),
                            String(countdown.m).padStart(2, '0'),
                            String(countdown.s).padStart(2, '0'),
                          ];
                      return (
                        <div className="cd-chip" key={label}>
                          <span>{vals[i]}</span>
                          <small>{label}</small>
                        </div>
                      );
                    })}
                  </div>
                  {registrationClosed && (
                    <div className="countdown__closed">
                      Registration closed
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right image */}
          <div className="hero__col hero__col--art" aria-hidden="true">
            <div className="hero__art">
              <div className="hero__ring" />
              <img
                className="hero__img"
                src={DENARATORNA}
                alt="Denara Tournament visual"
                loading="eager"
                decoding="async"
                sizes="(max-width: 900px) 88vw, 460px"
              />
              <div className="hero__gridlines" />
            </div>
          </div>
        </div>
      </section>

      {/* ===== PERKS ===== */}
      <section className="perks">
        <div className="perks__card">
          <h3>Top 3 Unlocks</h3>
          <ul className="perks__list">
            <li>
              <strong>Guaranteed unlock</strong> into the <em>Denara Copy Traders</em> roster.
            </li>
            <li>Highlighted profile on leaderboard & social shoutout.</li>
            <li>Priority access to upcoming Denara features and beta tools.</li>
          </ul>
          <div className="perks__actions">
            <button className="link-btn" onClick={() => setShowRules(true)}>
              Read tournament rules →
            </button>
          </div>
        </div>

        <div className="perks__card">
          <h3>Tournament Rules (Quick)</h3>
          <ul className="perks__list">
            <li>Only trades within the tournament window are counted.</li>
            <li>Fair play required. Suspicious activity may lead to disqualification.</li>
          </ul>
        </div>
      </section>

      {/* ===== FORM / LEADERBOARD SECTION ===== */}
      <section className="form-section" id="register" ref={formRef}>
        <div className="signup-card">
          <h2>{registrationClosed ? 'Tournament Registration Closed' : 'Enter Tournament'}</h2>
          <p className="hint">
            {registrationClosed
              ? 'Registration is now closed. You can still follow the action on the live leaderboard.'
              : <>
                  Provide your username and Deriv token. Email is required.
                  {' '}
                  {registrationOpen
                    ? ''
                    : ' Registration opens soon.'}
                </>
            }
          </p>

          {registrationClosed ? (
            <div className="signup-closed">
              <button
                type="button"
                className="btn"
                onClick={openLeaderboard}
              >
                View Leaderboard
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="signup-form" autoComplete="off">
              <label className="field">
                <span>Username</span>
                <input
                  type="text"
                  inputMode="text"
                  placeholder="e.g. Beast"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  minLength={3}
                  maxLength={64}
                  required
                  disabled={!registrationOpen || loading}
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
                  disabled={!registrationOpen || loading}
                />
                <small className="muted">Validated by Deriv real USD only.</small>
              </label>

              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  disabled={!registrationOpen || loading}
                />
              </label>

              <button type="submit" className="btn" disabled={submitDisabled}>
                {loading
                  ? 'Validating…'
                  : registrationClosed
                    ? 'Registration Closed'
                    : 'Register Tournament'}
              </button>

              {msg && <div className="alert ok">{msg}</div>}
              {err && <div className="alert err">{err}</div>}
            </form>
          )}
        </div>
      </section>

      {/* ===== INLINE DEPOSIT (toggled) ===== */}
      {showDeposit && (
        <section className="deposit-inline" ref={depositRef}>
          <h2 className="deposit-inline__title">Deposit</h2>
          <Deposit />
        </section>
      )}

      {/* ===== FOOTER NOTE ===== */}
      <section className="footnote">
        <p>
          Registration window: <strong>{startLabel}</strong> to <strong>{endLabel}</strong>.
        </p>
      </section>

      {/* ===== RULES MODAL ===== */}
      {showRules && (
        <div
          id="rules-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rules-title"
          className="modal"
          onClick={e => {
            if (e.target === e.currentTarget) setShowRules(false);
          }}
        >
          <div className="modal__dialog" role="document">
            <header className="modal__header">
              <h2 id="rules-title">Denara Trading Tournament — Rules (Bots Allowed)</h2>
              <button
                ref={modalCloseBtnRef}
                className="modal__close"
                aria-label="Close"
                onClick={() => setShowRules(false)}
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
                  <li>Late registration allowed until halfway through the tournament.</li>
                  <li>Registration info must be accurate.</li>
                </ul>
              </section>

              <section>
                <h3>2) Code of conduct</h3>
                <ul>
                  <li>Be respectful. No harassment, hate speech, or discrimination.</li>
                  <li>
                    Disruptive behavior or attempts to damage Denara/Deriv reputation may lead to
                    disqualification.
                  </li>
                </ul>
              </section>

              <section>
                <h3>3) How it works</h3>
                <ul>
                  <li>Trade Derived synthetic indices. Standings use the balance tied to your account.</li>
                  <li>Eligibility: at least one closed trade during the window.</li>
                  <li>
                    Ranking: by <strong>Return %</strong> from your baseline balance.
                  </li>
                  <li>Deposits/withdrawals are ignored for P/L; only closed trades after baseline count.</li>
                  <li>Only trades placed on denarapro.com qualify for tally.</li>
                  <li>Ties: earliest time reaching the same Return % ranks higher.</li>
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
                  <li>Prize pool: <strong>Starting $200</strong></li>
                  <li>
                    Winner unlocks{' '}
                    <button type="button" className="link-btn" onClick={openDepositInline}>
                      Denara Paid Copy-Trader
                    </button>{' '}
                    listing (subject to review).
                  </li>
                  <li>Winners contacted within 48h after the tournament ends;</li>
                  <li>Prizes paid into Deriv accounts; taxes are your responsibility.</li>
                  <li>Winning trades may be audited before payout.</li>
                </ul>
              </section>

              <section>
                <h3>6) Privacy</h3>
                <p>
                  By joining, you consent to us using your info to run the tournament, show your username
                  on the leaderboard, and share winners on social channels.
                </p>
              </section>

              <section>
                <h3>7) Final notes</h3>
                <ul>
                  <li>Denara may modify, cancel, or postpone the tournament at any time.</li>
                  <li>We aren’t liable for platform outages, market events, or connectivity issues.</li>
                  <li>All disputes are subject to Denara’s final review and decision.</li>
                </ul>
              </section>

              <section>
                <h3>Bot policy (allowed)</h3>
                <p>Trade responsibly. Capital at risk.</p>
              </section>
            </div>

            <footer className="modal__footer">
              <button className="btn" onClick={() => setShowRules(false)}>
                Agree
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default TournamentLanding;
