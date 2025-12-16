#!/usr/bin/env node
// Read crates/themed-styler/theme.yaml, convert to JSON and write to apps/client-web/src/wasm/themed_styler_default.json
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

const repoRoot = path.resolve(__dirname, '..')
const themeYaml = path.join(repoRoot, 'crates', 'themed-styler', 'theme.yaml')
const outDir = path.join(repoRoot, 'apps', 'client-web', 'src', 'wasm')
const outFile = path.join(outDir, 'themed_styler_default.json')

try {
  const raw = fs.readFileSync(themeYaml, 'utf8')
  const doc = yaml.load(raw)
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(doc || {}, null, 2), 'utf8')
  console.log('[embed-theme] wrote', outFile)
} catch (e) {
  console.error('[embed-theme] failed to embed theme.yaml:', e && e.message ? e.message : e)
  process.exitCode = 1
}
