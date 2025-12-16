/**
 * Simplified themed-styler DebugTab
 */
import React, { useState } from 'react'
import {
  ScrollView as ThemedScrollView,
  Text as ThemedText,
  TouchableOpacity as ThemedTouchableOpacity,
  View as ThemedView,
  TextInput as ThemedTextInput,
} from '../themedPrimitives'
import HookRenderer from './HookRenderer'
import { useRNTranspilerSetting } from '../state/transpilerSettings'
import { styled } from '../themedRuntime'

const ThemedRuntimeTest: React.FC = () => (
  <ThemedView className="mb-3">
    <ThemedView className="mb-2">
      <ThemedText className="font-bold mb-1">Runtime diagnostics</ThemedText>
      <ThemedText className="text-xs text-gray-600">Styled helper present: {String(typeof styled === 'function')}</ThemedText>
    </ThemedView>
    <ThemedText className="font-semibold mb-2">ClassName test</ThemedText>
    <ThemedView className="p-2 rounded border">
      <ThemedText className="text-base font-bold">This should be styled via className</ThemedText>
    </ThemedView>
    <ThemedView className="h-2" />
    <ThemedView className="p-2 rounded border">
      <ThemedText className="text-base font-semibold">Inline style counterpart</ThemedText>
    </ThemedView>
    <ThemedView className="h-3" />
    <ThemedText className="font-semibold mb-2">Flex row test</ThemedText>
    <ThemedView className="rounded overflow-hidden border">
      <ThemedView className="flex-row h-12">
        <ThemedView className="flex-1 p-2" style={{ backgroundColor: '#fde68a', borderRightWidth: 1, borderRightColor: '#fbbf24' }}>
          <ThemedText className="text-base">Left</ThemedText>
        </ThemedView>
        <ThemedView className="flex-1 p-2" style={{ backgroundColor: '#d1fae5', borderRightWidth: 1, borderRightColor: '#34d399' }}>
          <ThemedText className="text-base">Center</ThemedText>
        </ThemedView>
        <ThemedView className="flex-1 p-2" style={{ backgroundColor: '#bfdbfe' }}>
          <ThemedText className="text-base">Right</ThemedText>
        </ThemedView>
      </ThemedView>
    </ThemedView>
  </ThemedView>
)

const DebugTab: React.FC = () => {
  const mode = useRNTranspilerSetting((s) => s.mode)
  const setMode = useRNTranspilerSetting((s) => s.setMode)
  const [host, setHost] = useState<string>('https://node-dfw1.relaynet.online')

  return (
    <ThemedScrollView className="flex-1" style={{ backgroundColor: '#f5f5f5' }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      {/* Settings: switch transpiler mode (client/server) */}
      <ThemedView className="mb-6 bg-white rounded p-4" style={{ shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 }}>
        <ThemedText className="text-base font-bold mb-3" style={{ color: '#333' }}>⚙️ Transpiler Settings</ThemedText>
        <ThemedText className="text-sm" style={{ color: '#333', lineHeight: 18 }}>Choose which transpiler path to use in React Native.</ThemedText>
        <ThemedView className="flex-row mt-3" style={{ columnGap: 12 }}>
          <ThemedTouchableOpacity className={`px-4 py-2 rounded my-2 ${mode === 'client' ? 'bg-primary' : 'bg-gray-300'}`} onPress={() => setMode('client')}>
            <ThemedText className="text-white text-sm font-semibold">Client (default)</ThemedText>
          </ThemedTouchableOpacity>
          <ThemedTouchableOpacity className={`px-4 py-2 rounded my-2 ${mode === 'server' ? 'bg-primary' : 'bg-gray-300'}`} onPress={() => setMode('server')}>
            <ThemedText className="text-white text-sm font-semibold">Server</ThemedText>
          </ThemedTouchableOpacity>
        </ThemedView>
        <ThemedView className="rounded p-3 mt-3" style={{ backgroundColor: '#f5fff5', borderLeftWidth: 4, borderLeftColor: '#34c759' }}>
          <ThemedText className="text-sm font-mono" style={{ color: '#333' }}>Current mode: {mode}</ThemedText>
        </ThemedView>
      </ThemedView>

      {/* Runtime diagnostics */}
      <ThemedView className="mb-6 bg-white rounded p-4" style={{ shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 }}>
        <ThemedRuntimeTest />
      </ThemedView>

      {/* Shared HookRenderer preview (identical wiring to RepoBrowser) */}
      <ThemedView className="mb-6 bg-white rounded p-4" style={{ shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 }}>
        <ThemedText className="text-base font-bold mb-3" style={{ color: '#333' }}>🔍 Transpiler Preview (Shared HookRenderer)</ThemedText>
        <ThemedText className="text-sm" style={{ color: '#333', lineHeight: 18 }}>
          This uses the same HookRenderer as RepoBrowser, so whatever works here works there.
        </ThemedText>
        <ThemedView className="flex-row items-center mt-2" style={{ columnGap: 8 }}>
          <ThemedText className="text-sm" style={{ color: '#333', marginRight: 8 }}>Host:</ThemedText>
          <ThemedTextInput value={host} onChangeText={setHost} placeholder="https://your-host" className="flex-1 px-2 py-1 rounded" style={{ borderWidth: 1, borderColor: '#ccc' }} autoCapitalize="none" autoCorrect={false} />
        </ThemedView>
        <ThemedView style={{ height: 400, marginTop: 12 }}>
          <HookRenderer host={host} />
        </ThemedView>
      </ThemedView>
    </ThemedScrollView>
  )
}

export default DebugTab
