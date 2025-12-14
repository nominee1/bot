import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import { generateOAuthURL, standalone_routes } from '@/components/shared';
import Button from '@/components/shared_ui/button';
import useActiveAccount from '@/hooks/api/account/useActiveAccount';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { StandaloneCircleUserRegularIcon } from '@deriv/quill-icons/Standalone';
import { requestOidcAuthentication } from '@deriv-com/auth-client';
import { Localize, useTranslations } from '@deriv-com/translations';
import { Header, useDevice, Wrapper } from '@deriv-com/ui';
import { Tooltip } from '@deriv-com/ui';
import { AppLogo } from '../app-logo';
import AccountsInfoLoader from './account-info-loader';
import AccountSwitcher from './account-switcher';
import MenuItems from './menu-items';
import MobileMenu from './mobile-menu';
import PlatformSwitcher from './platform-switcher';
import './header.scss';
import { LegacyTelegramIcon, LegacyWhatsappIcon } from '@deriv/quill-icons/Legacy';

const WHATSAPP_CHANNEL_URL = 'https://whatsapp.com/channel/0029VbBERaw1yT2HchhJRd1d';

const AppHeader = observer(() => {
    const { isDesktop } = useDevice();
    const { isAuthorizing, activeLoginid } = useApiBase();
    const { client } = useStore() ?? {};

    const { data: activeAccount } = useActiveAccount({ allBalanceData: client?.all_accounts_balance });
    const { accounts } = client ?? {};
    const has_wallet = Object.keys(accounts ?? {}).some(id => accounts?.[id].account_category === 'wallet');

    const { localize } = useTranslations();

    const { isOAuth2Enabled } = useOauth2();

    const renderAccountSection = () => {
        if (isAuthorizing) {
            return <AccountsInfoLoader isLoggedIn isMobile={!isDesktop} speed={3} />;
        } else if (activeLoginid) {
            return (
                <>
                    {/* <CustomNotifications /> */}
                    {isDesktop && (
                        <Tooltip
                            as='a'
                            href={standalone_routes.personal_details}
                            tooltipContent={localize('Manage account settings')}
                            tooltipPosition='bottom'
                            className='app-header__account-settings'
                        >
                            <StandaloneCircleUserRegularIcon className='app-header__profile_icon' />
                        </Tooltip>
                    )}
                    <AccountSwitcher activeAccount={activeAccount} />
                    {isDesktop &&
                        (has_wallet ? (
                            <Button
                                className='manage-funds-button'
                                has_effect
                                text={localize('Manage funds')}
                                onClick={() => window.location.assign(standalone_routes.wallets_transfer)}
                                primary
                            />
                        ) : (
                            <Button
                                primary
                                onClick={() => {
                                    window.location.assign(standalone_routes.withdraw);
                                }}
                                className='deposit-button'
                            >
                                {localize('Withdraw')}
                            </Button>
                        ))}
                </>
            );
        } else {
            return (
                <div className='auth-actions'>
                    <Button
                        tertiary
                        onClick={async () => {
                            if (!isOAuth2Enabled) {
                                window.location.replace(generateOAuthURL());
                            } else {
                                await requestOidcAuthentication({
                                    redirectCallbackUri: `${window.location.origin}/callback`,
                                });
                            }
                        }}
                    >
                        <Localize i18n_default_text='Log in' />
                    </Button>
                    <Button
                        primary
                        onClick={() => {
                            window.open(standalone_routes.signup);
                        }}
                    >
                        <Localize i18n_default_text='Sign up' />
                    </Button>
                </div>
            );
        }
    };

    return (
        <Header
            className={clsx('app-header', {
                'app-header--desktop': isDesktop,
                'app-header--mobile': !isDesktop,
            })}
        >
            <Wrapper variant='left'>
                <AppLogo />

                {/* Telegram icon */}
                <Tooltip
                    as='button'
                    onClick={() => window.location.assign(standalone_routes.yoo)}
                    tooltipContent={localize('Telegram')}
                    tooltipPosition='bottom'
                    className={clsx('app-header__telegram-icon', {
                        'app-header__telegram-icon--desktop': isDesktop,
                        'app-header__telegram-icon--mobile': !isDesktop,
                    })}
                >
                    <LegacyTelegramIcon iconSize='sm' />
                </Tooltip>

                {/* WhatsApp icon (added) */}
                <Tooltip
                    as='button'
                    onClick={() => window.open(WHATSAPP_CHANNEL_URL, '_blank')}
                    tooltipContent={localize('WhatsApp')}
                    tooltipPosition='bottom'
                    className={clsx('app-header__whatsapp-icon', {
                        'app-header__whatsapp-icon--desktop': isDesktop,
                        'app-header__whatsapp-icon--mobile': !isDesktop,
                    })}
                >
                    <LegacyWhatsappIcon iconSize='sm' />
                </Tooltip>

                <MobileMenu />
                {isDesktop && <PlatformSwitcher />}
                {isDesktop && <MenuItems />}
            </Wrapper>
            <Wrapper variant='right'>{renderAccountSection()}</Wrapper>
        </Header>
    );
});

export default AppHeader;
