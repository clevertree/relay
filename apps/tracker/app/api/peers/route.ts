import { NextResponse } from 'next/server';
import { ensureDb } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  // If no DATABASE_URL is configured, return an empty list so prerender
  // and build steps don't attempt to load DB drivers.
  if (!process.env.DATABASE_URL || process.env.SKIP_DB_DURING_PRERENDER === '1') {
    return NextResponse.json([]);
  }
  await ensureDb();
  const { dbModelsReady } = await import('@/lib/db');
  if (!dbModelsReady()) {
    return NextResponse.json([]);
  }
  const { Socket } = await import('@/models/Socket');
  const { Repo } = await import('@/models/Repo');
  const sockets = await Socket.findAll({
    include: [Repo],
    order: [['updatedAt', 'DESC']],
    limit: 200,
  });
  const ids = sockets.map((s) => s.id);
  const { SocketRepoBranch } = await import('@/models/SocketRepoBranch');
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
