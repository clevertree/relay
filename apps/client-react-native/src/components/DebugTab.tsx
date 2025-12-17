/**
 * Simplified themed-styler DebugTab
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ScrollView as ThemedScrollView,
  Text as ThemedText,
  TouchableOpacity as ThemedTouchableOpacity,
  View as ThemedView,
  TextInput as ThemedTextInput,
} from '../themedPrimitives'
import { unifiedBridge, ensureDefaultsLoaded } from '@relay/shared'
import HookRenderer from './HookRenderer'
import { useRNTranspilerSetting } from '../state/transpilerSettings'
import { styled } from '../themedRuntime'

type ThemesState = { themes?: Record<string, any>; currentTheme?: string } | null
type UsageSnapshot = { selectors: string[]; classes: string[] }
const themedStylerCrateVersion = '0.1.4'
const getGlobalRuntimeVersion = () => (typeof globalThis !== 'undefined' ? String((globalThis as any).__themedStyler_version ?? 'unavailable') : 'unavailable')

function buildFullState(usage: UsageSnapshot, themesState: ThemesState) {
  const themesMap = themesState && typeof themesState.themes === 'object' ? themesState.themes : {}
  const current = themesState && typeof themesState.currentTheme === 'string' ? themesState.currentTheme : null
  const defaultTheme = current || Object.keys(themesMap)[0] || null
  return {
    themes: themesMap,
    default_theme: defaultTheme,
    current_theme: current,
    variables: {},
    breakpoints: {},
    used_selectors: usage.selectors,
    used_classes: usage.classes,
  }
}

const JsonBlock: React.FC<{ label: string; value: unknown }> = ({ label, value }) => {
  const text = useMemo(() => {
    if (value === undefined) return 'undefined'
    if (typeof value === 'string') return value.length ? value : '(empty string)'
    try {
      return JSON.stringify(value, null, 2)
    } catch (err) {
      return String(err)
    }
  }, [value])

  return (
    <ThemedView className="rounded border border-slate-200 bg-slate-50/85 p-3" style={{ maxHeight: 220 }}>
      <ThemedText className="text-[10px] uppercase tracking-[0.3em] text-slate-500 mb-2">{label}</ThemedText>
      <ThemedText className="font-mono text-xs" style={{ lineHeight: 18 }} selectable>
        {text}
      </ThemedText>
    </ThemedView>
  )
}

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
  const [usageSnapshot, setUsageSnapshot] = useState<UsageSnapshot>(() => unifiedBridge.getUsageSnapshot())
  const [themesState, setThemesState] = useState<ThemesState>(() =>
    typeof unifiedBridge.getThemes === 'function' ? unifiedBridge.getThemes() : null,
  )
  const [cssTrace, setCssTrace] = useState<string>('')

  const refreshStats = useCallback(() => {
    try {
      setUsageSnapshot(unifiedBridge.getUsageSnapshot())
    } catch (err) {
      console.warn('[DebugTab] Failed to sample themed-styler usage', err)
      setUsageSnapshot({ selectors: [], classes: [] })
    }
    try {
      const themes = typeof unifiedBridge.getThemes === 'function' ? unifiedBridge.getThemes() : null
      setThemesState(themes)
    } catch (err) {
      console.warn('[DebugTab] Failed to load themed-styler themes', err)
      setThemesState(null)
    }
    try {
      if (typeof unifiedBridge.getCssForWeb === 'function') {
        const cssOutput = unifiedBridge.getCssForWeb()
        setCssTrace(typeof cssOutput === 'string' ? cssOutput : JSON.stringify(cssOutput, null, 2))
      } else {
        setCssTrace('')
      }
    } catch (err) {
      setCssTrace(String(err))
    }
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        await ensureDefaultsLoaded()
      } catch (err) {
        console.warn('[DebugTab] Failed to load themed-styler defaults', err)
      }
      if (mounted) {
        refreshStats()
      }
    })()
    return () => {
      mounted = false
    }
  }, [refreshStats])

  const runtimeVersion = useMemo(() => getGlobalRuntimeVersion(), [])
  const fullState = useMemo(() => buildFullState(usageSnapshot, themesState), [usageSnapshot, themesState])

  return (
    <ThemedScrollView className="flex-1" style={{ backgroundColor: '#f5f5f5' }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <ThemedView className="mb-4 bg-white rounded px-4 py-3 border border-slate-200" style={{ shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 1.5, shadowOffset: { width: 0, height: 1 }, elevation: 1 }}>
        <ThemedText className="text-xs uppercase tracking-[0.4em] text-slate-400 mb-1">themed-styler crate</ThemedText>
        <ThemedView className="flex-row items-center justify-between">
          <ThemedText className="text-base font-semibold" style={{ color: '#111' }}>
            v{themedStylerCrateVersion}
          </ThemedText>
          <ThemedText className="text-[11px] font-mono text-slate-500">
            runtime:{' '}
            {runtimeVersion}
          </ThemedText>
        </ThemedView>
      </ThemedView>
      <ThemedView className="mb-6 bg-white rounded p-4" style={{ shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 }}>
        <ThemedView className="flex-row items-center justify-between mb-3">
          <ThemedText className="text-base font-bold" style={{ color: '#333' }}>
            Themed-styler statistics
          </ThemedText>
          <ThemedTouchableOpacity className="px-3 py-1 rounded border border-primary" onPress={refreshStats}>
            <ThemedText className="text-[11px] text-primary font-semibold">Refresh</ThemedText>
          </ThemedTouchableOpacity>
        </ThemedView>
        <ThemedView className="space-y-3">
          <JsonBlock label="Full state" value={fullState} />
          <JsonBlock label="Usage snapshot" value={usageSnapshot} />
          <JsonBlock label="Selectors processed" value={usageSnapshot.selectors} />
          <JsonBlock label="Classes processed" value={usageSnapshot.classes} />
          <JsonBlock label="CSS fallback" value={cssTrace} />
        </ThemedView>
      </ThemedView>
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
