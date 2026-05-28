import React from 'react';
import { requestDerivOAuthAuthentication } from '@/components/shared/utils/login/login';
import { consumeOAuthUserMessage, type TOAuthUserMessage } from '@/components/shared/utils/login/oauth-user-feedback';
import FloatingRiskDisclaimer from '@/components/floating-risk-disclaimer/floating-risk-disclaimer';
import Button from '@/components/shared_ui/button';
import { Localize } from '@deriv-com/translations';
import './welcome-landing.scss';

const marketRows = [
    { symbol: 'R_100', name: 'Volatility 100', value: '49,821.45', change: '+0.12%' },
    { symbol: 'R_75', name: 'Volatility 75', value: '112,903.20', change: '+0.08%' },
    { symbol: 'R_50', name: 'Volatility 50', value: '88,200.00', change: '+0.05%' },
    { symbol: '1HZ10V', name: 'Vol 10 1s', value: '9,847.33', change: '-0.04%' },
];

const WelcomeLanding: React.FC = () => {
    const [loginNotice, setLoginNotice] = React.useState<TOAuthUserMessage | null>(null);

    React.useEffect(() => {
        setLoginNotice(consumeOAuthUserMessage());
    }, []);

    const startDerivAuth = () => {
        setLoginNotice(null);
        void requestDerivOAuthAuthentication();
    };

    return (
        <div className='denara-home'>
            <main className='denara-home__stage'>
                <section className='denara-home__hero'>
                    <div className='denara-home__left'>
                        {loginNotice ? (
                            <div className='denara-home__login-notice' role='alert'>
                                <p>{loginNotice.message}</p>
                                {loginNotice.action === 'retry' ? (
                                    <button
                                        type='button'
                                        className='denara-home__login-notice-retry'
                                        onClick={startDerivAuth}
                                    >
                                        <Localize i18n_default_text='Try again' />
                                    </button>
                                ) : null}
                            </div>
                        ) : null}
                        <div className='denara-home__brand-row'>
                            <span className='denara-home__brand-mark'>D</span>
                            <span className='denara-home__brand-name'>
                                <Localize i18n_default_text='Denara Pro' />
                            </span>
                        </div>

                        <p className='denara-home__tag'>
                            <Localize i18n_default_text='Powered By Deriv' />
                        </p>

                        <h1 className='denara-home__title'>
                            <Localize i18n_default_text='The Ultimate Binary Trading Experience' />
                        </h1>

                        <p className='denara-home__subtitle'>
                            <Localize i18n_default_text='Access digit tools, bots, manual trading, and market analysis from one simple dashboard.' />
                        </p>

                        <div className='denara-home__actions'>
                            <Button
                                primary
                                large
                                className='denara-home__button denara-home__button--primary'
                                onClick={startDerivAuth}
                            >
                                <Localize i18n_default_text='Get started' />
                            </Button>

                            <Button
                                secondary
                                large
                                className='denara-home__button denara-home__button--secondary'
                                onClick={startDerivAuth}
                            >
                                <Localize i18n_default_text='Log in with Deriv' />
                            </Button>
                        </div>

                        <div className='denara-home__trust'>
                            <span>
                                <Localize i18n_default_text='Free Analysis' />
                            </span>
                            <span>
                                <Localize i18n_default_text='Free Strategies' />
                            </span>
                            <span>
                                <Localize i18n_default_text='Built for synthetic indices' />
                            </span>
                        </div>

                        <p className='denara-home__fineprint'>
                            <Localize i18n_default_text='Trade 100+ assets worldwide with lightning execution. Start with as little as $2.' />
                        </p>
                    </div>

                    <div className='denara-home__right'>
                        <div className='denara-home__terminal'>
                            <div className='denara-home__terminal-head'>
                                <div>
                                    <span />
                                    <span />
                                    <span />
                                </div>
                                <p>
                                    <Localize i18n_default_text='Live desk' />
                                </p>
                            </div>

                            <div className='denara-home__balance-card'>
                                <p>
                                    <Localize i18n_default_text='Demo balance' />
                                </p>
                                <strong>$10,240.80</strong>
                                <span>+2.45%</span>
                            </div>

                            <div className='denara-home__graph' aria-hidden>
                                <i />
                                <i />
                                <i />
                                <i />
                                <i />
                                <i />
                                <i />
                                <i />
                            </div>

                            <div className='denara-home__market-list'>
                                {marketRows.map(row => (
                                    <div key={row.symbol} className='denara-home__market-row'>
                                        <div>
                                            <strong>{row.symbol}</strong>
                                            <span>{row.name}</span>
                                        </div>

                                        <div>
                                            <strong>{row.value}</strong>
                                            <em className={row.change.startsWith('-') ? 'is-down' : ''}>
                                                {row.change}
                                            </em>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>
            </main>

            <FloatingRiskDisclaimer />
        </div>
    );
};

export default WelcomeLanding;
