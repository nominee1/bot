import clsx from 'clsx';
import React from 'react';
import { observer } from 'mobx-react-lite';
import { standalone_routes } from '@/components/shared';
import { getDenaraCompetitionUsername } from '@/components/shared/utils/competition/denara-competition-profile';
import { loginWithDenaraId } from '@/components/shared/utils/competition/denara-id-login';
import { requestDerivOAuthAuthentication } from '@/components/shared/utils/login/login';
import Button from '@/components/shared_ui/button';
import useActiveAccount from '@/hooks/api/account/useActiveAccount';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { StandaloneCircleUserRegularIcon } from '@deriv/quill-icons/Standalone';
import { Localize, useTranslations } from '@deriv-com/translations';
import { Header, useDevice, Wrapper } from '@deriv-com/ui';
import { Tooltip } from '@deriv-com/ui';
import { AppLogo } from '../app-logo';
import AccountsInfoLoader from './account-info-loader';
import AccountSwitcher from './account-switcher';
import DualAccountTradeToggle from './dual-account-trade-toggle';
import MenuItems from './menu-items';
import MobileMenu from './mobile-menu';
import PlatformSwitcher from './platform-switcher';
import Dialog from '@/components/shared_ui/dialog';
import './header.scss';

const AppHeader = observer(() => {
    const { isDesktop } = useDevice();
    const { isAuthorizing, activeLoginid } = useApiBase();
    const { client } = useStore() ?? {};

    const [denaraLoginOpen, setDenaraLoginOpen] = React.useState(false);
    const [denaraLoginUser, setDenaraLoginUser] = React.useState('');
    const [denaraLoginPass, setDenaraLoginPass] = React.useState('');
    const [denaraLoginBusy, setDenaraLoginBusy] = React.useState(false);
    const [denaraLoginErr, setDenaraLoginErr] = React.useState<string | null>(null);
    const denaraLoginAttemptRef = React.useRef(0);

    const resetDenaraLoginDialog = React.useCallback(() => {
        denaraLoginAttemptRef.current += 1;
        setDenaraLoginOpen(false);
        setDenaraLoginBusy(false);
        setDenaraLoginPass('');
        setDenaraLoginErr(null);
    }, []);

    const closeDenaraLoginDialog = resetDenaraLoginDialog;

    const openDenaraLoginDialog = React.useCallback(() => {
        denaraLoginAttemptRef.current += 1;
        setDenaraLoginBusy(false);
        setDenaraLoginErr(null);
        setDenaraLoginUser(getDenaraCompetitionUsername() ?? '');
        setDenaraLoginPass('');
        setDenaraLoginOpen(true);
    }, []);

    React.useEffect(() => {
        resetDenaraLoginDialog();
    }, [activeLoginid, resetDenaraLoginDialog]);

    const { data: activeAccount } = useActiveAccount({ allBalanceData: client?.all_accounts_balance });
    const { accounts } = client ?? {};
    const has_wallet = Object.keys(accounts ?? {}).some(id => accounts?.[id].account_category === 'wallet');

    const { localize } = useTranslations();

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
                    <DualAccountTradeToggle />
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
            const onDenaraDialogSubmit = async (e: React.FormEvent) => {
                e.preventDefault();
                if (denaraLoginBusy) return;
                if (!denaraLoginUser.trim()) {
                    setDenaraLoginErr(localize('Enter your Denara username.'));
                    return;
                }
                const attemptId = denaraLoginAttemptRef.current + 1;
                denaraLoginAttemptRef.current = attemptId;
                setDenaraLoginErr(null);
                setDenaraLoginBusy(true);
                try {
                    await loginWithDenaraId(denaraLoginUser, denaraLoginPass);
                    if (denaraLoginAttemptRef.current !== attemptId) return;
                    resetDenaraLoginDialog();
                    setDenaraLoginUser('');
                } catch (err: unknown) {
                    if (denaraLoginAttemptRef.current !== attemptId) return;
                    setDenaraLoginErr(err instanceof Error ? err.message : localize('Could not sign in.'));
                    setDenaraLoginBusy(false);
                }
            };

            return (
                <div className='auth-actions'>
                    <Button tertiary className='app-header__denara-login-trigger' onClick={openDenaraLoginDialog}>
                        <Localize i18n_default_text='Denara ID' />
                    </Button>
                    <Dialog
                        className='app-header__denara-login-dialog'
                        title={localize('Sign in with Denara ID')}
                        is_visible={denaraLoginOpen}
                        onClose={closeDenaraLoginDialog}
                        onEscapeButtonCancel={closeDenaraLoginDialog}
                        onConfirm={() => undefined}
                        has_close_icon
                        portal_element_id='modal_root'
                    >
                        <form className='app-header__denara-login-form' onSubmit={onDenaraDialogSubmit}>
                            <div className='app-header__denara-login-fields'>
                                <label className='app-header__denara-login-field'>
                                    <span className='app-header__denara-login-label'>{localize('Denara username')}</span>
                                    <input
                                        type='text'
                                        className='app-header__denara-login-input'
                                        value={denaraLoginUser}
                                        onChange={e => {
                                            setDenaraLoginUser(e.target.value);
                                            setDenaraLoginErr(null);
                                        }}
                                        disabled={denaraLoginBusy}
                                        autoComplete='username'
                                        aria-label={localize('Denara username')}
                                        placeholder={localize('Your competition username')}
                                    />
                                </label>
                                <label className='app-header__denara-login-field'>
                                    <span className='app-header__denara-login-label'>{localize('Password')}</span>
                                    <input
                                        type='password'
                                        className='app-header__denara-login-input'
                                        value={denaraLoginPass}
                                        onChange={e => {
                                            setDenaraLoginPass(e.target.value);
                                            setDenaraLoginErr(null);
                                        }}
                                        disabled={denaraLoginBusy}
                                        autoComplete='current-password'
                                        aria-label={localize('Password')}
                                        placeholder={localize('')}
                                    />
                                </label>
                            </div>
                            {denaraLoginErr ? (
                                <span className='app-header__denara-login-err' role='status'>
                                    {denaraLoginErr}
                                </span>
                            ) : null}
                            <p className='app-header__denara-login-hint'>
                                <Localize i18n_default_text='Dont Have a denara ID? Create one on the floating button on the bottom right.' />
                            </p>
                            <Button
                                primary
                                large
                                className='app-header__denara-login-submit'
                                disabled={denaraLoginBusy || !denaraLoginUser.trim()}
                                type='submit'
                            >
                                {denaraLoginBusy ? localize('Signing in…') : localize('Sign in')}
                            </Button>
                        </form>
                    </Dialog>
                    <Button
                        tertiary
                        onClick={async () => {
                            await requestDerivOAuthAuthentication();
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

                <MobileMenu />
                {isDesktop && <PlatformSwitcher />}
                {isDesktop && <MenuItems />}
            </Wrapper>
            <Wrapper variant='right'>{renderAccountSection()}</Wrapper>
        </Header>
    );
});

export default AppHeader;
