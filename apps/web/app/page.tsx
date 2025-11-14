"use client";
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Box, Card, CardContent, CircularProgress, Grid, Typography } from '@mui/material';
import { listRepos, RepoInfo } from '../src/lib/api';

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
      {!loading && (
        <Grid container spacing={2}>
          {(repos ?? []).map((repo) => (
            <Grid item xs={12} sm={6} md={4} key={repo.name}>
              <Link href={`/repo/${encodeURIComponent(repo.name)}`}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                  <CardContent>
                    <Typography variant="h6">{repo.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {repo.description || 'Git repository'}
                    </Typography>
                  </CardContent>
                </Card>
              </Link>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}
