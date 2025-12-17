import NativeThemedStyler from './specs/NativeThemedStyler'

type UsageSnapshot = { selectors: string[]; classes: string[] }
type ThemesState = { themes: Record<string, any>; currentTheme?: string | null }

const themedStylerModule = NativeThemedStyler

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value ?? {})
    } catch (err) {
        console.warn('[nativeThemedStyler] Failed to serialize payload', err)
        return '{}'
    }
}

const baseThemesPayload = { themes: {}, currentTheme: null }

export async function initNativeThemedStyler(): Promise<void> {
    const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : {}
    if (g.__themedStylerRenderCss && g.__themedStylerGetRn) {
        return
        console.log('[nativeThemedStyler] Module check:', {
            hasModule: !!themedStylerModule,
            type: typeof themedStylerModule,
            hasGetVersion: typeof themedStylerModule?.getVersion,
            hasRenderCss: typeof themedStylerModule?.renderCss,
            hasGetRnStyles: typeof themedStylerModule?.getRnStyles,
            hasGetDefaultState: typeof themedStylerModule?.getDefaultState,
        })
    }
    if (!themedStylerModule) {
        console.warn('[nativeThemedStyler] Native themed-styler module not linked')
        return
    }

    if (typeof themedStylerModule.getVersion === 'function') {
        try {
            const version = themedStylerModule.getVersion()
            g.__themedStyler_version = version
        } catch (e) {
            console.warn('[nativeThemedStyler] Failed to read version', e)
        }
    }

    g.__themedStylerRenderCss = (usageSnapshot: UsageSnapshot, themesState: ThemesState) => {
        try {
            const usageJson = safeStringify(usageSnapshot ?? { selectors: [], classes: [] })
            const themesJson = safeStringify(themesState ?? baseThemesPayload)
            return themedStylerModule.renderCss(usageJson, themesJson)
        } catch (err) {
            console.warn('[nativeThemedStyler] renderCss failed', err)
            return ''
        }
    }

    g.__themedStylerGetRn = (selector: string, classes: string[], themesState: ThemesState) => {
        try {
            const classesJson = safeStringify(classes ?? [])
            const themesJson = safeStringify(themesState ?? baseThemesPayload)
            const raw = themedStylerModule.getRnStyles(selector, classesJson, themesJson)
            return raw ? JSON.parse(raw) : {}
        } catch (err) {
            console.warn('[nativeThemedStyler] getRnStyles failed', err)
            return {}
        }
    }

    if (typeof themedStylerModule.getDefaultState === 'function') {
        g.__themedStylerGetDefaultState = () => {
            try {
                return themedStylerModule.getDefaultState?.() ?? '{}'
            } catch (err) {
                console.warn('[nativeThemedStyler] getDefaultState failed', err)
                return '{}'
            }
        }
    }
}
