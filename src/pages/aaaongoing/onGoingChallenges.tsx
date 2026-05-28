import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCompetitionPhpApiBaseUrl } from '@/components/shared/utils/competition/denara-competition-profile';
import './onGoingChallenges.scss';

type ChallengeStatus = 'upcoming' | 'live_open' | 'live_locked' | 'ended' | 'cancelled';

type Challenge = {
  id: number;
  name: string;
  created_by_trader_id?: number;
  created_by_username: string;
  challenge_type: 'free' | 'paid';
  entry_fee: number;
  minimum_balance: number;
  participant_count: number;
  prize_pool: number;
  start_time: string;
  end_time: string;
  join_cutoff_hours_before_end: number;
  status: ChallengeStatus;
  /** Raw DB: paid challenges are `pending` until the challenge ends and payout runs. */
  payout_status?: string;
  /** API: `scheduled` while live/upcoming; then `pending` / `paid` / … on ended. */
  payout_status_display?: string;
};

type Participant = {
  id: number;
  challenge_id: number;
  trader_id: number;
  username: string;
  email?: string;
  join_status: 'joined' | 'rejected' | 'removed';
  entry_fee_paid: number;
  minimum_balance_required: number;
  total_required: number;
  balance_checked: number | null;
  joined_at: string;
  updated_at: string;
};

type StatementTx = {
  id: string;
  time: string;
  action_type: string;
  reference_id?: string;
  contract_type?: string;
  amount: number;
  balance_after: number;
};

type Props = {
  apiBaseUrl?: string;
  /** Prefills join field when empty (e.g. Denara username from dashboard). */
  defaultJoinUsername?: string;
  onValidateJoiner?: (username: string) => Promise<{
    balance: number;
    currency: string;
    is_virtual: number;
    loginid?: string;
  }>;
};

type ListChallengesResponse = {
  ok: true;
  results: Challenge[];
  count: number;
};

type ListParticipantsResponse = {
  ok: true;
  challenge: Challenge;
  participants: Participant[];
  count: number;
};

type ChallengeParticipantStatementsResponse = {
  ok: true;
  source: 'virtual' | 'deriv';
  challenge_id: number;
  username: string;
  /** Effective USD minimum for ranking for this challenge (matches `challenge_ranking_lib` / eligibility copy). */
  min_rank_balance_usd?: number;
  statements: StatementTx[];
  metrics: {
    baselineTime: number;
    baselineBal: number | null;
    netPL: number;
    trades: number;
    endBal: number | null;
    currency: string;
    turnover: number;
  };
  rank: {
    return_pct: number | null;
    is_rank_eligible: boolean;
    reason: string | null;
  };
};

type JoinChallengeResponse = {
  ok: true;
  participant: {
    challenge_id: number;
    trader_id: number;
    username: string;
    email?: string;
    entry_fee_paid: number;
    minimum_balance_required: number;
    total_required: number;
    balance_checked: number;
    challenge_status: string;
  };
};

type PrepareJoinPaymentResponse = {
  ok: true;
  join_payment: {
    id: number;
    challenge_id: number;
    trader_id: number;
    username: string;
    amount: number;
    currency: string;
    status: string;
    otp_required: number;
  };
  otp: {
    sent: boolean;
    to: string;
  };
  account?: {
    balance?: number;
    currency?: string;
  };
  challenge?: {
    id: number;
    name: string;
    entry_fee: number;
    minimum_balance: number;
    status: string;
  };
  next_step?: string;
};

type ConfirmJoinPaymentResponse = {
  ok: true;
  join_payment: {
    id: number;
    challenge_id: number;
    trader_id: number;
    username: string;
    amount: number;
    currency: string;
    status: string;
    deriv_txid?: string | null;
  };
  participant: {
    challenge_id: number;
    trader_id: number;
    username: string;
  };
  challenge: {
    id: number;
    name: string;
    status: string;
  };
};

type ApiErr = {
  ok?: false;
  error?: string;
};

function throwFetchContext(url: string, err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === 'Failed to fetch' || err instanceof TypeError) {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
      // Full URL is for local debugging only; never show it in UI.
      console.warn('[onGoingChallenges] fetch failed', { url, err });
    }
    throw new Error(
      'Could not reach the server. Check your connection and try again. If the problem continues, try refreshing the page or a different network.'
    );
  }
  throw err instanceof Error ? err : new Error(msg);
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', ...init });
  } catch (e) {
    throwFetchContext(url, e);
  }
  const text = await res.text();

  let data: T | ApiErr;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The server returned an unexpected response. Please try again.');
  }

  if (
    !res.ok ||
    (typeof data === 'object' &&
      data !== null &&
      'ok' in data &&
      (data as ApiErr).ok === false)
  ) {
    throw new Error((data as ApiErr)?.error || `Request failed (${res.status})`);
  }

  return data as T;
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throwFetchContext(url, e);
  }

  const text = await res.text();

  let data: T | ApiErr;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The server returned an unexpected response. Please try again.');
  }

  if (
    !res.ok ||
    (typeof data === 'object' &&
      data !== null &&
      'ok' in data &&
      (data as ApiErr).ok === false)
  ) {
    throw new Error((data as ApiErr)?.error || `Request failed (${res.status})`);
  }

  return data as T;
}

const formatUsd = (n?: number | null) => {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  return `${n >= 0 ? '' : '-'}${Math.abs(n).toFixed(2)} USD`;
};

const formatAmtPlain = (n?: number | null) => {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  return `${n >= 0 ? '' : '-'}${Math.abs(n).toFixed(2)}`;
};

/** User-facing copy for API `payout_status_display` / `payout_status`. */
const formatPayoutStatusLabel = (display?: string, raw?: string) => {
  const key = (display || raw || '').toLowerCase().trim();
  const map: Record<string, string> = {
    scheduled: 'After challenge ends',
    pending: 'Queued (after end)',
    processing: 'Processing',
    paid: 'Paid',
    failed: 'Payout failed',
    not_applicable: '—',
  };
  return map[key] ?? (key || '—');
};

const formatAmtWithCurrency = (n: number | null | undefined, currency: string) => {
  const a = formatAmtPlain(n);
  if (a === '—') return '—';
  return `${a} ${currency || 'USD'}`;
};

const formatPctRank = (n?: number | null) =>
  n !== null && n !== undefined && typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(2)}%` : '—';

/** Shown when API marks the trader not rank-eligible; uses server `reason` when present. */
const rankIneligibilityExplanation = (
  reason: string | null | undefined,
  minRankUsd: number | null,
): string => {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (trimmed) return trimmed;
  const minLabel =
    typeof minRankUsd === 'number' && Number.isFinite(minRankUsd)
      ? `${minRankUsd.toFixed(2)} USD`
      : 'the challenge minimum';
  return `Not eligible for ranking yet: baseline must be at least ${minLabel} (challenge rule) and at least one closed trade must appear in this window (e.g. sell / won / lost on your statement).`;
};

const formatDate = (value?: string) => {
  if (!value) return '—';

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return '—';

  return d.toLocaleString();
};

const maskEmail = (email: string) => {
  const [user, domain] = email.split('@');

  if (!domain) return email;

  const maskedUser =
    user.length <= 2
      ? `${user[0] || '*'}*`
      : `${user[0]}${'*'.repeat(Math.max(0, user.length - 2))}${user.slice(-1)}`;

  const [domainName, tld] = domain.split('.');

  const maskedDomain =
    domainName && domainName.length > 2
      ? `${domainName[0]}${'*'.repeat(Math.max(0, domainName.length - 2))}${domainName.slice(-1)}`
      : domainName || '*';

  return `${maskedUser}@${maskedDomain}.${tld || ''}`;
};

const formatRemaining = (endTime: string) => {
  const diff = new Date(endTime).getTime() - Date.now();

  if (Number.isNaN(diff)) return '—';
  if (diff <= 0) return 'Ended';

  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);

  parts.push(`${minutes}m`);

  return parts.join(' ');
};

const getJoinCloseText = (challenge: Challenge) => {
  const endMs = new Date(challenge.end_time).getTime();

  if (Number.isNaN(endMs)) return '—';

  const closeMs = endMs - challenge.join_cutoff_hours_before_end * 60 * 60 * 1000;
  const now = Date.now();

  if (challenge.join_cutoff_hours_before_end === 0) return 'Open until end';
  if (now >= closeMs) return 'Joining closed';

  const diff = closeMs - now;
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);

  parts.push(`${minutes}m`);

  return `Closes in ${parts.join(' ')}`;
};

const isJoinClosed = (challenge?: Challenge | null) => {
  if (!challenge) return true;

  if (
    challenge.status === 'live_locked' ||
    challenge.status === 'ended' ||
    challenge.status === 'cancelled'
  ) {
    return true;
  }

  const endMs = new Date(challenge.end_time).getTime();

  if (!Number.isNaN(endMs) && challenge.join_cutoff_hours_before_end > 0) {
    const closeMs = endMs - challenge.join_cutoff_hours_before_end * 60 * 60 * 1000;

    if (Date.now() >= closeMs) {
      return true;
    }
  }

  return false;
};

const OngoingChallenges = ({
  apiBaseUrl = getCompetitionPhpApiBaseUrl(),
  defaultJoinUsername = '',
  onValidateJoiner,
}: Props) => {
  const base = apiBaseUrl.replace(/\/+$/, '');

  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [challengesLoading, setChallengesLoading] = useState(false);
  const [challengesErr, setChallengesErr] = useState<string | null>(null);

  const [selectedChallengeId, setSelectedChallengeId] = useState<number>(0);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [participantsErr, setParticipantsErr] = useState<string | null>(null);

  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const [statementsRows, setStatementsRows] = useState<StatementTx[]>([]);
  const [statementsLoading, setStatementsLoading] = useState(false);
  const [statementsErr, setStatementsErr] = useState<string | null>(null);
  const [statementSource, setStatementSource] = useState<'virtual' | 'deriv' | null>(null);
  const [statementMetrics, setStatementMetrics] = useState<ChallengeParticipantStatementsResponse['metrics'] | null>(
    null
  );
  const [statementRank, setStatementRank] = useState<ChallengeParticipantStatementsResponse['rank'] | null>(null);
  /** From statements API; aligns rank UI with server eligibility (not a generic default). */
  const [statementMinRankUsd, setStatementMinRankUsd] = useState<number | null>(null);

  const [joinName, setJoinName] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinMsg, setJoinMsg] = useState<string | null>(null);
  const [joinErr, setJoinErr] = useState<string | null>(null);

  const [otpModalOpen, setOtpModalOpen] = useState(false);
  const [pendingJoinPaymentId, setPendingJoinPaymentId] = useState<number | null>(null);
  const [pendingJoinUsername, setPendingJoinUsername] = useState<string>('');
  const [pendingJoinAmount, setPendingJoinAmount] = useState<number>(0);
  const [pendingJoinCurrency, setPendingJoinCurrency] = useState<string>('USD');
  const [otpCode, setOtpCode] = useState('');
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const selectedChallenge = useMemo(
    () => challenges.find(ch => ch.id === selectedChallengeId) ?? null,
    [challenges, selectedChallengeId]
  );

  /** USD floor used for rank eligibility: statements API (authoritative) or list_challenges row. */
  const rankMinBalanceDisplayUsd = useMemo(() => {
    if (statementMinRankUsd !== null && Number.isFinite(statementMinRankUsd)) {
      return statementMinRankUsd;
    }
    const ch = selectedChallenge?.minimum_balance;
    return typeof ch === 'number' && !Number.isNaN(ch) ? ch : null;
  }, [statementMinRankUsd, selectedChallenge?.minimum_balance]);

  const leaderboardRows = useMemo(() => {
    return [...participants]
      .filter(p => p.join_status === 'joined')
      .sort((a, b) => {
        const ta = new Date(a.joined_at).getTime();
        const tb = new Date(b.joined_at).getTime();

        if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
        if (Number.isNaN(ta)) return 1;
        if (Number.isNaN(tb)) return -1;

        return ta - tb;
      });
  }, [participants]);

  const totalRequired = useMemo(() => {
    if (!selectedChallenge) return 0;

    return (
      Number(selectedChallenge.minimum_balance || 0) +
      (selectedChallenge.challenge_type === 'paid'
        ? Number(selectedChallenge.entry_fee || 0)
        : 0)
    );
  }, [selectedChallenge]);

  const resetJoinFlow = useCallback(() => {
    setJoinMsg(null);
    setJoinErr(null);
    setOtpModalOpen(false);
    setPendingJoinPaymentId(null);
    setPendingJoinUsername('');
    setPendingJoinAmount(0);
    setPendingJoinCurrency('USD');
    setOtpCode('');
    setOtpSentTo(null);
  }, []);

  const fetchChallenges = useCallback(async () => {
    setChallengesLoading(true);
    setChallengesErr(null);

    try {
      const data = await getJson<ListChallengesResponse>(
        `${base}/list_challenges.php?status=live&limit=100`
      );

      const rows = data.results || [];

      setChallenges(rows);

      if (rows.length > 0) {
        setSelectedChallengeId(prev => {
          const exists = rows.some(ch => ch.id === prev);
          return exists ? prev : rows[0].id;
        });
      } else {
        setSelectedChallengeId(0);
      }
    } catch (err: any) {
      setChallengesErr(err?.message || 'Failed to load challenges.');
      setChallenges([]);
      setSelectedChallengeId(0);
    } finally {
      setChallengesLoading(false);
    }
  }, [base]);

  const fetchParticipants = useCallback(
    async (challengeId: number) => {
      if (!challengeId) {
        setParticipants([]);
        return;
      }

      setParticipantsLoading(true);
      setParticipantsErr(null);

      try {
        const data = await getJson<ListParticipantsResponse>(
          `${base}/list_challenge_participants.php?challenge_id=${challengeId}`
        );

        setParticipants(data.participants || []);
      } catch (err: any) {
        setParticipantsErr(err?.message || 'Failed to load participants.');
        setParticipants([]);
      } finally {
        setParticipantsLoading(false);
      }
    },
    [base]
  );

  useEffect(() => {
    void fetchChallenges();
  }, [fetchChallenges]);

  useEffect(() => {
    if (!defaultJoinUsername.trim()) return;
    setJoinName(prev => (prev.trim() ? prev : defaultJoinUsername.trim()));
  }, [defaultJoinUsername]);

  useEffect(() => {
    setSelectedUser(null);
    resetJoinFlow();

    if (selectedChallengeId) {
      void fetchParticipants(selectedChallengeId);
    } else {
      setParticipants([]);
    }
  }, [selectedChallengeId, fetchParticipants, resetJoinFlow]);

  useEffect(() => {
    if (!selectedUser || !selectedChallengeId) {
      setStatementsRows([]);
      setStatementsErr(null);
      setStatementsLoading(false);
      setStatementSource(null);
      setStatementMetrics(null);
      setStatementRank(null);
      setStatementMinRankUsd(null);
      return;
    }

    const ac = new AbortController();

    setStatementsLoading(true);
    setStatementsErr(null);
    setStatementSource(null);
    setStatementMetrics(null);
    setStatementRank(null);
    setStatementMinRankUsd(null);

    void (async () => {
      try {
        const data = await getJson<ChallengeParticipantStatementsResponse>(
          `${base}/get_challenge_participant_statements.php?challenge_id=${selectedChallengeId}&username=${encodeURIComponent(selectedUser)}`,
          { signal: ac.signal }
        );
        if (!ac.signal.aborted) {
          setStatementsRows(Array.isArray(data.statements) ? data.statements : []);
          setStatementSource(data.source ?? null);
          setStatementMetrics(data.metrics ?? null);
          setStatementRank(data.rank ?? null);
          const mr = data.min_rank_balance_usd;
          setStatementMinRankUsd(
            typeof mr === 'number' && Number.isFinite(mr) ? mr : null,
          );
        }
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        const msg = e instanceof Error ? e.message : String(e);
        if (!ac.signal.aborted) {
          setStatementsErr(msg || 'Failed to load statements.');
          setStatementsRows([]);
          setStatementSource(null);
          setStatementMetrics(null);
          setStatementRank(null);
          setStatementMinRankUsd(null);
        }
      } finally {
        if (!ac.signal.aborted) {
          setStatementsLoading(false);
        }
      }
    })();

    return () => ac.abort();
  }, [selectedUser, selectedChallengeId, base]);

  const onJoin = async (e: React.FormEvent) => {
    e.preventDefault();

    setJoinMsg(null);
    setJoinErr(null);

    const username = joinName.trim();

    if (!selectedChallenge) {
      setJoinErr('Select a challenge first.');
      return;
    }

    if (!username) {
      setJoinErr('Enter your name to join the challenge.');
      return;
    }

    if (isJoinClosed(selectedChallenge)) {
      setJoinErr('Joining is closed for this challenge.');
      return;
    }

    try {
      setJoinLoading(true);

      if (selectedChallenge.challenge_type === 'free') {
        if (!onValidateJoiner) {
          setJoinErr('Join validation function is not connected yet.');
          return;
        }

        const auth = await onValidateJoiner(username);

        await postJson<JoinChallengeResponse>(`${base}/join_challenge.php`, {
          challenge_id: selectedChallenge.id,
          username,
          balance_checked: auth.balance,
          currency: auth.currency,
          is_virtual: auth.is_virtual,
          loginid: auth.loginid || '',
        });

        setJoinMsg(`${username} joined ${selectedChallenge.name} successfully.`);
        setJoinName('');
        resetJoinFlow();

        await fetchChallenges();
        await fetchParticipants(selectedChallenge.id);
        return;
      }

      const prepare = await postJson<PrepareJoinPaymentResponse>(
        `${base}/challenge/payments/prepare`,
        {
          challenge_id: selectedChallenge.id,
          username,
        }
      );

      setPendingJoinPaymentId(prepare.join_payment.id);
      setPendingJoinUsername(prepare.join_payment.username || username);
      setPendingJoinAmount(Number(prepare.join_payment.amount || 0));
      setPendingJoinCurrency(prepare.join_payment.currency || 'USD');
      setOtpSentTo(prepare.otp?.to || null);
      setOtpCode('');
      setOtpModalOpen(true);

      setJoinMsg(
        prepare.otp?.to
          ? `Verification code sent to ${prepare.otp.to}. Paste it in the popup to confirm payment.`
          : 'Verification code sent. Paste it in the popup to confirm payment.'
      );

      await fetchChallenges();
      await fetchParticipants(selectedChallenge.id);
    } catch (err: any) {
      setJoinErr(err?.message || 'Failed to join challenge.');
    } finally {
      setJoinLoading(false);
    }
  };

  const onConfirmPaidJoin = async () => {
    setJoinMsg(null);
    setJoinErr(null);

    if (!selectedChallenge) {
      setJoinErr('Select a challenge first.');
      return;
    }

    if (!pendingJoinPaymentId) {
      setJoinErr('No pending payment found.');
      return;
    }

    if (!otpCode.trim()) {
      setJoinErr('Enter the verification code sent to your email.');
      return;
    }

    try {
      setConfirmLoading(true);

      const confirmed = await postJson<ConfirmJoinPaymentResponse>(
        `${base}/challenge/payments/confirm`,
        {
          join_payment_id: pendingJoinPaymentId,
          verification_code: otpCode.trim(),
        }
      );

      const joinedName =
        confirmed.participant?.username ||
        pendingJoinUsername ||
        joinName.trim() ||
        'Trader';

      setJoinMsg(`${joinedName} joined ${selectedChallenge.name} successfully.`);
      setJoinName('');
      resetJoinFlow();

      await fetchChallenges();
      await fetchParticipants(selectedChallenge.id);
    } catch (err: any) {
      setJoinErr(err?.message || 'Failed to confirm payment.');
    } finally {
      setConfirmLoading(false);
    }
  };

  const cancelPendingPayment = () => {
    setOtpModalOpen(false);
    setPendingJoinPaymentId(null);
    setPendingJoinUsername('');
    setPendingJoinAmount(0);
    setPendingJoinCurrency('USD');
    setOtpCode('');
    setOtpSentTo(null);
    setJoinMsg(null);
    setJoinErr(null);
  };

  return (
    <div className="ongoing-challenges-page">
      <div className="ongoing-challenges-shell">
        <div className="ongoing-grid">
          <aside className="challenge-rail">
            <div className="rail-card">
              <div className="rail-card__head">
                <h2>Available Challenges</h2>
                <p>Choose a challenge to see its leaderboard and join rules.</p>
              </div>

              <div className="challenge-list">
                {challengesLoading && <div className="leaderboard-empty">Loading challenges…</div>}

                {challengesErr && <div className="alert alert--err">{challengesErr}</div>}

                {!challengesLoading && !challengesErr && challenges.length === 0 && (
                  <div className="leaderboard-empty">No live or upcoming challenges found.</div>
                )}

                {challenges.map(challenge => {
                  const selected = selectedChallengeId === challenge.id;

                  const totalNeeded =
                    Number(challenge.minimum_balance || 0) +
                    (challenge.challenge_type === 'paid'
                      ? Number(challenge.entry_fee || 0)
                      : 0);

                  return (
                    <button
                      key={challenge.id}
                      type="button"
                      className={`challenge-item ${selected ? 'is-selected' : ''}`}
                      onClick={() => {
                        setSelectedChallengeId(challenge.id);
                        setSelectedUser(null);
                        resetJoinFlow();
                      }}
                    >
                      <div className="challenge-item__top">
                        <div>
                          <div className="challenge-item__name">{challenge.name}</div>
                          <div className="challenge-item__creator">
                            by {challenge.created_by_username}
                          </div>
                        </div>

                        <span className={`status-chip ${challenge.status}`}>
                          {challenge.status.replace('_', ' ')}
                        </span>
                      </div>

                      <div className="challenge-item__meta">
                        <span>{challenge.challenge_type === 'paid' ? 'Paid' : 'Free'}</span>
                        <span>Pool: {formatUsd(Number(challenge.prize_pool || 0))}</span>
                      </div>

                      <div className="challenge-item__meta">
                        <span>Min Bal: {formatUsd(Number(challenge.minimum_balance || 0))}</span>
                        <span>Total Needed: {formatUsd(totalNeeded)}</span>
                      </div>

                      <div className="challenge-item__meta">
                        <span>Ends in: {formatRemaining(challenge.end_time)}</span>
                      </div>

                      <div className="challenge-item__meta">
                        <span>{getJoinCloseText(challenge)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rail-card">
              <div className="rail-card__head">
                <h2>Join Challenge</h2>
                <p>Use your Denara username (saved via the floating Denara ID button) to join.</p>
              </div>

              <form className="join-form" onSubmit={onJoin}>
                <label className="field">
                  <span>Selected Challenge</span>
                  <input type="text" value={selectedChallenge?.name || ''} readOnly />
                </label>

                <label className="field">
                  <span>Your Name</span>
                  <input
                    type="text"
                    placeholder="Enter your registered name"
                    value={joinName}
                    onChange={e => setJoinName(e.target.value)}
                    disabled={joinLoading || confirmLoading || !!pendingJoinPaymentId}
                  />
                </label>

                <div className="join-summary">
                  <div className="join-summary__row">
                    <span>Entry Fee</span>
                    <strong>{formatUsd(Number(selectedChallenge?.entry_fee ?? 0))}</strong>
                  </div>

                  <div className="join-summary__row">
                    <span>Minimum Balance</span>
                    <strong>{formatUsd(Number(selectedChallenge?.minimum_balance ?? 0))}</strong>
                  </div>

                  <div className="join-summary__row total">
                    <span>Total Needed</span>
                    <strong>{formatUsd(totalRequired)}</strong>
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn"
                  disabled={
                    joinLoading ||
                    confirmLoading ||
                    !!pendingJoinPaymentId ||
                    !selectedChallenge ||
                    isJoinClosed(selectedChallenge)
                  }
                >
                  {joinLoading
                    ? selectedChallenge?.challenge_type === 'paid'
                      ? 'Sending OTP…'
                      : 'Joining…'
                    : isJoinClosed(selectedChallenge)
                      ? 'Joining Closed'
                      : selectedChallenge?.challenge_type === 'paid'
                        ? 'Pay & Join Challenge'
                        : 'Join Challenge'}
                </button>

                {pendingJoinPaymentId && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setOtpModalOpen(true)}
                    disabled={confirmLoading}
                  >
                    Paste Verification Code
                  </button>
                )}

                {joinMsg && <div className="alert alert--ok">{joinMsg}</div>}
                {joinErr && <div className="alert alert--err">{joinErr}</div>}
              </form>
            </div>
          </aside>

          <main className="challenge-main">
            <div className="main-card">
              <div className="main-card__head">
                <div>
                  <h2>{selectedChallenge?.name || 'Challenge Details'}</h2>
                  <p>
                    Start: {formatDate(selectedChallenge?.start_time)} · End:{' '}
                    {formatDate(selectedChallenge?.end_time)}
                  </p>
                </div>

                <div className="head-badges">
                  <span className="soft-chip">
                    Countdown:{' '}
                    {selectedChallenge ? formatRemaining(selectedChallenge.end_time) : '—'}
                  </span>

                  <span className="soft-chip">
                    {selectedChallenge ? getJoinCloseText(selectedChallenge) : '—'}
                  </span>
                </div>
              </div>

              <div className="challenge-summary-grid">
                <div className="summary-box">
                  <span className="summary-box__label">Participants</span>
                  <strong className="summary-box__value">
                    {selectedChallenge?.participant_count ?? 0}
                  </strong>
                </div>

                <div className="summary-box">
                  <span className="summary-box__label">Prize Pool</span>
                  <strong className="summary-box__value">
                    {formatUsd(Number(selectedChallenge?.prize_pool ?? 0))}
                  </strong>
                </div>

                <div className="summary-box">
                  <span className="summary-box__label">Challenge Type</span>
                  <strong className="summary-box__value">
                    {selectedChallenge?.challenge_type ?? '—'}
                  </strong>
                </div>

                <div className="summary-box">
                  <span className="summary-box__label">Minimum Balance</span>
                  <strong className="summary-box__value">
                    {formatUsd(Number(selectedChallenge?.minimum_balance ?? 0))}
                  </strong>
                </div>

                {selectedChallenge?.challenge_type === 'paid' && (
                  <div className="summary-box">
                    <span className="summary-box__label">Prize payout</span>
                    <strong className="summary-box__value">
                      {formatPayoutStatusLabel(
                        selectedChallenge.payout_status_display,
                        selectedChallenge.payout_status
                      )}
                    </strong>
                  </div>
                )}
              </div>
            </div>

            <div className="main-card">
              <div className="main-card__head">
                <div>
                  <h2>Participants</h2>
                  <p>
                    Login with you denara ID to join this challenge
                  </p>
                </div>
              </div>

              <div className="leaderboard-table">
                <div className="leaderboard-table__head">
                  <div>#</div>
                  <div>Trader</div>
                  <div>Status</div>
                  <div>Joined At</div>
                  <div>Balance Checked</div>
                  <div>Total Required</div>
                </div>

                {participantsLoading && (
                  <div className="leaderboard-empty">Loading participants…</div>
                )}

                {participantsErr && <div className="alert alert--err">{participantsErr}</div>}

                {!participantsLoading && !participantsErr && leaderboardRows.length === 0 && (
                  <div className="leaderboard-empty">No participants yet for this challenge.</div>
                )}

                {leaderboardRows.map((row, index) => {
                  const selected = selectedUser === row.username;

                  return (
                    <button
                      type="button"
                      key={row.id}
                      className={`leaderboard-row ${selected ? 'is-selected' : ''}`}
                      onClick={() => setSelectedUser(row.username)}
                    >
                      <div>#{index + 1}</div>
                      <div>{row.username}</div>
                      <div>{row.join_status}</div>
                      <div>{formatDate(row.joined_at)}</div>
                      <div>{formatUsd(row.balance_checked)}</div>
                      <div>{formatUsd(Number(row.total_required || 0))}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="main-card main-card--statements">
              <div className="main-card__head main-card__head--statements">
                <div>
                  <h2>Statements</h2>
                  <p className="main-card__sub muted">
                    {selectedUser
                      ? 'Challenge window metrics (same rules as the tournament leaderboard).'
                      : 'Select a participant from the list above.'}
                  </p>
                </div>
              </div>

              {selectedUser && !statementsLoading && statementMetrics && statementRank && (
                <div className="ongoing-stm-summary">
                  <div className="ongoing-stm-summary__left">
                    <div className="ongoing-stm-summary__user">
                      <div className="ongoing-m-label">Trader</div>
                      <div className="ongoing-m-value ongoing-m-value--user">{selectedUser}</div>
                    </div>
                    <div className="ongoing-stm-summary__acct">
                      <div className="ongoing-m-label">Source</div>
                      <div className="ongoing-stm-summary__chips">
                        {statementSource === 'virtual' && (
                          <span className="ongoing-chip ongoing-chip--virtual">Virtual ledger</span>
                        )}
                        {statementSource === 'deriv' && (
                          <span className="ongoing-chip ongoing-chip--deriv">Deriv · challenge window</span>
                        )}
                        {!statementSource && <span className="ongoing-chip">—</span>}
                        <span
                          className={`ongoing-chip ongoing-chip--elig ${
                            statementRank.is_rank_eligible ? 'is-yes' : 'is-no'
                          }`}
                        >
                          {statementRank.is_rank_eligible ? 'Rank eligible' : 'Not rank eligible'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="ongoing-stm-summary__metrics">
                    <div className="ongoing-metric">
                      <div className="ongoing-m-label">Rank min. balance</div>
                      <div className="ongoing-m-value">
                        {formatUsd(rankMinBalanceDisplayUsd ?? undefined)}
                      </div>
                    </div>
                    <div className="ongoing-metric">
                      <div className="ongoing-m-label">Starting capital</div>
                      <div className="ongoing-m-value">
                        {formatAmtWithCurrency(
                          statementMetrics.baselineBal,
                          statementMetrics.currency || 'USD',
                        )}
                      </div>
                    </div>
                    <div className="ongoing-metric">
                      <div className="ongoing-m-label">End balance</div>
                      <div className="ongoing-m-value">
                        {formatAmtWithCurrency(statementMetrics.endBal, statementMetrics.currency || 'USD')}
                      </div>
                    </div>
                    <div className="ongoing-metric">
                      <div className="ongoing-m-label">Net P/L</div>
                      <div
                        className={`ongoing-m-value ${
                          (statementMetrics.netPL ?? 0) >= 0 ? 'ongoing-m-value--pos' : 'ongoing-m-value--neg'
                        }`}
                      >
                        {formatAmtWithCurrency(statementMetrics.netPL, statementMetrics.currency || 'USD')}
                      </div>
                    </div>
                    <div className="ongoing-metric">
                      <div className="ongoing-m-label">Return %</div>
                      <div
                        className={`ongoing-m-value ${
                          statementRank.return_pct !== null &&
                          statementRank.return_pct !== undefined &&
                          statementRank.return_pct >= 0
                            ? 'ongoing-m-value--pos'
                            : statementRank.return_pct !== null && statementRank.return_pct !== undefined
                              ? 'ongoing-m-value--neg'
                              : ''
                        }`}
                      >
                        {formatPctRank(statementRank.return_pct)}
                      </div>
                    </div>
                    <div className="ongoing-metric">
                      <div className="ongoing-m-label">Turnover</div>
                      <div className="ongoing-m-value">
                        {formatAmtWithCurrency(statementMetrics.turnover, statementMetrics.currency || 'USD')}
                      </div>
                    </div>
                    <div className="ongoing-metric">
                      <div className="ongoing-m-label">Closed sells</div>
                      <div className="ongoing-m-value">{statementMetrics.trades}</div>
                    </div>
                  </div>

                  {!statementRank.is_rank_eligible && (
                    <div
                      className="ongoing-baseline-note ongoing-baseline-note--in-summary"
                      role="status"
                      aria-live="polite"
                    >
                      {rankIneligibilityExplanation(statementRank.reason, rankMinBalanceDisplayUsd)}
                    </div>
                  )}
                </div>
              )}

              {!selectedUser && <div className="statements-empty">No trader selected yet.</div>}

              {selectedUser && (
                <div className="statements-table">
                  <div className="statements-table__head">
                    <div>Time</div>
                    <div>Action</div>
                    <div>Reference ID</div>
                    <div>Type</div>
                    <div>Amount</div>
                    <div>Balance</div>
                  </div>

                  {statementsLoading && (
                    <div className="statements-empty">Loading statements…</div>
                  )}

                  {!statementsLoading && statementsErr && (
                    <div className="alert alert--err">{statementsErr}</div>
                  )}

                  {!statementsLoading && !statementsErr && statementsRows.length === 0 && (
                    <div className="statements-empty">
                      {statementSource === 'virtual'
                        ? 'No virtual ledger rows in this challenge window (see chance_virtual_statements).'
                        : 'No Deriv statement rows in this challenge window for this account.'}
                    </div>
                  )}

                  {!statementsLoading &&
                    !statementsErr &&
                    statementsRows.map(tx => (
                    <div key={tx.id} className="statements-row">
                      <div>{formatDate(tx.time)}</div>
                      <div className={tx.action_type}>{tx.action_type}</div>
                      <div>{tx.action_type === 'buy' ? '-' : tx.reference_id || '-'}</div>
                      <div>{tx.contract_type || '-'}</div>
                      <div className={tx.amount >= 0 ? 'pos' : 'neg'}>
                        {tx.amount >= 0 ? '+' : ''}
                        {formatUsd(tx.amount)}
                      </div>
                      <div>{formatUsd(tx.balance_after)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>

      {otpModalOpen && pendingJoinPaymentId && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal otp-modal">
            <div className="modal__head">
              <h3>Confirm Challenge Payment</h3>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setOtpModalOpen(false)}
                disabled={confirmLoading}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="modal__body">
              <div className="pay-summary">
                <div className="row">
                  <span>Challenge</span>
                  <strong>{selectedChallenge?.name || '—'}</strong>
                </div>

                <div className="row">
                  <span>Trader</span>
                  <strong>{pendingJoinUsername || joinName || '—'}</strong>
                </div>

                <div className="row">
                  <span>Amount</span>
                  <strong>
                    {formatUsd(pendingJoinAmount)} {pendingJoinCurrency !== 'USD' ? pendingJoinCurrency : ''}
                  </strong>
                </div>

                <div className="row">
                  <span>Verification Email</span>
                  <strong>{otpSentTo ? maskEmail(otpSentTo) : 'your Deriv email'}</strong>
                </div>
              </div>

              <label className="field otp-field">
                <span>Paste Verification Code</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Enter verification code"
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value)}
                  disabled={confirmLoading}
                  autoFocus
                />
              </label>

              <div className="alert alert--warn">
                A verification code was sent to your Deriv email. Paste it here to complete the
                payment and join the challenge.
              </div>

              {joinErr && <div className="alert alert--err">{joinErr}</div>}
            </div>

            <div className="modal__foot modal__foot--spread">
              <div className="muted small">Payment #{pendingJoinPaymentId}</div>

              <div className="setup-form__actions">
                <button
                  type="button"
                  className="btn"
                  disabled={confirmLoading || !otpCode.trim()}
                  onClick={() => {
                    void onConfirmPaidJoin();
                  }}
                >
                  {confirmLoading ? 'Confirming…' : 'Confirm Payment & Join'}
                </button>

                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={confirmLoading}
                  onClick={cancelPendingPayment}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OngoingChallenges;