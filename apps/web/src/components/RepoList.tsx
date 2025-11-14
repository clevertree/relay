"use client";
import React, { useState, useEffect } from 'react';
import { isDesktopRuntime } from '../lib/runtime';
import { logInfo, logError, logWarn, tauriInvoke } from '../lib/log';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Chip,
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  TextField,
  DialogActions,
  MenuItem,
  Select,
  Tooltip,
} from '@mui/material';
import Link from 'next/link';
import type { RepoInfo } from '../lib/api';

type Props = {
  repos: RepoInfo[];
  onCreated?: () => void;
};

function statusFor(repo: RepoInfo) {
  // Heuristic: presence of a `path` is considered local; otherwise remote.
  if (repo.path) return { label: 'Local', color: 'primary' } as const;
  return { label: 'Remote', color: 'default' } as const;
}

export default function RepoList({ repos, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('movies');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect desktop/Tauri environment reactively.
  // The Tauri bridge can be injected after initial render, so poll briefly
  // to catch late arrival and update the UI accordingly.
  const [isDesktop, setIsDesktop] = useState<boolean>(
    typeof window !== 'undefined' && isDesktopRuntime()
  );

  useEffect(() => {
    if (isDesktop) return;
    let mounted = true;
    // quick polling for bridge for up to ~2s
    const intervalMs = 150;
    const maxAttempts = Math.ceil(2000 / intervalMs);
    let attempts = 0;
    const id = setInterval(() => {
      attempts += 1;
      if (!mounted) return;
      try {
        if (isDesktopRuntime()) {
          setIsDesktop(true);
          clearInterval(id);
          return;
        }
      } catch (e) {
        // ignore
      }
      if (attempts >= maxAttempts) {
        clearInterval(id);
      }
    }, intervalMs);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [isDesktop]);

  const openModal = () => setOpen(true);
  const closeModal = () => {
    setOpen(false);
    setName('');
    setTemplate('movies');
    setError(null);
    setCreating(false);
  };

  const validateName = (n: string) => /^[a-zA-Z0-9_-]+$/.test(n);

  const handleCreate = async () => {
    setError(null);
    if (!name) return setError('Repository name is required');
    if (!validateName(name)) return setError('Use only letters, numbers, - or _');
    if (!isDesktop) return setError('Repository creation is available only in desktop mode');

    setCreating(true);
    try {
      logInfo(`create repo: ${name} (template=${template})`);
      await tauriInvoke('init_repo', { name, template });
      logInfo('create repo: success');
      if (typeof onCreated === 'function') onCreated();
      closeModal();
    } catch (err: any) {
      logError('create repo failed: ' + (err?.message || String(err)));
      setError(err?.message || String(err));
      setCreating(false);
    }
  };
  const local = repos.filter((r) => !!r.path);
  const remote = repos.filter((r) => !r.path);

  const renderCard = (repo: RepoInfo) => {
    const s = statusFor(repo);
    return (
      <Grid item xs={12} sm={6} md={4} key={repo.name}>
        <Link href={`/repo/${encodeURIComponent(repo.name)}`}>
          <Card variant="outlined" sx={{ height: '100%', cursor: 'pointer' }}>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Typography variant="h6">{repo.name}</Typography>
                <Chip label={s.label} color={s.color as any} size="small" />
              </Box>
              <Typography variant="body2" color="text.secondary">
                {repo.description || 'Git repository'}
              </Typography>
            </CardContent>
          </Card>
        </Link>
      </Grid>
    );
  };

  return (
    <Box>
      <Box mb={2} display="flex" alignItems="center" justifyContent="space-between">
        <Typography variant="h6">Local repositories</Typography>
        <Tooltip title={isDesktop ? 'Create a new local repository' : 'Repository creation is available in desktop mode only'}>
          <span>
            <Button variant="contained" onClick={openModal} disabled={!isDesktop} size="small">
              Add repository
            </Button>
          </span>
        </Tooltip>
      </Box>

      {local.length > 0 ? (
        <Grid container spacing={2}>
          {local.map(renderCard)}
        </Grid>
      ) : (
        <Typography color="text.secondary">No local repositories.</Typography>
      )}

      <Box mt={3}>
        <Typography variant="h6">Remote repositories</Typography>
        {remote.length > 0 ? (
          <Grid container spacing={2}>
            {remote.map(renderCard)}
          </Grid>
        ) : (
          <Typography color="text.secondary">No remote repositories.</Typography>
        )}
      </Box>

      <Dialog open={open} onClose={closeModal}>
        <DialogTitle>Create repository</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Create a new repository under the host repos path. This operation requires desktop mode (Tauri) and will run the native init logic.
          </DialogContentText>
          <Box mt={2} display="flex" flexDirection="column" gap={2}>
            <TextField
              label="Repository name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              helperText={error ?? 'Allowed: letters, numbers, - and _'}
              error={!!error}
              fullWidth
            />
            <Select value={template} onChange={(e) => setTemplate(e.target.value)} fullWidth>
              <MenuItem value="empty">empty</MenuItem>
              <MenuItem value="movies">movies</MenuItem>
            </Select>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeModal} disabled={creating}>Cancel</Button>
          <Button onClick={handleCreate} variant="contained" disabled={creating || !isDesktop}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
