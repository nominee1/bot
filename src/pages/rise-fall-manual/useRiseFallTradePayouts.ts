import { useEffect, useMemo, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { applyDerivSessionMarketField } from '@/components/shared/utils/trading/deriv-session-contract-purchase';

type TradeMode = 'rise_fall' | 'higher_lower';
type ContractType = 'CALL' | 'PUT' | 'VANILLALONGCALL' | 'VANILLALONGPUT';

export type RiseFallPayouts = { up?: number; down?: number };

function contractPair(mode: TradeMode): { up: ContractType; down: ContractType } {
    if (mode === 'higher_lower') {
        return { up: 'VANILLALONGCALL', down: 'VANILLALONGPUT' };
    }
    return { up: 'CALL', down: 'PUT' };
}

function isVanillaContract(ct: ContractType): boolean {
    return ct === 'VANILLALONGCALL' || ct === 'VANILLALONGPUT';
}

/** Net profit if the contract wins (shown on purchase buttons). */
function profitFromProposal(resp: unknown, stake: number, contractType: ContractType): number {
    const proposal = (resp as {
        proposal?: { profit?: number; payout?: number; ask_price?: number };
    })?.proposal;
    const profit = Number(proposal?.profit ?? NaN);
    const payout = Number(proposal?.payout ?? NaN);
    const ask = Number(proposal?.ask_price ?? NaN);
    const cost = Number.isFinite(ask) && ask > 0 ? ask : stake;

    /* HL/vanilla: `profit` is often max loss (-stake); use payout − ask like VanillaCallPut. */
    if (isVanillaContract(contractType)) {
        if (Number.isFinite(payout) && payout > 0) {
            return Math.max(0, payout - cost);
        }
        return NaN;
    }

    if (Number.isFinite(profit) && profit > 0) return profit;
    if (Number.isFinite(payout) && payout > 0) return Math.max(0, payout - cost);
    return NaN;
}

export function useRiseFallTradePayouts({
    tradeMode,
    symbol,
    durationMin,
    stake,
    barrier,
    isConnected,
    tradingSocketGeneration,
}: {
    tradeMode: TradeMode;
    symbol: string;
    durationMin: number | '';
    stake: number | '';
    barrier: string;
    isConnected: boolean;
    tradingSocketGeneration: number;
}) {
    const [payouts, setPayouts] = useState<RiseFallPayouts>({});
    const [isLoading, setIsLoading] = useState(false);

    const pair = useMemo(() => contractPair(tradeMode), [tradeMode]);

    useEffect(() => {
        const amount = typeof stake === 'number' && Number.isFinite(stake) && stake >= 0.35 ? stake : NaN;
        const dur = typeof durationMin === 'number' && Number.isFinite(durationMin) && durationMin >= 1
            ? Math.floor(durationMin)
            : NaN;

        if (!isConnected || !Number.isFinite(amount) || !Number.isFinite(dur)) {
            setPayouts({});
            setIsLoading(false);
            return;
        }

        if (tradeMode === 'higher_lower' && !String(barrier ?? '').trim()) {
            setPayouts({});
            setIsLoading(false);
            return;
        }

        let cancelled = false;

        const run = async () => {
            setIsLoading(true);
            try {
                if (!api_base.api || api_base.api.connection.readyState !== 1) {
                    await api_base.init(true);
                }
                if (!api_base.api || api_base.api.connection.readyState !== 1) return;

                const base: Record<string, unknown> = {
                    proposal: 1,
                    amount,
                    basis: 'stake',
                    currency: 'USD',
                    duration: dur,
                    duration_unit: 'm',
                };

                const upPayload: Record<string, unknown> = {
                    ...base,
                    contract_type: pair.up,
                    ...(tradeMode === 'higher_lower' ? { barrier: barrier || '+0.00' } : {}),
                };
                const downPayload: Record<string, unknown> = {
                    ...base,
                    contract_type: pair.down,
                    ...(tradeMode === 'higher_lower' ? { barrier: barrier || '+0.00' } : {}),
                };

                applyDerivSessionMarketField(upPayload, symbol);
                applyDerivSessionMarketField(downPayload, symbol);

                const [upResp, downResp] = await Promise.all([
                    api_base.api.send(upPayload),
                    api_base.api.send(downPayload),
                ]);

                if (cancelled) return;

                setPayouts({
                    up: profitFromProposal(upResp, amount, pair.up),
                    down: profitFromProposal(downResp, amount, pair.down),
                });
            } catch {
                if (!cancelled) setPayouts({});
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        void run();

        return () => {
            cancelled = true;
        };
    }, [
        tradeMode,
        symbol,
        durationMin,
        stake,
        barrier,
        isConnected,
        tradingSocketGeneration,
        pair.up,
        pair.down,
    ]);

    const formatPayout = (side: 'up' | 'down') => {
        if (isLoading) return '…';
        const v = payouts[side];
        return Number.isFinite(v) ? `$${Number(v).toFixed(2)}` : '—';
    };

    return { payouts, isLoadingPayouts: isLoading, formatPayout };
}
