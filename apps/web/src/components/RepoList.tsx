"use client";
import React, { useState, useEffect } from 'react';
import { logInfo, logError, logWarn, tauriInvoke, useBridgeStore, startBridgeValidation } from '../lib/log';
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
import { useConfigStore } from '../store/config';
import { getDefaultConfigPath } from '../lib/paths';
import { slugify } from '../lib/repoSchema';

type Props = {
  repos: RepoInfo[];
  onCreated?: () => void;
};

function statusFor(repo: RepoInfo) {
  // Presence of a `localPath` is considered local; otherwise remote.
  if (repo.localPath) {
    if (repo.missing) return { label: 'Missing', color: 'warning' } as const;
    return { label: 'Local', color: 'primary' } as const;
  }
  return { label: 'Remote', color: 'default' } as const;
}

export default function RepoList({ repos, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('movies');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [basePath, setBasePath] = useState<string>('');
  const cfg = useConfigStore();

  // Use bridge validation state to gate desktop-only actions.
  const { validated, validating } = useBridgeStore();
  useEffect(() => { startBridgeValidation(); }, []);

  const openModal = () => setOpen(true);
  const closeModal = () => {
    setOpen(false);
    setTitle('');
    setDescription('');
    setName('');
    setTemplate('movies');
    setBasePath('');
    setError(null);
    setCreating(false);
  };

  // When dialog opens, seed basePath from config or default resolver
  useEffect(() => {
    if (!open) return;
    (async () => {
      let base = cfg.configPath?.trim();
      if (!base) {
        try { base = await getDefaultConfigPath(); } catch {}
      }
      setBasePath(base || '');
    })();
  }, [open]);

  const validateName = (n: string) => /^[a-zA-Z0-9 _-]+$/.test(n);
  const safeName = slugify(name || '').replace(/_/g, '-');
  const computedPath = (basePath?.replace(/\\+$/,'').replace(/\/+$/, '') || '') + (safeName ? `/${safeName}` : '');

  const handleCreate = async () => {
    setError(null);
    if (!title.trim()) return setError('Title is required');
    if (!name.trim()) return setError('Repository name is required');
    if (!validateName(name)) return setError('Use letters, numbers, spaces, - or _');
    if (!validated) return setError('Repository creation is available only in desktop mode');

    setCreating(true);
    try {
      logInfo(`create repo: ${name} (template=${template}) at ${computedPath}`);
      const path = (basePath || '').trim() || undefined;
      await tauriInvoke('init_repo', { name, template, path, title, description });
      logInfo('create repo: success');
      if (typeof onCreated === 'function') onCreated();
      closeModal();
    } catch (err: any) {
      logError('create repo failed: ' + (err?.message || String(err)));
      setError(err?.message || String(err));
      setCreating(false);
    }
  };
  const local = repos.filter((r) => !!r.localPath);
  const remote = repos.filter((r) => !r.localPath);

  const renderCard = (repo: RepoInfo) => {
    const s = statusFor(repo);
    return (
      <Grid item xs={12} sm={6} md={4} key={repo.name}>
        <Link href={`/repo/${encodeURIComponent(repo.name)}`}>
          <Card variant="outlined" sx={{ height: '100%', cursor: 'pointer' }}>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Typography variant="h6">{repo.title || repo.name}</Typography>
                <Chip label={s.label} color={s.color as any} size="small" />
              </Box>
              <Typography variant="body2" color={repo.missing ? 'warning.main' as any : 'text.secondary'}>
                {repo.missing ? 'Local repository missing on disk' : (repo.lastURL || repo.localPath || '')}
              </Typography>
              {repo.title && repo.title !== repo.name && (
                <Typography variant="caption" color="text.secondary">{repo.name}</Typography>
              )}
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
        <Tooltip title={validated ? 'Create a new local repository' : (validating ? 'Checking desktop environment…' : 'Repository creation is available in desktop mode only')}>
          <span>
            <Button variant="contained" onClick={openModal} disabled={!validated} size="small">
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
            Create a new repository. Choose where to create it; by default we use your host app directory.
            This operation requires desktop mode (Tauri).
          </DialogContentText>
          <Box mt={2} display="flex" flexDirection="column" gap={2}>
            <TextField
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              helperText={!title ? 'A readable title for your repository' : ' '}
              fullWidth
            />
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              helperText={'Optional short description'}
              multiline minRows={2}
              fullWidth
            />
            <TextField
              label="Repository name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              helperText={error ?? 'Letters, numbers, spaces, - or _; used to form the folder name'}
              error={!!error}
              fullWidth
            />
            <TextField
              label="Base folder"
              value={basePath}
              onChange={(e) => setBasePath(e.target.value)}
              helperText={basePath ? 'Directory where the repository folder will be created' : 'Using runtime default path'}
              fullWidth
            />
            <TextField
              label="Will be created at"
              value={computedPath}
              InputProps={{ readOnly: true }}
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
          <Button onClick={handleCreate} variant="contained" disabled={creating || !validated}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
