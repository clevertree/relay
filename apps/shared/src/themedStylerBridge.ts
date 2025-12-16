/**
 * In-memory bridge for themed-styler usage.
 * Collected at runtime by web and RN HookRenderers via shared imports.
 */

type Props = Record<string, any>
type HierNode = { tag: string; classes?: string[] }

const usage = {
  selectors: new Set<string>(),
  classes: new Set<string>(),
}

const themes: Record<string, Record<string, any>> = {}
let currentTheme: string | null = null

export function registerUsage(tag: string, props?: Props, hierarchy?: HierNode[]) {
  // Always record the bare tag selector for this wrapped element
  if (tag) usage.selectors.add(tag)

  const cls = props ? ((props.className || props.class || '') as string) : ''
  const classes = typeof cls === 'string' && cls.trim().length
    ? cls.split(/\s+/).map((c) => c.trim()).filter(Boolean)
    : []

  for (const c of classes) {
    usage.classes.add(c)
    usage.selectors.add(`.${c}`)
    usage.selectors.add(`${tag}.${c}`)
  }

  // If a hierarchy is provided, register descendant selectors like "div div" and
  // their variants with current classes (no direct-child selectors).
  if (Array.isArray(hierarchy) && hierarchy.length > 0) {
    // Expect hierarchy to include the current node as the last item; ancestors are before it.
    const ancestors = hierarchy.slice(0, Math.max(0, hierarchy.length - 1))
    if (ancestors.length) {
      const chainTags = ancestors.map(n => (n?.tag || '').trim()).filter(Boolean).join(' ')
      if (chainTags) {
        // tag chain ending in current tag
        usage.selectors.add(`${chainTags} ${tag}`)
        // variants using current classes
        for (const c of classes) {
          usage.selectors.add(`${chainTags} .${c}`)
          usage.selectors.add(`${chainTags} ${tag}.${c}`)
        }
      }
    }
  }
}

export function clearUsage() {
  usage.selectors.clear()
  usage.classes.clear()
}

export function getUsageSnapshot() {
  return {
    selectors: Array.from(usage.selectors.values()),
    classes: Array.from(usage.classes.values()),
  }
}

export function registerTheme(name: string, defs?: Record<string, any>) {
  themes[name] = defs || {}
  if (!currentTheme) currentTheme = name
}

export function setCurrentTheme(name: string) {
  currentTheme = name
}

export function getThemes() { return { themes: { ...themes }, currentTheme } }

// Attempt to populate themes from the WASM bundled defaults if no themes registered yet.
let _defaults_loaded = false
export async function ensureDefaultsLoaded(): Promise<void> {
  if (_defaults_loaded) return
  _defaults_loaded = true
  try {
    const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : {}
    // If wasm runtime exposes a render/get default helper globally prefixed, use it.
    if (typeof g.__themedStylerGetDefaultState === 'function') {
      const json = String(g.__themedStylerGetDefaultState())
      const parsed = JSON.parse(json || '{}')
      if (parsed && parsed.themes) {
        for (const [k, v] of Object.entries(parsed.themes)) {
          registerTheme(k, v as any)
        }
        if (parsed.current_theme) setCurrentTheme(parsed.current_theme)
        return
      }
    }

    // Otherwise try importing the wasm-bindgen module and calling the exported helper
    try {
      // Import the generated shim that init the wasm and exports the functions
      // @ts-ignore
      const shim = await import('/src/wasm/themed_styler.js')
      // Ensure the wasm binary is initialized if the shim exposes default init
      if (shim && typeof (shim as any).default === 'function') {
        try { await (shim as any).default() } catch (e) { /* ignore if already initialized */ }
      }
      // The wasm-bindgen glue exports `get_default_state_json`
      // @ts-ignore
      const wasmModule = await import('/src/wasm/themed_styler_bg.js')
      if (wasmModule && typeof (wasmModule as any).get_default_state_json === 'function') {
        try {
          const json = String((wasmModule as any).get_default_state_json())
          const parsed = JSON.parse(json || '{}')
          if (parsed && parsed.themes) {
            for (const [k, v] of Object.entries(parsed.themes)) {
              registerTheme(k, v as any)
            }
            if (parsed.current_theme) setCurrentTheme(parsed.current_theme)
            return
          }
        } catch (e) {
          // continue
        }
      }
    } catch (e) {
      // ignore import failures; defaults may be provided by other means
    }
  } catch (e) {
    // swallow errors; defaults are optional
  }
}

// Placeholder: in future this should call into the themed-styler binary or runtime
export function getCssForWeb(): string {
  // If platform provides a hook, call it
  const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : {}
  if (typeof g.__themedStylerRenderCss === 'function') {
    try { return g.__themedStylerRenderCss(getUsageSnapshot(), getThemes()) } catch (e) {}
  }
  // If running under Node, attempt to call the hook-transpiler CLI to compute CSS
  if ((globalThis as any) && (globalThis as any).process && (globalThis as any).process.versions && (globalThis as any).process.versions.node) {
    try {
      // Use temp file for state JSON
  const _req: any = (globalThis as any).require ? (globalThis as any).require : (eval('require') as any)
  const fs = _req('fs')
  const os = _req('os')
  const cp = _req('child_process')
  const path = _req('path')
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'themed-styler-'))
      const statePath = path.join(tmp, 'state.json')
      fs.writeFileSync(statePath, JSON.stringify({ themes: getThemes().themes, default_theme: getThemes().currentTheme, current_theme: getThemes().currentTheme, variables: {}, breakpoints: {}, used_selectors: getUsageSnapshot().selectors, used_classes: getUsageSnapshot().classes }, null, 2))
      // Run cargo run -p hook-transpiler -- style css --file <statePath>
      const repoRoot = path.resolve(((globalThis as any).process && (globalThis as any).process.cwd && (globalThis as any).process.cwd()) || '.')
      const out = cp.execFileSync('cargo', ['run', '--silent', '-p', 'hook-transpiler', '--', 'style', 'css', '--file', statePath], { cwd: repoRoot, encoding: 'utf8' })
      try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
      return String(out || '')
    } catch (e) {
      // swallow and fallback to placeholder
    }
  }

  const classes = Array.from(new Set(getUsageSnapshot().classes))
  const selectors = Array.from(new Set(getUsageSnapshot().selectors))
  return `/* themed-styler fallback (no renderer):\nclasses=${JSON.stringify(classes)}\nselectors=${JSON.stringify(selectors)}\n*/`
}

// RN accessor: placeholder returns empty style object. Later will query real runtime state.
export function getRnStyles(selector: string, classes: string[] = []) {
  // Attempt to call a provided hook if present
  const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : {}
  if (typeof g.__themedStylerGetRn === 'function') {
    try { return g.__themedStylerGetRn(selector, classes) } catch (e) {}
  }
  return {}
}

export default {
  registerUsage,
  clearUsage,
  getUsageSnapshot,
  registerTheme,
  setCurrentTheme,
  getThemes,
  getCssForWeb,
  getRnStyles,
}
