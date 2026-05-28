import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    DENARA_COMPETITION_USERNAME_CHANGED_EVENT,
    getCompetitionChallengePhpBaseUrl,
    getDenaraCompetitionUsername,
} from '@/components/shared/utils/competition/denara-competition-profile';
import './challengeSetup.scss';

type ChallengeType = 'free' | 'paid';

type Props = {
  apiBaseUrl?: string;
  onCreateChallenge?: (payload: {
    created_by_username: string;
    name: string;
    challenge_type: ChallengeType;
    entry_fee: number;
    minimum_balance: number;
    start_time: string;
    end_time: string;
    join_cutoff_hours_before_end: number;
  }) => Promise<void> | void;
};

type ApiOk<T> = {
  ok: true;
} & T;

type ApiErr = {
  ok?: false;
  error?: string;
};

const MAX_CHALLENGE_HOURS = 72;
const MIN_CHALLENGE_MINUTES = 30;

const JOIN_CUTOFF_OPTIONS = [
  { label: 'No cutoff', value: 0 },
  { label: '1 hour before end', value: 1 },
  { label: '2 hours before end', value: 2 },
  { label: '3 hours before end', value: 3 },
  { label: '6 hours before end', value: 6 },
  { label: '12 hours before end', value: 12 },
  { label: '24 hours before end', value: 24 },
];

const pad2 = (n: number) => String(n).padStart(2, '0');

const toDatetimeLocal = (date: Date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
};

const fromDatetimeLocal = (value: string) => new Date(value).getTime();

const formatUsd = (n: number) => `${n.toFixed(2)} USD`;

const formatDuration = (ms: number) => {
  if (ms <= 0) return '0h 0m';

  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return parts.join(' ');
};

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data: T | ApiErr;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The server returned an unexpected response. Please try again.');
  }

  if (!res.ok || (typeof data === 'object' && data !== null && 'ok' in data && (data as ApiErr).ok === false)) {
    throw new Error((data as ApiErr)?.error || `Request failed (${res.status})`);
  }

  return data as T;
}

const ChallengeSetup = ({
  apiBaseUrl = getCompetitionChallengePhpBaseUrl(),
  onCreateChallenge,
}: Props) => {
  const now = new Date();
  const defaultStart = new Date(now.getTime() + 15 * 60 * 1000);
  const defaultEnd = new Date(defaultStart.getTime() + MIN_CHALLENGE_MINUTES * 60 * 1000);

  const [denaraUsername, setDenaraUsername] = useState(() => getDenaraCompetitionUsername() ?? '');

  const syncDenaraUsername = useCallback(() => {
    setDenaraUsername(getDenaraCompetitionUsername() ?? '');
  }, []);

  useEffect(() => {
    syncDenaraUsername();
    window.addEventListener('focus', syncDenaraUsername);
    window.addEventListener(DENARA_COMPETITION_USERNAME_CHANGED_EVENT, syncDenaraUsername);
    return () => {
      window.removeEventListener('focus', syncDenaraUsername);
      window.removeEventListener(DENARA_COMPETITION_USERNAME_CHANGED_EVENT, syncDenaraUsername);
    };
  }, [syncDenaraUsername]);

  const [challengeName, setChallengeName] = useState('');
  const [challengeType, setChallengeType] = useState<ChallengeType>('free');
  const [entryFee, setEntryFee] = useState<string>('0');
  const [minimumBalance, setMinimumBalance] = useState<string>('10');
  const [startTime, setStartTime] = useState(toDatetimeLocal(defaultStart));
  const [endTime, setEndTime] = useState(toDatetimeLocal(defaultEnd));
  const [joinCutoffHours, setJoinCutoffHours] = useState(3);

  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  useEffect(() => {
    if (!howItWorksOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHowItWorksOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [howItWorksOpen]);

  const entryFeeNum = useMemo(() => {
    const n = Number(entryFee);
    return Number.isFinite(n) ? n : 0;
  }, [entryFee]);

  const minimumBalanceNum = useMemo(() => {
    const n = Number(minimumBalance);
    return Number.isFinite(n) ? n : 0;
  }, [minimumBalance]);

  const startMs = useMemo(() => fromDatetimeLocal(startTime), [startTime]);
  const endMs = useMemo(() => fromDatetimeLocal(endTime), [endTime]);

  const durationMs = endMs - startMs;
  const durationHours = durationMs / (1000 * 60 * 60);

  const joinCloseMs = useMemo(() => {
    return endMs - joinCutoffHours * 60 * 60 * 1000;
  }, [endMs, joinCutoffHours]);

  const totalRequired = useMemo(() => {
    return Number((minimumBalanceNum + (challengeType === 'paid' ? entryFeeNum : 0)).toFixed(2));
  }, [minimumBalanceNum, challengeType, entryFeeNum]);

  const createValidation = useMemo(() => {
    if (!denaraUsername.trim()) {
      return 'Set your Denara username with the floating Denara ID button (bottom-right), then open this tab again.';
    }
    if (!challengeName.trim()) return 'Challenge name is required.';
    if (challengeName.trim().length < 3) return 'Challenge name must be at least 3 characters.';
    if (!Number.isFinite(minimumBalanceNum) || minimumBalanceNum <= 0) return 'Minimum balance must be above 0.';
    if (challengeType === 'paid' && (!Number.isFinite(entryFeeNum) || entryFeeNum <= 0)) {
      return 'Paid challenges must have an entry fee above 0.';
    }
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 'Please choose valid start and end times.';
    if (endMs <= startMs) return 'End time must be later than start time.';
    if (durationMs < MIN_CHALLENGE_MINUTES * 60 * 1000) {
      return `Challenge duration must be at least ${MIN_CHALLENGE_MINUTES} minutes.`;
    }
    if (durationHours > MAX_CHALLENGE_HOURS) return 'Challenge duration cannot exceed 3 days.';
    if (joinCloseMs < startMs) return 'Join cutoff cannot close before the challenge starts.';
    return null;
  }, [
    denaraUsername,
    challengeName,
    minimumBalanceNum,
    challengeType,
    entryFeeNum,
    startMs,
    endMs,
    durationMs,
    durationHours,
    joinCloseMs,
  ]);

  const onSubmitCreateChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreateSuccess(null);

    if (createValidation) {
      setCreateError(createValidation);
      return;
    }

    const payload = {
      created_by_username: denaraUsername.trim(),
      name: challengeName.trim(),
      challenge_type: challengeType,
      entry_fee: Number(entryFeeNum.toFixed(2)),
      minimum_balance: Number(minimumBalanceNum.toFixed(2)),
      start_time: new Date(startMs).toISOString(),
      end_time: new Date(endMs).toISOString(),
      join_cutoff_hours_before_end: joinCutoffHours,
    };

    try {
      setCreateLoading(true);

      if (onCreateChallenge) {
        await onCreateChallenge(payload);
        setCreateSuccess(`Challenge "${payload.name}" created successfully.`);
      } else {
        const data = await postJson<ApiOk<{ challenge?: { name?: string } }>>(
          `${apiBaseUrl.replace(/\/+$/, '')}/create_challenge.php`,
          payload
        );

        setCreateSuccess(`Challenge "${data.challenge?.name || payload.name}" created successfully.`);
      }

      setChallengeName('');
      setChallengeType('free');
      setEntryFee('0');
      setMinimumBalance('10');
      setStartTime(toDatetimeLocal(new Date(Date.now() + 15 * 60 * 1000)));
      setEndTime(toDatetimeLocal(new Date(Date.now() + (15 + MIN_CHALLENGE_MINUTES) * 60 * 1000)));
      setJoinCutoffHours(3);
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create challenge.');
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div className="challenge-setup-page challenge-setup-page--homely">
      <div className="challenge-setup-shell">
        <header className="challenge-setup-welcome">
          <div className="challenge-setup-welcome__main">
            <span className="challenge-setup-welcome__eyebrow">Your space to compete</span>
            <h1 className="challenge-setup-welcome__title">Live trading challenges</h1>
            <p className="challenge-setup-welcome__lead">
              Set up a timed challenge, invite traders, and celebrate a winner—from the first idea to the payout,
              without jumping through hoops.
            </p>
            <div className="challenge-setup-welcome__actions">
              <button
                type="button"
                className="btn btn--ghost btn--pill"
                onClick={() => setHowItWorksOpen(true)}
              >
                How it works
              </button>
            </div>
          </div>
          <aside className="challenge-setup-welcome__aside" aria-label="Eligible trading apps">
            <h2 className="challenge-setup-welcome__aside-title">Winnings and Prizes</h2>
            <p className="challenge-setup-welcome__aside-text">
              Prizes are automatically paid to the winner's Deriv account. For prizes and rankings, only trades placed through our approved Denara apps counts—see the HOW IT WORKS
              below for the full info.
            </p>
          </aside>
        </header>

      

        <div className="challenge-setup-grid challenge-setup-grid--single">
          <section className="setup-card setup-card--homely">
            <div className="setup-card__head">
              <h2>Start a challenge</h2>
              <p>Pick a name, challenge duration, joining cutoff time, free or paid.</p>
              <p className="setup-card__hint">
                Use the floating <strong>Denara ID</strong> button (bottom-right) to sign up so we know who&apos;s hosting. Login with the registerd username on the denara ID on the top right. For paid challenge, make sure your token has payment permissions enabled
              </p>
            </div>

            <form className="setup-form" onSubmit={onSubmitCreateChallenge} autoComplete="off">
              <label className="field">
                <span>Denara username</span>
                <input
                  type="text"
                  readOnly
                  className="field-input--readonly"
                  value={denaraUsername}
                  placeholder="Set with the Denara ID button"
                  aria-label="Denara username used as challenge creator"
                />
                <small>
                  {denaraUsername.trim()
                    ? 'This is the creator name for the challenge challenge.'
                    : 'Register with the Denara ID button first — your name appears here automatically.'}
                </small>
              </label>

              <label className="field">
                <span>Challenge Name</span>
                <input
                  type="text"
                  placeholder=" "
                  value={challengeName}
                  onChange={e => setChallengeName(e.target.value)}
                  disabled={createLoading}
                  required
                />
              </label>

              <div className="form-row form-row--2">
                <label className="field">
                  <span>Challenge Type</span>
                  <select
                    value={challengeType}
                    onChange={e => setChallengeType(e.target.value as ChallengeType)}
                    disabled={createLoading}
                  >
                    <option value="free">Free</option>
                    <option value="paid">Paid</option>
                  </select>
                </label>

                <label className="field">
                  <span>Entry Fee (USD)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={entryFee}
                    onChange={e => setEntryFee(e.target.value)}
                    disabled={createLoading || challengeType === 'free'}
                  />
                  <small>
                    {challengeType === 'free'
                      ? 'Free challenges do not collect entry fees.'
                      : 'Entry fee grows the prize pool.'}
                  </small>
                </label>
              </div>

              <div className="form-row form-row--2">
                <label className="field">
                  <span>Minimum Balance (USD)</span>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={minimumBalance}
                    onChange={e => setMinimumBalance(e.target.value)}
                    disabled={createLoading}
                  />
                </label>

                <label className="field">
                  <span>Join Cutoff</span>
                  <select
                    value={joinCutoffHours}
                    onChange={e => setJoinCutoffHours(Number(e.target.value))}
                    disabled={createLoading}
                  >
                    {JOIN_CUTOFF_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="form-row form-row--2">
                <label className="field">
                  <span>Start Time</span>
                  <input
                    type="datetime-local"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    disabled={createLoading}
                    required
                  />
                </label>

                <label className="field">
                  <span>End Time</span>
                  <input
                    type="datetime-local"
                    value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                    disabled={createLoading}
                    required
                  />
                </label>
              </div>

              <div className="challenge-preview">
                <div className="challenge-preview__head">
                  <h3>Challenge Preview</h3>
                </div>

                <div className="challenge-preview__grid">
                  <div className="preview-item">
                    <span className="preview-item__label">Duration</span>
                    <strong className="preview-item__value">{formatDuration(durationMs)}</strong>
                  </div>

                  <div className="preview-item">
                    <span className="preview-item__label">Join closes at</span>
                    <strong className="preview-item__value">
                      {Number.isNaN(joinCloseMs) ? '—' : new Date(joinCloseMs).toLocaleString()}
                    </strong>
                  </div>

                  <div className="preview-item">
                    <span className="preview-item__label">Total needed to join</span>
                    <strong className="preview-item__value">{formatUsd(totalRequired)}</strong>
                  </div>

                  <div className="preview-item">
                    <span className="preview-item__label">Prize pool basis</span>
                    <strong className="preview-item__value">
                      {challengeType === 'paid' ? 'Entry fee × joined traders' : 'Free challenge'}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="setup-form__actions">
                <button type="submit" className="btn" disabled={createLoading}>
                  {createLoading ? 'Creating…' : 'Start Challenge'}
                </button>
              </div>

              {createValidation && !createError && (
                <div className="alert alert--warn">{createValidation}</div>
              )}

              {createSuccess && <div className="alert alert--ok">{createSuccess}</div>}
              {createError && <div className="alert alert--err">{createError}</div>}
            </form>
          </section>
        </div>
      </div>

      {/* Clears fixed app chrome / overlays when scrolling on narrow viewports */}
      <div className='challenge-setup-page__mobile-scroll-margin' aria-hidden />

      {howItWorksOpen && (
        <div
          className="lc-modal-backdrop"
          role="presentation"
          onClick={() => setHowItWorksOpen(false)}
        >
          <div
            className="lc-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lc-how-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="lc-modal__head">
              <h2 id="lc-how-title" className="lc-modal__title">
                How it works
              </h2>
              <p className="lc-modal__subtitle">
                From hosting a challenge to paying the winner—here&apos;s the friendly version of the journey.
              </p>
              <button
                type="button"
                className="lc-modal__close"
                onClick={() => setHowItWorksOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <ol className="lc-how-steps">
              <li className="lc-how-step">
                <span className="lc-how-step__num" aria-hidden>
                  1
                </span>
                <div className="lc-how-step__body">
                  <h3 className="lc-how-step__title">Say who you are</h3>
                  <p className="lc-how-step__text">
                    Tap the <strong>Denara ID</strong> button and save your username. That tells us you&apos;re the
                    person creating the challenge—no extra signup on this screen.
                  </p>
                </div>
              </li>
              <li className="lc-how-step">
                <span className="lc-how-step__num" aria-hidden>
                  2
                </span>
                <div className="lc-how-step__body">
                  <h3 className="lc-how-step__title">Design your challenge</h3>
                  <p className="lc-how-step__text">
                    Choose a name, start and finish times, and whether it&apos;s free or paid. Set the minimum balance
                    traders should have and when joining closes—so everyone knows the deal up front.
                  </p>
                </div>
              </li>
              <li className="lc-how-step">
                <span className="lc-how-step__num" aria-hidden>
                  3
                </span>
                <div className="lc-how-step__body">
                  <h3 className="lc-how-step__title">Invite people to join</h3>
                  <p className="lc-how-step__text">
                    Share your challenge so traders hop in before the deadline. For paid challenges, entry fees grow the
                    prize pool; they&apos;ll complete whatever checkout or confirmation your flow asks for.
                  </p>
                </div>
              </li>
              <li className="lc-how-step">
                <span className="lc-how-step__num" aria-hidden>
                  4
                </span>
                <div className="lc-how-step__body">
                  <h3 className="lc-how-step__title">Trade during the live window</h3>
                  <p className="lc-how-step__text">
                    Once the clock starts, performance counts until the end time you picked. Remember: only trades on{' '}
                    <strong>Denara Digit Pro</strong>, <strong>Denara Pro</strong>, and <strong>app.denaratool.com</strong>{' '}
                    count toward prizes.
                  </p>
                </div>
              </li>
              <li className="lc-how-step">
                <span className="lc-how-step__num" aria-hidden>
                  5
                </span>
                <div className="lc-how-step__body">
                  <h3 className="lc-how-step__title">Winner &amp; payout</h3>
                  <p className="lc-how-step__text">
                    When the challenge ends, the top trader by the rules we publish wins bragging rights—and for paid
                    pools, their share of the prize money follows the usual payout steps (typically after results are
                    finalized).
                  </p>
                </div>
              </li>
            </ol>

            <div className="lc-how-callouts">
              <article className="lc-how-callout">
                <h3 className="lc-how-callout__title">Prize eligibility</h3>
                <p className="lc-how-callout__text">
                  Only trades placed on <strong>Denara Digit Pro</strong>, <strong>Denara Pro</strong>, and{' '}
                  <strong>app.denaratool.com</strong> qualify for challenge prizes. Activity on other platforms or
                  apps does not count toward rankings or payouts.
                </p>
              </article>
              <article className="lc-how-callout">
                <h3 className="lc-how-callout__title">How to join paid challenges</h3>
                <p className="lc-how-callout__text">
                  Open the challenge before the join cutoff, choose <strong>Join</strong>, then complete the entry fee
                  step shown on your screen. Once confirmed, you are marked as joined and your spot is locked in for
                  the live window.
                </p>
              </article>
              <article className="lc-how-callout">
                <h3 className="lc-how-callout__title">How winner prizes are paid</h3>
                <p className="lc-how-callout__text">
                  For paid challenges, the
                  winner receives the prize payout from the total challenge pool from all traders who joined the challenge.E.g 10 traders joined with $10 entry fee, the winner will receive $100 at the end of the challenge. The funds can only be released by the winner of the challenge.
                </p>
              </article>
            </div>

            <div className="lc-modal__foot">
              <button type="button" className="btn btn--pill" onClick={() => setHowItWorksOpen(false)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChallengeSetup;