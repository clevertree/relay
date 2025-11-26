import { Vercel } from '@vercel/sdk';

export type TeamCtx = { teamId?: string; slug?: string };

export function getVercelClient(): Vercel {
  const token = process.env.TRACKER_ADMIN_TOKEN || '';
  if (!token) {
    throw new Error('TRACKER_ADMIN_TOKEN is not set');
  }
  return new Vercel({ bearerToken: token });
}

export function inferRecordType(inputType: string | undefined | null, value: string): 'A' | 'AAAA' | 'CNAME' {
  const t = (inputType || '').toUpperCase();
  if (t === 'A' || t === 'AAAA' || t === 'CNAME') return t as any;
  // crude heuristic: IPv6 contains ':'
  return value.includes(':') ? 'AAAA' : 'A';
}

export function normalizeRecordName(name: string, domain: string): string {
  const n = (name || '').trim().replace(/\.$/, '');
  const d = (domain || '').trim().replace(/\.$/, '');
  if (!n) return '';
  // If name already ends with the domain, strip it to label
  const lowerN = n.toLowerCase();
  const lowerD = d.toLowerCase();
  if (lowerN === lowerD) return '@';
  if (lowerN.endsWith('.' + lowerD)) {
    return n.slice(0, n.length - (lowerD.length + 1));
  }
  return n;
}

export async function listRecords(domain: string, ctx?: TeamCtx): Promise<any[]> {
  const token = process.env.TRACKER_ADMIN_TOKEN || '';
  const qs = new URLSearchParams();
  if (ctx?.teamId) qs.set('teamId', ctx.teamId);
  if (ctx?.slug) qs.set('slug', ctx.slug);
  const url = `https://api.vercel.com/v4/domains/${encodeURIComponent(domain)}/records?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Vercel listRecords failed: HTTP ${res.status}`);
  }
  const json = await res.json();
  return Array.isArray(json.records) ? json.records : [];
}

export async function createRecord(domain: string, data: { name: string; value: string; type: string; ttl?: number; 
comment?: string }, ctx?: TeamCtx): Promise<any> {                                                                    const token = process.env.TRACKER_ADMIN_TOKEN || ''; 
  const qs = new URLSearchParams();
  if (ctx?.teamId) qs.set('teamId', ctx.teamId);
  if (ctx?.slug) qs.set('slug', ctx.slug);
  const url = `https://api.vercel.com/v2/domains/${encodeURIComponent(domain)}/records?${qs.toString()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: data.name, value: data.value, type: data.type, ttl: data.ttl ?? 60, comment: data.c
omment }),                                                                                                            });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel createRecord failed: HTTP ${res.status} ${text}`);
  }
  return res.json();
}

export async function updateRecord(domain: string, recordId: string, data: { name?: string; value?: string; type?: s
tring; ttl?: number; comment?: string }, ctx?: TeamCtx): Promise<any> {                                               const token = process.env.TRACKER_ADMIN_TOKEN || ''; 
  const qs = new URLSearchParams();
  if (ctx?.teamId) qs.set('teamId', ctx.teamId);
  if (ctx?.slug) qs.set('slug', ctx.slug);
  const url = `https://api.vercel.com/v2/domains/${encodeURIComponent(domain)}/records/${encodeURIComponent(recordId
)}?${qs.toString()}`;                                                                                                 const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel updateRecord failed: HTTP ${res.status} ${text}`);
  }
  return res.json();
}

export async function deleteRecord(domain: string, recordId: string, ctx?: TeamCtx): Promise<void> {
  const token = process.env.TRACKER_ADMIN_TOKEN || '';
  const qs = new URLSearchParams();
  if (ctx?.teamId) qs.set('teamId', ctx.teamId);
  if (ctx?.slug) qs.set('slug', ctx.slug);
  const url = `https://api.vercel.com/v2/domains/${encodeURIComponent(domain)}/records/${encodeURIComponent(recordId
)}?${qs.toString()}`;                                                                                                 const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel deleteRecord failed: HTTP ${res.status} ${text}`);
  }
  return;
}
import { Vercel } from '@vercel/sdk';

export type TeamCtx = { teamId?: string; slug?: string };

export function getVercelClient(): Vercel {
  const token = process.env.TRACKER_ADMIN_TOKEN || '';
  if (!token) {
    throw new Error('TRACKER_ADMIN_TOKEN is not set');
  }
  return new Vercel({ bearerToken: token });
}

export function inferRecordType(inputType: string | undefined | null, value: string): 'A' | 'AAAA' | 'CNAME' {
  const t = (inputType || '').toUpperCase();
  if (t === 'A' || t === 'AAAA' || t === 'CNAME') return t as any;
  // crude heuristic: IPv6 contains ':'
  return value.includes(':') ? 'AAAA' : 'A';
}

export function normalizeRecordName(name: string, domain: string): string {
  const n = (name || '').trim().replace(/\.$/, '');
  const d = (domain || '').trim().replace(/\.$/, '');
  if (!n) return '';
  // If name already ends with the domain, strip it to label
  const lowerN = n.toLowerCase();
  const lowerD = d.toLowerCase();
  if (lowerN === lowerD) return '@';
  if (lowerN.endsWith('.' + lowerD)) {
    return n.slice(0, n.length - (lowerD.length + 1));
  }
  return n;
}

export async function listRecords(domain: string, ctx?: TeamCtx): Promise<any[]> {
  const token = process.env.TRACKER_ADMIN_TOKEN || '';
  const qs = new URLSearchParams();
  if (ctx?.teamId) qs.set('teamId', ctx.teamId);
  if (ctx?.slug) qs.set('slug', ctx.slug);
  const url = `https://api.vercel.com/v4/domains/${encodeURIComponent(domain)}/records?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Vercel listRecords failed: HTTP ${res.status}`);
  }
  const json = await res.json();
  return Array.isArray(json.records) ? json.records : [];
}

export async function createRecord(domain: string, data: { name: string; value: string; type: string; ttl?: number; comment?: string }, ctx?: TeamCtx): Promise<any> {
  const token = process.env.TRACKER_ADMIN_TOKEN || '';
  const qs = new URLSearchParams();
  if (ctx?.teamId) qs.set('teamId', ctx.teamId);
  if (ctx?.slug) qs.set('slug', ctx.slug);
  const url = `https://api.vercel.com/v2/domains/${encodeURIComponent(domain)}/records?${qs.toString()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: data.name, value: data.value, type: data.type, ttl: data.ttl ?? 60, comment: data.comment }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel createRecord failed: HTTP ${res.status} ${text}`);
  }
  return res.json();
}

export async function updateRecord(domain: string, recordId: string, data: { name?: string; value?: string; type?: string; ttl?: number; comment?: string }, ctx?: TeamCtx): Promise<any> {
  const token = process.env.TRACKER_ADMIN_TOKEN || '';
  const qs = new URLSearchParams();
  if (ctx?.teamId) qs.set('teamId', ctx.teamId);
  if (ctx?.slug) qs.set('slug', ctx.slug);
  const url = `https://api.vercel.com/v2/domains/${encodeURIComponent(domain)}/records/${encodeURIComponent(recordId)}?${qs.toString()}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel updateRecord failed: HTTP ${res.status} ${text}`);
  }
  return res.json();
}

export async function deleteRecord(domain: string, recordId: string, ctx?: TeamCtx): Promise<void> {
  const token = process.env.TRACKER_ADMIN_TOKEN || '';
  const qs = new URLSearchParams();
  if (ctx?.teamId) qs.set('teamId', ctx.teamId);
  if (ctx?.slug) qs.set('slug', ctx.slug);
  const url = `https://api.vercel.com/v2/domains/${encodeURIComponent(domain)}/records/${encodeURIComponent(recordId)}?${qs.toString()}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel deleteRecord failed: HTTP ${res.status} ${text}`);
  }
  return;
}
