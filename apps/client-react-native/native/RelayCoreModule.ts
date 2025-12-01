import {NativeModules, Platform} from 'react-native';

// Typescript surface for the bridge. Native implementation will arrive later.
export type RelayCoreBridge = {
  // Returns list of peer hosts from environment or native config
  getMasterPeerList(): Promise<string[]>;
  // Starts background probing (native impl TBD)
  startPeersProbe?(hosts: string[]): Promise<void>;
  // Stops background probing
  stopPeersProbe?(): Promise<void>;
};

// JS fallback implementation for early UI bring-up.
const jsFallback: RelayCoreBridge = {
  async getMasterPeerList() {
    // Prefer a global injected value during development.
    const injected = (globalThis as any).RN$RELAY_MASTER_PEER_LIST as string | undefined;
    const fromGlobal = injected?.split(/\s*;\s*/).filter(Boolean);
    if (fromGlobal && fromGlobal.length > 0) return fromGlobal;

    // Metro doesn't expose process.env by default in RN runtime; this is a best-effort.
    const env = (process as any)?.env?.RELAY_MASTER_PEER_LIST as string | undefined;
    const fromEnv = env?.split(/\s*;\s*/).filter(Boolean);
    if (fromEnv && fromEnv.length > 0) return fromEnv;

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
