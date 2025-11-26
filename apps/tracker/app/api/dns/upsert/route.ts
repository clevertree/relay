import { NextResponse } from 'next/server';
import { inferRecordType, normalizeRecordName, listRecords, createRecord, updateRecord } from '@/lib/vercel';

export const runtime = 'nodejs';

type Body = {
  domain?: string;
  name: string; // subdomain label or FQDN; '@' for root
  // Single-value compatibility field (A or AAAA or hostname for CNAME)
  ip?: string;
  // Preferred explicit fields to support both IPv4 and IPv6 in one call
  ipv4?: string;
  ipv6?: string;
  type?: 'A' | 'AAAA' | 'CNAME';
  ttl?: number; // seconds
  teamId?: string;
  slug?: string;
  comment?: string;
};

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

function authOk(req: Request): boolean {
  const tok = process.env.TRACKER_ADMIN_TOKEN || '';
  if (!tok) return false; // explicitly require it in runtime env
  const hdr = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  if (!hdr.startsWith('Bearer ')) return false;
  const provided = hdr.slice('Bearer '.length).trim();
  return provided === tok;
}

function isValidLabel(name: string): boolean {
  // allow '@' or one or more labels separated by dots
  if (name === '@') return true;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(name);
}

export async function POST(req: Request) {
  try {
    if (!authOk(req)) {
      return bad('unauthorized', 401);
    }
    const body = (await req.json().catch(() => ({}))) as Partial<Body>;
    const domain = (body.domain || process.env.VERCEL_DNS_DOMAIN || 'relaynet.online').toString().trim();
    const nameRaw = (body.name || '').toString().trim();
    const ipCompat = (body.ip || '').toString().trim();
    const ipv4 = (body.ipv4 || '').toString().trim();
    const ipv6 = (body.ipv6 || '').toString().trim();
    const ttl = Math.max(1, Math.min(86400, Number.isFinite(body.ttl as number) ? Number(body.ttl) : 60));
    // type is only meaningful for single-record (compat) or CNAME; when both ipv4/ipv6 provided we ignore `type`
    const typeCompat = inferRecordType(body.type as any, ipCompat);
    const teamId = (body.teamId || process.env.VERCEL_TEAM_ID || '').toString().trim() || undefined;
    const slug = (body.slug || process.env.VERCEL_TEAM_SLUG || '').toString().trim() || undefined;
    if (!process.env.VERCEL_API_TOKEN) {
      return bad('VERCEL_API_TOKEN not configured on server', 500);
    }
    if (!domain) return bad('domain is required (env VERCEL_DNS_DOMAIN default used when omitted)');
    if (!nameRaw) return bad('name is required');
    // Validate that at least one of ip/ipv4/ipv6 is provided
    const hasAnyIp = !!(ipCompat || ipv4 || ipv6);
    if (!hasAnyIp) return bad('ip, ipv4 or ipv6 is required');
    const name = normalizeRecordName(nameRaw, domain) || '@';
    if (!isValidLabel(name === '@' ? 'root' : name)) return bad('invalid subdomain name');

    const ctx = { teamId, slug };
    const records = await listRecords(domain, ctx);
    const fqdn = name === '@' ? domain : `${name}.${domain}`;

    async function upsertOne(value: string, ty: 'A' | 'AAAA' | 'CNAME') {
      // Filter for same name+type records
      const candidates = records.filter((r: any) => {
        const rType = (r.type || r.recordType || '').toUpperCase();
        const rName = (r.name || '@');
        return rType === ty && rName === name;
      });
      const exact = candidates.find((r: any) => (r.value === value));
      if (exact) return { action: 'none' as const, type: ty, value, ttl: exact.ttl ?? ttl, record: exact };
      if (candidates.length > 0) {
        const rec = candidates[0];
        const updated = await updateRecord(domain, rec.id || rec.uid || rec.recordId, { value, ttl, type: ty, name }, ctx);
        return { action: 'updated' as const, type: ty, value, ttl, record: updated };
      }
      const created = await createRecord(domain, { name, value, type: ty, ttl, comment: body.comment }, ctx);
      return { action: 'created' as const, type: ty, value, ttl, record: created };
    }

    const results: any[] = [];
    let anyCreated = false;

    // If explicit ipv4/ipv6 provided, prefer those. Otherwise fall back to compat single ip.
    if (ipv4) {
      const r = await upsertOne(ipv4, 'A');
      if (r.action === 'created') anyCreated = true;
      results.push(r);
    }
    if (ipv6) {
      const r = await upsertOne(ipv6, 'AAAA');
      if (r.action === 'created') anyCreated = true;
      results.push(r);
    }
    if (!ipv4 && !ipv6 && ipCompat) {
      const r = await upsertOne(ipCompat, typeCompat);
      if (r.action === 'created') anyCreated = true;
      results.push(r);
    }

    // Backwards-compatible single fields if only one result
    if (results.length === 1) {
      const r0 = results[0];
      return NextResponse.json({ action: r0.action, domain, fqdn, type: r0.type, value: r0.value, ttl: r0.ttl, record: r0.record }, { status: anyCreated ? 201 : 200 });
    }
    return NextResponse.json({ domain, fqdn, results }, { status: anyCreated ? 201 : 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'unknown error' }, { status: 500 });
  }
}
