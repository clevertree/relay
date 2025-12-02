/**
 * Declarative Plugin Renderer
 * Renders repo-provided plugin manifests with support for:
 * - Markdown views
 * - Grid/table views
 * - Detail/JSON views
 * - Action buttons
 */

import React, {useState, useEffect, useCallback} from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {fetchPluginManifest, type PluginManifest} from '../services/plugins';
import MarkdownView from '../components/MarkdownView';

interface DeclarativePluginProps {
  host: string;
  branch?: string;
  manifestUrl: string;
  expectedHash?: string;
  onNavigate?: (path: string) => void;
}

interface GridViewData {
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

const DeclarativePluginComponent: React.FC<DeclarativePluginProps> = ({
  host,
  branch = 'main',
  manifestUrl,
  expectedHash,
  onNavigate,
}) => {
  const [manifest, setManifest] = useState<PluginManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewType, setViewType] = useState<'main' | 'grid' | 'detail'>('main');
  const [viewData, setViewData] = useState<GridViewData | string | unknown>(null);
  const [refreshing, setRefreshing] = useState(false);

  const getBaseUrl = useCallback(() => {
    if (host.includes('localhost') || host.includes('10.0.2.2')) {
      const port = host.includes(':') ? '' : ':8080';
      return `http://${host}${port}`;
    }
    return `https://${host}`;
  }, [host]);

  const loadManifest = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const manifest = await fetchPluginManifest(manifestUrl, expectedHash, 3600000);
      if (!manifest) {
        throw new Error('Failed to load plugin manifest');
      }

      setManifest(manifest);

      // Load the main view by default
      if (manifest.views?.main) {
        await loadView(manifest.views.main, 'main');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [manifestUrl, expectedHash]);

  const loadView = useCallback(
    async (viewPath: string, type: 'main' | 'grid' | 'detail') => {
      try {
        setLoading(true);
        const baseUrl = getBaseUrl();
        const url = `${baseUrl}/${viewPath.replace(/^\//, '')}`;

        const res = await fetch(url, {
          headers: {
            'X-Relay-Branch': branch,
          },
        });

        if (!res.ok) {
          throw new Error(`Failed to fetch view: ${res.status}`);
        }

        const contentType = res.headers.get('Content-Type') || '';
        let data: GridViewData | string | unknown;

        if (contentType.includes('application/json')) {
          data = await res.json();
          // Try to detect grid data structure
          if (data && typeof data === 'object' && 'columns' in data && 'rows' in data) {
            setViewData(data);
          } else {
            setViewData(data);
          }
        } else {
          // Assume markdown
          data = await res.text();
          setViewData(data);
        }

        setViewType(type);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load view');
      } finally {
        setLoading(false);
      }
    },
    [getBaseUrl, branch],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadManifest();
    } finally {
      setRefreshing(false);
    }
  }, [loadManifest]);

  useEffect(() => {
    loadManifest();
  }, [loadManifest]);

  if (loading && !manifest) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading plugin...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!manifest) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No plugin data</Text>
      </View>
    );
  }

  const renderGridView = (data: GridViewData) => {
    const {columns, rows} = data;

    return (
      <ScrollView horizontal style={styles.gridContainer}>
        <View>
          {/* Header row */}
          <View style={styles.gridRow}>
            {columns.map((col) => (
              <View key={col} style={styles.gridHeaderCell}>
                <Text style={styles.gridHeaderText}>{col}</Text>
              </View>
            ))}
          </View>

          {/* Data rows */}
          {rows.map((row, rowIdx) => (
            <View key={rowIdx} style={styles.gridRow}>
              {columns.map((col) => (
                <View key={`${rowIdx}-${col}`} style={styles.gridCell}>
                  <Text style={styles.gridCellText}>{String(row[col] ?? '')}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    );
  };

  const renderDetailView = (data: unknown) => {
    if (typeof data === 'string') {
      return (
        <ScrollView style={styles.detailContainer}>
          <MarkdownView content={data} onLinkPress={onNavigate} />
        </ScrollView>
      );
    }

    // JSON detail view
    return (
      <ScrollView style={styles.detailContainer}>
        <Text style={styles.detailText}>{JSON.stringify(data, null, 2)}</Text>
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      {/* Tab/View selector */}
      <View style={styles.viewSelector}>
        {manifest.views?.main && (
          <TouchableOpacity
            style={[styles.viewTab, viewType === 'main' && styles.viewTabActive]}
            onPress={() => manifest.views?.main && loadView(manifest.views.main, 'main')}>
            <Text style={[styles.viewTabText, viewType === 'main' && styles.viewTabTextActive]}>
              Main
            </Text>
          </TouchableOpacity>
        )}
        {manifest.views?.grid && (
          <TouchableOpacity
            style={[styles.viewTab, viewType === 'grid' && styles.viewTabActive]}
            onPress={() => manifest.views?.grid && loadView(manifest.views.grid!, 'grid')}>
            <Text style={[styles.viewTabText, viewType === 'grid' && styles.viewTabTextActive]}>
              Grid
            </Text>
          </TouchableOpacity>
        )}
        {manifest.views?.detail && (
          <TouchableOpacity
            style={[styles.viewTab, viewType === 'detail' && styles.viewTabActive]}
            onPress={() => manifest.views?.detail && loadView(manifest.views.detail!, 'detail')}>
            <Text style={[styles.viewTabText, viewType === 'detail' && styles.viewTabTextActive]}>
              Details
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Content area */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      ) : viewType === 'grid' && viewData && typeof viewData === 'object' && 'columns' in viewData ? (
        renderGridView(viewData as GridViewData)
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          style={styles.contentContainer}>
          {renderDetailView(viewData)}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
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
  errorText: {
    color: '#dc3545',
    textAlign: 'center',
    padding: 20,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
    alignSelf: 'center',
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  viewSelector: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#f8f9fa',
  },
  viewTab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    alignItems: 'center',
  },
  viewTabActive: {
    borderBottomColor: '#007AFF',
    backgroundColor: '#fff',
  },
  viewTabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  viewTabTextActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
  contentContainer: {
    flex: 1,
  },
  gridContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  gridRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  gridHeaderCell: {
    minWidth: 100,
    paddingHorizontal: 8,
    paddingVertical: 10,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
  },
  gridHeaderText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
  gridCell: {
    minWidth: 100,
    paddingHorizontal: 8,
    paddingVertical: 10,
    backgroundColor: '#fff',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: '#ddd',
  },
  gridCellText: {
    fontSize: 12,
    color: '#333',
  },
  detailContainer: {
    flex: 1,
    padding: 16,
  },
  detailText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#333',
  },
});

export const DeclarativePlugin = DeclarativePluginComponent;
export default DeclarativePluginComponent;
