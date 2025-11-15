"use client";
import React, { useEffect, useState } from 'react';
import { Alert, AlertTitle, Box, Link } from '@mui/material';
import { startBridgeValidation, useBridgeStore } from '../lib/log';

// Shows an error at startup when we detect the app is embedded in a desktop
// container but the Tauri JS bridge is not available. In that situation any
// native invocations will fail, so we warn the user early.
export default function BridgeAlert() {
  const [show, setShow] = useState(false);
  const [details, setDetails] = useState<string>("");

  useEffect(() => {
    // Kick off validation and show an alert only if we appear embedded but validation fails.
    startBridgeValidation();
    let attempts = 0;
    const intervalMs = 200;
    const maxAttempts = Math.ceil(5000 / intervalMs);
    const id = setInterval(() => {
      attempts += 1;
      try {
        const anyWin: any = typeof window !== 'undefined' ? (window as any) : {};
        let embedded = Boolean(anyWin.__RELAY_TAURI_EMBEDDED);
        try {
          const params = new URLSearchParams(window.location.search);
          if (params.get('__RELAY_TAURI_EMBEDDED') === '1') embedded = true;
        } catch {}
        const { validated, validating } = useBridgeStore.getState();
        if (embedded && !validating && !validated) {
          setShow(true);
          setDetails('Embedded desktop view detected but the Tauri bridge is not validated. Native operations will fail.');
        } else if (validated) {
          setShow(false);
        } else if (attempts >= maxAttempts) {
          // Not embedded and no validation: web-only mode; keep hidden
          setShow(false);
        }
        if (attempts >= maxAttempts || (embedded && validated)) {
          clearInterval(id);
        }
      } catch {}
    }, intervalMs);
    return () => clearInterval(id);
  }, []);

  if (!show) return null;
  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', px: 2, mt: 1 }}>
      <Alert severity="error" onClose={() => setShow(false)}>
        <AlertTitle>Tauri bridge unavailable</AlertTitle>
        {details} Try restarting the desktop app. If you launched the UI in a regular browser, install or run the desktop version.
      </Alert>
    </Box>
  );
}
