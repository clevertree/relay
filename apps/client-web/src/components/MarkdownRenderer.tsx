import Markdown from 'markdown-to-jsx'
import { useEffect, useRef } from 'react'
import { VideoPlayer } from './VideoPlayer'

interface MarkdownRendererProps {
  content: string
  navigate: (path: string) => void
}

/**
 * Pre-process HTML to ensure markdown-to-jsx can pass attributes to custom components
 * Key fix: Collapse multi-line HTML tags to single line so all attributes are recognized
 */
function preprocessHtmlForMarkdown(content: string): string {
  let processed = content

  // Collapse all HTML tags to single line (remove newlines/indentation within tags)
  // This regex matches opening tags and self-closing tags, preserving attributes
  processed = processed.replace(/<([^>]+?)>/g, (match) => {
    // Remove newlines and extra whitespace within the tag, but preserve single spaces between attributes
    return match.replace(/\n\s*/g, ' ').replace(/\s+/g, ' ')
  })

  return processed
}


/**
 * Safe video component - sanitizes attributes
 */
function SafeVideoComponent({ children, ...props }: any) {
  console.log('SafeVideoComponent props:', props)

  const allowedAttrs = ['id', 'src', 'width', 'height', 'controls', 'autoplay', 'loop', 'muted', 'preload', 'poster']
  const safeProps: Record<string, any> = {}

  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'function' || key.startsWith('on')) continue
    if (['dangerouslySetInnerHTML', 'innerHTML'].includes(key)) continue
    if (allowedAttrs.includes(key)) {
      safeProps[key] = value
    }
  }

  // Handle boolean attributes
  const booleanAttrs = ['controls', 'autoplay', 'loop', 'muted']
  for (const attr of booleanAttrs) {
    if (props[attr] !== undefined && props[attr] !== false && props[attr] !== null) {
      safeProps[attr] = true
    }
  }

  return (
    <video {...safeProps} style={{ maxWidth: '100%' }}>
      {children}
    </video>
  )
}

/**
 * Safe source component - sanitizes attributes
 */
function SafeSourceComponent(props: any) {
  console.log('SafeSourceComponent props:', props)

  const allowedAttrs = ['src', 'type']
  const safeProps: Record<string, any> = {}

  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'function' || key.startsWith('on')) continue
    if (['dangerouslySetInnerHTML', 'innerHTML', 'children'].includes(key)) continue
    if (allowedAttrs.includes(key)) {
      safeProps[key] = value
    }
  }

  console.log('Source final safeProps:', safeProps)
  return <source {...safeProps} />
}

/**
 * Safe track component - sanitizes attributes
 */
function SafeTrackComponent(props: any) {
  console.log('SafeTrackComponent props:', props)

  const allowedAttrs = ['src', 'kind', 'srclang', 'label', 'default']
  const safeProps: Record<string, any> = {}

  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'function' || key.startsWith('on')) continue
    if (['dangerouslySetInnerHTML', 'innerHTML', 'children'].includes(key)) continue
    if (allowedAttrs.includes(key)) {
      if (key === 'default' && value) {
        safeProps[key] = true
      } else if (key !== 'default') {
        safeProps[key] = value
      }
    }
  }

  console.log('Track final safeProps:', safeProps)
  return <track {...safeProps} />
}

/**
 * Markdown Renderer
 *
 * Renders markdown content with security-first HTML filtering.
 * Uses markdown-to-jsx for native JSX component support.
 */
export function MarkdownRenderer({ content, navigate }: MarkdownRendererProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  // Pre-process content to ensure markdown-to-jsx can handle it
  const processedContent = preprocessHtmlForMarkdown(content)

  // Single event listener for all anchor clicks
  useEffect(() => {
    const handleAnchorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const anchor = target.closest('a')

      if (!anchor) return

      const href = anchor.getAttribute('href')
      if (!href) return

      // Check if this is an internal link
      const isInternal = href.startsWith('/') || href.startsWith('.') ||
        (!href.startsWith('http') && !href.startsWith('mailto:') && !href.startsWith('tel:'))

      if (isInternal) {
        e.preventDefault()

        // Resolve relative paths
        let resolvedPath = href
        if (href.startsWith('.')) {
          const currentPath = window.location.pathname
          const basePath = currentPath.substring(0, currentPath.lastIndexOf('/'))
          resolvedPath = new URL(href, `http://localhost${basePath}/`).pathname
        }

        navigate(resolvedPath)
      }
    }

    const element = contentRef.current
    if (element) {
      element.addEventListener('click', handleAnchorClick as EventListener)
      return () => {
        element.removeEventListener('click', handleAnchorClick as EventListener)
      }
    }
  }, [navigate])

  const overrides = {
    // Dangerous elements - completely blocked
    script: () => null,
    iframe: () => null,
    // Safe media elements
    video: SafeVideoComponent,
    source: SafeSourceComponent,
    track: SafeTrackComponent,
    VideoPlayer: VideoPlayer as any,
  }

  return (
    <div ref={contentRef} className="markdown-content">
      <Markdown options={{ overrides }}>
        {processedContent}
      </Markdown>
    </div>
  )
}
