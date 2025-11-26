import { NextRequest } from "next/server";
import dns from "node:dns";
import net from "node:net";

type DomainStatus = {
  domain: string;
  resolvedIp?: string;
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

async function resolveHost(host: string): Promise<string> {
  // Resolve and return IP address; throws on failure
  return await new Promise<string>((resolve, reject) => {
    dns.lookup(host, (err, address) => (err ? reject(err) : resolve(address)));
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
  let resolvedIp: string | undefined;
  try { resolvedIp = await resolveHost(domain); } catch (e: any) {
    const now = new Date().toISOString();
    const portsObj: Record<number, { ok: boolean; ms?: number; error?: string }> = {};
    for (const p of PORTS_TO_CHECK) portsObj[p] = { ok: false, error: "dns_failed" };
    return { domain, resolvedIp, https: { ok: false, error: "dns_failed" }, ports: portsObj, lastChecked: now };
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
  return { domain, resolvedIp, https: httpsRes, ports, lastChecked: now };
}

export async function POST(_req: NextRequest) {
  // Optional body: { domain?: string }
  let body: any = null;
  try {
    body = await _req.json();
  } catch {
    // ignore empty/invalid JSON
  }

  // Single-domain check
  if (body && typeof body.domain === "string" && body.domain.trim().length > 0) {
    const domain = body.domain.trim();
    const result = await checkDomain(domain);
    cache[domain] = result;
    return new Response(JSON.stringify({ results: [result] }), { headers: { "content-type": "application/json" } });
  }

  // Check all domains sequentially (one by one)
  const domains = getDomainsFromEnv();
  if (domains.length === 0) {
    return new Response(JSON.stringify({ error: "RELAY_MASTER_PEER_LIST is empty" }), { status: 500 });
  }
  const results: DomainStatus[] = [];
  for (const d of domains) {
    const r = await checkDomain(d);
    cache[r.domain] = r;
    results.push(r);
  }
  return new Response(JSON.stringify({ results }), { headers: { "content-type": "application/json" } });
}

export async function GET() {
  // Return cache (and domains order) without performing checks
  const domains = getDomainsFromEnv();
  const results: DomainStatus[] = domains.map((d) => cache[d] || ({
    domain: d,
    resolvedIp: undefined,
    https: { ok: false, error: "not_checked" },
    ports: Object.fromEntries(PORTS_TO_CHECK.map((p) => [p, { ok: false, error: "not_checked" }])) as Record<number, any>,
    lastChecked: "",
  } as DomainStatus));
  return new Response(JSON.stringify({ results }), { headers: { "content-type": "application/json" } });
}
