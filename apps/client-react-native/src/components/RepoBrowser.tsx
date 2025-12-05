/**
 * Native Repo Browser Component
 * Provides Visit/Search functionality with:
 * - Pagination support for large result sets
 * - Result caching with ETag/Last-Modified headers
 * - Virtualized list rendering (FlatList) for performance
 * - Improved UX with load more functionality
 */

import React, {useState, useCallback, useRef, useEffect} from 'react';
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
import MarkdownView from './MarkdownView';

/**
 * New lightweight path: render the repository-owned UI by loading the get-hook module
 * Disables legacy Visit/Search UI so the client is a dumb host, same as web.
 */
const USE_REPO_HOOK = true;

type OptionsInfo = {
  client?: { hooks?: { get?: { path: string }; query?: { path: string } } }
  [k: string]: unknown
}

function useHookRenderer(host: string, pathState: [string, (p: string)=>void]) {
  const [path, setPath] = pathState
  const [element, setElement] = useState<React.ReactNode | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<any>(null)
  const optionsRef = useRef<OptionsInfo | null>(null)

  const protocol = host.includes(':') || host.includes('localhost') || host.includes('10.0.2.2') ? 'http' : 'https'

  const loadOptions = useCallback(async (): Promise<OptionsInfo | null> => {
    try {
      const resp = await fetch(`${protocol}://${host}/`, { method: 'OPTIONS' })
      if (!resp.ok) throw new Error(`OPTIONS failed: ${resp.status}`)
      const json = (await resp.json()) as OptionsInfo
      optionsRef.current = json
      return json
    } catch (e:any) {
      setError('Failed to load repository OPTIONS')
      setDetails({ phase: 'options', message: e?.message || String(e) })
      return null
    }
  }, [host, protocol])

  // RN module loader: fetch+transform TS/TSX to CJS and eval
  const transformToCjs = useCallback(async (code: string, filename: string) => {
    const BabelNs: any = await import('@babel/standalone')
    const Babel: any = (BabelNs && (BabelNs as any).default) ? (BabelNs as any).default : BabelNs
    const hasJsxPragma = /@jsx\s+h/m.test(code)
    const TS_PRESET = Babel.availablePresets?.typescript || Babel.presets?.typescript || 'typescript'
    const REACT_PRESET = Babel.availablePresets?.react || Babel.presets?.react || 'react'
    const CJS_PLUGIN = Babel.availablePlugins?.['transform-modules-commonjs'] || Babel.availablePlugins?.['commonjs'] || 'transform-modules-commonjs'
    const presets: any[] = []
    if (TS_PRESET) presets.push([TS_PRESET, hasJsxPragma ? { jsxPragma: 'h', jsxPragmaFrag: 'React.Fragment' } : {}])
    presets.push([REACT_PRESET, hasJsxPragma ? { runtime: 'classic', pragma: 'h', pragmaFrag: 'React.Fragment', development: true } : { runtime: 'automatic', development: true }])
    const plugins: any[] = []
    if (CJS_PLUGIN) plugins.push([CJS_PLUGIN, {}])
    const out = Babel.transform(code, {
      filename,
      presets,
      plugins,
      sourceMaps: 'inline',
      retainLines: true,
    })
    return out.code as string
  }, [])

  const loadModule = useCallback(async (modulePath: string, fromPath: string): Promise<any> => {
    // Resolve relative to current hook dir or /hooks/
    let normalized = modulePath
    if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
      const baseDir = fromPath.split('/').slice(0, -1).join('/') || '/hooks'
      normalized = `${baseDir}/${modulePath}`
    } else if (!modulePath.startsWith('/')) {
      normalized = `/hooks/${modulePath}`
    }
    const url = `${protocol}://${host}${normalized}`
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`Failed to fetch ${normalized}: ${resp.status}`)
    const code = await resp.text()
    const cjs = await transformToCjs(code, normalized.split('/').pop() || 'module.tsx')
    const exports: any = {}
    const module = { exports }
    const localRequire = (spec: string) => {
      // Very small shim: allow only relative/absolute hook imports
      return {
        ...(spec === 'react' ? require('react') : {}),
      }
    }
    // eslint-disable-next-line no-new-func
    const fn = new Function('require','module','exports', `${cjs}\n//# sourceURL=${normalized}`)
    fn(localRequire as any, module as any, exports)
    return (module as any).exports
  }, [host, protocol, transformToCjs])

  const tryRender = useCallback(async () => {
    setLoading(true); setError(null); setDetails(null)
    const opts = optionsRef.current || (await loadOptions())
    const hookPath = opts?.client?.hooks?.get?.path
    if (!hookPath) {
      setError('Missing hook path in OPTIONS (client.hooks.get.path)')
      setDetails({ options: opts })
      setLoading(false)
      return
    }
    const hookUrl = `${protocol}://${host}${hookPath}`
    try {
      const resp = await fetch(hookUrl)
      const code = await resp.text()
      const cjs = await transformToCjs(code, hookPath.split('/').pop() || 'hook.tsx')
      const exports: any = {}
      const module = { exports }
      const req = (spec: string) => {
        if (spec === 'react') return require('react')
        // dynamic local module load
        return {}
      }
      // eslint-disable-next-line no-new-func
      const fn = new Function('require','module','exports', `${cjs}\n//# sourceURL=${hookPath}`)
      fn(req as any, module as any, exports)
      const mod = (module as any).exports
      if (!mod || typeof mod.default !== 'function') {
        throw new Error('Hook module must export default function(ctx)')
      }
      const ctx = {
        React: require('react'),
        createElement: require('react').createElement,
        FileRenderer: (props: { path: string }) => <MarkdownView source={props.path} />, // minimal placeholder
        Layout: undefined,
        params: { path },
        helpers: {
          navigate: (p: string) => setPath(p),
          setBranch: (_: string) => {},
          buildPeerUrl: (p: string) => `${protocol}://${host}${p}`,
          loadModule: async (p: string) => loadModule(p, hookPath),
        },
      }
      const el: React.ReactNode = await mod.default(ctx)
      setElement(el)
      setError(null); setDetails(null)
    } catch (e:any) {
      setError('Hook execution failed')
      setDetails({ message: e?.message || String(e) })
      setElement(null)
    } finally {
      setLoading(false)
    }
  }, [host, protocol, loadOptions, path, loadModule, setPath, transformToCjs])

  useEffect(() => { if (USE_REPO_HOOK) { void tryRender() } }, [path, tryRender])

  return { element, loading, error, details, setPath }
}

const DEFAULT_PAGE_SIZE = 50;
const CACHE_TTL_MS = 300000; // 5 minutes

interface QueryResult {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  content?: string;
  contentType?: string;
  [key: string]: unknown;
}

interface CacheEntry {
  results: QueryResult[];
  eTag?: string;
  lastModified?: string;
  timestamp: number;
}

interface RepoBrowserProps {
  host: string;
  branch?: string;
  initialPath?: string;
  onNavigate?: (path: string) => void;
}

const RepoBrowser: React.FC<RepoBrowserProps> = ({
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
    (cacheKey: string, newResults: QueryResult[], eTag?: string, lastModified?: string) => {
      cacheRef.current.set(cacheKey, {
        results: newResults,
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

      // If a directory path is requested, try common index files in order.
      const candidates: string[] = [];
      if (targetPath.endsWith('/')) {
        candidates.push(`${targetPath}index.md`);
        candidates.push(`${targetPath}README.md`);
      } else {
        candidates.push(targetPath);
      }

      let lastErrorStatus: number | null = null;

      // Try each candidate path (and check cache per-URL) until one succeeds.
      for (const candidate of candidates) {
        const urlTry = `${baseUrl}/${candidate.replace(/^\//, '')}`;
        const cacheKey = `visit:${branch}:${urlTry}`;

        const cached = getCachedResults(cacheKey);
        if (cached) {
          const {pageResults, hasMorePages} = paginateResults(cached.results, 1);
          setResults(cached.results);
          setDisplayedResults(pageResults);
          setHasMore(hasMorePages);
          setPath(candidate);
          onNavigate?.(candidate);
          setLoading(false);
          return;
        }

        try {
          const res = await fetch(urlTry, {
            headers: {
              'X-Relay-Branch': branch,
            },
          });

          if (!res.ok) {
            lastErrorStatus = res.status;
            // try next candidate
            continue;
          }

          const contentType = res.headers.get('Content-Type') || '';
          const text = await res.text();
          const eTag = res.headers.get('ETag') || undefined;
          const lastModified = res.headers.get('Last-Modified') || undefined;

          const visitResult: QueryResult = {
            path: candidate,
            name: candidate.split('/').pop() || candidate,
            type: 'file',
            content: text,
            contentType,
          };

          setResults([visitResult]);
          setDisplayedResults([visitResult]);
          setHasMore(false);
          cacheResults(cacheKey, [visitResult], eTag, lastModified);

          setPath(candidate);
          onNavigate?.(candidate);
          setLoading(false);
          return;
        } catch (_e) {
          // network or other error - record and try next
          lastErrorStatus = null;
          continue;
        }
      }

      // If none succeeded, surface an error (use last status if available)
      throw new Error(`GET failed: ${lastErrorStatus ?? 'unknown'}`);
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

      const processedResults: QueryResult[] = items.map((item: unknown) => {
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
   * Format file size for display
   */
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

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

  // Determine if search input starts with '/'
  const isPathInput = inputValue.trim().startsWith('/');

  return (
    <View style={styles.container}>
      {/* Path input bar with branch label and buttons on same row */}
      <View style={styles.inputBar}>
        {/* Branch label badge */}
        {branch && (
          <View style={styles.branchBadge}>
            <Text style={styles.branchText}>{branch}</Text>
          </View>
        )}
        
        {/* Search input - flex to take available space */}
        <TextInput
          style={styles.input}
          value={inputValue}
          onChangeText={setInputValue}
          placeholder="Enter path or search query"
          selectTextOnFocus
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={isPathInput ? handleSearch : handleVisit}
        />
        
        {/* Visit button - only show when input doesn't start with '/' */}
        {!isPathInput && (
          <TouchableOpacity
            style={[styles.actionButton, styles.visitButton]}
            onPress={handleVisit}
            disabled={loading || !inputValue.trim()}>
            <Text style={styles.actionButtonText}>Visit</Text>
          </TouchableOpacity>
        )}
        
        {/* Search button - only show when input starts with '/' */}
        {isPathInput && (
          <TouchableOpacity
            style={[styles.actionButton, styles.searchButton]}
            onPress={handleSearch}
            disabled={loading || !inputValue.trim()}>
            <Text style={styles.actionButtonText}>Search</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Current path indicator (only shown for search results) */}
      {mode === 'search' && (
        <View style={styles.pathIndicator}>
          <Text style={styles.pathText} numberOfLines={1}>
            {`Results (${results.length})`} {path}
          </Text>
        </View>
      )}

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
        // If visiting a path and the first result contains file content render
        // it using the MarkdownView. Otherwise show the search/list view.
        (mode === 'visit' && displayedResults.length > 0 && displayedResults[0].content) ? (
          <View style={styles.markdownContainer}>
            <MarkdownView
              content={displayedResults[0].content as string}
              baseUrl={getBaseUrl()}
              branch={branch}
              onLinkPress={(url) => {
                // Navigate to external links in browser
                // If internal path, set as new input and visit
                try {
                  const parsed = new URL(url);
                  // If host matches base host, convert to relative path
                  if (parsed.host === new URL(getBaseUrl()).host) {
                    const relPath = parsed.pathname.replace(/^\//, '');
                    setInputValue(relPath);
                    setPath(relPath);
                    onNavigate?.(relPath);
                  } else {
                    // External
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const {Linking} = require('react-native');
                    Linking.openURL(url);
                  }
                } catch (_e) {
                  // Not a full URL - treat as internal path
                  const rel = url.replace(/^\//, '');
                  setInputValue(rel);
                  setPath(rel);
                  onNavigate?.(rel);
                }
              }}
            />
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
        )
      )}

      {/* Bottom status bar */}
      <View style={styles.statusBar}>
        {loading ? (
          <Text style={styles.statusText}>{mode === 'visit' ? 'Fetching...' : 'Searching...'}</Text>
        ) : error ? (
          <Text style={[styles.statusText, styles.statusError]} numberOfLines={1}>{error}</Text>
        ) : (
          <Text style={styles.statusText}>Ready</Text>
        )}
      </View>
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
    alignItems: 'center',
  },
  branchBadge: {
    backgroundColor: '#E8E8E8',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  branchText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
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
  markdownContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  statusBar: {
    height: 40,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    backgroundColor: '#f8f9fa',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  statusText: {
    fontSize: 13,
    color: '#444',
  },
  statusError: {
    color: '#dc3545',
  },
});

export default RepoBrowser;
