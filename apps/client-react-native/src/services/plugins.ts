/**
 * Plugin manifest loading and caching service
 * Handles manifest fetching, integrity verification, and ETag-based caching
 */

import {sha256} from '@noble/hashes/sha256';

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  type: 'declarative' | 'webview';
  views?: {
    main?: string; // Path to main view (markdown or JSON)
    grid?: string;
    detail?: string;
  };
  permissions?: string[];
}

export interface CachedManifest {
  manifest: PluginManifest;
  eTag?: string;
  lastModified?: string;
  contentHash?: string;
  cachedAt: number;
}

// In-memory cache for plugin manifests
const manifestCache = new Map<string, CachedManifest>();

/**
 * Compute SHA256 hash of content for integrity verification
 */
const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

export function computeContentHash(content: string): string {
  const encoder = new TextEncoder();
  return bytesToHex(sha256(encoder.encode(content)));
}

/**
 * Check if cached manifest is still fresh
 */
export function isCacheValid(cached: CachedManifest, maxAgeMs: number = 3600000): boolean {
  const age = Date.now() - cached.cachedAt;
  return age < maxAgeMs;
}

/**
 * Fetch and cache a plugin manifest
 * Supports ETag and Last-Modified headers for conditional requests
 */
export async function fetchPluginManifest(
  url: string,
  expectedHash?: string,
  maxCacheAge?: number,
): Promise<PluginManifest | null> {
  try {
    // Check cache first
    const cached = manifestCache.get(url);
    if (cached && isCacheValid(cached, maxCacheAge)) {
      return cached.manifest;
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    // Add conditional request headers if we have them cached
    if (cached?.eTag) {
      headers['If-None-Match'] = cached.eTag;
    } else if (cached?.lastModified) {
      headers['If-Modified-Since'] = cached.lastModified;
    }

    const res = await fetch(url, {headers});

    // 304 Not Modified - use cached version
    if (res.status === 304 && cached) {
      cached.cachedAt = Date.now();
      return cached.manifest;
    }

    if (!res.ok) {
      return null;
    }

    const manifestText = await res.text();
    let manifest: PluginManifest;

    try {
      manifest = JSON.parse(manifestText);
    } catch {
      return null;
    }

    // Verify integrity if hash was provided
    if (expectedHash) {
      const contentHash = computeContentHash(manifestText);
      if (contentHash !== expectedHash) {
        console.error(`Plugin manifest integrity check failed for ${url}`);
        return null;
      }
    }

    // Cache the manifest with ETag/Last-Modified headers
    const eTag = res.headers.get('ETag') || undefined;
    const lastModified = res.headers.get('Last-Modified') || undefined;
    const contentHash = computeContentHash(manifestText);

    const cacheEntry: CachedManifest = {
      manifest,
      eTag,
      lastModified,
      contentHash,
      cachedAt: Date.now(),
    };

    manifestCache.set(url, cacheEntry);
    return manifest;
  } catch (error) {
    console.error(`Failed to fetch plugin manifest from ${url}:`, error);
    return null;
  }
}

/**
 * Clear the manifest cache (useful for testing)
 */
export function clearManifestCache(): void {
  manifestCache.clear();
}

/**
 * Get cache statistics for debugging
 */
export function getCacheStats(): {cacheSize: number; urls: string[]} {
  return {
    cacheSize: manifestCache.size,
    urls: Array.from(manifestCache.keys()),
  };
}
