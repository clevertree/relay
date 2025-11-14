import './globals.css';
import React from 'react';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import NavBar from '../src/components/NavBar';

export const metadata = {
  title: 'Relay',
  description: 'Relay UI',
};

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#90caf9' },
    secondary: { main: '#f48fb1' },
    background: { default: '#0b0f14', paper: '#121821' },
  },
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <NavBar />
          <main style={{ padding: '16px', maxWidth: 1200, margin: '0 auto' }}>
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
