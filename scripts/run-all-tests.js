#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..');
const workspaceConfig = path.join(workspaceRoot, 'pnpm-workspace.yaml');
let packageGlobs = ['apps/*', 'packages/*'];
try {
  const yaml = require('js-yaml');
  const cfg = fs.readFileSync(workspaceConfig, 'utf8');
  const doc = yaml.load(cfg);
  if (doc && doc.packages) packageGlobs = doc.packages;
} catch (e) {
  // fallback to defaults above
}

const glob = require('glob');

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
