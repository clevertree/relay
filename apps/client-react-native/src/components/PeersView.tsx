import React, {useCallback, useEffect, useRef} from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useAppState, type PeerInfo, type PeerProbe} from '../state/store';
import {RelayCore} from '../../native/RelayCoreModule';
import {fullProbePeer} from '../services/probing';

const AUTO_REFRESH_INTERVAL_MS = 10000; // 10 seconds

interface PeersViewProps {
  onPeerPress?: (host: string) => void;
}

const PeersViewComponent: React.FC<PeersViewProps> = ({onPeerPress}) => {
  const peers = useAppState((s) => s.peers);
  const setPeers = useAppState((s) => s.setPeers);
  const updatePeer = useAppState((s) => s.updatePeer);
  const setPeerProbing = useAppState((s) => s.setPeerProbing);
  const autoRefreshEnabled = useAppState((s) => s.autoRefreshEnabled);
  const setAutoRefresh = useAppState((s) => s.setAutoRefresh);
  const setLastRefreshTs = useAppState((s) => s.setLastRefreshTs);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Probe a single peer
  const probePeer = useCallback(
    async (host: string) => {
      setPeerProbing(host, true);
      try {
        const result = await fullProbePeer(host);
        updatePeer(host, (p) => ({
          ...p,
          probes: result.probes,
          lastUpdateTs: result.lastUpdateTs,
          branches: result.branches,
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
    const currentPeers = useAppState.getState().peers;
    await Promise.all(currentPeers.map((p) => probePeer(p.host)));
    setLastRefreshTs(Date.now());
  }, [probePeer, setLastRefreshTs]);

  // Initial load
  const loadAndProbePeers = useCallback(async () => {
    setIsRefreshing(true);
    try {
      console.log('[PeersView] Loading peers from RelayCore');
      const envPeers = await RelayCore.getMasterPeerList();
      console.log('[PeersView] Got peers:', envPeers);
      setPeers(envPeers);
      // Probe all peers after setting them
      if (envPeers.length > 0) {
        console.log('[PeersView] Probing all peers');
        await Promise.all(envPeers.map((host) => probePeer(host)));
      }
      setLastRefreshTs(Date.now());
      console.log('[PeersView] Load complete');
    } catch (err) {
      console.error('[PeersView] Error loading peers:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [setPeers, probePeer, setLastRefreshTs]);

  // Setup auto-refresh interval
  useEffect(() => {
    if (autoRefreshEnabled) {
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
  }, [autoRefreshEnabled, probeAllPeers]);

  // Initial load
  useEffect(() => {
    loadAndProbePeers();
  }, []);

  const getStatusColor = (ok: boolean): string => (ok ? '#28a745' : '#dc3545');

  const renderProbeStatus = (probe: PeerProbe) => {
    const label =
      probe.protocol === 'https'
        ? 'HTTPS'
        : probe.protocol === 'ipfs-api'
          ? 'IPFS API'
          : probe.protocol === 'ipfs-gateway'
            ? 'Gateway'
            : probe.protocol === 'git'
              ? 'Git'
              : probe.protocol === 'ipfs-swarm'
                ? 'Swarm'
                : probe.protocol.toUpperCase();

    return (
      <View key={probe.protocol} style={styles.probeChip}>
        <View
          style={[styles.statusDot, {backgroundColor: getStatusColor(probe.ok)}]}
        />
        <Text style={styles.probeLabel}>{label}</Text>
        {probe.ok && probe.latencyMs !== undefined && (
          <Text style={styles.latencyText}>{probe.latencyMs}ms</Text>
        )}
      </View>
    );
  };

  const renderItem = ({item}: {item: PeerInfo}) => {
    const httpsProbe = item.probes.find((p) => p.protocol === 'https');
    const anyUp = item.probes.some((p) => p.ok);

    return (
      <TouchableOpacity
        style={styles.peerItem}
        onPress={() => onPeerPress?.(item.host)}
        disabled={!onPeerPress}>
        <View style={styles.peerHeader}>
          <View
            style={[
              styles.overallStatus,
              {backgroundColor: anyUp ? '#28a745' : '#dc3545'},
            ]}
          />
          <Text style={styles.hostText}>{item.host}</Text>
          {item.isProbing && (
            <ActivityIndicator size="small" color="#007AFF" style={styles.probingIndicator} />
          )}
        </View>

        {/* Probe status chips */}
        <View style={styles.probesContainer}>
          {item.probes.length > 0 ? (
            item.probes
              .filter((p) => p.ok || !p.error) // Show successful or actual failures
              .map(renderProbeStatus)
          ) : (
            <Text style={styles.noProbsText}>
              {item.isProbing ? 'Probing...' : 'No probes yet'}
            </Text>
          )}
        </View>

        {/* Last update info */}
        {item.lastUpdateTs && (
          <Text style={styles.lastUpdateText}>
            Last update: {new Date(item.lastUpdateTs).toLocaleString()}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Auto-refresh toggle */}
      <View style={styles.controlsBar}>
        <View style={styles.autoRefreshControl}>
          <Text style={styles.controlLabel}>Auto-refresh (10s)</Text>
          <Switch
            value={autoRefreshEnabled}
            onValueChange={setAutoRefresh}
            trackColor={{false: '#ccc', true: '#81b0ff'}}
            thumbColor={autoRefreshEnabled ? '#007AFF' : '#f4f3f4'}
          />
        </View>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={loadAndProbePeers}
          disabled={isRefreshing}>
          <Text style={styles.refreshButtonText}>
            {isRefreshing ? 'Refreshing...' : 'Refresh Now'}
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={peers}
        keyExtractor={(p) => p.host}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={loadAndProbePeers} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              No peers configured. Set RELAY_MASTER_PEER_LIST or add manually.
            </Text>
          </View>
        }
        contentContainerStyle={peers.length === 0 ? styles.emptyList : undefined}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  controlsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  autoRefreshControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controlLabel: {
    fontSize: 14,
    color: '#666',
  },
  refreshButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  refreshButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  peerItem: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 8,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  peerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  overallStatus: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  hostText: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  probingIndicator: {
    marginLeft: 8,
  },
  probesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  probeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  probeLabel: {
    fontSize: 12,
    color: '#333',
  },
  latencyText: {
    fontSize: 11,
    color: '#666',
    fontWeight: '500',
  },
  noProbsText: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
  },
  lastUpdateText: {
    fontSize: 11,
    color: '#999',
    marginTop: 8,
  },
  emptyContainer: {
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    color: '#666',
    textAlign: 'center',
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
  },
});

export const PeersView = PeersViewComponent;
export default PeersViewComponent;
