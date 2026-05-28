/** Session keys for dashboard commodity-strip → tab + sub-view navigation */
export const QUICK_ACCESS_SESSION = {
  /** ViewToggle view: `botiframe` | `multiple` | `iframe` | `flipa` */
  viewToggle: 'denara_view_toggle_initial',
  /** ViewPercentage view: `viewstrategy` | `evenodd` | `reloadauto` | `bricktower` */
  smartTraderView: 'denara_smart_trader_view_initial',
} as const;

/** Same-tab events (sessionStorage alone does not remount already-visible tabs). */
export const QUICK_ACCESS_EVENTS = {
  viewToggle: 'denara-quick-access-view-toggle',
  smartTraderView: 'denara-quick-access-smart-trader-view',
} as const;
