/* eslint-disable @next/next/no-img-element */
import 'reflect-metadata';
export const runtime = 'nodejs';
import { ensureDb } from '@/lib/db';
import { Peer } from '@/models/Peer';

export default async function Page() {
  await ensureDb();
  const peers = await Peer.findAll({ order: [['updatedAt', 'DESC']], limit: 200 });
  return (
    <main>
      <h1>Relay Peer Server</h1>
      <p>Track sockets and their last update time.</p>
      <AddPeerForm />
      <h2>Recent Peers</h2>
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
