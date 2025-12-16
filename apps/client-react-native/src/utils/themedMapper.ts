import { registerTheme as registerThemedStyles } from '../../../../apps/shared/src/themedStylerBridge'

export function registerThemeStyles(themeName: string, definitions?: Record<string, any>) {
    if (!themeName || !definitions) return
    try { registerThemedStyles(themeName, definitions) } catch (e) { }
}

export function setThemedStylerDebug(enabled: boolean) {
    try { (global as any).__THEMED_STYLER_DEBUG__ = !!enabled } catch (e) { }
}
