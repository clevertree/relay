import { useEffect, useRef, useCallback } from 'react'
import { useAppState, type PeerInfo } from '../state/store'
import { fullProbePeer } from '../services/probing'
import './PeersView.css'

const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

interface PeersViewProps {
  onPeerPress?: (host: string) => void
}

export function PeersView({ onPeerPress }: PeersViewProps) {
  const peers = useAppState((s) => s.peers)
  const setPeers = useAppState((s) => s.setPeers)
  const updatePeer = useAppState((s) => s.updatePeer)
  const setPeerProbing = useAppState((s) => s.setPeerProbing)
  const setLastRefreshTs = useAppState((s) => s.setLastRefreshTs)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Probe a single peer
  const probePeer = useCallback(
    async (host: string) => {
      setPeerProbing(host, true)
      try {
        const result = await fullProbePeer(host)
        updatePeer(host, (p) => ({
          ...p,
          probes: result.probes,
          lastUpdateTs: result.lastUpdateTs,
          branches: result.branches,
          repos: result.repos,
          isProbing: false,
        }))
      } catch (e) {
        updatePeer(host, (p) => ({
          ...p,
          isProbing: false,
        }))
      }
    },
    [setPeerProbing, updatePeer],
  )

  // Probe all peers
  const probeAllPeers = useCallback(async () => {
    const currentPeers = useAppState.getState().peers
    await Promise.all(currentPeers.map((p) => probePeer(p.host)))
    setLastRefreshTs(Date.now())
  }, [probePeer, setLastRefreshTs])

  // Load peers from environment (simulate fetching from tracker)
  const loadAndProbePeers = useCallback(async () => {
    console.log('[loadAndProbePeers] Starting...')
    try {
      // Parse peers from environment variable or URL params
      const envPeers = await getPeersFromEnvironment()
      console.log('[loadAndProbePeers] Got peers:', envPeers)
      console.log('[loadAndProbePeers] Calling setPeers with:', envPeers)
      setPeers(envPeers)
      console.log('[loadAndProbePeers] setPeers called, current state:', useAppState.getState().peers)
      // Probe all peers after setting them
      await Promise.all(envPeers.map((host: string) => probePeer(host)))
      setLastRefreshTs(Date.now())
    } catch (e) {
      console.error('[loadAndProbePeers] Error:', e)
    }
  }, [setPeers, probePeer, setLastRefreshTs])

  // Setup auto-refresh interval (always enabled, 5 minutes)
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      probeAllPeers()
    }, AUTO_REFRESH_INTERVAL_MS)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [probeAllPeers])

  // Initial load
  useEffect(() => {
    console.log('[PeersView] Initial load useEffect triggered')
    loadAndProbePeers().catch((e) => console.error('[PeersView] Load error:', e))
    // Run only once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Get status and probe info
  const renderProbeStatus = (peer: PeerInfo) => {
    if (!peer.probes || peer.probes.length === 0) {
      return <span className="probe-status">Not probed</span>
    }

    const okProbes = peer.probes.filter((p) => p.ok)
    if (okProbes.length === 0) {
      return <span className="probe-status offline">Offline</span>
    }

    const latency = okProbes[0].latencyMs
    return (
      <span className="probe-status online">
        Online {latency ? `(${latency.toFixed(0)}ms)` : ''}
      </span>
    )
  }

  const handlePeerPress = (host: string) => {
    onPeerPress?.(host)
  }

  return (
    <div className="peers-container">
      <div className="peers-header">
        <h2>Peers</h2>
      </div>

      <div className="peers-list">
        {peers.length === 0 ? (
          <div className="peers-empty">
            <p>No peers configured. Set RELAY_PEERS environment variable.</p>
          </div>
        ) : (
          peers.map((peer) => (
            <div
              key={peer.host}
              className="peer-item"
              onClick={() => handlePeerPress(peer.host)}
            >
              <div className="peer-header">
                <div className="peer-host">
                  <span className="peer-name">{peer.host}</span>
                  {peer.isProbing && <span className="peer-loading">⟳</span>}
                </div>
                <div className="peer-status">
                  {renderProbeStatus(peer)}
                </div>
              </div>

              {peer.branches && peer.branches.length > 0 && (
                <div className="peer-info">
                  <span className="info-label">Branches:</span>
                  <span className="info-value">{peer.branches.join(', ')}</span>
                </div>
              )}

              {peer.repos && peer.repos.length > 0 && (
                <div className="peer-info">
                  <span className="info-label">Repos:</span>
                  <span className="info-value">{peer.repos.join(', ')}</span>
                </div>
              )}

              <button
                className="btn-open"
                onClick={(e) => {
                  e.stopPropagation()
                  handlePeerPress(peer.host)
                }}
              >
                Open →
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/**
 * Get peers from environment or URL params
 */
async function getPeersFromEnvironment(): Promise<string[]> {
  console.log('[getPeersFromEnvironment] Starting peer resolution...')
  
  // Check URL params first
  const params = new URLSearchParams(window.location.search)
  const urlPeers = params.get('peers')
  if (urlPeers) {
    console.log('[getPeersFromEnvironment] Loaded from URL params:', urlPeers)
    return urlPeers.split(';').map((p: string) => p.trim()).filter((p: string) => p.length > 0)
  }

  // Try to fetch config from Relay server first (runtime configuration)
  // This will use the RELAY_MASTER_PEER_LIST environment variable from the server
  try {
    console.log('[getPeersFromEnvironment] Trying to fetch /api/config from server...')
    // Try both HTTP and HTTPS to handle different deployment scenarios
    let response: Response | null = null
    const baseUrl = window.location.origin
    
    try {
      response = await fetch(`${baseUrl}/api/config`, { signal: AbortSignal.timeout(3000) })
    } catch (e) {
      console.log('[getPeersFromEnvironment] Failed to fetch from', `${baseUrl}/api/config`, e)
      // If we're on HTTPS, try HTTP fallback
      if (baseUrl.startsWith('https')) {
        const httpUrl = baseUrl.replace('https://', 'http://')
        response = await fetch(`${httpUrl}/api/config`, { signal: AbortSignal.timeout(3000) })
      }
    }
    
    if (response && response.ok) {
      const config = await response.json()
      if (config.peers && Array.isArray(config.peers) && config.peers.length > 0) {
        console.log('[getPeersFromEnvironment] Loaded from server config:', config.peers)
        return config.peers
      }
    }
  } catch (error) {
    console.log('[getPeersFromEnvironment] Failed to fetch server config:', error)
  }

  // Check Vite environment variables (only available after full rebuild with .env)
  const envPeers = import.meta.env.VITE_RELAY_MASTER_PEER_LIST
  console.log('[getPeersFromEnvironment] VITE_RELAY_MASTER_PEER_LIST:', envPeers)
  if (envPeers) {
    const peers = envPeers.split(';').map((p: string) => p.trim()).filter((p: string) => p.length > 0)
    console.log('[getPeersFromEnvironment] Loaded from build-time env:', peers)
    return peers
  }

  // Check for default local server
  const hostname = window.location.hostname
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    // Running locally, assume server on same host
    const port = window.location.port || '8088'
    console.log('[getPeersFromEnvironment] Using local server:', `${hostname}:${port}`)
    return [`${hostname}:${port}`]
  }

  // Try to get from global config (would be set by server)
  if ((window as any).RELAY_PEERS) {
    console.log('[getPeersFromEnvironment] Loaded from window.RELAY_PEERS:', (window as any).RELAY_PEERS)
    return (window as any).RELAY_PEERS.split(',').map((p: string) => p.trim())
  }

  // Fallback: try localhost
  console.log('[getPeersFromEnvironment] Fallback to localhost:8088')
  return ['localhost:8088']
}
