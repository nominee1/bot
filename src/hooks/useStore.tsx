import { createContext, useContext, useState } from 'react';
import RootStore from '@/stores/root-store';
import { TWebSocket } from '@/Types';
import Bot from '../external/bot-skeleton/scratch/dbot';

const StoreContext = createContext<null | RootStore>(null);

let rootStoreSingleton: RootStore | null = null;

export const getRootStore = (mockStore?: RootStore): RootStore => {
    if (mockStore) return mockStore;
    if (!rootStoreSingleton) {
        rootStoreSingleton = new RootStore(Bot);
    }
    return rootStoreSingleton;
};

type TStoreProvider = {
    children: React.ReactNode;
    mockStore?: RootStore;
};

const StoreProvider: React.FC<TStoreProvider> = ({ children, mockStore }) => {
    const [store] = useState(() => getRootStore(mockStore));

    return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
};

const useStore = () => {
    return useContext(StoreContext) ?? getRootStore();
};

export { StoreProvider, useStore };

export const mockStore = (ws: TWebSocket) => new RootStore(Bot, ws);
