import { action, computed, makeObservable, observable } from 'mobx';
import type { TReadyTrade } from '@/pages/aaaReadyStrategy/ready-trade-types';
import RootStore from './root-store';

/** Run-panel tile shape — Ready derives from trades; Smart Trader can push via `setSmartTraderRunPanelStats`. */
export type TRunPanelStatisticsSnapshot = {
    lost_contracts: number;
    number_of_runs: number;
    total_stake: number;
    total_payout: number;
    total_profit: number;
    won_contracts: number;
};

export default class ReadyStrategyPanelStore {
    is_attached = false;
    is_strategy_running = false;
    /** When set (Smart Trader / Strategy), overrides trade-derived `statistics` until cleared. */
    smart_trader_stats_snapshot: TRunPanelStatisticsSnapshot | null = null;
    /** Incremented when run-panel Reset clears stats — Ready listens and resets session. */
    run_panel_clear_generation = 0;
    trades: TReadyTrade[] = [];
    session_pl = 0;
    profit_loss_from_trades = 0;

    /** Instant Fill / Flipaa (etc.): global Run triggers this instead of Blockly when set. */
    start_strategy_fn: (() => void) | null = null;
    stop_strategy_fn: (() => void) | null = null;

    constructor(_root_store: RootStore) {
        makeObservable(this, {
            is_attached: observable,
            is_strategy_running: observable,
            smart_trader_stats_snapshot: observable,
            run_panel_clear_generation: observable,
            trades: observable,
            session_pl: observable,
            profit_loss_from_trades: observable,
            start_strategy_fn: observable,
            attach: action,
            detach: action,
            sync: action,
            setSmartTraderRunPanelStats: action,
            setStrategyRunning: action,
            signalRunPanelClear: action,
            setStartStrategyHandler: action,
            invokeStartStrategy: action,
            setStopStrategyHandler: action,
            invokeStopStrategy: action,
            statistics: computed,
            has_ready_summary_activity: computed,
        });
    }

    attach = () => {
        this.is_attached = true;
    };

    detach = () => {
        this.is_attached = false;
        this.is_strategy_running = false;
        this.trades = [];
        this.session_pl = 0;
        this.profit_loss_from_trades = 0;
        this.smart_trader_stats_snapshot = null;
        this.start_strategy_fn = null;
        this.stop_strategy_fn = null;
    };

    sync = (payload: { trades: TReadyTrade[]; session_pl: number; profit_loss_from_trades: number }) => {
        this.smart_trader_stats_snapshot = null;
        this.is_attached = true;
        this.trades = payload.trades;
        this.session_pl = payload.session_pl;
        this.profit_loss_from_trades = payload.profit_loss_from_trades;
    };

    /** Feed run-panel tiles from Instant Fill / Strategy-style bots (non-Ready trade list). Pass `null` to clear. */
    setSmartTraderRunPanelStats = (snapshot: TRunPanelStatisticsSnapshot | null) => {
        this.smart_trader_stats_snapshot = snapshot;
        if (snapshot) this.is_attached = true;
    };

    setStrategyRunning = (running: boolean) => {
        this.is_strategy_running = running;
    };

    /** Wired from run-panel `clearStat` after journal/transactions/summary clear (same as Blockly bot reset). */
    signalRunPanelClear = () => {
        this.run_panel_clear_generation += 1;
    };

    setStartStrategyHandler = (fn: (() => void) | null) => {
        this.start_strategy_fn = fn;
    };

    invokeStartStrategy = () => {
        this.start_strategy_fn?.();
    };

    setStopStrategyHandler = (fn: (() => void) | null) => {
        this.stop_strategy_fn = fn;
    };

    invokeStopStrategy = () => {
        this.stop_strategy_fn?.();
    };

    /** Enables run-panel Reset when Ready session has history while Blockly journals/transactions are empty. */
    get has_ready_summary_activity(): boolean {
        if (!this.is_attached) return false;
        if (this.smart_trader_stats_snapshot) {
            const s = this.smart_trader_stats_snapshot;
            return (
                s.number_of_runs > 0 ||
                s.total_stake !== 0 ||
                s.total_profit !== 0 ||
                s.won_contracts > 0 ||
                s.lost_contracts > 0
            );
        }
        return (
            this.trades.length > 0 ||
            this.session_pl !== 0 ||
            this.profit_loss_from_trades !== 0
        );
    }

    /** Mirrors keys used by `transactions.statistics` for run-panel tiles. */
    get statistics() {
        if (this.smart_trader_stats_snapshot) {
            return this.smart_trader_stats_snapshot;
        }
        const completed = this.trades.filter(t => !t.virtual && (t.status === 'won' || t.status === 'lost'));
        const total_stake = completed.reduce((s, t) => s + t.stake, 0);
        const sum_profit = completed.reduce((s, t) => s + (t.profit ?? 0), 0);
        return {
            total_stake,
            total_payout: total_stake + sum_profit,
            number_of_runs: completed.length,
            lost_contracts: completed.filter(t => t.status === 'lost').length,
            won_contracts: completed.filter(t => t.status === 'won').length,
            total_profit: this.session_pl,
        };
    }
}
