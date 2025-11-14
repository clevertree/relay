"use client";
import React, { useEffect, useState } from 'react';
import { Box, Typography, Button } from '@mui/material';

export default function DesktopGuard({ children }: { children: React.ReactNode }) {
  const [embedded, setEmbedded] = useState(false);
  const [bridgePresent, setBridgePresent] = useState(false);
  const [checked, setChecked] = useState(false); // whether we've finished polling

  useEffect(() => {
    try {
      const anyWin = window as any;
      // Check injected global first
      let embeddedFlag = Boolean(anyWin.__RELAY_TAURI_EMBEDDED);
      // Fallback: check query parameter used during dev redirect
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('__RELAY_TAURI_EMBEDDED') === '1') embeddedFlag = true;
      } catch (e) {
        // ignore
      }
      setEmbedded(embeddedFlag);
      setBridgePresent(Boolean(anyWin.__TAURI__ || anyWin.tauri || anyWin.__TAURI_IPC__));
    } catch (e) {
      setEmbedded(false);
      setBridgePresent(false);
    }
  }, []);
  useEffect(() => {
  // We poll for the presence of the embedded flag or bridge for a short
  // window because bridge injection can occur slightly after mount. Increase
  // to 12s during dev to tolerate slower setups and write diagnostics to
  // window.__RELAY_DESKTOP_DIAG so the embed environment can be inspected.
    let mounted = true;
    let attempts = 0;
    const intervalMs = 150;
  const maxAttempts = Math.ceil(12000 / intervalMs);
    const id = setInterval(() => {
      attempts += 1;
      try {
        const anyWin = window as any;
        let embeddedFlag = Boolean(anyWin.__RELAY_TAURI_EMBEDDED);
        try {
          const params = new URLSearchParams(window.location.search);
          if (params.get('__RELAY_TAURI_EMBEDDED') === '1') embeddedFlag = true;
        } catch (e) {}
        const bridge = Boolean(anyWin.__TAURI__ || anyWin.tauri || anyWin.__TAURI_IPC__);
        // write a diagnostic snapshot for manual inspection in webview devtools
        try {
          (anyWin as any).__RELAY_DESKTOP_DIAG = {
            embeddedFlag,
            bridgePresent: bridge,
            has___TAURI__: typeof anyWin.__TAURI__ !== 'undefined',
            has_tauri: typeof anyWin.tauri !== 'undefined',
            has___TAURI_IPC__: typeof anyWin.__TAURI_IPC__ !== 'undefined',
            locationSearch: window.location.search,
            attempts,
            timestamp: Date.now()
          };
        } catch (e) {
          // ignore diagnostics write errors
        }
        if (!mounted) return;
        setEmbedded(embeddedFlag);
        setBridgePresent(bridge);
        if (embeddedFlag && bridge) {
          // happy path: embedded and bridge present
          clearInterval(id);
          setChecked(true);
          return;
        }
        if (attempts >= maxAttempts) {
          clearInterval(id);
          setChecked(true);
        }
      } catch (e) {
        // ignore
      }
    }, intervalMs);
    return () => {
      mounted = false;
      clearInterval(id);
    };
    }, []);

  // In all cases render children; if embedded but bridge missing, log and allow web-only fallback.
  // A banner could be shown elsewhere (footer console shows runtime).
  return <>{children}</>;
}
