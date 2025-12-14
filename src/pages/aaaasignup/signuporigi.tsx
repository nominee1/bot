import { useEffect, useMemo, useRef, useState } from 'react';
import DENARATORNA from '../../../public/assets/images/DENARATORNA.png';
import './SignupTournament.scss';

const API_URL = 'https://ttt.binaryke.com/api/register.php';
const DERIV_APP_ID = 36300;

/** ======= CONFIG ======= */
/**
 * Returns the countdown END instant:
 * Monday 09:00 EAT (UTC+3) + 10 hours => Monday 19:00 EAT
 * If today is Monday, use today; otherwise the next Monday.
 * Name kept the same as requested.
 */
function getNextMondayStart(): Date {
  const now = new Date();

  // Treat Africa/Nairobi as UTC+3 (no DST). Compute in UTC to avoid local tz issues.
  const NAIROBI_UTC_OFFSET_HOURS = 3;
  const nowInNairobi = new Date(now.getTime() + NAIROBI_UTC_OFFSET_HOURS * 3600 * 1000);

  const y = nowInNairobi.getUTCFullYear();
  const m = nowInNairobi.getUTCMonth();
  const d = nowInNairobi.getUTCDate();
  const day = nowInNairobi.getUTCDay(); // 0=Sun, 1=Mon, ... 6=Sat

  // If it's Monday in Nairobi, use today; else compute days until next Monday.
  const daysUntilMon = (1 - day + 7) % 7; // 0 if Monday
  // Monday 09:00 EAT is 06:00 UTC; add 10h => 16:00 UTC (19:00 EAT).
  const endUtcMs = Date.UTC(y, m, d + daysUntilMon, 16, 0, 0, 0);

  return new Date(endUtcMs);
}

const countdownTarget = getNextMondayStart();

type TCountdown = { d: number; h: number; m: number; s: number; done: boolean };

// Prefer the production cluster; fall back if needed.
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
      try { ws.close(); } catch {}
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      tidy();
      reject(new Error('Token check timed out. Please try again.'));
    }, timeoutMs);

    ws.onopen = () => {
      ws.send(JSON.stringify({ authorize: token }));
    };

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
        reject(new Error('Connection closed before validation finished.'));
      }
    };
  });
}

const TournamentLanding = () => {
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [email,   setEmail] = useState('');       // optional
  const [whatsapp, setWhatsapp] = useState('');   // optional

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<TCountdown>({ d: 0, h: 0, m: 0, s: 0, done: false });

  // Rules modal
  const [showRules, setShowRules] = useState(false);

  const formRef = useRef<HTMLDivElement | null>(null);
  const modalCloseBtnRef = useRef<HTMLButtonElement | null>(null);

  // For display only
  const startDateLabel = useMemo(() => {
    return countdownTarget.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, []);

  // Countdown tick
  useEffect(() => {
    const registrationDeadline = countdownTarget.getTime();

    const tick = () => {
      const now = Date.now();
      const diff = registrationDeadline - now;
      if (diff <= 0) {
        setCountdown({ d: 0, h: 0, m: 0, s: 0, done: true });
        return;
      }
      const d = Math.floor(diff / (1000 * 60 * 60 * 24));
      const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);
      setCountdown({ d, h, m, s, done: false });
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // When true, inputs + submit must lock and submit hard-blocks
  const registrationClosed = countdown.done || Date.now() >= countdownTarget.getTime();

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

  // simple validators
  const isValidEmail = (val: string) => val === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

  const normalizeWhatsapp = (val: string) => val.replace(/[()\-\s]/g, ''); // keep + and digits
  const isValidWhatsapp = (val: string) => {
    if (val === '') return true; // optional
    const normalized = normalizeWhatsapp(val);
    return /^\+?\d{7,15}$/.test(normalized);
  };

  async function validateDerivTokenOrThrow(userToken: string) {
    const auth = await derivAuthorize(userToken, DERIV_APP_ID);

    // real only
    if (auth.is_virtual === 1 || /^VRTC/i.test(auth.loginid)) {
      throw new Error('Please provide a REAL account token (not demo).');
    }
    // USD only
    if ((auth.currency || '').toUpperCase() !== 'USD') {
      throw new Error('Only USD accounts are allowed for this tournament.');
    }
    return auth;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);

    if (registrationClosed) {
      setErr('Registration is closed.');
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
    if (!isValidWhatsapp(whatsapp)) {
      setErr('WhatsApp number looks invalid. Use digits with optional leading +.');
      return;
    }

    try {
      setLoading(true);

      // Deriv token validation
      await validateDerivTokenOrThrow(token);

      // Submit to API
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          token,
          email: email || null,
          whatsapp: whatsapp ? normalizeWhatsapp(whatsapp) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Registration failed');
      }
      setMsg(`Registered as ${data.username}.`);
      setToken('');
      setWhatsapp('');
      // leave email & username for convenience
    } catch (e: any) {
      setErr(e?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tournament-landing">
      {/* ===== HERO ===== */}
      <section className="hero">
        <div className="hero__grid">
          {/* Left copy */}
          <div className="hero__col hero__col--copy">
            <div className="hero__body">
              <h1 className="hero__title">Denara Real Trading Tournament</h1>
              <p className="hero__subtitle">
                Prize Pool: <strong>Starting $200</strong> • Ends <strong>Wed, Oct 15, 09.00AM</strong>
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
                  <span className="countdown__label">Registration ends in</span>
                  <div className="countdown__digits">
                    <div className="cd-chip">
                      <span>{String(countdown.d).padStart(2, '0')}</span>
                      <small>Days</small>
                    </div>
                    <div className="cd-chip">
                      <span>{String(countdown.h).padStart(2, '0')}</span>
                      <small>Hours</small>
                    </div>
                    <div className="cd-chip">
                      <span>{String(countdown.m).padStart(2, '0')}</span>
                      <small>Mins</small>
                    </div>
                    <div className="cd-chip">
                      <span>{String(countdown.s).padStart(2, '0')}</span>
                      <small>Secs</small>
                    </div>
                  </div>
                  {registrationClosed && <div className="countdown__closed">Registration closed</div>}
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
            <li><strong>Guaranteed unlock</strong> into the <em>Denara Copy Traders</em> roster.</li>
            <li>Highlighted profile on leaderboard & social shoutout.</li>
            <li>Priority access to upcoming Denara features and beta tools.</li>
          </ul>
          <div className="perks__actions">
            <button className="link-btn" onClick={() => setShowRules(true)}>Read tournament rules →</button>
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

      {/* ===== FORM ===== */}
      <section className="form-section" id="register" ref={formRef}>
        <div className="signup-card">
          <h2>Enter Tournament</h2>
          <p className="hint">Provide your username and Deriv token. Email & Tel are optional.</p>

          <form onSubmit={onSubmit} className="signup-form" autoComplete="off">
            <label className="field">
              <span>Username</span>
              <input
                type="text"
                inputMode="text"
                placeholder="e.g. Beastpro"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                minLength={3}
                maxLength={64}
                required
                disabled={registrationClosed || loading}
              />
            </label>

            <label className="field">
              <span>Deriv Real Token</span>
              <input
                type="password"
                placeholder="Paste Api Token (Read|Trade|Trading Information)"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                disabled={registrationClosed || loading}
              />
            </label>

            <label className="field">
              <span>Email</span>
              <input
                type="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={registrationClosed || loading}
              />
            </label>

            <label className="field">
              <span>Tel <small className="muted">(optional)</small></span>
              <input
                type="tel"
                inputMode="tel"
                placeholder="+2547XXXXXXXX"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                disabled={registrationClosed || loading}
              />
              <small className="muted">Use digits with optional leading + (e.g., +2547…)</small>
            </label>

            <button type="submit" className="btn" disabled={loading || registrationClosed}>
              {loading ? 'Validating…' : (registrationClosed ? 'Registration Closed' : 'Register Tournament')}
            </button>

            {msg && <div className="alert ok">{msg}</div>}
            {err && <div className="alert err">{err}</div>}
          </form>
        </div>
      </section>

      {/* ===== FOOTER NOTE ===== */}
      <section className="footnote">
        <p>
          By registering you agree to the tournament rules. Registration closes:&nbsp;
          <strong>{startDateLabel}</strong>.
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
          onClick={(e) => {
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
                  <li>Disruptive behavior or attempts to damage Denara/Deriv reputation may lead to disqualification.</li>
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
                  <li>Top 3 also unlock <em>Denara Paid Copy-Trader</em> listing (subject to review).</li>
                  <li>Winners contacted within 48h after the tournament ends;</li>
                  <li>Prizes paid into Deriv accounts; taxes are your responsibility.</li>
                  <li>Winning trades may be audited before payout.</li>
                </ul>
              </section>

              <section>
                <h3>6) Privacy</h3>
                <p>
                  By joining, you consent to us using your info to run the tournament, show your username on the leaderboard, and share winners on social channels.
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
              <button className="btn" onClick={() => setShowRules(false)}>Agree</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default TournamentLanding;
