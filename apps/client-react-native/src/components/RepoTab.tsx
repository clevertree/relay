import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useAppState} from '../state/store';
import {fetchPeerOptions} from '../services/probing';
import RepoBrowser from './RepoBrowser';

interface RepoTabProps {
  tabId: string;
}

interface OptionsInfo {
  branches?: string[];
  repos?: string[];
  branchHeads?: Record<string, string>;
  relayYaml?: unknown;
  lastUpdateTs?: number;
}

const RepoTabComponent: React.FC<RepoTabProps> = ({tabId}) => {
  const tab = useAppState((s) => s.tabs.find((t) => t.id === tabId));
  const updateTab = useAppState((s) => s.updateTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [_optionsInfo, setOptionsInfo] = useState<OptionsInfo>({});
  const [pathInput, setPathInput] = useState(tab?.path ?? '/');

  useEffect(() => {
    if (!tab) {
      console.warn(`[RepoTab] Tab with ID ${tabId} not found. Tabs available:`, useAppState.getState().tabs.map(t => t.id));
      return;
    }
    loadOptions();
  }, [tab?.host, tabId]);

  const loadOptions = async () => {
    if (!tab) return;
    console.log('[RepoTab] loadOptions called for host:', tab.host);
    setLoading(true);
    setError(null);

    try {
      // Skip actual fetch for now - use defaults and let RepoBrowser load
      console.log('[RepoTab] Using default options (skipping fetch)');
      setOptionsInfo({
        branches: ['main'],
      });
      
      if (!tab.currentBranch) {
        updateTab(tabId, (t) => ({
          ...t,
          branches: ['main'],
          currentBranch: 'main',
        }));
      }
    } catch (e) {
      console.error('[RepoTab] Error in loadOptions:', e);
      setError(e instanceof Error ? e.message : 'Failed to load peer info');
    } finally {
      console.log('[RepoTab] loadOptions finished, setting loading=false');
      setLoading(false);
    }
  };

  if (!tab) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Tab not found (ID: {tabId})</Text>
          <Text style={{color: '#666', marginTop: 8, fontSize: 12}}>
            The tab may have been closed or is still loading.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {console.log('[RepoTab] rendering, loading:', loading, 'error:', error)}
      {/* Header with host info */}
      <View style={styles.header}>
        <Text style={styles.hostText}>{tab.host}</Text>
        {tab.currentBranch && (
          <View style={styles.branchBadge}>
            <Text style={styles.branchText}>{tab.currentBranch}</Text>
          </View>
        )}
      </View>

      {/* Content area */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading peer info...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadOptions}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <RepoBrowser
          host={tab.host}
          branch={tab.currentBranch}
          initialPath={pathInput}
          onNavigate={(path: string) => {
            setPathInput(path);
            updateTab(tabId, (t) => ({...t, path}));
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#f8f9fa',
  },
  hostText: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  branchBadge: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 8,
  },
  branchText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: '#dc3545',
    textAlign: 'center',
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});

export const RepoTab = RepoTabComponent;
export default RepoTabComponent;
