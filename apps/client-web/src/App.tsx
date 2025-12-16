import { useState } from 'react'
import { useAppState } from './state/store'
import { PeersView } from './components/PeersView'
import { TabBar } from './components/TabBar'
import { RepoBrowser } from './components/RepoBrowser'
import { SettingsTab } from './components/SettingsTab'
import { PluginProvider } from './plugins/PluginContext'
import { webPlugin } from './plugins/web'
import { TSDiv } from './components/TSDiv.tsx'

function App() {
  const activeTabId = useAppState((s) => s.activeTabId)
  const openTab = useAppState((s) => s.openTab)
  const [initialized, setInitialized] = useState(false)

  // Initialize state on mount (restores from localStorage)
  if (!initialized) {
    setInitialized(true)
  }

  const handlePeerPress = (host: string) => {
    openTab(host, '/')
  }

  return (
    <PluginProvider plugin={webPlugin}>
      <TSDiv className="flex flex-col w-screen h-screen">
        <TabBar />
        <TSDiv className="flex flex-1 overflow-hidden">
          <TSDiv tag='main' className="flex-1 flex flex-col overflow-hidden">
            {activeTabId === 'home' ? (
              <PeersView onPeerPress={handlePeerPress} />
            ) : activeTabId === 'settings' ? (
              <SettingsTab />
            ) : activeTabId ? (
              <RepoBrowser tabId={activeTabId} />
            ) : (
              <TSDiv className="flex items-center justify-center h-full w-full">
                <TSDiv className="text-center text-gray-600">
                  <TSDiv tag='h2' className="mb-2 text-2xl font-semibold">No repositories open</TSDiv>
                  <TSDiv tag='p' className="text-base">Select a peer from the home tab to browse its repositories.</TSDiv>
                </TSDiv>
              </TSDiv>
            )}
          </TSDiv>
        </TSDiv>
      </TSDiv>
    </PluginProvider>
  )
}

export default App
