"use client";
import React, { useState } from 'react';

export default function TrackerToolsClient() {
  const [domain, setDomain] = useState('relaynet.online');
  const [name, setName] = useState('node1');
  const [ipv4, setIpv4] = useState('');
  const [ipv6, setIpv6] = useState('');
  const [ttl, setTtl] = useState('3600');
  const [type, setType] = useState<'A' | 'AAAA' | 'CNAME' | ''>('');
  const [result, setResult] = useState<string>('');
  const [rawBody, setRawBody] = useState('');

  async function doUpsert(e: React.FormEvent) {
    e.preventDefault();
    setResult('');
    const body: any = { domain, name, ttl: Number(ttl) };
    if (ipv4) body.ipv4 = ipv4;
    if (ipv6) body.ipv6 = ipv6;
    if (type) body.type = type;
    try {
      const res = await fetch('/api/dns/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      setResult(`HTTP ${res.status}\n${text}`);
    } catch (err: any) {
      setResult(String(err));
    }
  }

  async function doRaw(e: React.FormEvent) {
    e.preventDefault();
    setResult('');
    try {
      const res = await fetch('/api/dns/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody,
      });
      const text = await res.text();
      setResult(`HTTP ${res.status}\n${text}`);
    } catch (err: any) {
      setResult(String(err));
    }
  }

  async function lookupIPv4() {
    setResult('Looking up external IPv4...');
    try {
      const r = await fetch('https://api.ipify.org?format=json');
      const j = await r.json();
      setIpv4(j.ip || '');
      setResult(`Found IPv4: ${j.ip}`);
    } catch (e: any) {
      setResult(String(e));
    }
  }

  async function lookupIPv6() {
    setResult('Looking up external IPv6...');
    try {
      const r = await fetch('https://api64.ipify.org?format=json');
      const j = await r.json();
      setIpv6(j.ip || '');
      setResult(`Found IPv6: ${j.ip}`);
    } catch (e: any) {
      setResult(String(e));
    }
  }

  return (
    <div style={{ border: '1px solid #ddd', padding: 12, borderRadius: 6, maxWidth: 900 }}>
      <form onSubmit={doUpsert} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 220 }}>
          <div style={{ fontSize: 12, color: '#444', marginBottom: 6 }}>Domain</div>
          <input value={domain} onChange={(e) => setDomain(e.target.value)} style={{ width: '100%', padding: 8 }} />
        </div>
        <div style={{ minWidth: 180 }}>
          <div style={{ fontSize: 12, color: '#444', marginBottom: 6 }}>Name</div>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', padding: 8 }} />
        </div>
        <div style={{ minWidth: 180 }}>
          <div style={{ fontSize: 12, color: '#444', marginBottom: 6 }}>IPv4</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={ipv4} onChange={(e) => setIpv4(e.target.value)} style={{ flex: 1, padding: 8 }} />
            <button type="button" onClick={lookupIPv4} style={{ padding: '8px 10px' }}>
              Use my IPv4
            </button>
          </div>
        </div>
        <div style={{ minWidth: 220 }}>
          <div style={{ fontSize: 12, color: '#444', marginBottom: 6 }}>IPv6</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={ipv6} onChange={(e) => setIpv6(e.target.value)} style={{ flex: 1, padding: 8 }} />
            <button type="button" onClick={lookupIPv6} style={{ padding: '8px 10px' }}>
              Use my IPv6
            </button>
          </div>
        </div>

        <div style={{ minWidth: 120 }}>
          <div style={{ fontSize: 12, color: '#444', marginBottom: 6 }}>TTL</div>
          <input value={ttl} onChange={(e) => setTtl(e.target.value)} style={{ width: '100%', padding: 8 }} />
        </div>

        <div style={{ minWidth: 160 }}>
          <div style={{ fontSize: 12, color: '#444', marginBottom: 6 }}>Type (optional)</div>
          <select value={type} onChange={(e) => setType(e.target.value as any)} style={{ width: '100%', padding: 8 }}>
            <option value="">(auto)</option>
            <option value="A">A</option>
            <option value="AAAA">AAAA</option>
            <option value="CNAME">CNAME</option>
          </select>
        </div>

        <div style={{ alignSelf: 'end' }}>
          <button type="submit" style={{ padding: '8px 12px' }}>
            Upsert DNS
          </button>
        </div>
      </form>

      <hr style={{ margin: '16px 0' }} />

      <form onSubmit={doRaw}>
        <div style={{ fontSize: 12, color: '#444', marginBottom: 6 }}>Raw JSON body</div>
        <textarea value={rawBody} onChange={(e) => setRawBody(e.target.value)} rows={6} style={{ width: '100%', padding: 8 }} placeholder='{"domain":"relaynet.online","name":"node1","ipv4":"1.2.3.4"}' />
        <div style={{ marginTop: 8 }}>
          <button type="submit" style={{ padding: '8px 12px' }}>
            Send raw
          </button>
        </div>
      </form>

      <hr style={{ margin: '16px 0' }} />

      <div>
        <div style={{ fontSize: 12, color: '#444', marginBottom: 6 }}>Result</div>
        <pre style={{ background: '#111', color: '#eee', padding: 12, borderRadius: 6, maxHeight: 300, overflow: 'auto' }}>{result}</pre>
      </div>
    </div>
  );
}
