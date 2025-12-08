/**
 * Peer probing service for checking endpoint health and measuring latency.
 * Probes HTTPS, Git, IPFS API, IPFS Gateway, and IPFS Swarm endpoints.
 */

import {PeerProbe, PeerProtocol} from '../state/store';

const PROBE_TIMEOUT_MS = 5000;
const PROBE_SAMPLES = 3;

/**
 * Parse a full URL or host:port string to extract just hostname
 * Handles: "https://host:port", "http://host", "host:port", "host"
 */
function extractHostname(input: string): string {
  try {
    // Try parsing as full URL first
    const url = new URL(input.startsWith('http') ? input : `https://${input}`);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    // Fall back to input as-is
    return input;
  }
}

/**
 * Parse a full URL or host:port string to extract host and port
 */
function parseHostUrl(input: string): { host: string; port?: number; protocol?: string } {
  try {
    // Try parsing as full URL
    const url = new URL(input);
    const port = url.port ? parseInt(url.port, 10) : undefined;
    return {
      host: url.hostname,
      port,
      protocol: url.protocol.replace(':', ''),
    };
  } catch {
    // Fall back to host:port format
    const [host, portStr] = input.split(':');
    const port = portStr ? parseInt(portStr, 10) : undefined;
    return { host, port };
  }
}

export interface ProbeResult {
  protocol: PeerProtocol;
  port: number;
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Measures median latency from multiple samples
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Creates a fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & {timeout?: number} = {},
): Promise<Response> {
  const {timeout = PROBE_TIMEOUT_MS, ...fetchOptions} = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    console.debug(`[Probing] Fetching ${options.method || 'GET'} ${url} (timeout: ${timeout}ms)`);
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(id);
    console.debug(`[Probing] Response: ${response.status} ${response.statusText}`);
    return response;
  } catch (error) {
    clearTimeout(id);
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.debug(`[Probing] Error fetching ${url}: ${errorMsg}`);
    throw error;
  }
}

/**
 * Probes HTTP/HTTPS endpoint using HEAD request
 * Works with any valid URL (http or https)
 */
async function probeHttps(host: string): Promise<ProbeResult> {
  const latencies: number[] = [];
  let port = 443;
  let protocol: PeerProtocol = 'https';
  let urlString = host;

  try {
    // Parse the URL to extract port and protocol
    const parsed = parseHostUrl(host);
    port = parsed.port || (parsed.protocol === 'http' ? 80 : 443);
    protocol = (parsed.protocol === 'http' ? 'http' : 'https') as PeerProtocol;
    
    // Use the full URL if it was provided, otherwise construct one
    if (!host.startsWith('http')) {
      urlString = `${protocol}://${host}/`;
    }
  } catch {
    // Fall back to https if parsing fails
    urlString = `https://${host}/`;
  }

  for (let i = 0; i < PROBE_SAMPLES; i++) {
    const start = Date.now();
    try {
      const res = await fetchWithTimeout(urlString);
      if (res.ok || res.status < 500) {
        latencies.push(Date.now() - start);
      }
    } catch {
      // Failed probe, don't add to latencies
    }
  }

  return {
    protocol,
    port,
    ok: latencies.length > 0,
    latencyMs: latencies.length > 0 ? Math.round(median(latencies)) : undefined,
  };
}

/**
 * Probes IPFS API endpoint (port 5001)
 */
async function probeIpfsApi(host: string): Promise<ProbeResult> {
  const port = 5001;
  const latencies: number[] = [];
  const hostname = extractHostname(host).split(':')[0]; // Get just the hostname without port

  for (let i = 0; i < PROBE_SAMPLES; i++) {
    const start = Date.now();
    try {
      const url = `http://${hostname}:${port}/api/v0/version`;
      const res = await fetchWithTimeout(url);
      if (res.ok) {
        latencies.push(Date.now() - start);
      }
    } catch {
      // Failed probe
    }
  }

  return {
    protocol: 'ipfs-api',
    port,
    ok: latencies.length > 0,
    latencyMs: latencies.length > 0 ? Math.round(median(latencies)) : undefined,
  };
}

/**
 * Probes IPFS Gateway endpoint (port 8080)
 */
async function probeIpfsGateway(host: string): Promise<ProbeResult> {
  const port = 8080;
  const latencies: number[] = [];
  const hostname = extractHostname(host).split(':')[0]; // Get just the hostname without port

  for (let i = 0; i < PROBE_SAMPLES; i++) {
    const start = Date.now();
    try {
      const url = `http://${hostname}:${port}/ipfs/`;
      const res = await fetchWithTimeout(url);
      // Gateway may return 400 for malformed path, but that still means it's up
      if (res.status < 500) {
        latencies.push(Date.now() - start);
      }
    } catch {
      // Failed probe
    }
  }

  return {
    protocol: 'ipfs-gateway',
    port,
    ok: latencies.length > 0,
    latencyMs: latencies.length > 0 ? Math.round(median(latencies)) : undefined,
  };
}

/**
 * Probes Git endpoint (port 9418) - TCP connectivity check only
 * Note: In React Native we can't do raw TCP, so we just mark as not probed
 */
async function probeGit(_host: string): Promise<ProbeResult> {
  // Git protocol requires raw TCP socket which isn't available in RN JS runtime.
  // This will be implemented via the native Rust bridge later.
  return {
    protocol: 'git',
    port: 9418,
    ok: false,
    error: 'TCP probe requires native module',
  };
}

/**
 * Probes IPFS Swarm endpoint (port 4001) - TCP connectivity check only
 * Note: In React Native we can't do raw TCP, so we just mark as not probed
 */
async function probeIpfsSwarm(_host: string): Promise<ProbeResult> {
  // IPFS swarm requires raw TCP socket which isn't available in RN JS runtime.
  // This will be implemented via the native Rust bridge later.
  return {
    protocol: 'ipfs-swarm',
    port: 4001,
    ok: false,
    error: 'TCP probe requires native module',
  };
}

/**
 * Fetches OPTIONS from a peer to get last update timestamp and metadata
 */
export async function fetchPeerOptions(host: string): Promise<{
  lastUpdateTs?: number;
  branches?: string[];
  repos?: string[];
  branchHeads?: Record<string, string>;
  relayYaml?: unknown;
  interface?: Record<string, {plugin_manifest?: string}>;
}> {
  try {
    const hostPort = extractHostname(host);
    const url = `https://${hostPort}/`;

    const res = await fetchWithTimeout(url);
    if (!res.ok) return {};

    const data = await res.json();

    // Extract last update from branchHeads timestamps if available
    let lastUpdateTs: number | undefined;
    if (data.branchHeads && typeof data.branchHeads === 'object') {
      // branchHeads might have timestamps or commit info
      const timestamps = Object.values(data.branchHeads)
        .map((v: unknown) => {
          if (typeof v === 'number') return v;
          if (typeof v === 'object' && v && 'timestamp' in v) return (v as {timestamp: number}).timestamp;
          return 0;
        })
        .filter((t) => t > 0);
      if (timestamps.length > 0) {
        lastUpdateTs = Math.max(...timestamps);
      }
    }

    return {
      lastUpdateTs,
      branches: data.branches,
      repos: data.repos,
      branchHeads: data.branchHeads,
      relayYaml: data.relayYaml,
      interface: data.interface,
    };
  } catch {
    return {};
  }
}

/**
 * Probes all supported endpoints for a given peer host
 */
export async function probePeer(host: string): Promise<PeerProbe[]> {
  const [https, ipfsApi, ipfsGateway, git, ipfsSwarm] = await Promise.all([
    probeHttps(host),
    probeIpfsApi(host),
    probeIpfsGateway(host),
    probeGit(host),
    probeIpfsSwarm(host),
  ]);

  return [https, ipfsApi, ipfsGateway, git, ipfsSwarm].filter(
    (p) => p.ok || p.error === undefined, // Include successful probes and real failures
  );
}

/**
 * Full peer probe including OPTIONS metadata
 */
export async function fullProbePeer(host: string): Promise<{
  probes: PeerProbe[];
  lastUpdateTs?: number;
  branches?: string[];
  repos?: string[];
}> {
  const [probes, options] = await Promise.all([probePeer(host), fetchPeerOptions(host)]);

  return {
    probes,
    lastUpdateTs: options.lastUpdateTs,
    branches: options.branches,
    repos: options.repos,
  };
}
