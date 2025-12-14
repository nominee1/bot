import { ReactNode } from 'react';
import { standalone_routes } from '@/components/shared';
import {
    LegacyCashierIcon as CashierLogo,
    LegacyHomeNewIcon as TradershubLogo,
    LegacyReportsIcon as ReportsLogo,
    LegacyTelegramIcon,
    LegacyGoogleIcon,
    LegacyIndicatorTrendIcon,
    LegacyCircleTrendUpIcon,
    LegacyCashierIcon,
} from '@deriv/quill-icons/Legacy';
import {
    DerivProductBrandLightDerivBotLogoWordmarkIcon as DerivBotLogo,
    DerivProductBrandLightDerivTraderLogoWordmarkIcon as DerivTraderLogo,
    PartnersProductBrandLightSmarttraderLogoWordmarkIcon as SmarttraderLogo,
} from '@deriv/quill-icons/Logo';
import { localize } from '@deriv-com/translations';
import { LabelPairedEyeLgFillIcon, SocialTiktokBrandIcon, SocialYoutubeBlackIcon, StandaloneWhatsappIcon, TradeTypesUpsAndDownsFallIcon, TradeTypesUpsAndDownsOnlyUpsIcon } from '@deriv/quill-icons';
import { MarketIcon } from '@/components/market/market-icon';
import { TradeTypeIcon } from '@/components/trade-type/trade-type-icon';
import { CurrencyIcon } from '@/components/currency/currency-icon';
import { IconTradeTypes } from '@/utils/tmp/dummy';
import IconRadio from '@/pages/dashboard/bot-list/save-modal/icon-radio';
import Tournament from '../../../pages/aaaatonament/Tournament';

export type PlatformsConfig = {
    active: boolean;
    buttonIcon: ReactNode;
    description: string;
    href: string;
    icon: ReactNode;
    showInEU: boolean;
};

export type MenuItemsConfig = {
    as: 'a' | 'button';
    href: string;
    icon: ReactNode;
    label: string;
};

export type TAccount = {
    balance: string;
    currency: string;
    icon: React.ReactNode;
    isActive: boolean;
    isEu: boolean;
    isVirtual: boolean;
    loginid: string;
    token: string;
    type: string;
};

export const platformsConfig: PlatformsConfig[] = [
    
    {
        active: true,
        buttonIcon: <LabelPairedEyeLgFillIcon  height={25} width={94} />,
        description: localize('Denara Dbot, Import your bot or trade with denara bots'),
        href: standalone_routes.yoo,
        icon: <LegacyIndicatorTrendIcon height={32} width={121} />,
        showInEU: false,
    },
    {
        active: false,
        buttonIcon: <LegacyCashierIcon height={25} width={94} />,
        description: localize('Withdraw, Deposit or transfer to another deriv account'),
        href: standalone_routes.withdraw,
        icon: <LegacyCashierIcon height={32} width={121} />,
        showInEU: false,
    },
 
    {
        active: false,
        buttonIcon: <LegacyTelegramIcon height={24} width={115} />,
        description: localize('Join our official Telegram Channel'),
        href: standalone_routes.yoo,
        icon: <LegacyTelegramIcon height={32} width={153} />,
        showInEU: false,
    },
];

export const TRADERS_HUB_LINK_CONFIG = {
    // as: 'a',
    // href: standalone_routes.traders_hub,
    // icon: <TradershubLogo iconSize='xs' />,
    // label: "Trader's Hub",
};

export const MenuItems: MenuItemsConfig[] = [
    // {
    //     as: 'a',
    //     href: standalone_routes.reports,
    //     icon: <ReportsLogo iconSize='xs' />,
    //     label: localize('Reports'),
    // },
    {
        as: 'a',
        href: standalone_routes.cashier,
        icon: <CashierLogo iconSize='xs' />,
        label: localize('Cashier'),
    },
];
