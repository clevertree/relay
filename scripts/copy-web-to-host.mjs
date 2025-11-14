#!/usr/bin/env node
import { cp, rm, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'apps', 'web', 'out');
const hostStatic = path.join(projectRoot, 'host', 'static');

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function main() {
  if (!await exists(outDir)) {
    console.error(`[copy-web-to-host] Not found: ${outDir}. Run \"npm run web:export\" first.`);
    process.exit(1);
  }
  await rm(hostStatic, { recursive: true, force: true }).catch(() => {});
  await mkdir(hostStatic, { recursive: true });
  await cp(outDir + path.sep, hostStatic + path.sep, { recursive: true });
  console.log(`[copy-web-to-host] Copied ${outDir} -> ${hostStatic}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
