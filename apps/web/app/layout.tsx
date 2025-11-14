import './globals.css';
import React from 'react';
import MuiThemeProvider from '../src/components/Theme';
import NavBar from '../src/components/NavBar';
import { Box, Chip, Typography } from '@mui/material';

// Read version from package.json at build time using next's public metadata import
import pkg from '../package.json';

export const metadata = {
  title: 'Relay',
  description: 'Relay UI',
  icons: {
    icon: '/favicon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <MuiThemeProvider>
          <NavBar />
          <main style={{ padding: '16px', maxWidth: 1200, margin: '0 auto' }}>
            {children}
          </main>

          <Box component="footer" sx={{ mt: 4, py: 2, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <Box sx={{ maxWidth: 1200, margin: '0 auto', px: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary">Relay UI v{(pkg as any).version}</Typography>
              <RuntimeChip />
            </Box>
          </Box>

        </MuiThemeProvider>
      </body>
    </html>
  );
}

function RuntimeChip() {
  // detect Tauri runtime
  const isDesktop = typeof window !== 'undefined' && !!(window as any).__TAURI__;
  return (
    <Chip label={isDesktop ? 'desktop' : 'web-only'} color={isDesktop ? 'success' : 'primary'} size="small" />
  );
}
