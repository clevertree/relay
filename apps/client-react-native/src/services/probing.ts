/**
 * Peer probing service for checking endpoint health and measuring latency.
 * Probes HTTPS, Git, IPFS API, IPFS Gateway, and IPFS Swarm endpoints.
 */

import {PeerProbe, PeerProtocol} from '../state/store';

const PROBE_TIMEOUT_MS = 5000;
const PROBE_SAMPLES = 3;

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
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

/**
 * Probes HTTPS endpoint (port 443) using HEAD request
 */
async function probeHttps(host: string): Promise<ProbeResult> {
  const port = 443;
  const latencies: number[] = [];

  for (let i = 0; i < PROBE_SAMPLES; i++) {
    const start = Date.now();
    try {
      // Try HTTPS first, fall back to HTTP for local dev
      const protocol = host.includes('localhost') || host.includes('10.0.2.2') ? 'http' : 'https';
      const hostPort = host.includes(':') ? host : `${host}:${protocol === 'https' ? 443 : 8080}`;
      const url = `${protocol}://${hostPort}/`;

      const res = await fetchWithTimeout(url, {method: 'HEAD', timeout: PROBE_TIMEOUT_MS});
      if (res.ok || res.status < 500) {
        latencies.push(Date.now() - start);
      }
    } catch {
      // Failed probe, don't add to latencies
    }
  }

  return {
    protocol: 'https',
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
  const baseHost = host.split(':')[0];

  for (let i = 0; i < PROBE_SAMPLES; i++) {
    const start = Date.now();
    try {
      const url = `http://${baseHost}:${port}/api/v0/version`;
      const res = await fetchWithTimeout(url, {method: 'POST', timeout: PROBE_TIMEOUT_MS});
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
  const baseHost = host.split(':')[0];

  for (let i = 0; i < PROBE_SAMPLES; i++) {
    const start = Date.now();
    try {
      const url = `http://${baseHost}:${port}/ipfs/`;
      const res = await fetchWithTimeout(url, {method: 'HEAD', timeout: PROBE_TIMEOUT_MS});
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
    const protocol = host.includes('localhost') || host.includes('10.0.2.2') ? 'http' : 'https';
    const hostPort = host.includes(':') ? host : `${host}:${protocol === 'https' ? 443 : 8080}`;
    const url = `${protocol}://${hostPort}/`;

    const res = await fetchWithTimeout(url, {method: 'OPTIONS', timeout: PROBE_TIMEOUT_MS});
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
}> {
  const [probes, options] = await Promise.all([probePeer(host), fetchPeerOptions(host)]);

  return {
    probes,
    lastUpdateTs: options.lastUpdateTs,
    branches: options.branches,
  };
}
