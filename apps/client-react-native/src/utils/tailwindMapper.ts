import { ThemeManager } from './themeManager'
import { tailwindClassMap } from '../generated/tailwindClassMap.generated.js'

type ThemeDefinition = Record<string, { web?: Record<string, unknown>; native?: Record<string, unknown> }>
const runtimeThemeOverrides: Record<string, Record<string, { native?: Record<string, unknown> }>> = {}

function hasTheme(name?: string) {
    return !!name && (name in tailwindClassMap.themes || name in runtimeThemeOverrides)
}

function resolveThemeName(explicit?: string): string {
    if (explicit && hasTheme(explicit)) return explicit
    const runtime = ThemeManager.getTheme?.()
    if (runtime && hasTheme(runtime)) return runtime
    return tailwindClassMap.defaultTheme
}

export function tailwindToStyle(className?: string, themeOverride?: string) {
    if (!className || typeof className !== 'string') return undefined
    const tokens = className.trim().split(/\s+/).filter(Boolean)
    if (!tokens.length) return undefined
    const themeName = resolveThemeName(themeOverride)
    const themeStyles = {
        ...(tailwindClassMap.themes[themeName] || {}),
        ...(runtimeThemeOverrides[themeName] || {}),
    }
    const fragments = [] as Array<Record<string, unknown>>
    for (const token of tokens) {
        const baseEntry = tailwindClassMap.base[token]
        if (baseEntry?.native) fragments.push(baseEntry.native)
        const override = themeStyles[token]
        if (override?.native) fragments.push(override.native)
    }
    if (!fragments.length) return undefined
    const result = Object.assign({}, ...fragments)
    // Debug: log the mapping for visibility when running Metro / device logs
    try {
        // eslint-disable-next-line no-console
        console.debug('[tailwindToStyle] tokens=', tokens, '=>', result)
    } catch (e) {
        // ignore logging issues in environments that block console
    }
    return result
}

export const getTailwindClassMap = () => tailwindClassMap

export function registerThemeStyles(themeName: string, definitions?: ThemeDefinition) {
    if (!themeName || !definitions) return
    const normalized: Record<string, { native?: Record<string, unknown> }> = {}
    for (const [className, definition] of Object.entries(definitions)) {
        const nativeStyle = definition?.native || definition?.web
        if (!nativeStyle || typeof nativeStyle !== 'object') continue
        normalized[className] = { native: nativeStyle }
    }
    if (!Object.keys(normalized).length) return
    runtimeThemeOverrides[themeName] = {
        ...(runtimeThemeOverrides[themeName] || {}),
        ...normalized,
    }
}