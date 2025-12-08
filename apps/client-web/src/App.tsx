import { useState } from 'react'
import { useAppState } from './state/store'
import { PeersView } from './components/PeersView'
import { TabBar } from './components/TabBar'
import { RepoBrowser } from './components/RepoBrowser'
import { DebugMenu } from './components/DebugMenu'
import { PluginProvider } from './plugins/PluginContext'
import { webPlugin } from './plugins/web'

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
      <div className="flex flex-col w-screen h-screen">
        <DebugMenu />
        <TabBar />
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 flex flex-col overflow-hidden">
            {activeTabId === 'home' ? (
              <PeersView onPeerPress={handlePeerPress} />
            ) : activeTabId ? (
              <RepoBrowser tabId={activeTabId} />
            ) : (
              <div className="flex items-center justify-center h-full w-full">
                <div className="text-center text-gray-600">
                  <h2 className="mb-2 text-2xl font-semibold">No repositories open</h2>
                  <p className="text-base">Select a peer from the home tab to browse its repositories.</p>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </PluginProvider>
  )
}

export default App
