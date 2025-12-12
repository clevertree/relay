import { useCallback, useEffect, useState } from 'react'

type TranspilerSetting = 'client-only' | 'allow-server-fallback' | 'server-only'

const STORAGE_KEY = 'relay_transpiler_setting'
const DEFAULT_SETTING: TranspilerSetting = 'client-only'

function readStoredSetting(): TranspilerSetting {
  if (typeof window === 'undefined') {
    return DEFAULT_SETTING
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'allow-server-fallback') return 'allow-server-fallback'
    if (stored === 'server-only') return 'server-only'
  } catch (e) {
    console.warn('[transpilerSettings] Failed to read stored setting', e)
  }
  return DEFAULT_SETTING
}

function persistSetting(value: TranspilerSetting) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, value)
  } catch (e) {
    console.warn('[transpilerSettings] Failed to persist setting', e)
  }
}

export function useTranspilerSetting() {
  const [setting, setSetting] = useState<TranspilerSetting>(() => readStoredSetting())

  const updateSetting = useCallback((next: TranspilerSetting) => {
    setSetting(next)
    persistSetting(next)
  }, [])

  useEffect(() => {
    const handleStorage = () => {
      setSetting(readStoredSetting())
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  // Reflect current setting to a global flag so shared runtime can honor it without React imports
  useEffect(() => {
    try {
      ;(window as any).__allowServerTranspile = setting === 'allow-server-fallback'
      ;(window as any).__forceServerTranspile = setting === 'server-only'
    } catch {}
  }, [setting])

  return {
    setting,
    setSetting: updateSetting,
  }
}

export type { TranspilerSetting }
