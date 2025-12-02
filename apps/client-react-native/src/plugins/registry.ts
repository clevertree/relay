/**
 * Plugin types and registry for Relay Client.
 * Plugins can be repo-provided, native default, or webview.
 */

export type PluginType = 'repo-provided' | 'native-default' | 'webview';

export interface PluginDescriptor {
  id: string;
  type: PluginType;
  name: string;
  version?: string;
  description?: string;
  // For repo-provided plugins
  manifestUrl?: string;
  // For webview plugins
  entryUrl?: string;
  // Hash for integrity verification
  hash?: string;
}

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  type: 'declarative' | 'webview';
  entry?: string;
  // Declarative plugin config
  views?: {
    main?: string; // Path to main view (markdown or JSON)
    grid?: string;
    detail?: string;
  };
  // Permissions requested
  permissions?: string[];
}

/**
 * Built-in plugin descriptors
 */
export const BUILTIN_PLUGINS: PluginDescriptor[] = [
  {
    id: 'native-repo-browser',
    type: 'native-default',
    name: 'Repo Browser',
    description: 'Default native repository browser with Visit/Search functionality',
  },
  {
    id: 'builtin-declarative',
    type: 'repo-provided',
    name: 'Declarative Plugin',
    description: 'Load repo-provided declarative plugins with markdown/grid/detail views',
  },
  {
    id: 'builtin-webview',
    type: 'webview',
    name: 'WebView Plugin',
    description: 'Load repo-provided web interface in a restricted WebView',
  },
];

/**
 * Plugin priority order for selection
 * 1. Repo-provided (highest priority if available)
 * 2. Native default
 * 3. WebView fallback
 */
export const PLUGIN_PRIORITY: PluginType[] = ['repo-provided', 'native-default', 'webview'];

/**
 * Get the best plugin for a peer based on available plugins
 */
export function selectBestPlugin(
  availablePlugins: PluginDescriptor[],
  osSpecific?: Record<string, string>,
): PluginDescriptor | null {
  // Check for OS-specific repo-provided plugin first
  if (osSpecific) {
    // Platform detection would happen here
    const platform = 'android'; // TODO: use Platform.OS
    if (osSpecific[platform]) {
      const repoPlugin = availablePlugins.find(
        (p) => p.type === 'repo-provided' && p.manifestUrl === osSpecific[platform],
      );
      if (repoPlugin) return repoPlugin;
    }
  }

  // Fall back to priority order
  for (const type of PLUGIN_PRIORITY) {
    const plugin = availablePlugins.find((p) => p.type === type);
    if (plugin) return plugin;
  }

  return null;
}

/**
 * Fetch and parse a plugin manifest from a URL
 */
export async function fetchPluginManifest(url: string): Promise<PluginManifest | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
