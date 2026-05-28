export type ReadyTradeStatus = 'pending' | 'open' | 'active' | 'won' | 'lost' | 'completed' | 'error';

/** Shared shape for Ready strategy trades (run panel + ready page). */
export type TReadyTrade = {
    id: string;
    contractType: string;
    stake: number;
    market: string;
    duration: number;
    status: ReadyTradeStatus;
    timestamp: Date;
    startTime?: Date;
    closeTime?: Date;
    profit?: number;
    entryValue?: number;
    exitValue?: number;
    currentValue?: number;
    ticksRemaining?: number;
    marketFormat?: string;
    temp?: boolean;
    errorReason?: string;
    errorDetails?: string;
    barrier?: number;
    virtual?: boolean;
    virtualLabel?: string;
};
