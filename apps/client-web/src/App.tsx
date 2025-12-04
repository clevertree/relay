import { useEffect, useState } from 'react'
import { useAppState } from './state/store'
import { PeersView } from './components/PeersView'
import { TabBar } from './components/TabBar'
import { RepoBrowser } from './components/RepoBrowser'
import { PluginProvider } from './plugins/PluginContext'
import { webPlugin } from './plugins/web'

function App() {
  const activeTabId = useAppState((s) => s.activeTabId)
  const openTab = useAppState((s) => s.openTab)
  const [initialized, setInitialized] = useState(false)

  // Handle URL params for opening peers
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const openParam = params.get('open')
    if (openParam) {
      const [host, ...pathParts] = openParam.split('/')
      const path = '/' + pathParts.join('/')
      openTab(host, path)
    }
    setInitialized(true)
  }, [openTab])

  const handlePeerPress = (host: string) => {
    openTab(host, '/README.md')
  }

  if (!initialized) {
    return <div className="w-screen h-screen flex items-center justify-center">Loading...</div>
  }

  return (
    <PluginProvider plugin={webPlugin}>
      <div className="flex flex-col w-screen h-screen">
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
