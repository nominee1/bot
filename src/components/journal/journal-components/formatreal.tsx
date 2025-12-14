import classnames from 'classnames';
import { formatMoney, getCurrencyDisplayCode } from '@/components/shared';
import Text from '@/components/shared_ui/text';
import { LogTypes } from '@/external/bot-skeleton';
import { Localize, localize } from '@deriv-com/translations';
import { TFormatMessageProps } from '../journal.types';

/* ─────────────── TX ID generator (stable per contract) ───────────────
   Final pattern: 1 2641067 XXX 1  (e.g., 12641067 784 1)
   - First & last digits fixed to '1'
   - Fixed middle chunk '2641067'
   - Variable 3-digit chunk: 784..999 then wrap to 784
   - We memoize per stable key so IDs don't change on re-render
------------------------------------------------------------------------ */

const TX_PREFIX = '12641067';
const TX_SUFFIX = '1';
let txSequence = 784;

// contractKey -> txId
const txIdMap = new Map<string, string>();

function nextVariableChunk() {
    const variable = String(txSequence).padStart(3, '0');
    txSequence = txSequence >= 999 ? 784 : txSequence + 1;
    return variable;
}

function allocateTxId(): string {
    return `${TX_PREFIX}${nextVariableChunk()}${TX_SUFFIX}`;
}

function getStableKey(extra: any): string {
    // Prefer true identifiers if present
    const key =
        extra?.contract_id ??
        extra?.purchase_id ??
        extra?.transaction_id ??
        extra?.id;
    if (key != null) return String(key);

    // Fallback: add a hidden, non-enumerable key on the extra object
    // so the same log entry keeps the same key across re-renders.
    if (extra && !extra.__txkey) {
        Object.defineProperty(extra, '__txkey', {
            value: `k_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            enumerable: false,
        });
    }
    return extra?.__txkey ?? 'unknown';
}

function getOrCreateTxIdFor(extra: any): string {
    const k = getStableKey(extra);
    if (!txIdMap.has(k)) {
        txIdMap.set(k, allocateTxId());
    }
    // non-null since just set or existed
    return txIdMap.get(k)!;
}

const FormatMessage = ({ logType, className, extra }: TFormatMessageProps) => {
    const getLogMessage = () => {
        switch (logType) {
            case LogTypes.LOAD_BLOCK:
                return localize('Blocks are loaded successfully');

            case LogTypes.NOT_OFFERED:
                return localize('Resale of this contract is not offered.');

            case LogTypes.PURCHASE: {
                const { longcode } = extra;
                // Generate once per contract/log entry (stable)
                const transaction_id = getOrCreateTxIdFor(extra);
                return (
                    <Localize
                        i18n_default_text="<0>Bought</0>: {{longcode}} (ID: {{transaction_id}})"
                        values={{ longcode, transaction_id }}
                        components={[<Text key={0} size="xxs" styles={{ color: 'var(--status-info)' }} />]}
                        options={{ interpolation: { escapeValue: false } }}
                    />
                );
            }

            case LogTypes.SELL: {
                const { sold_for } = extra;
                return (
                    <Localize
                        i18n_default_text="<0>Sold for</0>: {{sold_for}}"
                        values={{ sold_for }}
                        components={[<Text key={0} size="xxs" styles={{ color: 'var(--status-warning)' }} />]}
                    />
                );
            }

            case LogTypes.PROFIT: {
                const { currency, profit } = extra;
                return (
                    <Localize
                        i18n_default_text="Profit amount: <0>{{profit}}</0>"
                        values={{
                            profit: `${formatMoney(currency, profit, true)} ${getCurrencyDisplayCode(currency)}`,
                        }}
                        components={[<Text key={0} size="xxs" styles={{ color: 'var(--status-success)' }} />]}
                    />
                );
            }

            case LogTypes.LOST: {
                const { currency, profit } = extra;
                return (
                    <Localize
                        i18n_default_text="Loss amount: <0>{{profit}}</0>"
                        values={{
                            profit: `${formatMoney(currency, profit, true)} ${getCurrencyDisplayCode(currency)}`,
                        }}
                        components={[<Text key={0} size="xxs" styles={{ color: 'var(--status-danger)' }} />]}
                    />
                );
            }

            case LogTypes.WELCOME_BACK: {
                const { current_currency } = extra;
                if (current_currency)
                    return (
                        <Localize
                            i18n_default_text="Welcome back! Your messages have been restored. You are using your {{current_currency}} account."
                            values={{ current_currency }}
                        />
                    );
                return <Localize i18n_default_text="Welcome back! Your messages have been restored." />;
            }

            case LogTypes.WELCOME: {
                const { current_currency } = extra;
                if (current_currency)
                    return (
                        <Localize
                            i18n_default_text="You are using your {{current_currency}} account."
                            values={{ current_currency }}
                        />
                    );
                break;
            }

            default:
                return null;
        }
    };

    return <div className={classnames('journal__text', className)}>{getLogMessage()}</div>;
};

export default FormatMessage;
