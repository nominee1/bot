import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';

const BotTemplatesFooter = observer(() => {
    const { load_modal, dashboard } = useStore();

    const handleCancel = () => {
        dashboard.setPreviewOnPopup(false);
        load_modal?.toggleLoadModal();
    };

    return (
        <div className='bot-templates-footer'>
            <button
                className='dc-btn dc-btn--secondary'
                onClick={handleCancel}
            >
                {localize('Cancel')}
            </button>
        </div>
    );
});

export default BotTemplatesFooter;