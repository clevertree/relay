import { useRef, useState, useEffect, useCallback } from 'react'
import type { VideoProps } from '../../types'
import './Video.css'

/**
 * Web Video Component
 * 
 * Wraps the native HTML5 video player with enhanced controls
 * and cross-browser compatibility handling.
 */
export function Video({
  src,
  poster,
  width,
  height,
  autoplay = false,
  loop = false,
  muted = false,
  controls = true,
  preload = 'metadata',
  className = '',
}: VideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(muted ? 0 : 1)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Resolve relative URLs against current location
  const resolvedSrc = src.startsWith('http') || src.startsWith('/') 
    ? src 
    : new URL(src, window.location.href).href

  // Handle video events
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleTimeUpdate = () => setCurrentTime(video.currentTime)
    const handleDurationChange = () => setDuration(video.duration)
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    const handleEnded = () => setIsPlaying(false)
    const handleLoadStart = () => setIsLoading(true)
    const handleCanPlay = () => setIsLoading(false)
    const handleError = () => {
      setError('Failed to load video. The format may not be supported.')
      setIsLoading(false)
    }
    const handleVolumeChange = () => setVolume(video.volume)

    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('durationchange', handleDurationChange)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('ended', handleEnded)
    video.addEventListener('loadstart', handleLoadStart)
    video.addEventListener('canplay', handleCanPlay)
    video.addEventListener('error', handleError)
    video.addEventListener('volumechange', handleVolumeChange)

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('durationchange', handleDurationChange)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('ended', handleEnded)
      video.removeEventListener('loadstart', handleLoadStart)
      video.removeEventListener('canplay', handleCanPlay)
      video.removeEventListener('error', handleError)
      video.removeEventListener('volumechange', handleVolumeChange)
    }
  }, [])

  // Handle fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    if (isPlaying) {
      video.pause()
    } else {
      video.play().catch(() => {
        setError('Playback failed. Try clicking the video to play.')
      })
    }
  }, [isPlaying])

  const seek = useCallback((time: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = time
  }, [])

  const changeVolume = useCallback((newVolume: number) => {
    const video = videoRef.current
    if (!video) return
    video.volume = newVolume
    video.muted = newVolume === 0
  }, [])

  const toggleFullscreen = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    if (!document.fullscreenElement) {
      video.requestFullscreen().catch(() => {
        setError('Fullscreen not supported')
      })
    } else {
      document.exitFullscreen()
    }
  }, [])

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (error) {
    return (
      <div className={`video-error ${className}`}>
        <span className="error-icon">⚠️</span>
        <span>{error}</span>
        <a href={resolvedSrc} target="_blank" rel="noopener noreferrer">
          Open video directly
        </a>
      </div>
    )
  }

  return (
    <div 
      className={`video-container ${className} ${isFullscreen ? 'fullscreen' : ''}`}
      style={{ width, height }}
    >
      <video
        ref={videoRef}
        src={resolvedSrc}
        poster={poster}
        autoPlay={autoplay}
        loop={loop}
        muted={muted}
        preload={preload}
        playsInline
        onClick={togglePlay}
        className="video-element"
      />
      
      {isLoading && (
        <div className="video-loading">
          <span className="loading-spinner" />
          Loading...
        </div>
      )}

      {controls && !isLoading && (
        <div className="video-controls">
          <button 
            className="control-btn play-btn" 
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>

          <div className="time-display">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>

          <input
            type="range"
            className="seek-bar"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Seek"
          />

          <input
            type="range"
            className="volume-bar"
            min={0}
            max={1}
            step={0.1}
            value={volume}
            onChange={(e) => changeVolume(Number(e.target.value))}
            aria-label="Volume"
          />

          <button 
            className="control-btn fullscreen-btn" 
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? '⊡' : '⛶'}
          </button>
        </div>
      )}
    </div>
  )
}
