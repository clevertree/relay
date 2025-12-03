import { LinkProps } from '../../types'
import { usePlugin } from '../../PluginContext'

/**
 * Web Link Component
 * 
 * Handles internal and external links with proper navigation.
 */
export function Link({
  href,
  target,
  rel,
  children,
  className = '',
}: LinkProps) {
  const { plugin } = usePlugin()
  
  // Check if this is an internal link
  const isInternal = href.startsWith('/') || href.startsWith('.') || 
    (!href.startsWith('http') && !href.startsWith('mailto:') && !href.startsWith('tel:'))

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isInternal && !target) {
      e.preventDefault()
      
      // Resolve relative paths
      let resolvedPath = href
      if (href.startsWith('.')) {
        const currentPath = window.location.pathname
        const basePath = currentPath.substring(0, currentPath.lastIndexOf('/'))
        resolvedPath = new URL(href, `http://localhost${basePath}/`).pathname
      }
      
      // Use plugin navigation if available, otherwise use history API
      if (plugin.navigate) {
        plugin.navigate(resolvedPath)
      } else {
        window.history.pushState({}, '', resolvedPath)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }
    }
  }

  // Set appropriate rel for external links
  const linkRel = target === '_blank' 
    ? (rel || 'noopener noreferrer') 
    : rel

  return (
    <a
      href={href}
      target={target}
      rel={linkRel}
      onClick={handleClick}
      className={`plugin-link ${className}`}
    >
      {children}
    </a>
  )
}
