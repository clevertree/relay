#!/usr/bin/env node
// E2E script: IPFS fallback and caching
// 1) Request /media/screen.png from relay server. The file is expected to be available via the
//    IPFS root hash referenced in relay.yaml for the repo, but not in the Git checkout. The relay
//    server should fetch it via IPFS and serve within the server timeout.
// 2) Request the same file again to ensure it's served from the relay's local cache.

import fs from 'fs';
import path from 'path';

const RELAY_BASE = process.env.RELAY_BASE || 'http://localhost:3000';
const PATH = '/media/screen.png';
const OUT_DIR = './tmp/e2e-ipfs-fallback';

function timeoutSignal(ms) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, clear: () => clearTimeout(id) };
}

async function fetchToFile(url, outPath, msTimeout) {
  const { signal, clear } = timeoutSignal(msTimeout);
  try {
    const res = await fetch(url, { signal });
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, buf);
    clear();
    return { status: res.status, length: buf.length };
  } catch (err) {
    clear();
    throw err;
  }
}

async function main() {
  try { await fs.promises.mkdir(OUT_DIR, { recursive: true }); } catch (e) {}
  const url = RELAY_BASE + PATH;

  console.log('E2E: fetching (first try) %s', url);
  try {
    const first = await fetchToFile(url, `${OUT_DIR}/first-response.bin`, 15000);
    console.log('First fetch status=%d length=%d', first.status, first.length);
    if (first.status !== 200) {
      console.error('First fetch failed; expected 200');
      process.exit(2);
    }
  } catch (err) {
    console.error('First fetch error:', err.message || String(err));
    process.exit(3);
  }

  console.log('E2E: fetching (second try) %s', url);
  try {
    const second = await fetchToFile(url, `${OUT_DIR}/second-response.bin`, 5000);
    console.log('Second fetch status=%d length=%d', second.status, second.length);
    if (second.status !== 200) {
      console.error('Second fetch failed; expected 200');
      process.exit(4);
    }
  } catch (err) {
    console.error('Second fetch error:', err.message || String(err));
    process.exit(5);
  }

  console.log('E2E: success. Responses saved to', OUT_DIR);
}

main();
