import {create} from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PeerProtocol = 'https' | 'git' | 'ssh' | 'ipfs-api' | 'ipfs-gateway' | 'ipfs-swarm';

export type PeerProbe = {
    protocol: PeerProtocol;
    port: number;
    ok: boolean;
    latencyMs?: number;
    error?: string;
};

export type PeerInfo = {
    host: string;
    lastUpdateTs?: number; // epoch millis from OPTIONS branchHeads
    probes: PeerProbe[];
    branches?: string[];
    repos?: string[];
    isProbing?: boolean;
};

export type TabInfo = {
    id: string;
    host?: string;
    repo?: string;
    path?: string;
    title: string;
    branches?: string[];
    currentBranch?: string;
    reposList?: string[];
    isHome?: boolean;
};

export type AppState = {
    // Peers state
    peers: PeerInfo[];
    setPeers: (hosts: string[]) => void;
    updatePeer: (host: string, updater: (p: PeerInfo) => PeerInfo) => void;
    setPeerProbing: (host: string, isProbing: boolean) => void;
    addPeer: (host: string) => void;
    removePeer: (host: string) => void;

    // Tabs state
    tabs: TabInfo[];
    activeTabId: string | null;
    openTab: (host: string, path?: string) => Promise<string>; // Returns tab ID
    closeTab: (tabId: string) => void; // Won't close home tab
    setActiveTab: (tabId: string) => void;
    updateTab: (tabId: string, updater: (t: TabInfo) => TabInfo) => void;
    homeTabId: string;

    // Auto-refresh state
    autoRefreshEnabled: boolean;
    setAutoRefresh: (enabled: boolean) => void;
    lastRefreshTs: number;
    setLastRefreshTs: (ts: number) => void;
};

let tabIdCounter = 0;

function generateTabId(): string {
    return `tab-${++tabIdCounter}-${Date.now()}`;
}

// Storage keys
const STORAGE_KEY_TABS = 'relay_tabs';
const STORAGE_KEY_ACTIVE_TAB = 'relay_active_tab';
const STORAGE_KEY_PEERS = 'relay_peers';

// Load persisted state from AsyncStorage
async function loadPersistedTabs(): Promise<TabInfo[]> {
    try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY_TABS);
        if (stored) {
            return JSON.parse(stored) as TabInfo[];
        }
    } catch (e) {
        console.error('Failed to load persisted tabs:', e);
    }
    return [
        {
            id: 'home',
            title: 'Home',
            isHome: true,
        } as TabInfo,
    ];
}

async function loadPersistedActiveTab(): Promise<string> {
    try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY_ACTIVE_TAB);
        if (stored) {
            return stored;
        }
    } catch (e) {
        console.error('Failed to load persisted active tab:', e);
    }
    return 'home';
}

// Update AsyncStorage to persist state
async function persistTabs(tabs: TabInfo[], activeTabId: string) {
    try {
        await AsyncStorage.setItem(STORAGE_KEY_TABS, JSON.stringify(tabs));
        await AsyncStorage.setItem(STORAGE_KEY_ACTIVE_TAB, activeTabId);
    } catch (e) {
        console.error('Failed to persist state:', e);
    }
}

async function persistPeers(peers: PeerInfo[]) {
    try {
        const peerHosts = peers.map((p) => p.host);
        await AsyncStorage.setItem(STORAGE_KEY_PEERS, JSON.stringify(peerHosts));
    } catch (e) {
        console.error('Failed to persist peers:', e);
    }
}

export const useAppState = create<AppState>((set, get) => ({
    // Peers state
    peers: [],
    setPeers: async (hosts) => {
        const newPeers = hosts.map((h) => ({host: h, probes: []}));
        await persistPeers(newPeers);
        set({
            peers: newPeers,
        });
    },
    updatePeer: (host, updater) =>
        set((s) => ({
            peers: s.peers.map((p) => (p.host === host ? updater(p) : p)),
        })),
    setPeerProbing: (host, isProbing) =>
        set((s) => ({
            peers: s.peers.map((p) => (p.host === host ? {...p, isProbing} : p)),
        })),
    addPeer: async (host) => {
        // Sanitize the host input - remove protocol prefixes
        let cleanHost = host.trim();

        // Avoid adding duplicates
        const currentPeers = get().peers;
        if (currentPeers.some((p) => p.host === cleanHost)) {
            return;
        }
        const newPeers = [...currentPeers, {host: cleanHost, probes: []}];
        await persistPeers(newPeers);
        set({
            peers: newPeers,
        });
    },
    removePeer: async (host) => {
        const newPeers = get().peers.filter((p) => p.host !== host);
        await persistPeers(newPeers);
        set({
            peers: newPeers,
        });
    },

    // Tabs state
    tabs: [],
    activeTabId: null,
    homeTabId: 'home',
    openTab: async (host, path = '/') => {
        const existingTab = get().tabs.find((t) => t.host === host && t.path === path);
        if (existingTab) {
            set({activeTabId: existingTab.id});
            await persistTabs(get().tabs, existingTab.id);
            return existingTab.id;
        }

        const id = generateTabId();
        const newTab: TabInfo = {
            id,
            host,
            path,
            title: host,
        };
        const newTabs = [...get().tabs, newTab];
        await persistTabs(newTabs, id);
        set((s) => ({
            tabs: newTabs,
            activeTabId: id,
        }));
        return id;
    },
    closeTab: async (tabId) => {
        // Don't close home tab
        if (tabId === 'home') return;
        const tabs = get().tabs.filter((t) => t.id !== tabId);
        const activeTabId = get().activeTabId === tabId ? (tabs.find((t) => t.id === 'home') ?? tabs[0])?.id || 'home' : get().activeTabId;
        await persistTabs(tabs, activeTabId || 'home');
        set({tabs, activeTabId});
    },
    setActiveTab: async (tabId) => {
        set({activeTabId: tabId});
        await persistTabs(get().tabs, tabId);
    },
    updateTab: (tabId, updater) =>
        set((s) => {
            const newTabs = s.tabs.map((t) => (t.id === tabId ? updater(t) : t));
            persistTabs(newTabs, s.activeTabId || 'home');
            return {
                tabs: newTabs,
            };
        }),

    // Auto-refresh state
    autoRefreshEnabled: false,
    setAutoRefresh: (enabled) =>
        set({autoRefreshEnabled: enabled}),
    lastRefreshTs: 0,
    setLastRefreshTs: (ts) =>
        set({lastRefreshTs: ts}),
}));

// Initialize persisted state
(async () => {
    const tabs = await loadPersistedTabs();
    const activeTabId = await loadPersistedActiveTab();
    useAppState.setState({tabs, activeTabId});
})();
