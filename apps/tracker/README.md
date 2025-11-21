Relay Tracker (Next.js)

Purpose
Lists recent master peer sockets and accepts upserts from peers. Deployed to Vercel.

API
- GET /api/peers — List recent peers: [{ id, socket, updatedAt }]
- POST /api/peers/upsert — Upsert a peer by socket

Local Dev
pnpm install
pnpm dev
