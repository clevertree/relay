"use client";
import React from 'react';
import { Box, TextField, Switch, FormControlLabel, Typography, Paper, Button } from '@mui/material';
import { useConfigStore } from '../../src/store/config';
import { getDefaultConfigPath } from '../../src/lib/paths';

export default function SettingsPage() {
  const cfg = useConfigStore();
  return (
    <Box>
      <Typography variant="h4" gutterBottom>Settings</Typography>
      <Paper variant="outlined" sx={{ p: 2, display: 'grid', gap: 2, maxWidth: 800 }}>
        <TextField
          fullWidth
          label="Master Endpoint"
          helperText="HTTP base URL for the host server (e.g., http://localhost:8080)"
          value={cfg.masterEndpoint}
          onChange={(e) => cfg.set({ masterEndpoint: e.target.value })}
        />
        <TextField
          fullWidth
          type="number"
          label="HTTP Port"
          value={cfg.httpPort}
          onChange={(e) => cfg.set({ httpPort: Number(e.target.value || 0) })}
        />
        <TextField
          fullWidth
          type="number"
          label="Git Port"
          value={cfg.gitPort}
          onChange={(e) => cfg.set({ gitPort: Number(e.target.value || 0) })}
        />
        <FormControlLabel
          control={<Switch checked={cfg.shallowDefault} onChange={(_, v) => cfg.set({ shallowDefault: v })} />}
          label="Shallow clone by default"
        />
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField
            fullWidth
            label="Config path (host app dir)"
            helperText="Base directory for local repositories and app data. Leave empty to use the OS default."
            value={cfg.configPath}
            onChange={(e) => cfg.set({ configPath: e.target.value })}
          />
          <Button variant="outlined" onClick={async () => {
            const p = await getDefaultConfigPath();
            cfg.set({ configPath: p });
          }}>Use default</Button>
        </Box>
        <Typography variant="body2" color="text.secondary">
          Changes are saved locally and applied immediately. The default config path resolves to the OS app data directory when running as a desktop app, otherwise to ./host/repos during web development.
        </Typography>
      </Paper>
    </Box>
  );
}
