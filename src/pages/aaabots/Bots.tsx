import React, { useCallback, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { BOT_FOLDERS, type BotCardStyle, type BotFolder, type FreeBot } from './bots-registry';
import { openBotInBuilder } from './open-bot-in-builder';
import TraderKitBotCard from './TraderKitBotCard';
import './Bots.scss';

type TToast = { msg: string; ok: boolean };

type TSearchHit = {
    bot: FreeBot;
    folderName: string;
    folderIcon: string;
    sectionName?: string;
};

const isDbAutomatedBot = (bot: FreeBot) => bot.id.startsWith('dbt-automatedbots_');

const normalizeSearch = (value: string) => value.trim().toLowerCase();

const botMatchesQuery = (bot: FreeBot, query: string) => {
    if (!query) return true;
    return bot.name.toLowerCase().includes(query);
};

const Bots = observer(() => {
    const { dashboard } = useStore();
    const { setActiveTab } = dashboard;

    const [folderId, setFolderId] = useState<string | null>(null);
    const [sectionId, setSectionId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [toast, setToast] = useState<TToast | null>(null);
    const pendingRef = useRef<Set<string>>(new Set());
    const toastTimerRef = useRef<number | null>(null);

    const folder = useMemo(() => BOT_FOLDERS.find(item => item.id === folderId) ?? null, [folderId]);

    const section = useMemo(() => {
        if (!folder?.sections?.length) return null;
        return folder.sections.find(item => item.id === sectionId) ?? folder.sections[0];
    }, [folder, sectionId]);

    const cardStyle: BotCardStyle = section?.style ?? folder?.style ?? 'osam';
    const sectionBots: FreeBot[] = section?.bots ?? folder?.bots ?? [];
    const searchNorm = normalizeSearch(searchQuery);

    const folderWideBots: FreeBot[] = useMemo(() => {
        if (!folder) return [];
        if (!folder.sections?.length) return folder.bots;
        const seen = new Set<string>();
        const list: FreeBot[] = [];
        for (const sec of folder.sections) {
            for (const bot of sec.bots) {
                if (seen.has(bot.id)) continue;
                seen.add(bot.id);
                list.push(bot);
            }
        }
        return list;
    }, [folder]);

    const bots: FreeBot[] = useMemo(() => {
        const source = searchNorm ? folderWideBots : sectionBots;
        return searchNorm ? source.filter(bot => botMatchesQuery(bot, searchNorm)) : source;
    }, [folderWideBots, sectionBots, searchNorm]);

    const globalHits: TSearchHit[] = useMemo(() => {
        if (folder || !searchNorm) return [];
        const seen = new Set<string>();
        const hits: TSearchHit[] = [];
        for (const item of BOT_FOLDERS) {
            const pushHit = (bot: FreeBot, sectionName?: string) => {
                if (!botMatchesQuery(bot, searchNorm) || seen.has(bot.id)) return;
                seen.add(bot.id);
                hits.push({
                    bot,
                    folderName: item.name,
                    folderIcon: item.icon,
                    sectionName,
                });
            };
            if (item.sections?.length) {
                for (const sec of item.sections) {
                    for (const bot of sec.bots) pushHit(bot, sec.name);
                }
            } else {
                for (const bot of item.bots) pushHit(bot);
            }
        }
        return hits;
    }, [folder, searchNorm]);

    const isDbTraders = folder?.id === 'dbtraders' || cardStyle === 'dbtraders';
    const isTraderKit = folder?.id === 'traderkit' || cardStyle === 'traderkit';
    const isMkorean = folder?.id === 'mkorean' || cardStyle === 'mkorean';
    const useSectionEmojiTabs = isDbTraders || isTraderKit || isMkorean;

    const showToast = useCallback((msg: string, ok: boolean) => {
        if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
        setToast({ msg, ok });
        toastTimerRef.current = window.setTimeout(() => setToast(null), ok ? 4000 : 6000);
    }, []);

    const openBot = useCallback(
        async (bot: FreeBot) => {
            if (pendingRef.current.has(bot.id) || loadingId === bot.id) return;
            pendingRef.current.add(bot.id);
            setLoadingId(bot.id);
            try {
                await openBotInBuilder(bot, setActiveTab);
                showToast(`"${bot.name}" loaded in Bot Builder`, true);
            } catch (e) {
                const message = e instanceof Error ? e.message : 'Unknown error';
                showToast(`Failed to load "${bot.name}": ${message}`, false);
            } finally {
                setLoadingId(prev => (prev === bot.id ? null : prev));
                pendingRef.current.delete(bot.id);
            }
        },
        [loadingId, setActiveTab, showToast]
    );

    const openFolder = (next: BotFolder) => {
        setFolderId(next.id);
        setSectionId(next.sections?.[0]?.id ?? null);
        setSearchQuery('');
    };

    const goBack = () => {
        setFolderId(null);
        setSectionId(null);
        setSearchQuery('');
    };

    const searchField = (
        <div className='bots-library__search'>
            <span className='bots-library__search-icon' aria-hidden='true'>
                ⌕
            </span>
            <input
                type='search'
                className='bots-library__search-input'
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder='Search bots by name…'
                aria-label='Search bots by name'
                autoComplete='off'
                spellCheck={false}
            />
            {searchQuery ? (
                <button
                    type='button'
                    className='bots-library__search-clear'
                    onClick={() => setSearchQuery('')}
                    aria-label='Clear search'
                >
                    ×
                </button>
            ) : null}
        </div>
    );

    const libraryClass = [
        'bots-library',
        !folder ? 'bots-library--folders' : '',
        folder && cardStyle === 'dollarprinter-scalper' ? 'bots-library--dp-scalper' : '',
        folder && cardStyle === 'dollarprinter-free' ? 'bots-library--dp-free' : '',
        folder && cardStyle === 'money8gg' ? 'bots-library--money8gg' : '',
        folder && cardStyle === 'exwager' ? 'bots-library--exwager' : '',
        folder && cardStyle === 'traderkit' ? 'bots-library--traderkit' : '',
        folder && cardStyle === 'mkorean' ? 'bots-library--mkorean' : '',
        folder && cardStyle === 'dbotspace-free' ? 'bots-library--dbotspace-free' : '',
        folder && cardStyle === 'dbotspace-scalper' ? 'bots-library--dbotspace-scalper' : '',
        folder && isDbTraders ? 'bots-library--dbtraders' : '',
    ]
        .filter(Boolean)
        .join(' ');

    const gridClass = isDbTraders
        ? 'dbt-bots__grid'
        : cardStyle === 'traderkit'
          ? 'tk-bots__grid'
          : cardStyle === 'dollarprinter-free' ||
              cardStyle === 'money8gg' ||
              cardStyle === 'exwager' ||
              cardStyle === 'mkorean' ||
              cardStyle === 'dbotspace-free'
            ? 'free-bots__grid'
            : cardStyle === 'dollarprinter-scalper' || cardStyle === 'dbotspace-scalper'
              ? 'scalper-bots__grid'
              : 'bots-library__grid';

    return (
        <div className={libraryClass}>
            {toast ? (
                <div
                    className={`bots-library__toast ${
                        toast.ok ? 'bots-library__toast--ok' : 'bots-library__toast--err'
                    }`}
                    role='status'
                    aria-live='polite'
                >
                    {toast.msg}
                </div>
            ) : null}

            {!folder ? (
                <>
                    <div className='bots-library__bg' aria-hidden='true' />
                    <header className='bots-library__header'>
                        <h2 className='bots-library__title'>🎲 Free bots</h2>
                        <p className='bots-library__subtitle'>
                            {searchNorm
                                ? `${globalHits.length} bot${globalHits.length === 1 ? '' : 's'} matching “${searchQuery.trim()}”`
                                : 'Open a folder to browse strategies, or search by name.'}
                        </p>
                        {searchField}
                    </header>
                    {searchNorm ? (
                        globalHits.length ? (
                            <div className='bots-library__grid bots-library__grid--search' role='list'>
                                {globalHits.map(({ bot, folderName, folderIcon, sectionName }) => {
                                    const isLoading = loadingId === bot.id;
                                    return (
                                        <article
                                            key={bot.id}
                                            className='bl-card bl-card--search'
                                            role='listitem'
                                            data-bot-id={bot.id}
                                        >
                                            <p className='bl-card__folder'>
                                                <span aria-hidden='true'>{folderIcon}</span>
                                                {folderName}
                                                {sectionName ? ` · ${sectionName}` : ''}
                                            </p>
                                            <h3 className='bl-card__title'>{bot.name}</h3>
                                            <p className='bl-card__desc'>
                                                {bot.description || 'Import this strategy into Bot Builder.'}
                                            </p>
                                            <button
                                                type='button'
                                                className='bl-card__btn'
                                                aria-label={`Load ${bot.name}`}
                                                aria-busy={isLoading}
                                                disabled={isLoading}
                                                onClick={() => void openBot(bot)}
                                            >
                                                {isLoading ? 'Loading...' : 'Load'}
                                            </button>
                                        </article>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className='bots-library__empty' role='status'>
                                No bots match “{searchQuery.trim()}”.
                            </p>
                        )
                    ) : (
                        <div className='bots-folders' role='list'>
                            {BOT_FOLDERS.map(item => (
                                <button
                                    key={item.id}
                                    type='button'
                                    className='bots-folder-card'
                                    role='listitem'
                                    onClick={() => openFolder(item)}
                                >
                                    <span className='bots-folder-card__icon' aria-hidden='true'>
                                        {item.icon}
                                    </span>
                                    <span className='bots-folder-card__body'>
                                        <span className='bots-folder-card__title'>{item.name}</span>
                                        <span className='bots-folder-card__desc'>{item.description}</span>
                                        <span className='bots-folder-card__meta'>
                                            {item.sections?.length
                                                ? `${item.sections.length} sections · ${item.bots.length} bots`
                                                : `${item.bots.length} bots`}
                                        </span>
                                    </span>
                                    <span className='bots-folder-card__chevron' aria-hidden='true'>
                                        ›
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </>
            ) : (
                <>
                    <div className='bots-library__nav'>
                        <button type='button' className='bots-library__back' onClick={goBack}>
                            ← Folders
                        </button>
                        <div className='bots-library__nav-title'>
                            <span className='bots-library__nav-icon' aria-hidden='true'>
                                {folder.icon}
                            </span>
                            <h2>{folder.name}</h2>
                        </div>
                        {searchField}
                    </div>

                    {folder.sections?.length ? (
                        useSectionEmojiTabs ? (
                            <div className='dbt-bots__tabs' role='tablist'>
                                {folder.sections.map(sec => {
                                    const active = (section?.id ?? folder.sections![0].id) === sec.id;
                                    return (
                                        <button
                                            key={sec.id}
                                            type='button'
                                            role='tab'
                                            aria-selected={active}
                                            className={`dbt-bots__tab dbt-bots__tab--${sec.id}${
                                                active ? ' dbt-bots__tab--active' : ''
                                            }`}
                                            onClick={() => setSectionId(sec.id)}
                                        >
                                            <span>{sec.name}</span>
                                            {sec.emoji ? (
                                                <span className='dbt-bots__tab-emoji' aria-hidden='true'>
                                                    {sec.emoji}
                                                </span>
                                            ) : null}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className='trading-bots__cards-container' role='tablist'>
                                {folder.sections.map(sec => {
                                    const active = (section?.id ?? folder.sections![0].id) === sec.id;
                                    return (
                                        <button
                                            key={sec.id}
                                            type='button'
                                            role='tab'
                                            aria-selected={active}
                                            className={`trading-bots__card trading-bots__card--light${
                                                active ? ' trading-bots__card--active' : ''
                                            }${sec.id === 'scalper' ? ' trading-bots__card--scalper' : ''}`}
                                            onClick={() => setSectionId(sec.id)}
                                        >
                                            <span className='trading-bots__card-label'>{sec.name}</span>
                                            {sec.id === 'scalper' ? (
                                                <span className='nav-scalper-bolt' aria-hidden='true'>
                                                    ⚡
                                                </span>
                                            ) : null}
                                        </button>
                                    );
                                })}
                            </div>
                        )
                    ) : null}

                    {cardStyle === 'dollarprinter-scalper' ? (
                        <div className='scalper-bots__hero'>
                            <div className='scalper-bots__hero-icon' aria-hidden='true'>
                                ⚡
                            </div>
                            <div>
                                <h3 className='scalper-bots__hero-title'>Scalper Bots</h3>
                                <p className='scalper-bots__hero-subtitle'>
                                    {section?.description ||
                                        '1-tick scalper bots with martingale recovery, TP/SL, and volatility switching.'}
                                </p>
                            </div>
                        </div>
                    ) : null}

                    {searchNorm && bots.length === 0 ? (
                        <p className='bots-library__empty' role='status'>
                            No bots match “{searchQuery.trim()}” in this folder.
                        </p>
                    ) : null}

                    {searchNorm && bots.length > 0 ? (
                        <div className='bots-library__grid bots-library__grid--search' role='list'>
                            {bots.map(bot => {
                                const isLoading = loadingId === bot.id;
                                return (
                                    <article
                                        key={bot.id}
                                        className='bl-card bl-card--search'
                                        role='listitem'
                                        data-bot-id={bot.id}
                                    >
                                        <h3 className='bl-card__title'>{bot.name}</h3>
                                        <p className='bl-card__desc'>
                                            {bot.description || 'Import this strategy into Bot Builder.'}
                                        </p>
                                        <button
                                            type='button'
                                            className='bl-card__btn'
                                            aria-label={`Load ${bot.name}`}
                                            aria-busy={isLoading}
                                            disabled={isLoading}
                                            onClick={() => void openBot(bot)}
                                        >
                                            {isLoading ? 'Loading...' : 'Load'}
                                        </button>
                                    </article>
                                );
                            })}
                        </div>
                    ) : null}

                    {!searchNorm ? (
                        <div className={gridClass} role='list'>
                            {bots.map(bot => {
                                const isLoading = loadingId === bot.id;

                                if (isDbTraders) {
                                    const automated =
                                        section?.id === 'automated' ||
                                        (section?.id !== 'normal' && isDbAutomatedBot(bot));
                                    return (
                                        <article
                                            key={bot.id}
                                            className={`modern-bot-card${
                                                automated ? ' modern-bot-card--automated' : ' modern-bot-card--normal'
                                            }`}
                                            role='listitem'
                                            data-bot-id={bot.id}
                                        >
                                            <span
                                                className={`modern-bot-card__badge${
                                                    automated
                                                        ? ' modern-bot-card__badge--auto'
                                                        : ' modern-bot-card__badge--normal'
                                                }`}
                                            >
                                                {automated ? 'AUTO' : 'NORMAL'}
                                            </span>
                                            <div className='modern-bot-card__content'>
                                                <div className='modern-bot-card__row'>
                                                    <div className='modern-bot-card__icon' aria-hidden='true'>
                                                        <span className='bot-icon'>⚡</span>
                                                    </div>
                                                    <h3 className='modern-bot-card__title'>{bot.name}</h3>
                                                </div>
                                                <p className='modern-bot-card__description'>
                                                    {bot.description || 'Import this strategy into Bot Builder.'}
                                                </p>
                                                <div className='modern-bot-card__actions'>
                                                    <button
                                                        type='button'
                                                        className='modern-bot-card__button'
                                                        aria-label={`Run ${bot.name}`}
                                                        aria-busy={isLoading}
                                                        disabled={isLoading}
                                                        onClick={() => void openBot(bot)}
                                                    >
                                                        <span aria-hidden='true'>⚡</span>
                                                        <span className='button-text'>
                                                            {isLoading ? 'Loading...' : 'Run Bot'}
                                                        </span>
                                                    </button>
                                                </div>
                                            </div>
                                        </article>
                                    );
                                }

                                if (cardStyle === 'traderkit') {
                                    return (
                                        <TraderKitBotCard
                                            key={bot.id}
                                            bot={bot}
                                            sectionId={section?.id ?? 'novaprime'}
                                            isLoading={isLoading}
                                            onLoad={() => void openBot(bot)}
                                        />
                                    );
                                }

                                if (
                                    cardStyle === 'dollarprinter-free' ||
                                    cardStyle === 'money8gg' ||
                                    cardStyle === 'exwager' ||
                                    cardStyle === 'mkorean' ||
                                    cardStyle === 'dbotspace-free'
                                ) {
                                    return (
                                        <article
                                            key={bot.id}
                                            className={`free-bot-card${
                                                cardStyle === 'money8gg' ? ' free-bot-card--money8gg' : ''
                                            }${cardStyle === 'exwager' ? ' free-bot-card--exwager' : ''}${
                                                cardStyle === 'mkorean' ? ' free-bot-card--mkorean' : ''
                                            }${cardStyle === 'dbotspace-free' ? ' free-bot-card--dbotspace' : ''}`}
                                            role='listitem'
                                            data-bot-id={bot.id}
                                        >
                                            <div className='free-bot-card__header'>
                                                <h3 className='free-bot-card__title'>{bot.name}</h3>
                                                <div className='free-bot-card__rating' aria-hidden='true'>
                                                    <span className='star'>★</span>
                                                    <span className='star'>★</span>
                                                    <span className='star'>★</span>
                                                    <span className='star'>★</span>
                                                    <span className='star'>★</span>
                                                </div>
                                            </div>
                                            <p className='free-bot-card__description'>
                                                {bot.description || 'Import this strategy into Bot Builder.'}
                                            </p>
                                            <div className='free-bot-card__badges'>
                                                {bot.isPremium ? (
                                                    <span className='free-bot-card__badge free-bot-card__badge--premium'>
                                                        Premium
                                                    </span>
                                                ) : (
                                                    <span className='free-bot-card__badge free-bot-card__badge--intermediate'>
                                                        Free
                                                    </span>
                                                )}
                                                <span className='free-bot-card__badge free-bot-card__badge--strategy'>
                                                    {bot.tag || 'Best Bot'}
                                                </span>
                                            </div>
                                            <button
                                                type='button'
                                                className='free-bot-card__load-btn'
                                                aria-label={`Load ${bot.name}`}
                                                aria-busy={isLoading}
                                                disabled={isLoading}
                                                onClick={() => void openBot(bot)}
                                            >
                                                {isLoading ? 'Loading...' : 'Load Bot'}
                                            </button>
                                        </article>
                                    );
                                }

                                if (cardStyle === 'dollarprinter-scalper' || cardStyle === 'dbotspace-scalper') {
                                    return (
                                        <article
                                            key={bot.id}
                                            className={`scalper-bot-card${
                                                cardStyle === 'dbotspace-scalper' ? ' scalper-bot-card--dbotspace' : ''
                                            }`}
                                            role='listitem'
                                            data-bot-id={bot.id}
                                        >
                                            <div className='scalper-bot-card__badges'>
                                                <span className='scalper-bot-card__badge scalper-bot-card__badge--speed'>
                                                    1 Tick
                                                </span>
                                                {bot.strategy ? (
                                                    <span className='scalper-bot-card__badge scalper-bot-card__badge--strategy'>
                                                        {bot.strategy}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <h3 className='scalper-bot-card__title'>{bot.name}</h3>
                                            <p className='scalper-bot-card__description'>
                                                {bot.description || 'Import this strategy into Bot Builder.'}
                                            </p>
                                            <button
                                                type='button'
                                                className='scalper-bot-card__load-btn'
                                                aria-label={`Load ${bot.name}`}
                                                aria-busy={isLoading}
                                                disabled={isLoading}
                                                onClick={() => void openBot(bot)}
                                            >
                                                {isLoading ? 'Loading...' : 'Load bot'}
                                            </button>
                                        </article>
                                    );
                                }

                                return (
                                    <article key={bot.id} className='bl-card' role='listitem' data-bot-id={bot.id}>
                                        <h3 className='bl-card__title'>{bot.name}</h3>
                                        <p className='bl-card__desc'>
                                            {bot.description || 'Import this strategy into Bot Builder.'}
                                        </p>
                                        <button
                                            type='button'
                                            className='bl-card__btn'
                                            aria-label={`Load ${bot.name}`}
                                            aria-busy={isLoading}
                                            disabled={isLoading}
                                            onClick={() => void openBot(bot)}
                                        >
                                            {isLoading ? 'Loading...' : 'Load'}
                                        </button>
                                    </article>
                                );
                            })}
                        </div>
                    ) : null}
                </>
            )}
        </div>
    );
});

export default Bots;
