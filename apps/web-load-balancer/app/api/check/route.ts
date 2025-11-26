import { NextRequest } from "next/server";
import dns from "node:dns";
import net from "node:net";

type DomainStatus = {
  domain: string;
  https: { ok: boolean; ms?: number; error?: string };
  ports: Record<number, { ok: boolean; ms?: number; error?: string }>;
  lastChecked: string; // ISO timestamp
};

const PORTS_TO_CHECK = [443, 9418, 22];
const TIMEOUT_MS = 4000;

let cache: Record<string, DomainStatus> = {};

function getDomainsFromEnv(): string[] {
  const raw = process.env.RELAY_MASTER_PEER_LIST || "";
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function resolveHost(host: string): Promise<void> {
  // Just ensure DNS resolves; will throw on failure
  await new Promise<void>((resolve, reject) => {
    dns.lookup(host, (err) => (err ? reject(err) : resolve()));
  });
}

async function checkTcp(host: string, port: number): Promise<{ ok: boolean; ms?: number; error?: string }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const cleanup = (result: { ok: boolean; ms?: number; error?: string }) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve(result);
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.once("error", (err) => cleanup({ ok: false, error: err.message }));
    socket.once("timeout", () => cleanup({ ok: false, error: "timeout" }));
    socket.connect(port, host, () => {
      const ms = Date.now() - start;
      cleanup({ ok: true, ms });
    });
  });
}

async function checkHttpsHead(host: string): Promise<{ ok: boolean; ms?: number; error?: string }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`https://${host}/`, { method: "HEAD", cache: "no-store", signal: controller.signal });
    clearTimeout(id);
    const ms = Date.now() - start;
    return { ok: res.ok || (res.status >= 200 && res.status < 500), ms };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function checkDomain(domain: string): Promise<DomainStatus> {
  // Ensure hostname resolves first
  try { await resolveHost(domain); } catch (e: any) {
    const now = new Date().toISOString();
    const portsObj: Record<number, { ok: boolean; ms?: number; error?: string }> = {};
    for (const p of PORTS_TO_CHECK) portsObj[p] = { ok: false, error: "dns_failed" };
    return { domain, https: { ok: false, error: "dns_failed" }, ports: portsObj, lastChecked: now };
  }

  const [httpsRes, ...portsRes] = await Promise.all([
    checkHttpsHead(domain),
    ...PORTS_TO_CHECK.map((p) => checkTcp(domain, p)),
  ]);
  const now = new Date().toISOString();
  const ports: Record<number, { ok: boolean; ms?: number; error?: string }> = {};
  for (let i = 0; i < PORTS_TO_CHECK.length; i++) {
    ports[PORTS_TO_CHECK[i]] = portsRes[i];
  }
  return { domain, https: httpsRes, ports, lastChecked: now };
}

export async function POST(_req: NextRequest) {
  const domains = getDomainsFromEnv();
  if (domains.length === 0) {
    return new Response(JSON.stringify({ error: "RELAY_MASTER_PEER_LIST is empty" }), { status: 500 });
  }
  const results = await Promise.all(domains.map((d) => checkDomain(d)));
  for (const r of results) cache[r.domain] = r;
  return new Response(JSON.stringify({ results }), { headers: { "content-type": "application/json" } });
}

export async function GET() {
  // Return cache (and domains order) without performing checks
  const domains = getDomainsFromEnv();
  const results: DomainStatus[] = domains.map((d) => cache[d] || ({
    domain: d,
    https: { ok: false, error: "not_checked" },
    ports: Object.fromEntries(PORTS_TO_CHECK.map((p) => [p, { ok: false, error: "not_checked" }])) as Record<number, any>,
    lastChecked: "",
  } as DomainStatus));
  return new Response(JSON.stringify({ results }), { headers: { "content-type": "application/json" } });
}
