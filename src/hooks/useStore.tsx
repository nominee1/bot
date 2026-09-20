import { createContext, useContext, useState } from 'react';
import RootStore from '@/stores/root-store';
import { TWebSocket } from '@/Types';
import Bot from '../external/bot-skeleton/scratch/dbot';

const StoreContext = createContext<RootStore | null>(null);

const WINDOW_STORE_KEY = '__dbot_root_store__';

type TWindowStore = Window & { [WINDOW_STORE_KEY]?: RootStore };

const readWindowStore = (): RootStore | undefined => {
    if (typeof window === 'undefined') return undefined;
    return (window as TWindowStore)[WINDOW_STORE_KEY];
};

const writeWindowStore = (store: RootStore) => {
    if (typeof window === 'undefined') return;
    (window as TWindowStore)[WINDOW_STORE_KEY] = store;
};

export const getRootStore = (mockStore?: RootStore): RootStore => {
    if (mockStore) return mockStore;

    const existing = readWindowStore();
    if (existing) return existing;

    const store = new RootStore(Bot);
    writeWindowStore(store);
    return store;
};

type TStoreProvider = {
    children: React.ReactNode;
    mockStore?: RootStore;
};

const StoreProvider: React.FC<TStoreProvider> = ({ children, mockStore }) => {
    const [store] = useState(() => getRootStore(mockStore));

    return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
};

const useStore = (): RootStore => {
    return useContext(StoreContext) ?? getRootStore();
};

export { StoreProvider, useStore };

export const mockStore = (ws: TWebSocket) => new RootStore(Bot, ws);
