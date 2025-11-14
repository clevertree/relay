// Copy Next.js static export (apps/web/out) into host/static
// Cross-platform Node.js script
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const outDir = path.join(repoRoot, 'apps', 'web', 'out');
const destDir = path.join(repoRoot, 'host', 'static');

function rmrf(p) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}

function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dst, entry));
    }
  } else {
    fs.copyFileSync(src, dst);
  }
}

if (!fs.existsSync(outDir)) {
  console.error(`[copy-web-to-host] Missing export directory: ${outDir}. Run: pnpm run web:export`);
  process.exit(1);
}

console.log(`[copy-web-to-host] Copying ${outDir} -> ${destDir}`);
rmrf(destDir);
fs.mkdirSync(destDir, { recursive: true });
copyRecursive(outDir, destDir);
console.log('[copy-web-to-host] Done. You can now run: relay host start --root ./host');
