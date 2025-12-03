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
  host: string
  repo?: string
  path: string
  title: string
  branches?: string[]
  currentBranch?: string
  reposList?: string[]
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
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  updateTab: (tabId: string, updater: (t: TabInfo) => TabInfo) => void

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
  tabs: [],
  activeTabId: null,
  openTab: (host, path = '/README.md') => {
    const existingTab = get().tabs.find((t) => t.host === host && t.path === path)
    if (existingTab) {
      set({ activeTabId: existingTab.id })
      return existingTab.id
    }

    const id = generateTabId()
    const newTab: TabInfo = {
      id,
      host,
      path,
      title: host,
    }
    set((s) => ({
      tabs: [...s.tabs, newTab],
      activeTabId: id,
    }))
    return id
  },
  closeTab: (tabId) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== tabId)
      const activeTabId = s.activeTabId === tabId ? tabs[0]?.id ?? null : s.activeTabId
      return { tabs, activeTabId }
    }),
  setActiveTab: (tabId) =>
    set({ activeTabId: tabId }),
  updateTab: (tabId, updater) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? updater(t) : t)),
    })),

  // Auto-refresh state
  autoRefreshEnabled: false,
  setAutoRefresh: (enabled) =>
    set({ autoRefreshEnabled: enabled }),
  lastRefreshTs: 0,
  setLastRefreshTs: (ts) =>
    set({ lastRefreshTs: ts }),
}))
