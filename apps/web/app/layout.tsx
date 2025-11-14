import './globals.css';
import React from 'react';
import MuiThemeProvider from '../src/components/Theme';
import NavBar from '../src/components/NavBar';

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
        </MuiThemeProvider>
      </body>
    </html>
  );
}
