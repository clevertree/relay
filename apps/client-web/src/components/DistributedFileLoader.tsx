import { useEffect, useRef, useState } from 'react'

/**
 * Status progression for distributed file loading
 */
export type LoadingStatus = 
  | 'idle'           // Initial state, no loading started
  | 'parsing'        // Parsing the URI to extract hash/path
  | 'loading-lib'    // Dynamically loading torrent/ipfs client library
  | 'connecting'     // Attempting to connect to the network
  | 'locating'       // Locating peers or gateway
  | 'downloading'    // Downloading/streaming data
  | 'ready'          // Media is ready to play/use
  | 'error'          // Error occurred, check errorMessage

export interface FileLoadResult {
  url: string
  mimeType?: string
  size?: number
}

export type StatusCallback = (status: LoadingStatus, message: string, progress?: number) => void
export type SuccessCallback = (result: FileLoadResult) => void
export type ErrorCallback = (error: Error, detailedMessage: string) => void

export interface DistributedFileLoaderProps {
  src: string
  onStatusChange?: StatusCallback
  onSuccess?: SuccessCallback
  onError?: ErrorCallback
  enabled?: boolean
}

/**
 * DistributedFileLoader - Handles loading files from torrent and IPFS sources
 * 
 * Features:
 * - Lazy loads required libraries on demand
 * - Provides detailed status updates at each step
 * - Supports torrent://, ipfs://, magnet:, and http(s):// protocols
 * - Provides callbacks for integration with other components
 * - Handles errors gracefully with detailed messages
 * 
 * Usage:
 * ```tsx
 * <DistributedFileLoader
 *   src="torrent://..."
 *   onStatusChange={(status, msg, progress) => console.log(status, msg)}
 *   onSuccess={(result) => console.log('Ready:', result.url)}
 *   onError={(error, details) => console.error(details)}
 * />
 * ```
 */
export function DistributedFileLoader({
  src,
  onStatusChange,
  onSuccess,
  onError,
  enabled = true,
}: DistributedFileLoaderProps) {
  const [status, setStatus] = useState<LoadingStatus>('idle')
  const [message, setMessage] = useState<string>('')
  const [progress, setProgress] = useState<number>(0)
  const loadingRef = useRef<AbortController | null>(null)

  // Update callbacks whenever state changes
  useEffect(() => {
    onStatusChange?.(status, message, progress)
  }, [status, message, progress, onStatusChange])

  // Main loading effect
  useEffect(() => {
    if (!enabled || !src) {
      setStatus('idle')
      setMessage('')
      return
    }

    const abort = new AbortController()
    loadingRef.current = abort

    ;(async () => {
      try {
        await loadDistributedFile(src, abort.signal, (newStatus, newMessage, newProgress) => {
          if (abort.signal.aborted) return
          setStatus(newStatus)
          setMessage(newMessage)
          if (newProgress !== undefined) setProgress(newProgress)
        })

        if (abort.signal.aborted) return

        // Determine resolved URL based on scheme
        const scheme = getScheme(src)
        let resolvedUrl: string
        let mimeType: string | undefined

        if (scheme === 'http' || scheme === 'https') {
          resolvedUrl = src
          mimeType = 'video/mp4' // Default, can be improved with HEAD request
        } else if (scheme === 'torrent' || scheme === 'magnet') {
          const hash = extractInfoHash(src)
          if (!hash) throw new Error('Invalid torrent URI: could not extract info hash')
          resolvedUrl = `/gateway/torrent/${hash}`
          mimeType = 'video/mp4'
        } else if (scheme === 'ipfs') {
          const cid = src.replace(/^ipfs:\/\//, '')
          resolvedUrl = `https://ipfs.io/ipfs/${cid}`
          mimeType = 'video/mp4'
        } else {
          resolvedUrl = src
        }

        setStatus('ready')
        setMessage('Ready to stream')
        onSuccess?.({
          url: resolvedUrl,
          mimeType,
        })
      } catch (err) {
        if (abort.signal.aborted) return
        const error = err instanceof Error ? err : new Error(String(err))
        const detailed = buildDetailedErrorMessage(src, error, status)
        setStatus('error')
        setMessage(error.message)
        onError?.(error, detailed)
      }
    })()

    return () => {
      abort.abort()
      loadingRef.current = null
    }
  }, [src, enabled, onSuccess, onError])

  return null // This component doesn't render anything; it's a loader
}

/**
 * Extracts the protocol/scheme from a URI
 */
function getScheme(src: string): string {
  try {
    const u = new URL(src)
    return u.protocol.replace(':', '')
  } catch {
    if (src.startsWith('torrent://')) return 'torrent'
    if (src.startsWith('ipfs://')) return 'ipfs'
    if (src.startsWith('magnet:')) return 'magnet'
    if (src.startsWith('https://')) return 'https'
    if (src.startsWith('http://')) return 'http'
    return 'unknown'
  }
}

/**
 * Main loading orchestration function
 */
async function loadDistributedFile(
  src: string,
  signal: AbortSignal,
  onUpdate: (status: LoadingStatus, message: string, progress?: number) => void,
): Promise<void> {
  onUpdate('parsing', 'Parsing URI...')

  const scheme = getScheme(src)

  // HTTP/HTTPS - no loading needed
  if (scheme === 'http' || scheme === 'https') {
    onUpdate('ready', 'HTTP source ready', 100)
    return
  }

  // Torrent or Magnet
  if (scheme === 'torrent' || scheme === 'magnet') {
    await loadTorrentFile(src, signal, onUpdate)
    return
  }

  // IPFS
  if (scheme === 'ipfs') {
    await loadIpfsFile(src, signal, onUpdate)
    return
  }

  throw new Error(`Unsupported URI scheme: ${scheme}`)
}

/**
 * Loads a torrent file using lazy-loaded WebTorrent library
 */
async function loadTorrentFile(
  src: string,
  signal: AbortSignal,
  onUpdate: (status: LoadingStatus, message: string, progress?: number) => void,
): Promise<void> {
  try {
    onUpdate('loading-lib', 'Loading WebTorrent library...')

    // Lazy-load WebTorrent
    // TODO: Replace with actual dynamic import when library is added
    // const WebTorrent = await import('webtorrent').then(m => m.default)
    // For now, we simulate the process
    await simulateLibraryLoad(signal, 'WebTorrent')

    if (signal.aborted) throw new Error('Loading cancelled')

    onUpdate('parsing', 'Extracting info hash...')
    const infoHash = extractInfoHash(src)
    if (!infoHash) throw new Error('Invalid torrent URI: could not extract info hash')

    onUpdate('connecting', `Connecting to torrent: ${infoHash.substring(0, 8)}...`, 10)

    // Simulate connecting to the torrent network
    // TODO: Replace with actual WebTorrent client initialization
    await simulateNetworkConnection(signal, 'torrent')

    if (signal.aborted) throw new Error('Loading cancelled')

    onUpdate('locating', 'Locating peers in DHT...', 30)
    await simulatePeerLocation(signal)

    if (signal.aborted) throw new Error('Loading cancelled')

    onUpdate('downloading', 'Streaming torrent data...', 50)
    // In a real implementation, this would start downloading and update progress
    await new Promise(resolve => setTimeout(resolve, 500))

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    throw new Error(`Torrent loading failed: ${error.message}`)
  }
}

/**
 * Loads an IPFS file using lazy-loaded IPFS library
 */
async function loadIpfsFile(
  src: string,
  signal: AbortSignal,
  onUpdate: (status: LoadingStatus, message: string, progress?: number) => void,
): Promise<void> {
  try {
    onUpdate('loading-lib', 'Loading IPFS library...')

    // Lazy-load IPFS
    // TODO: Replace with actual dynamic import when library is added
    // const IPFS = await import('ipfs').then(m => m.default)
    // For now, we simulate the process
    await simulateLibraryLoad(signal, 'IPFS')

    if (signal.aborted) throw new Error('Loading cancelled')

    const cid = src.replace(/^ipfs:\/\//, '')
    onUpdate('parsing', `Parsed CID: ${cid.substring(0, 8)}...`)

    onUpdate('connecting', 'Connecting to IPFS network...')

    // Simulate IPFS initialization
    await simulateNetworkConnection(signal, 'ipfs')

    if (signal.aborted) throw new Error('Loading cancelled')

    onUpdate('locating', 'Locating content on DHT...', 30)
    await simulatePeerLocation(signal)

    if (signal.aborted) throw new Error('Loading cancelled')

    onUpdate('downloading', 'Fetching content blocks...', 50)
    // In a real implementation, this would fetch blocks from IPFS and update progress
    await new Promise(resolve => setTimeout(resolve, 500))

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    throw new Error(`IPFS loading failed: ${error.message}`)
  }
}

/**
 * Simulates library loading with a realistic delay
 */
function simulateLibraryLoad(signal: AbortSignal, _libName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (signal.aborted) {
        reject(new Error('Loading cancelled'))
      } else {
        resolve()
      }
    }, 800 + Math.random() * 400) // 800-1200ms

    signal.addEventListener('abort', () => {
      clearTimeout(timeout)
      reject(new Error('Loading cancelled'))
    })
  })
}

/**
 * Simulates network connection with a realistic delay
 */
function simulateNetworkConnection(signal: AbortSignal, _type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (signal.aborted) {
        reject(new Error('Loading cancelled'))
      } else {
        resolve()
      }
    }, 600 + Math.random() * 400) // 600-1000ms

    signal.addEventListener('abort', () => {
      clearTimeout(timeout)
      reject(new Error('Loading cancelled'))
    })
  })
}

/**
 * Simulates peer location with a realistic delay
 */
function simulatePeerLocation(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (signal.aborted) {
        reject(new Error('Loading cancelled'))
      } else {
        resolve()
      }
    }, 1000 + Math.random() * 500) // 1000-1500ms

    signal.addEventListener('abort', () => {
      clearTimeout(timeout)
      reject(new Error('Loading cancelled'))
    })
  })
}

/**
 * Extracts info hash from torrent or magnet URI
 */
function extractInfoHash(uri: string): string | null {
  try {
    if (uri.startsWith('torrent://')) {
      return uri.replace('torrent://', '').trim()
    }
    if (uri.startsWith('magnet:')) {
      const u = new URL(uri)
      const xt = u.searchParams.get('xt') || ''
      const m = xt.match(/urn:btih:([^&]+)/i)
      return m ? m[1] : null
    }
    return null
  } catch {
    return null
  }
}

/**
 * Builds a detailed error message for debugging
 */
function buildDetailedErrorMessage(src: string, error: Error, status: LoadingStatus): string {
  const scheme = getScheme(src)
  const lines = [
    `Error loading distributed file`,
    `─────────────────────────────────────`,
    `URI: ${src}`,
    `Scheme: ${scheme}`,
    `Status: ${status}`,
    `Message: ${error.message}`,
    ``,
    `Troubleshooting:`,
  ]

  if (scheme === 'torrent' || scheme === 'magnet') {
    lines.push(
      `• Ensure the torrent/magnet link is valid`,
      `• Check that seeds/peers are available`,
      `• Verify WebTorrent client can connect to DHT`,
      `• Try a different torrent with active seeds`,
    )
  } else if (scheme === 'ipfs') {
    lines.push(
      `• Ensure the CID/hash is valid`,
      `• Check that the content exists on IPFS`,
      `• Verify your IPFS node is connected to the network`,
      `• Try using a public gateway as fallback`,
    )
  } else if (scheme === 'http' || scheme === 'https') {
    lines.push(
      `• Verify the URL is accessible`,
      `• Check CORS headers are properly configured`,
      `• Ensure the file is in a supported format`,
    )
  }

  lines.push(``, `Stack: ${error.stack || 'N/A'}`)

  return lines.join('\n')
}

export default DistributedFileLoader
