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
