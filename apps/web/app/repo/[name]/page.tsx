"use client";
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Box, CircularProgress, Typography, Paper } from '@mui/material';
import SafeMarkdown from '../../../src/components/SafeMarkdown';
import { fetchInterfaceMarkdown } from '../../../src/lib/api';

export default function RepoPage() {
  const params = useParams<{ name: string }>();
  const name = (params?.name as string) || '';
  const [md, setMd] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (!name) return;
    fetchInterfaceMarkdown(name)
      .then((m) => { if (mounted) { setMd(m); setLoading(false); } })
      .catch(() => setLoading(false));
    return () => { mounted = false; };
  }, [name]);

  return (
    <Box>
      <Typography variant="h4" gutterBottom>{name}</Typography>
      {loading ? (
        <CircularProgress />
      ) : (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <SafeMarkdown markdown={md} />
        </Paper>
      )}
    </Box>
  );
}
