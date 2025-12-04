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

export const useAppState = create<AppState>((set, get) => ({
  // Peers state
  peers: [],
  setPeers: (hosts) =>
    set({
      peers: hosts.map((h) => ({ host: h, probes: [] })),
    }),
  updatePeer: (host, updater) =>
    set((s) => ({
      peers: s.peers.map((p) => (p.host === host ? updater(p) : p)),
    })),
  setPeerProbing: (host, isProbing) =>
    set((s) => ({
      peers: s.peers.map((p) => (p.host === host ? { ...p, isProbing } : p)),
    })),

  // Tabs state
  tabs: loadPersistedTabs(),
  activeTabId: loadPersistedActiveTab(),
  homeTabId: 'home',
  openTab: (host, path = '/README.md') => {
    const existingTab = get().tabs.find((t) => t.host === host && t.path === path)
    if (existingTab) {
      set({ activeTabId: existingTab.id })
      try {
        localStorage.setItem(STORAGE_KEY_ACTIVE_TAB, existingTab.id)
      } catch (e) {
        console.error('Failed to save active tab:', e)
      }
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
      try {
        localStorage.setItem(STORAGE_KEY_TABS, JSON.stringify(newTabs))
        localStorage.setItem(STORAGE_KEY_ACTIVE_TAB, id)
      } catch (e) {
        console.error('Failed to save tabs:', e)
      }
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
      const activeTabId = s.activeTabId === tabId ? (tabs.find((t) => t.id === 'home') ?? tabs[0])?.id ?? null : s.activeTabId
      try {
        localStorage.setItem(STORAGE_KEY_TABS, JSON.stringify(tabs))
        if (activeTabId) {
          localStorage.setItem(STORAGE_KEY_ACTIVE_TAB, activeTabId)
        }
      } catch (e) {
        console.error('Failed to save tabs:', e)
      }
      return { tabs, activeTabId }
    }),
  setActiveTab: (tabId) => {
    set({ activeTabId: tabId })
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE_TAB, tabId)
    } catch (e) {
      console.error('Failed to save active tab:', e)
    }
  },
  updateTab: (tabId, updater) =>
    set((s) => {
      const newTabs = s.tabs.map((t) => (t.id === tabId ? updater(t) : t))
      try {
        localStorage.setItem(STORAGE_KEY_TABS, JSON.stringify(newTabs))
      } catch (e) {
        console.error('Failed to save tabs:', e)
      }
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
