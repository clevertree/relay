import React, { useEffect, useRef, type ComponentProps } from 'react'
import { StatusBar, useWindowDimensions } from 'react-native'
import { TSDiv } from './components/TSDiv'
import { NavigationContainer, useIsFocused } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import PeersView from './components/PeersView'
import RepoTab from './components/RepoTab'
import DebugTab from './components/DebugTab'
import { useAppState } from './state/store'
import { useAppUpdate } from './hooks/useAppUpdate'
import { UpdateModal } from './components/UpdateModal'
import { initNativeRustTranspiler } from './nativeRustTranspiler'
import { initNativeThemedStyler } from './nativeThemedStyler'

type RootStackParamList = {
  Main: undefined
  RepoTab: { tabId: string }
  Debug: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

const TabBar: React.FC<{ navigation: any }> = ({ navigation }) => {
  const tabs = useAppState((s) => s.tabs)
  const activeTabId = useAppState((s) => s.activeTabId)
  const setActiveTab = useAppState((s) => s.setActiveTab)
  const closeTab = useAppState((s) => s.closeTab)
  const homeTabId = useAppState((s) => s.homeTabId)

  const initialTabs = [{ id: homeTabId, title: 'Home', isHome: true }, ...tabs, { id: 'debug', title: 'Debug', isDebug: true }]
  const seen = new Set<string>()
  const allTabs: Array<{ id: string; title: string; isHome?: boolean; isDebug?: boolean }> = []
  for (const t of initialTabs) {
    if (!t || !t.id) continue
    if (seen.has(String(t.id))) continue
    seen.add(String(t.id))
    allTabs.push(t)
  }

  return (
    <TSDiv tag="div" className="p-4 border-b">
      <TSDiv tag="section" horizontal showsHorizontalScrollIndicator={false}>
        {allTabs.map((tab) => (
          <TSDiv key={tab.id} tag="div" className="flex-row items-center">
            <TSDiv
              tag="button"
              className={`px-4 py-2 border-b-2 ${activeTabId === tab.id ? 'border-primary bg-surface' : 'border-transparent'}`}
              style={{ maxWidth: 150 }}
              onPress={() => {
                setActiveTab(tab.id)
                if (tab.id === homeTabId) navigation.navigate('Main')
                else if (tab.id === 'debug') navigation.navigate('Debug')
                else navigation.navigate('RepoTab', { tabId: tab.id })
              }}>
              <TSDiv tag="span" className={`text-sm ${activeTabId === tab.id ? 'text-primary font-semibold' : 'text-text-secondary'}`} numberOfLines={1}>
                {tab.title}
              </TSDiv>
            </TSDiv>
            {!tab.isHome && !tab.isDebug && (
              <TSDiv
                tag="button"
                className="p-2 mr-1"
                onPress={() => {
                  closeTab(tab.id)
                  if (activeTabId === tab.id) navigation.navigate('Main')
                }}>
                <TSDiv tag="span" className="text-lg text-text-muted font-semibold">
                  ×
                </TSDiv>
              </TSDiv>
            )}
          </TSDiv>
        ))}
      </TSDiv>
    </TSDiv>
  )
}

const MainScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const openTab = useAppState((s) => s.openTab)
  const activeTabId = useAppState((s) => s.activeTabId)
  const homeTabId = useAppState((s) => s.homeTabId)
  const { width } = useWindowDimensions()
  const isTablet = width >= 768
  const { showUpdateModal, setShowUpdateModal, checkForUpdate } = useAppUpdate()
  const isScreenFocused = useIsFocused()
  const lastViewRef = useRef<string | null>(null)

  useEffect(() => {
    const mode = isScreenFocused && (!activeTabId || activeTabId === homeTabId) ? 'home' : activeTabId === 'debug' ? 'debug' : 'repo'
    if (lastViewRef.current !== mode) {
      console.log(
        '[MainScreen] Rendering',
        mode === 'home' ? 'PeersView' : mode === 'debug' ? 'DebugTab' : 'RepoTab',
        'activeTabId:',
        activeTabId,
        'homeTabId:',
        homeTabId,
        'focused:',
        isScreenFocused,
      )
      lastViewRef.current = mode
    }
  }, [activeTabId, homeTabId, isScreenFocused])

  useEffect(() => {
    checkForUpdate()
    console.log('[MainScreen] Mounted, activeTabId:', activeTabId)
  }, [checkForUpdate])

  const handlePeerPress = (host: string) => {
    openTab(host)
      .then((tabId) => navigation.navigate('RepoTab', { tabId }))
      .catch((err) => console.error('Failed to open tab:', err))
  }

  return (
    <TSDiv tag="main" className="flex-1 bg-surface">
      <StatusBar barStyle="dark-content" />
      <TSDiv tag="div" className="flex-row items-center justify-between p-3 border-b bg-surface" style={{ borderBottomColor: '#eee', borderBottomWidth: 1 }}>
        <TSDiv tag="span" className="text-lg font-bold flex-1 text-center">
          Relay Client
        </TSDiv>
        <TSDiv tag="button" className="p-2 ml-3" onPress={checkForUpdate}>
          <TSDiv tag="span" className="text-lg">🔄</TSDiv>
        </TSDiv>
      </TSDiv>
      <TabBar navigation={navigation} />
      <TSDiv tag="div" className={isTablet ? 'flex-1 flex-row' : 'flex-1'}>
        <TSDiv tag="div" className={isTablet ? 'flex-1' : 'flex-1'} style={isTablet ? { borderRightWidth: 1, borderRightColor: '#eee' } : undefined}>
          {isScreenFocused && (!activeTabId || activeTabId === homeTabId) ? (
            <PeersView onPeerPress={handlePeerPress} isActive={isScreenFocused} />
          ) : activeTabId === 'debug' ? (
            <DebugTab />
          ) : (
            <RepoTab tabId={activeTabId} />
          )}
        </TSDiv>
      </TSDiv>
      <UpdateModal visible={showUpdateModal} onDismiss={() => setShowUpdateModal(false)} />
    </TSDiv>
  )
}

const RepoTabScreen: React.FC<{ route: any; navigation: any }> = ({ route, navigation }) => {
  const { tabId } = route.params

  return (
    <TSDiv tag="main" className="flex-1 bg-surface">
      <StatusBar barStyle="dark-content" />
      <TSDiv tag="div" className="flex-row items-center justify-between p-3 border-b bg-surface" style={{ borderBottomColor: '#eee', borderBottomWidth: 1 }}>
        <TSDiv tag="button" onPress={() => navigation.goBack()} className="p-1">
          <TSDiv tag="span" className="text-primary text-base">
            ← Peers
          </TSDiv>
        </TSDiv>
        <TSDiv tag="span" className="text-lg font-bold flex-1 text-center">
          Relay Client
        </TSDiv>
        <TSDiv tag="div" style={{ width: 60 }} />
      </TSDiv>
      <TabBar navigation={navigation} />
      <TSDiv tag="div" className="flex-1">
        <RepoTab tabId={tabId} />
      </TSDiv>
    </TSDiv>
  )
}

const DebugScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  return (
    <TSDiv tag="main" className="flex-1 bg-surface">
      <StatusBar barStyle="dark-content" />
      <TSDiv tag="div" className="flex-row items-center justify-between p-3 border-b bg-surface" style={{ borderBottomColor: '#eee', borderBottomWidth: 1 }}>
        <TSDiv tag="button" onPress={() => navigation.goBack()} className="p-1">
          <TSDiv tag="span" className="text-primary text-base">
            ← Home
          </TSDiv>
        </TSDiv>
        <TSDiv tag="span" className="text-lg font-bold flex-1 text-center">
          Debug Tools
        </TSDiv>
        <TSDiv tag="div" style={{ width: 60 }} />
      </TSDiv>
      <TabBar navigation={navigation} />
      <TSDiv tag="div" className="flex-1">
        <DebugTab />
      </TSDiv>
    </TSDiv>
  )
}

type ErrorBoundaryProps = { children?: React.ReactNode }

class ErrorBoundary extends React.Component<ErrorBoundaryProps, { error: Error | null; info?: React.ErrorInfo | null }> {
  constructor(props: Record<string, never>) {
    super(props)
    this.state = { error: null, info: null }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
    this.setState({ error, info })
  }

  render() {
    if (this.state.error) {
      const stack = this.state.info?.componentStack || this.state.error.stack || 'stack trace unavailable'
      return (
        <TSDiv tag="main" style={{ flex: 1, padding: 16, backgroundColor: '#111' }}>
          <TSDiv tag="div" style={{ flex: 1, justifyContent: 'center' }}>
            <TSDiv tag="span" style={{ color: '#f5f5f5', fontSize: 20, fontWeight: '700', marginBottom: 10 }}>
              Rendering failure
            </TSDiv>
            <TSDiv tag="span" style={{ color: '#dedede', fontSize: 16, marginBottom: 12 }}>
              We couldn’t render some UI. The log below shows what went wrong.
            </TSDiv>
            <TSDiv tag="span" style={{ color: '#ff8c00', fontWeight: '600' }}>Error message</TSDiv>
            <TSDiv tag="span" style={{ color: '#fff', marginBottom: 12 }} selectable>
              {this.state.error.message}
            </TSDiv>
            <TSDiv tag="span" style={{ color: '#ff8c00', fontWeight: '600' }}>Component stack</TSDiv>
            <TSDiv tag="section" style={{ flex: 1, marginTop: 6, backgroundColor: '#222', borderRadius: 8, padding: 10 }} contentContainerStyle={{ flexGrow: 1 }}>
              <TSDiv tag="span" style={{ color: '#d4d4d4', fontSize: 12, lineHeight: 20 }} selectable>
                {stack}
              </TSDiv>
            </TSDiv>
            <TSDiv tag="span" style={{ color: '#9f9', fontSize: 13, marginTop: 10 }}>
              Please capture your device logs and share them with the engineering team along with the actions you took before this screen appeared.
            </TSDiv>
          </TSDiv>
        </TSDiv>
      )
    }
    return this.props.children as React.ReactElement | null
  }
}

const App: React.FC = () => {
  useEffect(() => {
    ; (async () => {
      try {
        console.log('[App] Initializing native hook-transpiler bridge...')
        await initNativeRustTranspiler()
        console.log('[App] Native hook-transpiler bridge initialized')
      } catch (e) {
        console.error('[App] Failed to initialize native hook-transpiler bridge:', e)
      }
      try {
        console.log('[App] Initializing native themed-styler bridge...')
        await initNativeThemedStyler()
        console.log('[App] Native themed-styler bridge initialized')
      } catch (err) {
        console.error('[App] Failed to initialize native themed-styler bridge:', err)
      }
    })()
  }, [])

  useEffect(() => {
    console.log('MainScreen type:', typeof MainScreen)
    console.log('RepoTabScreen type:', typeof RepoTabScreen)
    console.log('PeersView type:', typeof PeersView, 'RepoTab import type:', typeof RepoTab)
  }, [])

  return (
    <ErrorBoundary>
      <NavigationContainer>
        <Stack.Navigator id="RootNavigator" screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Main">
            {(props) => {
              try {
                return <MainScreen {...props} />
              } catch (err) {
                console.error('MainScreen render failed', err)
                return (
                  <TSDiv tag="main" style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <TSDiv tag="span">Main render error</TSDiv>
                  </TSDiv>
                )
              }
            }}
          </Stack.Screen>

          <Stack.Screen name="Debug">
            {(props) => {
              try {
                return <DebugScreen {...props} />
              } catch (err) {
                console.error('DebugScreen render failed', err)
                return (
                  <TSDiv tag="main" style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <TSDiv tag="span">Debug render error</TSDiv>
                  </TSDiv>
                )
              }
            }}
          </Stack.Screen>

          <Stack.Screen name="RepoTab">
            {(props) => {
              try {
                return <RepoTabScreen {...props} />
              } catch (err) {
                console.error('RepoTabScreen render failed', err)
                return (
                  <TSDiv tag="main" style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <TSDiv tag="span">RepoTab render error</TSDiv>
                  </TSDiv>
                )
              }
            }}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </ErrorBoundary>
  )
}

export default App