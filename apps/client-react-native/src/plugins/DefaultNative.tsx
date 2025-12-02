/**
 * Enhanced Default Native Repo Browser Plugin
 * Provides Visit/Search functionality with:
 * - Pagination support for large result sets
 * - Result caching with ETag/Last-Modified headers
 * - Virtualized list rendering (FlatList) for performance
 * - Improved UX with load more functionality
 */

import React, {useState, useCallback, useMemo, useRef} from 'react';
import {
  ActivityIndicator,
  FlatList,
  ListRenderItemInfo,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const DEFAULT_PAGE_SIZE = 50;
const CACHE_TTL_MS = 300000; // 5 minutes

interface QueryResult {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  [key: string]: unknown;
}

interface CacheEntry {
  results: QueryResult[];
  eTag?: string;
  lastModified?: string;
  timestamp: number;
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
  // State management
  const [path, setPath] = useState(initialPath);
  const [inputValue, setInputValue] = useState(initialPath);
  const [results, setResults] = useState<QueryResult[]>([]);
  const [displayedResults, setDisplayedResults] = useState<QueryResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'visit' | 'search'>('visit');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Caching
  const cacheRef = useRef(new Map<string, CacheEntry>());

  const getBaseUrl = useCallback(() => {
    if (host.includes('localhost') || host.includes('10.0.2.2')) {
      const port = host.includes(':') ? '' : ':8080';
      return `http://${host}${port}`;
    }
    return `https://${host}`;
  }, [host]);

  /**
   * Get cached results if still fresh
   */
  const getCachedResults = useCallback((cacheKey: string): CacheEntry | null => {
    const cached = cacheRef.current.get(cacheKey);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > CACHE_TTL_MS) {
      cacheRef.current.delete(cacheKey);
      return null;
    }

    return cached;
  }, []);

  /**
   * Cache query results
   */
  const cacheResults = useCallback(
    (cacheKey: string, results: QueryResult[], eTag?: string, lastModified?: string) => {
      cacheRef.current.set(cacheKey, {
        results,
        eTag,
        lastModified,
        timestamp: Date.now(),
      });
    },
    [],
  );

  /**
   * Paginate results for display
   */
  const paginateResults = useCallback((allResults: QueryResult[], pageNum: number) => {
    const startIdx = (pageNum - 1) * DEFAULT_PAGE_SIZE;
    const endIdx = startIdx + DEFAULT_PAGE_SIZE;
    const pageResults = allResults.slice(startIdx, endIdx);
    const hasMorePages = endIdx < allResults.length;

    return {pageResults, hasMorePages};
  }, []);

  /**
   * Load more results from current query
   */
  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;

    setLoadingMore(true);
    const {pageResults, hasMorePages} = paginateResults(results, currentPage + 1);

    setDisplayedResults((prev) => [...prev, ...pageResults]);
    setCurrentPage((p) => p + 1);
    setHasMore(hasMorePages);
    setLoadingMore(false);
  }, [results, currentPage, hasMore, loadingMore, paginateResults]);

  /**
   * Perform visit operation (GET)
   */
  const handleVisit = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMode('visit');
    setResults([]);
    setDisplayedResults([]);
    setCurrentPage(1);
    setHasMore(false);

    try {
      const baseUrl = getBaseUrl();
      let targetPath = inputValue.trim();

      // Imply index.md for directory paths
      if (targetPath.endsWith('/')) {
        targetPath += 'index.md';
      }

      const url = `${baseUrl}/${targetPath.replace(/^\//, '')}`;
      const cacheKey = `visit:${branch}:${url}`;

      // Check cache first
      const cached = getCachedResults(cacheKey);
      if (cached) {
        const {pageResults, hasMorePages} = paginateResults(cached.results, 1);
        setResults(cached.results);
        setDisplayedResults(pageResults);
        setHasMore(hasMorePages);
        setPath(targetPath);
        onNavigate?.(targetPath);
        setLoading(false);
        return;
      }

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
      const eTag = res.headers.get('ETag') || undefined;
      const lastModified = res.headers.get('Last-Modified') || undefined;

      const visitResult = {
        path: targetPath,
        name: targetPath.split('/').pop() || targetPath,
        type: 'file' as const,
        content: text,
        contentType,
      };

      setResults([visitResult]);
      setDisplayedResults([visitResult]);
      setHasMore(false);
      cacheResults(cacheKey, [visitResult], eTag, lastModified);

      setPath(targetPath);
      onNavigate?.(targetPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, [inputValue, branch, getBaseUrl, getCachedResults, paginateResults, cacheResults, onNavigate]);

  /**
   * Perform search operation (QUERY)
   */
  const handleSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMode('search');
    setResults([]);
    setDisplayedResults([]);
    setCurrentPage(1);
    setHasMore(false);

    try {
      const baseUrl = getBaseUrl();
      const searchQuery = inputValue.trim();
      const cacheKey = `search:${branch}:${searchQuery}`;

      // Check cache first
      const cached = getCachedResults(cacheKey);
      if (cached) {
        const {pageResults, hasMorePages} = paginateResults(cached.results, 1);
        setResults(cached.results);
        setDisplayedResults(pageResults);
        setHasMore(hasMorePages);
        setLoading(false);
        return;
      }

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
          pageSize: 1000, // Fetch large page to support pagination
        }),
      });

      if (!res.ok) {
        throw new Error(`QUERY failed: ${res.status}`);
      }

      const data = await res.json();
      const eTag = res.headers.get('ETag') || undefined;
      const lastModified = res.headers.get('Last-Modified') || undefined;

      const items = Array.isArray(data.items)
        ? data.items
        : Object.entries(data.items || {}).map(([key, value]) => ({
            path: key,
            ...(typeof value === 'object' ? value : {}),
          }));

      const processedResults = items.map((item: unknown) => {
        const obj = item as Record<string, unknown>;
        return {
          path: (obj.path as string) || (obj.name as string) || '',
          name: ((obj.name as string) || (obj.path as string)?.split('/').pop()) || '',
          type: ((obj.type as string) || 'file') as 'file' | 'directory',
          ...obj,
        };
      });

      const {pageResults, hasMorePages} = paginateResults(processedResults, 1);

      setResults(processedResults);
      setDisplayedResults(pageResults);
      setHasMore(hasMorePages);
      cacheResults(cacheKey, processedResults, eTag, lastModified);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [inputValue, branch, getBaseUrl, getCachedResults, paginateResults, cacheResults]);

  /**
   * Handle pull-to-refresh
   */
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    if (mode === 'visit') {
      await handleVisit();
    } else {
      await handleSearch();
    }
    setRefreshing(false);
  }, [mode, handleVisit, handleSearch]);

  /**
   * Handle result item press
   */
  const handleResultPress = useCallback(
    (item: QueryResult) => {
      const targetPath =
        item.type === 'directory' ? `${item.path}/` : `${item.path.replace(/\/?$/, '')}/index.md`;
      setInputValue(item.path);
      setPath(item.path);
      onNavigate?.(targetPath);
    },
    [onNavigate],
  );

  /**
   * Render a single result item
   */
  const renderResultItem = useCallback(
    ({item}: ListRenderItemInfo<QueryResult>) => (
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
          {item.size && (
            <Text style={styles.resultMeta}>
              {formatFileSize(item.size as number)}
            </Text>
          )}
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
    ),
    [handleResultPress, handleVisit],
  );

  /**
   * Render footer (load more button or loading indicator)
   */
  const renderFooter = useCallback(() => {
    if (!hasMore) return null;

    return (
      <View style={styles.footerContainer}>
        {loadingMore ? (
          <ActivityIndicator size="small" color="#007AFF" />
        ) : (
          <TouchableOpacity style={styles.loadMoreButton} onPress={handleLoadMore}>
            <Text style={styles.loadMoreText}>
              Load More ({displayedResults.length} of {results.length})
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }, [hasMore, loadingMore, displayedResults.length, results.length, handleLoadMore]);

  /**
   * Format file size for display
   */
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
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
          onSubmitEditing={mode === 'visit' ? handleVisit : handleSearch}
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
        <Text style={styles.pathText} numberOfLines={1}>
          {mode === 'visit' ? 'Viewing:' : `Results (${results.length})`} {path}
        </Text>
      </View>

      {/* Content area */}
      {loading && displayedResults.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>
            {mode === 'visit' ? 'Fetching...' : 'Searching...'}
          </Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={mode === 'visit' ? handleVisit : handleSearch}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={displayedResults}
          keyExtractor={(item, index) => item.path || `${index}`}
          renderItem={renderResultItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
            />
          }
          ListFooterComponent={renderFooter}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {mode === 'search' ? 'No results found' : 'Enter a path and tap Visit'}
              </Text>
            </View>
          }
          contentContainerStyle={displayedResults.length === 0 ? styles.emptyList : undefined}
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
  retryButton: {
    backgroundColor: '#007AFF',
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
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
  resultMeta: {
    fontSize: 11,
    color: '#999',
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
  footerContainer: {
    padding: 16,
    alignItems: 'center',
  },
  loadMoreButton: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
  },
});

export const DefaultNativePlugin = DefaultNativePluginComponent;
export default DefaultNativePluginComponent;
