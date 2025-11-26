import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relay Web Load Balancer",
  description: "Selects the fastest available Relay master peer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
