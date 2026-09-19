import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import { standalone_routes } from '@/components/shared';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import {
    LabelPairedChartLineCaptionRegularIcon,
    LabelPairedObjectsColumnCaptionRegularIcon,
    LabelPairedPuzzlePieceTwoCaptionBoldIcon,
} from '@deriv/quill-icons/LabelPaired';
import { LegacyHomeNewIcon, LegacyMenuHamburger1pxIcon } from '@deriv/quill-icons/Legacy';
import { Localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import './bottom-navigation.scss';

type TBottomNavigationProps = {
    onMenuClick: () => void;
};

const BottomNavigation = observer(({ onMenuClick }: TBottomNavigationProps) => {
    const { isDesktop } = useDevice();
    const { dashboard } = useStore();
    const { active_tab, setActiveTab } = dashboard;

    if (isDesktop) return null;

    const items = [
        {
            id: 'home',
            label: <Localize i18n_default_text='Home' />,
            icon: <LegacyHomeNewIcon iconSize='xs' fill='var(--text-general)' />,
            onClick: () => {
                window.location.assign(standalone_routes.home);
            },
            active: false,
        },
        {
            id: 'dashboard',
            label: <Localize i18n_default_text='Dashboard' />,
            icon: <LabelPairedObjectsColumnCaptionRegularIcon height='24px' width='24px' fill='var(--text-general)' />,
            onClick: () => setActiveTab(DBOT_TABS.DASHBOARD),
            active: active_tab === DBOT_TABS.DASHBOARD,
        },
        {
            id: 'builder',
            label: <Localize i18n_default_text='Bot builder' />,
            icon: <LabelPairedPuzzlePieceTwoCaptionBoldIcon height='24px' width='24px' fill='var(--text-general)' />,
            onClick: () => setActiveTab(DBOT_TABS.BOT_BUILDER),
            active: active_tab === DBOT_TABS.BOT_BUILDER,
        },
        {
            id: 'chart',
            label: <Localize i18n_default_text='Chart' />,
            icon: <LabelPairedChartLineCaptionRegularIcon height='24px' width='24px' fill='var(--text-general)' />,
            onClick: () => setActiveTab(DBOT_TABS.CHART),
            active: active_tab === DBOT_TABS.CHART,
        },
        {
            id: 'menu',
            label: <Localize i18n_default_text='Menu' />,
            icon: <LegacyMenuHamburger1pxIcon iconSize='xs' fill='var(--text-general)' />,
            onClick: onMenuClick,
            active: false,
        },
    ];

    return (
        <nav className='bottom-navigation' aria-label='Primary'>
            {items.map(item => (
                <button
                    key={item.id}
                    type='button'
                    className={clsx('bottom-navigation__item', {
                        'bottom-navigation__item--active': item.active,
                    })}
                    onClick={item.onClick}
                >
                    <span className='bottom-navigation__icon'>{item.icon}</span>
                    <span className='bottom-navigation__label'>{item.label}</span>
                </button>
            ))}
        </nav>
    );
});

export default BottomNavigation;
