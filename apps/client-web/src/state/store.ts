import { create } from 'zustand'

export type PeerProtocol = 'https' | 'git' | 'ssh' | 'ipfs-api' | 'ipfs-gateway' | 'ipfs-swarm'

export interface PeerProbe {
  protocol: PeerProtocol
  port: number
  ok: boolean
  latencyMs?: number
  error?: string
}

export interface PeerInfo {
  host: string
  lastUpdateTs?: number // epoch millis from OPTIONS response
  probes: PeerProbe[]
  branches?: string[]
  repos?: string[]
  isProbing?: boolean
}

export interface TabInfo {
  id: string
  host?: string
  repo?: string
  path?: string
  title: string
  branches?: string[]
  currentBranch?: string
  reposList?: string[]
  isHome?: boolean
}

export interface AppState {
  // Peers state
  peers: PeerInfo[]
  setPeers: (hosts: string[]) => void
  updatePeer: (host: string, updater: (p: PeerInfo) => PeerInfo) => void
  setPeerProbing: (host: string, isProbing: boolean) => void
  addPeer: (host: string) => void
  removePeer: (host: string) => void

  // Tabs state
  tabs: TabInfo[]
  activeTabId: string | null
  openTab: (host: string, path?: string) => string // Returns tab ID
  closeTab: (tabId: string) => void // Won't close home tab
  setActiveTab: (tabId: string) => void
  updateTab: (tabId: string, updater: (t: TabInfo) => TabInfo) => void
  homeTabId: string

  // Auto-refresh state
  autoRefreshEnabled: boolean
  setAutoRefresh: (enabled: boolean) => void
  lastRefreshTs: number
  setLastRefreshTs: (ts: number) => void
}

let tabIdCounter = 0
function generateTabId(): string {
  return `tab-${++tabIdCounter}-${Date.now()}`
}

// Storage keys
const STORAGE_KEY_TABS = 'relay_tabs'
const STORAGE_KEY_ACTIVE_TAB = 'relay_active_tab'
const STORAGE_KEY_PEERS = 'relay_peers'

// Load persisted state from localStorage
function loadPersistedTabs() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_TABS)
    if (stored) {
      return JSON.parse(stored) as TabInfo[]
    }
  } catch (e) {
    console.error('Failed to load persisted tabs:', e)
  }
  return [
    {
      id: 'home',
      title: 'Home',
      isHome: true,
    } as TabInfo,
  ]
}

function loadPersistedActiveTab() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_ACTIVE_TAB)
    if (stored) {
      return stored
    }
  } catch (e) {
    console.error('Failed to load persisted active tab:', e)
  }
  return 'home'
}

// Update localStorage to persist state
function persistTabs(tabs: TabInfo[], activeTabId: string) {
  try {
    localStorage.setItem(STORAGE_KEY_TABS, JSON.stringify(tabs))
    localStorage.setItem(STORAGE_KEY_ACTIVE_TAB, activeTabId)
  } catch (e) {
    console.error('Failed to persist state:', e)
  }
}

function persistPeers(peers: PeerInfo[]) {
  try {
    const peerHosts = peers.map((p) => p.host)
    localStorage.setItem(STORAGE_KEY_PEERS, JSON.stringify(peerHosts))
  } catch (e) {
    console.error('Failed to persist peers:', e)
  }
}

export const useAppState = create<AppState>((set, get) => ({
  // Peers state
  peers: [],
  setPeers: (hosts) =>
    set(() => {
      const newPeers = hosts.map((h) => ({ host: h, probes: [] }))
      persistPeers(newPeers)
      return {
        peers: newPeers,
      }
    }),
  updatePeer: (host, updater) =>
    set((s) => ({
      peers: s.peers.map((p) => (p.host === host ? updater(p) : p)),
    })),
  setPeerProbing: (host, isProbing) =>
    set((s) => ({
      peers: s.peers.map((p) => (p.host === host ? { ...p, isProbing } : p)),
    })),
  addPeer: (host) =>
    set((s) => {
      // Sanitize the host input - remove protocol prefixes
      let cleanHost = host.trim()
      if (cleanHost.startsWith('http://')) {
        cleanHost = cleanHost.substring(7)
      } else if (cleanHost.startsWith('https://')) {
        cleanHost = cleanHost.substring(8)
      }
      
      // Avoid adding duplicates
      if (s.peers.some((p) => p.host === cleanHost)) {
        return s
      }
      const newPeers = [...s.peers, { host: cleanHost, probes: [] }]
      persistPeers(newPeers)
      return {
        peers: newPeers,
      }
    }),
  removePeer: (host) =>
    set((s) => {
      const newPeers = s.peers.filter((p) => p.host !== host)
      persistPeers(newPeers)
      return {
        peers: newPeers,
      }
    }),

  // Tabs state
  tabs: loadPersistedTabs(),
  activeTabId: loadPersistedActiveTab(),
  homeTabId: 'home',
  openTab: (host, path = '/README.md') => {
    const existingTab = get().tabs.find((t) => t.host === host && t.path === path)
    if (existingTab) {
      set({ activeTabId: existingTab.id })
      persistTabs(get().tabs, existingTab.id)
      return existingTab.id
    }

    const id = generateTabId()
    const newTab: TabInfo = {
      id,
      host,
      path,
      title: host,
    }
    set((s) => {
      const newTabs = [...s.tabs, newTab]
      persistTabs(newTabs, id)
      return {
        tabs: newTabs,
        activeTabId: id,
      }
    })
    return id
  },
  closeTab: (tabId) =>
    set((s) => {
      // Don't close home tab
      if (tabId === 'home') return s
      const tabs = s.tabs.filter((t) => t.id !== tabId)
      const activeTabId = s.activeTabId === tabId ? (tabs.find((t) => t.id === 'home') ?? tabs[0])?.id || 'home' : s.activeTabId
      persistTabs(tabs, activeTabId || 'home')
      return { tabs, activeTabId }
    }),
  setActiveTab: (tabId) => {
    set({ activeTabId: tabId })
    persistTabs(get().tabs, tabId)
  },
  updateTab: (tabId, updater) =>
    set((s) => {
      const newTabs = s.tabs.map((t) => (t.id === tabId ? updater(t) : t))
      persistTabs(newTabs, s.activeTabId || 'home')
      return {
        tabs: newTabs,
      }
    }),

  // Auto-refresh state
  autoRefreshEnabled: false,
  setAutoRefresh: (enabled) =>
    set({ autoRefreshEnabled: enabled }),
  lastRefreshTs: 0,
  setLastRefreshTs: (ts) =>
    set({ lastRefreshTs: ts }),
}))
