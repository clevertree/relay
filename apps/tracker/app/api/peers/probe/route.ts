import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import net from 'net';
import { URL } from 'url';

// POST /api/peers/probe
// body: { socket: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const socket = String(body.socket || '');
    if (!socket) return NextResponse.json({ ok: false, error: 'socket missing' }, { status: 400 });

    // Try to parse as URL to extract host and port
    let host: string | null = null;
    let port: number | null = null;
    try {
      const u = new URL(socket);
      host = u.hostname;
      port = Number(u.port) || (u.protocol === 'https:' ? 443 : u.protocol === 'http:' ? 80 : null);
    } catch (e) {
      // Try to parse ws/wss or raw host:port
      const m = socket.match(/^(?:wss?:\/\/)?\[?([^\]]+)\]?:(\d+)$/);
      if (m) {
        host = m[1];
        port = Number(m[2]);
      }
    }

    if (!host || !port) {
      // If we can't extract, return unknown
      return NextResponse.json({ ok: false, error: 'unable to parse host:port from socket' }, { status: 400 });
    }

    // Attempt a TCP connect with a short timeout
    const timeoutMs = 3000;
    const res = await new Promise<{ ok: boolean; status?: string; error?: string }>((resolve) => {
      const socketConn = new net.Socket();
      let done = false;
      const onDone = (out: { ok: boolean; status?: string; error?: string }) => {
        if (done) return;
        done = true;
        try { socketConn.destroy(); } catch (e) {}
        resolve(out);
      };
      socketConn.setTimeout(timeoutMs);
      socketConn.once('connect', () => onDone({ ok: true, status: 'connected' }));
      socketConn.once('timeout', () => onDone({ ok: false, error: 'timeout' }));
      socketConn.once('error', (err: any) => onDone({ ok: false, error: String(err) }));
      socketConn.connect(port as number, host as string);
    });

    return NextResponse.json({ ok: res.ok, info: res }, { status: res.ok ? 200 : 503 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
