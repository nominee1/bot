import React from 'react';

import './denara-loading-intro.scss';

/**
 * Full-screen loader while DBot initializes API / active symbols.
 */
export default function DenaraLoadingIntro() {
    return (
        <div className='denara-loading-intro' role='status' aria-live='polite' aria-busy='true'>
            <span className='denara-loading-intro__sr-only'>Denara is loading your workspace.</span>
            <div className='denara-loading-intro__shell'>
                <div className='denara-loading-intro__loader-stage' aria-hidden>
                    <div className='denara-loading-intro__wave-loader' />
                </div>
                <p className='denara-loading-intro__headline'>Denara — The Ultimate Binary Trading Experience</p>
            </div>
        </div>
    );
}
