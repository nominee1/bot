/**
 * SmartTrader / Asians tab contract catalog (from public/smarttrader contract_explanation_data).
 * Analysis is statistical on recent ticks — markets are random; scores are heuristics only.
 */

export type TAsiansContractId =
    | 'runs'
    | 'higherlower'
    | 'staysinout'
    | 'endsinout'
    | 'risefall'
    | 'touchnotouch'
    | 'asian'
    | 'highlowticks';

export type TAsiansSide =
    | 'only_up'
    | 'only_down'
    | 'higher'
    | 'lower'
    | 'stays_between'
    | 'goes_outside'
    | 'ends_between'
    | 'ends_outside'
    | 'rise'
    | 'fall'
    | 'touch'
    | 'no_touch'
    | 'asian_up'
    | 'asian_down'
    | 'high_tick'
    | 'low_tick';

export type TAsiansContractDef = {
    id: TAsiansContractId;
    label: string;
    apiTypes: string[];
    /** Short win rule shown in the tool */
    rule: string;
    /** Analysis heuristic description */
    heuristic: string;
    sides: ReadonlyArray<{ id: TAsiansSide; label: string; api: string }>;
    /** Default analysis window in ticks */
    defaultDurationTicks: number;
    /** Only Ups/Downs min successive ticks (Deriv min commonly 2) */
    minRunTicks?: number;
    barriers: 0 | 1 | 2;
};

export const ASIANS_CONTRACTS: readonly TAsiansContractDef[] = [
    {
        id: 'runs',
        label: 'Only Ups / Only Downs',
        apiTypes: ['RUNHIGH', 'RUNLOW'],
        rule: 'Only Ups wins if every tick after entry rises (no fall/equal). Only Downs is the mirror. Min duration commonly 2 ticks.',
        heuristic: 'Ranks markets by how often N successive ticks move in the same direction.',
        sides: [
            { id: 'only_up', label: 'Only Ups', api: 'RUNHIGH' },
            { id: 'only_down', label: 'Only Downs', api: 'RUNLOW' },
        ],
        defaultDurationTicks: 2,
        minRunTicks: 2,
        barriers: 0,
    },
    {
        id: 'higherlower',
        label: 'Higher / Lower',
        apiTypes: ['HIGHER', 'LOWER'],
        rule: 'Higher wins if exit is strictly above the barrier; Lower if strictly below. Equal barrier loses. Refund if fewer than 2 ticks.',
        heuristic: 'Uses a soft barrier (± recent tick step) and measures how often exit clears it over a duration.',
        sides: [
            { id: 'higher', label: 'Higher', api: 'HIGHER' },
            { id: 'lower', label: 'Lower', api: 'LOWER' },
        ],
        defaultDurationTicks: 5,
        barriers: 1,
    },
    {
        id: 'staysinout',
        label: 'Stays Between / Goes Outside',
        apiTypes: ['RANGE', 'UPORDOWN'],
        rule: 'Stays Between wins if price never touches High/Low during the period. Goes Outside wins if either barrier is touched.',
        heuristic: 'Scores containment vs breakout of a ±band around entry across sliding windows.',
        sides: [
            { id: 'stays_between', label: 'Stays Between', api: 'RANGE' },
            { id: 'goes_outside', label: 'Goes Outside', api: 'UPORDOWN' },
        ],
        defaultDurationTicks: 10,
        barriers: 2,
    },
    {
        id: 'endsinout',
        label: 'Ends Between / Outside',
        apiTypes: ['EXPIRYRANGE', 'EXPIRYMISS'],
        rule: 'Ends Between: Low < exit < High. Ends Outside: exit above High or below Low. Touching a barrier loses.',
        heuristic: 'Checks whether the window exit sits inside or outside a ±band of entry.',
        sides: [
            { id: 'ends_between', label: 'Ends Between', api: 'EXPIRYRANGE' },
            { id: 'ends_outside', label: 'Ends Outside', api: 'EXPIRYMISS' },
        ],
        defaultDurationTicks: 10,
        barriers: 2,
    },
    {
        id: 'risefall',
        label: 'Rise / Fall',
        apiTypes: ['CALL', 'PUT'],
        rule: 'Rise: exit > entry. Fall: exit < entry. Allow-equals variants use ≥ / ≤. Min 2 ticks between start and end.',
        heuristic: 'Win rate of exit vs entry over N-tick windows (no barrier).',
        sides: [
            { id: 'rise', label: 'Rise', api: 'CALL' },
            { id: 'fall', label: 'Fall', api: 'PUT' },
        ],
        defaultDurationTicks: 5,
        barriers: 0,
    },
    {
        id: 'touchnotouch',
        label: 'Touch / No Touch',
        apiTypes: ['ONETOUCH', 'NOTOUCH'],
        rule: 'Touches wins if the barrier is touched during the period; Does Not Touch if never touched. Refund if < 2 ticks.',
        heuristic: 'How often price reaches a relative barrier within the window.',
        sides: [
            { id: 'touch', label: 'Touches', api: 'ONETOUCH' },
            { id: 'no_touch', label: 'Does Not Touch', api: 'NOTOUCH' },
        ],
        defaultDurationTicks: 10,
        barriers: 1,
    },
    {
        id: 'asian',
        label: 'Asians (Up / Down)',
        apiTypes: ['ASIANU', 'ASIAND'],
        rule: 'Asian Up: last tick > average of ticks in the period (incl. entry + last). Asian Down: last < average. Equal loses.',
        heuristic: 'Compares last tick to the window average across rolling samples.',
        sides: [
            { id: 'asian_up', label: 'Asian Up', api: 'ASIANU' },
            { id: 'asian_down', label: 'Asian Down', api: 'ASIAND' },
        ],
        defaultDurationTicks: 8,
        barriers: 0,
    },
    {
        id: 'highlowticks',
        label: 'High / Low Ticks',
        apiTypes: ['TICKHIGH', 'TICKLOW'],
        rule: 'High Tick: selected tick is highest among the next five. Low Tick: selected is lowest among the next five. Duration fixed at 5 ticks.',
        heuristic: 'Which of the 5 positions is most often the extreme (bias toward early/late ticks).',
        sides: [
            { id: 'high_tick', label: 'High Tick', api: 'TICKHIGH' },
            { id: 'low_tick', label: 'Low Tick', api: 'TICKLOW' },
        ],
        defaultDurationTicks: 5,
        barriers: 0,
    },
] as const;

export const ASIANS_SCAN_SYMBOLS = [
    'R_10',
    '1HZ10V',
    '1HZ15V',
    'R_25',
    '1HZ25V',
    '1HZ30V',
    'R_50',
    '1HZ50V',
    'R_75',
    '1HZ75V',
    '1HZ90V',
    'R_100',
    '1HZ100V',
] as const;

export const ASIANS_HISTORY_TICK_COUNT = 200;

export function getContractDef(id: TAsiansContractId): TAsiansContractDef {
    return ASIANS_CONTRACTS.find(c => c.id === id) ?? ASIANS_CONTRACTS[0];
}
