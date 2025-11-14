"use client";
import React from 'react';
import { Box, TextField, Switch, FormControlLabel, Typography, Paper } from '@mui/material';
import { useConfigStore } from '../../src/store/config';

export default function SettingsPage() {
  const cfg = useConfigStore();
  return (
    <Box>
      <Typography variant="h4" gutterBottom>Settings</Typography>
      <Paper variant="outlined" sx={{ p: 2, display: 'grid', gap: 2, maxWidth: 600 }}>
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
        <Typography variant="body2" color="text.secondary">
          Changes are saved locally in your browser and applied immediately.
        </Typography>
      </Paper>
    </Box>
  );
}
