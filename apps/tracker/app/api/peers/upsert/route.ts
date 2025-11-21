import {NextResponse} from 'next/server';
import {ensureDb} from '@/lib/db';
import {Peer} from '@/models/Peer';

export const runtime = 'nodejs';

export async function POST(req: Request) {
    try {
        await ensureDb();
        const body = await req.json().catch(() => ({}));
        const socket = (body?.socket ?? '').toString().trim();
        if (!socket) {
            return NextResponse.json({error: 'socket is required'}, {status: 400});
        }

        // Upsert by unique socket
        const [peer] = await Peer.upsert({
            socket
        });
        return NextResponse.json({id: peer.id, socket: peer.socket, updatedAt: peer.updatedAt});
    } catch (e: any) {
        return NextResponse.json({error: e?.message ?? 'Unknown error'}, {status: 500});
    }
}
