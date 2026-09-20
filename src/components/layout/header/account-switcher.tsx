import React, { useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { formatMoney, getCurrencyDisplayCode } from '@/components/shared';
import Text from '@/components/shared_ui/text';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { isBotEmbed } from '@/utils/bot-embed';
import { getCrShadowForWallet } from '@/utils/crVirtualBalanceShadow';
import {
    DERIV1_DEMO_BALANCE,
    DERIV1_DEMO_LOGINID,
    getDeriv1AccountMode,
    getHandoffShadowLoginid,
    isDeriv1DemoLoginid,
    readPersistedDeriv1Session,
    switchDeriv1AccountMode,
} from '@/utils/deriv1SessionHandoff';
import { localize } from '@deriv-com/translations';
import { TAccountSwitcher } from './common/types';
import AccountDropdown from './account-dropdown';
import './account-switcher.scss';

const AccountSwitcher = observer(({ activeAccount }: TAccountSwitcher) => {
    const { accountList, activeLoginid } = useApiBase();
    const { run_panel, client } = useStore();
    const { is_stop_button_visible } = run_panel;
    const [is_dropdown_open, setIsDropdownOpen] = useState(false);
    const triggerRef = useRef<HTMLDivElement>(null);

    const embedOrHandoff = Boolean(getHandoffShadowLoginid() || isBotEmbed());
    const modeDemo = getDeriv1AccountMode() === 'demo' || isDeriv1DemoLoginid(activeLoginid);
    const is_virtual_account = Boolean(
        modeDemo || activeAccount?.is_virtual || client.is_virtual || isDeriv1DemoLoginid(client.loginid)
    );

    const currency_code = activeAccount?.currency || client.currency || readPersistedDeriv1Session()?.currency || 'USD';

    const real_loginid =
        getHandoffShadowLoginid() ||
        accountList?.find(account => !isDeriv1DemoLoginid(account.loginid))?.loginid ||
        (!isDeriv1DemoLoginid(activeAccount?.loginid) ? activeAccount?.loginid : undefined) ||
        (!isDeriv1DemoLoginid(client.loginid) ? client.loginid : undefined) ||
        readPersistedDeriv1Session()?.loginid ||
        '';

    const shadowReal = real_loginid ? getCrShadowForWallet(real_loginid) : undefined;
    const sessionReal = readPersistedDeriv1Session()?.virtualBalance;
    const listedReal = real_loginid ? client.all_accounts_balance?.accounts?.[real_loginid]?.balance : undefined;
    const real_balance = Number(
        (typeof shadowReal === 'number' && Number.isFinite(shadowReal) ? shadowReal : undefined) ??
            (typeof sessionReal === 'number' && Number.isFinite(sessionReal) ? sessionReal : undefined) ??
            (typeof listedReal === 'number' && Number.isFinite(listedReal) ? listedReal : undefined) ??
            (!is_virtual_account ? Number(client.balance) : undefined) ??
            0
    );
    const header_balance = is_virtual_account ? DERIV1_DEMO_BALANCE : real_balance;

    const dropdown_rows = [
        {
            loginid: real_loginid || 'real',
            is_demo: false,
            is_selected: !is_virtual_account,
            balance: real_balance,
            currency: currency_code,
        },
        {
            loginid: DERIV1_DEMO_LOGINID,
            is_demo: true,
            is_selected: is_virtual_account,
            balance: DERIV1_DEMO_BALANCE,
            currency: currency_code,
        },
    ];

    const toggleDropdown = () => {
        if (is_stop_button_visible) return;
        setIsDropdownOpen(open => !open);
    };

    const onSelectAccount = (loginid: string) => {
        const nextDemo = isDeriv1DemoLoginid(loginid);
        if (nextDemo === is_virtual_account) {
            setIsDropdownOpen(false);
            return;
        }
        switchDeriv1AccountMode(nextDemo ? 'demo' : 'real', real_balance);
        setIsDropdownOpen(false);
    };

    // Embed / handoff always uses the live-style Real/Demo rows (never wallets dialog).
    if (!embedOrHandoff && !activeAccount && !activeLoginid && !client.is_logged_in) {
        return null;
    }

    return (
        <div className='acc-info-live' ref={triggerRef}>
            <div
                className={classNames('acc-info', {
                    'acc-info--show': is_dropdown_open,
                    'acc-info--is-virtual': is_virtual_account,
                })}
                data-testid='dt_acc_info'
                id='dt_core_acc-info_acc-info'
                role='button'
                tabIndex={0}
                onClick={toggleDropdown}
                onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleDropdown();
                    }
                }}
            >
                <div className='acc-info__content'>
                    <div className='acc-info__account-type-header'>
                        <Text as='p' size='xxxs' className='acc-info__account-type'>
                            {is_virtual_account ? localize('Demo account') : localize('Real account')}
                        </Text>
                        <div
                            className={classNames('acc-info__select-arrow', {
                                'acc-info__select-arrow--invert': is_dropdown_open,
                            })}
                        >
                            <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' width='16' height='16'>
                                <path d='M16.43 21.969a.66.66 0 0 1-.899 0l-7.5-7.5a.66.66 0 0 1 0-.899.66.66 0 0 1 .899 0L16 20.64l7.031-7.07a.66.66 0 0 1 .899 0 .66.66 0 0 1 0 .899z' />
                            </svg>
                        </div>
                    </div>
                    <div className='acc-info__balance-section'>
                        <p data-testid='dt_balance' className='acc-info__balance'>
                            {`${formatMoney(currency_code, header_balance, true)} ${getCurrencyDisplayCode(currency_code)}`}
                        </p>
                    </div>
                </div>
            </div>
            <AccountDropdown
                open={is_dropdown_open}
                rows={dropdown_rows}
                triggerRef={triggerRef}
                forceActionSheet={embedOrHandoff}
                onClose={() => setIsDropdownOpen(false)}
                onSelect={onSelectAccount}
            />
        </div>
    );
});

export default AccountSwitcher;
