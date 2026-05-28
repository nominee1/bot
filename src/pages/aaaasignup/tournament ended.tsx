// TournamentLanding.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import DENARATORNA from '../../../public/assets/images/DENARATORNA.png';
import ParticipantsLeaderboard from '../aaaaleaderboard';
import './SignupTournament.scss';

const API_URL = 'https://ttt.binaryke.com/api/register.php';
const DERIV_APP_ID = 36300;

function getNextMondayStart(): Date {
  const now = new Date();
  const NAIROBI_UTC_OFFSET_HOURS = 3;
  const nowInNairobi = new Date(now.getTime() + NAIROBI_UTC_OFFSET_HOURS * 3600 * 1000);

  const y = nowInNairobi.getUTCFullYear();
  const m = nowInNairobi.getUTCMonth();
  const d = nowInNairobi.getUTCDate();
  const day = nowInNairobi.getUTCDay();

  const daysUntilMon = (1 - day + 7) % 7;
  const endUtcMs = Date.UTC(y, m, d + daysUntilMon, 16, 0, 0, 0);
  return new Date(endUtcMs);
}

const countdownTarget = getNextMondayStart();

type TCountdown = { d: number; h: number; m: number; s: number; done: boolean };

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
      try { ws.close(); } catch {}
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
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        tidy();
        reject(new Error('Network error talking to Deriv.'));
      }
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
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<TCountdown>({ d: 0, h: 0, m: 0, s: 0, done: true });

  const [showRules, setShowRules] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const formRef = useRef<HTMLDivElement | null>(null);
  const modalCloseBtnRef = useRef<HTMLButtonElement | null>(null);

  const startDateLabel = useMemo(() => {
    return countdownTarget.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, []);

  const registrationClosed = true;

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const isValidEmail = (val: string) => val === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
  const normalizeWhatsapp = (val: string) => val.replace(/[()\-\s]/g, '');
  const isValidWhatsapp = (val: string) => {
    if (val === '') return true;
    const normalized = normalizeWhatsapp(val);
    return /^\+?\d{7,15}$/.test(normalized);
  };

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
      setErr('Invalid email format.');
      return;
    }
    if (!isValidWhatsapp(whatsapp)) {
      setErr('Invalid WhatsApp number.');
      return;
    }

    try {
      setLoading(true);
      await validateDerivTokenOrThrow(token);
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
      if (!res.ok || !data.ok) throw new Error(data?.error || 'Registration failed');
      setMsg(`Registered as ${data.username}.`);
      setToken('');
      setWhatsapp('');
    } catch (e: any) {
      setErr(e?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  // Leaderboard view (header removed)
  if (showLeaderboard) {
    return (
      <div className="tournament-landing leaderboard-view">
        <div className="leaderboard-view__content">
          <ParticipantsLeaderboard />
        </div>
      </div>
    );
  }

  // Default landing view
  return (
    <div className="tournament-landing">
      {/* HERO */}
      <section className="hero">
        <div className="hero__grid">
          <div className="hero__col hero__col--copy">
            <div className="hero__body">
              <h1 className="hero__title">Denara Real Trading Tournament</h1>
              <p className="hero__subtitle">
                Prize Pool: <strong>Starting $200</strong> • <strong>Tournament Ended</strong>
              </p>

              <div className="hero__cta">
                <button className="btn btn--primary" onClick={() => setShowLeaderboard(true)}>
                  View Leaderboard →
                </button>

                <div className="countdown">
                  <span className="countdown__label">Tournament ended</span>
                  <div className="countdown__digits">
                    {['Days', 'Hours', 'Mins', 'Secs'].map((label, i) => (
                      <div className="cd-chip" key={i}>
                        <span>00</span>
                        <small>{label}</small>
                      </div>
                    ))}
                  </div>
                  <div className="countdown__closed">Registration closed</div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT IMAGE */}
          <div className="hero__col hero__col--art" aria-hidden="true">
            <div className="hero__art">
              <div className="hero__ring" />
              <img
                className="hero__img"
                src={DENARATORNA}
                alt="Denara Tournament visual"
                loading="eager"
                decoding="async"
              />
              <div className="hero__gridlines" />
            </div>
          </div>
        </div>
      </section>

      {/* PERKS */}
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

      {/* RULES MODAL */}
      {showRules && (
        <div
          id="rules-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rules-title"
          className="modal"
          onClick={(e) => e.target === e.currentTarget && setShowRules(false)}
        >
          <div className="modal__dialog" role="document">
            <header className="modal__header">
              <h2 id="rules-title">Denara Trading Tournament — Rules</h2>
              <button ref={modalCloseBtnRef} className="modal__close" onClick={() => setShowRules(false)}>✕</button>
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
                  <li>Free DenaraPro logins for top 10.</li>
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
