import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCompetitionPhpApiBaseUrl } from '@/components/shared/utils/competition/denara-competition-profile';
import './ParticipantsLeaderboard.scss';
import './OracleLiveTrades.scss';

/** Same synthetic user as `ParticipantsLeaderboard` → `get_chance_statements.php`. */
const OPTIONS_ORACLE_USERNAME = 'options_oracle';

/** Only statements on 11 May 2026 (UTC calendar day). */
const CHANCE_DAY_START_MS = Date.UTC(2026, 4, 11, 0, 0, 0, 0);
const CHANCE_DAY_END_MS = Date.UTC(2026, 4, 11, 23, 59, 59, 999);

type StatementTx = {
  id?: number | string;
  transaction_id?: number | string;
  action_type?: string;
  amount?: number;
  balance?: number;
  balance_after?: number;
  transaction_time?: number;
  time?: number;
  contract_id?: string | number;
  reference_id?: string | number;
  reference_type?: string;
  transaction_type?: string;
  category?: string;
  type?: string;
  contract_type?: string;
};

type ChanceStatementsResponse = {
  ok: boolean;
  statements?: StatementTx[];
  error?: string;
};

const normalize = (s?: string) => (s ? String(s).replace(/_/g, ' ').toLowerCase() : '');
const epochMs = (t?: number) => (typeof t === 'number' ? t * 1000 : 0);
const ms = (tx: StatementTx) => epochMs(tx.transaction_time ?? tx.time ?? 0);
const txId = (tx: StatementTx) => String(tx.id ?? tx.transaction_id ?? tx.contract_id ?? '');

async function fetchChanceStatements(apiBaseUrl: string, limit = 10000): Promise<ChanceStatementsResponse> {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const url = new URL(`${base}/get_chance_statements.php`);
  url.searchParams.set('username', OPTIONS_ORACLE_USERNAME);
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url.toString(), { method: 'GET' });
  const txt = await res.text();
  let data: ChanceStatementsResponse;
  try {
    data = JSON.parse(txt);
  } catch {
    throw new Error(`Chance statements: bad JSON (${txt.slice(0, 120) || 'empty'})`);
  }
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'Failed to load chance statements');
  }
  return data;
}

function deriveRefType(tx: Partial<StatementTx>): string {
  return (
    normalize(tx.reference_type) ||
    normalize(tx.transaction_type) ||
    normalize(tx.category) ||
    normalize(tx.action_type) ||
    normalize(tx.type) ||
    normalize(tx.contract_type) ||
    ''
  );
}

const currency = 'USD';

export default function OracleLiveTrades() {
  const apiBaseUrl = useMemo(() => getCompetitionPhpApiBaseUrl(), []);
  const [rows, setRows] = useState<StatementTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchChanceStatements(apiBaseUrl);
      const all = data.statements ?? [];
      const filtered = all
        .filter(tx => {
          const tms = ms(tx);
          return tms >= CHANCE_DAY_START_MS && tms <= CHANCE_DAY_END_MS;
        })
        .sort((a, b) => ms(b) - ms(a));
      setRows(filtered);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load';
      setErr(msg);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="participants oracle-live-trades">
      <section className="oracle-live-trades__hero">
        <div className="oracle-live-trades__hero-inner">
          <span className="oracle-live-trades__eyebrow">Chance feed</span>
          <h1 className="oracle-live-trades__title">Oracle Live Trades</h1>
          <div className="oracle-live-trades__actions">
            <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
      </section>

      <main className="stm-only">
        {err && <div className="pin-error">{err}</div>}

        <div className="statements stm-collapsible is-expanded">
          <div className="statements__head" aria-hidden={false}>
            <div className="col col--time">Time</div>
            <div className="col col--action">Action</div>
            <div className="col col--refid">Reference ID</div>
            <div className="col col--reftype">Type</div>
            <div className="col col--amt">Amount</div>
            <div className="col col--bal">Balance</div>
          </div>

          <div className="stm-collapsible__inner statements__scroller">
            {loading && <div className="statements__status loading">Loading chance statements…</div>}
            {!loading && rows.length > 0 && (
              <ul className="statements__list">
                {rows.map(t => {
                  const timeVal = ms(t);
                  const action = normalize(t.action_type);
                  const amt = typeof t.amount === 'number' ? t.amount : undefined;
                  const balance =
                    typeof t.balance_after === 'number'
                      ? t.balance_after
                      : typeof t.balance === 'number'
                        ? t.balance
                        : undefined;
                  const positive = (amt ?? 0) >= 0;

                  return (
                    <li className="statements__row" key={`${txId(t)}::${timeVal}`}>
                      <div className="col col--time" data-label="Time">
                        {timeVal ? new Date(timeVal).toLocaleString() : '—'}
                      </div>
                      <div className={`col col--action ${action}`} data-label="Action">
                        {action || '-'}
                      </div>
                      <div className="col col--refid" data-label="Reference ID">
                        {action === 'buy' ? '-' : t.reference_id ?? '-'}
                      </div>
                      <div className="col col--reftype" data-label="Type">
                        {deriveRefType(t) || '-'}
                      </div>
                      <div className={`col col--amt ${positive ? 'pos' : 'neg'}`} data-label="Amount">
                        {typeof amt === 'number' ? `${amt >= 0 ? '+' : ''}${amt.toFixed(2)} ${currency}` : '—'}
                      </div>
                      <div className="col col--bal" data-label="Balance">
                        {typeof balance === 'number' ? `${balance.toFixed(2)} ${currency}` : '—'}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
