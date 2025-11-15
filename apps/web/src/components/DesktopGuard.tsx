"use client";
import React, { useEffect, useState } from 'react';
import { Box, Typography, Button } from '@mui/material';
import { startBridgeValidation, useBridgeStore } from '../lib/log';

export default function DesktopGuard({ children }: { children: React.ReactNode }) {
  const [embedded, setEmbedded] = useState(false);
  const { validated, validating } = useBridgeStore();

  useEffect(() => {
    // Detect embedded flag from injected global or query param
    try {
      const anyWin = window as any;
      let embeddedFlag = Boolean(anyWin.__RELAY_TAURI_EMBEDDED);
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('__RELAY_TAURI_EMBEDDED') === '1') embeddedFlag = true;
      } catch {}
      setEmbedded(embeddedFlag);
    } catch {
      setEmbedded(false);
    }
    // Kick off bridge validation once
    startBridgeValidation();
  }, []);

  // Render children unconditionally; diagnostics and runtime indicators are handled elsewhere.
  return <>{children}</>;
}
