import React, { useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
} from 'react-native'
import { DistributedFileLoader, type LoadingStatus, type FileLoadResult } from './DistributedFileLoader'

/**
 * VideoPlayerProps - Configuration for the native video player
 *
 * Recommended native libraries:
 * - iOS: AVPlayer (built-in) via react-native-video
 * - Android: ExoPlayer via react-native-video
 *
 * Installation:
 *   npm install react-native-video
 *   cd ios && pod install && cd ..
 */
interface VideoPlayerProps {
  src: string
  poster?: string
  autoPlay?: boolean
  controls?: boolean
  resizeMode?: 'cover' | 'contain' | 'stretch'
  style?: any
  onStatusChange?: (status: LoadingStatus, message: string) => void
}

const { width: screenWidth } = Dimensions.get('window')
const videoHeight = Math.round(screenWidth * (9 / 16)) // 16:9 aspect ratio

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#000',
  },
  videoContainer: {
    width: '100%',
    height: videoHeight,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusContainer: {
    padding: 12,
    backgroundColor: '#0f0f0f',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusIcon: {
    fontSize: 18,
    marginRight: 8,
    minWidth: 24,
  },
  statusLabel: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
    flex: 1,
  },
  statusMessage: {
    color: '#aaa',
    fontSize: 12,
    marginTop: 4,
  },
  progressBar: {
    height: 3,
    backgroundColor: '#333',
    marginTop: 8,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
  },
  errorContainer: {
    padding: 12,
    backgroundColor: '#7f1d1d',
    borderBottomWidth: 1,
    borderBottomColor: '#991b1b',
  },
  errorTitle: {
    color: '#fee2e2',
    fontWeight: '600',
    fontSize: 14,
    marginBottom: 8,
  },
  errorMessage: {
    color: '#fecaca',
    fontSize: 12,
    marginBottom: 8,
  },
  expandButton: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '600',
  },
  errorDetails: {
    backgroundColor: '#450a0a',
    padding: 8,
    marginTop: 8,
    borderRadius: 4,
    maxHeight: 200,
  },
  errorDetailsText: {
    color: '#fca5a5',
    fontSize: 10,
    fontFamily: 'Courier New',
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#999',
    fontSize: 14,
    marginTop: 12,
  },
  loadingSpinner: {
    marginBottom: 16,
  },
})

/**
 * StatusDisplay - Shows detailed loading status with progress indicator (React Native)
 */
function StatusDisplay({
  status,
  message,
  progress,
}: {
  status: LoadingStatus
  message: string
  progress?: number
}) {
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
    <View style={styles.statusContainer}>
      <View style={styles.statusRow}>
        <Text style={styles.statusIcon}>{getStatusIcon(status)}</Text>
        <Text style={styles.statusLabel}>{statusLabel}</Text>
        {progress !== undefined && progress < 100 && (
          <Text style={{ color: '#999', fontSize: 12 }}>({progress}%)</Text>
        )}
      </View>
      <Text style={styles.statusMessage}>{message}</Text>
      {progress !== undefined && progress < 100 && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
      )}
    </View>
  )
}

/**
 * ErrorDisplay - Shows detailed error information for troubleshooting (React Native)
 */
function ErrorDisplay({ error, message }: { error: string; message: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <View style={styles.errorContainer}>
      <Text style={styles.errorTitle}>Error loading media</Text>
      <Text style={styles.errorMessage}>{error}</Text>
      {message && (
        <>
          <TouchableOpacity onPress={() => setExpanded(!expanded)}>
            <Text style={styles.expandButton}>
              {expanded ? '▼ Hide details' : '▶ Show details'}
            </Text>
          </TouchableOpacity>
          {expanded && (
            <ScrollView style={styles.errorDetails}>
              <Text style={styles.errorDetailsText}>{message}</Text>
            </ScrollView>
          )}
        </>
      )}
    </View>
  )
}

/**
 * VideoPlayer - Cross-platform video player wrapper for React Native (iOS/Android)
 *
 * Features:
 * - Native video playback using AVPlayer (iOS) / ExoPlayer (Android)
 * - Supports torrent://, ipfs://, magnet:, and http(s):// URIs
 * - Lazy-loads required libraries on demand
 * - Shows detailed loading status at each step
 * - Provides expanded error messages for troubleshooting
 * - Auto-plays when ready (configurable)
 * - Poster/thumbnail support
 * - Native controls integration
 *
 * Installation:
 * 1. Install react-native-video:
 *    npm install react-native-video
 *    cd ios && pod install && cd ..
 *
 * 2. For torrent support, also install:
 *    npm install react-native-torrent-streamer
 *    Follow library's iOS/Android setup
 *
 * 3. For IPFS support (optional):
 *    npm install ipfs
 *    Configure Metro bundler for IPFS modules
 *
 * Usage:
 * ```tsx
 * import VideoPlayer from './components/VideoPlayer'
 *
 * <VideoPlayer
 *   src="torrent://..."
 *   poster={require('./thumbnail.jpg')}
 *   autoPlay={true}
 *   controls={true}
 *   onStatusChange={(status, msg) => console.log(status)}
 * />
 * ```
 *
 * TODO: Replace placeholder video element with react-native-video
 * when ready to integrate native player:
 *
 * import Video from 'react-native-video'
 * 
 * <Video
 *   source={{ uri: resolvedSrc }}
 *   poster={poster}
 *   style={{ width: '100%', height: videoHeight }}
 *   controls={controls}
 *   autoplay={autoPlay}
 *   onError={(error) => handleVideoError(error)}
 *   onLoad={(data) => handleVideoLoad(data)}
 * />
 */
export function VideoPlayer({
  src,
  poster,
  autoPlay = true,
  controls = true,
  resizeMode = 'contain',
  style,
  onStatusChange,
}: VideoPlayerProps) {
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
    onStatusChange?.(status, message)
  }

  const isError = loadingStatus === 'error'
  const isReady = loadingStatus === 'ready'

  return (
    <View style={[styles.container, style]}>
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
      <View style={styles.videoContainer}>
        {isReady && resolvedSrc ? (
          <>
            {/* TODO: Replace with actual react-native-video component */}
            {/* 
            <Video
              source={{ uri: resolvedSrc }}
              poster={poster}
              style={{ width: '100%', height: videoHeight }}
              controls={controls}
              autoplay={autoPlay}
              resizeMode={resizeMode}
              onError={(error) => console.error('Video error:', error)}
              onLoad={(data) => console.log('Video loaded:', data)}
            />
            */}

            {/* Placeholder - remove when Video component is integrated */}
            <View style={styles.placeholder}>
              <ActivityIndicator size="small" color="#3b82f6" />
              <Text style={styles.placeholderText}>Ready to play</Text>
              <Text style={{ color: '#666', fontSize: 10, marginTop: 8 }}>
                (Video URL: {resolvedSrc.substring(0, 40)}...)
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.placeholder}>
            {!isError && (
              <>
                <ActivityIndicator size="large" color="#3b82f6" style={styles.loadingSpinner} />
                <Text style={styles.placeholderText}>Loading media...</Text>
              </>
            )}
            {isError && (
              <Text style={[styles.placeholderText, { color: '#ef4444' }]}>
                Unable to load media
              </Text>
            )}
          </View>
        )}
      </View>
    </View>
  )
}

export default VideoPlayer
