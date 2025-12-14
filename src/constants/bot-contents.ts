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

export const MAX_STRATEGIES = 10;

export const TAB_IDS = ['id-dbot-dashboard', 'id-bot-builder', 'id-charts', 'id-charts', 'id-even-odd', 'id-rise-fall','id-over','id-risk'];

export const DEBOUNCE_INTERVAL_TIME = 500;
