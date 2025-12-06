import {useCallback, useEffect, useRef, useState} from 'react'
import {type PeerInfo, useAppState} from '../state/store'
import {fullProbePeer} from '../services/probing'

const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

interface PeersViewProps {
    onPeerPress?: (host: string) => void
}

/**
 * Helper function to safely render array fields that might contain objects or strings
 */
function renderArrayField(items: any[]): string {
    if (!Array.isArray(items)) {
        return String(items)
    }

    return items
        .map((item) => {
            if (typeof item === 'string') {
                return item
            }
            if (typeof item === 'object' && item !== null && 'name' in item) {
                return item.name
            }
            if (typeof item === 'object' && item !== null && 'path' in item) {
                return item.path
            }
            // Fallback: just use the string representation
            return String(item)
        })
        .join(', ')
}

export function PeersView({onPeerPress}: PeersViewProps) {
    const peers = useAppState((s) => s.peers)
    const setPeers = useAppState((s) => s.setPeers)
    const updatePeer = useAppState((s) => s.updatePeer)
    const setPeerProbing = useAppState((s) => s.setPeerProbing)
    const setLastRefreshTs = useAppState((s) => s.setLastRefreshTs)
    const addPeer = useAppState((s) => s.addPeer)
    const removePeer = useAppState((s) => s.removePeer)
    const [newPeerInput, setNewPeerInput] = useState('')
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
            return <span
                className="text-xs px-2 py-1 rounded whitespace-nowrap bg-gray-100 text-gray-700">Not probed</span>
        }

        const okProbes = peer.probes.filter((p) => p.ok)
        if (okProbes.length === 0) {
            return <span
                className="text-xs px-2 py-1 rounded whitespace-nowrap bg-red-100/50 text-red-600 font-semibold">Offline</span>
        }

        const latency = okProbes[0].latencyMs
        return (
            <span className="text-xs px-2 py-1 rounded whitespace-nowrap bg-green-100/50 text-green-700 font-semibold">
        Online {latency ? `(${latency.toFixed(0)}ms)` : ''}
      </span>
        )
    }

    const handlePeerPress = (host: string) => {
        onPeerPress?.(host)
    }

    const handleAddPeer = (e: React.FormEvent) => {
        e.preventDefault()
        const trimmedInput = newPeerInput.trim()
        if (trimmedInput) {
            addPeer(trimmedInput)
            setNewPeerInput('')
            // Probe the new peer immediately
            probePeer(trimmedInput)
        }
    }

    const handleRemovePeer = (e: React.MouseEvent, host: string) => {
        e.stopPropagation()
        removePeer(host)
    }

    return (
        <div className="flex flex-col h-full bg-gray-50 border-r border-gray-200">
            <div className="p-4 border-b border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                    <img src="/icon.png" alt="Relay" width="24" height="24" className="flex-shrink-0"/>
                    <h2 className="m-0 text-xl font-semibold">Relay</h2>
                </div>

                {/* Add peer input form */}
                <form onSubmit={handleAddPeer} className="flex gap-2">
                    <input
                        type="text"
                        placeholder="host:port"
                        value={newPeerInput}
                        onChange={(e) => setNewPeerInput(e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
                    />
                    <button
                        type="submit"
                        className="px-3 py-2 bg-green-500 text-white rounded text-sm font-medium hover:bg-green-600 transition-colors"
                    >
                        Add
                    </button>
                </form>
            </div>

            <div className="flex-1 overflow-y-auto flex flex-col gap-1 p-2">
                {peers.length === 0 ? (
                    <div className="flex items-center justify-center h-full p-8 text-center text-gray-600">
                        <p className="m-0">No peers configured. Add one using the form above or set RELAY_PEERS
                            environment variable.</p>
                    </div>
                ) : (
                    peers.map((peer) => (
                        <div
                            key={peer.host}
                            className="p-4 bg-white border border-gray-300 rounded-lg cursor-pointer transition-all hover:bg-gray-50 hover:border-blue-500 hover:shadow-lg group"
                            onClick={() => handlePeerPress(peer.host)}
                        >
                            <div className="flex justify-between items-center gap-4 mb-2">
                                <div className="flex items-center gap-2 flex-1">
                                    <span className="font-semibold text-base text-gray-900">{peer.host}</span>
                                    {peer.isProbing && <span className="inline-block text-sm animation-spin">⟳</span>}
                                </div>
                                <div className="flex items-center gap-2">
                                    {renderProbeStatus(peer)}
                                    <button
                                        onClick={(e) => handleRemovePeer(e, peer.host)}
                                        className="px-2 py-1 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600 transition-all"
                                        title="Remove peer"
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>

                            {peer.branches && peer.branches.length > 0 && (
                                <div className="flex gap-2 mb-1 text-sm">
                                    <span className="font-semibold text-gray-600">Branches:</span>
                                    <span className="text-gray-500">{renderArrayField(peer.branches)}</span>
                                </div>
                            )}

                            {peer.repos && peer.repos.length > 0 && (
                                <div className="flex gap-2 mb-1 text-sm">
                                    <span className="font-semibold text-gray-600">Repos:</span>
                                    <span className="text-gray-500">{renderArrayField(peer.repos)}</span>
                                </div>
                            )}

                            <button
                                className="w-full px-2 py-2 mt-2 bg-blue-500 text-white border-none rounded cursor-pointer text-sm font-medium hover:bg-blue-600 transition-colors"
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

    // Check localStorage first (user-customized peer list)
    try {
        const stored = localStorage.getItem('relay_peers')
        if (stored) {
            const peers = JSON.parse(stored) as string[]
            if (Array.isArray(peers) && peers.length > 0) {
                // Sanitize: remove protocol prefixes from stored peers
                const cleanPeers = peers.map(p => {
                    let clean = p.trim()
                    if (clean.startsWith('http://')) clean = clean.substring(7)
                    if (clean.startsWith('https://')) clean = clean.substring(8)
                    return clean
                })
                console.log('[getPeersFromEnvironment] Loaded from localStorage (overrides env):', cleanPeers)
                return cleanPeers
            }
        }
    } catch (e) {
        console.log('[getPeersFromEnvironment] Failed to load from localStorage:', e)
    }

    // Check URL params
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
            response = await fetch(`${baseUrl}/api/config`, {signal: AbortSignal.timeout(3000)})
        } catch (e) {
            console.log('[getPeersFromEnvironment] Failed to fetch from', `${baseUrl}/api/config`, e)
            // If we're on HTTPS, try HTTP fallback
            if (baseUrl.startsWith('https')) {
                const httpUrl = baseUrl.replace('https://', 'http://')
                response = await fetch(`${httpUrl}/api/config`, {signal: AbortSignal.timeout(3000)})
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
    console.log('[getPeersFromEnvironment] Fallback to localhost:8080')
    return ['localhost:8080']
}
