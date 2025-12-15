import { AppRegistry } from 'react-native';
// Inject repo .env values into the JS runtime for development builds
import './native/env-inject';

// Simple shared error container to capture the latest startup error
let startupError = null;

function captureError(err, isFatal = false) {
    try {
        // Normalize to Error object
        const errorObj = err instanceof Error ? err : new Error(String(err));
        startupError = { message: errorObj.message, stack: errorObj.stack, isFatal };
        // eslint-disable-next-line no-console
        console.error('[GlobalError] Caught startup error:', startupError);
    } catch (e) {
        // ignore
    }
}

// Install global handlers for uncaught exceptions / promise rejections
if (typeof global !== 'undefined') {
    // For older RN runtimes
    if (typeof global.ErrorUtils !== 'undefined' && typeof global.ErrorUtils.setGlobalHandler === 'function') {
        global.ErrorUtils.setGlobalHandler((error, isFatal) => captureError(error, isFatal));
    }

    // For other runtimes
    global.onerror = (msg, url, lineNo, columnNo, err) => {
        captureError(err || msg, true);
        return false;
    };

    global.onunhandledrejection = (ev) => {
        captureError(ev && ev.reason ? ev.reason : 'Unhandled promise rejection', false);
    };
}

let AppComponent;
try {
    // Use require so we can catch synchronous module initialization errors
    // which would otherwise prevent AppRegistry.registerComponent from running.
    // eslint-disable-next-line global-require
    AppComponent = require('./src/App').default;
} catch (err) {
    // If the main App module fails to load, register a fallback UI which
    // displays the captured error details so the user can understand what failed.
    // eslint-disable-next-line no-console
    console.error('[index] Failed to load App module:', err);
    const React = require('react');
    const { View, Text, ScrollView } = require('react-native');

    AppComponent = function StartupErrorScreen() {
        const err = startupError || (err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) });
        return React.createElement(
            View,
            { style: { flex: 1, backgroundColor: '#fff', padding: 16 } },
            React.createElement(Text, { style: { fontSize: 18, fontWeight: '700', marginBottom: 8 } }, 'Startup error'),
            React.createElement(Text, { style: { color: '#b00', marginBottom: 12 } }, err.message || 'Unknown error'),
            React.createElement(ScrollView, null, React.createElement(Text, null, err.stack || 'No stack available'))
        );
    };
}

AppRegistry.registerComponent('RelayClient', () => AppComponent);

// --- New approach: ensure registration always occurs with a lightweight shell
// and then try to load the real App asynchronously so we can observe errors
// without preventing AppRegistry from being registered.
try {
    const React = require('react');
    const { View, Text, ActivityIndicator } = require('react-native');
    let RealApp = null;

    const Shell = () => {
        const [realAppReady, setRealAppReady] = React.useState(!!RealApp);
        const [elapsed, setElapsed] = React.useState(0);
        const [timedOut, setTimedOut] = React.useState(false);
        const [attempt, setAttempt] = React.useState(0);

        React.useEffect(() => {
            let mounted = true;
            if (RealApp) setRealAppReady(true);
            // elapsed timer
            const t = setInterval(() => {
                if (!mounted) return;
                setElapsed((s) => s + 1);
            }, 1000);

            // timeout after 10s
            const to = setTimeout(() => {
                if (!mounted) return;
                setTimedOut(true);
            }, 10000);

            return () => {
                mounted = false;
                clearInterval(t);
                clearTimeout(to);
            };
        }, [attempt]);

        React.useEffect(() => {
            if (RealApp) setRealAppReady(true);
        }, [RealApp]);

        const retry = () => {
            setTimedOut(false);
            setElapsed(0);
            setAttempt((a) => a + 1);
            // try to require the real app again
            try {
                // eslint-disable-next-line global-require
                const Loaded = require('./src/App').default;
                RealApp = Loaded;
                AppRegistry.registerComponent('RelayClient', () => RealApp);
                console.log('[index] Real App module loaded on retry');
                setRealAppReady(true);
            } catch (e) {
                console.error('[index] Retry load failed:', e);
            }
        };

        if (realAppReady && RealApp) {
            return React.createElement(RealApp, null);
        }

        return React.createElement(
            View,
            { style: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#fff' } },
            React.createElement(ActivityIndicator, { size: 'large' }),
            React.createElement(Text, { style: { marginTop: 12, fontSize: 16, fontWeight: '600' } }, 'Loading app...'),
            React.createElement(Text, { style: { marginTop: 6, color: '#666' } }, `Elapsed: ${elapsed}s`),
            timedOut && React.createElement(Text, { style: { marginTop: 8, color: '#b00', textAlign: 'center' } }, 'App did not finish loading within 10s.'),
            timedOut && React.createElement(Text, { style: { marginTop: 6, color: '#666', textAlign: 'center' } }, 'This usually means network probes or dynamic modules are taking too long.'),
            timedOut && React.createElement(
                TouchableOpacity,
                { onPress: retry, style: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#007aff', borderRadius: 6 } },
                React.createElement(Text, { style: { color: '#fff', fontWeight: '600' } }, 'Retry')
            )
        );
    };

    // Register the shell component (idempotent-ish — gives us a UI immediately).
    AppRegistry.registerComponent('RelayClient', () => Shell);

    // Asynchronously attempt to load the real app implementation.
    setTimeout(() => {
        try {
            // eslint-disable-next-line global-require
            const Loaded = require('./src/App').default;
            RealApp = Loaded;
            // Force re-registration with the real app if it loaded successfully.
            AppRegistry.registerComponent('RelayClient', () => RealApp);
            console.log('[index] Real App module loaded async');
        } catch (e) {
            console.error('[index] Async load of real App failed:', e);
        }
    }, 0);
} catch (e) {
    console.error('[index] Failed to set up shell component:', e);
}
