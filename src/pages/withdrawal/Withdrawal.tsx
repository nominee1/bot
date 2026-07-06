import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CurrencyIcon } from '@/components/currency/currency-icon';
import {
    isLegacyLinkedOptionsAccount,
    refreshWithdrawalFormAutofill,
    resolveDepositProfileLookupLoginid,
    type TWithdrawalFormAutofill,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import { useStore } from '@/hooks/useStore';
import { formatPaApiFetchError, getPaApiBaseUrl, getSiteAffiliateCode, sanitizePaApiError } from '@/utils/pa-api-base';
import './Withdrawal.scss';

const API_BASE = getPaApiBaseUrl();

const DEPOSITS_UNAVAILABLE_MESSAGE = 'Deposits are not available at the moment. We are updating our site.';

const DEPOSIT_AMOUNT_SUGGESTIONS = [2, 5, 10, 50, 100] as const;
const MIN_DEPOSIT_USD = 2;
const MAX_DEPOSIT_KES = 150_000;

const DERIV_PA_DEPOSIT_URL = 'https://home.deriv.com/dashboard/deposit/payment-agent';
const DERIV_PORTFOLIO_URL = 'https://home.deriv.com/dashboard/portfolio';

const DERIV_PA_DEPOSIT_LINK_LABEL = 'Click to get your CR login ID on Deriv →';
const DERIV_NICKNAME_LINK_LABEL = 'Click to get your Deriv nickname on Deriv →';
const DERIV_OPTIONS_TRANSFER_LINK_LABEL = 'Click here to transfer to options account';

const AutofillBadge: React.FC = () => (
    <span className='withdrawal-field__autofill' title='Filled from your logged-in Deriv account'>
        auto
    </span>
);

const ProfileSectionIcon: React.FC = () => (
    <svg width='22' height='22' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <circle cx='12' cy='8' r='4' stroke='currentColor' strokeWidth='1.75' />
        <path
            d='M5 20c0-3.314 3.134-6 7-6s7 2.686 7 6'
            stroke='currentColor'
            strokeWidth='1.75'
            strokeLinecap='round'
        />
    </svg>
);

const DepositSectionIcon: React.FC = () => (
    <svg width='22' height='22' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <rect x='3' y='6' width='18' height='14' rx='2' stroke='currentColor' strokeWidth='1.75' />
        <path d='M3 10h18M8 15h2' stroke='currentColor' strokeWidth='1.75' strokeLinecap='round' />
    </svg>
);

const PhoneIcon: React.FC = () => (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <rect x='7' y='2' width='10' height='20' rx='2' stroke='currentColor' strokeWidth='1.75' />
        <path d='M11 18h2' stroke='currentColor' strokeWidth='1.75' strokeLinecap='round' />
    </svg>
);

const HistoryIcon: React.FC = () => (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <circle cx='12' cy='12' r='9' stroke='currentColor' strokeWidth='1.75' />
        <path d='M12 7v5l3 2' stroke='currentColor' strokeWidth='1.75' strokeLinecap='round' />
    </svg>
);

const WhatsAppIcon: React.FC = () => (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
        <path d='M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z' />
    </svg>
);

const SUPPORT_PHONE_DISPLAY = '0713806762';
const SUPPORT_WHATSAPP_URL = 'https://wa.me/254713806762';

/** e.g. ROT90381442 → ROT***42, CR7557018 → CR***18 */
function maskDerivLoginidForDisplay(loginid: string): string {
    const id = loginid.trim();
    if (!id) return id;

    const match = id.match(/^([A-Za-z]+)(\d+)$/);
    if (!match) {
        if (id.length <= 5) return id;
        return `${id.slice(0, 3)}***${id.slice(-2)}`;
    }

    const [, prefix, digits] = match;
    const last2 = digits.length >= 2 ? digits.slice(-2) : digits;
    return `${prefix.toUpperCase()}***${last2}`;
}

type ExchangeQuote = {
    baseExchangeRate: number;
    markupKesPerUsd: number;
    effectiveExchangeRate: number;
};

type Profile = {
    email: string;
    funding_loginid: string;
    deriv_nickname: string | null;
    options_loginid: string | null;
};

type Deposit = {
    id: string;
    amount_usd: string;
    amount_kes: number;
    base_exchange_rate: string;
    markup_kes_per_usd: number;
    effective_exchange_rate: string;
    status: string;
    mpesa_receipt: string | null;
    deriv_transaction_id: string | null;
    pa_error: string | null;
    created_at: string;
};

const STATUS_LABELS: Record<string, string> = {
    pending_payment: 'Not started',
    stk_sent: 'Waiting for M-Pesa PIN',
    mpesa_success: 'M-Pesa received',
    mpesa_failed: 'M-Pesa failed',
    pa_pending: 'Sending to Deriv…',
    completed: 'Completed',
    pa_failed: 'Deriv transfer failed',
};

type PageView = 'deposit' | 'profile';

const Withdrawal: React.FC = () => {
    const { client } = useStore() ?? {};
    const [email, setEmail] = useState('');
    const [fundingLoginid, setFundingLoginid] = useState('');
    const [derivNickname, setDerivNickname] = useState('');
    const [optionsLoginid, setOptionsLoginid] = useState('');
    const [autofillSource, setAutofillSource] = useState<Partial<Record<keyof TWithdrawalFormAutofill, boolean>>>({});
    const [amountUsd, setAmountUsd] = useState('');
    const [mpesaPhone, setMpesaPhone] = useState('');
    const [quote, setQuote] = useState<ExchangeQuote | null>(null);
    const [amountKes, setAmountKes] = useState<number | null>(null);
    const [profileBusy, setProfileBusy] = useState(false);
    const [depositBusy, setDepositBusy] = useState(false);
    const [activeDepositId, setActiveDepositId] = useState<string | null>(null);
    const [activeStatus, setActiveStatus] = useState<string | null>(null);
    const [history, setHistory] = useState<Deposit[]>([]);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyBusy, setHistoryBusy] = useState(false);
    const [profileSaved, setProfileSaved] = useState(false);
    const [pageView, setPageView] = useState<PageView>('profile');
    const [profileMessage, setProfileMessage] = useState<string | null>(null);
    const [profileError, setProfileError] = useState<string | null>(null);
    const [depositMessage, setDepositMessage] = useState<string | null>(null);
    const [showOptionsTransferHint, setShowOptionsTransferHint] = useState(false);
    const [depositError, setDepositError] = useState<string | null>(null);
    const [depositsAvailable, setDepositsAvailable] = useState(true);
    const [depositsStatusBusy, setDepositsStatusBusy] = useState(false);
    const [supportRevealed, setSupportRevealed] = useState(false);
    const [optionsLoginidFocused, setOptionsLoginidFocused] = useState(false);
    const hydratedForLoginidRef = useRef<string | null>(null);

    const isLoggedIn = Boolean(client?.loginid?.trim());

    const showDepositView = profileSaved && pageView === 'deposit';
    const showProfileView = !profileSaved || pageView === 'profile';

    const openProfile = () => {
        setProfileMessage(null);
        setProfileError(null);
        setPageView('profile');
    };

    const openDeposit = () => {
        setProfileMessage(null);
        setProfileError(null);
        setPageView('deposit');
    };

    const checkDepositsAvailability = useCallback(async (): Promise<boolean> => {
        setDepositsStatusBusy(true);
        try {
            const res = await fetch(`${API_BASE}/v1/deposits/payment-agent-status`);
            const data = (await res.json()) as {
                ok?: boolean;
                depositsAvailable?: boolean;
                message?: string | null;
            };
            if (!data.ok) {
                return true;
            }
            const available = data.depositsAvailable !== false;
            setDepositsAvailable(available);
            if (!available) {
                setDepositError(data.message ?? DEPOSITS_UNAVAILABLE_MESSAGE);
            } else {
                setDepositError(prev => (prev === DEPOSITS_UNAVAILABLE_MESSAGE ? null : prev));
            }
            return available;
        } catch {
            return true;
        } finally {
            setDepositsStatusBusy(false);
        }
    }, []);

    useEffect(() => {
        if (!showDepositView) return;
        checkDepositsAvailability();
    }, [showDepositView, checkDepositsAvailability]);

    const loadHistoryForProfile = useCallback(
        async (p: { email?: string; optionsLoginid?: string; fundingLoginid?: string }) => {
            const profileEmail = (p.email || '').trim();
            const loginid = (p.optionsLoginid || p.fundingLoginid || '').trim();
            if (!profileEmail && !loginid) return;
            try {
                // Deposits are keyed off profile resolved by email at payment time — prefer email.
                const query = profileEmail
                    ? `email=${encodeURIComponent(profileEmail)}`
                    : `loginid=${encodeURIComponent(loginid)}`;
                const res = await fetch(`${API_BASE}/v1/deposits/history?${query}`);
                const data = await res.json();
                if (data.ok) {
                    const rows = (data.deposits ?? []) as Deposit[];
                    setHistory(rows.filter(d => d.status === 'completed'));
                }
            } catch {
                // non-fatal
            }
        },
        []
    );

    const toggleTransactionHistory = async () => {
        if (historyOpen) {
            setHistoryOpen(false);
            return;
        }
        if (!email.trim() && !optionsLoginid.trim() && !fundingLoginid.trim()) {
            return;
        }
        setHistoryBusy(true);
        try {
            await loadHistoryForProfile({
                email: email.trim(),
                optionsLoginid: optionsLoginid.trim(),
                fundingLoginid: fundingLoginid.trim(),
            });
            setHistoryOpen(true);
        } finally {
            setHistoryBusy(false);
        }
    };

    const mergeSessionHints = (
        hints: TWithdrawalFormAutofill,
        savedProfile: Profile | null
    ): Partial<Record<keyof TWithdrawalFormAutofill, boolean>> => {
        const applied: Partial<Record<keyof TWithdrawalFormAutofill, boolean>> = {};

        if (hints.optionsLoginid && !savedProfile?.options_loginid) {
            setOptionsLoginid(hints.optionsLoginid);
            applied.optionsLoginid = true;
        }
        if (hints.derivNickname && !savedProfile?.deriv_nickname) {
            setDerivNickname(hints.derivNickname);
            applied.derivNickname = true;
        }
        // Saved profile CR always wins; session never overwrites DB funding login ID.
        if (!savedProfile?.funding_loginid && hints.fundingLoginid) {
            setFundingLoginid(hints.fundingLoginid);
            applied.fundingLoginid = true;
        }

        return applied;
    };

    const hasAutofilledIds = Boolean(autofillSource.fundingLoginid || autofillSource.optionsLoginid);

    const applyProfileToForm = useCallback((p: Profile) => {
        setEmail(p.email);
        setFundingLoginid(p.funding_loginid);
        setDerivNickname(p.deriv_nickname ?? '');
        if (p.options_loginid) {
            setOptionsLoginid(p.options_loginid);
        }
        setProfileSaved(true);
        setPageView('deposit');
        setHistoryOpen(false);
        setHistory([]);
    }, []);

    const accountLoginid = useMemo(
        () => optionsLoginid.trim() || fundingLoginid.trim(),
        [optionsLoginid, fundingLoginid]
    );

    const profileChipLabel = useMemo(() => {
        const raw = isLoggedIn
            ? optionsLoginid.trim() || fundingLoginid.trim()
            : fundingLoginid.trim() || accountLoginid;
        if (!raw) return 'Profile';
        return maskDerivLoginidForDisplay(raw);
    }, [accountLoginid, fundingLoginid, isLoggedIn, optionsLoginid]);

    const showMaskedOptionsLoginid = Boolean(
        optionsLoginid.trim() && (profileSaved || autofillSource.optionsLoginid) && !optionsLoginidFocused
    );

    const isLegacyAccount = useMemo(() => isLegacyLinkedOptionsAccount(optionsLoginid), [optionsLoginid]);

    useEffect(() => {
        if (!isLegacyAccount) return;
        setDerivNickname('');
        setAutofillSource(prev => ({ ...prev, derivNickname: false }));
    }, [isLegacyAccount]);

    const loadProfileByLoginid = useCallback(async (loginid: string): Promise<Profile | null> => {
        const id = loginid.trim();
        if (!id) return null;
        try {
            const res = await fetch(`${API_BASE}/v1/profile/by-loginid/${encodeURIComponent(id)}`);
            if (!res.ok) return null;
            const data = await res.json();
            if (!data.ok || !data.profile) return null;
            return data.profile as Profile;
        } catch {
            return null;
        }
    }, []);

    const hydrateFromSession = useCallback(async () => {
        const activeLoginid = client?.loginid?.trim() || '';
        const profileLookupLoginid = resolveDepositProfileLookupLoginid(activeLoginid || undefined);
        if (hydratedForLoginidRef.current === profileLookupLoginid && profileLookupLoginid) {
            return;
        }

        try {
            const hints = await refreshWithdrawalFormAutofill(activeLoginid || undefined);
            const lookupLoginid = hints.fundingLoginid || hints.optionsLoginid || profileLookupLoginid || '';
            const savedProfile = lookupLoginid ? await loadProfileByLoginid(lookupLoginid) : null;

            if (savedProfile) {
                applyProfileToForm(savedProfile);
                const applied = mergeSessionHints(hints, savedProfile);
                if (Object.keys(applied).length) {
                    setAutofillSource(applied);
                }
                setProfileMessage('Loaded your saved profile. You can pay with M-Pesa below.');
                hydratedForLoginidRef.current = lookupLoginid;
                setPageView('deposit');
                return;
            }

            const applied = mergeSessionHints(hints, null);
            if (Object.keys(applied).length) {
                setAutofillSource(applied);
            }

            const accountEmail = client?.account_settings?.email?.trim();
            if (accountEmail) {
                setEmail(accountEmail);
            }
            setProfileSaved(false);
            setPageView('profile');
            hydratedForLoginidRef.current = lookupLoginid || null;
        } catch {
            // non-fatal
        }
    }, [applyProfileToForm, client?.account_settings?.email, client?.loginid, loadProfileByLoginid]);

    useEffect(() => {
        hydrateFromSession();
    }, [hydrateFromSession]);

    const loadExchangeRate = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/v1/deposits/exchange-rate`);
            const data = await res.json();
            if (data.ok) setQuote(data.quote);
        } catch {
            // non-fatal
        }
    }, []);

    useEffect(() => {
        loadExchangeRate();
    }, [loadExchangeRate]);

    const usdNumber = useMemo(() => {
        const n = Number(amountUsd);
        return Number.isFinite(n) && n > 0 ? n : null;
    }, [amountUsd]);

    const maxDepositUsd = useMemo(() => {
        if (!quote?.effectiveExchangeRate) return null;
        const usd = MAX_DEPOSIT_KES / quote.effectiveExchangeRate;
        return Math.floor(usd * 100) / 100;
    }, [quote]);

    useEffect(() => {
        if (!usdNumber) {
            setAmountKes(null);
            return;
        }
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`${API_BASE}/v1/deposits/quote`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount_usd: usdNumber }),
                });
                const data = await res.json();
                if (data.ok) {
                    setAmountKes(data.amountKes);
                    setQuote(data.quote);
                }
            } catch {
                // ignore
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [usdNumber]);

    useEffect(() => {
        if (!activeDepositId) return;
        const terminal = new Set(['completed', 'mpesa_failed', 'pa_failed']);
        const poll = async () => {
            try {
                const res = await fetch(`${API_BASE}/v1/deposits/${activeDepositId}`);
                const data = await res.json();
                if (!data.ok) return;
                const dep = data.deposit as Deposit;
                setActiveStatus(dep.status);
                if (terminal.has(dep.status)) {
                    setActiveDepositId(null);
                    if (historyOpen) {
                        await loadHistoryForProfile({
                            email: email.trim(),
                            optionsLoginid: optionsLoginid.trim(),
                            fundingLoginid: fundingLoginid.trim(),
                        });
                    }
                    if (dep.status === 'completed') {
                        setDepositMessage(`Deposit complete. Deriv txn: ${dep.deriv_transaction_id ?? '—'}`);
                        setShowOptionsTransferHint(true);
                        setDepositError(null);
                    } else if (dep.status === 'pa_failed') {
                        setDepositError('Payment could not be completed. Please contact support.');
                        setDepositMessage(null);
                        setShowOptionsTransferHint(false);
                    } else {
                        setDepositError('M-Pesa payment was not completed.');
                        setDepositMessage(null);
                        setShowOptionsTransferHint(false);
                    }
                }
            } catch {
                // retry
            }
        };
        poll();
        const id = setInterval(poll, 4000);
        return () => clearInterval(id);
    }, [activeDepositId, email, fundingLoginid, historyOpen, loadHistoryForProfile, optionsLoginid]);

    const saveProfile = async () => {
        setProfileError(null);
        setProfileMessage(null);
        if (!fundingLoginid.trim()) {
            setProfileError('Enter your CR funding login ID.');
            return;
        }
        setProfileBusy(true);
        try {
            const res = await fetch(`${API_BASE}/v1/profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email.trim(),
                    funding_loginid: fundingLoginid.trim(),
                    deriv_nickname: derivNickname.trim(),
                    options_loginid: optionsLoginid.trim() || undefined,
                }),
            });
            const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
            if (!res.ok || !data.ok) throw new Error(sanitizePaApiError(data.error));
            setProfileSaved(true);
            setProfileMessage('Profile saved. You can pay with M-Pesa below.');
            setPageView('deposit');
            hydratedForLoginidRef.current = null;
            setHistoryOpen(false);
            setHistory([]);
        } catch (err) {
            setProfileError(formatPaApiFetchError(err, 'save profile'));
        } finally {
            setProfileBusy(false);
        }
    };

    const startDeposit = async () => {
        setDepositError(null);
        setDepositMessage(null);
        setShowOptionsTransferHint(false);

        const available = await checkDepositsAvailability();
        if (!available) {
            return;
        }

        if (!profileSaved && (!email.trim() || !fundingLoginid.trim())) {
            setDepositError('Save your profile first (email and CR login ID).');
            openProfile();
            return;
        }
        if (!email.trim() || !fundingLoginid.trim()) {
            setDepositError('Your profile is missing email or CR login ID. Save your profile again.');
            return;
        }
        if (!usdNumber) {
            setDepositError('Enter a valid USD amount.');
            return;
        }
        if (!mpesaPhone.trim()) {
            setDepositError('Enter your M-Pesa phone number.');
            return;
        }

        setDepositBusy(true);
        try {
            const affiliateCode = getSiteAffiliateCode();
            const res = await fetch(`${API_BASE}/v1/deposits`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email.trim(),
                    amount_usd: usdNumber,
                    phone_number: mpesaPhone.trim(),
                    ...(affiliateCode ? { referrer_affiliate_code: affiliateCode } : {}),
                }),
            });
            const data = (await res.json().catch(() => ({}))) as {
                ok?: boolean;
                error?: string;
                deposit?: { id: string; status: string };
            };
            if (!res.ok || !data.ok || !data.deposit) {
                const errMsg = sanitizePaApiError(data.error);
                if (errMsg.includes('not available at the moment')) {
                    setDepositsAvailable(false);
                    setDepositError(DEPOSITS_UNAVAILABLE_MESSAGE);
                    return;
                }
                throw new Error(errMsg);
            }
            setActiveDepositId(data.deposit.id);
            setActiveStatus(data.deposit.status);
            setDepositMessage('M-Pesa prompt sent. Enter your PIN on your phone.');
        } catch (err) {
            setDepositError(formatPaApiFetchError(err, 'start deposit'));
        } finally {
            setDepositBusy(false);
        }
    };

    return (
        <div className='withdrawal-page'>
            {profileSaved && (
                <nav className='withdrawal-page__tabs' aria-label='Deposit page sections'>
                    <button
                        type='button'
                        className={`withdrawal-page__tab${showDepositView ? ' withdrawal-page__tab--active' : ''}`}
                        onClick={openDeposit}
                    >
                        <DepositSectionIcon />
                        Deposit
                    </button>
                    <button
                        type='button'
                        className={`withdrawal-page__tab${showProfileView ? ' withdrawal-page__tab--active' : ''}`}
                        onClick={openProfile}
                    >
                        <ProfileSectionIcon />
                        Profile
                    </button>
                </nav>
            )}

            <div
                className={`withdrawal-page__main${
                    showDepositView ? ' withdrawal-page__main--deposit-only' : ''
                }${!profileSaved && showProfileView ? ' withdrawal-page__main--signup' : ''}${
                    profileSaved && showProfileView ? ' withdrawal-page__main--profile-edit' : ''
                }`}
            >
                {showProfileView && (
                    <section
                        className={`withdrawal-card withdrawal-card--profile${
                            !profileSaved ? ' withdrawal-card--signup' : ''
                        }`}
                    >
                        <div className='withdrawal-card__title-row'>
                            <div className='withdrawal-card__heading'>
                                <span className='withdrawal-card__section-icon' aria-hidden='true'>
                                    <ProfileSectionIcon />
                                </span>
                                <div>
                                    <h2>{profileSaved ? 'Your profile' : 'Sign up to deposit'}</h2>
                                    {!profileSaved && (
                                        <p className='withdrawal-card__subtitle'>
                                            One-time setup — link your Deriv account so we know where to send funds.
                                        </p>
                                    )}
                                </div>
                            </div>
                            {profileSaved && (
                                <button
                                    type='button'
                                    className='withdrawal-btn withdrawal-btn--text'
                                    onClick={openDeposit}
                                >
                                    Back to deposit
                                </button>
                            )}
                        </div>

                        {profileMessage && (
                            <div className='withdrawal-page__alert withdrawal-page__alert--info'>{profileMessage}</div>
                        )}
                        {profileError && (
                            <div className='withdrawal-page__alert withdrawal-page__alert--error'>{profileError}</div>
                        )}

                        {hasAutofilledIds && (
                            <p className='withdrawal-card__autofill-note'>
                                Login IDs marked <AutofillBadge /> were filled from your session.
                            </p>
                        )}

                        <label>
                            Email
                            <input
                                type='email'
                                value={email}
                                autoComplete='email'
                                onChange={e => setEmail(e.target.value)}
                            />
                        </label>

                        <label className='withdrawal-field'>
                            <span className='withdrawal-field__label'>
                                Funding login ID (CR)
                                {autofillSource.fundingLoginid && <AutofillBadge />}
                            </span>
                            <a
                                className='withdrawal-field__link'
                                href={DERIV_PA_DEPOSIT_URL}
                                target='_blank'
                                rel='noopener noreferrer'
                            >
                                {DERIV_PA_DEPOSIT_LINK_LABEL}
                            </a>
                            <input
                                type='text'
                                value={fundingLoginid}
                                autoComplete='username'
                                onChange={e => {
                                    setFundingLoginid(e.target.value.toUpperCase());
                                    setAutofillSource(prev => ({ ...prev, fundingLoginid: false }));
                                }}
                                placeholder='CR*****'
                            />
                        </label>

                        <label className='withdrawal-field'>
                            <span className='withdrawal-field__label'>
                                Deriv nickname
                                {!isLegacyAccount && autofillSource.derivNickname && <AutofillBadge />}
                            </span>
                            {!isLegacyAccount && (
                                <a
                                    className='withdrawal-field__link'
                                    href={DERIV_PA_DEPOSIT_URL}
                                    target='_blank'
                                    rel='noopener noreferrer'
                                >
                                    {DERIV_NICKNAME_LINK_LABEL}
                                </a>
                            )}
                            {isLegacyAccount && (
                                <span className='withdrawal-field__help'>
                                    Not required for legacy linked accounts — use your CR login ID above.
                                </span>
                            )}
                            <input
                                type='text'
                                value={derivNickname}
                                autoComplete='nickname'
                                readOnly={isLegacyAccount}
                                disabled={isLegacyAccount}
                                onChange={e => {
                                    setDerivNickname(e.target.value);
                                    setAutofillSource(prev => ({ ...prev, derivNickname: false }));
                                }}
                                placeholder='client_*****'
                            />
                        </label>

                        <label className='withdrawal-field'>
                            <span className='withdrawal-field__label'>
                                Options login ID
                                {autofillSource.optionsLoginid && <AutofillBadge />}
                            </span>
                            <input
                                type='text'
                                value={
                                    showMaskedOptionsLoginid
                                        ? maskDerivLoginidForDisplay(optionsLoginid)
                                        : optionsLoginid
                                }
                                autoComplete='username'
                                onFocus={() => setOptionsLoginidFocused(true)}
                                onBlur={() => setOptionsLoginidFocused(false)}
                                onChange={e => {
                                    setOptionsLoginid(e.target.value);
                                    setAutofillSource(prev => ({ ...prev, optionsLoginid: false }));
                                }}
                                placeholder='ROT***42'
                            />
                        </label>

                        <button
                            type='button'
                            className='withdrawal-btn withdrawal-btn--primary'
                            disabled={profileBusy}
                            onClick={saveProfile}
                        >
                            {profileBusy ? 'Saving…' : profileSaved ? 'Update profile' : 'Save & continue to deposit'}
                        </button>
                    </section>
                )}

                {showDepositView && (
                    <section className='withdrawal-card withdrawal-card--deposit'>
                        <div className='withdrawal-card__title-row withdrawal-card__title-row--deposit'>
                            <div className='withdrawal-card__heading'>
                                <span
                                    className='withdrawal-card__section-icon withdrawal-card__section-icon--deposit'
                                    aria-hidden='true'
                                >
                                    <DepositSectionIcon />
                                </span>
                                <h2>Deposit amount</h2>
                            </div>
                            <button
                                type='button'
                                className='withdrawal-profile-chip'
                                onClick={openProfile}
                                title='View or update your profile'
                            >
                                <ProfileSectionIcon />
                                <span>{profileChipLabel}</span>
                            </button>
                        </div>

                        {!depositsStatusBusy && !depositsAvailable && (
                            <div className='withdrawal-page__alert withdrawal-page__alert--unavailable' role='status'>
                                {DEPOSITS_UNAVAILABLE_MESSAGE}
                            </div>
                        )}

                        {quote && (
                            <div className='withdrawal-rate'>
                                <span className='withdrawal-rate__label'>USD/KES rate</span>
                                <strong className='withdrawal-rate__value'>
                                    {Number(quote.effectiveExchangeRate).toFixed(2)}
                                </strong>
                            </div>
                        )}

                        <label>
                            M-Pesa phone
                            <div className='withdrawal-phone-input'>
                                <span className='withdrawal-phone-input__icon' aria-hidden='true'>
                                    <PhoneIcon />
                                </span>
                                <input
                                    type='tel'
                                    value={mpesaPhone}
                                    onChange={e => setMpesaPhone(e.target.value)}
                                    placeholder='07XX or 01XX XXX XXX'
                                />
                            </div>
                        </label>

                        <label>
                            Amount (USD)
                            <p className='withdrawal-deposit-limits'>
                                Min deposit ${MIN_DEPOSIT_USD}
                                {maxDepositUsd != null
                                    ? ` · Max deposit $${maxDepositUsd.toFixed(2)} (${MAX_DEPOSIT_KES.toLocaleString()} KES)`
                                    : ' · Max deposit …'}
                            </p>
                            <div className='withdrawal-amount-input'>
                                <input
                                    type='number'
                                    min={MIN_DEPOSIT_USD}
                                    max={maxDepositUsd ?? undefined}
                                    step='0.01'
                                    value={amountUsd}
                                    onChange={e => setAmountUsd(e.target.value)}
                                    placeholder='Enter deposit amount'
                                />
                            </div>
                            <div
                                className='withdrawal-amount-suggestions'
                                role='group'
                                aria-label='Suggested deposit amounts'
                            >
                                {DEPOSIT_AMOUNT_SUGGESTIONS.map(value => (
                                    <button
                                        key={value}
                                        type='button'
                                        className={`withdrawal-amount-suggestions__chip${
                                            Number(amountUsd) === value
                                                ? ' withdrawal-amount-suggestions__chip--active'
                                                : ''
                                        }`}
                                        onClick={() => setAmountUsd(String(value))}
                                    >
                                        ${value}
                                    </button>
                                ))}
                            </div>
                        </label>

                        {amountKes != null && (
                            <div className='withdrawal-kes-total'>
                                <span className='withdrawal-kes-total__label'>You pay via M-Pesa</span>
                                <strong className='withdrawal-kes-total__value'>
                                    KES {amountKes.toLocaleString()}
                                </strong>
                            </div>
                        )}

                        <button
                            type='button'
                            className='withdrawal-btn withdrawal-btn--accent'
                            disabled={
                                depositBusy || Boolean(activeDepositId) || depositsStatusBusy || !depositsAvailable
                            }
                            onClick={startDeposit}
                        >
                            {depositBusy ? 'Sending STK…' : 'Deposit with M-Pesa'}
                        </button>

                        {(depositMessage || depositError || activeStatus || showOptionsTransferHint) && (
                            <div className='withdrawal-payment-status'>
                                {depositMessage && (
                                    <div className='withdrawal-page__alert withdrawal-page__alert--info'>
                                        {depositMessage}
                                    </div>
                                )}
                                {showOptionsTransferHint && (
                                    <div className='withdrawal-page__alert withdrawal-page__alert--info'>
                                        <p className='withdrawal-page__transfer-hint'>
                                            Your funds are in your USD account. Transfer them to your options account on
                                            Deriv.
                                        </p>
                                        <a
                                            className='withdrawal-page__success-link'
                                            href={DERIV_PORTFOLIO_URL}
                                            target='_blank'
                                            rel='noopener noreferrer'
                                        >
                                            {DERIV_OPTIONS_TRANSFER_LINK_LABEL}
                                        </a>
                                    </div>
                                )}
                                {depositError && (
                                    <div className='withdrawal-page__alert withdrawal-page__alert--error'>
                                        {depositError}
                                    </div>
                                )}
                                {activeStatus && activeDepositId && (
                                    <div
                                        className={`withdrawal-page__alert withdrawal-page__alert--${
                                            activeStatus === 'stk_sent' ? 'pending' : 'info'
                                        }`}
                                    >
                                        {STATUS_LABELS[activeStatus] ?? activeStatus}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className='withdrawal-transactions'>
                            <button
                                type='button'
                                className='withdrawal-btn withdrawal-btn--ghost withdrawal-btn--history'
                                disabled={historyBusy}
                                onClick={toggleTransactionHistory}
                            >
                                <HistoryIcon />
                                {historyBusy
                                    ? 'Loading…'
                                    : historyOpen
                                      ? 'Hide transaction history'
                                      : 'Transaction history'}
                            </button>

                            {historyOpen && (
                                <>
                                    <h3>
                                        Completed deposits
                                        {accountLoginid && (
                                            <span className='withdrawal-transactions__account'>{accountLoginid}</span>
                                        )}
                                    </h3>
                                    {history.length === 0 ? (
                                        <p className='withdrawal-transactions__empty'>
                                            No completed deposits yet for this account.
                                        </p>
                                    ) : (
                                        <div className='withdrawal-table-wrap'>
                                            <table className='withdrawal-table'>
                                                <thead>
                                                    <tr>
                                                        <th>Date</th>
                                                        <th>USD</th>
                                                        <th>KES</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {history.map(row => (
                                                        <tr key={row.id}>
                                                            <td>{new Date(row.created_at).toLocaleString()}</td>
                                                            <td>
                                                                <span className='withdrawal-table__usd'>
                                                                    <CurrencyIcon currency='usd' />
                                                                    {Number(row.amount_usd).toFixed(2)}
                                                                </span>
                                                            </td>
                                                            <td>{row.amount_kes.toLocaleString()}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </section>
                )}
            </div>

            <footer className='withdrawal-page__support'>
                {!supportRevealed ? (
                    <button
                        type='button'
                        className='withdrawal-page__support-toggle'
                        onClick={() => setSupportRevealed(true)}
                    >
                        Support
                    </button>
                ) : (
                    <a
                        className='withdrawal-page__support-link'
                        href={SUPPORT_WHATSAPP_URL}
                        target='_blank'
                        rel='noopener noreferrer'
                    >
                        <WhatsAppIcon />
                        <span>{SUPPORT_PHONE_DISPLAY}</span>
                    </a>
                )}
            </footer>
        </div>
    );
};

export default Withdrawal;
