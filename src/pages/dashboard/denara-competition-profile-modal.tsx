import React, { useEffect, useState } from 'react';
import Dialog from '@/components/shared_ui/dialog';
import Text from '@/components/shared_ui/text';
import {
    getDenaraCompetitionUsername,
    registerCompetitionTrader,
    setDenaraCompetitionUsername,
} from '@/components/shared/utils/competition/denara-competition-profile';
import { validateDerivTokenForDenaraRegistration } from '@/components/shared/utils/competition/deriv-token-verify';
import { Localize, localize } from '@deriv-com/translations';

import './denara-competition-profile-modal.scss';

type Props = {
    is_open: boolean;
    onClose: () => void;
    email_prefill: string;
};

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

const DenaraCompetitionProfileModal: React.FC<Props> = ({ is_open, onClose, email_prefill }) => {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [passwordConfirm, setPasswordConfirm] = useState('');
    const [tokenInput, setTokenInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);

    useEffect(() => {
        if (!is_open) return;
        setErr(null);
        setOk(null);
        setUsername(getDenaraCompetitionUsername() ?? '');
        setEmail(email_prefill || '');
        setPassword('');
        setPasswordConfirm('');
        // Never paste session/OAuth token into registration — create a dedicated API token on Deriv instead.
        setTokenInput('');
    }, [is_open, email_prefill]);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErr(null);
        setOk(null);

        if (!username.trim()) {
            setErr(localize('Enter your Denara username.'));
            return;
        }

        if (!tokenInput.trim()) {
            setErr(localize('Paste your Deriv API token from Deriv account settings.'));
            return;
        }

        if (!emailOk(email)) {
            setErr(localize('Enter a valid email.'));
            return;
        }

        if (password.length < 8) {
            setErr(localize('Password must be at least 8 characters.'));
            return;
        }

        if (password.length > 72) {
            setErr(localize('Password must be at most 72 characters.'));
            return;
        }

        if (password !== passwordConfirm) {
            setErr(localize('Passwords do not match.'));
            return;
        }

        try {
            setLoading(true);
            const verified = await validateDerivTokenForDenaraRegistration(tokenInput.trim());
            await registerCompetitionTrader({
                username: username.trim(),
                token: tokenInput.trim(),
                email: email.trim(),
                password,
            });
            setDenaraCompetitionUsername(username.trim());
            setOk(
                `${localize('Saved for')} ${verified.loginid} (${verified.currency}). ${localize(
                    'Use this Denara username when joining challenges.'
                )}`
            );
            setTokenInput('');
            setPassword('');
            setPasswordConfirm('');
        } catch (ex: unknown) {
            setErr(ex instanceof Error ? ex.message : localize('Save failed.'));
        } finally {
            setLoading(false);
        }
    };

    const body = (
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text size='xxs' weight='bold'>
                    <Localize i18n_default_text='Denara username' />
                </Text>
                <input
                    type='text'
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    disabled={loading}
                    autoComplete='username'
                    style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--general-section-1, #ccc)' }}
                />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text size='xxs' weight='bold'>
                    <Localize i18n_default_text='Denara login password' />
                </Text>
                <input
                    type='password'
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    disabled={loading}
                    autoComplete='new-password'
                    placeholder={localize('At least 8 characters')}
                    style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--general-section-1, #ccc)' }}
                />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text size='xxs' weight='bold'>
                    <Localize i18n_default_text='Confirm password' />
                </Text>
                <input
                    type='password'
                    value={passwordConfirm}
                    onChange={e => setPasswordConfirm(e.target.value)}
                    disabled={loading}
                    autoComplete='new-password'
                    style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--general-section-1, #ccc)' }}
                />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text size='xxs' weight='bold'>
                    <Localize i18n_default_text='Deriv API token (real USD)' />
                </Text>
                <input
                    type='password'
                    value={tokenInput}
                    onChange={e => setTokenInput(e.target.value)}
                    disabled={loading}
                    autoComplete='off'
                    placeholder={localize(
                        'API token with Read + Trade (legacy CR or new Options account)'
                    )}
                    style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--general-section-1, #ccc)' }}
                />
                <div className='denara-comp-profile-modal__token-meta'>
                    <a
                        className='denara-comp-profile-modal__token-link'
                        href='https://app.deriv.com/account/api-token'
                        target='_blank'
                        rel='noopener noreferrer'
                    >
                        <Localize i18n_default_text='Retrieve or create API tokens on Deriv' />
                    </a>
                    <Text size='xxs' className='denara-comp-profile-modal__token-note' color='less-prominent'>
                        <Localize i18n_default_text='Legacy tokens (a1-… from Deriv → Account → API token): Read + Trade on real USD. pat_ tokens must be created on developers.deriv.com under your Denara Options/PAT app (OAuth client id — not legacy app 71070).' />
                    </Text>
                    <Text size='xxs' className='denara-comp-profile-modal__token-note' color='less-prominent'>
                        <Localize i18n_default_text='Tip: enable Payments on the token if you want to join or create paid challenges.' />
                    </Text>
                </div>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text size='xxs' weight='bold'>
                    <Localize i18n_default_text='Email' />
                </Text>
                <input
                    type='email'
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    disabled={loading}
                    autoComplete='email'
                    style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--general-section-1, #ccc)' }}
                />
            </label>

            <button
                type='submit'
                disabled={loading}
                style={{
                    marginTop: 8,
                    padding: '12px 16px',
                    borderRadius: 8,
                    border: 'none',
                    cursor: loading ? 'wait' : 'pointer',
                    fontWeight: 600,
                    background: 'var(--brand-red-coral, #cc2e3d)',
                    color: '#fff',
                }}
            >
                {loading ? localize('Saving…') : localize('Save')}
            </button>

            {ok && (
                <div style={{ padding: 10, borderRadius: 8, background: 'rgba(34,197,94,0.12)', color: '#166534' }}>
                    {ok}
                </div>
            )}
            {err && (
                <div style={{ padding: 10, borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: '#991b1b' }}>
                    {err}
                </div>
            )}
        </form>
    );

    /**
     * Mobile + desktop: always portal to #modal_root. (MobileFullPageModal + motion/FadeWrapper broke
     * `position:fixed` so the sheet pinned top-left; one Dialog matches desktop centering.)
     */
    return (
        <Dialog
            className='denara-comp-profile-dialog-wrap'
            title={localize('Making your login easier')}
            is_visible={is_open}
            onClose={onClose}
            onConfirm={() => undefined}
            has_close_icon
            portal_element_id='modal_root'
        >
            {body}
        </Dialog>
    );
};

export default DenaraCompetitionProfileModal;
