import { useEffect } from 'react'
import { useAppState } from './state/store'
import { PeersView } from './components/PeersView'
import { TabBar } from './components/TabBar'
import { RepoBrowser } from './components/RepoBrowser'
import { PluginProvider } from './plugins/PluginContext'
import { webPlugin } from './plugins/web'
import './App.css'

function App() {
  const tabs = useAppState((s) => s.tabs)
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
    openTab(host, '/')
  }

  return (
    <PluginProvider plugin={webPlugin}>
      <div className="app-container">
        <header className="app-header">
          <div className="header-content">
            <a href="/">
              <img src="/relay.svg" alt="Relay" width="32" height="32" />
              <h1>Relay</h1>
            </a>
          </div>
        </header>

        <TabBar />

        <div className="app-layout">
          <aside className="app-sidebar">
            <PeersView onPeerPress={handlePeerPress} />
          </aside>

          <main className="app-main">
            {tabs.length === 0 ? (
              <div className="empty-state">
                <div className="empty-message">
                  <h2>No repositories open</h2>
                  <p>Select a peer from the left panel to browse its repositories.</p>
                </div>
              </div>
            ) : activeTabId ? (
              <RepoBrowser tabId={activeTabId} />
            ) : null}
          </main>
        </div>
      </div>
    </PluginProvider>
  )
}

export default App
