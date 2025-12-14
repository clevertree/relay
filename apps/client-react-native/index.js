import { AppRegistry } from 'react-native';
// Inject repo .env values into the JS runtime for development builds
import './native/env-inject';

// Load runtime shim to provide a `styled` fallback for nativewind when
// the package does not expose it at runtime (helps debug/dev builds).
try {
    // eslint-disable-next-line import/no-unresolved, global-require
    require('./src/nativewind-shim');
} catch (err) {
    // ignore if shim cannot be loaded
}

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
    // Normalize nativewind require shape so modules can call require('nativewind').styled
    try {
        // eslint-disable-next-line global-require
        const nw = require('nativewind');
        try {
            // eslint-disable-next-line global-require
            const shim = require('./src/nativewind-shim');
            if (shim && typeof shim.installInto === 'function') {
                shim.installInto(nw);
                try { console.log('[index] Installed local nativewind shim into nativewind'); } catch (e) { }
                try { console.warn('[index] Installed local nativewind shim into nativewind'); } catch (e) { }
            }
        } catch (shimErr) {
            // If shim cannot be loaded, fall back to copying from nw.default if present
            if (nw) {
                if (typeof nw.styled !== 'function' && nw.default && typeof nw.default.styled === 'function') {
                    nw.styled = nw.default.styled;
                    console.log('[index] Normalized nativewind.default.styled -> nativewind.styled');
                }
            }
        }
        try {
            // Emit explicit runtime info about nativewind module shape to help debugging
            try { console.warn('[index] nativewind keys:', Object.keys(nw)); } catch (e) { }
            try { console.warn('[index] nativewind.styled type:', typeof nw.styled); } catch (e) { }
            try { console.warn('[index] nativewind.NativeWindStyleSheet type:', typeof nw.NativeWindStyleSheet); } catch (e) { }
        } catch (e) {
            // ignore
        }
    } catch (e) {
        // ignore - nativewind may not be installed or available in bridgeless runtime
    }
    const React = require('react');
    const { View, Text, ActivityIndicator } = require('react-native');
    let RealApp = null;

    const Shell = () => {
        if (RealApp) {
            return React.createElement(RealApp, null);
        }
        return React.createElement(
            View,
            { style: { flex: 1, justifyContent: 'center', alignItems: 'center' } },
            React.createElement(ActivityIndicator, null),
            React.createElement(Text, { style: { marginTop: 12 } }, 'Loading app...')
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
