import { standalone_routes } from '@/components/shared';
import { LegacyHelpCentreIcon, LegacyTelegramIcon } from '@deriv/quill-icons/Legacy';
import { useTranslations } from '@deriv-com/translations';
import { Tooltip } from '@deriv-com/ui';

const HelpCentre = () => {
    const { localize } = useTranslations();

    return (
        <Tooltip
            as='a'
            className='app-footer__icon'
            href={standalone_routes.yoo}
            target='_blank'
            tooltipContent={localize('Help centre')}
        >
            <LegacyTelegramIcon iconSize='xs' />
        </Tooltip>
    );
};

export default HelpCentre;
