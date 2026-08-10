/**
 * Dbotweb Free Bots (#free_bots).
 * Source: https://www.dbotweb.com/app#free_bots
 *
 * SV Switcher XML is the authentic webpack asset from dbotweb.
 * Other strategies are reconstructed from dbotweb's public Athena strategy-block
 * definitions to match the free_bots card descriptions (API XMLs require Deriv login).
 */

import xml_00 from '@/xml/dbotweb/01_autoswitcher-v1.xml?raw';
import xml_01 from '@/xml/dbotweb/02_entrypoint-hunter-bot.xml?raw';
import xml_02 from '@/xml/dbotweb/03_dbot-hunter-bot.xml?raw';
import xml_03 from '@/xml/dbotweb/04_over-hunter-bot.xml?raw';
import xml_04 from '@/xml/dbotweb/05_digits-hunter.xml?raw';
import xml_05 from '@/xml/dbotweb/06_differs-hunter-bot.xml?raw';
import xml_06 from '@/xml/dbotweb/07_even-odd-hunter.xml?raw';
import xml_07 from '@/xml/dbotweb/08_sv-switcher.xml?raw';
import type { FreeBot } from './bots-types';

export const DBOTWEB_BOTS: FreeBot[] = [
    {
        id: 'dbw-autoswitcher-v1-00',
        name: 'Autoswitcher v1',
        xml: xml_00,
        description:
            'Waits for entry digit once, then runs continuously: Under 7 primary, loss switches to Over 2 with martingale; win returns to Under 7 at base stake ($1).',
        accent: '#22c55e',
        tag: 'Pro',
        isPremium: true,
        priceKes: 100,
    },
    {
        id: 'dbw-entrypoint-hunter-bot-01',
        name: 'Entrypoint Hunter Bot',
        xml: xml_01,
        description:
            'Autoswitcher v1 with entry point gate: set your entry digit at the top of Run once at start, then trades only when that digit appears on the last tick.',
        accent: '#a855f7',
        tag: 'Pro',
        isPremium: true,
        priceKes: 100,
    },
    {
        id: 'dbw-dbot-hunter-bot-02',
        name: 'Dbot Hunter Bot',
        xml: xml_02,
        description:
            'Entry point gate then trades Over (default barrier 2). On loss, recovers with Under 7 and martingale; on win returns to Over.',
        accent: '#ef4444',
        tag: 'Pro',
        isPremium: true,
        priceKes: 100,
    },
    {
        id: 'dbw-over-hunter-bot-03',
        name: 'Over Hunter Bot',
        xml: xml_03,
        description:
            'Entry point gate, then Over 1 → Over 2 loop. Any loss recovers with Over 4 until a win, then restarts at Over 1. Martingale on loss.',
        accent: '#f97316',
        tag: 'Pro',
        isPremium: true,
        priceKes: 100,
    },
    {
        id: 'dbw-digits-hunter-04',
        name: 'Digits Hunter',
        xml: xml_04,
        description:
            'Randy random digit strategy (Differs 0, Over 1–2, Differs 9, Under 8–7) with volatility rotation every trade and martingale recovery.',
        accent: '#3b82f6',
        tag: 'Pro',
        isPremium: true,
        priceKes: 100,
    },
    {
        id: 'dbw-differs-hunter-bot-05',
        name: 'Differs Hunter Bot',
        xml: xml_05,
        description:
            '6-step loop: Differs 0 → Over 1 → Over 2 → Differs 9 → Under 8 → Under 7 with even/odd recovery and martingale stake.',
        accent: '#06b6d4',
        tag: 'Pro',
        isPremium: true,
        priceKes: 100,
    },
    {
        id: 'dbw-even-odd-hunter-06',
        name: 'EVEN ODD HUNTER',
        xml: xml_06,
        description: 'Even/odd hunter strategy with adaptive entry and recovery logic.',
        accent: '#eab308',
        tag: 'Pro',
        isPremium: true,
        priceKes: 100,
    },
    {
        id: 'dbw-sv-switcher-07',
        name: 'SV Switcher',
        xml: xml_07,
        description:
            'Alternates Over 1 and Under 8 every trade. On any loss, recovers with Even/Odd (3 even → Even, 3 odd → Odd) until a win, then resumes Over/Under rotation.',
        accent: '#ec4899',
        tag: 'Pro',
        isPremium: true,
        priceKes: 100,
    },
];
