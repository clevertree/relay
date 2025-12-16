import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Dimensions, Platform } from 'react-native'
import { View, Text, TouchableOpacity, ScrollView } from '../themedPrimitives'
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

// Themed-styler classes applied inline/className below; precise colors kept inline where needed

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
    <View className="p-3" style={{ backgroundColor: '#0f0f0f', borderBottomWidth: 1, borderBottomColor: '#333' }}>
      <View className="flex-row items-center mb-2">
        <Text style={{ fontSize: 18, marginRight: 8, minWidth: 24 }}>{getStatusIcon(status)}</Text>
        <Text className="text-white font-semibold text-sm flex-1">{statusLabel}</Text>
        {progress !== undefined && progress < 100 && (
          <Text style={{ color: '#999', fontSize: 12 }}>({progress}%)</Text>
        )}
      </View>
      <Text style={{ color: '#aaa', fontSize: 12, marginTop: 4 }}>{message}</Text>
      {progress !== undefined && progress < 100 && (
        <View style={{ height: 3, backgroundColor: '#333', marginTop: 8, borderRadius: 2, overflow: 'hidden' }}>
          <View style={{ height: '100%', backgroundColor: '#3b82f6', width: `${progress}%` }} />
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
    <View className="p-3" style={{ backgroundColor: '#7f1d1d', borderBottomWidth: 1, borderBottomColor: '#991b1b' }}>
      <Text className="font-semibold text-sm mb-2" style={{ color: '#fee2e2' }}>Error loading media</Text>
      <Text className="text-xs mb-2" style={{ color: '#fecaca' }}>{error}</Text>
      {message && (
        <>
          <TouchableOpacity onPress={() => setExpanded(!expanded)}>
            <Text className="text-xs font-semibold" style={{ color: '#f87171' }}>
              {expanded ? '▼ Hide details' : '▶ Show details'}
            </Text>
          </TouchableOpacity>
          {expanded && (
            <ScrollView style={{ backgroundColor: '#450a0a', padding: 8, marginTop: 8, borderRadius: 4, maxHeight: 200 }}>
              <Text className="text-[10px] font-mono" style={{ color: '#fca5a5' }}>{message}</Text>
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
  // Temporarily disable native video playback on Android to avoid crashes
  if (Platform.OS === 'android') {
    return (
      <View className="w-full bg-black" style={style}>
        <View className="w-full items-center justify-center" style={{ height: videoHeight, backgroundColor: '#1a1a1a' }}>
          <Text className="text-sm mt-3" style={{ color: '#999' }}>Video playback disabled on Android</Text>
        </View>
      </View>
    )
  }
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
    <View className="w-full bg-black" style={style}>
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
      <View className="w-full items-center justify-center" style={{ height: videoHeight, backgroundColor: '#1a1a1a' }}>
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
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="small" color="#3b82f6" />
              <Text className="text-sm mt-3" style={{ color: '#999' }}>Ready to play</Text>
              <Text style={{ color: '#666', fontSize: 10, marginTop: 8 }}>
                (Video URL: {resolvedSrc.substring(0, 40)}...)
              </Text>
            </View>
          </>
        ) : (
          <View className="flex-1 items-center justify-center">
            {!isError && (
              <>
                <ActivityIndicator size="large" color="#3b82f6" style={{ marginBottom: 16 }} />
                <Text className="text-sm mt-3" style={{ color: '#999' }}>Loading media...</Text>
              </>
            )}
            {isError && (
              <Text className="text-sm mt-3" style={{ color: '#ef4444' }}>
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
