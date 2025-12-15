import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(scriptDir, '..')
const workspaceRoot = path.resolve(appRoot, '..', '..')
// use requireFromCwd when loading CJS modules from within ESM

const requireFromCwd = createRequire(import.meta.url)
const tailwindConfig = requireFromCwd(path.join(appRoot, 'tailwind.config.js'))
const cssSourcePath = path.join(appRoot, 'src', 'globals.css')
const generatedDir = path.join(appRoot, 'src', 'generated')
const outputPath = path.join(generatedDir, 'tailwindClassMap.generated.js')
const tsOutputPath = path.join(generatedDir, 'tailwindClassMap.generated.ts')

const cssToReactNative = requireFromCwd('css-to-react-native')?.default || requireFromCwd('css-to-react-native')
const SUPPORTED_BORDER_STYLES = new Set(['solid', 'dashed', 'dotted'])
const BORDER_STYLE_HIDE_VALUES = new Set(['none', 'hidden'])

function sanitizeNativeStyle(className, style) {
    if (!style || typeof style !== 'object') return style
    const value = style.borderStyle
    if (typeof value !== 'string') return style
    const normalized = value.trim().toLowerCase()
    if (SUPPORTED_BORDER_STYLES.has(normalized)) {
        style.borderStyle = normalized
        return style
    }
    delete style.borderStyle
    if (BORDER_STYLE_HIDE_VALUES.has(normalized)) {
        if (!('borderWidth' in style)) {
            style.borderWidth = 0
        }
    } else {
        console.warn(`[tailwind-map] dropping unsupported borderStyle "${value}" for ${className}`)
    }
    return style
}

function normalizeClassSelector(selector) {
    if (!selector || !selector.startsWith('.')) return null
    const trimmed = selector.trim()
    if (trimmed.includes(':') || trimmed.includes(' ') || trimmed.includes(',')) {
        return null
    }
    const className = trimmed.slice(1).replace(/\\([:\\/])/g, '$1')
    if (!className) return null
    return className
}

function collectStyleDeclarations(rule) {
    const declarations = []
    rule.walkDecls((decl) => {
        declarations.push([decl.prop, decl.value])
    })
    return declarations
}

async function buildBaseClassMap(css) {
    const root = postcss.parse(css)
    const map = {}
    root.walkRules((rule) => {
        const selectors = rule.selectors?.length ? rule.selectors : [rule.selector]
        for (const selector of selectors) {
            const className = normalizeClassSelector(selector)
            if (!className) continue
            const declarations = collectStyleDeclarations(rule)
            if (!declarations.length) continue
            let nativeStyle
            try {
                nativeStyle = cssToReactNative(declarations)
            } catch (err) {
                console.warn('[tailwind-map] Failed to convert declarations for', className, err.message || err)
                continue
            }
            nativeStyle = sanitizeNativeStyle(className, nativeStyle)
            if (!nativeStyle || Object.keys(nativeStyle).length === 0) continue
            map[className] = { native: nativeStyle }
        }
    })
    return map
}

function sortRecord(value) {
    if (Array.isArray(value)) {
        return value.map(sortRecord)
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, val]) => [key, sortRecord(val)]),
        )
    }
    return value
}
// buildFinalMap removed — we emit a minimal themes object at build time and
// allow runtime `theme.js` to override/augment styles when the app initializes.

async function run() {
    console.log('[tailwind-map] Generating native style map...')
    const cssContent = await fs.readFile(cssSourcePath, 'utf8')
    // restrict content scanning to the two client apps so build-time map only contains
    // classes used by client-web and client-react-native (don't scan template/ or other apps)
    tailwindConfig.content = [
        path.join(appRoot, 'src', '**', '*.{js,ts,tsx,jsx,css,html}'),
        path.join(workspaceRoot, 'apps', 'client-web', 'src', '**', '*.{js,ts,tsx,jsx,css,html}'),
    ]

    const result = await postcss([tailwindcss(tailwindConfig)]).process(cssContent, {
        from: undefined,
    })
    // write raw generated CSS for debugging
    try {
        await fs.writeFile(path.join(generatedDir, 'tailwind.generated.css'), result.css, 'utf8')
        console.log('[tailwind-map] Wrote generated CSS to', path.join(generatedDir, 'tailwind.generated.css'))
    } catch (e) {
        console.warn('[tailwind-map] Failed to write generated CSS', e.message || e)
    }
    const baseMap = await buildBaseClassMap(result.css)
    // Ensure spacing utilities (p-*, px-*, py-*, pt-*, pr-*, pb-*, pl-*) are present
    const spacing = (tailwindConfig.theme && (tailwindConfig.theme.extend?.spacing || tailwindConfig.theme.spacing)) || {}
    for (const [k, v] of Object.entries(spacing)) {
        // v is like '12px' or '0px'
        const num = typeof v === 'string' ? parseFloat(v) : Number(v)
        if (Number.isFinite(num)) {
            const key = String(k)
            const add = (name, obj) => {
                if (!baseMap[name]) baseMap[name] = { native: obj }
            }
            add(`p-${key}`, { padding: num })
            add(`px-${key}`, { paddingLeft: num, paddingRight: num })
            add(`py-${key}`, { paddingTop: num, paddingBottom: num })
            add(`pt-${key}`, { paddingTop: num })
            add(`pr-${key}`, { paddingRight: num })
            add(`pb-${key}`, { paddingBottom: num })
            add(`pl-${key}`, { paddingLeft: num })
        }
    }
    // We do not include runtime template theme overrides at build time.
    // Emit a minimal 'default' theme placeholder so runtime theme manager can
    // supply overrides from the app's own `theme.js` at runtime.
    const themeMap = { default: {} }
    const finalMap = {
        defaultTheme: 'default',
        base: sortRecord(baseMap),
        themes: sortRecord(themeMap),
    }
    const serialized = JSON.stringify(finalMap, null, 2)
    await fs.mkdir(generatedDir, { recursive: true })
    const contents = `const tailwindClassMap = ${serialized}\n\nmodule.exports = { tailwindClassMap }\n`
    await fs.writeFile(outputPath, contents, 'utf8')
    console.log('[tailwind-map] Written', outputPath)
    const tsContents = `export const tailwindClassMap = ${serialized} as const\n`
    await fs.writeFile(tsOutputPath, tsContents, 'utf8')
    console.log('[tailwind-map] Written', tsOutputPath)
}

await run()