/**
 * WebView Plugin for Relay Client
 * Loads repo-provided web interfaces with a restricted JS bridge
 */

import React, {useRef, useState, useCallback} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import WebView, {WebViewMessageEvent} from 'react-native-webview';

// Debug: module loaded
// eslint-disable-next-line no-console
console.log('WebViewPlugin module loaded');

interface WebViewPluginProps {
  host: string;
  branch?: string;
  initialPath?: string;
  onMessage?: (data: unknown) => void;
}

interface BridgeMessage {
  type: 'fetch' | 'state' | 'log' | 'message';
  data?: unknown;
  error?: string;
  path?: string;
  options?: Record<string, unknown>;
}

const WebViewPluginComponent: React.FC<WebViewPluginProps> = ({
  host,
  branch = 'main',
  initialPath = '/',
  onMessage,
}) => {
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getBaseUrl = useCallback(() => {
    if (host.includes('localhost') || host.includes('10.0.2.2')) {
      const port = host.includes(':') ? '' : ':8080';
      return `http://${host}${port}`;
    }
    return `https://${host}`;
  }, [host]);

  // Injected JS bridge - restricted interface to WebView
  const injectedJavaScript = `
    (function() {
      window.relay = {
        // Restricted fetch - only allows calls to the peer
        fetch: function(path, options = {}) {
          return new Promise((resolve, reject) => {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'fetch',
              path: path,
              options: options
            }));
            // Response will come via the bridge callback
          });
        },
        // Read-only access to app state
        state: {
          host: '${host}',
          branch: '${branch}',
          path: '${initialPath}'
        },
        // Send messages to React Native
        postMessage: function(data) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'message',
            data: data
          }));
        }
      };
      // Prevent access to other APIs
      window.eval = undefined;
      window.Function = undefined;
      console.log = function(msg) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'log',
          data: msg
        }));
      };
      true; // This is a required hack to prevent React Native from crashing.
    })();
  `;

  const handleWebViewMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const message = JSON.parse(event.nativeEvent.data) as BridgeMessage;

        switch (message.type) {
          case 'fetch':
            // Handle restricted fetch
            const fetchData = message.data as {path?: string; options?: Record<string, unknown>};
            const baseUrl = getBaseUrl();
            const fetchUrl = `${baseUrl}/${fetchData.path?.replace(/^\//, '') || ''}`;

            fetch(fetchUrl, {
              ...fetchData.options,
              headers: {
                ...((fetchData.options?.headers as Record<string, string>) || {}),
                'X-Relay-Branch': branch,
              },
            })
              .then((res) => res.json())
              .then((data) => {
                // Send response back to WebView
                webViewRef.current?.injectJavaScript(`
                  window.__relayFetchResponse = ${JSON.stringify(data)};
                  window.relay.__onFetchResponse && window.relay.__onFetchResponse(${JSON.stringify(data)});
                `);
              })
              .catch((err) => {
                webViewRef.current?.injectJavaScript(`
                  window.relay.__onFetchError && window.relay.__onFetchError('${err.message}');
                `);
              });
            break;

          case 'log':
            console.log('[WebView]', message.data);
            break;

          case 'message':
            onMessage?.(message.data);
            break;
        }
      } catch (e) {
        console.error('WebView bridge error:', e);
      }
    },
    [branch, getBaseUrl, onMessage],
  );

  const handleLoadEnd = useCallback(() => {
    setLoading(false);
  }, []);

  const handleError = useCallback((syntheticEvent: any) => {
    const {nativeEvent} = syntheticEvent;
    setError(`Error: ${nativeEvent.description}`);
  }, []);

  const indexUrl = `${getBaseUrl()}${initialPath.endsWith('/') ? initialPath : initialPath + '/'}index.html`;

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading plugin...</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <WebView
        ref={webViewRef}
        source={{uri: indexUrl}}
        style={styles.webview}
        injectedJavaScript={injectedJavaScript}
        javaScriptEnabled
        onLoadEnd={handleLoadEnd}
        onError={handleError}
        onMessage={handleWebViewMessage}
        startInLoadingState
        scalesPageToFit
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  webview: {
    flex: 1,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
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
  },
});

export const WebViewPlugin = WebViewPluginComponent;
export default WebViewPluginComponent;
