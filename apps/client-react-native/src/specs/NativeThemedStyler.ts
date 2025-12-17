import type { TurboModule } from 'react-native'
import { TurboModuleRegistry, NativeModules } from 'react-native'
console.log('[NativeThemedStyler] Available NativeModules:', Object.keys(NativeModules))
console.log('[NativeThemedStyler] Has ThemedStyler in NativeModules?', !!NativeModules.ThemedStyler)
console.log('[NativeThemedStyler] TurboModule result:', TurboModuleRegistry.get<Spec>('ThemedStyler'))


export interface Spec extends TurboModule {
    renderCss(usageJson: string, themesJson: string): string
    getRnStyles(selector: string, classesJson: string, themesJson: string): string
    getDefaultState(): string
    getVersion(): string
}

export default TurboModuleRegistry.get<Spec>('ThemedStyler') ?? NativeModules.ThemedStyler
