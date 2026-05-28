import React from 'react';
import { observer } from 'mobx-react-lite';
import { clearMirrorContractRegistry } from '@/components/shared/utils/trading/dual-account-contract-registry';
import {
    isDualAccountTradeEnabled,
    resolveDualTradePair,
    setDualAccountTradeEnabled,
    subscribeDualAccountTradeEnabled,
} from '@/components/shared/utils/trading/dual-account-trade';
import ToggleSwitch from '@/components/shared_ui/toggle-switch';
import { api_base } from '@/external/bot-skeleton';
import { useApiBase } from '@/hooks/useApiBase';
import { localize } from '@deriv-com/translations';
import { Tooltip } from '@deriv-com/ui';

const DualAccountTradeToggle = observer(() => {
    const { accountList, activeLoginid } = useApiBase();
    const [enabled, setEnabled] = React.useState(isDualAccountTradeEnabled);
    const pair = React.useMemo(() => resolveDualTradePair(), [accountList, activeLoginid]);
    const available = Boolean(pair);

    React.useEffect(() => {
        return subscribeDualAccountTradeEnabled(() => {
            setEnabled(isDualAccountTradeEnabled());
        });
    }, []);

    const handleToggle = () => {
        if (!available) return;
        const next = !enabled;
        setDualAccountTradeEnabled(next);
        setEnabled(next);
        if (next) {
            api_base.clearLegacyMirrorApis();
            api_base.prefetchMirrorTradingApi();
        } else {
            api_base.clearLegacyMirrorApis();
            clearMirrorContractRegistry();
        }
    };

    const tooltip = available
        ? enabled
            ? localize('Trades on demo account reflect on the real account')
            : localize('Trade on demo results reflect on the real account')
        : localize('Links demo trades to real account');

    return (
        <Tooltip tooltipContent={tooltip} tooltipPosition='bottom'>
            <div
                className={`app-header__dual-trade${!available ? ' app-header__dual-trade--disabled' : ''}${
                    enabled ? ' app-header__dual-trade--on' : ''
                }`}
                role='group'
                aria-label={localize('Demo and real account link')}
            >
                <span
                    className={`app-header__dual-trade-pill app-header__dual-trade-pill--demo${
                        enabled ? ' app-header__dual-trade-pill--active' : ''
                    }`}
                >
                    {localize('Demo')}
                </span>
                <ToggleSwitch
                    id='dual_account_trade_toggle'
                    is_enabled={enabled && available}
                    handleToggle={handleToggle}
                    name='dual_account_trade'
                    classNameLabel='app-header__dual-trade-switch'
                />
                <span
                    className={`app-header__dual-trade-pill app-header__dual-trade-pill--real${
                        enabled ? ' app-header__dual-trade-pill--active' : ''
                    }`}
                >
                    {localize('Real')}
                </span>
            </div>
        </Tooltip>
    );
});

export default DualAccountTradeToggle;
