"use client";
import React from 'react';
import { Grid, Card, CardContent, Typography, Chip, Box } from '@mui/material';
import Link from 'next/link';
import type { RepoInfo } from '../lib/api';

type Props = {
  repos: RepoInfo[];
};

function statusFor(repo: RepoInfo) {
  // Heuristic: presence of a `path` is considered local; otherwise remote.
  if (repo.path) return { label: 'Local', color: 'primary' } as const;
  return { label: 'Remote', color: 'default' } as const;
}

export default function RepoList({ repos }: Props) {
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
      <Box mb={2}>
        <Typography variant="h6">Local repositories</Typography>
        {local.length > 0 ? (
          <Grid container spacing={2}>
            {local.map(renderCard)}
          </Grid>
        ) : (
          <Typography color="text.secondary">No local repositories.</Typography>
        )}
      </Box>

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
    </Box>
  );
}
