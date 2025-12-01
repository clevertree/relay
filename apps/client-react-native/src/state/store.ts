import {create} from 'zustand';

export type PeerProtocol = 'https' | 'git' | 'ssh' | 'ipfs-api' | 'ipfs-gateway' | 'ipfs-swarm';

export type PeerProbe = {
  protocol: PeerProtocol;
  port: number;
  ok: boolean;
  latencyMs?: number;
};

export type PeerInfo = {
  host: string;
  lastUpdateTs?: number; // epoch millis
  probes: PeerProbe[];
};

export type AppState = {
  peers: PeerInfo[];
  setPeers: (hosts: string[]) => void;
  updatePeer: (host: string, updater: (p: PeerInfo) => PeerInfo) => void;
};

export const useAppState = create<AppState>((set) => ({
  peers: [],
  setPeers: (hosts) =>
    set({
      peers: hosts.map((h) => ({ host: h, probes: [] })),
    }),
  updatePeer: (host, updater) =>
    set((s) => ({
      peers: s.peers.map((p) => (p.host === host ? updater(p) : p)),
    })),
}));
