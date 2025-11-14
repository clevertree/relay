#!/usr/bin/env node
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const repoRoot = path.resolve(new URL(import.meta.url).pathname, '..', '..', '..')
const src = path.join(repoRoot, 'media', 'icon-transparent.png')
const outDir = path.join(repoRoot, 'src-tauri', 'icons')

if (!fs.existsSync(src)) {
  console.error('Source icon not found:', src)
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })

// Try tauri CLI `tauri icon --input <in> --output <outdir>`
console.log('Trying tauri CLI to generate icons...')
let r = spawnSync('tauri', ['icon', '--input', src, '--output', outDir], { stdio: 'inherit' })
if (r.status === 0) {
  console.log('Icons generated with tauri CLI ->', outDir)
  process.exit(0)
}

console.log('tauri CLI not available or failed, falling back to macOS sips for resizing')
// Fallback small script using macOS `sips` to resize PNGs
const sizes = [32, 128]
for (const s of sizes) {
  const dst = path.join(outDir, `${s}x${s}.png`)
  const res = spawnSync('sips', ['-Z', `${s}`, src, '--out', dst], { stdio: 'inherit' })
  if (res.status !== 0) {
    console.error('Failed to generate', dst)
    process.exit(1)
  }
}

// Create an ICO using sips + iconutil where possible (macOS); otherwise leave PNGs.
try {
  const iconsetDir = path.join(outDir, 'icon.iconset')
  fs.mkdirSync(iconsetDir, { recursive: true })
  // sips requires @2x images; create 128 and 256 sizes for iconutil
  spawnSync('sips', ['-z', '256', '256', src, '--out', path.join(iconsetDir, 'icon_128x128@2x.png')], { stdio: 'inherit' })
  spawnSync('sips', ['-z', '128', '128', src, '--out', path.join(iconsetDir, 'icon_128x128.png')], { stdio: 'inherit' })
  // Convert iconset to .icns
  spawnSync('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(outDir, 'icon.icns')], { stdio: 'inherit' })
} catch (e) {
  // ignore failures; we still have PNGs
}

console.log('Fallback icons generated under', outDir)
