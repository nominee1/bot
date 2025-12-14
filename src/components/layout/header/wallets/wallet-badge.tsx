import React from 'react';
import Badge from '@/components/shared_ui/badge';
import { localize } from '@deriv-com/translations';

type TWalletBadge = {
    is_real: boolean;
    label?: string;
};

const WalletBadge = ({ is_real, label }: TWalletBadge) => {
    return is_real ? (
        <Badge type='contained' background_color='blue' label={localize('Real')} custom_color='colored-background' />
    ) : (
        <Badge type='bordered' label={label?.toUpperCase() ?? ''} />
    );
};

export default WalletBadge;
