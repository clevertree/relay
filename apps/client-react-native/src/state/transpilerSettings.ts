import {create} from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type RNTranspilerSetting = 'client' | 'server'

type TranspilerState = {
  mode: RNTranspilerSetting
  setMode: (m: RNTranspilerSetting) => Promise<void>
  _init: Promise<void> | null
}

const STORAGE_KEY = 'relay_rn_transpiler_mode'

export const useRNTranspilerSetting = create<TranspilerState>((set, get) => ({
  mode: 'client',
  _init: null,
  setMode: async (m: RNTranspilerSetting) => {
    set({ mode: m })
    try { await AsyncStorage.setItem(STORAGE_KEY, m) } catch {}
  },
}))

// Kick off async hydration once on import
;(async () => {
  try {
    const val = await AsyncStorage.getItem(STORAGE_KEY)
    if (val === 'client' || val === 'server') {
      useRNTranspilerSetting.setState({ mode: val })
    }
  } catch {}
})()
