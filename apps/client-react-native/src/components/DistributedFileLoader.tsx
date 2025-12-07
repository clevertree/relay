import { useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Status progression for distributed file loading (React Native)
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
  cached?: boolean
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
  cacheEnabled?: boolean
  cacheKey?: string
}

/**
 * DistributedFileLoader (React Native) - Handles loading files from torrent and IPFS sources
 *
 * Features:
 * - Lazy loads required libraries on demand
 * - Provides detailed status updates at each step
 * - Supports torrent://, ipfs://, magnet:, and http(s):// protocols
 * - Provides callbacks for integration with other components
 * - Handles errors gracefully with detailed messages
 * - Optional AsyncStorage caching for faster replays
 * - Native module integration points for iOS/Android
 *
 * Recommended Libraries:
 * - Torrent: react-native-torrent-streamer or @react-native-webrtc based solution
 * - IPFS: js-ipfs (can run in React Native with proper polyfills)
 * - HTTP/HTTPS: Fetch API (built-in)
 *
 * Usage:
 * ```tsx
 * <DistributedFileLoader
 *   src="torrent://..."
 *   cacheEnabled={true}
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
  cacheEnabled = true,
  cacheKey,
}: DistributedFileLoaderProps) {
  const [status, setStatus] = useState<LoadingStatus>('idle')
  const [message, setMessage] = useState<string>('')
  const [progress, setProgress] = useState<number>(0)
  const loadingRef = useRef<AbortController | null>(null)
  const cacheKeyRef = useRef<string>(cacheKey || `file_cache_${src.replace(/[^a-z0-9]/gi, '_')}`)

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
        // Check cache first
        if (cacheEnabled) {
          setStatus('parsing')
          setMessage('Checking cache...')

          const cached = await AsyncStorage.getItem(cacheKeyRef.current)
          if (cached && !abort.signal.aborted) {
            try {
              const result = JSON.parse(cached)
              setStatus('ready')
              setMessage('Loaded from cache')
              onSuccess?.({
                ...result,
                cached: true,
              })
              return
            } catch (e) {
              // Cache corrupted, proceed with normal loading
              await AsyncStorage.removeItem(cacheKeyRef.current)
            }
          }
        }

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
          mimeType = 'video/mp4'
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

        const result: FileLoadResult = {
          url: resolvedUrl,
          mimeType,
        }

        // Cache the result
        if (cacheEnabled) {
          try {
            await AsyncStorage.setItem(cacheKeyRef.current, JSON.stringify(result))
          } catch (e) {
            console.warn('Failed to cache file result:', e)
          }
        }

        setStatus('ready')
        setMessage('Ready to stream')
        onSuccess?.(result)
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
  }, [src, enabled, onSuccess, onError, cacheEnabled])

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
 * Loads a torrent file using lazy-loaded library
 *
 * Recommended: react-native-torrent-streamer
 * Installation:
 *   npm install react-native-torrent-streamer
 *   cd ios && pod install && cd ..
 *   cd android && ./gradlew build && cd ..
 *
 * Alternative: @react-native-webrtc for peer connections + torrent-stream
 */
async function loadTorrentFile(
  src: string,
  signal: AbortSignal,
  onUpdate: (status: LoadingStatus, message: string, progress?: number) => void,
): Promise<void> {
  try {
    onUpdate('loading-lib', 'Loading torrent streaming library...')

    // TODO: Replace with actual dynamic import when library is added
    // import('react-native-torrent-streamer').then(mod => {
    //   const { TorrentStreamer } = mod
    //   return TorrentStreamer.stream(magnetUri, options)
    // })

    // For now, use simulation
    await simulateLibraryLoad(signal, 'react-native-torrent-streamer')

    if (signal.aborted) throw new Error('Loading cancelled')

    onUpdate('parsing', 'Extracting info hash...')
    const infoHash = extractInfoHash(src)
    if (!infoHash) throw new Error('Invalid torrent URI: could not extract info hash')

    onUpdate('connecting', `Connecting to torrent: ${infoHash.substring(0, 8)}...`, 10)

    // Simulate connecting to the torrent network
    await simulateNetworkConnection(signal, 'torrent')

    if (signal.aborted) throw new Error('Loading cancelled')

    onUpdate('locating', 'Locating peers in DHT...', 30)
    await simulatePeerLocation(signal)

    if (signal.aborted) throw new Error('Loading cancelled')

    onUpdate('downloading', 'Streaming torrent data...', 50)
    await new Promise(resolve => setTimeout(resolve, 500))

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    throw new Error(`Torrent loading failed: ${error.message}`)
  }
}

/**
 * Loads an IPFS file using lazy-loaded library
 *
 * Recommended: js-ipfs with React Native polyfills
 * Installation:
 *   npm install ipfs
 *   npm install --save-dev @react-native-webrtc/react-native-webrtc
 *
 * Setup: Configure Metro to handle IPFS modules correctly
 */
async function loadIpfsFile(
  src: string,
  signal: AbortSignal,
  onUpdate: (status: LoadingStatus, message: string, progress?: number) => void,
): Promise<void> {
  try {
    onUpdate('loading-lib', 'Loading IPFS library...')

    // TODO: Replace with actual dynamic import
    // import('ipfs').then(mod => {
    //   const { create } = mod
    //   return create({ ...config })
    // })

    // For now, use simulation
    await simulateLibraryLoad(signal, 'js-ipfs')

    if (signal.aborted) throw new Error('Loading cancelled')

    const cid = src.replace(/^ipfs:\/\//, '')
    onUpdate('parsing', `Parsed CID: ${cid.substring(0, 8)}...`)

    onUpdate('connecting', 'Connecting to IPFS network...')
    await simulateNetworkConnection(signal, 'ipfs')

    if (signal.aborted) throw new Error('Loading cancelled')

    onUpdate('locating', 'Locating content on DHT...', 30)
    await simulatePeerLocation(signal)

    if (signal.aborted) throw new Error('Loading cancelled')

    onUpdate('downloading', 'Fetching content blocks...', 50)
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
      `• Verify react-native-torrent-streamer is installed`,
      `• Try a different torrent with active seeds`,
      `• Check network connectivity`,
    )
  } else if (scheme === 'ipfs') {
    lines.push(
      `• Ensure the CID/hash is valid`,
      `• Check that the content exists on IPFS`,
      `• Verify your IPFS node is connected`,
      `• Try using a public gateway as fallback`,
      `• Check network connectivity`,
    )
  } else if (scheme === 'http' || scheme === 'https') {
    lines.push(
      `• Verify the URL is accessible`,
      `• Check SSL certificate validation`,
      `• Ensure the file is in a supported format`,
      `• Check network connectivity`,
    )
  }

  lines.push(``, `Stack: ${error.stack || 'N/A'}`)

  return lines.join('\n')
}

export default DistributedFileLoader
