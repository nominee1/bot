import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { standalone_routes } from '@/components/shared';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useApiBase } from '@/hooks/useApiBase';
import useModalManager from '@/hooks/useModalManager';
import { useStore } from '@/hooks/useStore';
import { isBotEmbed, requestDeriv1Home } from '@/utils/bot-embed';
import { getActiveTabUrl } from '@/utils/getActiveTabUrl';
import { LANGUAGES } from '@/utils/languages';
import {
    StandaloneFileRegularIcon,
    StandaloneGlobeRegularIcon,
    StandaloneHouseBlankRegularIcon,
    StandaloneRightFromBracketRegularIcon,
} from '@deriv/quill-icons/Standalone';
import { Localize, useTranslations } from '@deriv-com/translations';
import { DesktopLanguagesModal, useDevice } from '@deriv-com/ui';
import { AppLogo } from '../app-logo';
import ChangeTheme from '../footer/ChangeTheme';
import AccountActions from './account-actions';
import BottomNavigation from './bottom-navigation';
import MobileMenu from './mobile-menu';
import './header.scss';

type TAppHeaderProps = {
    isAuthenticating?: boolean;
};

const AppHeader = observer(({ isAuthenticating }: TAppHeaderProps) => {
    const { isDesktop } = useDevice();
    const { activeLoginid } = useApiBase();
    const { client } = useStore() ?? {};
    const { currentLang = 'EN', localize, switchLanguage } = useTranslations();
    const { hideModal, isModalOpenFor, showModal } = useModalManager();
    const { oAuthLogout } = useOauth2({
        handleLogout: async () => client?.logout?.(),
        client,
    });
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const homeHref = standalone_routes.home;
    const reportsHref = (() => {
        const url = new URL(standalone_routes.positions);
        url.searchParams.set('redirect', window.location.origin);
        url.searchParams.set('lang', currentLang);
        const account_param = new URLSearchParams(window.location.search).get('account');
        if (account_param) url.searchParams.set('account', account_param);
        return url.toString();
    })();

    if (client?.should_hide_header) return null;

    if (isDesktop) {
        return (
            <>
                <aside className='app-header app-header--desktop app-header--vertical'>
                    <div className='app-header__top-section'>
                        <AppLogo />
                        <div className='app-header__nav-item'>
                            <a
                                href={homeHref}
                                className='app-header__nav-link'
                                aria-label={localize('Home')}
                                onClick={event => {
                                    if (!isBotEmbed()) return;
                                    event.preventDefault();
                                    requestDeriv1Home();
                                }}
                            >
                                <StandaloneHouseBlankRegularIcon width={24} height={24} fill='var(--text-general)' />
                                <span className='app-header__nav-text'>
                                    <Localize i18n_default_text='Home' />
                                </span>
                            </a>
                        </div>
                        <div className='app-header__nav-item'>
                            <a href={reportsHref} className='app-header__nav-link' aria-label={localize('Reports')}>
                                <StandaloneFileRegularIcon width={24} height={24} fill='var(--text-general)' />
                                <span className='app-header__nav-text'>
                                    <Localize i18n_default_text='Reports' />
                                </span>
                            </a>
                        </div>
                    </div>
                    <div className='app-header__bottom-section'>
                        <div className='app-header__nav-item'>
                            <button
                                type='button'
                                className='app-footer__language'
                                aria-label={`${localize('Change language')} - ${currentLang}`}
                                onClick={() => showModal('DesktopLanguagesModal')}
                            >
                                <StandaloneGlobeRegularIcon width={24} height={24} fill='var(--text-general)' />
                                <span className='app-header__nav-text'>
                                    <Localize i18n_default_text='Language' />
                                </span>
                            </button>
                        </div>
                        <div className='app-header__nav-item'>
                            <div className='app-header__theme-wrap'>
                                <ChangeTheme />
                                <span className='app-header__nav-text'>
                                    <Localize i18n_default_text='Theme' />
                                </span>
                            </div>
                        </div>
                        {activeLoginid ? (
                            <div className='app-header__nav-item'>
                                <button
                                    type='button'
                                    className='app-header__nav-link'
                                    aria-label={localize('Log out')}
                                    onClick={() => oAuthLogout()}
                                >
                                    <StandaloneRightFromBracketRegularIcon
                                        width={24}
                                        height={24}
                                        fill='var(--text-general)'
                                    />
                                    <span className='app-header__nav-text'>
                                        <Localize i18n_default_text='Log out' />
                                    </span>
                                </button>
                            </div>
                        ) : null}
                    </div>
                </aside>
                {isModalOpenFor('DesktopLanguagesModal') && (
                    <DesktopLanguagesModal
                        headerTitle={localize('Select Language')}
                        isModalOpen
                        languages={LANGUAGES}
                        onClose={hideModal}
                        onLanguageSwitch={code => {
                            switchLanguage(code);
                            hideModal();
                            window.location.replace(getActiveTabUrl());
                            window.location.reload();
                        }}
                        selectedLanguage={currentLang}
                    />
                )}
            </>
        );
    }

    return (
        <>
            <header className='app-header app-header--mobile'>
                <AppLogo />
                <AccountActions isAuthenticating={isAuthenticating} />
            </header>
            <MobileMenu isOpen={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen} hideToggle />
            <BottomNavigation onMenuClick={() => setIsMobileMenuOpen(true)} />
        </>
    );
});

export default AppHeader;
