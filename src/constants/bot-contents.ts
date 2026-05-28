type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    CHART: 2, 
    DENARA_PRO: 3, 
    INSTANT_FILL: 4, 
    SMART_TRADER: 5, 
    RISE_FALL: 6, 
    OVER_UNDER:7, 
    AVIATOR: 8,
    risk: 9,

});

/** Tab indices for `<Tabs>` children in `src/pages/main/main.tsx` (hash navigation order). */
export const MAIN_APP_TAB_INDEX = Object.freeze({
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    INSTANT_FILL: 2,
    SMART_TRADER_WORKSPACE: 3,
    PRO_AVIATOR: 4,
    MANUAL_TRADER: 5,
    READY_STRATEGIES: 6,
    DOUBLE_DOUBLE: 7,
    AUTO_STRATEGY: 8,
    RISK_CALCULATOR: 9,
    PARALLEL_COPY: 10,
    // DTRADER: 11, // re-enable with main.tsx DTrader tab
    CHALLENGE: 11,
});

/** Main tabs that show the desktop/mobile run-panel drawer. */
export const RUN_PANEL_VISIBLE_MAIN_TABS: readonly number[] = [
    MAIN_APP_TAB_INDEX.BOT_BUILDER,
    MAIN_APP_TAB_INDEX.INSTANT_FILL,
    MAIN_APP_TAB_INDEX.SMART_TRADER_WORKSPACE,
    MAIN_APP_TAB_INDEX.AUTO_STRATEGY,
    MAIN_APP_TAB_INDEX.READY_STRATEGIES,
];

/** Main tabs where run-panel summary uses `ready_strategy_panel` when attached. */
export const READY_STRATEGY_RUN_PANEL_MAIN_TABS: readonly number[] = [
    MAIN_APP_TAB_INDEX.INSTANT_FILL,
    MAIN_APP_TAB_INDEX.SMART_TRADER_WORKSPACE,
    MAIN_APP_TAB_INDEX.AUTO_STRATEGY,
    MAIN_APP_TAB_INDEX.READY_STRATEGIES,
];

export const MAX_STRATEGIES = 10;

export const TAB_IDS = ['id-dbot-dashboard', 'id-bot-builder', 'id-charts', 'id-charts', 'id-even-odd', 'id-rise-fall','id-over','id-risk'];

export const DEBOUNCE_INTERVAL_TIME = 500;
