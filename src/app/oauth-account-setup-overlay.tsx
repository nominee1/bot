import { localize } from '@deriv-com/translations';

/** Full-screen overlay while Options OAuth callback completes (token exchange + hydrate). */
export default function OAuthAccountSetupOverlay() {
    return (
        <div className='oauth-account-setup-overlay' role='status' aria-live='polite' aria-busy='true'>
            <div className='oauth-account-setup-overlay__card'>
                <span className='oauth-account-setup-overlay__spinner' aria-hidden />
                <strong>{localize('Setting up your account, please hold on…')}</strong>
            </div>
        </div>
    );
}
