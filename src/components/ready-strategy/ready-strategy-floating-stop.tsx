import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Button from '@/components/shared_ui/button';
import { useStore } from '@/hooks/useStore';
import { LabelPairedSquareLgFillIcon } from '@deriv/quill-icons/LabelPaired';
import { Localize } from '@deriv-com/translations';
import './ready-strategy-floating-stop.scss';

type TReadyStrategyFloatingStop = {
    className?: string;
};

/** Matches TradeAnimation stop styling/slot (desktop fixed footer + mobile controls strip). */
const ReadyStrategyFloatingStop = observer(({ className }: TReadyStrategyFloatingStop) => {
    const { ready_strategy_panel } = useStore();

    return (
        <div className={classNames('ready-strategy-floating-stop', 'animation__wrapper', className)}>
            <Button
                id='db-ready-strategy__stop-button'
                className='animation__stop-button'
                icon={<LabelPairedSquareLgFillIcon fill='#fff' />}
                onClick={() => ready_strategy_panel.invokeStopStrategy()}
                primary
                has_effect
            >
                <Localize i18n_default_text='Stop' />
            </Button>
        </div>
    );
});

export default ReadyStrategyFloatingStop;
