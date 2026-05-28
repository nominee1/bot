import { useCallback, useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { applyDerivSessionMarketField } from '@/components/shared/utils/trading/deriv-session-contract-purchase';
import {
    normalizeBarrierOffset,
    parseAvailableBarriersFromError,
    pickNextBarrier,
    RISE_FALL_CUSTOM_BARRIER,
} from './riseFallBarrierUtils';

type TProposal = {
    barrier_choices?: string[];
    contract_details?: { barrier?: string };
};

export function useRiseFallBarrierQuote({
    enabled,
    symbol,
    durationMin,
    stake,
    tradingSocketGeneration,
}: {
    enabled: boolean;
    symbol: string;
    durationMin: number | '';
    stake: number | '';
    tradingSocketGeneration: number;
}) {
    const [barrier, setBarrier] = useState('+0.00');
    const [barrierChoices, setBarrierChoices] = useState<string[]>([]);
    const [barrierSelect, setBarrierSelect] = useState('+0.00');
    const [barrierInput, setBarrierInput] = useState('+0.00');
    const [proposalStrike, setProposalStrike] = useState<number | null>(null);
    const [isQuoting, setIsQuoting] = useState(false);
    const [quoteError, setQuoteError] = useState<string | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const syncBarrierState = useCallback((next: string) => {
        setBarrier(next);
        setBarrierSelect(next);
        setBarrierInput(next);
    }, []);

    const applyChoices = useCallback(
        (choices: string[], keepCustom: boolean) => {
            if (!choices.length) {
                if (!keepCustom) setBarrierChoices([]);
                return;
            }
            setBarrierChoices(choices);
            if (keepCustom) return;
            const next = pickNextBarrier(choices, barrier, true);
            syncBarrierState(next);
        },
        [barrier, syncBarrierState]
    );

    const requestQuote = useCallback(async () => {
        if (!enabled) return;
        const dur = typeof durationMin === 'number' && durationMin >= 1 ? Math.floor(durationMin) : 1;
        const amt = typeof stake === 'number' && stake >= 0.35 ? stake : 1;

        if (!api_base.api || api_base.api.connection.readyState !== 1) {
            try {
                await api_base.init(true);
            } catch {
                return;
            }
        }
        if (!api_base.api || api_base.api.connection.readyState !== 1) return;

        setIsQuoting(true);
        setQuoteError(null);

        const payload: Record<string, unknown> = {
            proposal: 1,
            amount: amt,
            basis: 'stake',
            currency: 'USD',
            contract_type: 'VANILLALONGCALL',
            duration: dur,
            duration_unit: 'm',
            barrier: barrier || '+0.00',
        };
        applyDerivSessionMarketField(payload, symbol);

        try {
            const resp = (await api_base.api.send(payload)) as {
                error?: { message?: string };
                proposal?: TProposal;
            };
            if (resp?.error) throw new Error(resp.error.message || 'Proposal failed');

            const p = resp.proposal;
            const bc = Array.isArray(p?.barrier_choices) ? p.barrier_choices : [];
            const strikeStr = p?.contract_details?.barrier;
            const strike = strikeStr != null ? Number(strikeStr) : NaN;

            if (bc.length) {
                applyChoices(bc, barrierSelect === RISE_FALL_CUSTOM_BARRIER);
            }

            if (Number.isFinite(strike)) {
                setProposalStrike(strike);
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            const avail = parseAvailableBarriersFromError(msg);
            if (avail?.length) {
                applyChoices(avail, barrierSelect === RISE_FALL_CUSTOM_BARRIER);
            }
            setQuoteError(msg);
            setProposalStrike(null);
        } finally {
            setIsQuoting(false);
        }
    }, [
        enabled,
        symbol,
        durationMin,
        stake,
        barrier,
        barrierSelect,
        applyChoices,
        tradingSocketGeneration,
    ]);

    useEffect(() => {
        if (!enabled) return;
        setBarrierChoices([]);
        setProposalStrike(null);
        setQuoteError(null);
    }, [enabled, symbol]);

    useEffect(() => {
        if (!enabled) return undefined;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            void requestQuote();
        }, 400);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [enabled, symbol, durationMin, stake, barrier, requestQuote]);

    const onBarrierSelectChange = useCallback(
        (value: string) => {
            setBarrierSelect(value);
            if (value === RISE_FALL_CUSTOM_BARRIER) return;
            syncBarrierState(value);
        },
        [syncBarrierState]
    );

    const commitCustomBarrier = useCallback(() => {
        const norm = normalizeBarrierOffset(barrierInput);
        if (!norm) {
            setBarrierInput(barrier);
            return false;
        }
        syncBarrierState(norm);
        setBarrierSelect(RISE_FALL_CUSTOM_BARRIER);
        return true;
    }, [barrierInput, barrier, syncBarrierState]);

    const barrierOptions = barrierChoices.length ? barrierChoices : ['+0.00'];

    return {
        barrier,
        barrierChoices: barrierOptions,
        barrierSelect,
        barrierInput,
        setBarrierInput,
        proposalStrike,
        isQuoting,
        quoteError,
        onBarrierSelectChange,
        commitCustomBarrier,
        customBarrierMode: barrierSelect === RISE_FALL_CUSTOM_BARRIER,
    };
}
