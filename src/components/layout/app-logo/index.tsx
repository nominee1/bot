import brandConfig from '@/components/shared/brand.config.json';
import { hasBotStudioOAuthConfig } from '@/components/shared/utils/config/config';
import { useDevice } from '@deriv-com/ui';
import './app-logo.scss';

export const AppLogo = () => {
    const { isDesktop } = useDevice();

    if (!isDesktop) return null;

    if (hasBotStudioOAuthConfig()) {
        return (
            <a
                className='app-header__logo app-header__logo--brand'
                href='/'
                onClick={e => {
                    e.preventDefault();
                    window.location.reload();
                }}
            >
                <span className='app-header__logo-text'>{brandConfig.brand_name}</span>
            </a>
        );
    }

    return null;
};
