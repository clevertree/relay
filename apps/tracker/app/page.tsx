/* eslint-disable @next/next/no-img-element */
import 'reflect-metadata';
export const runtime = 'nodejs';
import { ensureDb } from '@/lib/db';

import TrackerToolsClient from './tracker-tools-client';
import PeersStatusClient from './peers-status-client';

export default async function Page() {
  // Require DATABASE_URL during render; fail fast if DB is not available.
  // This enforces that server builds and renders only when a DB is configured.
  let peers: any[] = [];
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required during render');
  }
  await ensureDb();
  const { dbModelsReady } = await import('@/lib/db');
  if (dbModelsReady()) {
    const { Peer } = await import('@/models/Peer');
    peers = await Peer.findAll({ order: [['updatedAt', 'DESC']], limit: 200 });
  } else {
    // Models weren't registered successfully; throw to surface the problem during build.
    throw new Error('Database models not registered during render');
  }

  return (
    <main style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h1>Relay Peer Server</h1>
      <p>Track sockets and their last update time.</p>
      <AddPeerForm />

      <section style={{ marginTop: 32 }}>
        <h2>Tracker Tools</h2>
        <TrackerToolsClient />
      </section>

      <h2 style={{ marginTop: 32 }}>Recent Peers</h2>
      {/* Client-side status checks for peers (OPTIONS -> GET fallback) */}
      <PeersStatusClient peers={peers} />
      {peers.length === 0 ? (
        <p>No peers yet.</p>
      ) : (
        <ul>
          {peers.map((p) => (
            <li key={p.id} style={{ margin: '6px 0' }}>
              <a href={p.socket} target="_blank" rel="noopener noreferrer">
                {p.socket}
              </a>{' '}
              <small style={{ color: '#666' }}>
                updated {new Date(p.updatedAt).toLocaleString()}
              </small>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function AddPeerForm() {
  return (
    <form action={submitSocket} style={{ margin: '16px 0' }}>
      <input
        type="text"
        name="socket"
        placeholder="ws://host:port or http(s)://..."
        style={{ padding: 8, minWidth: 360 }}
        required
      />
      <button type="submit" style={{ marginLeft: 8, padding: '8px 12px' }}>
        Save/Update
      </button>
    </form>
  );
}

async function submitSocket(formData: FormData) {
  'use server';
  const socket = String(formData.get('socket') ?? '').trim();
  if (!socket) return;
  await fetch(`/api/peers/upsert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ socket }),
    cache: 'no-store',
  });
}
