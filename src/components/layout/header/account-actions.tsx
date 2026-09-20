import { useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { generateOAuthURL, standalone_routes } from '@/components/shared';
import { isBotStudioDeploy } from '@/components/shared/utils/config/config';
import { requestDerivOAuthAuthentication } from '@/components/shared/utils/login/login';
import Button from '@/components/shared_ui/button';
import useActiveAccount from '@/hooks/api/account/useActiveAccount';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useFirebaseCountriesConfig } from '@/hooks/firebase/useFirebaseCountriesConfig';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import useTMB from '@/hooks/useTMB';
import { clearAuthData, handleOidcAuthFailure } from '@/utils/auth-utils';
import { getHandoffShadowLoginid } from '@/utils/deriv1SessionHandoff';
import { requestOidcAuthentication } from '@deriv-com/auth-client';
import { Localize, useTranslations } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import AccountsInfoLoader from './account-info-loader';
import AccountSwitcher from './account-switcher';

type TAccountActionsProps = {
    isAuthenticating?: boolean;
};

const AccountActions = observer(({ isAuthenticating }: TAccountActionsProps) => {
    const { isDesktop } = useDevice();
    const { isAuthorizing, activeLoginid } = useApiBase();
    const { client } = useStore() ?? {};
    const { data: activeAccount } = useActiveAccount({ allBalanceData: client?.all_accounts_balance });
    const { accounts, getCurrency, is_virtual } = client ?? {};
    const has_wallet = Object.keys(accounts ?? {}).some(id => accounts?.[id].account_category === 'wallet');
    const currency = getCurrency?.();
    const { localize } = useTranslations();
    const { isSingleLoggingIn } = useOauth2();
    const { hubEnabledCountryList } = useFirebaseCountriesConfig();
    const { onRenderTMBCheck, isTmbEnabled } = useTMB();
    const is_tmb_enabled = isTmbEnabled() || window.is_tmb_enabled === true;
    const use_pkce_login = isBotStudioDeploy();

    const onLogin = useCallback(async () => {
        if (use_pkce_login) {
            clearAuthData(false);
            await requestDerivOAuthAuthentication();
            return;
        }
        clearAuthData(false);
        const getQueryParams = new URLSearchParams(window.location.search);
        const account = getQueryParams.get('account') ?? '';
        const query_param_currency = account || sessionStorage.getItem('query_param_currency') || 'USD';

        try {
            const tmbEnabled = await isTmbEnabled();
            if (tmbEnabled) {
                await onRenderTMBCheck(true);
            } else {
                try {
                    await requestOidcAuthentication({
                        redirectCallbackUri: `${window.location.origin}/callback`,
                        ...(query_param_currency
                            ? {
                                  state: {
                                      account: query_param_currency,
                                  },
                              }
                            : {}),
                    });
                } catch (err) {
                    handleOidcAuthFailure(err);
                    window.location.replace(generateOAuthURL());
                }
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(error);
        }
    }, [isTmbEnabled, onRenderTMBCheck, use_pkce_login]);

    if (isAuthenticating || isAuthorizing || (isSingleLoggingIn && !is_tmb_enabled)) {
        return <AccountsInfoLoader isLoggedIn isMobile={!isDesktop} speed={3} />;
    }

    if (activeLoginid || client?.is_logged_in || getHandoffShadowLoginid()) {
        return (
            <div className='auth-actions'>
                <AccountSwitcher activeAccount={activeAccount} />
                {has_wallet && !getHandoffShadowLoginid() ? (
                    <Button
                        className='manage-funds-button'
                        has_effect
                        text={localize('Manage funds')}
                        onClick={() => {
                            let redirect_url = new URL(standalone_routes.wallets_transfer);
                            const is_hub_enabled_country = hubEnabledCountryList.includes(client?.residence || '');
                            if (is_hub_enabled_country) {
                                redirect_url = new URL(standalone_routes.recent_transactions);
                            }
                            if (is_virtual) {
                                redirect_url.searchParams.set('account', 'demo');
                            } else if (currency) {
                                redirect_url.searchParams.set('account', currency);
                            }
                            window.location.assign(redirect_url.toString());
                        }}
                        primary
                    />
                ) : (
                    <Button
                        primary
                        onClick={() => {
                            const redirect_url = new URL(standalone_routes.cashier_deposit);
                            if (currency) {
                                redirect_url.searchParams.set('account', currency);
                            }
                            window.location.assign(redirect_url.toString());
                        }}
                        className='deposit-button'
                    >
                        {localize('Deposit')}
                    </Button>
                )}
            </div>
        );
    }

    return (
        <div className='auth-actions auth-actions--logged-out'>
            <Button tertiary className='login-button' onClick={onLogin}>
                <Localize i18n_default_text='Log in' />
            </Button>
        </div>
    );
});

export default AccountActions;
