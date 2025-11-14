"use client";
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Box, CircularProgress, Typography } from '@mui/material';
import { listRepos, RepoInfo } from '../src/lib/api';
import RepoList from '../src/components/RepoList';

export default function HomePage() {
  const [repos, setRepos] = useState<RepoInfo[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    listRepos().then((r) => {
      if (mounted) { setRepos(r); setLoading(false); }
    }).catch(() => setLoading(false));
    return () => { mounted = false; };
  }, []);

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Repositories</Typography>
      {loading && <CircularProgress />}
      {!loading && <RepoList repos={repos ?? []} />}
    </Box>
  );
}
