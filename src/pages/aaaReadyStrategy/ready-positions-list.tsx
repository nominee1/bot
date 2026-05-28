import {
    TradeTypesDigitsEvenIcon,
    TradeTypesDigitsOddIcon,
    TradeTypesDigitsMatchesIcon,
    TradeTypesDigitsOverIcon,
    TradeTypesDigitsDiffersIcon,
    TradeTypesDigitsUnderIcon,
    TradeTypesUpsAndDownsFallIcon,
    MarketDerivedVolatility1001sIcon,
    MarketDerivedVolatility100Icon,
    MarketDerivedVolatility10Icon,
    MarketDerivedVolatility25Icon,
    MarketDerivedVolatility50Icon,
    MarketDerivedVolatility75Icon,
    MarketDerivedJump100Icon,
    MarketDerivedJump10Icon,
    MarketDerivedJump25Icon,
    MarketDerivedJump50Icon,
    MarketDerivedJump75Icon,
    MarketDerivedVolatility751sIcon,
    MarketDerivedVolatility101sIcon,
    MarketDerivedVolatility251sIcon,
    MarketDerivedVolatility501sIcon,
    MarketDerivedVolatility151sIcon,
    MarketDerivedVolatility301sIcon,
    MarketDerivedVolatility901sIcon,
    TradeTypesUpsAndDownsRiseIcon,
} from '@deriv/quill-icons';

import type { TReadyTrade } from './ready-trade-types';

const marketIcons: Record<string, JSX.Element> = {
    '1HZ100V': <MarketDerivedVolatility1001sIcon width={16} height={16} />,
    R_100: <MarketDerivedVolatility100Icon width={16} height={16} />,
    R_10: <MarketDerivedVolatility10Icon width={16} height={16} />,
    R_25: <MarketDerivedVolatility25Icon width={16} height={16} />,
    R_50: <MarketDerivedVolatility50Icon width={16} height={16} />,
    R_75: <MarketDerivedVolatility75Icon width={16} height={16} />,
    JD10: <MarketDerivedJump10Icon width={16} height={16} />,
    JD25: <MarketDerivedJump25Icon width={16} height={16} />,
    JD50: <MarketDerivedJump50Icon width={16} height={16} />,
    JD75: <MarketDerivedJump75Icon width={16} height={16} />,
    JD100: <MarketDerivedJump100Icon width={16} height={16} />,
    '1HZ10V': <MarketDerivedVolatility101sIcon width={16} height={16} />,
    '1HZ25V': <MarketDerivedVolatility251sIcon width={16} height={16} />,
    '1HZ50V': <MarketDerivedVolatility501sIcon width={16} height={16} />,
    '1HZ15V': <MarketDerivedVolatility151sIcon width={16} height={16} />,
    '1HZ30V': <MarketDerivedVolatility301sIcon width={16} height={16} />,
    '1HZ90V': <MarketDerivedVolatility901sIcon width={16} height={16} />,
    '1HZ75V': <MarketDerivedVolatility751sIcon width={16} height={16} />,
};

const contractIcons: Record<string, JSX.Element> = {
    DIGITEVEN: <TradeTypesDigitsEvenIcon width={16} height={16} />,
    DIGITODD: <TradeTypesDigitsOddIcon width={16} height={16} />,
    DIGITMATCH: <TradeTypesDigitsMatchesIcon width={16} height={16} />,
    DIGITDIFF: <TradeTypesDigitsDiffersIcon width={16} height={16} />,
    DIGITOVER: <TradeTypesDigitsOverIcon width={16} height={16} />,
    DIGITUNDER: <TradeTypesDigitsUnderIcon width={16} height={16} />,
    CALL: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
    PUT: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />,
    CALLE: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
    PUTE: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />,
    RUNHIGH: <TradeTypesUpsAndDownsRiseIcon width={16} height={16} />,
    RUNLOW: <TradeTypesUpsAndDownsFallIcon width={16} height={16} />,
};

const EntrySpotIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox='0 0 16 16' aria-hidden='true'>
        <circle cx={8} cy={8} r={6} stroke='#FF4444' strokeWidth={1.5} fill='white' />
        <circle cx={8} cy={8} r={3} fill='#FF4444' />
    </svg>
);

const ExitSpotIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox='0 0 16 16' aria-hidden='true'>
        <circle cx={8} cy={8} r={6} stroke='#999999' strokeWidth={1.5} fill='white' />
    </svg>
);

const formatTickValue = (v?: number, mf?: string) => {
    if (v === undefined) return '—';
    if (['R_10', 'R_25', '1HZ15V', '1HZ30V', '1HZ90V'].includes(mf || '')) return v.toFixed(3);
    if (['R_50', 'R_75'].includes(mf || '')) return v.toFixed(4);
    return v.toFixed(2);
};

const isDigitContract = (ct: string) =>
    ct === 'DIGITOVER' || ct === 'DIGITUNDER' || ct === 'DIGITMATCH' || ct === 'DIGITDIFF';

type TReadyPositionsList = {
    trades: TReadyTrade[];
};

export default function ReadyPositionsList({ trades }: TReadyPositionsList) {
    return (
        <div className='ready-strategy-positions open-positions'>
            {trades.length === 0 ? (
                <div className='no-positions'>
                    <small>No positions</small>
                </div>
            ) : (
                trades.map(tr => (
                    <div
                        key={tr.id}
                        className={`position-item ${
                            tr.status === 'won'
                                ? 'position-win'
                                : tr.status === 'lost' || tr.status === 'error'
                                  ? 'position-loss'
                                  : 'position-open'
                        }`}
                    >
                        <div className='position-header'>
                            <div className='position-market-contract'>
                                {marketIcons[tr.market] || <span>{tr.market}</span>}
                                {contractIcons[tr.contractType] || <span>{tr.contractType}</span>}
                                {tr.virtual && <span className='virtual-pill'>{tr.virtualLabel || 'Virtual Hook'}</span>}
                                {isDigitContract(tr.contractType) && tr.barrier !== undefined && (
                                    <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.8 }}>d{tr.barrier}</span>
                                )}
                            </div>

                            {tr.status === 'error' && (
                                <div className='error-display'>
                                    <span className='error-badge' title={tr.errorDetails || 'Trade failed'}>
                                        !
                                    </span>
                                    <span className='error-text'>{tr.errorReason}</span>
                                </div>
                            )}
                        </div>

                        <div className='position-spots'>
                            <div className='spot-entry'>
                                <EntrySpotIcon />
                                {formatTickValue(tr.entryValue, tr.marketFormat)}
                            </div>
                            <div className='spot-exit'>
                                <ExitSpotIcon />
                                {formatTickValue(tr.exitValue, tr.marketFormat)}
                            </div>
                        </div>

                        <div className='position-footer'>
                            <div className='position-stake'>{tr.stake.toFixed(2)} USD</div>
                            <div
                                className={`position-result ${
                                    tr.status === 'pending'
                                        ? 'pending'
                                        : tr.status === 'error'
                                          ? 'loss'
                                          : tr.profit !== undefined
                                            ? tr.profit >= 0
                                                ? 'profit'
                                                : 'loss'
                                            : ''
                                }`}
                            >
                                {tr.status === 'pending'
                                    ? '...'
                                    : tr.profit !== undefined
                                      ? `${tr.profit >= 0 ? '+' : ''}${tr.profit.toFixed(2)}`
                                      : '—'}
                            </div>
                        </div>
                    </div>
                ))
            )}
        </div>
    );
}
