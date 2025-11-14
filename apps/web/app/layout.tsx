import './globals.css';
import React from 'react';
import NavBar from '../src/components/NavBar';
import ClientThemeProvider from '../src/components/ClientThemeProvider';

export const metadata = {
  title: 'Relay',
  description: 'Relay UI',
};


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClientThemeProvider>
          <NavBar />
          <main style={{ padding: '16px', maxWidth: 1200, margin: '0 auto' }}>
            {children}
          </main>
        </ClientThemeProvider>
      </body>
    </html>
  );
}
