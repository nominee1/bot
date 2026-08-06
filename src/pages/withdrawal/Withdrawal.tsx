import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CurrencyIcon } from '@/components/currency/currency-icon';
import { DepositSectionIcon } from '@/components/icons/deposit-section-icon';
import PaymentFlowModal, { type TPaymentFlowPhase } from '@/components/payment-flow-modal/PaymentFlowModal';
import {
    DERIV_ACCOUNT_NICKNAME_KEY,
    fetchDerivAccountNickname,
    getRememberedFundingLoginidForOptions,
    refreshWithdrawalFormAutofill,
    rememberOptionsFundingLink,
    resolveDepositProfileLookupLoginid,
    type TWithdrawalFormAutofill,
} from '@/components/shared/utils/login/deriv-oauth-storage';
import { getDerivOAuthAccessToken } from '@/components/shared/utils/login/deriv-oauth-storage';
import { requestDerivOAuthAuthentication } from '@/components/shared/utils/login/login';
import { DERIV_ACCOUNT_TRANSFER_URL } from '@/constants/deriv-transfer';
import { QUICK_ACCESS_EVENTS, QUICK_ACCESS_SESSION } from '@/constants/quick-access-session';
import { useStore } from '@/hooks/useStore';
import { type DepositPageView, readPendingDepositPageView } from '@/utils/deposit-tab-navigation';
import { type DerivTransferAccount, fetchTransferableBalances } from '@/utils/deriv-account-transfer';
import {
    formatPaApiFetchError,
    getPaApiBaseUrl,
    getSiteAffiliateCode,
    paApiHeaders,
    sanitizePaApiError,
} from '@/utils/pa-api-base';
import {
    checkPaClientWithdrawEnabled,
    getPaymentAgentAgentId,
    requestPaWithdrawVerificationCode,
    submitPaWithdraw,
} from '@/utils/pa-withdraw';
import './Withdrawal.scss';

const API_BASE = getPaApiBaseUrl();

const PAYMENTS_MAINTENANCE_MESSAGE = 'Deposits and withdrawals are under maintenance. Check back shortly.';
const DEPOSITS_UNAVAILABLE_MESSAGE = PAYMENTS_MAINTENANCE_MESSAGE;

const DEPOSIT_AMOUNT_SUGGESTIONS = [2, 5, 10, 50, 100] as const;
const WITHDRAW_AMOUNT_SUGGESTIONS = [2, 5, 10, 50, 100] as const;
const MIN_DEPOSIT_USD = 2;
const MIN_WITHDRAW_USD = 2;
const MAX_DEPOSIT_KES = 150_000;
const MAX_WITHDRAW_KES = 100_000;
const SUPPORT_PHONE_DISPLAY = '0713806762';
const SUPPORT_EMAIL = 'undasite@gmail.com';
const SUPPORT_WHATSAPP_URL = 'https://wa.me/254713806762';
const SUPPORT_EMAIL_URL = `mailto:${SUPPORT_EMAIL}`;
const MPESA_PHONE_CHANGE_HELP =
    'To change your M-Pesa number, email undasite@gmail.com from your registered email, or WhatsApp support on 0713806762.';

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

const WithdrawSectionIcon: React.FC = () => (
    <svg width='22' height='22' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <path
            d='M12 3v12M8 11l4 4 4-4M5 21h14'
            stroke='currentColor'
            strokeWidth='1.75'
            strokeLinecap='round'
            strokeLinejoin='round'
        />
    </svg>
);

const TransferSectionIcon: React.FC = () => (
    <svg width='22' height='22' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <path
            d='M7 8h11M15 5l3 3-3 3M17 16H6M9 13l-3 3 3 3'
            stroke='currentColor'
            strokeWidth='1.75'
            strokeLinecap='round'
            strokeLinejoin='round'
        />
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

/** e.g. client_5147570d3 → client_***0d3 (full nickname still saved/sent to API). */
function maskDerivNicknameForDisplay(nickname: string): string {
    const raw = nickname.trim();
    if (!raw) return raw;
    const match = raw.match(/^(client)_?(.*)$/i);
    if (match) {
        const rest = match[2] || '';
        const last3 = rest.slice(-3);
        return last3 ? `client_***${last3}` : 'client_***';
    }
    if (raw.length <= 5) return raw;
    return `${raw.slice(0, 3)}***${raw.slice(-3)}`;
}

/** e.g. 254712345678 → 0712345678 for editing / API */
function formatMpesaPhoneForDisplay(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('254') && digits.length >= 12) {
        return `0${digits.slice(3)}`;
    }
    return phone.trim();
}

/** Show first 4 and last 2 digits only, e.g. 0712345678 → 0712****78 */
function maskMpesaPhoneForDisplay(phone: string): string {
    const display = formatMpesaPhoneForDisplay(phone).replace(/\s/g, '');
    if (display.length < 6) return display;
    const middle = Math.max(display.length - 6, 2);
    return `${display.slice(0, 4)}${'*'.repeat(middle)}${display.slice(-2)}`;
}

type ExchangeQuote = {
    baseExchangeRate: number;
    markupKesPerUsd: number;
    effectiveExchangeRate: number;
};

type Profile = {
    email: string;
    funding_loginid: string | null;
    deriv_nickname: string | null;
    options_loginid: string | null;
    mpesa_phone?: string | null;
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

type WithdrawalRecord = {
    id: string;
    amount_usd: string;
    amount_kes: number;
    status: string;
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

const WITHDRAW_STATUS_LABELS: Record<string, string> = {
    pending: 'Deriv transfer pending',
    requested: 'Deriv transfer requested',
    complete: 'Deriv transfer complete',
    b2c_pending: 'Queued for M-Pesa',
    b2c_initiating: 'Starting M-Pesa…',
    b2c_sent: 'M-Pesa sent — confirming…',
    completed: 'M-Pesa completed',
    b2c_failed: 'M-Pesa payout failed',
};

function withdrawStatusLabel(status: string | null | undefined): string {
    if (!status) return '';
    return WITHDRAW_STATUS_LABELS[status] ?? status;
}

type PageView = 'deposit' | 'transfer' | 'withdraw' | 'profile';

const Withdrawal: React.FC = () => {
    const { client } = useStore() ?? {};
    const [email, setEmail] = useState('');
    const [fundingLoginid, setFundingLoginid] = useState('');
    const [optionsLoginid, setOptionsLoginid] = useState('');
    /** Deriv nickname from GET /account/v1/nickname — used for Payment Agent credit. */
    const [derivNickname, setDerivNickname] = useState('');
    const [autofillSource, setAutofillSource] = useState<Partial<Record<keyof TWithdrawalFormAutofill, boolean>>>({});
    const [amountUsd, setAmountUsd] = useState('');
    const [withdrawAmountUsd, setWithdrawAmountUsd] = useState('');
    const [withdrawOtp, setWithdrawOtp] = useState('');
    const [withdrawOtpSent, setWithdrawOtpSent] = useState(false);
    const [withdrawBusy, setWithdrawBusy] = useState(false);
    const [withdrawMessage, setWithdrawMessage] = useState<string | null>(null);
    const [withdrawError, setWithdrawError] = useState<string | null>(null);
    const [withdrawStatus, setWithdrawStatus] = useState<string | null>(null);
    const [withdrawKes, setWithdrawKes] = useState<number | null>(null);
    const [withdrawQuote, setWithdrawQuote] = useState<ExchangeQuote | null>(null);
    const [activeWithdrawalId, setActiveWithdrawalId] = useState<string | null>(null);
    const [pendingPaPayout, setPendingPaPayout] = useState<{
        transactionId: number | null;
        requestId?: string;
        amountUsd: number;
    } | null>(null);
    const withdrawPayoutLockRef = useRef(false);
    const [mpesaPhone, setMpesaPhone] = useState('');
    const [mpesaPhoneLocked, setMpesaPhoneLocked] = useState(false);
    const [quote, setQuote] = useState<ExchangeQuote | null>(null);
    const [amountKes, setAmountKes] = useState<number | null>(null);
    const [profileBusy, setProfileBusy] = useState(false);
    const [depositBusy, setDepositBusy] = useState(false);
    const [activeDepositId, setActiveDepositId] = useState<string | null>(null);
    const [activeStatus, setActiveStatus] = useState<string | null>(null);
    const [history, setHistory] = useState<Deposit[]>([]);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyBusy, setHistoryBusy] = useState(false);
    const [withdrawHistory, setWithdrawHistory] = useState<WithdrawalRecord[]>([]);
    const [withdrawHistoryOpen, setWithdrawHistoryOpen] = useState(false);
    const [withdrawHistoryBusy, setWithdrawHistoryBusy] = useState(false);
    const [profileSaved, setProfileSaved] = useState(false);
    const [pageView, setPageView] = useState<PageView>('profile');
    /** True until first session profile hydrate finishes — avoids signup flash for returning users. */
    const [isHydrating, setIsHydrating] = useState(true);
    const [profileMessage, setProfileMessage] = useState<string | null>(null);
    const [profileError, setProfileError] = useState<string | null>(null);
    const [depositMessage, setDepositMessage] = useState<string | null>(null);
    const [depositError, setDepositError] = useState<string | null>(null);
    const [paymentModalOpen, setPaymentModalOpen] = useState(false);
    const [paymentModalKind, setPaymentModalKind] = useState<'deposit' | 'withdraw'>('deposit');
    const [paymentModalPhase, setPaymentModalPhase] = useState<TPaymentFlowPhase>('submitting');
    const [paymentModalMessage, setPaymentModalMessage] = useState<string | null>(null);
    const [paymentModalError, setPaymentModalError] = useState<string | null>(null);
    const [paymentModalAmountUsd, setPaymentModalAmountUsd] = useState<number | null>(null);
    const [paymentModalAmountKes, setPaymentModalAmountKes] = useState<number | null>(null);

    const closePaymentModal = () => {
        setPaymentModalOpen(false);
        setPaymentModalMessage(null);
        setPaymentModalError(null);
        setPaymentModalAmountUsd(null);
        setPaymentModalAmountKes(null);
    };
    const [depositsAvailable, setDepositsAvailable] = useState(true);
    const [withdrawalsAvailable, setWithdrawalsAvailable] = useState(true);
    const [paymentsUnavailableMessage, setPaymentsUnavailableMessage] = useState(PAYMENTS_MAINTENANCE_MESSAGE);
    const [depositsStatusBusy, setDepositsStatusBusy] = useState(false);
    const [transferAccounts, setTransferAccounts] = useState<DerivTransferAccount[]>([]);
    const [balancesBusy, setBalancesBusy] = useState(false);
    const [transferError, setTransferError] = useState<string | null>(null);
    const [supportRevealed, setSupportRevealed] = useState(false);
    const [optionsLoginidFocused, setOptionsLoginidFocused] = useState(false);
    const [oauthReady, setOauthReady] = useState(() => Boolean(getDerivOAuthAccessToken()));
    const hydratedForLoginidRef = useRef<string | null>(null);

    const isLoggedIn = Boolean(client?.loginid?.trim());

    useEffect(() => {
        if (oauthReady) return;
        const id = window.setInterval(() => {
            if (getDerivOAuthAccessToken()) {
                setOauthReady(true);
            }
        }, 400);
        return () => window.clearInterval(id);
    }, [oauthReady]);

    const showDepositView = profileSaved && pageView === 'deposit';
    const showTransferView = profileSaved && pageView === 'transfer';
    const showWithdrawView = profileSaved && pageView === 'withdraw';
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

    const openTransfer = () => {
        setTransferError(null);
        setPageView('transfer');
    };

    const openWithdraw = () => {
        setWithdrawError(null);
        setWithdrawMessage(null);
        if (!mpesaPhone.trim()) {
            setWithdrawError('Complete your profile with an M-Pesa phone number before withdrawing.');
            setPageView('profile');
            setProfileError('Add your M-Pesa phone number to complete your profile, then try withdraw again.');
            return;
        }
        setPageView('withdraw');
    };

    const withdrawUsdNumber = Number(withdrawAmountUsd);
    const withdrawAmountValid = Number.isFinite(withdrawUsdNumber) && withdrawUsdNumber >= MIN_WITHDRAW_USD;
    const withdrawWithinMaxKes = withdrawKes == null || withdrawKes <= MAX_WITHDRAW_KES;
    const usdWalletBalance = useMemo(() => {
        const funding = transferAccounts.find(a => a.kind === 'funding' && String(a.currency).toUpperCase() === 'USD');
        if (funding && Number.isFinite(funding.balance)) return funding.balance;
        const usdOther = transferAccounts.find(
            a => a.kind !== 'options' && String(a.currency).toUpperCase() === 'USD' && Number.isFinite(a.balance)
        );
        return usdOther ? usdOther.balance : null;
    }, [transferAccounts]);
    const withdrawWithinUsdBalance =
        usdWalletBalance == null ||
        (Number.isFinite(withdrawUsdNumber) && withdrawUsdNumber <= usdWalletBalance + 0.0001);
    const withdrawReady = withdrawAmountValid && withdrawWithinMaxKes && withdrawWithinUsdBalance;
    const hasProfileMpesaPhone = Boolean(mpesaPhone.trim());

    const loadTransferBalances = useCallback(async () => {
        if (!getDerivOAuthAccessToken()) {
            setTransferError('Log in with Deriv first to see balances.');
            return null as number | null;
        }
        setBalancesBusy(true);
        setTransferError(null);
        try {
            const result = await fetchTransferableBalances({
                optionsLoginid: optionsLoginid.trim() || undefined,
                fundingLoginid: fundingLoginid.trim() || undefined,
            });
            setTransferAccounts(result.accounts);
            if (result.message && !result.accounts.length) {
                setTransferError(result.message);
            }
            const funding = result.accounts.find(
                a => a.kind === 'funding' && String(a.currency).toUpperCase() === 'USD'
            );
            if (funding && Number.isFinite(funding.balance)) return funding.balance;
            const usdOther = result.accounts.find(
                a => a.kind !== 'options' && String(a.currency).toUpperCase() === 'USD' && Number.isFinite(a.balance)
            );
            return usdOther ? usdOther.balance : null;
        } catch (err) {
            setTransferError(err instanceof Error ? err.message : 'Could not load balances.');
            return null;
        } finally {
            setBalancesBusy(false);
        }
    }, [fundingLoginid, optionsLoginid]);

    useEffect(() => {
        if (!showTransferView && !showWithdrawView) return;
        void loadTransferBalances();
    }, [showTransferView, showWithdrawView, loadTransferBalances]);

    useEffect(() => {
        if (!withdrawAmountValid) {
            setWithdrawKes(null);
            setWithdrawQuote(null);
            return;
        }
        const timer = window.setTimeout(async () => {
            try {
                const res = await fetch(`${API_BASE}/v1/withdrawals/quote`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount_usd: withdrawUsdNumber }),
                });
                const data = await res.json();
                if (data.ok) {
                    setWithdrawKes(data.amountKes);
                    setWithdrawQuote(data.quote);
                } else {
                    setWithdrawKes(null);
                    setWithdrawQuote(null);
                }
            } catch {
                // non-fatal
            }
        }, 300);
        return () => window.clearTimeout(timer);
    }, [withdrawAmountValid, withdrawUsdNumber]);

    useEffect(() => {
        if (!activeWithdrawalId) return;
        const terminal = new Set(['completed', 'b2c_failed']);
        const poll = async () => {
            try {
                const res = await fetch(`${API_BASE}/v1/withdrawals/${activeWithdrawalId}`, {
                    headers: paApiHeaders(),
                });
                const data = await res.json();
                if (!data.ok || !data.withdrawal) return;
                const row = data.withdrawal as {
                    status: string;
                    amount_kes?: number;
                    mpesa_receipt?: string | null;
                    error_message?: string | null;
                };
                setWithdrawStatus(row.status);
                if (!terminal.has(row.status)) return;

                setActiveWithdrawalId(null);
                setPendingPaPayout(null);
                if (row.status === 'completed') {
                    setWithdrawMessage(
                        `M-Pesa sent${row.amount_kes ? ` · KES ${Number(row.amount_kes).toLocaleString()}` : ''}${
                            row.mpesa_receipt ? ` · receipt ${row.mpesa_receipt}` : ''
                        }.`
                    );
                    setWithdrawError(null);
                    setPaymentModalKind('withdraw');
                    setPaymentModalPhase('success');
                    setPaymentModalMessage(
                        row.mpesa_receipt ? `Receipt ${row.mpesa_receipt}` : 'M-Pesa payout completed.'
                    );
                    setPaymentModalError(null);
                    setPaymentModalOpen(true);
                } else {
                    setWithdrawError(row.error_message || 'M-Pesa payout failed. Contact support if funds left Deriv.');
                    setWithdrawMessage(null);
                    setPaymentModalKind('withdraw');
                    setPaymentModalPhase('error');
                    setPaymentModalError(
                        row.error_message || 'M-Pesa payout failed. Contact support if funds left Deriv.'
                    );
                    setPaymentModalOpen(true);
                }
            } catch {
                // retry
            }
        };
        poll();
        const id = window.setInterval(poll, 4000);
        return () => window.clearInterval(id);
    }, [activeWithdrawalId]);

    const checkDepositsAvailability = useCallback(async (): Promise<boolean> => {
        setDepositsStatusBusy(true);
        try {
            const res = await fetch(`${API_BASE}/v1/deposits/payment-agent-status`);
            const data = (await res.json()) as {
                ok?: boolean;
                depositsAvailable?: boolean;
                withdrawalsAvailable?: boolean;
                paymentsMaintenance?: boolean;
                message?: string | null;
            };
            if (!data.ok) {
                return true;
            }
            const depositsOk = data.depositsAvailable !== false;
            const withdrawalsOk = data.withdrawalsAvailable !== false && data.paymentsMaintenance !== true;
            const message = data.message?.trim() || (depositsOk && withdrawalsOk ? null : PAYMENTS_MAINTENANCE_MESSAGE);
            setDepositsAvailable(depositsOk);
            setWithdrawalsAvailable(withdrawalsOk);
            if (message) setPaymentsUnavailableMessage(message);
            if (!depositsOk) {
                setDepositError(message ?? PAYMENTS_MAINTENANCE_MESSAGE);
            } else {
                setDepositError(prev =>
                    prev === PAYMENTS_MAINTENANCE_MESSAGE || prev === DEPOSITS_UNAVAILABLE_MESSAGE ? null : prev
                );
            }
            if (!withdrawalsOk) {
                setWithdrawError(message ?? PAYMENTS_MAINTENANCE_MESSAGE);
            } else {
                setWithdrawError(prev =>
                    prev === PAYMENTS_MAINTENANCE_MESSAGE || prev === DEPOSITS_UNAVAILABLE_MESSAGE ? null : prev
                );
            }
            return depositsOk;
        } catch {
            return true;
        } finally {
            setDepositsStatusBusy(false);
        }
    }, []);

    useEffect(() => {
        if (!showDepositView && !showWithdrawView) return;
        void checkDepositsAvailability();
    }, [showDepositView, showWithdrawView, checkDepositsAvailability]);

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
                const res = await fetch(`${API_BASE}/v1/deposits/history?${query}`, {
                    headers: paApiHeaders(),
                });
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

    const loadWithdrawHistoryForProfile = useCallback(async (profileEmail: string) => {
        const mail = profileEmail.trim();
        if (!mail) return;
        try {
            const res = await fetch(`${API_BASE}/v1/withdrawals/history?email=${encodeURIComponent(mail)}`, {
                headers: paApiHeaders(),
            });
            const data = await res.json();
            if (data.ok) {
                const rows = (data.withdrawals ?? []) as WithdrawalRecord[];
                setWithdrawHistory(rows.filter(row => row.status === 'completed'));
            }
        } catch {
            // non-fatal
        }
    }, []);

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

    const toggleWithdrawHistory = async () => {
        if (withdrawHistoryOpen) {
            setWithdrawHistoryOpen(false);
            return;
        }
        if (!email.trim()) {
            return;
        }
        setWithdrawHistoryBusy(true);
        try {
            await loadWithdrawHistoryForProfile(email.trim());
            setWithdrawHistoryOpen(true);
        } finally {
            setWithdrawHistoryBusy(false);
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
        // Saved profile CR always wins; session never overwrites DB funding login ID.
        const sessionCr =
            hints.fundingLoginid || getRememberedFundingLoginidForOptions(hints.optionsLoginid || optionsLoginid);
        if (!savedProfile?.funding_loginid && sessionCr) {
            setFundingLoginid(sessionCr);
            applied.fundingLoginid = true;
            rememberOptionsFundingLink(hints.optionsLoginid || optionsLoginid, sessionCr);
        }
        if (hints.derivNickname) {
            // Live Deriv nickname always wins — nicknames can change anytime.
            if (!savedProfile?.deriv_nickname || hints.derivNickname !== savedProfile.deriv_nickname) {
                setDerivNickname(hints.derivNickname);
                applied.derivNickname = true;
                try {
                    localStorage.setItem(DERIV_ACCOUNT_NICKNAME_KEY, hints.derivNickname);
                } catch {
                    /* ignore */
                }
            }
        }

        return applied;
    };

    const hasAutofilledIds = Boolean(
        autofillSource.derivNickname || autofillSource.optionsLoginid || autofillSource.fundingLoginid
    );

    const applyPendingPageView = (hasMpesa: boolean) => {
        const pending = readPendingDepositPageView();
        if (pending === 'withdraw') {
            if (hasMpesa) {
                setPageView('withdraw');
            } else {
                setPageView('profile');
                setProfileError('Add your M-Pesa phone number to complete your profile, then try withdraw again.');
            }
            return;
        }
        if (pending === 'transfer') {
            setPageView('transfer');
            return;
        }
        if (pending === 'profile') {
            setPageView('profile');
            return;
        }
        setPageView('deposit');
    };

    const applyProfileToForm = useCallback((p: Profile) => {
        setEmail(p.email);
        setFundingLoginid(p.funding_loginid || '');
        if (p.options_loginid) {
            setOptionsLoginid(p.options_loginid);
        }
        if (p.deriv_nickname) {
            setDerivNickname(p.deriv_nickname);
        }
        if (p.options_loginid && p.funding_loginid) {
            rememberOptionsFundingLink(p.options_loginid, p.funding_loginid);
        }
        if (p.mpesa_phone) {
            setMpesaPhone(formatMpesaPhoneForDisplay(p.mpesa_phone));
            setMpesaPhoneLocked(true);
        } else {
            setMpesaPhoneLocked(false);
        }
        setProfileSaved(true);
        applyPendingPageView(Boolean(p.mpesa_phone?.trim()));
        setHistoryOpen(false);
        setHistory([]);
        setWithdrawHistoryOpen(false);
        setWithdrawHistory([]);
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

    const loadProfileByLoginid = useCallback(async (loginid: string): Promise<Profile | null> => {
        const id = loginid.trim();
        if (!id || !getDerivOAuthAccessToken()) return null;
        try {
            const res = await fetch(`${API_BASE}/v1/profile/by-loginid/${encodeURIComponent(id)}`, {
                headers: paApiHeaders(),
            });
            if (res.status === 401 || res.status === 403 || res.status === 404) return null;
            if (!res.ok) return null;
            const data = await res.json();
            if (!data.ok || !data.profile) return null;
            return data.profile as Profile;
        } catch {
            return null;
        }
    }, []);

    const loadProfileByEmail = useCallback(async (profileEmail: string): Promise<Profile | null> => {
        const mail = profileEmail.trim().toLowerCase();
        if (!mail || !getDerivOAuthAccessToken()) return null;
        try {
            const res = await fetch(`${API_BASE}/v1/profile/${encodeURIComponent(mail)}`, {
                headers: paApiHeaders(),
            });
            if (res.status === 401 || res.status === 403 || res.status === 404) return null;
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
        let markReady = true;

        try {
            const hints = await refreshWithdrawalFormAutofill(activeLoginid || undefined);
            // Prefer ROT/options first: session CR autofill can be a wrong legacy pair
            // while deposit_profiles already has the real funding CR (e.g. CR00054194).
            const lookupCandidates = [hints.optionsLoginid, hints.fundingLoginid, profileLookupLoginid, activeLoginid]
                .map(id => String(id ?? '').trim())
                .filter(Boolean)
                .filter((id, index, all) => all.findIndex(x => x.toUpperCase() === id.toUpperCase()) === index);

            const hydrateKey = lookupCandidates.join('|') || activeLoginid || null;
            if (hydrateKey && hydratedForLoginidRef.current === hydrateKey) {
                return;
            }

            if (!getDerivOAuthAccessToken()) {
                // Autofill fields only; wait for OAuth before claiming "no profile".
                const applied = mergeSessionHints(hints, null);
                if (Object.keys(applied).length) {
                    setAutofillSource(applied);
                }
                const accountEmail = client?.account_settings?.email?.trim();
                if (accountEmail) {
                    setEmail(accountEmail);
                }
                // Keep the loader while OAuth token may still arrive after login redirect.
                if (!oauthReady) {
                    markReady = false;
                }
                return;
            }

            let savedProfile: Profile | null = null;
            for (const candidate of lookupCandidates) {
                savedProfile = await loadProfileByLoginid(candidate);
                if (savedProfile) break;
            }

            if (!savedProfile) {
                const accountEmail = client?.account_settings?.email?.trim();
                if (accountEmail) {
                    savedProfile = await loadProfileByEmail(accountEmail);
                }
            }

            if (savedProfile) {
                applyProfileToForm(savedProfile);
                const applied = mergeSessionHints(hints, savedProfile);
                if (Object.keys(applied).length) {
                    setAutofillSource(applied);
                }
                setProfileMessage('Welcome back — your deposit profile is ready.');
                hydratedForLoginidRef.current = hydrateKey;
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
            hydratedForLoginidRef.current = hydrateKey;
        } catch {
            // non-fatal
        } finally {
            if (markReady) {
                setIsHydrating(false);
            }
        }
    }, [
        applyProfileToForm,
        client?.account_settings?.email,
        client?.loginid,
        loadProfileByEmail,
        loadProfileByLoginid,
        oauthReady,
    ]);

    useEffect(() => {
        hydrateFromSession();
    }, [hydrateFromSession]);

    useEffect(() => {
        const onDepositPageView = (event: Event) => {
            const view = (event as CustomEvent<{ view?: DepositPageView }>).detail?.view;
            if (!view) return;
            if (!profileSaved) {
                try {
                    sessionStorage.setItem(QUICK_ACCESS_SESSION.depositPageView, view);
                } catch {
                    /* ignore */
                }
                return;
            }
            if (view === 'withdraw') {
                openWithdraw();
            } else if (view === 'transfer') {
                openTransfer();
            } else if (view === 'deposit') {
                openDeposit();
            } else {
                openProfile();
            }
        };
        window.addEventListener(QUICK_ACCESS_EVENTS.depositPageView, onDepositPageView);
        return () => window.removeEventListener(QUICK_ACCESS_EVENTS.depositPageView, onDepositPageView);
    }, [profileSaved]);

    // Guests / stuck OAuth waits: never leave the loader up indefinitely.
    useEffect(() => {
        if (!isHydrating) return;
        const timer = window.setTimeout(() => setIsHydrating(false), 5000);
        return () => window.clearTimeout(timer);
    }, [isHydrating]);

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
                const res = await fetch(`${API_BASE}/v1/deposits/${activeDepositId}`, {
                    headers: paApiHeaders(),
                });
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
                        setDepositMessage(
                            dep.deriv_transaction_id
                                ? `Deposit complete. Deriv txn: ${dep.deriv_transaction_id}`
                                : `Deposit complete — $${Number(dep.amount_usd).toFixed(2)}.`
                        );
                        setDepositError(null);
                        setPaymentModalKind('deposit');
                        setPaymentModalPhase('success');
                        setPaymentModalMessage(
                            dep.deriv_transaction_id
                                ? `Deriv txn: ${dep.deriv_transaction_id}`
                                : 'Deposit successful. Your Options balance has been updated.'
                        );
                        setPaymentModalError(null);
                        setPaymentModalOpen(true);
                    } else if (dep.status === 'pa_failed') {
                        setDepositError('Payment could not be completed. Please contact support.');
                        setDepositMessage(null);
                        setPaymentModalKind('deposit');
                        setPaymentModalPhase('error');
                        setPaymentModalError('Payment could not be completed. Please contact support.');
                        setPaymentModalOpen(true);
                    } else {
                        setDepositError('M-Pesa payment was not completed.');
                        setDepositMessage(null);
                        setPaymentModalKind('deposit');
                        setPaymentModalPhase('error');
                        setPaymentModalError('M-Pesa payment was not completed.');
                        setPaymentModalOpen(true);
                    }
                } else if (dep.status === 'stk_sent') {
                    setPaymentModalPhase('awaiting_pin');
                    setPaymentModalMessage(STATUS_LABELS.stk_sent);
                } else if (dep.status === 'mpesa_success' || dep.status === 'pa_pending') {
                    setPaymentModalPhase('processing');
                    setPaymentModalMessage(STATUS_LABELS[dep.status] ?? dep.status);
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
        if (!derivNickname.trim()) {
            setProfileError('Deriv nickname is missing. Sign out and sign in again so we can load it.');
            return;
        }
        if (!optionsLoginid.trim()) {
            setProfileError('Options login ID is missing. Sign in with Deriv again.');
            return;
        }
        if (!mpesaPhone.trim()) {
            setProfileError('Enter your M-Pesa phone number.');
            return;
        }
        if (!getDerivOAuthAccessToken()) {
            setProfileError('Sign in with Deriv to continue.');
            return;
        }
        setProfileBusy(true);
        try {
            const res = await fetch(`${API_BASE}/v1/profile`, {
                method: 'POST',
                headers: paApiHeaders(),
                body: JSON.stringify({
                    email: email.trim(),
                    options_loginid: optionsLoginid.trim() || undefined,
                    deriv_nickname: derivNickname.trim(),
                    mpesa_phone: mpesaPhone.trim(),
                    ...(fundingLoginid.trim() ? { funding_loginid: fundingLoginid.trim() } : {}),
                }),
            });
            const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
            if (!res.ok || !data.ok) throw new Error(sanitizePaApiError(data.error));
            if (fundingLoginid.trim()) {
                rememberOptionsFundingLink(optionsLoginid.trim(), fundingLoginid.trim());
            }
            setProfileSaved(true);
            setMpesaPhoneLocked(true);
            setProfileMessage('Profile saved. You can pay with M-Pesa below.');
            setPageView('deposit');
            hydratedForLoginidRef.current = null;
            setHistoryOpen(false);
            setHistory([]);
        } catch (err) {
            setProfileError(formatPaApiFetchError(err));
        } finally {
            setProfileBusy(false);
        }
    };

    const startDeposit = async () => {
        setDepositError(null);
        setDepositMessage(null);
        setPaymentModalError(null);
        setPaymentModalMessage(null);

        const available = await checkDepositsAvailability();
        if (!available) {
            return;
        }

        if (!profileSaved && (!email.trim() || !derivNickname.trim())) {
            setDepositError('Save your profile first (email and Deriv nickname).');
            openProfile();
            return;
        }
        if (!email.trim() || !derivNickname.trim()) {
            setDepositError('Your profile is missing email or Deriv nickname. Save your profile again.');
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

        setPaymentModalKind('deposit');
        setPaymentModalPhase('submitting');
        setPaymentModalAmountUsd(usdNumber);
        setPaymentModalAmountKes(amountKes);
        setPaymentModalOpen(true);
        setDepositBusy(true);
        try {
            // Always refresh nickname from Deriv before deposit — saved value can be stale.
            const liveNick = await fetchDerivAccountNickname();
            if (liveNick) {
                setDerivNickname(liveNick);
                if (profileSaved && liveNick !== derivNickname.trim() && email.trim() && mpesaPhone.trim()) {
                    try {
                        await fetch(`${API_BASE}/v1/profile`, {
                            method: 'POST',
                            headers: paApiHeaders(),
                            body: JSON.stringify({
                                email: email.trim(),
                                funding_loginid: fundingLoginid.trim() || undefined,
                                options_loginid: optionsLoginid.trim() || undefined,
                                deriv_nickname: liveNick,
                                mpesa_phone: mpesaPhone.trim(),
                            }),
                        });
                    } catch {
                        /* backend also refreshes on deposit start / PA credit */
                    }
                }
            }
            const affiliateCode = getSiteAffiliateCode();
            const res = await fetch(`${API_BASE}/v1/deposits`, {
                method: 'POST',
                headers: paApiHeaders(),
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
                    setPaymentModalPhase('error');
                    setPaymentModalError(DEPOSITS_UNAVAILABLE_MESSAGE);
                    return;
                }
                throw new Error(errMsg);
            }
            setActiveDepositId(data.deposit.id);
            setActiveStatus(data.deposit.status);
            setDepositMessage('M-Pesa prompt sent. Enter your PIN on your phone.');
            setPaymentModalPhase(data.deposit.status === 'stk_sent' ? 'awaiting_pin' : 'processing');
            setPaymentModalMessage('M-Pesa prompt sent. Enter your PIN on your phone.');
        } catch (err) {
            const msg = formatPaApiFetchError(err);
            setDepositError(msg);
            setPaymentModalPhase('error');
            setPaymentModalError(msg);
        } finally {
            setDepositBusy(false);
        }
    };

    const requestWithdrawOtp = async () => {
        setWithdrawError(null);
        setWithdrawMessage(null);
        setWithdrawStatus(null);

        if (!getDerivOAuthAccessToken()) {
            setWithdrawError('Log in with Deriv first (Payments permission required).');
            return;
        }
        if (!mpesaPhone.trim()) {
            setWithdrawError('Complete your profile with an M-Pesa phone number before withdrawing.');
            openProfile();
            setProfileError('Add your M-Pesa phone number to complete your profile, then try withdraw again.');
            return;
        }
        if (!withdrawAmountValid) {
            setWithdrawError(`Enter an amount of at least $${MIN_WITHDRAW_USD}.`);
            return;
        }
        if (!withdrawWithinMaxKes) {
            setWithdrawError(`Maximum withdrawal is KES ${MAX_WITHDRAW_KES.toLocaleString()}.`);
            return;
        }

        setWithdrawBusy(true);
        try {
            const availableUsd = await loadTransferBalances();
            if (availableUsd == null) {
                setWithdrawError('Could not verify USD wallet balance. Refresh balances and try again.');
                return;
            }
            if (withdrawUsdNumber > availableUsd + 0.0001) {
                setWithdrawError(`Amount exceeds USD wallet balance ($${availableUsd.toFixed(2)} available).`);
                return;
            }

            const permission = await checkPaClientWithdrawEnabled();
            if (!permission.ok) {
                throw new Error(permission.message ?? 'Could not verify payment permissions.');
            }
            if (!permission.withdrawEnabled) {
                throw new Error(permission.message ?? 'Withdrawals are disabled on your Deriv account.');
            }

            await requestPaWithdrawVerificationCode({
                amountUsd: withdrawUsdNumber,
                agentId: getPaymentAgentAgentId(),
            });
            setWithdrawOtpSent(true);
            setWithdrawOtp('');
            setWithdrawMessage('Verification code sent to your Deriv email/phone. Enter it below.');
        } catch (err) {
            setWithdrawError(err instanceof Error ? err.message : 'Could not send verification code.');
            setWithdrawOtpSent(false);
        } finally {
            setWithdrawBusy(false);
        }
    };

    const startMpesaPayout = async (pa: { transactionId: number | null; requestId?: string; amountUsd: number }) => {
        if (!email.trim()) {
            throw new Error('Profile email missing — cannot start M-Pesa payout.');
        }
        if (!mpesaPhone.trim()) {
            throw new Error('Complete your profile with an M-Pesa phone number before withdrawing.');
        }

        setWithdrawMessage('Deriv transfer done. Starting M-Pesa…');
        setPaymentModalKind('withdraw');
        setPaymentModalPhase('processing');
        setPaymentModalMessage('Sending M-Pesa payout…');
        setPaymentModalError(null);
        setPaymentModalAmountUsd(pa.amountUsd);
        setPaymentModalAmountKes(withdrawKes);
        setPaymentModalOpen(true);
        const payoutRes = await fetch(`${API_BASE}/v1/withdrawals`, {
            method: 'POST',
            headers: paApiHeaders(),
            body: JSON.stringify({
                email: email.trim(),
                amount_usd: pa.amountUsd,
                deriv_transaction_id: pa.transactionId,
                deriv_request_id: pa.requestId,
                ...(getSiteAffiliateCode() ? { referrer_affiliate_code: getSiteAffiliateCode() } : {}),
            }),
        });
        const payoutData = (await payoutRes.json().catch(() => ({}))) as {
            ok?: boolean;
            error?: string;
            withdrawal?: { id: string; status: string; amount_kes?: number };
        };
        if (!payoutRes.ok || !payoutData.ok || !payoutData.withdrawal) {
            throw new Error(sanitizePaApiError(payoutData.error) || 'M-Pesa payout could not be started.');
        }

        setPendingPaPayout(null);
        setActiveWithdrawalId(payoutData.withdrawal.id);
        setWithdrawStatus(payoutData.withdrawal.status);
        setWithdrawError(null);
        if (payoutData.withdrawal.status === 'completed') {
            setPaymentModalPhase('success');
            setPaymentModalMessage(
                payoutData.withdrawal.amount_kes
                    ? `KES ${Number(payoutData.withdrawal.amount_kes).toLocaleString()} sent.`
                    : 'M-Pesa payout completed.'
            );
        } else {
            setPaymentModalPhase('processing');
            setPaymentModalMessage('M-Pesa payout in progress…');
        }
        setWithdrawMessage(
            payoutData.withdrawal.status === 'completed'
                ? `M-Pesa sent${
                      payoutData.withdrawal.amount_kes
                          ? ` · KES ${Number(payoutData.withdrawal.amount_kes).toLocaleString()}`
                          : ''
                  }.`
                : `M-Pesa payout in progress${
                      payoutData.withdrawal.amount_kes
                          ? ` · KES ${Number(payoutData.withdrawal.amount_kes).toLocaleString()}`
                          : ''
                  }. Keep this page open.`
        );
    };

    const retryMpesaPayout = async () => {
        if (!pendingPaPayout || withdrawBusy) return;
        setWithdrawBusy(true);
        setWithdrawError(null);
        try {
            await startMpesaPayout(pendingPaPayout);
        } catch (err) {
            setWithdrawError(
                `${formatPaApiFetchError(err)} Funds already left your Deriv wallet — tap Retry M-Pesa (do not withdraw again).`
            );
        } finally {
            setWithdrawBusy(false);
        }
    };

    const confirmWithdraw = async () => {
        setWithdrawError(null);
        setWithdrawMessage(null);
        setPaymentModalError(null);
        setPaymentModalMessage(null);

        if (!withdrawAmountValid) {
            setWithdrawError(`Enter an amount of at least $${MIN_WITHDRAW_USD}.`);
            return;
        }
        if (!withdrawWithinMaxKes) {
            setWithdrawError(`Maximum withdrawal is KES ${MAX_WITHDRAW_KES.toLocaleString()}.`);
            return;
        }
        if (!/^\d{6}$/.test(withdrawOtp.trim())) {
            setWithdrawError('Enter the 6-digit verification code.');
            return;
        }
        if (withdrawPayoutLockRef.current || withdrawBusy) {
            return;
        }

        withdrawPayoutLockRef.current = true;
        setWithdrawBusy(true);
        setPaymentModalKind('withdraw');
        setPaymentModalPhase('submitting');
        setPaymentModalAmountUsd(withdrawUsdNumber);
        setPaymentModalAmountKes(withdrawKes);
        setPaymentModalOpen(true);
        let paSucceeded = false;
        try {
            const availableUsd = await loadTransferBalances();
            if (availableUsd == null) {
                const msg = 'Could not verify USD wallet balance. Refresh balances and try again.';
                setWithdrawError(msg);
                setPaymentModalPhase('error');
                setPaymentModalError(msg);
                return;
            }
            if (withdrawUsdNumber > availableUsd + 0.0001) {
                const msg = `Amount exceeds USD wallet balance ($${availableUsd.toFixed(2)} available).`;
                setWithdrawError(msg);
                setPaymentModalPhase('error');
                setPaymentModalError(msg);
                return;
            }

            const result = await submitPaWithdraw({
                amountUsd: withdrawUsdNumber,
                verificationCode: withdrawOtp.trim(),
                agentId: getPaymentAgentAgentId(),
            });
            paSucceeded = true;
            const pa = {
                transactionId: result.transactionId,
                requestId: result.requestId,
                amountUsd: withdrawUsdNumber,
            };
            setPendingPaPayout(pa);
            setWithdrawStatus(result.status);
            setWithdrawOtp('');
            setWithdrawOtpSent(false);
            setPaymentModalPhase('awaiting_pin');
            setPaymentModalMessage('Deriv transfer accepted. Starting M-Pesa…');

            if (result.status !== 'complete' && result.status !== 'requested' && result.status !== 'pending') {
                setWithdrawMessage(`Withdrawal ${result.status}. Waiting before M-Pesa payout.`);
                setPaymentModalPhase('processing');
                setPaymentModalMessage(`Withdrawal ${result.status}. Waiting before M-Pesa payout.`);
                return;
            }

            if (!email.trim()) {
                setWithdrawError('Profile email missing — cannot start M-Pesa payout.');
                setPaymentModalPhase('error');
                setPaymentModalError('Profile email missing — cannot start M-Pesa payout.');
                return;
            }
            if (!mpesaPhone.trim()) {
                setWithdrawError('Complete your profile with an M-Pesa phone number before withdrawing.');
                openProfile();
                setProfileError('Add your M-Pesa phone number to complete your profile, then try withdraw again.');
                setPaymentModalPhase('error');
                setPaymentModalError('Complete your profile with an M-Pesa phone number before withdrawing.');
                return;
            }

            await startMpesaPayout(pa);
        } catch (err) {
            if (paSucceeded) {
                const msg = `${formatPaApiFetchError(err)} Funds already left your Deriv wallet — tap Retry M-Pesa (do not withdraw again).`;
                setWithdrawError(msg);
                setPaymentModalPhase('error');
                setPaymentModalError(msg);
            } else {
                const msg = formatPaApiFetchError(err);
                setWithdrawError(msg);
                setPaymentModalPhase('error');
                setPaymentModalError(msg);
            }
        } finally {
            withdrawPayoutLockRef.current = false;
            setWithdrawBusy(false);
        }
    };

    // Logged out (no Deriv session and no OAuth token): show a login prompt only — no signup form.
    if (!isLoggedIn && !oauthReady) {
        return (
            <div className='withdrawal-page'>
                <div className='withdrawal-page__main withdrawal-page__main--signup'>
                    <section className='withdrawal-card withdrawal-card--profile withdrawal-card--login'>
                        <div className='withdrawal-card__heading'>
                            <span className='withdrawal-card__section-icon' aria-hidden='true'>
                                <ProfileSectionIcon />
                            </span>
                            <div>
                                <h2>Log in to deposit / withdraw</h2>
                                <p className='withdrawal-card__subtitle'>
                                    Log in with your Deriv account to access M-Pesa deposits and withdrawals.
                                </p>
                            </div>
                        </div>
                        <button
                            type='button'
                            className='withdrawal-btn withdrawal-btn--accent'
                            onClick={() => {
                                requestDerivOAuthAuthentication();
                            }}
                        >
                            Log in with Deriv
                        </button>
                    </section>
                </div>
            </div>
        );
    }

    if (isHydrating) {
        return (
            <div className='withdrawal-page'>
                <div className='withdrawal-page__boot-loader' role='status' aria-live='polite'>
                    <div className='withdrawal-page__boot-spinner' aria-hidden='true' />
                    <p>Loading your deposit profile…</p>
                </div>
            </div>
        );
    }

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
                        className={`withdrawal-page__tab${showTransferView ? ' withdrawal-page__tab--active' : ''}`}
                        onClick={openTransfer}
                    >
                        <TransferSectionIcon />
                        Transfer
                    </button>
                    <button
                        type='button'
                        className={`withdrawal-page__tab${showWithdrawView ? ' withdrawal-page__tab--active' : ''}`}
                        onClick={openWithdraw}
                    >
                        <WithdrawSectionIcon />
                        Withdraw
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
                    showDepositView || showTransferView || showWithdrawView
                        ? ' withdrawal-page__main--deposit-only'
                        : ''
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
                                Fields marked <AutofillBadge /> were filled from your Deriv session.
                            </p>
                        )}

                        <label>
                            Email
                            <input
                                type='email'
                                name='denara-deposit-email'
                                value={email}
                                autoComplete='email'
                                onChange={e => {
                                    const next = e.target.value;
                                    setEmail(next);
                                    // Browser email suggestions often also fill "username" fields.
                                    setOptionsLoginid(prev => (prev.includes('@') ? '' : prev));
                                }}
                            />
                        </label>

                        <label className='withdrawal-field'>
                            <span className='withdrawal-field__label'>
                                Deriv nickname
                                {autofillSource.derivNickname && <AutofillBadge />}
                            </span>
                            <input
                                type='text'
                                name='denara-deriv-nickname'
                                value={derivNickname.trim() ? maskDerivNicknameForDisplay(derivNickname) : ''}
                                readOnly
                                autoComplete='off'
                                data-lpignore='true'
                                data-1p-ignore='true'
                                spellCheck={false}
                                placeholder='Loading from Deriv…'
                            />
                            {!derivNickname.trim() ? (
                                <span className='withdrawal-field__help'>
                                    Sign in with Deriv so we can load your nickname for deposits.
                                </span>
                            ) : (
                                <span className='withdrawal-field__help'>
                                    Shown masked for privacy. Full nickname is used to credit your wallet after M-Pesa.
                                </span>
                            )}
                        </label>

                        <label className='withdrawal-field'>
                            <span className='withdrawal-field__label'>
                                Options login ID
                                {autofillSource.optionsLoginid && <AutofillBadge />}
                            </span>
                            <input
                                type='text'
                                name='denara-options-rot'
                                value={
                                    showMaskedOptionsLoginid
                                        ? maskDerivLoginidForDisplay(optionsLoginid)
                                        : optionsLoginid
                                }
                                autoComplete='off'
                                data-lpignore='true'
                                data-1p-ignore='true'
                                spellCheck={false}
                                onFocus={() => setOptionsLoginidFocused(true)}
                                onBlur={() => setOptionsLoginidFocused(false)}
                                onChange={e => {
                                    const next = e.target.value.replace(/\s+/g, '');
                                    if (next.includes('@')) return;
                                    setOptionsLoginid(next);
                                    setAutofillSource(prev => ({ ...prev, optionsLoginid: false }));
                                }}
                                placeholder='ROT***42'
                            />
                        </label>

                        <label className='withdrawal-field'>
                            <span className='withdrawal-field__label'>M-Pesa phone</span>
                            <div
                                className={`withdrawal-phone-input${
                                    mpesaPhoneLocked ? ' withdrawal-phone-input--readonly' : ''
                                }`}
                            >
                                <span className='withdrawal-phone-input__icon' aria-hidden='true'>
                                    <PhoneIcon />
                                </span>
                                <input
                                    type='tel'
                                    value={mpesaPhoneLocked ? maskMpesaPhoneForDisplay(mpesaPhone) : mpesaPhone}
                                    onChange={e => {
                                        if (mpesaPhoneLocked) return;
                                        setMpesaPhone(e.target.value);
                                    }}
                                    readOnly={mpesaPhoneLocked}
                                    placeholder='07XX or 01XX XXX XXX'
                                    autoComplete='tel'
                                />
                            </div>
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
                                aria-label={`Profile: ${profileChipLabel}`}
                            >
                                <ProfileSectionIcon />
                                <span>{profileChipLabel}</span>
                            </button>
                        </div>

                        {!depositsStatusBusy && !depositsAvailable && (
                            <div className='withdrawal-page__alert withdrawal-page__alert--unavailable' role='status'>
                                {paymentsUnavailableMessage}
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

                        <label className='withdrawal-field'>
                            <span className='withdrawal-field__label'>M-Pesa phone</span>
                            <div
                                className={`withdrawal-phone-input${
                                    mpesaPhoneLocked ? ' withdrawal-phone-input--readonly' : ''
                                }`}
                            >
                                <span className='withdrawal-phone-input__icon' aria-hidden='true'>
                                    <PhoneIcon />
                                </span>
                                <input
                                    type='tel'
                                    value={mpesaPhoneLocked ? maskMpesaPhoneForDisplay(mpesaPhone) : mpesaPhone}
                                    onChange={e => {
                                        if (mpesaPhoneLocked) return;
                                        setMpesaPhone(e.target.value);
                                    }}
                                    readOnly={mpesaPhoneLocked}
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

                        {(depositMessage || depositError || activeStatus) && (
                            <div className='withdrawal-payment-status'>
                                {depositMessage && (
                                    <div className='withdrawal-page__alert withdrawal-page__alert--info'>
                                        {depositMessage}
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

                {showTransferView && (
                    <section className='withdrawal-card withdrawal-card--deposit'>
                        <div className='withdrawal-card__title-row withdrawal-card__title-row--deposit'>
                            <div className='withdrawal-card__heading'>
                                <span
                                    className='withdrawal-card__section-icon withdrawal-card__section-icon--deposit'
                                    aria-hidden='true'
                                >
                                    <TransferSectionIcon />
                                </span>
                                <div>
                                    <h2>Transfer funds</h2>
                                    <p className='withdrawal-card__subtitle'>
                                        Move funds from Options to your USD wallet on Deriv. Withdrawals use the USD
                                        wallet.
                                    </p>
                                </div>
                            </div>
                            <button
                                type='button'
                                className='withdrawal-profile-chip'
                                onClick={openProfile}
                                title='View or update your profile'
                                aria-label={`Profile: ${profileChipLabel}`}
                            >
                                <ProfileSectionIcon />
                                <span>{profileChipLabel}</span>
                            </button>
                        </div>

                        {!getDerivOAuthAccessToken() && (
                            <div className='withdrawal-page__alert withdrawal-page__alert--error' role='status'>
                                Log in with Deriv first to see balances and open Deriv transfer.
                            </div>
                        )}

                        <div className='withdrawal-transfer-panel'>
                            <div className='withdrawal-transfer-panel__head'>
                                <h3>Account balances</h3>
                                <button
                                    type='button'
                                    className='withdrawal-btn withdrawal-btn--ghost'
                                    disabled={balancesBusy}
                                    onClick={() => void loadTransferBalances()}
                                >
                                    {balancesBusy ? 'Refreshing…' : 'Refresh balances'}
                                </button>
                            </div>

                            {transferAccounts.length > 0 ? (
                                <ul className='withdrawal-transfer-panel__balances'>
                                    {transferAccounts.map(row => (
                                        <li key={row.loginid}>
                                            <span>{row.label}</span>
                                            <strong>
                                                {row.currency} {row.balance.toFixed(2)}
                                            </strong>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className='withdrawal-transfer-panel__hint'>
                                    {balancesBusy ? 'Loading balances…' : 'No balances yet.'}
                                </p>
                            )}

                            <div className='withdrawal-transfer-panel__actions'>
                                <a
                                    className='withdrawal-transfer-panel__cta'
                                    href={DERIV_ACCOUNT_TRANSFER_URL}
                                    target='_blank'
                                    rel='noopener noreferrer'
                                >
                                    Transfer
                                </a>
                            </div>

                            {transferError ? (
                                <div className='withdrawal-page__alert withdrawal-page__alert--error'>
                                    {transferError}
                                </div>
                            ) : null}
                        </div>
                    </section>
                )}

                {showWithdrawView && (
                    <section className='withdrawal-card withdrawal-card--deposit'>
                        <div className='withdrawal-card__title-row withdrawal-card__title-row--deposit'>
                            <div className='withdrawal-card__heading'>
                                <span
                                    className='withdrawal-card__section-icon withdrawal-card__section-icon--deposit'
                                    aria-hidden='true'
                                >
                                    <WithdrawSectionIcon />
                                </span>
                                <div>
                                    <h2>Withdraw to M-Pesa</h2>
                                    <p className='withdrawal-card__subtitle'>
                                        Deriv sends funds to our payment agent, then we pay out to your M-Pesa phone.
                                    </p>
                                </div>
                            </div>
                            <button
                                type='button'
                                className='withdrawal-profile-chip'
                                onClick={openProfile}
                                title='View or update your profile'
                                aria-label={`Profile: ${profileChipLabel}`}
                            >
                                <ProfileSectionIcon />
                                <span>{profileChipLabel}</span>
                            </button>
                        </div>

                        {!depositsStatusBusy && !withdrawalsAvailable && (
                            <div className='withdrawal-page__alert withdrawal-page__alert--unavailable' role='status'>
                                {paymentsUnavailableMessage}
                            </div>
                        )}

                        {!getDerivOAuthAccessToken() && (
                            <div className='withdrawal-page__alert withdrawal-page__alert--error' role='status'>
                                Log in with Deriv first. Your session needs Payments permission — log out and log in
                                again if withdraw fails with a scope error.
                            </div>
                        )}

                        <div className='withdrawal-transfer-panel'>
                            <div className='withdrawal-transfer-panel__head'>
                                <h3>Wallet balances</h3>
                                <button
                                    type='button'
                                    className='withdrawal-btn withdrawal-btn--ghost'
                                    disabled={balancesBusy}
                                    onClick={() => void loadTransferBalances()}
                                >
                                    {balancesBusy ? 'Refreshing…' : 'Refresh balances'}
                                </button>
                            </div>

                            {transferAccounts.length > 0 ? (
                                <ul className='withdrawal-transfer-panel__balances'>
                                    {transferAccounts.map(row => (
                                        <li key={row.loginid}>
                                            <span>{row.label}</span>
                                            <strong>
                                                {row.currency} {row.balance.toFixed(2)}
                                            </strong>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className='withdrawal-transfer-panel__hint'>
                                    {balancesBusy ? 'Loading balances…' : 'No balances yet.'}
                                </p>
                            )}

                            <div className='withdrawal-transfer-panel__actions'>
                                <a
                                    className='withdrawal-transfer-panel__cta'
                                    href={DERIV_ACCOUNT_TRANSFER_URL}
                                    target='_blank'
                                    rel='noopener noreferrer'
                                >
                                    Transfer
                                </a>
                            </div>
                        </div>

                        {withdrawQuote && (
                            <div className='withdrawal-rate'>
                                <span className='withdrawal-rate__label'>USD/KES payout rate</span>
                                <strong className='withdrawal-rate__value'>
                                    {Number(withdrawQuote.effectiveExchangeRate).toFixed(2)}
                                </strong>
                            </div>
                        )}

                        {hasProfileMpesaPhone ? (
                            <div className='withdrawal-field'>
                                <span className='withdrawal-field__label'>M-Pesa phone (from profile)</span>
                                <div className='withdrawal-phone-input withdrawal-phone-input--readonly'>
                                    <span className='withdrawal-phone-input__icon' aria-hidden='true'>
                                        <PhoneIcon />
                                    </span>
                                    <input type='tel' value={maskMpesaPhoneForDisplay(mpesaPhone)} readOnly />
                                </div>
                            </div>
                        ) : (
                            <div className='withdrawal-page__alert withdrawal-page__alert--error' role='status'>
                                Complete your profile with an M-Pesa phone number before withdrawing.{' '}
                                <button
                                    type='button'
                                    className='withdrawal-btn withdrawal-btn--text'
                                    onClick={openProfile}
                                >
                                    Complete profile
                                </button>
                            </div>
                        )}

                        <label>
                            Amount (USD)
                            <p className='withdrawal-deposit-limits'>
                                Min withdraw ${MIN_WITHDRAW_USD} · Max KES {MAX_WITHDRAW_KES.toLocaleString()} per
                                withdrawal
                            </p>
                            <div className='withdrawal-amount-input'>
                                <input
                                    type='number'
                                    min={MIN_WITHDRAW_USD}
                                    step='0.01'
                                    value={withdrawAmountUsd}
                                    onChange={e => {
                                        setWithdrawAmountUsd(e.target.value);
                                        setWithdrawOtpSent(false);
                                        setWithdrawOtp('');
                                    }}
                                    placeholder='Enter withdrawal amount'
                                />
                            </div>
                            <div
                                className='withdrawal-amount-suggestions'
                                role='group'
                                aria-label='Suggested withdrawal amounts'
                            >
                                {WITHDRAW_AMOUNT_SUGGESTIONS.map(value => (
                                    <button
                                        key={value}
                                        type='button'
                                        className={`withdrawal-amount-suggestions__chip${
                                            Number(withdrawAmountUsd) === value
                                                ? ' withdrawal-amount-suggestions__chip--active'
                                                : ''
                                        }`}
                                        onClick={() => {
                                            setWithdrawAmountUsd(String(value));
                                            setWithdrawOtpSent(false);
                                            setWithdrawOtp('');
                                        }}
                                    >
                                        ${value}
                                    </button>
                                ))}
                            </div>
                        </label>

                        {withdrawKes != null && (
                            <div className='withdrawal-kes-total'>
                                <span className='withdrawal-kes-total__label'>You receive via M-Pesa</span>
                                <strong className='withdrawal-kes-total__value'>
                                    KES {withdrawKes.toLocaleString()}
                                </strong>
                            </div>
                        )}
                        {!withdrawWithinMaxKes && withdrawKes != null && (
                            <div className='withdrawal-page__alert withdrawal-page__alert--error'>
                                Maximum withdrawal is KES {MAX_WITHDRAW_KES.toLocaleString()}.
                            </div>
                        )}
                        {!withdrawWithinUsdBalance && usdWalletBalance != null && withdrawAmountValid && (
                            <div className='withdrawal-page__alert withdrawal-page__alert--error' role='alert'>
                                Amount exceeds USD wallet balance (${usdWalletBalance.toFixed(2)} available).
                            </div>
                        )}

                        {withdrawOtpSent && (
                            <label>
                                Verification code
                                <input
                                    type='text'
                                    inputMode='numeric'
                                    autoComplete='one-time-code'
                                    maxLength={6}
                                    value={withdrawOtp}
                                    onChange={e => setWithdrawOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder='6-digit code'
                                />
                            </label>
                        )}

                        {!withdrawOtpSent ? (
                            <button
                                type='button'
                                className='withdrawal-btn withdrawal-btn--accent'
                                disabled={
                                    withdrawBusy ||
                                    !withdrawalsAvailable ||
                                    depositsStatusBusy ||
                                    !withdrawReady ||
                                    !hasProfileMpesaPhone ||
                                    !getDerivOAuthAccessToken()
                                }
                                onClick={requestWithdrawOtp}
                            >
                                {withdrawBusy ? 'Sending code…' : 'Send verification code'}
                            </button>
                        ) : (
                            <div className='withdrawal-page__withdraw-actions'>
                                <button
                                    type='button'
                                    className='withdrawal-btn withdrawal-btn--accent'
                                    disabled={
                                        withdrawBusy ||
                                        !withdrawalsAvailable ||
                                        depositsStatusBusy ||
                                        !withdrawReady ||
                                        !hasProfileMpesaPhone ||
                                        !/^\d{6}$/.test(withdrawOtp.trim())
                                    }
                                    onClick={confirmWithdraw}
                                >
                                    {withdrawBusy ? 'Withdrawing…' : 'Confirm withdrawal'}
                                </button>
                                <button
                                    type='button'
                                    className='withdrawal-btn withdrawal-btn--ghost'
                                    disabled={withdrawBusy}
                                    onClick={requestWithdrawOtp}
                                >
                                    Resend code
                                </button>
                            </div>
                        )}

                        {(withdrawMessage || withdrawError || withdrawStatus || pendingPaPayout) && (
                            <div className='withdrawal-payment-status'>
                                {withdrawMessage && (
                                    <div className='withdrawal-page__alert withdrawal-page__alert--info'>
                                        {withdrawMessage}
                                    </div>
                                )}
                                {withdrawError && (
                                    <div className='withdrawal-page__alert withdrawal-page__alert--error'>
                                        {withdrawError}
                                    </div>
                                )}
                                {withdrawStatus && (
                                    <div className='withdrawal-page__alert withdrawal-page__alert--info'>
                                        Status: {withdrawStatusLabel(withdrawStatus)}
                                    </div>
                                )}
                                {pendingPaPayout && !activeWithdrawalId ? (
                                    <button
                                        type='button'
                                        className='withdrawal-btn withdrawal-btn--accent'
                                        disabled={withdrawBusy}
                                        onClick={retryMpesaPayout}
                                    >
                                        {withdrawBusy ? 'Retrying M-Pesa…' : 'Retry M-Pesa payout'}
                                    </button>
                                ) : null}
                            </div>
                        )}

                        <div className='withdrawal-transactions'>
                            <button
                                type='button'
                                className='withdrawal-btn withdrawal-btn--ghost withdrawal-btn--history'
                                disabled={withdrawHistoryBusy}
                                onClick={toggleWithdrawHistory}
                            >
                                <HistoryIcon />
                                {withdrawHistoryBusy
                                    ? 'Loading…'
                                    : withdrawHistoryOpen
                                      ? 'Hide withdrawal history'
                                      : 'Withdrawal history'}
                            </button>

                            {withdrawHistoryOpen && (
                                <>
                                    <h3>
                                        Completed withdrawals
                                        {accountLoginid && (
                                            <span className='withdrawal-transactions__account'>{accountLoginid}</span>
                                        )}
                                    </h3>
                                    {withdrawHistory.length === 0 ? (
                                        <p className='withdrawal-transactions__empty'>
                                            No completed withdrawals yet for this account.
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
                                                    {withdrawHistory.map(row => (
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
                    <div className='withdrawal-page__support-panel' role='dialog' aria-label='Support'>
                        <div className='withdrawal-page__support-contacts'>
                            <a
                                className='withdrawal-page__support-link'
                                href={SUPPORT_WHATSAPP_URL}
                                target='_blank'
                                rel='noopener noreferrer'
                            >
                                <WhatsAppIcon />
                                <span>{SUPPORT_PHONE_DISPLAY}</span>
                            </a>
                            <a
                                className='withdrawal-page__support-link withdrawal-page__support-link--email'
                                href={SUPPORT_EMAIL_URL}
                            >
                                <span>{SUPPORT_EMAIL}</span>
                            </a>
                        </div>
                        <p className='withdrawal-page__support-footer'>{MPESA_PHONE_CHANGE_HELP}</p>
                    </div>
                )}
            </footer>

            <PaymentFlowModal
                open={paymentModalOpen}
                kind={paymentModalKind}
                phase={paymentModalPhase}
                amountUsd={paymentModalAmountUsd}
                amountKes={paymentModalAmountKes}
                message={paymentModalMessage}
                error={paymentModalError}
                onClose={closePaymentModal}
            />
        </div>
    );
};

export default Withdrawal;
