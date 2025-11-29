#!/usr/bin/env node
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import glob from 'glob';
import yaml from 'js-yaml';

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const workspaceConfig = path.join(workspaceRoot, 'pnpm-workspace.yaml');
let packageGlobs = ['apps/*', 'packages/*'];
try {
  const cfg = fs.readFileSync(workspaceConfig, 'utf8');
  const doc = yaml.load(cfg);
  if (doc && doc.packages) packageGlobs = doc.packages;
} catch (e) {
  // fallback to defaults above
}

let failed = false;

for (const pattern of packageGlobs) {
  const matches = glob.sync(pattern, { cwd: workspaceRoot, absolute: true });
  for (const pkgDir of matches) {
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    if (pkg.scripts && pkg.scripts.test) {
      console.log(`\n==> Running tests in ${pkg.name || pkgDir}`);
      const ps = spawnSync('pnpm', ['-C', pkgDir, 'test'], { stdio: 'inherit' });
      if (ps.status !== 0) failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log('\nAll tests passed (or none found).');
