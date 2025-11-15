"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography, TextField, Button } from '@mui/material';
import TerminalIcon from '@mui/icons-material/Terminal';
import { useLogStore, logInfo, logError, logDebug, tauriInvoke, useBridgeStore, startBridgeValidation } from '../lib/log';

export default function FooterConsole() {
  const { items, clear } = useLogStore();
  const [open, setOpen] = useState(true);
  const [cmd, setCmd] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const { validated } = useBridgeStore();

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [items.length]);

  // Start bridge validation once on mount
  useEffect(() => {
    startBridgeValidation();
  }, []);

  // Subscribe to tauri event stream if available
  useEffect(() => {
    let unlisten: undefined | (() => void);
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const off = await listen('relay://log', (e: any) => {
          const payload = e?.payload || {};
          const level = (payload.level || 'info') as any;
          const message = String(payload.message || '');
          useLogStore.getState().append(level, message);
        });
        unlisten = off;
      } catch (e) {
        // In web-only runtime, @tauri-apps/api/event may throw; ignore.
      }
    })();
    return () => { try { if (unlisten) unlisten(); } catch {} };
  }, []);

  const runCmd = async () => {
    const c = cmd.trim();
    if (!c) return;
    logInfo(`terminal: ${c}`);
    if (c === 'debug_state') {
      try {
        const out = await tauriInvoke<string>('debug_state');
        out.split('\n').forEach((line) => line && useLogStore.getState().append('debug', line));
      } catch (e: any) {
        logError(`debug_state failed: ${e?.message || String(e)}`);
      }
    } else {
      logError('unknown command');
    }
  };

  return (
    <Box component="section" sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, bgcolor: 'rgba(20,20,20,0.95)', borderTop: '1px solid rgba(255,255,255,0.08)', zIndex: 1000 }}>
      <Box sx={{ maxWidth: 1200, mx: 'auto', px: 2, py: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <TerminalIcon fontSize="small" />
        <Typography variant="caption" sx={{ flexGrow: 1 }}>
          Log console — {items.length} entries {validated ? '(desktop)' : '(web-only)'}
        </Typography>
        <Button size="small" onClick={() => clear()}>Clear</Button>
      </Box>
      <Box sx={{ maxWidth: 1200, mx: 'auto', px: 2, pb: 1 }}>
        <Box sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', fontSize: 12, maxHeight: 180, overflowY: 'auto', bgcolor: 'rgba(0,0,0,0.2)', p: 1, borderRadius: 1 }}>
          {items.map((it, idx) => (
            <div key={idx} style={{ opacity: it.level === 'debug' ? 0.8 : 1 }}>
              <span style={{ color: levelColor(it.level) }}>[{new Date(it.ts).toLocaleTimeString()}][{it.level}]</span> {it.message}
            </div>
          ))}
          <div ref={endRef} />
        </Box>
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <TextField size="small" fullWidth placeholder="terminal — try 'debug_state'" value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runCmd(); }} />
          <Button variant="contained" size="small" onClick={runCmd}>Run</Button>
        </Box>
      </Box>
    </Box>
  );
}

function levelColor(level: string) {
  switch (level) {
    case 'error': return '#ff6b6b';
    case 'warn': return '#ffd166';
    case 'debug': return '#6bc1ff';
    default: return '#a0aec0';
  }
}
