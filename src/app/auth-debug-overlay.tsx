import React from 'react';

const DEBUG_LS = 'denara_auth_debug_on';

/** Enable before OAuth round-trip: survives redirect better than sessionStorage on some mobile browsers. */
export function persistAuthDebugFlagFromUrl(): void {
    try {
        const q = new URLSearchParams(window.location.search).get('auth_debug');
        if (q === '1' || q === 'true') {
            localStorage.setItem(DEBUG_LS, '1');
        }
    } catch {
        /* noop */
    }
}

export function isAuthDebugEnabled(): boolean {
    try {
        return localStorage.getItem(DEBUG_LS) === '1';
    } catch {
        return false;
    }
}

function clearAuthDebugFlag(): void {
    try {
        localStorage.removeItem(DEBUG_LS);
    } catch {
        /* noop */
    }
}

function safeLen(v: string | null): string {
    if (v == null || v === '') return '—';
    return String(v.length);
}

function boolKey(storage: Storage, key: string): string {
    try {
        const v = storage.getItem(key);
        return v ? `yes (${safeLen(v)} chars)` : 'no';
    } catch {
        return '?';
    }
}

function summarizeAccountsList(): string {
    try {
        const raw = localStorage.getItem('accountsList');
        if (!raw) return '—';
        const o = JSON.parse(raw) as Record<string, unknown>;
        const n = Object.keys(o).length;
        return `${n} loginid(s)`;
    } catch {
        return 'parse error';
    }
}

type TExchangeSnap = {
    at: number;
    ok: boolean;
    httpStatus?: number;
    note?: string;
};

function readExchangeSnap(): string {
    try {
        const raw = sessionStorage.getItem('denara_oauth_debug_exchange');
        if (!raw) return '—';
        const j = JSON.parse(raw) as TExchangeSnap;
        const ago = Math.round((Date.now() - j.at) / 1000);
        const bits = [j.ok ? 'OK' : 'FAIL', `t−${ago}s`];
        if (j.httpStatus != null) bits.push(`HTTP ${j.httpStatus}`);
        if (j.note) bits.push(j.note.slice(0, 120));
        return bits.join(' · ');
    } catch {
        return '?';
    }
}

function readCallbackSnap(): string {
    try {
        const raw = sessionStorage.getItem('denara_oauth_debug_callback');
        if (!raw) return '—';
        const j = JSON.parse(raw) as Record<string, unknown>;
        const ago = Math.round((Date.now() - Number(j.at)) / 1000);
        const bits = [`phase=${j.phase}`, `t−${ago}s`];
        if (typeof j.hasVerifier === 'boolean') bits.push(`hasVerifier=${j.hasVerifier}`);
        if (typeof j.storedStateLen === 'number') bits.push(`storedStateLen=${j.storedStateLen}`);
        if (typeof j.oauthError === 'string') bits.push(`err=${j.oauthError}`);
        return bits.join(' · ');
    } catch {
        return '?';
    }
}

/**
 * On-device auth storage probe — no secrets shown (lengths / booleans only).
 * Enable: open site with `?auth_debug=1` once, then use Log in (flag persists in localStorage).
 */
export function AuthDebugOverlay() {
    const [, bump] = React.useReducer((x: number) => x + 1, 0);

    React.useEffect(() => {
        const id = window.setInterval(() => bump(), 1200);
        const onVis = () => bump();
        document.addEventListener('visibilitychange', onVis);
        return () => {
            window.clearInterval(id);
            document.removeEventListener('visibilitychange', onVis);
        };
    }, []);

    if (!isAuthDebugEnabled()) return null;

    const url = new URL(window.location.href);
    const urlOAuth = [
        url.searchParams.has('code') ? 'code' : '',
        url.searchParams.has('state') ? 'state' : '',
        url.searchParams.has('error') ? 'error' : '',
    ]
        .filter(Boolean)
        .join(', ');

    const rows: [string, string][] = [
        ['URL OAuth params', urlOAuth || '—'],
        ['OAuth callback phase', readCallbackSnap()],
        ['Last token exchange', readExchangeSnap()],
        ['localStorage authToken', boolKey(localStorage, 'authToken')],
        ['localStorage active_loginid', localStorage.getItem('active_loginid') || '—'],
        ['localStorage accountsList', summarizeAccountsList()],
        ['Options OAuth mode', localStorage.getItem('deriv_options_auth_mode') === '1' ? 'yes' : 'no'],
        [
            'Options accounts (cached)',
            (() => {
                try {
                    const raw = localStorage.getItem('deriv_options_accounts');
                    if (!raw) return '—';
                    const n = JSON.parse(raw);
                    return Array.isArray(n) ? String(n.length) : '—';
                } catch {
                    return 'parse err';
                }
            })(),
        ],
        ['localStorage deriv_oauth_access_token', boolKey(localStorage, 'deriv_oauth_access_token')],
        [
            'localStorage deriv_oauth_access_token_saved_at',
            localStorage.getItem('deriv_oauth_access_token_saved_at') || '—',
        ],
        ['session pkce_code_verifier', boolKey(sessionStorage, 'pkce_code_verifier')],
        ['session oauth_state', boolKey(sessionStorage, 'oauth_state')],
        ['session deriv_oauth_code', boolKey(sessionStorage, 'deriv_oauth_code')],
        ['localStorage deriv_pkce_bridge_v1', boolKey(localStorage, 'deriv_pkce_bridge_v1')],
        ['cookie deriv_pkce_*', document.cookie.includes('deriv_pkce_verifier') ? 'present' : 'no'],
    ];

    return (
        <div
            style={{
                position: 'fixed',
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 2147483000,
                maxHeight: '42vh',
                overflow: 'auto',
                background: 'rgba(15,15,20,0.94)',
                color: '#e8e8ef',
                fontFamily: 'system-ui, sans-serif',
                fontSize: '11px',
                lineHeight: 1.35,
                padding: '10px 12px 14px',
                borderTop: '2px solid #f59e0b',
                boxSizing: 'border-box',
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ color: '#fbbf24' }}>Auth debug</strong>
                <button
                    type='button'
                    onClick={() => {
                        clearAuthDebugFlag();
                        bump();
                    }}
                    style={{
                        background: '#374151',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        padding: '6px 10px',
                        fontSize: 11,
                    }}
                >
                    Turn off
                </button>
            </div>
            <div style={{ opacity: 0.85, marginBottom: 8 }}>
                Open once with <code style={{ color: '#93c5fd' }}>?auth_debug=1</code> — survives OAuth redirect. No token
                contents shown.
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                    {rows.map(([k, v]) => (
                        <tr key={k}>
                            <td style={{ padding: '3px 8px 3px 0', verticalAlign: 'top', color: '#9ca3af', width: '46%' }}>
                                {k}
                            </td>
                            <td style={{ padding: '3px 0', wordBreak: 'break-word', color: '#f3f4f6' }}>{v}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
