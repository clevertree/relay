import React, { useEffect } from 'react';
import { StatusBar, useWindowDimensions } from 'react-native';
import { SafeAreaView, ScrollView, Text, TouchableOpacity, View } from './tailwindPrimitives';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PeersView from './components/PeersView';
import RepoTab from './components/RepoTab';
import DebugTab from './components/DebugTab';
import { useAppState } from './state/store';
import { useAppUpdate } from './hooks/useAppUpdate';
import { UpdateModal } from './components/UpdateModal';
import { initNativeRustTranspiler } from './nativeRustTranspiler';
type RootStackParamList = {
  Main: undefined;
  RepoTab: { tabId: string };
  Debug: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const TabBar: React.FC<{ navigation: any }> = ({ navigation }) => {
  const tabs = useAppState((s) => s.tabs);
  const activeTabId = useAppState((s) => s.activeTabId);
  const setActiveTab = useAppState((s) => s.setActiveTab);
  const closeTab = useAppState((s) => s.closeTab);
  const homeTabId = useAppState((s) => s.homeTabId);

  // Include home tab and debug tab, ensure unique tab ids (home shouldn't appear twice)
  const initialTabs = [
    { id: homeTabId, title: 'Home', isHome: true },
    ...tabs,
    { id: 'debug', title: 'Debug', isDebug: true },
  ];
  const seen = new Set<string>();
  const allTabs = [] as Array<{ id: string; title: string; isHome?: boolean; isDebug?: boolean }>;
  for (const t of initialTabs) {
    if (!t || !t.id) continue;
    if (seen.has(String(t.id))) continue;
    seen.add(String(t.id));
    allTabs.push(t);
  }

  return (
    <View className="bg-surface-secondary border-b" style={{ borderBottomColor: '#eee', borderBottomWidth: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {allTabs.map((tab) => (
          <View key={tab.id} className="flex-row items-center">
            <TouchableOpacity
              className={`px-4 py-2 border-b-2 ${activeTabId === tab.id ? 'border-primary bg-surface' : 'border-transparent'}`}
              style={{ maxWidth: 150 }}
              onPress={() => {
                setActiveTab(tab.id);
                if (tab.id === homeTabId) {
                  navigation.navigate('Main');
                } else if (tab.id === 'debug') {
                  navigation.navigate('Debug');
                } else {
                  navigation.navigate('RepoTab', { tabId: tab.id });
                }
              }}>
              <Text
                className={`text-sm ${activeTabId === tab.id ? 'text-primary font-semibold' : 'text-text-secondary'}`}
                numberOfLines={1}
              >
                {tab.title}
              </Text>
            </TouchableOpacity>
            {!tab.isHome && !tab.isDebug && (
              <TouchableOpacity
                className="p-2 mr-1"
                onPress={() => {
                  closeTab(tab.id);
                  if (activeTabId === tab.id) {
                    navigation.navigate('Main');
                  }
                }}>
                <Text className="text-lg text-text-muted font-semibold">×</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const MainScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const openTab = useAppState((s) => s.openTab);
  const activeTabId = useAppState((s) => s.activeTabId);
  const homeTabId = useAppState((s) => s.homeTabId);
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const { showUpdateModal, setShowUpdateModal, checkForUpdate } = useAppUpdate();

  // Check for updates on component mount
  useEffect(() => {
    checkForUpdate();
    console.log('[MainScreen] Mounted, activeTabId:', activeTabId);
  }, [checkForUpdate]);

  const handlePeerPress = (host: string) => {
    openTab(host).then((tabId) => {
      navigation.navigate('RepoTab', { tabId });
    }).catch((err) => {
      console.error('Failed to open tab:', err);
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <StatusBar barStyle="dark-content" />
      <View className="flex-row items-center justify-between p-3 border-b bg-surface" style={{ borderBottomColor: '#eee', borderBottomWidth: 1 }}>
        <Text className="text-lg font-bold flex-1 text-center">Relay Client</Text>
        <TouchableOpacity className="p-2 ml-3" onPress={checkForUpdate}>
          <Text className="text-lg">🔄</Text>
        </TouchableOpacity>
      </View>
      <TabBar navigation={navigation} />
      <View className={isTablet ? 'flex-1 flex-row' : 'flex-1'}>
        <View className={isTablet ? 'flex-1' : 'flex-1'} style={isTablet ? { borderRightWidth: 1, borderRightColor: '#eee' } : undefined}>
          {!activeTabId || activeTabId === homeTabId ? (
            <>
              {console.log('[MainScreen] Rendering PeersView, activeTabId:', activeTabId, 'homeTabId:', homeTabId)}
              <PeersView onPeerPress={handlePeerPress} />
            </>
          ) : activeTabId === 'debug' ? (
            <>
              {console.log('[MainScreen] Rendering DebugTab, activeTabId:', activeTabId)}
              <DebugTab />
            </>
          ) : (
            <>
              {console.log('[MainScreen] Rendering RepoTab, activeTabId:', activeTabId)}
              <RepoTab tabId={activeTabId} />
            </>
          )}
        </View>
      </View>
      <UpdateModal
        visible={showUpdateModal}
        onDismiss={() => setShowUpdateModal(false)}
      />
    </SafeAreaView>
  );
};

const RepoTabScreen: React.FC<{ route: any; navigation: any }> = ({ route, navigation }) => {
  const { tabId } = route.params;

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <StatusBar barStyle="dark-content" />
      <View className="flex-row items-center justify-between p-3 border-b bg-surface" style={{ borderBottomColor: '#eee', borderBottomWidth: 1 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} className="p-1">
          <Text className="text-primary text-base">← Peers</Text>
        </TouchableOpacity>
        <Text className="text-lg font-bold flex-1 text-center">Relay Client</Text>
        <View style={{ width: 60 }} />
      </View>
      <TabBar navigation={navigation} />
      <View className="flex-1">
        <RepoTab tabId={tabId} />
      </View>
    </SafeAreaView>
  );
};

const DebugScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  return (
    <SafeAreaView className="flex-1 bg-surface">
      <StatusBar barStyle="dark-content" />
      <View className="flex-row items-center justify-between p-3 border-b bg-surface" style={{ borderBottomColor: '#eee', borderBottomWidth: 1 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} className="p-1">
          <Text className="text-primary text-base">← Home</Text>
        </TouchableOpacity>
        <Text className="text-lg font-bold flex-1 text-center">Debug Tools</Text>
        <View style={{ width: 60 }} />
      </View>
      <TabBar navigation={navigation} />
      <View className="flex-1">
        <DebugTab />
      </View>
    </SafeAreaView>
  );
};

class ErrorBoundary extends React.Component<{}, { error: Error | null; info?: React.ErrorInfo | null }> {
  constructor(props: {}) {
    super(props);
    this.state = { error: null, info: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info.componentStack);
    this.setState({ error, info });
  }

  render() {
    if (this.state.error) {
      const stack = this.state.info?.componentStack || this.state.error.stack || 'stack trace unavailable';
      return (
        <SafeAreaView style={{ flex: 1, padding: 16, backgroundColor: '#111' }}>
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Text style={{ color: '#f5f5f5', fontSize: 20, fontWeight: '700', marginBottom: 10 }}>
              Rendering failure
            </Text>
            <Text style={{ color: '#dedede', fontSize: 16, marginBottom: 12 }}>
              We couldn’t render some UI. The log below shows what went wrong.
            </Text>
            <Text style={{ color: '#ff8c00', fontWeight: '600' }}>Error message</Text>
            <Text style={{ color: '#fff', marginBottom: 12 }} selectable>
              {this.state.error.message}
            </Text>
            <Text style={{ color: '#ff8c00', fontWeight: '600' }}>Component stack</Text>
            <ScrollView style={{ flex: 1, marginTop: 6, backgroundColor: '#222', borderRadius: 8, padding: 10 }} contentContainerStyle={{ flexGrow: 1 }}>
              <Text style={{ color: '#d4d4d4', fontSize: 12, lineHeight: 20 }} selectable>
                {stack}
              </Text>
            </ScrollView>
            <Text style={{ color: '#9f9', fontSize: 13, marginTop: 10 }}>
              Please capture your device logs and share them with the engineering team along with the actions you took before this screen appeared.
            </Text>
          </View>
        </SafeAreaView>
      );
    }
    // @ts-ignore allow children
    return this.props.children;
  }
}

const App: React.FC = () => {
  // Initialize native Rust hook transpiler bridge on app startup
  useEffect(() => {
    ; (async () => {
      try {
        console.log('[App] Initializing native hook-transpiler bridge...')
        await initNativeRustTranspiler()
        console.log('[App] Native hook-transpiler bridge initialized')
      } catch (e) {
        console.error('[App] Failed to initialize native hook-transpiler bridge:', e)
      }
    })()
  }, [])

  // Debug: log component availability to help diagnose undefined SceneView errors
  // (SceneView will throw if a screen's component is undefined)
  // eslint-disable-next-line no-console
  console.log('MainScreen type:', typeof MainScreen);
  // eslint-disable-next-line no-console
  console.log('RepoTabScreen type:', typeof RepoTabScreen);
  // eslint-disable-next-line no-console
  console.log('PeersView type:', typeof PeersView, 'RepoTab import type:', typeof RepoTab);

  return (
    <ErrorBoundary>
      <NavigationContainer>
        <Stack.Navigator id="RootNavigator" screenOptions={{ headerShown: false }}>
          <Stack.Screen
            name="Main">
            {(props) => {
              try {
                // eslint-disable-next-line no-console
                console.log('Rendering MainScreen, PeersView type:', typeof PeersView);
                return <MainScreen {...props} />;
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error('MainScreen render failed', err);
                return (
                  <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <Text>Main render error</Text>
                  </SafeAreaView>
                );
              }
            }}
          </Stack.Screen>
          <Stack.Screen
            name="Debug">
            {(props) => {
              try {
                return <DebugScreen {...props} />;
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error('DebugScreen render failed', err);
                return (
                  <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <Text>Debug render error</Text>
                  </SafeAreaView>
                );
              }
            }}
          </Stack.Screen>
          <Stack.Screen
            name="RepoTab">
            {(props) => {
              try {
                // eslint-disable-next-line no-console
                console.log('Rendering RepoTabScreen, RepoTab type:', typeof RepoTab);
                return <RepoTabScreen {...props} />;
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error('RepoTabScreen render failed', err);
                return (
                  <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <Text>RepoTab render error</Text>
                  </SafeAreaView>
                );
              }
            }}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </ErrorBoundary>
  );
};

// Styles converted to NativeWind classes where possible. Inline styles remain
// for precise values not covered by the Tailwind scale (e.g., exact border colors, widths).

export default App;
