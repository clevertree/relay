import type { ComponentType, ReactNode } from 'react'

/**
 * Plugin Interface
 * 
 * Each plugin defines a set of named components that wrap native functionality.
 * These components can be used within markdown pages and are platform-specific.
 */

// Base props that all plugin components receive
export interface BaseComponentProps {
  children?: ReactNode
  className?: string
}

// Video component props
export interface VideoProps extends BaseComponentProps {
  src: string
  poster?: string
  width?: number | string
  height?: number | string
  autoplay?: boolean
  loop?: boolean
  muted?: boolean
  controls?: boolean
  preload?: 'auto' | 'metadata' | 'none'
}

// Image component props
export interface ImageProps extends BaseComponentProps {
  src: string
  alt: string
  width?: number | string
  height?: number | string
  loading?: 'lazy' | 'eager'
}

// Audio component props
export interface AudioProps extends BaseComponentProps {
  src: string
  autoplay?: boolean
  loop?: boolean
  muted?: boolean
  controls?: boolean
  preload?: 'auto' | 'metadata' | 'none'
}

// Link component props
export interface LinkProps extends BaseComponentProps {
  href: string
  target?: '_blank' | '_self' | '_parent' | '_top'
  rel?: string
}

// Code block component props
export interface CodeBlockProps extends BaseComponentProps {
  language?: string
  filename?: string
}

/**
 * Plugin Component Registry
 * 
 * Maps component names to their implementations.
 * Only components registered in this map are allowed in markdown.
 */
export interface PluginComponents {
  Image: ComponentType<ImageProps>
  Audio: ComponentType<AudioProps>
  Link: ComponentType<LinkProps>
  CodeBlock: ComponentType<CodeBlockProps>
}

/**
 * Plugin Configuration
 */
export interface PluginConfig {
  // Base URL for fetching content
  baseUrl?: string
  // Custom headers to send with requests
  headers?: Record<string, string>
  // Branch to fetch from (for Relay server)
  branch?: string
  // Repository to fetch from (for Relay server)
  repo?: string
}

/**
 * Plugin Interface
 * 
 * Defines the contract that all platform plugins must implement.
 */
export interface Plugin {
  // Plugin identifier
  name: string
  // Plugin version
  version: string
  // Platform this plugin targets
  platform: 'web' | 'android' | 'ios' | 'desktop'
  // Registered components
  components: PluginComponents
  // Plugin configuration
  config: PluginConfig
  
  // Fetch content from a path
  fetchContent: (path: string) => Promise<string>
  
  // Navigate to a path (platform-specific)
  navigate?: (path: string) => void
  
  // Get the current platform's media capabilities
  getMediaCapabilities?: () => Promise<MediaCapabilities>
}

/**
 * Media capabilities for the current platform
 */
export interface MediaCapabilities {
  supportedVideoFormats: string[]
  supportedAudioFormats: string[]
  supportsHLS: boolean
  supportsDASH: boolean
  maxResolution?: { width: number; height: number }
}

/**
 * List of allowed component names in markdown
 * Only these components will be rendered; all others are stripped
 */
export const ALLOWED_COMPONENTS: (keyof PluginComponents)[] = [
  'Image',
  'Audio',
  'Link',
  'CodeBlock',
]

/**
 * Check if a component name is allowed
 */
export function isAllowedComponent(name: string): name is keyof PluginComponents {
  return ALLOWED_COMPONENTS.includes(name as keyof PluginComponents)
}
