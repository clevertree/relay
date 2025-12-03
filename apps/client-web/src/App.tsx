import { useEffect } from 'react'
import { useAppState } from './state/store'
import { PeersView } from './components/PeersView'
import { TabBar } from './components/TabBar'
import { RepoBrowser } from './components/RepoBrowser'
import { PluginProvider } from './plugins/PluginContext'
import { webPlugin } from './plugins/web'
import './App.css'

function App() {
  const activeTabId = useAppState((s) => s.activeTabId)
  const openTab = useAppState((s) => s.openTab)

  // Handle URL params for opening peers
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const openParam = params.get('open')
    if (openParam) {
      const [host, ...pathParts] = openParam.split('/')
      const path = '/' + pathParts.join('/')
      openTab(host, path)
    }
  }, [])

  const handlePeerPress = (host: string) => {
    openTab(host, '/README.md')
  }

  return (
    <PluginProvider plugin={webPlugin}>
      <div className="app-container">
        <TabBar />

        <div className="app-layout">
          <main className="app-main">
            {activeTabId === 'home' ? (
              <PeersView onPeerPress={handlePeerPress} />
            ) : activeTabId ? (
              <RepoBrowser tabId={activeTabId} />
            ) : (
              <div className="empty-state">
                <div className="empty-message">
                  <h2>No repositories open</h2>
                  <p>Select a peer from the home tab to browse its repositories.</p>
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
