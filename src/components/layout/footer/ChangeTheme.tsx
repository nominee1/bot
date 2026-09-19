import { observer } from 'mobx-react-lite';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { StandaloneMoonRegularIcon, StandaloneSunBrightRegularIcon } from '@deriv/quill-icons/Standalone';
import { useTranslations } from '@deriv-com/translations';
import { Tooltip } from '@deriv-com/ui';

const ChangeTheme = observer(() => {
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();
    const { localize } = useTranslations();

    return (
        <Tooltip
            as='button'
            className='app-footer__icon'
            tooltipContent={localize('Change theme')}
            onClick={toggleTheme}
        >
            {!is_dark_mode_on ? (
                <StandaloneSunBrightRegularIcon width={24} height={24} fill='var(--text-general)' />
            ) : (
                <StandaloneMoonRegularIcon width={24} height={24} fill='var(--text-general)' />
            )}
        </Tooltip>
    );
});

export default ChangeTheme;
