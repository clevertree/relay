/**
 * Default Native Repo Browser Plugin
 * Provides Visit/Search functionality with GET/QUERY requests.
 */

import React, {useState, useCallback} from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

// Debug: module load
// eslint-disable-next-line no-console
console.log('DefaultNative plugin module loaded');

interface QueryResult {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  [key: string]: unknown;
}

interface DefaultNativePluginProps {
  host: string;
  branch?: string;
  initialPath?: string;
  onNavigate?: (path: string) => void;
}

const DefaultNativePluginComponent: React.FC<DefaultNativePluginProps> = ({
  host,
  branch = 'main',
  initialPath = '/',
  onNavigate,
}) => {
  const [path, setPath] = useState(initialPath);
  const [inputValue, setInputValue] = useState(initialPath);
  const [results, setResults] = useState<QueryResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'visit' | 'search'>('visit');

  const getBaseUrl = useCallback(() => {
    if (host.includes('localhost') || host.includes('10.0.2.2')) {
      const port = host.includes(':') ? '' : ':8080';
      return `http://${host}${port}`;
    }
    return `https://${host}`;
  }, [host]);

  const handleVisit = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMode('visit');
    setResults([]);

    try {
      const baseUrl = getBaseUrl();
      let targetPath = inputValue.trim();

      // Imply index.md for directory paths
      if (targetPath.endsWith('/')) {
        targetPath += 'index.md';
      }

      const url = `${baseUrl}/${targetPath.replace(/^\//, '')}`;
      const res = await fetch(url, {
        headers: {
          'X-Relay-Branch': branch,
        },
      });

      if (!res.ok) {
        throw new Error(`GET failed: ${res.status}`);
      }

      const contentType = res.headers.get('Content-Type') || '';
      const text = await res.text();

      // For now, show as a single result
      setResults([
        {
          path: targetPath,
          name: targetPath.split('/').pop() || targetPath,
          type: 'file',
          content: text,
          contentType,
        } as QueryResult,
      ]);

      setPath(targetPath);
      onNavigate?.(targetPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, [inputValue, branch, getBaseUrl, onNavigate]);

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMode('search');
    setResults([]);

    try {
      const baseUrl = getBaseUrl();
      const searchQuery = inputValue.trim();

      const url = `${baseUrl}/query`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Relay-Branch': branch,
        },
        body: JSON.stringify({
          query: searchQuery,
          page: 1,
          pageSize: 50,
        }),
      });

      if (!res.ok) {
        throw new Error(`QUERY failed: ${res.status}`);
      }

      const data = await res.json();
      const items = Array.isArray(data.items)
        ? data.items
        : Object.entries(data.items || {}).map(([key, value]) => ({
            path: key,
            ...(typeof value === 'object' ? value : {}),
          }));

      setResults(
        items.map((item: unknown) => {
          const obj = item as Record<string, unknown>;
          return {
            path: obj.path as string || obj.name as string || '',
            name: (obj.name as string) || (obj.path as string)?.split('/').pop() || '',
            type: ((obj.type as string) || 'file') as 'file' | 'directory',
            ...obj,
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [inputValue, branch, getBaseUrl]);

  const handleResultPress = (item: QueryResult) => {
    const targetPath =
      item.type === 'directory' ? `${item.path}/` : `${item.path.replace(/\/?$/, '')}/index.md`;
    setInputValue(item.path);
    setPath(item.path);
    onNavigate?.(targetPath);
  };

  const renderResultItem = ({item}: {item: QueryResult}) => (
    <TouchableOpacity style={styles.resultItem} onPress={() => handleResultPress(item)}>
      <View style={styles.resultIcon}>
        <Text style={styles.resultIconText}>{item.type === 'directory' ? '📁' : '📄'}</Text>
      </View>
      <View style={styles.resultContent}>
        <Text style={styles.resultName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.resultPath} numberOfLines={1}>
          {item.path}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.viewButton}
        onPress={() => {
          setInputValue(item.path);
          handleVisit();
        }}>
        <Text style={styles.viewButtonText}>View</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderContent = (item: QueryResult) => {
    const content = (item as QueryResult & {content?: string}).content;
    if (!content) return null;

    return (
      <View style={styles.contentContainer}>
        <Text style={styles.contentText}>{content}</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Path input bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={inputValue}
          onChangeText={setInputValue}
          placeholder="Enter path or search query"
          selectTextOnFocus
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={handleVisit}
        />
        <TouchableOpacity
          style={[styles.actionButton, styles.visitButton]}
          onPress={handleVisit}
          disabled={loading || !inputValue.trim()}>
          <Text style={styles.actionButtonText}>Visit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.searchButton]}
          onPress={handleSearch}
          disabled={loading || !inputValue.trim()}>
          <Text style={styles.actionButtonText}>Search</Text>
        </TouchableOpacity>
      </View>

      {/* Current path indicator */}
      <View style={styles.pathIndicator}>
        <Text style={styles.pathText}>
          {mode === 'visit' ? 'Viewing:' : 'Results for:'} {path}
        </Text>
      </View>

      {/* Content area */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>
            {mode === 'visit' ? 'Fetching...' : 'Searching...'}
          </Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : mode === 'visit' && results.length === 1 ? (
        renderContent(results[0])
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item, index) => item.path || `${index}`}
          renderItem={renderResultItem}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {mode === 'search' ? 'No results found' : 'Enter a path and tap Visit'}
              </Text>
            </View>
          }
          contentContainerStyle={results.length === 0 ? styles.emptyList : undefined}
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
  inputBar: {
    flexDirection: 'row',
    padding: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    justifyContent: 'center',
  },
  visitButton: {
    backgroundColor: '#007AFF',
  },
  searchButton: {
    backgroundColor: '#5856D6',
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  pathIndicator: {
    padding: 8,
    backgroundColor: '#f8f9fa',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  pathText: {
    fontSize: 12,
    color: '#666',
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
    padding: 20,
    alignItems: 'center',
  },
  errorText: {
    color: '#dc3545',
    textAlign: 'center',
  },
  contentContainer: {
    flex: 1,
    padding: 16,
  },
  contentText: {
    fontSize: 14,
    lineHeight: 22,
    fontFamily: 'monospace',
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  resultIcon: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultIconText: {
    fontSize: 20,
  },
  resultContent: {
    flex: 1,
    marginLeft: 8,
  },
  resultName: {
    fontSize: 14,
    fontWeight: '500',
  },
  resultPath: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  viewButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  viewButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#999',
    textAlign: 'center',
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
  },
});

export const DefaultNativePlugin = DefaultNativePluginComponent;
export default DefaultNativePluginComponent;
