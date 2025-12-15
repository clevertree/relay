/**
 * Simplified Tailwind-based DebugTab
 */
import React, { useCallback, useState } from 'react'
import {
  ScrollView as TailwindScrollView,
  Text as TailwindText,
  TouchableOpacity as TailwindTouchableOpacity,
  View as TailwindView,
  TextInput as TailwindTextInput,
} from '../tailwindPrimitives'
import HookRenderer from './HookRenderer'
import { useRNTranspilerSetting } from '../state/transpilerSettings'
import { styled } from '../tailwindRuntime'

type TestResult = {
  status: 'pending' | 'success' | 'error'
  message: string
  details?: string
}

const TailwindRuntimeTest: React.FC = () => (
  <TailwindView className="mb-3">
    <TailwindView className="mb-2">
      <TailwindText className="font-bold mb-1">Tailwind runtime diagnostics</TailwindText>
      <TailwindText className="text-xs text-gray-600">Styled helper present: {String(typeof styled === 'function')}</TailwindText>
    </TailwindView>
    <TailwindText className="font-semibold mb-2">Tailwind runtime className test</TailwindText>
    <TailwindView className="p-2 rounded border border-gray-300">
      <TailwindText className="text-base font-bold">This should be styled via className</TailwindText>
    </TailwindView>
    <TailwindView className="h-2" />
    <TailwindView className="p-2 rounded border border-gray-300">
      <TailwindText className="text-base font-semibold">Inline style counterpart</TailwindText>
    </TailwindView>
    <TailwindView className="h-3" />
    <TailwindText className="font-semibold mb-2">Flex row test</TailwindText>
    <TailwindView className="rounded overflow-hidden border border-gray-200">
      <TailwindView className="flex-row h-12">
        <TailwindView className="flex-1 p-2" style={{ backgroundColor: '#fde68a', borderRightWidth: 1, borderRightColor: '#fbbf24' }}>
          <TailwindText className="text-base">Left</TailwindText>
        </TailwindView>
        <TailwindView className="flex-1 p-2" style={{ backgroundColor: '#d1fae5', borderRightWidth: 1, borderRightColor: '#34d399' }}>
          <TailwindText className="text-base">Center</TailwindText>
        </TailwindView>
        <TailwindView className="flex-1 p-2" style={{ backgroundColor: '#bfdbfe' }}>
          <TailwindText className="text-base">Right</TailwindText>
        </TailwindView>
      </TailwindView>
    </TailwindView>
  </TailwindView>
)

const DebugTab: React.FC = () => {
  const [results, setResults] = useState<Record<string, TestResult>>({})
  const [loading, setLoading] = useState<string | null>(null)
  const mode = useRNTranspilerSetting((s) => s.mode)
  const setMode = useRNTranspilerSetting((s) => s.setMode)
  const [host, setHost] = useState<string>('https://node-dfw1.relaynet.online')

  const updateResult = (testName: string, result: TestResult) => {
    setResults((prev) => ({ ...prev, [testName]: result }))
  }

  const TestResult: React.FC<{ testName: string; result: TestResult }> = ({ result }) => {
    const isSuccess = result.status === 'success'
    const isError = result.status === 'error'
    return (
      <TailwindView className="rounded p-3 mt-3" style={{ backgroundColor: isError ? '#fff5f5' : isSuccess ? '#f5fff5' : '#f9f9f9', borderLeftWidth: 4, borderLeftColor: isError ? '#ff3b30' : isSuccess ? '#34c759' : '#007AFF' }}>
        <TailwindText className="text-sm font-semibold mb-1" style={{ color: '#333', lineHeight: 18 }}>
          {result.message}
        </TailwindText>
        {result.details && (
          <TailwindText className="text-sm font-mono" style={{ color: '#333', lineHeight: 18 }}>
            {result.details}
          </TailwindText>
        )}
      </TailwindView>
    )
  }

  return (
    <TailwindScrollView className="flex-1" style={{ backgroundColor: '#f5f5f5' }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      {/* Settings: switch transpiler mode (client/server) */}
      <TailwindView className="mb-6 bg-white rounded p-4" style={{ shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 }}>
        <TailwindText className="text-base font-bold mb-3" style={{ color: '#333' }}>⚙️ Transpiler Settings</TailwindText>
        <TailwindText className="text-sm" style={{ color: '#333', lineHeight: 18 }}>Choose which transpiler path to use in React Native.</TailwindText>
        <TailwindView className="flex-row mt-3" style={{ columnGap: 12 }}>
          <TailwindTouchableOpacity className={`px-4 py-2 rounded my-2 ${mode === 'client' ? 'bg-primary' : 'bg-gray-300'}`} onPress={() => setMode('client')}>
            <TailwindText className="text-white text-sm font-semibold">Client (default)</TailwindText>
          </TailwindTouchableOpacity>
          <TailwindTouchableOpacity className={`px-4 py-2 rounded my-2 ${mode === 'server' ? 'bg-primary' : 'bg-gray-300'}`} onPress={() => setMode('server')}>
            <TailwindText className="text-white text-sm font-semibold">Server</TailwindText>
          </TailwindTouchableOpacity>
        </TailwindView>
        <TailwindView className="rounded p-3 mt-3" style={{ backgroundColor: '#f5fff5', borderLeftWidth: 4, borderLeftColor: '#34c759' }}>
          <TailwindText className="text-sm font-mono" style={{ color: '#333' }}>Current mode: {mode}</TailwindText>
        </TailwindView>
      </TailwindView>

      {/* NativeWind runtime test (quick visual compare) */}
      <TailwindView className="mb-6 bg-white rounded p-4" style={{ shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 }}>
        <TailwindRuntimeTest />
      </TailwindView>

      {/* Shared HookRenderer preview (identical wiring to RepoBrowser) */}
      <TailwindView className="mb-6 bg-white rounded p-4" style={{ shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 }}>
        <TailwindText className="text-base font-bold mb-3" style={{ color: '#333' }}>🔍 Transpiler Preview (Shared HookRenderer)</TailwindText>
        <TailwindText className="text-sm" style={{ color: '#333', lineHeight: 18 }}>
          This uses the same HookRenderer as RepoBrowser, so whatever works here works there.
        </TailwindText>
        <TailwindView className="flex-row items-center mt-2" style={{ columnGap: 8 }}>
          <TailwindText className="text-sm" style={{ color: '#333', marginRight: 8 }}>Host:</TailwindText>
          <TailwindTextInput value={host} onChangeText={setHost} placeholder="https://your-host" className="flex-1 px-2 py-1 rounded" style={{ borderWidth: 1, borderColor: '#ccc' }} autoCapitalize="none" autoCorrect={false} />
        </TailwindView>
        <TailwindView style={{ height: 400, marginTop: 12 }}>
          <HookRenderer host={host} />
        </TailwindView>
      </TailwindView>
    </TailwindScrollView>
  )
}

export default DebugTab
