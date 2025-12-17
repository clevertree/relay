import type { TurboModule } from 'react-native'
import { TurboModuleRegistry, NativeModules } from 'react-native'

export interface Spec extends TurboModule {
    transpile(code: string, filename: string): Promise<string>
    getVersion(): string
    initialize(): Promise<void>
}

export default TurboModuleRegistry.get<Spec>('RustTranspiler') ?? NativeModules.RustTranspiler
