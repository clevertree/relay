import {NextResponse} from 'next/server';
import {ensureDb} from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: Request) {
    try {
        await ensureDb();
        const { dbModelsReady } = await import('@/lib/db');
        if (!dbModelsReady()) {
            return NextResponse.json({ error: 'DB models not available' }, { status: 503 });
        }
        const { Socket } = await import('@/models/Socket');
        const { Repo } = await import('@/models/Repo');
        const { SocketRepoBranch } = await import('@/models/SocketRepoBranch');
    const body = await req.json().catch(() => ({}));
    const socket = (body?.socket ?? '').toString().trim();
    const reposIn: unknown = body?.repos;
    const branchesIn: unknown = body?.branches;
        if (!socket) {
            return NextResponse.json({error: 'socket is required'}, {status: 400});
        }

        // Normalize repo names (optional)
        const repoNames = Array.isArray(reposIn)
            ? Array.from(new Set(
                reposIn
                    .map((r: any) => (r ?? '').toString().trim())
                    .filter((s: string) => !!s)
              ))
            : [];

        // Upsert Socket by unique socket
        const [sock] = await Socket.upsert({ socket });

    // Attach repos: upsert each Repo by name then set associations (replace existing)
    const repoInstances: any[] = [];
        for (const name of repoNames) {
            const [repo] = await Repo.upsert({ name });
            repoInstances.push(repo);
        }
        await (sock as any).$set('repos', repoInstances);

        // Upsert branch heads per repo
        // Strategy: clear existing SocketRepoBranch rows for this socket, then insert provided ones
        await SocketRepoBranch.destroy({ where: { socketId: (sock as any).id } as any });
        if (Array.isArray(branchesIn)) {
            const rows: any[] = [];
            for (const b of branchesIn as any[]) {
                const repoName = (b?.repo ?? '').toString().trim();
                const branch = (b?.branch ?? '').toString().trim();
                const commit = (b?.commit ?? '').toString().trim();
                if (!repoName || !branch || !commit) continue;
                // ensure repo exists
                const [repo] = await Repo.upsert({ name: repoName });
                rows.push({ socketId: (sock as any).id, repoId: (repo as any).id, branch, commit });
            }
            if (rows.length) await SocketRepoBranch.bulkCreate(rows);
        }

        // Reload with include to return current state
        const withRepos = await Socket.findByPk(sock.id, { include: [Repo] });
        const branchRows = await SocketRepoBranch.findAll({ where: { socketId: (sock as any).id } as any });
        const repoIdToName = new Map<number, string>();
        (withRepos?.repos || []).forEach((r: any) => repoIdToName.set(r.id, r.name));
        return NextResponse.json({
            id: withRepos?.id ?? sock.id,
            socket: withRepos?.socket ?? socket,
            repos: Array.isArray(withRepos?.repos) ? (withRepos!.repos as any[]).map(r => r.name) : [],
            branches: (branchRows as any[]).map((r) => ({ repo: repoIdToName.get(r.repoId) || String(r.repoId), branch: r.branch, commit: r.commit })),
            updatedAt: withRepos?.updatedAt ?? sock.updatedAt,
        });
    } catch (e: any) {
        return NextResponse.json({error: e?.message ?? 'Unknown error'}, {status: 500});
    }
}
