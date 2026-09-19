import { useDevice } from '@deriv-com/ui';
import { DerivBotMark } from './deriv-bot-mark';
import './app-logo.scss';

export const AppLogo = () => {
    const { isDesktop } = useDevice();

    return (
        <a
            className='app-header__logo-container'
            href='/'
            aria-label='Deriv Bot'
            onClick={e => {
                e.preventDefault();
                window.location.reload();
            }}
        >
            <DerivBotMark size={isDesktop ? 32 : 28} />
        </a>
    );
};
