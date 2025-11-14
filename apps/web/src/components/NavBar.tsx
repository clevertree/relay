"use client";
import React from 'react';
import Link from 'next/link';
import { AppBar, Toolbar, Typography, Box, Button } from '@mui/material';
import Image from 'next/image';

export default function NavBar() {
  return (
    <AppBar position="sticky" color="transparent" elevation={0} sx={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
      <Toolbar>
        <Typography variant="h6" component="div" sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Link href="/">
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              <Image src="/favicon.png" alt="Relay" width={28} height={28} style={{ borderRadius: 6 }} />
              <span>Relay</span>
            </Box>
          </Link>
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button color="inherit" component={Link} href="/">Home</Button>
          <Button color="inherit" component={Link} href="/settings">Settings</Button>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
