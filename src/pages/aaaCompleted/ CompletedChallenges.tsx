import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    getCompetitionPhpApiBaseUrl,
    getDenaraCompetitionUsername,
} from '@/components/shared/utils/competition/denara-competition-profile';
import './CompletedChallenges.scss';

/** Must match API `RELEASE_CHALLENGE_PAYOUT_SKIP_PASSWORD` (false in production). */
const SKIP_RELEASE_PASSWORD_FOR_TESTING = false;

type ApiChallengeRow = {
  id: number;
  name: string;
  created_by_username: string;
  challenge_type: 'free' | 'paid';
  participant_count: number;
  prize_pool: number;
  winner_trader_id?: number | null;
  winner_username?: string | null;
  winner_return_pct?: number | null;
  payout_status: string;
  payout_status_display?: string;
  payout_deriv_txid?: string | null;
  payout_paid_at?: string | null;
  payout_last_error?: string | null;
  status: string;
  start_time: string;
  end_time: string;
};

/** Shape of `challenge.ranking` from get_challenge.php (decoded ranking_json). */
type RankingParticipantRow = {
  trader_id: number;
  username: string;
  join_order?: number;
  status?: string;
  return_pct?: number | null;
  metrics?: { netPL?: number } | null;
  reason?: string | null;
  error?: string | null;
  is_rank_eligible?: boolean;
};

type RankingPayload = {
  challenge_id?: number;
  solo?: boolean;
  participants: RankingParticipantRow[];
};

type ChallengeDetailForStandings = {
  ranking: RankingPayload | null;
  ranking_status?: string | null;
  ranking_last_error?: string | null;
};

type CompletedChallenge = {
  id: number;
  name: string;
  created_by: string;
  /** Same as API `created_by_username`; used to match signed-in Denara profile for founder-only actions. */
  created_by_username: string;
  challenge_type: 'free' | 'paid';
  participant_count: number;
  prize_pool: number;
  winner_payout: number;
  winner_username: string;
  winner_return_pct: number | null;
  start_time: string;
  end_time: string;
  payout_status: string;
  payout_deriv_txid: string | null;
  payout_paid_at: string | null;
  payout_last_error: string | null;
  payout_status_label: string;
};

type Props = {
  apiBaseUrl?: string;
};

const payoutStatusLabel = (display?: string, raw?: string) => {
  const key = (display || raw || '').toLowerCase().trim();
  const map: Record<string, string> = {
    scheduled: 'After challenge ends',
    pending: 'Queued',
    processing: 'Processing',
    paid: 'Paid',
    failed: 'Failed',
    not_applicable: 'Not applicable',
  };
  return map[key] ?? (key || '—');
};

const mapRow = (row: ApiChallengeRow): CompletedChallenge => {
  const pool = Number(row.prize_pool ?? 0);
  const paidType = row.challenge_type === 'paid';

  const creatorName = (row.created_by_username || '').trim();

  return {
    id: row.id,
    name: row.name,
    created_by: creatorName || '—',
    created_by_username: creatorName,
    challenge_type: row.challenge_type,
    participant_count: Number(row.participant_count ?? 0),
    prize_pool: pool,
    winner_payout: paidType ? pool : 0,
    winner_username: (row.winner_username || '').trim() || '—',
    winner_return_pct: typeof row.winner_return_pct === 'number' ? row.winner_return_pct : null,
    start_time: row.start_time,
    end_time: row.end_time,
    payout_status: row.payout_status || 'pending',
    payout_deriv_txid: row.payout_deriv_txid ?? null,
    payout_paid_at: row.payout_paid_at ?? null,
    payout_last_error: row.payout_last_error ?? null,
    payout_status_label: payoutStatusLabel(row.payout_status_display, row.payout_status),
  };
};

const formatUsd = (n?: number | null) => {
  if (typeof n !== 'number') return '—';
  return `${n.toFixed(2)} USD`;
};

const formatPct = (n?: number | null) => {
  if (typeof n !== 'number') return '—';
  return `${n.toFixed(2)}%`;
};

const formatDate = (value?: string) => {
  if (!value) return '—';
  return new Date(value).toLocaleString();
};

/** Readable error for failed release; includes HTTP status and API `error` or raw body snippet (e.g. PHP/HTML). */
function formatReleaseFundsApiError(res: Response, rawBody: string, parsed: unknown): string {
  const status = res.status;
  if (parsed && typeof parsed === 'object') {
    const o = parsed as { error?: unknown; message?: unknown };
    if (typeof o.error === 'string' && o.error.trim()) {
      return `${o.error.trim()} (HTTP ${status})`;
    }
    if (typeof o.message === 'string' && o.message.trim()) {
      return `${o.message.trim()} (HTTP ${status})`;
    }
  }
  const snippet = rawBody.trim().slice(0, 520);
  if (!snippet) {
    return `Request failed (HTTP ${status})`;
  }
  return `HTTP ${status}: ${snippet}`;
}

const sortByEndDesc = (a: CompletedChallenge, b: CompletedChallenge) =>
  new Date(b.end_time).getTime() - new Date(a.end_time).getTime();

/** Standings: best return first; nulls last. */
const sortStandingsRows = (rows: RankingParticipantRow[]): RankingParticipantRow[] =>
  [...rows].sort((a, b) => {
    const ap = a.return_pct;
    const bp = b.return_pct;
    if (ap == null && bp == null) return (a.username || '').localeCompare(b.username || '');
    if (ap == null) return 1;
    if (bp == null) return -1;
    return bp - ap;
  });

const standingsStatusMessage = (detail: ChallengeDetailForStandings | null): string | null => {
  if (!detail) return null;
  const st = (detail.ranking_status || '').toLowerCase().trim();
  if (st === 'pending' || st === 'processing') {
    return 'Ranking is still processing. Refresh in a moment.';
  }
  if (st === 'failed') {
    return detail.ranking_last_error?.trim() || 'Ranking failed.';
  }
  if (st === 'skipped') {
    return detail.ranking_last_error?.trim() || 'Ranking was skipped for this challenge.';
  }
  return null;
};

const CompletedChallenges = ({ apiBaseUrl }: Props) => {
  const base = (apiBaseUrl ?? getCompetitionPhpApiBaseUrl()).replace(/\/+$/, '');

  const [challenges, setChallenges] = useState<CompletedChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChallengeId, setSelectedChallengeId] = useState<number>(0);
  const [standingsDetail, setStandingsDetail] = useState<ChallengeDetailForStandings | null>(null);
  const [standingsLoading, setStandingsLoading] = useState(false);
  const [standingsError, setStandingsError] = useState<string | null>(null);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releasePassword, setReleasePassword] = useState('');
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseErr, setReleaseErr] = useState<string | null>(null);
  /** Last successful release response (winner name for confirmation message). */
  const [releaseResult, setReleaseResult] = useState<{
    already_paid?: boolean;
    winner_username?: string | null;
    payout_completed_in_db?: boolean;
    test_skip_status?: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const url = `${base}/list_challenges.php?status=ended&limit=100`;
      const res = await fetch(url, { method: 'GET' });
      const txt = await res.text();
      let data: { ok?: boolean; results?: ApiChallengeRow[]; error?: string };
      try {
        data = JSON.parse(txt) as typeof data;
      } catch {
        throw new Error(`Invalid response (${res.status})`);
      }
      if (!res.ok || !data?.ok || !Array.isArray(data.results)) {
        throw new Error(data?.error || `Could not load challenges (${res.status})`);
      }

      const mapped = data.results.map(mapRow).sort(sortByEndDesc);
      setChallenges(mapped);
      setSelectedChallengeId(prev => {
        if (mapped.length === 0) return 0;
        if (prev && mapped.some(c => c.id === prev)) return prev;
        return mapped[0].id;
      });
    } catch (e: unknown) {
      setChallenges([]);
      setError(e instanceof Error ? e.message : 'Failed to load completed challenges.');
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedChallengeId) {
      setStandingsDetail(null);
      setStandingsError(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setStandingsLoading(true);
      setStandingsError(null);
      try {
        const res = await fetch(`${base}/get_challenge.php?id=${selectedChallengeId}`);
        const txt = await res.text();
        let data: { ok?: boolean; challenge?: ChallengeDetailForStandings; error?: string };
        try {
          data = JSON.parse(txt) as typeof data;
        } catch {
          throw new Error(`Invalid response (${res.status})`);
        }
        if (!res.ok || !data?.ok || !data.challenge) {
          throw new Error(data?.error || `Could not load challenge (${res.status})`);
        }
        if (!cancelled) {
          setStandingsDetail({
            ranking: data.challenge.ranking ?? null,
            ranking_status: data.challenge.ranking_status ?? null,
            ranking_last_error: data.challenge.ranking_last_error ?? null,
          });
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setStandingsDetail(null);
          setStandingsError(e instanceof Error ? e.message : 'Could not load standings.');
        }
      } finally {
        if (!cancelled) setStandingsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [base, selectedChallengeId]);

  const selectedChallenge = useMemo(
    () => challenges.find(ch => ch.id === selectedChallengeId) ?? null,
    [challenges, selectedChallengeId]
  );

  const sessionUsername = getDenaraCompetitionUsername();
  const canReleaseFunds = useMemo(() => {
    const ch = selectedChallenge;
    if (!ch || ch.challenge_type !== 'paid') return false;
    const ps = (ch.payout_status || '').toLowerCase().trim();
    if (ps === 'paid') return false;
    const u = sessionUsername?.trim().toLowerCase() ?? '';
    const founder = ch.created_by_username.trim().toLowerCase();
    return u !== '' && founder !== '' && u === founder;
  }, [selectedChallenge, sessionUsername]);

  const submitReleaseFunds = useCallback(async () => {
    if (!selectedChallenge || !sessionUsername?.trim()) return;
    setReleaseBusy(true);
    setReleaseErr(null);
    try {
      const res = await fetch(`${base}/release_challenge_payout.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: selectedChallenge.id,
          username: sessionUsername.trim(),
          password: releasePassword,
        }),
      });
      const txt = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(txt) as unknown;
      } catch {
        parsed = null;
      }

      if (process.env.NODE_ENV === 'development') {
        console.error('[release_challenge_payout]', {
          httpStatus: res.status,
          ok: res.ok,
          bodyPreview: txt.slice(0, 2500),
          parsed,
        });
      }

      const data =
        parsed && typeof parsed === 'object'
          ? (parsed as {
              ok?: boolean;
              already_paid?: boolean;
              transfer_target?: {
                winner_username?: string | null;
              };
              payout_completed_in_db?: boolean;
              test_skip_status?: boolean;
            })
          : null;
      if (!res.ok || !data || data.ok !== true) {
        throw new Error(formatReleaseFundsApiError(res, txt, parsed));
      }
      const tt = data.transfer_target as { winner_username?: string | null } | undefined;
      const winnerFromApi =
        typeof tt?.winner_username === 'string' && tt.winner_username.trim() !== ''
          ? tt.winner_username
          : null;
      setReleaseResult({
        already_paid: data.already_paid,
        winner_username: winnerFromApi,
        payout_completed_in_db: data.payout_completed_in_db,
        test_skip_status: data.test_skip_status,
      });
      setReleasePassword('');
      await load();
    } catch (e: unknown) {
      setReleaseErr(e instanceof Error ? e.message : 'Release failed.');
    } finally {
      setReleaseBusy(false);
    }
  }, [base, selectedChallenge, sessionUsername, releasePassword, load]);

  const latestWinnerLabel = useMemo(() => {
    const first = challenges[0];
    if (!first) return '—';
    return first.winner_username !== '—' ? first.winner_username : '—';
  }, [challenges]);

  return (
    <div className="completed-challenges-page">
      <div className="completed-challenges-shell">
        <section className="completed-hero">
          <div className="completed-hero__copy">
            <span className="completed-hero__eyebrow">Challenge History</span>
            <h1>Recent completed challenges</h1>
            <p>
              Finished challenges from the server: prize pool, payout status, and winner. Select a challenge to
              load statement-based final standings from the API.
            </p>
          </div>

          <div className="completed-hero__stats">
            <div className="hero-stat">
              <span className="hero-stat__label">Completed challenges</span>
              <strong className="hero-stat__value">{loading ? '…' : challenges.length}</strong>
            </div>
            <div className="hero-stat">
              <span className="hero-stat__label">Latest (by end)</span>
              <strong className="hero-stat__value">{latestWinnerLabel}</strong>
            </div>
          </div>
        </section>

        {error ? (
          <div className="completed-challenges-error" role="alert">
            {error}
            <button type="button" className="completed-challenges-retry" onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : null}

        <div className="completed-grid">
          <aside className="history-rail">
            <div className="history-card">
              <div className="history-card__head">
                <h2>Challenge Archive</h2>
                <p>Select a finished challenge to see results.</p>
              </div>

              <div className="history-list">
                {loading && (
                  <div className="standings-empty" style={{ padding: '1rem' }}>
                    Loading…
                  </div>
                )}
                {!loading && challenges.length === 0 && (
                  <div className="standings-empty" style={{ padding: '1rem' }}>
                    No completed challenges yet.
                  </div>
                )}
                {!loading &&
                  challenges.map(challenge => {
                    const selected = selectedChallengeId === challenge.id;

                    return (
                      <button
                        key={challenge.id}
                        type="button"
                        className={`history-item ${selected ? 'is-selected' : ''}`}
                        onClick={() => setSelectedChallengeId(challenge.id)}
                      >
                        <div className="history-item__top">
                          <div>
                            <div className="history-item__name">{challenge.name}</div>
                            <div className="history-item__creator">by {challenge.created_by}</div>
                          </div>
                          <span className={`status-chip ${challenge.payout_status}`}>
                            {challenge.payout_status_label}
                          </span>
                        </div>

                        <div className="history-item__meta">
                          <span>{challenge.challenge_type}</span>
                          <span>Winner: {challenge.winner_username}</span>
                        </div>

                        <div className="history-item__meta">
                          <span>Pool: {formatUsd(challenge.prize_pool)}</span>
                          <span>Payout: {formatUsd(challenge.winner_payout)}</span>
                        </div>

                        <div className="history-item__meta">
                          <span>Ended: {formatDate(challenge.end_time)}</span>
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>
          </aside>

          <main className="history-main">
            <div className="history-card">
              <div className="history-card__head">
                <div>
                  <h2>{selectedChallenge?.name || 'Completed Challenge'}</h2>
                  <p>
                    Started: {formatDate(selectedChallenge?.start_time)} · Ended:{' '}
                    {formatDate(selectedChallenge?.end_time)}
                  </p>
                </div>

                <div className="history-badges">
                  <span className="soft-chip">Winner: {selectedChallenge?.winner_username || '—'}</span>
                  <span className="soft-chip">Return: {formatPct(selectedChallenge?.winner_return_pct ?? null)}</span>
                </div>
              </div>

              <div className="result-grid">
                <div className="result-box">
                  <span className="result-box__label">Winner</span>
                  <strong className="result-box__value">{selectedChallenge?.winner_username || '—'}</strong>
                </div>
                <div className="result-box">
                  <span className="result-box__label">Winner Return %</span>
                  <strong className="result-box__value">{formatPct(selectedChallenge?.winner_return_pct ?? null)}</strong>
                </div>
                <div className="result-box">
                  <span className="result-box__label">Prize Pool</span>
                  <strong className="result-box__value">{formatUsd(selectedChallenge?.prize_pool)}</strong>
                </div>
                <div className="result-box">
                  <span className="result-box__label">Payout Status</span>
                  <strong className="result-box__value">
                    {selectedChallenge?.payout_status_label || '—'}
                  </strong>
                </div>
              </div>

              {selectedChallenge?.payout_deriv_txid ? (
                <div className="completed-payout-meta">
                  <span className="completed-payout-meta__label">Deriv payout ref</span>
                  <code className="completed-payout-meta__code">{selectedChallenge.payout_deriv_txid}</code>
                  {selectedChallenge.payout_paid_at ? (
                    <span className="completed-payout-meta__when">Paid {formatDate(selectedChallenge.payout_paid_at)}</span>
                  ) : null}
                </div>
              ) : null}

              {selectedChallenge?.payout_last_error ? (
                <div className="completed-payout-err" role="status">
                  {selectedChallenge.payout_last_error}
                </div>
              ) : null}

              {canReleaseFunds ? (
                <div className="release-funds">
                  <button
                    type="button"
                    className="release-funds__btn"
                    disabled={releaseBusy}
                    onClick={() => {
                      setReleaseErr(null);
                      setReleasePassword('');
                      setReleaseResult(null);
                      setReleaseOpen(true);
                    }}
                  >
                    Release funds to winner
                  </button>
                  <p className="release-funds__hint">
                    Confirms with your Denara password (same as competition login). Only the challenge founder sees this
                    button.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="history-card">
              <div className="history-card__head">
                <div>
                  <h2>Final Top Standings</h2>
                  <p>
                    Ranks and net P/L from Deriv account statements for the challenge window (same data as
                    server-side ranking).
                  </p>
                </div>
              </div>

              <div className="standings-table">
                <div className="standings-table__head">
                  <div>Rank</div>
                  <div>Trader</div>
                  <div>Return %</div>
                  <div>Net P/L</div>
                </div>

                {standingsLoading ? (
                  <div className="standings-empty">Loading standings…</div>
                ) : standingsError ? (
                  <div className="standings-empty" role="alert">
                    {standingsError}
                  </div>
                ) : (() => {
                    const statusMsg = standingsStatusMessage(standingsDetail);
                    const raw = standingsDetail?.ranking?.participants;
                    const rows = sortStandingsRows(Array.isArray(raw) ? raw : []);
                    if (statusMsg) {
                      return <div className="standings-empty">{statusMsg}</div>;
                    }
                    if (rows.length === 0) {
                      return (
                        <div className="standings-empty">
                          No standings rows returned yet. If the challenge just ended, open the app again after the
                          server finishes ranking.
                        </div>
                      );
                    }
                    return rows.map((p, i) => (
                      <div className="standings-row" key={`${p.trader_id}-${p.join_order ?? i}`}>
                        <div>{i + 1}</div>
                        <div>{p.username || '—'}</div>
                        <div>{formatPct(p.return_pct ?? null)}</div>
                        <div>
                          {typeof p.metrics?.netPL === 'number' ? formatUsd(p.metrics.netPL) : '—'}
                        </div>
                      </div>
                    ));
                  })()}
              </div>
            </div>
          </main>
        </div>
      </div>

      {releaseOpen ? (
        <div
          className="release-modal-overlay"
          role="presentation"
          onClick={() => {
            if (!releaseBusy) {
              setReleaseOpen(false);
              setReleaseResult(null);
            }
          }}
        >
          <div
            className="release-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-funds-title"
            onClick={e => {
              e.stopPropagation();
            }}
          >
            <h3 id="release-funds-title">Confirm prize payout</h3>
            <p className="release-modal__text">
              The prize pool will be sent to the ranked winner&apos;s Deriv account via the payment agent (receiver
              login ID is resolved from that trader&apos;s linked Deriv token and shown below after you submit).
              {SKIP_RELEASE_PASSWORD_FOR_TESTING
                ? ' (Password check is disabled for testing.)'
                : ' Use the password for your competition / Denara login.'}
            </p>
            {releaseResult ? (
              <div className="release-modal__success" role="status">
                {releaseResult.already_paid ? (
                  <p className="release-modal__success-msg">This challenge&apos;s prize has already been paid out.</p>
                ) : (
                  <p className="release-modal__success-msg">
                    Funds were successfully transferred to{' '}
                    <strong className="release-modal__success-name">
                      {(() => {
                        const n = (
                          releaseResult.winner_username ||
                          selectedChallenge?.winner_username ||
                          ''
                        ).trim();
                        return n && n !== '—' ? n : 'the winner';
                      })()}
                    </strong>
                    .
                  </p>
                )}
              </div>
            ) : null}
            {selectedChallenge ? (
              <div className="release-modal__who">
                <div className="release-modal__who-row">
                  <span className="release-modal__who-label">Founder account (server checks this)</span>
                  <code className="release-modal__who-value">{selectedChallenge.created_by_username || '—'}</code>
                </div>
                <div className="release-modal__who-row">
                  <span className="release-modal__who-label">Your saved Denara username (sent to server)</span>
                  <code className="release-modal__who-value">{sessionUsername?.trim() || '—'}</code>
                </div>
                {sessionUsername?.trim() &&
                selectedChallenge.created_by_username &&
                sessionUsername.trim().toLowerCase() ===
                  selectedChallenge.created_by_username.trim().toLowerCase() ? (
                  <p className="release-modal__who-ok">
                    {SKIP_RELEASE_PASSWORD_FOR_TESTING
                      ? 'Usernames match — you can release without a password (testing).'
                      : 'Usernames match — enter the password for that account below.'}
                  </p>
                ) : (
                  <p className="release-modal__who-warn" role="status">
                    These must be the same. Update your competition profile (Denara username) to the founder name, or
                    the API will reject the request.
                  </p>
                )}
              </div>
            ) : null}
            {!SKIP_RELEASE_PASSWORD_FOR_TESTING ? (
              <>
                <label className="release-modal__label" htmlFor="release-funds-password">
                  Password (for the founder account above)
                </label>
                <input
                  id="release-funds-password"
                  className="release-modal__input"
                  type="password"
                  autoComplete="current-password"
                  value={releasePassword}
                  onChange={e => setReleasePassword(e.target.value)}
                  disabled={releaseBusy}
                />
              </>
            ) : null}
            {releaseErr ? (
              <div className="release-modal__err" role="alert">
                {releaseErr}
              </div>
            ) : null}
            <div className="release-modal__actions">
              <button
                type="button"
                className="release-modal__cancel"
                disabled={releaseBusy}
                onClick={() => {
                  setReleaseOpen(false);
                  setReleaseResult(null);
                }}
              >
                {releaseResult ? 'Close' : 'Cancel'}
              </button>
              {!releaseResult ? (
                <button
                  type="button"
                  className="release-modal__confirm"
                  disabled={releaseBusy || (!SKIP_RELEASE_PASSWORD_FOR_TESTING && !releasePassword.trim())}
                  onClick={() => void submitReleaseFunds()}
                >
                  {releaseBusy ? 'Sending…' : 'Release funds'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default CompletedChallenges;
