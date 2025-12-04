import {create} from 'zustand';

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
  isProbing?: boolean;
};

export type TabInfo = {
  id: string;
  host: string;
  repo?: string;
  path: string;
  title: string;
  branches?: string[];
  currentBranch?: string;
};

export type AppState = {
  // Peers state
  peers: PeerInfo[];
  setPeers: (hosts: string[]) => void;
  updatePeer: (host: string, updater: (p: PeerInfo) => PeerInfo) => void;
  setPeerProbing: (host: string, isProbing: boolean) => void;

  // Tabs state
  tabs: TabInfo[];
  activeTabId: string | null;
  openTab: (host: string, path?: string) => string; // Returns tab ID
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updater: (t: TabInfo) => TabInfo) => void;

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

export const useAppState = create<AppState>((set, get) => ({
  // Peers state
  peers: [],
  setPeers: (hosts) =>
    set({
      peers: hosts.map((h) => ({host: h, probes: []})),
    }),
  updatePeer: (host, updater) =>
    set((s) => ({
      peers: s.peers.map((p) => (p.host === host ? updater(p) : p)),
    })),
  setPeerProbing: (host, isProbing) =>
    set((s) => ({
      peers: s.peers.map((p) => (p.host === host ? {...p, isProbing} : p)),
    })),

  // Tabs state
  tabs: [],
  activeTabId: null,
  openTab: (host, path = '/') => {
    const existingTab = get().tabs.find((t) => t.host === host && t.path === path);
    if (existingTab) {
      set({activeTabId: existingTab.id});
      return existingTab.id;
    }

    const id = generateTabId();
    const newTab: TabInfo = {
      id,
      host,
      path,
      title: host,
    };
    set((s) => ({
      tabs: [...s.tabs, newTab],
      activeTabId: id,
    }));
    return id;
  },
  closeTab: (tabId) =>
    set((s) => {
      const newTabs = s.tabs.filter((t) => t.id !== tabId);
      let newActiveId = s.activeTabId;
      if (s.activeTabId === tabId) {
        // Select adjacent tab or null
        const idx = s.tabs.findIndex((t) => t.id === tabId);
        newActiveId = newTabs[idx]?.id ?? newTabs[idx - 1]?.id ?? null;
      }
      return {tabs: newTabs, activeTabId: newActiveId};
    }),
  setActiveTab: (tabId) => set({activeTabId: tabId}),
  updateTab: (tabId, updater) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? updater(t) : t)),
    })),

  // Auto-refresh state
  autoRefreshEnabled: true,
  setAutoRefresh: (enabled) => set({autoRefreshEnabled: enabled}),
  lastRefreshTs: 0,
  setLastRefreshTs: (ts) => set({lastRefreshTs: ts}),
}));
