import { standalone_routes } from '@/components/shared';
import { LegacyDerivIcon, LegacyGoogleIcon } from '@deriv/quill-icons/Legacy';
import { useTranslations } from '@deriv-com/translations';
import { Tooltip } from '@deriv-com/ui';

const Deriv = () => {
    const { localize } = useTranslations();

    return (
        <Tooltip
            as='a'
            className='app-footer__icon'
            href={standalone_routes.denarapro}
            target='_blank'
            tooltipContent={localize('Go to denaradigitpro.com')}
        >
            <LegacyGoogleIcon iconSize='xs' />
        </Tooltip>
    );
};

export default Deriv;
