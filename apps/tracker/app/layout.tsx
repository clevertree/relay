export const metadata = {
  title: 'Relay Peer Server',
  description: 'List and update peer sockets',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 20 }}>{children}</body>
    </html>
  );
}
