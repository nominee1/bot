import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Text from '@/components/shared_ui/text';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import OnboardTourHandler from '../tutorials/dbot-tours/onboarding-tour';
import Announcements from './announcements';
import Cards from './cards';

type TMobileIconGuide = {
    handleTabChange: (active_number: number) => void;
};

type TMarketTickerItem = {
    code: string;
    name: string;
    price: string;
    change: string;
    isUp: boolean;
};

const MARKET_TICKER_ITEMS: TMarketTickerItem[] = [
    { code: 'BTC', name: 'Bitcoin', price: '$43,256', change: '+2.34%', isUp: true },
    { code: 'ETH', name: 'Ethereum', price: '$2,284', change: '+1.87%', isUp: true },
    { code: 'TSLA', name: 'Tesla', price: '$248.90', change: '+3.21%', isUp: true },
    { code: 'XAU', name: 'Gold', price: '$2,024', change: '+0.89%', isUp: true },
    { code: 'EUR', name: 'EUR/USD', price: '$1.0892', change: '+0.12%', isUp: true },
    { code: 'GBP', name: 'GBP/USD', price: '$1.2654', change: '-0.08%', isUp: false },
    { code: 'SOL', name: 'Solana', price: '$98.42', change: '+5.67%', isUp: true },
    { code: 'AAPL', name: 'Apple', price: '$178.32', change: '-0.45%', isUp: false },
];

const DashboardComponent = observer(({ handleTabChange }: TMobileIconGuide) => {
    const { load_modal, dashboard } = useStore();
    const { dashboard_strategies } = load_modal;
    const { active_tab, active_tour } = dashboard;
    const has_dashboard_strategies = !!dashboard_strategies?.length;
    const { isDesktop, isTablet } = useDevice();
    const tickerItems = [...MARKET_TICKER_ITEMS, ...MARKET_TICKER_ITEMS];

    return (
        <React.Fragment>
            <div
                className={classNames('tab__dashboard', {
                    'tab__dashboard--tour-active': active_tour,
                })}
            >
                <div className='tab__dashboard__content'>
                    <Announcements is_mobile={!isDesktop} is_tablet={isTablet} handleTabChange={handleTabChange} />
                    <div className='quick-panel'>
                        <div
                            className={classNames('tab__dashboard__header', {
                                'tab__dashboard__header--listed': isDesktop && has_dashboard_strategies,
                            })}
                        >
                            {!has_dashboard_strategies && (
                                <div className='market-ticker' role='region' aria-label='Live market ticker'>
                                    <div className='market-ticker__track'>
                                        {tickerItems.map((item, idx) => (
                                            <div className='market-ticker__item' key={`${item.code}-${idx}`}>
                                                <span className='market-ticker__code'>{item.code}</span>
                                                <span className='market-ticker__name'>{item.name}</span>
                                                <span className='market-ticker__price'>{item.price}</span>
                                                <span
                                                    className={classNames('market-ticker__change', {
                                                        'market-ticker__change--up': item.isUp,
                                                        'market-ticker__change--down': !item.isUp,
                                                    })}
                                                >
                                                    {item.change}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <Text
                                as='p'
                                color='prominent'
                                lineHeight='s'
                                size={isDesktop ? 's' : 'xxs'}
                                className={classNames('subtitle', { 'subtitle__has-list': has_dashboard_strategies })}
                            >
                                {localize(
                                    'Denara Pro | Powered By deriv'
                                )}
                            </Text>
                        </div>
                        <Cards has_dashboard_strategies={has_dashboard_strategies} is_mobile={!isDesktop} />
                    </div>
                </div>
            </div>
            {active_tab === 0 && <OnboardTourHandler is_mobile={!isDesktop} />}
        </React.Fragment>
    );
});

export default DashboardComponent;
