/**
 * Peer probing service for checking endpoint health and measuring latency.
 */

import type { PeerProbe, PeerProtocol } from '../state/store'

const PROBE_TIMEOUT_MS = 5000
const PROBE_SAMPLES = 3

export interface ProbeResult {
  protocol: PeerProtocol
  port: number
  ok: boolean
  latencyMs?: number
  error?: string
}

/**
 * Extract host:port from a full URL or hostname string
 * Handles: "https://host:port", "http://host", "host:port", "host"
 */
function extractHostPort(input: string): string {
  try {
    // Remove any protocol prefix if present
    let cleanInput = input
    if (input.startsWith('http://')) {
      cleanInput = input.substring(7)
    } else if (input.startsWith('https://')) {
      cleanInput = input.substring(8)
    }
    
    // Try to parse as a full URL with a protocol prefix added
    const url = new URL(cleanInput.startsWith('http') ? cleanInput : `https://${cleanInput}`)
    // Return host:port or just host
    return url.port ? `${url.hostname}:${url.port}` : url.hostname
  } catch {
    // If parsing fails, remove protocol prefix and return as-is (might be just hostname or hostname:port)
    let cleanInput = input
    if (input.startsWith('http://')) {
      cleanInput = input.substring(7)
    } else if (input.startsWith('https://')) {
      cleanInput = input.substring(8)
    }
    return cleanInput
  }
}

/**
 * Measures median latency from multiple samples
 */
function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Creates a fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const { timeout = PROBE_TIMEOUT_MS, ...fetchOptions } = options
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    })
    clearTimeout(id)
    return response
  } catch (error) {
    clearTimeout(id)
    throw error
  }
}

/**
 * Probe HTTPS endpoint
 */
export async function probeHttps(host: string): Promise<ProbeResult> {
  const hostPort = extractHostPort(host)
  const latencies: number[] = []

  for (let i = 0; i < PROBE_SAMPLES; i++) {
    try {
      const start = performance.now()
      // Use HEAD with no-cors mode to avoid CORS preflight issues
      await fetchWithTimeout(`https://${hostPort}/`, {
        method: 'HEAD',
        timeout: PROBE_TIMEOUT_MS,
        mode: 'no-cors',
      })
      const latency = performance.now() - start
      latencies.push(latency)
      // If we got here, connection succeeded
      return {
        protocol: 'https',
        port: 443,
        ok: true,
        latencyMs: median(latencies),
      }
    } catch {
      // Continue to next sample
    }
  }

  return {
    protocol: 'https',
    port: 443,
    ok: false,
    latencyMs: latencies.length > 0 ? median(latencies) : undefined,
    error: 'HTTPS probe failed',
  }
}

/**
 * Probe HTTP endpoint (for local development)
 */
export async function probeHttp(host: string): Promise<ProbeResult> {
  const hostPort = extractHostPort(host)
  const latencies: number[] = []

  for (let i = 0; i < PROBE_SAMPLES; i++) {
    try {
      const start = performance.now()
      const response = await fetchWithTimeout(`http://${hostPort}/`, {
        method: 'OPTIONS',
        timeout: PROBE_TIMEOUT_MS,
      })
      const latency = performance.now() - start
      latencies.push(latency)

      if (response.ok) {
        return {
          protocol: 'https',
          port: 80,
          ok: true,
          latencyMs: median(latencies),
        }
      }
    } catch {
      // Continue to next sample
    }
  }

  return {
    protocol: 'https',
    port: 80,
    ok: false,
    latencyMs: latencies.length > 0 ? median(latencies) : undefined,
    error: 'HTTP probe failed',
  }
}

/**
 * Fetch peer options from OPTIONS endpoint
 */
export async function fetchPeerOptions(
  host: string,
): Promise<{
  branches?: string[]
  repos?: string[]
  branchHeads?: Record<string, string>
  lastUpdateTs?: number
}> {
  const hostPort = extractHostPort(host)
  const isSecureContext = window.location.protocol === 'https:'
  const protocols = isSecureContext ? ['https', 'http'] : ['http', 'https']

  for (const protocol of protocols) {
    try {
      const response = await fetchWithTimeout(`${protocol}://${hostPort}/`, {
        method: 'OPTIONS',
        timeout: PROBE_TIMEOUT_MS,
      })

      if (response.ok) {
        const data = await response.json()
        return {
          branches: data.branches,
          repos: data.repos,
          branchHeads: data.branchHeads,
          lastUpdateTs: Date.now(),
        }
      }
    } catch (err) {
      // Continue to next protocol
      continue
    }
  }

  return {}
}

/**
 * Full probe of a peer (HTTPS + HTTP + OPTIONS)
 */
export async function fullProbePeer(
  host: string,
): Promise<{
  probes: PeerProbe[]
  branches?: string[]
  repos?: string[]
  lastUpdateTs?: number
}> {
  const probes: PeerProbe[] = []
  const isSecureContext = window.location.protocol === 'https:'

  // Probe HTTPS
  const httpsProbe = await probeHttps(host)
  probes.push(httpsProbe)

  // If HTTPS not OK and we're not in a secure context, probe HTTP
  // (avoid mixed content warnings in HTTPS pages)
  if (!httpsProbe.ok && !isSecureContext) {
    const httpProbe = await probeHttp(host)
    probes.push(httpProbe)
  }

  // Fetch options
  const options = await fetchPeerOptions(host)

  return {
    probes,
    branches: options.branches,
    repos: options.repos,
    lastUpdateTs: options.lastUpdateTs,
  }
}
