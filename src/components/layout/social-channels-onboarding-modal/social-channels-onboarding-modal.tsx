import React, { useCallback, useEffect, useState } from 'react';
import { standalone_routes } from '@/components/shared';
import Button from '@/components/shared_ui/button';
import Modal from '@/components/shared_ui/modal';
import { LegacyTelegramIcon, LegacyWhatsappIcon } from '@deriv/quill-icons/Legacy';
import { Localize, useTranslations } from '@deriv-com/translations';

import './social-channels-onboarding-modal.scss';

const STORAGE_KEY = 'denara_social_channels_onboarding_seen';

const WHATSAPP_CHANNEL_URL = 'https://whatsapp.com/channel/0029VbBERaw1yT2HchhJRd1d';

/**
 * One-time (per browser) prompt to join WhatsApp / Telegram — replaces header shortcut icons.
 */
const SocialChannelsOnboardingModal: React.FC = () => {
    const { localize } = useTranslations();
    const [isOpen, setIsOpen] = useState(false);

    const dismiss = useCallback(() => {
        try {
            localStorage.setItem(STORAGE_KEY, '1');
        } catch {
            /* noop */
        }
        setIsOpen(false);
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (window.location.pathname === '/callback') return;

        try {
            if (localStorage.getItem(STORAGE_KEY) === '1') return;
        } catch {
            /* still show once */
        }

        /** Parent only mounts this after ChunkLoader — delay so layout/#modal_root settle (no jump). */
        let cancelled = false;
        let timeoutId: ReturnType<typeof window.setTimeout> | undefined;
        const rafId = window.requestAnimationFrame(() => {
            timeoutId = window.setTimeout(() => {
                if (!cancelled) setIsOpen(true);
            }, 420);
        });
        return () => {
            cancelled = true;
            window.cancelAnimationFrame(rafId);
            if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        };
    }, []);

    return (
        <Modal
            className='social-channels-onboarding-modal'
            has_close_icon
            is_open={isOpen}
            should_close_on_click_outside
            title={localize('Stay connected')}
            toggleModal={dismiss}
            width='min(42rem, calc(100vw - 1.6rem))'
        >
            <Modal.Body>
                <p className='social-channels-onboarding__lead'>
                    <Localize i18n_default_text='Join our WhatsApp channel and Telegram community for updates and signals.' />
                </p>
                <div className='social-channels-onboarding__grid'>
                    <div className='social-channels-onboarding__card social-channels-onboarding__card--whatsapp'>
                        <div className='social-channels-onboarding__card-icon' aria-hidden>
                            <LegacyWhatsappIcon iconSize='lg' />
                        </div>
                        <h4 className='social-channels-onboarding__card-title'>
                            <Localize i18n_default_text='WhatsApp channel' />
                        </h4>
                        <p className='social-channels-onboarding__card-text'>
                            <Localize i18n_default_text='Announcements and community discussion.' />
                        </p>
                        <Button
                            primary
                            large
                            text={localize('Join WhatsApp')}
                            onClick={() => window.open(WHATSAPP_CHANNEL_URL, '_blank', 'noopener,noreferrer')}
                        />
                    </div>
                    <div className='social-channels-onboarding__card social-channels-onboarding__card--telegram'>
                        <div className='social-channels-onboarding__card-icon' aria-hidden>
                            <LegacyTelegramIcon iconSize='lg' />
                        </div>
                        <h4 className='social-channels-onboarding__card-title'>
                            <Localize i18n_default_text='Telegram' />
                        </h4>
                        <p className='social-channels-onboarding__card-text'>
                            <Localize i18n_default_text='Signals and faster updates in our Telegram group.' />
                        </p>
                        <Button
                            secondary
                            large
                            text={localize('Open Telegram')}
                            onClick={() =>
                                window.open(standalone_routes.yoo, '_blank', 'noopener,noreferrer')
                            }
                        />
                    </div>
                </div>
                <div className='social-channels-onboarding__footer'>
                    <Button tertiary large text={localize('Maybe later')} onClick={dismiss} />
                </div>
            </Modal.Body>
        </Modal>
    );
};

export default SocialChannelsOnboardingModal;
