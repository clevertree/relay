import { AudioProps } from '../../types'

/**
 * Web Audio Component
 * 
 * Wraps native HTML5 audio element.
 */
export function Audio({
  src,
  autoplay = false,
  loop = false,
  muted = false,
  controls = true,
  preload = 'metadata',
  className = '',
}: AudioProps) {
  // Resolve relative URLs against current location
  const resolvedSrc = src.startsWith('http') || src.startsWith('/') 
    ? src 
    : new URL(src, window.location.href).href

  return (
    <audio
      src={resolvedSrc}
      autoPlay={autoplay}
      loop={loop}
      muted={muted}
      controls={controls}
      preload={preload}
      className={`plugin-audio ${className}`}
      style={{ width: '100%', maxWidth: '500px' }}
    />
  )
}
