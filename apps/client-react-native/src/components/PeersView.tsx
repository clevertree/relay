import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { Text, TextInput, TouchableOpacity, View } from '../tailwindPrimitives';
import {useAppState, type PeerInfo, type PeerProbe} from '../state/store';
import {RelayCore} from '../../native/RelayCoreModule';
import {fullProbePeer} from '../services/probing';

const AUTO_REFRESH_INTERVAL_MS = 10000; // 10 seconds

interface PeersViewProps {
  onPeerPress?: (host: string) => void;
  isActive?: boolean;
}

/**
 * Helper function to safely render array fields that might contain objects or strings
 */
function renderArrayField(items: any[]): string {
  if (!Array.isArray(items)) {
    return String(items);
  }

  return items
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      if (typeof item === 'object' && item !== null && 'name' in item) {
        return item.name;
      }
      if (typeof item === 'object' && item !== null && 'path' in item) {
        return item.path;
      }
      // Fallback: just use the string representation
      return String(item);
    })
    .join(', ');
}

const PeersViewComponent: React.FC<PeersViewProps> = ({onPeerPress, isActive = true}) => {
  const peers = useAppState((s) => s.peers);
  const setPeers = useAppState((s) => s.setPeers);
  const updatePeer = useAppState((s) => s.updatePeer);
  const setPeerProbing = useAppState((s) => s.setPeerProbing);
  const setLastRefreshTs = useAppState((s) => s.setLastRefreshTs);
  const addPeer = useAppState((s) => s.addPeer);
  const removePeer = useAppState((s) => s.removePeer);
  const [newPeerInput, setNewPeerInput] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isActiveRef = useRef(isActive);

  // Probe a single peer
  const probePeer = useCallback(
    async (host: string) => {
      if (!isActiveRef.current) {
        console.log(`[PeersView] Skipping probe for ${host} while inactive`);
        return;
      }
      setPeerProbing(host, true);
      try {
        const result = await fullProbePeer(host);
        updatePeer(host, (p) => ({
          ...p,
          probes: result.probes,
          lastUpdateTs: result.lastUpdateTs,
          branches: result.branches,
          repos: result.repos,
          isProbing: false,
        }));
      } catch (e) {
        updatePeer(host, (p) => ({
          ...p,
          isProbing: false,
        }));
      }
    },
      [setPeerProbing, updatePeer],
    );

  // Probe all peers
  const probeAllPeers = useCallback(async () => {
    if (!isActiveRef.current) {
      console.log('[PeersView] Skipping probeAll while inactive');
      return;
    }
    const currentPeers = useAppState.getState().peers;
    await Promise.all(currentPeers.map((p) => probePeer(p.host)));
    setLastRefreshTs(Date.now());
  }, [probePeer, setLastRefreshTs]);

  // Load peers from RelayCore (simulate fetching from tracker)
  const loadAndProbePeers = useCallback(async () => {
    if (!isActiveRef.current) {
      console.log('[PeersView] Skipping load while inactive');
      return;
    }
    console.log('[PeersView] Loading peers from RelayCore');
    try {
      const envPeers = await RelayCore.getMasterPeerList();
      console.log('[PeersView] Got peers:', envPeers);
      await setPeers(envPeers);
      // Probe all peers after setting them
      if (envPeers.length > 0) {
        console.log('[PeersView] Probing all peers');
        await Promise.all(envPeers.map((host) => probePeer(host)));
      }
      setLastRefreshTs(Date.now());
      console.log('[PeersView] Load complete');
    } catch (err) {
      console.error('[PeersView] Error loading peers:', err);
    }
  }, [setPeers, probePeer, setLastRefreshTs]);

  // Setup auto-refresh interval
  useEffect(() => {
    if (!isActive) {
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }
    if (false) { // Disabled for now
      intervalRef.current = setInterval(() => {
        probeAllPeers();
      }, AUTO_REFRESH_INTERVAL_MS);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [probeAllPeers, isActive]);

  // Initial load
  useEffect(() => {
    if (!isActive) {
      return;
    }
    loadAndProbePeers();
  }, [isActive, loadAndProbePeers]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // Get status and probe info
  const renderProbeStatus = (peer: PeerInfo) => {
    if (!peer.probes || peer.probes.length === 0) {
      return <Text style={styles.statusText}>Not probed</Text>;
    }

    const okProbes = peer.probes.filter((p) => p.ok);
    if (okProbes.length === 0) {
      return <Text style={[styles.statusText, styles.statusOffline]}>Offline</Text>;
    }

    const latency = okProbes[0].latencyMs;
    return (
      <Text style={[styles.statusText, styles.statusOnline]}>
        Online {latency ? `(${latency}ms)` : ''}
      </Text>
    );
  };

  const handlePeerPress = (host: string) => {
    onPeerPress?.(host);
  };

  const handleAddPeer = async (e: any) => {
    e.preventDefault();
    const trimmedInput = newPeerInput.trim();
    if (trimmedInput) {
      await addPeer(trimmedInput);
      setNewPeerInput('');
      // Probe the new peer immediately
      probePeer(trimmedInput);
    }
  };

  const handleRemovePeer = async (e: any, host: string) => {
    e.stopPropagation();
    await removePeer(host);
  };

  const renderItem = ({item}: {item: PeerInfo}) => (
    <TouchableOpacity
      className="bg-white rounded p-4"
      style={{ borderWidth: 1, borderColor: '#e9ecef', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 }}
      onPress={() => handlePeerPress(item.host)}
      disabled={!onPeerPress}>
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center flex-1">
          <Text className="text-base font-semibold flex-1" style={{ color: '#333' }}>{item.host}</Text>
          {item.isProbing && (
            <ActivityIndicator size="small" color="#007AFF" style={{ marginLeft: 8 }} />
          )}
        </View>
        <View className="flex-row items-center" style={{ columnGap: 8 }}>
          {renderProbeStatus(item)}
          <TouchableOpacity
            className="w-8 h-8 rounded-full items-center justify-center"
            style={{ backgroundColor: '#f8d7da' }}
            onPress={(e) => handleRemovePeer(e, item.host)}>
            <Text className="text-white font-semibold">✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      {item.branches && item.branches.length > 0 && (
        <View className="flex-row items-start mb-2">
          <Text className="text-xs font-semibold mr-2" style={{ color: '#555' }}>Branches:</Text>
          <Text className="text-xs" style={{ color: '#333' }}>{renderArrayField(item.branches)}</Text>
        </View>
      )}

      {item.repos && item.repos.length > 0 && (
        <View className="flex-row items-start mb-2">
          <Text className="text-xs font-semibold mr-2" style={{ color: '#555' }}>Repos:</Text>
          <Text className="text-xs" style={{ color: '#333' }}>{renderArrayField(item.repos)}</Text>
        </View>
      )}

      <TouchableOpacity
        className="mt-2 self-start px-3 py-2 rounded"
        style={{ backgroundColor: '#007AFF' }}
        onPress={(e) => {
          e.stopPropagation();
          handlePeerPress(item.host);
        }}>
        <Text className="text-white text-sm font-semibold">Open →</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View className="flex-1" style={{ backgroundColor: '#f8f9fa' }}>
      <View className="p-4 border-b bg-white" style={{ borderBottomColor: '#e9ecef', borderBottomWidth: 1 }}>
        <View className="flex-row items-center mb-4">
          <Text className="text-2xl mr-2">⚡</Text>
          <Text className="text-xl font-bold" style={{ color: '#333' }}>Relay</Text>
        </View>

        {/* Add peer input form */}
        <View className="flex-row" style={{ columnGap: 8 }}>
          <TextInput
            className="flex-1 px-3 py-2 rounded"
            style={{ borderWidth: 1, borderColor: '#ddd' }}
            placeholder="host:port"
            value={newPeerInput}
            onChangeText={setNewPeerInput}
            onSubmitEditing={handleAddPeer}
          />
          <TouchableOpacity className="px-4 py-2 rounded justify-center" style={{ backgroundColor: '#28a745' }} onPress={handleAddPeer}>
            <Text className="text-white text-sm font-semibold">Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={peers}
        keyExtractor={(item) => item.host}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, rowGap: 12 }}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={loadAndProbePeers} />
        }
        ListEmptyComponent={
          <View className="items-center justify-center p-8">
            <Text className="text-sm text-center" style={{ color: '#666' }}>
              No peers configured. Add one using the form above or set RELAY_PEERS environment variable.
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
    padding: 16,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  logo: {
    fontSize: 24,
    marginRight: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  addPeerForm: {
    flexDirection: 'row',
    gap: 8,
  },
  peerInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  addButton: {
    backgroundColor: '#28a745',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    justifyContent: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  listContainer: {
    padding: 16,
    gap: 12,
  },
  peerItem: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  peerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  peerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  hostText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  probingIndicator: {
    marginLeft: 8,
  },
  peerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    fontWeight: '500',
    textAlign: 'center',
    minWidth: 60,
  },
  statusOffline: {
    backgroundColor: '#f8d7da',
    color: '#721c24',
  },
  statusOnline: {
    backgroundColor: '#d4edda',
    color: '#155724',
  },
  removeButton: {
    padding: 4,
  },
  removeButtonText: {
    fontSize: 16,
    color: '#dc3545',
    fontWeight: 'bold',
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 8,
    alignItems: 'flex-start',
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginRight: 8,
    minWidth: 70,
  },
  infoText: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  openButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 12,
  },
  openButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
});

export default PeersViewComponent;
