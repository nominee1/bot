import { DerivLogo, useDevice } from '@deriv-com/ui';
import './app-logo.scss';
import { BrandDerivWordmarkSlateIcon, CurrencyDashIcon, LegacyGoogleIcon } from '@deriv/quill-icons';
import IconRadio from '@/pages/dashboard/bot-list/save-modal/icon-radio';

export const AppLogo = () => {
    const { isDesktop } = useDevice();

    if (!isDesktop) return null;
    return (
        <a
            className='app-header__logo'
            href='/'
            onClick={e => {
                e.preventDefault();
                window.location.reload();
            }}
        >
            <IconRadio variant='wallets' />
            <span className='app-header__logo-text'>DENARA PRO</span>
        </a>
    );
};
