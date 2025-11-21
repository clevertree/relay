import { NextResponse } from 'next/server';
import { ensureDb } from '@/lib/db';
import { Peer } from '@/models/Peer';

export const runtime = 'nodejs';

export async function GET() {
  await ensureDb();
  const peers = await Peer.findAll({ order: [['updatedAt', 'DESC']], limit: 200 });
  return NextResponse.json(
    peers.map((p) => ({ id: p.id, socket: p.socket, updatedAt: p.updatedAt }))
  );
}
