import type { ImageProps } from '../../types'

/**
 * Web Image Component
 * 
 * Wraps native img element with lazy loading and error handling.
 */
export function Image({
  src,
  alt,
  width,
  height,
  loading = 'lazy',
  className = '',
}: ImageProps) {
  // Resolve relative URLs against current location
  const resolvedSrc = src.startsWith('http') || src.startsWith('/') 
    ? src 
    : new URL(src, window.location.href).href

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      className={`plugin-image ${className}`}
      onError={(e) => {
        const target = e.target as HTMLImageElement
        target.style.display = 'none'
        // Create placeholder
        const placeholder = document.createElement('div')
        placeholder.className = 'image-error'
        placeholder.textContent = `Failed to load image: ${alt}`
        target.parentNode?.insertBefore(placeholder, target.nextSibling)
      }}
    />
  )
}
