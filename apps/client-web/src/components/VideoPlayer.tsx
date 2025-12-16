import React, { useEffect, useRef, useState } from 'react'
import { DistributedFileLoader, type LoadingStatus, type FileLoadResult } from './DistributedFileLoader'

type Subtitle = {
  src: string
  label?: string
  lang?: string
  default?: boolean
}

interface VideoPlayerProps {
  src: string
  subtitles?: Subtitle[]
  poster?: string
  autoPlay?: boolean
  controls?: boolean
  className?: string
  style?: React.CSSProperties
}

/**
 * StatusDisplay - Shows detailed loading status with progress indicator
 */
function StatusDisplay({ status, message, progress }: { status: LoadingStatus; message: string; progress?: number }) {
  const getStatusIcon = (s: LoadingStatus) => {
    switch (s) {
      case 'idle':
        return '⏸'
      case 'parsing':
        return '🔍'
      case 'loading-lib':
        return '📥'
      case 'connecting':
        return '🔗'
      case 'locating':
        return '🌐'
      case 'downloading':
        return '⬇️'
      case 'ready':
        return '✅'
      case 'error':
        return '❌'
      default:
        return '⏳'
    }
  }

  const statusLabel = status.replace('-', ' ').toUpperCase()

  return (
    <div className="mb-3 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-lg">{getStatusIcon(status)}</span>
        <span className="font-semibold">{statusLabel}</span>
        {progress !== undefined && progress < 100 && (
          <span className="text-xs text-gray-400">({progress}%)</span>
        )}
      </div>
      <div className="text-xs text-gray-400">{message}</div>
      {progress !== undefined && progress < 100 && (
        <div className="w-full h-1 bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  )
}

/**
 * ErrorDisplay - Shows detailed error information for troubleshooting
 */
function ErrorDisplay({ error, message }: { error: string; message: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mb-3 space-y-2">
      <div className="text-sm text-red-400 font-semibold">Error loading media</div>
      <div className="text-xs text-red-300 bg-red-900 bg-opacity-20 p-2 rounded">{error}</div>
      {message && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-red-300 hover:text-red-200 underline"
        >
          {expanded ? '▼ Hide details' : '▶ Show details'}
        </button>
      )}
      {expanded && message && (
        <pre className="text-xs text-red-300 bg-red-900 bg-opacity-20 p-2 rounded max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono">
          {message}
        </pre>
      )}
    </div>
  )
}

/**
 * VideoPlayer - Cross-platform video player with support for torrent, IPFS, and HTTP sources.
 *
 * Features:
 * - Supports torrent://, ipfs://, magnet:, and http(s):// URIs
 * - Lazy-loads required libraries on demand
 * - Shows detailed loading status at each step
 * - Provides expanded error messages for troubleshooting
 * - Auto-plays when ready (configurable)
 *
 * The component uses DistributedFileLoader to handle all media source loading
 * and provides a polished UI for status feedback and error handling.
 */
export function VideoPlayer({
  src,
  subtitles,
  poster,
  autoPlay = true,
  controls = true,
  className,
  style,
  enabled = false, // optional prop to override global/env
}: VideoPlayerProps & { enabled?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [loadingStatus, setLoadingStatus] = useState<LoadingStatus>('idle')
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [progress, setProgress] = useState<number>(0)
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [detailedError, setDetailedError] = useState<string | null>(null)

  // Handle successful media load
  const handleSuccess = (result: FileLoadResult) => {
    setResolvedSrc(result.url)
    setErrorMessage(null)
    setDetailedError(null)
  }

  // Handle loading errors with detailed messages
  const handleError = (error: Error, detailedMessage: string) => {
    setErrorMessage(error.message)
    setDetailedError(detailedMessage)
    setResolvedSrc(null)
  }

  // Update status and message from loader
  const handleStatusChange = (status: LoadingStatus, message: string, newProgress?: number) => {
    setLoadingStatus(status)
    setStatusMessage(message)
    if (newProgress !== undefined) {
      setProgress(newProgress)
    }
  }

  // Auto-play when ready
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (loadingStatus === 'ready' && autoPlay && resolvedSrc) {
      const play = async () => {
        try {
          await v.play()
        } catch (e) {
          // Auto-play may fail due to browser policies
          console.debug('Auto-play prevented by browser policy', e)
        }
      }
      // Slight delay to allow src to attach
      const timer = setTimeout(play, 50)
      return () => clearTimeout(timer)
    }
  }, [loadingStatus, autoPlay, resolvedSrc])

  const isError = loadingStatus === 'error'
  const isReady = loadingStatus === 'ready'
  // Determine whether VideoPlayer is enabled. Priority:
  // 1. explicit `enabled` prop (boolean)
  // 2. runtime global `window.__videoEnabled` (boolean)
  // 3. environment Vite flag VITE_DISABLE_VIDEO === 'true' (default disables)
  const envDisable = typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_DISABLE_VIDEO === 'true'
  const globalOverride = (globalThis as any).__videoEnabled
  const isEnabled = typeof enabled === 'boolean' ? enabled : (typeof globalOverride === 'boolean' ? globalOverride : !envDisable)

  if (!isEnabled) {
    // Render a disabled placeholder UI but keep all internal state/hooks available so
    // re-enabling the feature is non-destructive and fast.
    return (
      <div className={`w-full max-w-4xl rounded-lg border border-dashed border-gray-600 bg-black/60 text-gray-300 p-6 ${className || ''}`} style={style}>
        <div className="text-center space-y-2">
          <div className="text-lg font-semibold">Video playback temporarily disabled</div>
          <div className="text-sm text-gray-400">The VideoPlayer UI is currently disabled while we stabilize streaming. The underlying loader and playback code remain present and will be used when re-enabled.</div>
          <div className="text-xs text-gray-500">Tip: set <code>window.__videoEnabled = true</code> in the console to re-enable for testing.</div>
        </div>
      </div>
    )
  }

  return (
    <div className={`w-full max-w-4xl space-y-3 ${className || ''}`} style={style}>
      {/* Use DistributedFileLoader to manage all media loading */}
      <DistributedFileLoader
        src={src}
        onStatusChange={handleStatusChange}
        onSuccess={handleSuccess}
        onError={handleError}
        enabled={true}
      />

      {/* Status indicator */}
      {!isError && (
        <StatusDisplay status={loadingStatus} message={statusMessage} progress={progress} />
      )}

      {/* Error indicator */}
      {isError && errorMessage && (
        <ErrorDisplay error={errorMessage} message={detailedError || ''} />
      )}

      {/* Video element - shown when ready */}
      {isReady && resolvedSrc ? (
        <video
          ref={videoRef}
          src={resolvedSrc}
          poster={poster}
          controls={controls}
          style={{ width: '100%', maxHeight: 480 }}
        >
          {(subtitles || []).map((t, i) => (
            <track
              key={i}
              src={t.src}
              label={t.label}
              srcLang={t.lang}
              kind="subtitles"
              default={t.default}
            />
          ))}
        </video>
      ) : (
        <div className="w-full bg-gray-800 rounded aspect-video flex items-center justify-center">
          {!isError && <div className="text-gray-400 text-sm">Loading media...</div>}
          {isError && <div className="text-red-400 text-sm">Unable to load media</div>}
        </div>
      )}
    </div>
  )
}

export default VideoPlayer
