import { createContext, useContext, ReactNode } from 'react'
import { Plugin, PluginComponents } from './types'

interface PluginContextValue {
  plugin: Plugin
  components: PluginComponents
}

const PluginContext = createContext<PluginContextValue | null>(null)

interface PluginProviderProps {
  plugin: Plugin
  children: ReactNode
}

export function PluginProvider({ plugin, children }: PluginProviderProps) {
  return (
    <PluginContext.Provider value={{ plugin, components: plugin.components }}>
      {children}
    </PluginContext.Provider>
  )
}

export function usePlugin(): PluginContextValue {
  const context = useContext(PluginContext)
  if (!context) {
    throw new Error('usePlugin must be used within a PluginProvider')
  }
  return context
}

export function usePluginComponent<K extends keyof PluginComponents>(
  name: K
): PluginComponents[K] {
  const { components } = usePlugin()
  return components[name]
}

export function usePluginConfig() {
  const { plugin } = usePlugin()
  return plugin.config
}

export function useFetchContent() {
  const { plugin } = usePlugin()
  return plugin.fetchContent
}
