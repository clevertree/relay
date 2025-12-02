/**
 * Plugin discovery from OPTIONS endpoint
 * Parses interface metadata from relay.yaml OPTIONS response
 */

import {PluginDescriptor} from '../plugins/registry';

export interface InterfaceMetadata {
  [os: string]: {
    plugin_manifest?: string; // URL to plugin manifest
    name?: string;
    version?: string;
  };
}

export interface OptionsResponse {
  branchHeads?: Record<string, string>;
  branches?: string[];
  repos?: string[];
  interface?: InterfaceMetadata;
  [key: string]: unknown;
}

/**
 * Parse OPTIONS response and extract plugin descriptors
 * Discovers repo-provided plugins from interface metadata
 */
export function discoverPluginsFromOptions(
  optionsData: unknown,
  host: string,
  branch: string,
): PluginDescriptor[] {
  const plugins: PluginDescriptor[] = [];

  if (!optionsData || typeof optionsData !== 'object') {
    return plugins;
  }

  const options = optionsData as OptionsResponse;

  // Check for interface metadata (plugin declarations)
  if (options.interface && typeof options.interface === 'object') {
    let pluginIdx = 0;

    Object.entries(options.interface).forEach(([os, config]) => {
      if (config && typeof config === 'object') {
        const manifestUrl = (config as any).plugin_manifest;
        if (manifestUrl) {
          // Build full manifest URL
          const fullUrl = buildFullUrl(host, manifestUrl, branch);

          const descriptor: PluginDescriptor = {
            id: `repo-${os}-${pluginIdx++}`,
            type: 'repo-provided',
            name: (config as any).name || `Plugin (${os})`,
            description: (config as any).version
              ? `Version ${(config as any).version}`
              : undefined,
            manifestUrl: fullUrl,
            hash: (config as any).hash,
          };

          plugins.push(descriptor);
        }
      }
    });
  }

  return plugins;
}

/**
 * Build full manifest URL from relative or absolute path
 */
function buildFullUrl(host: string, manifestPath: string, branch: string): string {
  const baseUrl = host.includes('://') ? host : `https://${host}`;

  // If already a full URL, return as-is
  if (manifestPath.startsWith('http://') || manifestPath.startsWith('https://')) {
    return manifestPath;
  }

  // Build URL with branch parameter
  const separator = baseUrl.endsWith('/') ? '' : '/';
  const path = manifestPath.startsWith('/') ? manifestPath : `/${manifestPath}`;

  return `${baseUrl}${separator}${path}?branch=${encodeURIComponent(branch)}`;
}

/**
 * Merge repo-provided plugins with built-in plugins
 * Prioritize repo-provided plugins if available
 */
export function mergePlugins(
  repoPlugins: PluginDescriptor[],
  builtInPlugins: PluginDescriptor[],
): PluginDescriptor[] {
  // Remove duplicates: if repo provides a plugin of the same type, skip built-in
  const repoTypes = new Set(repoPlugins.map((p) => p.type));
  const filtered = builtInPlugins.filter((p) => !repoTypes.has(p.type) || p.type === 'repo-provided');

  return [...repoPlugins, ...filtered];
}
