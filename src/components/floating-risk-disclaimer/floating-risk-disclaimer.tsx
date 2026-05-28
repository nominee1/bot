import React, { lazy, Suspense, useCallback, useState } from 'react';
import ChunkLoader from '@/components/loader/chunk-loader';
import Dialog from '@/components/shared_ui/dialog';
import { localize } from '@deriv-com/translations';
import './floating-risk-disclaimer.scss';

const Risk = lazy(() => import('@/pages/Risk/Risk'));

const Emoji: React.FC<{ symbol: string; label?: string; size?: number }> = ({ symbol, label, size = 24 }) => (
    <span
        className='emoji'
        role='img'
        aria-label={label || ''}
        aria-hidden={label ? 'false' : 'true'}
        style={{ fontSize: `${size}px`, lineHeight: 1, display: 'inline-block' }}
    >
        {symbol}
    </span>
);

const FloatingRiskDisclaimer: React.FC = () => {
    const [is_risk_open, setIsRiskOpen] = useState(false);
    const openRisk = useCallback(() => setIsRiskOpen(true), []);
    const closeRisk = useCallback(() => setIsRiskOpen(false), []);

    return (
        <>
            <div
                className='risk-fab'
                role='button'
                aria-label={localize('Open Risk controls')}
                onClick={openRisk}
                onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openRisk();
                    }
                }}
                tabIndex={0}
                title={localize('Risk Disclaimer')}
            >
                <Emoji symbol='⚠️' size={18} />
                <span>{localize('Risk')}</span>
            </div>

            <Dialog
                className='risk-modal'
                has_close_icon
                is_mobile_full_width
                is_visible={is_risk_open}
                onCancel={closeRisk}
                onClose={closeRisk}
                onConfirm={closeRisk}
                cancel_button_text={localize('Close')}
                confirm_button_text={localize('Done')}
                portal_element_id='modal_root'
                title={localize('Risk Controls')}
            >
                <Suspense fallback={<ChunkLoader message={localize('Loading Risk controls…')} />}>
                    <Risk />
                </Suspense>
            </Dialog>
        </>
    );
};

export default FloatingRiskDisclaimer;
