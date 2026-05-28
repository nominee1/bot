import { isCrVirtualShadowLogin } from '@/utils/crVirtualBalanceShadow';

/**
 * CR7557018 shadow: contract types where we defer exit spot + P/L display (and Flipa win/loss sound)
 * by 1s after entry+exit data exist — Only Ups/Downs, Rise/Fall, Rise=/Fall=.
 */
export const CR7557018_DELAYED_POSITION_CONTRACT_TYPES = new Set<string>([
    'RUNHIGH',
    'RUNLOW',
    'CALL',
    'PUT',
    'CALLE',
    'PUTE',
]);

export function cr7557018ShouldDeferExitAndPayoutDisplay(
    loginid: string | undefined | null,
    contractType: string
): boolean {
    return isCrVirtualShadowLogin(loginid) && CR7557018_DELAYED_POSITION_CONTRACT_TYPES.has(contractType);
}
