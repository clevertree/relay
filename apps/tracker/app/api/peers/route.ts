import { NextResponse } from 'next/server';
import { ensureDb } from '@/lib/db';
import { Socket } from '@/models/Socket';
import { Repo } from '@/models/Repo';
import { SocketRepoBranch } from '@/models/SocketRepoBranch';

export const runtime = 'nodejs';

export async function GET() {
  await ensureDb();
  const sockets = await Socket.findAll({
    include: [Repo],
    order: [['updatedAt', 'DESC']],
    limit: 200,
  });
  const ids = sockets.map((s) => s.id);
  const branches = ids.length
    ? await SocketRepoBranch.findAll({ where: { socketId: ids } as any })
    : [];
  const branchesBySocket = new Map<number, { repo: string; branch: string; commit: string }[]>();
  for (const b of branches as any[]) {
    branchesBySocket.set(b.socketId, [
      ...(branchesBySocket.get(b.socketId) || []),
      { repo: (b as any).repoId, branch: b.branch, commit: b.commit },
    ]);
  }
  // We need repo names in branches; build repoId->name map
  const repoIdToName = new Map<number, string>();
  for (const s of sockets) {
    (s.repos || []).forEach((r: any) => repoIdToName.set(r.id, r.name));
  }
  const out = sockets.map((s) => {
    const bsRaw = branchesBySocket.get(s.id) || [];
    const bs = bsRaw.map((b) => ({ repo: repoIdToName.get((b as any).repo) || String((b as any).repo), branch: b.branch, commit: b.commit }));
    return {
      id: s.id,
      socket: (s as any).socket,
      repos: Array.isArray(s.repos) ? (s.repos as any[]).map((r) => r.name) : [],
      branches: bs,
      updatedAt: (s as any).updatedAt,
    };
  });
  return NextResponse.json(out);
}
