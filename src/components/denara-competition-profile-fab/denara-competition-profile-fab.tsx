import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import DenaraCompetitionProfileModal from '@/pages/dashboard/denara-competition-profile-modal';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import './denara-competition-profile-fab.scss';

/**
 * Global floating entry for Denara competition username + trader registration (non-dashboard).
 */
const DenaraCompetitionProfileFab = observer(() => {
    const [open, setOpen] = useState(false);
    /** Store is created asynchronously in StoreProvider — first paint can be null. */
    const rootStore = useStore();
    const client = rootStore?.client;
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    if (path === '/callback') return null;

    return (
        <>
            <button
                type='button'
                className='denara-comp-profile-fab'
                onClick={() => setOpen(true)}
                aria-label={localize('Denara competition profile')}
            >
                <span className='denara-comp-profile-fab__icon' aria-hidden>
                    🪪
                </span>
                <span className='denara-comp-profile-fab__label'>{localize('Denara ID')}</span>
            </button>

            <DenaraCompetitionProfileModal
                is_open={open}
                onClose={() => setOpen(false)}
                email_prefill={client?.account_settings?.email ?? ''}
            />
        </>
    );
});

export default DenaraCompetitionProfileFab;
