import {NativeModules, Platform, NativeEventEmitter} from 'react-native';

// Typescript surface for the bridge. Native implementation will arrive later.
export type RelayCoreBridge = {
  // Returns list of peer hosts from environment or native config
  getMasterPeerList(): Promise<string[]>;
  // Probes a single peer on all protocols
  probePeer?(host: string, timeoutMs?: number): Promise<PeerProbeResult>;
  // Fetches OPTIONS from a peer (metadata)
  fetchOptions?(host: string, timeoutMs?: number): Promise<OptionsResult>;
  // GETs a file from a peer (returns base64)
  getFile?(host: string, path: string, branch?: string, timeoutMs?: number): Promise<string>;
  // Starts background probing (native impl)
  startPeersProbe?(hosts: string[], intervalMs?: number): Promise<void>;
  // Stops background probing
  stopPeersProbe?(): Promise<void>;
};

export interface PeerProbeResult {
  host: string;
  probes: Array<{
    protocol: string;
    port: number;
    ok: boolean;
    latencyMs?: number;
    error?: string;
  }>;
  branches?: string[];
}

export interface OptionsResult {
  branches?: string[];
  repos?: string[];
  branch_heads?: Record<string, unknown>;
}

// JS fallback implementation for early UI bring-up.
const jsFallback: RelayCoreBridge = {
  async getMasterPeerList() {
    // Prefer a global injected value during development.
    const injected = (globalThis as Record<string, unknown>).RN$RELAY_MASTER_PEER_LIST as string | undefined;
    const fromGlobal = injected?.split(/\s*;\s*/).filter(Boolean);
    if (fromGlobal && fromGlobal.length > 0) return fromGlobal;

    // Platform-specific sensible defaults for local development.
    return Platform.select({
      android: ['10.0.2.2:8080'], // Android emulator to host
      ios: ['localhost:8080'],
      default: ['localhost:8080'],
    }) as string[];
  },
};

const Native = NativeModules.RelayCoreModule as RelayCoreBridge | undefined;

export const RelayCore: RelayCoreBridge = Native ?? jsFallback;

/**
 * Event emitter for peer probe updates (Android background probing)
 */
let eventEmitter: NativeEventEmitter | null = null;

export function getPeerProbeEventEmitter(): NativeEventEmitter | null {
  if (!eventEmitter && NativeModules.RelayCoreModule) {
    eventEmitter = new NativeEventEmitter(NativeModules.RelayCoreModule);
  }
  return eventEmitter;
}

/**
 * Listen to peer probe updates from native background probing
 */
export function onPeerProbeUpdate(callback: (host: string, data: PeerProbeResult) => void): () => void {
  const emitter = getPeerProbeEventEmitter();
  if (!emitter) return () => {};

  const subscription = emitter.addListener('peer_probe_update', (event: {host: string; data: PeerProbeResult}) => {
    callback(event.host, event.data);
  });

  return () => subscription.remove();
}
