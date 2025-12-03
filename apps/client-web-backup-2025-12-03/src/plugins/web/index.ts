import { Plugin, PluginConfig } from '../types'
import { Video } from './components/Video'
import { Image } from './components/Image'
import { Audio } from './components/Audio'
import { Link } from './components/Link'
import { CodeBlock } from './components/CodeBlock'

/**
 * Web Plugin
 * 
 * Plugin implementation for web browsers.
 * Uses native HTML5 elements for media playback.
 */

const defaultConfig: PluginConfig = {
  baseUrl: '',
  headers: {},
  branch: 'main',
  repo: undefined,
}

export function createWebPlugin(config: Partial<PluginConfig> = {}): Plugin {
  const pluginConfig: PluginConfig = { ...defaultConfig, ...config }

  return {
    name: 'web',
    version: '1.0.0',
    platform: 'web',
    config: pluginConfig,

    components: {
      Video,
      Image,
      Audio,
      Link,
      CodeBlock,
    },

    async fetchContent(path: string): Promise<string> {
      const { baseUrl, headers, branch, repo } = pluginConfig
      
      // Build URL with optional base
      const url = baseUrl ? `${baseUrl}${path}` : path
      
      // Build headers with branch and repo
      const requestHeaders: Record<string, string> = { ...headers }
      if (branch) {
        requestHeaders['X-Relay-Branch'] = branch
      }
      if (repo) {
        requestHeaders['X-Relay-Repo'] = repo
      }

      try {
        const response = await fetch(url, {
          headers: requestHeaders,
        })

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(`Content not found: ${path}`)
          }
          throw new Error(`Failed to fetch content: ${response.statusText}`)
        }

        return await response.text()
      } catch (error) {
        if (error instanceof Error) {
          throw error
        }
        throw new Error('Failed to fetch content')
      }
    },

    navigate(path: string) {
      window.history.pushState({}, '', path)
      window.dispatchEvent(new PopStateEvent('popstate'))
    },

    async getMediaCapabilities() {
      const video = document.createElement('video')
      
      // Check video format support
      const videoFormats = ['video/mp4', 'video/webm', 'video/ogg']
      const supportedVideoFormats = videoFormats.filter(
        format => video.canPlayType(format) !== ''
      )

      // Check HLS support
      const supportsHLS = 
        video.canPlayType('application/vnd.apple.mpegurl') !== '' ||
        video.canPlayType('application/x-mpegURL') !== ''

      // Check DASH support (usually via MSE)
      const supportsDASH = 'MediaSource' in window

      // Check audio format support
      const audio = document.createElement('audio')
      const audioFormats = ['audio/mp3', 'audio/ogg', 'audio/wav', 'audio/aac']
      const supportedAudioFormats = audioFormats.filter(
        format => audio.canPlayType(format) !== ''
      )

      return {
        supportedVideoFormats,
        supportedAudioFormats,
        supportsHLS,
        supportsDASH,
        maxResolution: undefined, // Browser doesn't expose this
      }
    },
  }
}

// Default web plugin instance
export const webPlugin = createWebPlugin()
