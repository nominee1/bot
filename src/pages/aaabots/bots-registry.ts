/**
 * Free bots catalog — foldered collections (Osam, Dollarprinter, DBTraders, Money8GG, TraderKit, …).
 * Osam: https://www.osamtradinghub.pro/app#free_bots
 * Dollarprinter: https://www.dollarprinter.com/#trading_bots
 * DBTraders: https://www.dbtraders.com/#c
 * Money8GG: https://ai.money8gg.com/#best_bots
 * TraderKit: https://www.traderkit.pro/app#free_bots
 * Mkorean: https://www.mkoreanwwn.com/#Freebots
 * Dbotspace: https://www.dbotspace.com/#trading_bots
 * Exwager: https://exwager.com/#best_bots
 * Leila FX: https://www.leilafx.com/app#free_bots
 * Legacy Prime: https://www.legacyprime.live/app#free_bots / #premium_bots
 * EliteTraders: https://elitetraders.co.ke/#Free%20Bots and Advanced Elite
 * Dtraderdbot: https://dtraderdbot.com/#freebots
 */
import xml_22_EVEN_Autobot_1 from '@/xml/osam/EVEN_Autobot (1).xml?raw';
import xml_24_EVEN_MYTH_V2_0 from '@/xml/osam/EVEN_MYTH V2.0.xml?raw';
import xml_26_EVEN_ODD_MYTH_V1 from '@/xml/osam/EVEN_ODD MYTH V1.xml?raw';
import xml_30_H_L_auto_vault from '@/xml/osam/H_L auto vault.xml?raw';
import xml_32_Mega_Mind_V1 from '@/xml/osam/Mega_Mind V1.xml?raw';
import xml_31_MENTORSHIP_2_1 from '@/xml/osam/MENTORSHIP_2 (1).xml?raw';
import xml_23_ODD_Autobot_1_1 from '@/xml/osam/ODD_Autobot (1) (1).xml?raw';
import xml_25_ODD_MYTH_V3_0 from '@/xml/osam/ODD_MYTH V3.0.xml?raw';
import xml_01_Osam_Digit_switcher from '@/xml/osam/Osam Digit_switcher.xml?raw';
import xml_00_Osam_HnR from '@/xml/osam/Osam HnR.xml?raw';
import xml_02_Osam_Digit_Switcher from '@/xml/osam/Osam_Digit_Switcher.xml?raw';
import xml_03_Osam_Digit_Ticker from '@/xml/osam/Osam_Digit_Ticker.xml?raw';
import xml_09_Over_HitnRun from '@/xml/osam/Over HitnRun.xml?raw';
import xml_20_over_super_bot from '@/xml/osam/over super bot.xml?raw';
import xml_15_Over_Destroyer_v2 from '@/xml/osam/Over_Destroyer v2.xml?raw';
import xml_11_Over_HitnRun from '@/xml/osam/Over_HitnRun.xml?raw';
import xml_05_OVER_UNDER_AUTOBOT from '@/xml/osam/OVER_UNDER AUTOBOT.xml?raw';
import xml_13_Over_Destroyer from '@/xml/osam/Over-Destroyer.xml?raw';
import xml_17_Over_Pro_Bot from '@/xml/osam/Over-Pro Bot.xml?raw';
import xml_28_PATEL_with_Entry from '@/xml/osam/PATEL (with Entry).xml?raw';
import xml_29_PATEL_with_Entry from '@/xml/osam/PATEL-with-Entry.xml?raw';
import xml_06_Raziel_Over_Under from '@/xml/osam/Raziel Over Under.xml?raw';
import xml_07_Raziel_Over_Under from '@/xml/osam/Raziel-Over-Under.xml?raw';
import xml_08_Raziel_Scaling from '@/xml/osam/Raziel-Scaling.xml?raw';
import xml_12_Reborn_HnR_1 from '@/xml/osam/Reborn HnR (1).xml?raw';
import xml_27_the_Astro_E_O from '@/xml/osam/the Astro E_O.xml?raw';
import xml_04_TradeScript from '@/xml/osam/TradeScript.xml?raw';
import xml_19_Under_8_pro_bot from '@/xml/osam/Under 8 pro bot.xml?raw';
import xml_21_under_super_bot from '@/xml/osam/under super bot.xml?raw';
import xml_16_Under_Destroyer_v2 from '@/xml/osam/Under_Destroyer v2.xml?raw';
import xml_10_Under_HitnRun from '@/xml/osam/Under_HitnRun.xml?raw';
import xml_14_Under_Destroyer from '@/xml/osam/Under-Destroyer.xml?raw';
import xml_18_Under_Pro_Bot from '@/xml/osam/Under-Pro Bot.xml?raw';
import type { BotFolder, FreeBot } from './bots-types';
import { DBOTSPACE_BOTS, DBS_FREE_BOTS, DBS_SCALPER_BOTS } from './dbotspace-bots';
import { DBT_AUTOMATED_BOTS, DBT_FLOSSIN_BOTS } from './dbtraders-bots';
import { DP_FREE_BOTS, DP_SCALPER_BOTS } from './dollarprinter-bots';
import { DTRADERDBOT_BOTS } from './dtraderdbot-bots';
import { ELITETRADERS_ADVANCED_BOTS } from './elitetraders-advanced-bots';
import { ELITETRADERS_BOTS } from './elitetraders-bots';
import { EXWAGER_BOTS } from './exwager-bots';
import { LEGACYPRIME_BOTS } from './legacyprime-bots';
import { LEILAFX_BOTS } from './leilafx-bots';
import { MKOREAN_BOTS, MKOREAN_SECTIONS } from './mkorean-bots';
import { MONEY8GG_BOTS } from './money8gg-bots';
import { TRADERKIT_BOTS, TRADERKIT_SECTIONS } from './traderkit-bots';

export type { BotCardStyle, BotFolder, BotFolderSection, FreeBot, FreeBotTag } from './bots-types';

/** Matches Osam Trading Hub #free_bots catalog order. */
export const OSAM_BOTS: FreeBot[] = [
    {
        id: 'osam-osam-hnr',
        name: 'Osam HnR🤖',
        xml: xml_00_Osam_HnR,
        description: 'Osam even/odd hit-and-run strategy with quick recovery logic.',
        accent: '#22c55e',
        tag: 'Digits',
    },
    {
        id: 'osam-osam-digit_switcher',
        name: 'Osam Digit_switcher',
        xml: xml_01_Osam_Digit_switcher,
        description: 'Osam over/under bot that switches digit targets automatically.',
        accent: '#a855f7',
        tag: 'Digits',
    },
    {
        id: 'osam-osam_digit_switcher',
        name: 'Osam_Digit_Switcher🤖🤖',
        xml: xml_02_Osam_Digit_Switcher,
        description: 'Advanced Osam digit switcher for over/under volatility markets.',
        accent: '#ef4444',
        tag: 'Digits',
    },
    {
        id: 'osam-osam_digit_ticker',
        name: 'Osam_Digit_Ticker',
        xml: xml_03_Osam_Digit_Ticker,
        description: 'Osam over/under strategy tuned for digit ticker-style entries.',
        accent: '#f97316',
        tag: 'Digits',
    },
    {
        id: 'osam-tradescript',
        name: 'TradeScript',
        xml: xml_04_TradeScript,
        description: 'Over-digit strategy with Cascade Sniper Athena control and martingale recovery.',
        accent: '#3b82f6',
        tag: 'Digits',
    },
    {
        id: 'osam-over_under-autobot',
        name: 'OVER_UNDER AUTOBOT',
        xml: xml_05_OVER_UNDER_AUTOBOT,
        description: 'Fully automated over/under digit trading bot.',
        accent: '#06b6d4',
        tag: 'Digits',
    },
    {
        id: 'osam-raziel-over-under',
        name: 'Raziel Over Under',
        xml: xml_06_Raziel_Over_Under,
        description: 'Raziel over/under digit strategy with martingale recovery.',
        accent: '#eab308',
        tag: 'Digits',
    },
    {
        id: 'osam-raziel-over-under-2',
        name: 'Raziel-Over-Under',
        xml: xml_07_Raziel_Over_Under,
        description: 'Raziel over/under variant with scaled stake management.',
        accent: '#ec4899',
        tag: 'Digits',
    },
    {
        id: 'osam-raziel-scaling',
        name: 'Raziel-Scaling',
        xml: xml_08_Raziel_Scaling,
        description: 'Raziel over/under bot with progressive stake scaling.',
        accent: '#14b8a6',
        tag: 'Digits',
    },
    {
        id: 'osam-over-hitnrun',
        name: 'Over HitnRun',
        xml: xml_09_Over_HitnRun,
        description: 'Over digit hit-and-run strategy for fast in-and-out trades.',
        accent: '#8b5cf6',
        tag: 'Digits',
    },
    {
        id: 'osam-under_hitnrun',
        name: 'Under_HitnRun',
        xml: xml_10_Under_HitnRun,
        description: 'Under digit hit-and-run strategy for fast in-and-out trades.',
        accent: '#f43f5e',
        tag: 'Digits',
    },
    {
        id: 'osam-over_hitnrun',
        name: 'Over_HitnRun🤖',
        xml: xml_11_Over_HitnRun,
        description: 'Enhanced over hit-and-run bot with automated recovery.',
        accent: '#0ea5e9',
        tag: 'Digits',
    },
    {
        id: 'osam-reborn-hnr-1',
        name: 'Reborn HnR (1)',
        xml: xml_12_Reborn_HnR_1,
        description: 'Reborn even/odd hit-and-run strategy.',
        accent: '#22c55e',
        tag: 'Digits',
    },
    {
        id: 'osam-over-destroyer',
        name: 'Over-Destroyer💀',
        xml: xml_13_Over_Destroyer,
        description: 'Aggressive over digit destroyer with martingale recovery.',
        accent: '#a855f7',
        tag: 'Digits',
    },
    {
        id: 'osam-under-destroyer',
        name: 'Under-Destroyer💀',
        xml: xml_14_Under_Destroyer,
        description: 'Aggressive under digit destroyer with martingale recovery.',
        accent: '#ef4444',
        tag: 'Digits',
    },
    {
        id: 'osam-over_destroyer-v2',
        name: 'Over_Destroyer v2 🤖',
        xml: xml_15_Over_Destroyer_v2,
        description: 'Over destroyer v2 — refined over/under digit strategy.',
        accent: '#f97316',
        tag: 'Digits',
    },
    {
        id: 'osam-under_destroyer-v2',
        name: 'Under_Destroyer v2',
        xml: xml_16_Under_Destroyer_v2,
        description: 'Under destroyer v2 — refined over/under digit strategy.',
        accent: '#3b82f6',
        tag: 'Digits',
    },
    {
        id: 'osam-over-pro-bot',
        name: 'Over-Pro Bot💫',
        xml: xml_17_Over_Pro_Bot,
        description: 'Pro-level over digit bot for volatility indices.',
        accent: '#06b6d4',
        tag: 'Digits',
    },
    {
        id: 'osam-under-pro-bot',
        name: 'Under-Pro Bot💫',
        xml: xml_18_Under_Pro_Bot,
        description: 'Pro-level under digit bot for volatility indices.',
        accent: '#eab308',
        tag: 'Digits',
    },
    {
        id: 'osam-under-8-pro-bot',
        name: 'Under 8 pro bot💯',
        xml: xml_19_Under_8_pro_bot,
        description: 'Under 8 pro bot — precision under-digit entries.',
        accent: '#ec4899',
        tag: 'Digits',
    },
    {
        id: 'osam-over-super-bot',
        name: 'over super bot',
        xml: xml_20_over_super_bot,
        description: 'High-power over digit strategy for volatility markets.',
        accent: '#14b8a6',
        tag: 'Digits',
    },
    {
        id: 'osam-under-super-bot',
        name: 'under super bot',
        xml: xml_21_under_super_bot,
        description: 'High-power under digit strategy for volatility markets.',
        accent: '#8b5cf6',
        tag: 'Digits',
    },
    {
        id: 'osam-even_autobot-1',
        name: 'EVEN_Autobot (1)',
        xml: xml_22_EVEN_Autobot_1,
        description: 'Automated even-digit trading strategy.',
        accent: '#f43f5e',
        tag: 'Digits',
    },
    {
        id: 'osam-odd_autobot-1-1',
        name: 'ODD_Autobot (1) (1)',
        xml: xml_23_ODD_Autobot_1_1,
        description: 'Automated odd-digit trading strategy.',
        accent: '#0ea5e9',
        tag: 'Digits',
    },
    {
        id: 'osam-even_myth-v20',
        name: 'EVEN_MYTH V2.0 ',
        xml: xml_24_EVEN_MYTH_V2_0,
        description: 'Even-digit myth strategy v2 with recovery logic.',
        accent: '#22c55e',
        tag: 'Digits',
    },
    {
        id: 'osam-odd_myth-v30',
        name: 'ODD_MYTH V3.0',
        xml: xml_25_ODD_MYTH_V3_0,
        description: 'Odd-digit myth strategy v3 with recovery logic.',
        accent: '#a855f7',
        tag: 'Digits',
    },
    {
        id: 'osam-even_odd-myth-v1',
        name: 'EVEN_ODD MYTH V1',
        xml: xml_26_EVEN_ODD_MYTH_V1,
        description: 'Combined even/odd myth strategy for digit markets.',
        accent: '#ef4444',
        tag: 'Digits',
    },
    {
        id: 'osam-the-astro-e_o',
        name: 'the Astro E_O🤖',
        xml: xml_27_the_Astro_E_O,
        description: 'Astro even/odd bot for alternating digit predictions.',
        accent: '#f97316',
        tag: 'Digits',
    },
    {
        id: 'osam-patel-with-entry',
        name: 'PATEL (with Entry)',
        xml: xml_28_PATEL_with_Entry,
        description: 'Over/under bot with configurable entry conditions.',
        accent: '#3b82f6',
        tag: 'Digits',
    },
    {
        id: 'osam-patel-with-entry-2',
        name: 'PATEL-with-Entry',
        xml: xml_29_PATEL_with_Entry,
        description: 'PATEL over/under variant with custom entry rules.',
        accent: '#06b6d4',
        tag: 'Digits',
    },
    {
        id: 'osam-h_l-auto-vault',
        name: 'H_L auto vault',
        xml: xml_30_H_L_auto_vault,
        description: 'Higher/Lower auto vault strategy for rise/fall contracts.',
        accent: '#eab308',
        tag: 'Pro',
    },
    {
        id: 'osam-mentorship_2-1',
        name: 'MENTORSHIP_2 (1)',
        xml: xml_31_MENTORSHIP_2_1,
        description: 'Mentorship over/under strategy for guided digit trading.',
        accent: '#ec4899',
        tag: 'Digits',
    },
    {
        id: 'osam-mega_mind-v1',
        name: 'Mega_Mind V1👻',
        xml: xml_32_Mega_Mind_V1,
        description: 'Mega Mind over/under bot with smart digit analysis.',
        accent: '#14b8a6',
        tag: 'Digits',
    },
];

export const BOT_FOLDERS: BotFolder[] = [
    {
        id: 'osam',
        name: 'Collection 1',
        description: 'Collection 1 free bots',
        icon: '📁',
        style: 'osam',
        bots: OSAM_BOTS,
    },
    {
        id: 'dollarprinter',
        name: 'Collection 2',
        description: 'Collection 2 free bots',
        icon: '📁',
        style: 'dollarprinter-free',
        bots: [...DP_FREE_BOTS, ...DP_SCALPER_BOTS],
        sections: [
            {
                id: 'free',
                name: 'Free Bots',
                style: 'dollarprinter-free',
                bots: DP_FREE_BOTS,
                description: 'Browse ready-made trading strategies.',
            },
            {
                id: 'scalper',
                name: 'Scalper Bots',
                style: 'dollarprinter-scalper',
                bots: DP_SCALPER_BOTS,
                description: '1-tick scalper bots with martingale recovery, TP/SL, and volatility switching.',
            },
        ],
    },
    {
        id: 'dbtraders',
        name: 'Collection 3',
        description: 'Collection 3 free bots',
        icon: '📁',
        style: 'dbtraders',
        bots: [...DBT_AUTOMATED_BOTS, ...DBT_FLOSSIN_BOTS],
        sections: [
            {
                id: 'all',
                name: 'All',
                emoji: '👑',
                style: 'dbtraders',
                bots: [...DBT_AUTOMATED_BOTS, ...DBT_FLOSSIN_BOTS],
            },
            {
                id: 'automated',
                name: 'Automated',
                emoji: '⚡',
                style: 'dbtraders',
                bots: DBT_AUTOMATED_BOTS,
            },
            {
                id: 'normal',
                name: 'Normal',
                emoji: '🍵',
                style: 'dbtraders',
                bots: DBT_FLOSSIN_BOTS,
            },
        ],
    },
    {
        id: 'money8gg',
        name: 'Collection 4',
        description: 'Collection 4 free bots',
        icon: '📁',
        style: 'money8gg',
        bots: MONEY8GG_BOTS,
    },
    {
        id: 'traderkit',
        name: 'Collection 5',
        description: 'Collection 5 free bots',
        icon: '📁',
        style: 'traderkit',
        bots: TRADERKIT_BOTS,
        sections: [
            {
                id: 'all',
                name: 'All',
                emoji: '👑',
                style: 'traderkit',
                bots: TRADERKIT_BOTS,
            },
            ...TRADERKIT_SECTIONS,
        ],
    },
    {
        id: 'mkorean',
        name: 'Collection 6',
        description: 'Collection 6 free bots',
        icon: '📁',
        style: 'mkorean',
        bots: MKOREAN_BOTS,
        sections: MKOREAN_SECTIONS,
    },
    {
        id: 'dbotspace',
        name: 'Collection 7',
        description: 'Collection 7 free bots',
        icon: '📁',
        style: 'dbotspace-free',
        bots: DBOTSPACE_BOTS,
        sections: [
            {
                id: 'free',
                name: 'Free Bots',
                style: 'dbotspace-free',
                bots: DBS_FREE_BOTS,
                description: 'Premium CMV / Greenflakes / Over-Under recovery bots.',
            },
            {
                id: 'scalper',
                name: 'Scalper Bots',
                style: 'dbotspace-scalper',
                bots: DBS_SCALPER_BOTS,
                description: '1-tick scalpers with martingale recovery.',
            },
        ],
    },
    {
        id: 'exwager',
        name: 'Collection 8',
        description: 'Collection 8 free bots',
        icon: '📁',
        style: 'exwager',
        bots: EXWAGER_BOTS,
    },
    {
        id: 'leilafx',
        name: 'Collection 9',
        description: 'Collection 9 free bots',
        icon: '📁',
        style: 'leilafx',
        bots: LEILAFX_BOTS,
    },
    {
        id: 'legacyprime',
        name: 'Collection 10',
        description: 'Legacy Prime free bots',
        icon: '📁',
        style: 'osam',
        bots: LEGACYPRIME_BOTS,
    },
    {
        id: 'elitetraders',
        name: 'Collection 11',
        description: 'EliteTraders Free Bots',
        icon: '📁',
        style: 'osam',
        bots: ELITETRADERS_BOTS,
    },
    {
        id: 'elitetraders-advanced',
        name: 'Collection 12',
        description: 'EliteTraders Advanced Elite speed bots',
        icon: '📁',
        style: 'osam',
        bots: ELITETRADERS_ADVANCED_BOTS,
    },
    {
        id: 'dtraderdbot',
        name: 'Collection 13',
        description: 'Dtraderdbot Free Bots',
        icon: '📁',
        style: 'osam',
        bots: DTRADERDBOT_BOTS,
    },
];

/** Flat list of every bot across folders (legacy helpers). */
export const FREE_BOTS: FreeBot[] = BOT_FOLDERS.flatMap(folder => folder.bots);

/** @deprecated Prefer FREE_BOTS[0]; kept for any legacy Default Bot imports. */
export const DEFAULT_BOT: FreeBot = OSAM_BOTS[0];
