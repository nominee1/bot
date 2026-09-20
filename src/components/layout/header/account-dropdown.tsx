import React from 'react';
import classNames from 'classnames';
import { createPortal } from 'react-dom';
import { formatMoney, getCurrencyDisplayCode } from '@/components/shared';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import './account-dropdown.scss';

export type TAccDropdownRow = {
    loginid: string;
    is_demo: boolean;
    is_selected: boolean;
    balance: number;
    currency: string;
};

type TAccountDropdownProps = {
    open: boolean;
    rows: TAccDropdownRow[];
    onClose: () => void;
    onSelect: (loginid: string) => void;
    triggerRef?: React.RefObject<HTMLElement | null>;
    /** Prefer bottom sheet (live mobile / embed). */
    forceActionSheet?: boolean;
};

const AccountDropdown = ({
    open,
    rows,
    onClose,
    onSelect,
    triggerRef,
    forceActionSheet = false,
}: TAccountDropdownProps) => {
    const { isDesktop } = useDevice();
    const useSheet = forceActionSheet || !isDesktop;
    const [anchor, setAnchor] = React.useState<{ top: number; right: number } | null>(null);

    React.useEffect(() => {
        if (!open) return undefined;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    React.useEffect(() => {
        if (!open || useSheet) {
            setAnchor(null);
            return undefined;
        }
        const update = () => {
            const el = triggerRef?.current;
            if (!el) {
                setAnchor(null);
                return;
            }
            const rect = el.getBoundingClientRect();
            setAnchor({
                top: rect.bottom + 8,
                right: Math.max(8, window.innerWidth - rect.right),
            });
        };
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [open, useSheet, triggerRef]);

    if (!open || typeof document === 'undefined') return null;

    const list = (
        <div className='acc-dropdown__list'>
            {rows.map(row => (
                <div className='acc-dropdown__account-wrapper' key={row.loginid}>
                    <div
                        className={classNames('acc-dropdown__account', {
                            'acc-dropdown__account--selected': row.is_selected,
                        })}
                        role='button'
                        tabIndex={0}
                        onClick={() => onSelect(row.loginid)}
                        onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                onSelect(row.loginid);
                            }
                        }}
                    >
                        <div
                            className={classNames('acc-dropdown__account-name', {
                                'acc-dropdown__account-name--real': !row.is_demo,
                                'acc-dropdown__account-name--demo': row.is_demo,
                            })}
                        >
                            {row.is_demo ? localize('Demo account') : localize('Real account')}
                        </div>
                        <div className='acc-dropdown__account-balance'>
                            {`${formatMoney(row.currency, row.balance, true)} ${getCurrencyDisplayCode(row.currency)}`}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );

    if (useSheet) {
        return createPortal(
            <>
                <div className='action-sheet__overlay' onClick={onClose} />
                <div className='action-sheet' role='dialog' aria-label={localize('Account switcher')}>
                    <div className='action-sheet__header'>
                        <div className='action-sheet__drag-handle'>
                            <div className='action-sheet__drag-indicator' />
                        </div>
                    </div>
                    <div className='action-sheet__content'>{list}</div>
                </div>
            </>,
            document.body
        );
    }

    return createPortal(
        <>
            <div className='acc-dropdown__backdrop' onClick={onClose} />
            <div
                className='acc-dropdown__container acc-dropdown__container--enter-done'
                style={
                    anchor
                        ? {
                              top: anchor.top,
                              right: anchor.right,
                              left: 'auto',
                          }
                        : undefined
                }
            >
                {list}
            </div>
        </>,
        document.body
    );
};

export default AccountDropdown;
