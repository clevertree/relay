import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useAppState, TabInfo} from '../state/store';
import {fetchPeerOptions} from '../services/probing';
import * as Plugins from '../plugins';
import PluginSwitcher from '../plugins/PluginSwitcher';

interface RepoTabProps {
  tabId: string;
}

interface OptionsInfo {
  branches?: string[];
  repos?: string[];
  branchHeads?: Record<string, string>;
  relayYaml?: unknown;
  lastUpdateTs?: number;
  interface?: Record<string, {plugin_manifest?: string}>;
}

const RepoTabComponent: React.FC<RepoTabProps> = ({tabId}) => {
  const tab = useAppState((s) => s.tabs.find((t) => t.id === tabId));
  const updateTab = useAppState((s) => s.updateTab);
  // Diagnostic: log available plugin exports to help find undefined components
  // eslint-disable-next-line no-console
  console.log('Available plugin exports:', Object.keys(Plugins));
  // eslint-disable-next-line no-console
  console.log('PluginSwitcher type:', typeof PluginSwitcher);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [optionsInfo, setOptionsInfo] = useState<OptionsInfo>({});
  const [pathInput, setPathInput] = useState(tab?.path ?? '/');
  const [pluginSwitcherVisible, setPluginSwitcherVisible] = useState(false);
  const [discoveredPlugins, setDiscoveredPlugins] = useState<any[]>([]);

  useEffect(() => {
    if (!tab) return;
    loadOptions();
  }, [tab?.host]);

  const loadOptions = async () => {
    if (!tab) return;
    setLoading(true);
    setError(null);

    try {
      const options = await fetchPeerOptions(tab.host);
      setOptionsInfo(options);
      
      // Discover repo-provided plugins
      if (options.interface) {
        const plugins = Object.entries(options.interface).map(([os, config]) => ({
          id: `repo-${os}`,
          type: 'repo-provided',
          name: `Repo Plugin (${os})`,
          manifestUrl: config.plugin_manifest,
        }));
        setDiscoveredPlugins(plugins);
      }

      if (options.branches && options.branches.length > 0 && !tab.currentBranch) {
        updateTab(tabId, (t) => ({
          ...t,
          branches: options.branches,
          currentBranch: options.branches![0],
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load peer info');
    } finally {
      setLoading(false);
    }
  };

  if (!tab) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Tab not found</Text>
      </View>
    );
  }

  // Render the selected plugin with defensive checks
  const renderPluginContent = () => {
    // Map plugin IDs to component factories
    const mapping: Record<string, any> = {
      'builtin-webview': (Plugins as any).WebViewPlugin,
      'native-repo-browser': (Plugins as any).DefaultNativePlugin,
      'builtin-declarative': (Plugins as any).DeclarativePlugin,
    };

    const Component = mapping[tab.pluginId] ?? mapping['native-repo-browser'];

    if (!Component) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Plugin not available: {tab.pluginId}</Text>
        </View>
      );
    }

    // If Component is an object with a default property (common when interop wrappers happen), unwrap it
    const ResolvedComponent = (Component as any).default ? (Component as any).default : Component;

    // Validate ResolvedComponent is renderable
    if (typeof ResolvedComponent !== 'function' && typeof ResolvedComponent !== 'object') {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Invalid plugin component for: {tab.pluginId}</Text>
        </View>
      );
    }

    return (
      <ResolvedComponent
        host={tab.host}
        branch={tab.currentBranch}
        initialPath={pathInput}
        onNavigate={(path: string) => {
          setPathInput(path);
          updateTab(tabId, (t) => ({...t, path}));
        }}
        // Additional props for declarative plugins
        manifestUrl={tab.pluginManifestUrl}
        expectedHash={tab.pluginHash}
      />
    );
  };

  return (
    <View style={styles.container}>
      {/* Header with host info and plugin selector */}
      <View style={styles.header}>
        <Text style={styles.hostText}>{tab.host}</Text>
        {tab.currentBranch && (
          <View style={styles.branchBadge}>
            <Text style={styles.branchText}>{tab.currentBranch}</Text>
          </View>
        )}
        <TouchableOpacity
          style={styles.pluginButton}
          onPress={() => setPluginSwitcherVisible(true)}>
          <Text style={styles.pluginButtonText}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* Plugin switcher modal */}
      <PluginSwitcher
        tabId={tabId}
        visible={pluginSwitcherVisible}
        onClose={() => setPluginSwitcherVisible(false)}
        availablePlugins={discoveredPlugins}
      />

      {/* Plugin content area */}
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
        renderPluginContent()
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
  pluginButton: {
    padding: 8,
  },
  pluginButtonText: {
    fontSize: 18,
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
