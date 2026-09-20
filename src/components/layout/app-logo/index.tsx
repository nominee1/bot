import { DerivBotMark } from './deriv-bot-mark';
import './app-logo.scss';

export const AppLogo = () => {
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
            <DerivBotMark size={32} />
        </a>
    );
};
