'use client';

import React, { useEffect, useState } from 'react';

type Peer = {
  id: number;
  socket: string;
  updatedAt: string;
};

export default function PeersStatusClient({ peers }: { peers: Peer[] }) {
  const [statuses, setStatuses] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!peers || peers.length === 0) return;
    peers.forEach((p) => {
      const check = async () => {
        try {
          const res = await fetch('/api/peers/probe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ socket: p.socket }),
            cache: 'no-store',
          });
          const j = await res.json();
          if (res.ok && j.ok) {
            setStatuses((s) => ({ ...s, [p.id]: `ok (${j.info?.status ?? 'connected'})` }));
          } else {
            setStatuses((s) => ({ ...s, [p.id]: `fail (${j.error ?? 'unreachable'})` }));
          }
        } catch (e) {
          setStatuses((s) => ({ ...s, [p.id]: `error` }));
        }
      };
      check();
    });
  }, [peers]);

  return (
    <div style={{ marginTop: 12 }}>
      <h3>Peer Status</h3>
      <ul>
        {peers.map((p) => (
          <li key={p.id} style={{ margin: '6px 0' }}>
            <strong>{p.socket}</strong> — <span>{statuses[p.id] ?? 'unknown'}</span>
          </li>
        ))}
      </ul>
      <p style={{ color: '#666' }}>
        Note: browser CORS or network restrictions may prevent status checks. This is best-effort.
      </p>
    </div>
  );
}
